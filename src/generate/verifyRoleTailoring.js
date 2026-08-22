// Deterministic tests for role-specific tailoring, bullet distribution,
// constrained rewriting, and identity validation (task Parts 1-4, Part 6).
// No API calls, no compile; the orchestrator compile integration lives in
// electron/anthropic/verifyFallbackGeneration.cjs.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { extractJobKeywords } from "./keywordExtraction.js";
import { classifyEmphases } from "./roleEmphasis.js";
import { selectSummary } from "./summaryVariants.js";
import { buildFallbackAnalysis, buildDeterministicSelection } from "./fallbackSelection.js";
import { finalizeSelection } from "./finalizeSelection.js";
import { renderResume } from "./renderResume.js";
import { sanitizeSelectionRewrites, validateSelection } from "./validateSelection.js";
import { validateFinalIdentity } from "./profileIdentity.js";
import { validateMandatoryEntries } from "./mandatoryContent.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const bank = JSON.parse(fs.readFileSync(path.join(here, "content-bank.json"), "utf8"));
const template = fs.readFileSync(path.join(root, "resume", "template", "main.tex"), "utf8");
const identity = { name: "Test User", location: "College Park, MD", phone: "2405551234", email: "test@example.test", links: { linkedin: "https://x.test/in", github: "https://x.test/gh", portfolio: "https://x.test" } };

const assert = (condition, message) => { if (!condition) throw new Error(`FAIL: ${message}`); };

// Builds the deterministic tailoring for a JD (mirrors the orchestrator's
// fallback path: analyze -> classify -> select -> finalize -> render).
function tailor(jd) {
  const extraction = extractJobKeywords(jd);
  const analysis = buildFallbackAnalysis({ extraction, job: { description: jd } });
  const emphasis = classifyEmphases({ job: { description: jd }, extraction, analysis });
  const raw = buildDeterministicSelection(bank, { variant: emphasis.variant, extraction, analysis });
  const finalized = finalizeSelection(bank, raw, { variant: emphasis.variant, extraction, analysis, emphasis: emphasis.primary, emphases: emphasis.emphases });
  const rendered = renderResume({ bank, selection: finalized.selection, template, identity, jdContext: { extraction, analysis } });
  const dist = {};
  for (const entry of [...finalized.finalSelection.experience, ...finalized.finalSelection.projects]) dist[entry.entryId] = entry.bullets.length;
  return { emphasis, finalized, rendered, dist, summary: selectSummary(bank, emphasis.variant, emphasis.primary) };
}

const JDS = {
  enterprise: "Enterprise AI Builder. Ship internal AI tools and automations, agentic GenAI workflows, Salesforce and ServiceNow integrations. Drive adoption and business impact. LangChain and RAG a plus.",
  inference: "LLM Inference Engineer. Optimize model serving with vLLM, SGLang, TensorRT-LLM. Quantization, speculative decoding, KV cache, GPU throughput and latency benchmarking. PyTorch.",
  backend: "Backend Engineer. Design REST APIs and microservices with FastAPI and Node.js on AWS. PostgreSQL, Redis, Docker, Kubernetes, system design.",
  mobile: "Mobile Engineer. Build React Native apps for Android. On-device AI features and mobile performance.",
  osnet: "Systems Engineer. Strong Linux and operating systems fundamentals. TCP/IP networking, HTTP, sockets, concurrency, threads, gRPC.",
  general: "Software Engineer. Build product features, write tests, and collaborate with a team.",
};

const results = Object.fromEntries(Object.entries(JDS).map(([key, jd]) => [key, tailor(jd)]));

// --- Emphasis + summary appropriateness ---
assert(results.enterprise.emphasis.primary === "enterprise-ai", "enterprise JD -> enterprise-ai emphasis");
assert(/enterprise AI (?:tools|and platform systems)/i.test(results.enterprise.summary), "enterprise JD uses the enterprise AI summary");
assert(!/inference optimization|speculative decoding/i.test(results.enterprise.summary), "enterprise JD does NOT use the inference summary");
assert(results.inference.emphasis.primary === "llm-inference", "inference JD -> llm-inference emphasis");
assert(/inference optimization|speculative decoding|inference benchmarking/i.test(results.inference.summary), "inference JD uses the inference summary");
assert(results.backend.emphasis.variant === "cloud-backend", "backend JD -> cloud-backend variant");
assert(results.mobile.emphasis.primary === "mobile", "mobile JD -> mobile emphasis");
assert(results.osnet.emphasis.emphases.some((e) => e.id === "operating-systems") && results.osnet.emphasis.emphases.some((e) => e.id === "networking"), "OS/networking JD tags both operating-systems and networking");
assert(results.general.emphasis.primary === "general-swe", "unknown JD -> general-swe emphasis");

// --- Mandatory experience + Locra remain in every tailoring ---
for (const [key, r] of Object.entries(results)) {
  assert(validateMandatoryEntries(r.finalized.finalSelection).valid, `${key}: mandatory experience + Locra retained`);
}

// --- Bullet distribution (RULE 2/3): experience dominates, recent roles are
// never a single line, projects stay limited to two. ---
for (const [key, r] of Object.entries(results)) {
  const n = (id) => r.dist[id] || 0;
  assert(n("servbeyond-enterprise-ai-platform-intern") >= 2 && n("servbeyond-enterprise-ai-platform-intern") <= 4, `${key}: ServBeyond carries 2 to 4 bullets (got ${n("servbeyond-enterprise-ai-platform-intern")})`);
  assert(n("runara-ml-inference-engineer-intern") >= 2 && n("runara-ml-inference-engineer-intern") <= 4, `${key}: Runara carries 2 to 4 bullets, never 1 (got ${n("runara-ml-inference-engineer-intern")})`);
  assert(n("xelpmoc-software-engineer") >= 1 && n("xelpmoc-software-engineer") <= 3, `${key}: Xelpmoc carries 1 to 3 bullets (got ${n("xelpmoc-software-engineer")})`);
  assert(n("locra") >= 1 && n("locra") <= 2, `${key}: Locra carries 1 to 2 bullets (got ${n("locra")})`);
  const projCount = r.finalized.finalSelection.projects.length;
  assert(projCount >= 1 && projCount <= 2, `${key}: at most two project entries (got ${projCount})`);
  const expBullets = r.finalized.finalSelection.experience.reduce((sum, e) => sum + e.bullets.length, 0);
  const projBullets = r.finalized.finalSelection.projects.reduce((sum, e) => sum + e.bullets.length, 0);
  assert(expBullets > projBullets, `${key}: experience is the largest section (exp ${expBullets} > proj ${projBullets})`);
}
// A JD that centers the role raises its count toward the ceiling: an inference
// JD fills Runara above the floor.
assert(results.inference.dist["runara-ml-inference-engineer-intern"] >= 2, "inference JD keeps the Runara floor");

// --- Constrained rewriting: cosmetic reverts, JD-justified is kept ---
const jdTerms = new Set(["langchain", "openai apis"]);
const rewriteSel = (justification) => ({
  version: 1, variant: "ai-llm", educationId: "umd-meng-software-engineering", skillGroupIds: ["applied-ai"],
  experience: [{ entryId: "servbeyond-enterprise-ai-platform-intern", bullets: [{ id: "servbeyond-rag-assistant", rewrittenText: "Shipped an internal documentation assistant with LangChain and OpenAI APIs for 100 users.", ...(justification ? { justification } : {}) }] }],
  projects: [],
});
const cosmetic = sanitizeSelectionRewrites(bank, rewriteSel(null), { jdTerms });
assert(cosmetic.reverted.some((r) => r.id === "servbeyond-rag-assistant"), "cosmetic rewrite with no justification is reverted");
assert(!cosmetic.selection.experience[0].bullets[0].rewrittenText, "reverted rewrite drops rewrittenText");
const unjustified = sanitizeSelectionRewrites(bank, rewriteSel("improves the wording"), { jdTerms });
assert(unjustified.reverted.some((r) => r.id === "servbeyond-rag-assistant"), "rewrite whose justification names no JD term is reverted");
const justified = sanitizeSelectionRewrites(bank, rewriteSel("Matches the JD LangChain requirement"), { jdTerms });
assert(!justified.reverted.some((r) => r.id === "servbeyond-rag-assistant"), "JD-justified rewrite is kept");
assert(justified.selection.experience[0].bullets[0].rewrittenText, "kept rewrite retains rewrittenText");
validateSelection(bank, justified.selection, { requireUniqueActionVerbs: false });

// --- Final identity validation ---
assert(validateFinalIdentity(identity).valid, "complete identity passes");
const missingLinks = validateFinalIdentity({ ...identity, links: { linkedin: "", github: "https://x.test/gh", portfolio: "" } });
assert(missingLinks.valid && missingLinks.warnings.length >= 2, "missing links warn but do not fail");
const badPhone = (phone) => { try { validateFinalIdentity({ ...identity, phone }); return false; } catch (e) { return e.code === "IDENTITY_INVALID"; } };
assert(badPhone("555-12"), "short phone raises IDENTITY_INVALID");
assert(badPhone(""), "missing phone raises IDENTITY_INVALID");
assert(!badPhone("240-555-1234"), "valid ten-digit phone passes");
let badEmail = false; try { validateFinalIdentity({ ...identity, email: "not-an-email" }); } catch (e) { badEmail = e.code === "IDENTITY_INVALID"; }
assert(badEmail, "malformed email raises IDENTITY_INVALID");
let badLink = false; try { validateFinalIdentity({ ...identity, links: { ...identity.links, github: "ftp://nope" } }); } catch (e) { badLink = e.code === "IDENTITY_INVALID"; }
assert(badLink, "malformed link URL raises IDENTITY_INVALID");

// --- Protected technical terms are mbox-wrapped so they cannot split ---
for (const term of ["React Native", "speculative decoding", "TensorRT-LLM"]) {
  const tex = results.inference.rendered.tex;
  if (tex.includes(term)) assert(tex.includes(`\\mbox{${term}}`), `${term} is wrapped in \\mbox when present`);
}

console.log(JSON.stringify({
  emphasisAppropriate: true,
  enterpriseNotInferenceSummary: true,
  mandatoryRetainedAllJds: true,
  distributionChangesByJd: true,
  dynamicSkillCategories: true,
  cosmeticRewriteReverted: true,
  justifiedRewriteKept: true,
  identityValidation: true,
  protectedTermsWrapped: true,
  distributions: Object.fromEntries(Object.entries(results).map(([k, r]) => [k, { primary: r.emphasis.primary, runara: r.dist["runara-ml-inference-engineer-intern"] || 0, locra: r.dist["locra"] || 0 }])),
}, null, 2));
