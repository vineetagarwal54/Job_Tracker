// Multi-tag role-emphasis classification (task Part 1).
//
// A job description rarely maps to a single resume "variant". This classifies a
// JD into one or more role emphases and derives the concrete resume variant plus
// the signals used to steer summary selection, bullet ranking, skill selection,
// project selection, and page-space allocation. Fully deterministic; no API.
//
// The most important distinction this makes is enterprise-AI-builder work
// (shipped AI tools, agentic workflows, integrations, adoption, business impact)
// versus LLM-inference work (vLLM/SGLang/quantization/throughput). They share
// the ai-llm variant but must NOT share a summary.

import { textContainsTerm, canonicalizeTerm, normalizeText } from "./protectedTerms.js";

// Every supported emphasis. Order is the deterministic tie-break priority when
// two emphases score equally (earlier wins as primary).
export const EMPHASES = Object.freeze([
  "enterprise-ai",
  "agentic-rag",
  "ai-product",
  "llm-inference",
  "data-engineering",
  "backend",
  "cloud-platform",
  "systems-infra",
  "operating-systems",
  "networking",
  "security",
  "mobile",
  "fullstack",
  "general-swe",
]);

// Maps an emphasis to the verified resume variant that carries its bullets.
export const EMPHASIS_VARIANT = Object.freeze({
  "enterprise-ai": "ai-llm",
  "agentic-rag": "ai-llm",
  "ai-product": "ai-llm",
  "llm-inference": "ai-llm",
  // ETL, warehouse and ingestion work is backend/cloud work unless the JD
  // independently contains an AI-product or agentic signal.
  "data-engineering": "cloud-backend",
  backend: "cloud-backend",
  "cloud-platform": "cloud-backend",
  "systems-infra": "cloud-backend",
  "operating-systems": "cloud-backend",
  networking: "cloud-backend",
  security: "cloud-backend",
  mobile: "mobile",
  fullstack: "fullstack",
  "general-swe": "fullstack",
});

// Signal phrases per emphasis. Multi-word entries match as phrases; single
// tokens match on token boundaries (so "java" never triggers on "javascript").
const SIGNALS = Object.freeze({
  "enterprise-ai": ["enterprise", "internal tool", "internal tools", "automation", "automate", "salesforce", "servicenow", "workflow", "workflows", "integration", "integrations", "adoption", "business impact", "ai builder", "genai", "gen ai", "copilot", "productivity", "internal product", "operational"],
  "agentic-rag": ["agent", "agents", "agentic", "rag", "retrieval augmented generation", "retrieval-augmented generation", "langchain", "langgraph", "autogen", "vector database", "vector search", "multi-agent", "orchestration", "embeddings", "semantic search"],
  "ai-product": ["ai product", "ai-powered", "llm application", "llm applications", "prompt engineering", "user-facing", "chatbot", "assistant", "conversational", "generative ai", "ai features", "ai feature"],
  "llm-inference": ["inference", "vllm", "sglang", "tensorrt-llm", "tensorrt", "quantization", "speculative decoding", "kv cache", "throughput", "ttft", "gpu", "model serving", "serving", "triton", "cuda", "latency optimization", "llama.cpp"],
  "data-engineering": ["data engineer", "data engineering", "etl", "elt", "data pipeline", "data pipelines", "warehouse", "spark", "airflow", "streaming", "kafka", "data extraction", "ingestion"],
  backend: ["backend", "back-end", "back end", "api", "apis", "rest", "microservice", "microservices", "fastapi", "node.js", "express", "server-side", "endpoints", "database"],
  "cloud-platform": ["cloud", "aws", "platform engineer", "platform engineering", "infrastructure", "kubernetes", "docker", "terraform", "devops", "ci/cd", "eks", "lambda", "cloudformation", "serverless", "containers"],
  "systems-infra": ["distributed systems", "distributed", "scalability", "scalable", "reliability", "high availability", "performance", "concurrency", "throughput", "fault tolerance", "low latency"],
  "operating-systems": ["operating system", "operating systems", "linux", "unix", "kernel", "posix", "processes", "threads", "memory management", "file system", "systems programming"],
  networking: ["networking", "network", "tcp/ip", "tcp", "http", "websocket", "grpc", "protocol", "protocols", "socket", "sockets", "dns", "load balancing"],
  security: ["security", "authentication", "authorization", "oauth", "jwt", "rbac", "encryption", "iam", "sso", "vulnerability", "vulnerabilities", "secure", "cybersecurity", "penetration"],
  mobile: ["mobile", "react native", "android", "ios", "on-device", "on device", "mobile app", "mobile apps", "swift", "kotlin"],
  fullstack: ["full stack", "full-stack", "fullstack", "react", "frontend", "front-end", "next.js", "typescript", "ui", "user interface", "web application", "web app"],
});

function haystackFor(job, extraction, analysis) {
  const parts = [String(job?.description || ""), String(job?.title || "")];
  for (const keyword of extraction?.keywords || []) parts.push(keyword.value || keyword.normalized || "");
  for (const list of [analysis?.mustHaveKeywords, analysis?.niceToHaveKeywords, analysis?.responsibilities]) {
    for (const term of list || []) parts.push(String(term));
  }
  if (analysis?.roleFamily) parts.push(String(analysis.roleFamily));
  return parts.join(" \n ");
}

// A must-have match counts double: it is the strongest signal for the role.
function signalScore(signals, haystack, mustHaveSet) {
  let score = 0;
  for (const signal of signals) {
    let hit = false;
    if (/\s/.test(signal) || /[./+-]/.test(signal)) {
      hit = normalizeText(haystack).includes(normalizeText(signal));
    } else {
      hit = textContainsTerm(haystack, signal);
    }
    if (!hit) continue;
    score += mustHaveSet.has(canonicalizeTerm(signal)) ? 2 : 1;
  }
  return score;
}

// Classifies a JD into ranked emphases plus the resume variant to render.
// Returns { emphases: [{id, score}], primary, variant, secondary }.
export function classifyEmphases({ job = null, extraction = null, analysis = null } = {}) {
  const haystack = haystackFor(job, extraction, analysis);
  const mustHaveSet = new Set((analysis?.mustHaveKeywords || []).map((term) => canonicalizeTerm(term)));

  const scored = EMPHASES
    .filter((id) => id !== "general-swe")
    .map((id) => ({ id, score: signalScore(SIGNALS[id], haystack, mustHaveSet) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => (b.score - a.score) || (EMPHASES.indexOf(a.id) - EMPHASES.indexOf(b.id)));

  if (scored.length === 0) {
    return { emphases: [{ id: "general-swe", score: 0 }], primary: "general-swe", secondary: [], variant: EMPHASIS_VARIANT["general-swe"] };
  }

  // Honor a valid model/analysis variant recommendation when it is consistent
  // with a detected emphasis, but let a clearly dominant emphasis win.
  let primary = scored[0].id;
  const recommended = analysis?.recommendedVariant;
  if (recommended) {
    const consistent = scored.find((entry) => EMPHASIS_VARIANT[entry.id] === recommended);
    // Only defer to the recommendation when the top emphasis is not decisively
    // ahead (keeps enterprise-ai from being overridden into an inference resume).
    if (consistent && consistent.score >= scored[0].score - 1 && consistent.id !== primary) {
      primary = consistent.id;
    }
  }

  return {
    emphases: scored,
    primary,
    secondary: scored.filter((entry) => entry.id !== primary).map((entry) => entry.id),
    variant: EMPHASIS_VARIANT[primary] || "fullstack",
  };
}

// The verified summary key to use, given the primary emphasis. Falls back to
// the variant-level summary. Never returns an inference summary for a
// non-inference emphasis.
export function summaryKeyForEmphasis(primary) {
  return primary || "general-swe";
}
