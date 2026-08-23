import contentBank from "./content-bank.json" with { type: "json" };

// Shared term matching, aliases, acronyms and protected technical compounds
// (task Phases 3 and 6).
//
// Matching is token/phrase exact, never unrestricted substring: "java" must not
// match inside "javascript", yet compounds like C++, C#, Node.js, CI/CD and
// TensorRT-LLM must survive intact.

// Characters that are part of a technical token rather than separators. Keeping
// them intra-token is what lets "node.js", "c++", "c#", "ci/cd" and
// "tensorrt-llm" tokenize as single units.
const TOKEN_CHARS = "a-z0-9+#./-";

export function normalizeText(value) {
  return String(value ?? "").toLowerCase();
}

export function tokenize(value) {
  return normalizeText(value)
    .replace(new RegExp(`[^${TOKEN_CHARS}]+`, "g"), " ")
    .split(/\s+/)
    // Strip connector punctuation from the ends so a trailing sentence period
    // or hyphen does not glue onto the token ("tensorrt-llm." -> "tensorrt-llm")
    // while internal connectors survive ("node.js", "ci/cd", "c++").
    .map((token) => token.replace(/^[.\-/]+|[.\-/]+$/g, ""))
    .filter(Boolean);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Alias groups: canonical term -> every surface form that should count as the
// same term. Exactly the aliases the task calls out, plus a few unambiguous
// ones. Order within a group does not matter.
const BASE_ALIASES = {
  "node.js": ["node.js", "nodejs", "node"],
  postgresql: ["postgresql", "postgres"],
  kubernetes: ["kubernetes", "k8s"],
  rag: ["rag", "retrieval-augmented generation", "retrieval augmented generation"],
  llm: ["llm", "llms", "large language model", "large language models"],
  "ci/cd": ["ci/cd", "cicd"],
  "tensorrt-llm": ["tensorrt-llm", "tensorrt llm"],
  linux: ["linux", "unix"],
};

const inventoryAliases = Object.fromEntries(Object.entries(contentBank.skillMetadata?.aliases || {}).map(([canonical, forms]) => {
  const normalized = normalizeText(canonical).trim();
  return [normalized, [...new Set([normalized, ...forms.map((form) => normalizeText(form).trim())])]];
}));

export const ALIASES = Object.freeze({ ...BASE_ALIASES, ...inventoryAliases });

const ALIAS_LOOKUP = (() => {
  const map = new Map();
  for (const [canonical, forms] of Object.entries(ALIASES)) {
    for (const form of forms) map.set(form, canonical);
  }
  return map;
})();

export function canonicalizeTerm(term) {
  const lower = normalizeText(term).trim();
  return ALIAS_LOOKUP.get(lower) || lower;
}

// True when `term` appears in `text` as a standalone token or exact phrase.
// A term is treated as a phrase when it contains whitespace; otherwise it must
// equal a whole token. Aliases of the term also count.
export function textContainsTerm(text, term) {
  const forms = ALIASES[canonicalizeTerm(term)] || [normalizeText(term).trim()];
  const lowerText = normalizeText(text);
  const tokenSet = new Set(tokenize(text));
  for (const form of forms) {
    if (/\s/.test(form)) {
      // Alphanumeric boundaries only: block "reactnative" but allow a trailing
      // period or comma after the phrase ("react native.").
      const re = new RegExp(`(?<![a-z0-9])${escapeRegex(form)}(?![a-z0-9])`);
      if (re.test(lowerText)) return true;
    } else if (tokenSet.has(form)) {
      return true;
    }
  }
  return false;
}

// Acronyms that must be preserved through any rewrite when present in the
// source (task Phase 6).
export const ACRONYMS = Object.freeze([
  "RAG", "LLM", "KV", "TTFT", "API", "REST", "SOAP", "CI/CD",
  "RBAC", "SSO", "JWT", "ORM", "P2P",
]);

// Technical compounds whose hyphenation is legitimate and must not be stripped
// by the no-separator rule, and which must survive rewrites (task Phase 6).
export const TECH_COMPOUNDS = Object.freeze([
  "TensorRT-LLM", "4-bit", "8-bit", "end-to-end", "full-stack", "multi-agent",
  "real-time", "open-source", "cross-platform", "high-traffic", "low-latency",
  "client-side", "peer-to-peer", "CI/CD",
]);

// Multi-word technical phrases that must not be visually split across a line
// break (task Part 4). Wrapped in \mbox at render time so they stay whole; each
// is short enough not to overflow the column.
export const PROTECTED_PHRASES = Object.freeze([
  "React Native", "speculative decoding", "vision-language model",
  "Amazon Bedrock", "Hugging Face", "on-device",
]);

// Technologies recognized for the "a rewrite may not introduce an unsupported
// technology" guard (task Phase 5). Lowercase canonical tokens.
export const TECH_LEXICON = Object.freeze([
  "python", "javascript", "typescript", "java", "c++", "c#", "go", "sql",
  "react", "next.js", "react native", "node.js", "express", "fastapi", "django",
  "flask", "redis", "postgresql", "mongodb", "mysql", "sqlite", "aws", "docker",
  "kubernetes", "eks", "s3", "dynamodb", "lambda", "sqs", "appsync",
  "cloudformation", "langchain", "langgraph", "autogen", "bedrock", "openai",
  "anthropic", "claude", "gemini", "hugging face", "pytorch", "tensorflow",
  "vllm", "sglang", "tensorrt-llm", "llama.cpp", "llama.rn", "faiss", "pinecone",
  "selenium", "streamlit", "sqlalchemy", "prisma", "websocket", "webrtc",
  "socket.io", "peerjs", "stripe", "salesforce", "servicenow", "electron",
  "redux", "tailwind", "turborepo", "graphql", "selenium", "cas sso",
]);

export function acronymsIn(text) {
  return ACRONYMS.filter((acronym) => textContainsTerm(text, acronym));
}

export function compoundsIn(text) {
  return TECH_COMPOUNDS.filter((compound) => textContainsTerm(text, compound));
}

export function technologiesIn(text) {
  const found = new Set();
  for (const tech of TECH_LEXICON) {
    if (textContainsTerm(text, tech)) found.add(canonicalizeTerm(tech));
  }
  return found;
}
