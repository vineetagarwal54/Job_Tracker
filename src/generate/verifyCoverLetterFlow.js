import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { getCanonicalBaseResume } from "./baseResumes.js";
import { tailoredBaseEvidenceSelection } from "./tailoringDiff.js";
import { buildConservativeCoverLetter, buildCoverLetterEvidence, validateEvidenceClaims } from "./coverLetterEvidence.js";
import { validateCoverLetter } from "./coverLetterValidation.js";

const require = createRequire(import.meta.url);
const { generateCoverLetter } = require("../../electron/anthropic/generateCoverLetter.cjs");
const here = path.dirname(fileURLToPath(import.meta.url));
const bank = JSON.parse(fs.readFileSync(path.join(here, "content-bank.json"), "utf8"));
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const analysis = (variant, mustHaveKeywords = []) => ({ roleFamily: variant, seniority: "entry", mustHaveKeywords, niceToHaveKeywords: [], responsibilities: [], blockers: [], recommendedVariant: variant, reasoningSummary: "Verified deterministic test analysis." });
const jobFor = (title, description) => ({ company: "Acme", title, description });
const selectionFor = (baseId) => tailoredBaseEvidenceSelection(bank, getCanonicalBaseResume(baseId));
const v2Context = (evidenceIds) => ({
  requirements: [{ id: "req-focus", text: "Verified role requirement", priority: "must", kind: "experience", status: "covered", currentEvidenceIds: evidenceIds, candidateEvidenceIds: [], knowledgeSkillIds: [], reason: "Verified final evidence." }],
  finalCoverage: { requirements: [{ id: "req-focus", text: "Verified role requirement", priority: "must", kind: "experience", optimizerStatus: "covered", covered: true, survivingEvidenceIds: evidenceIds, reason: "Verified final evidence." }] },
});
const bundleFor = (baseId, evidenceIds) => buildCoverLetterEvidence({ bank, selection: selectionFor(baseId), ...v2Context(evidenceIds) });
const textOf = (content) => [content.opening, ...content.bodyParagraphs, content.closing].join(" ");

const cases = [
  { id: "ai", variant: "ai-llm", title: "AI Engineer", jd: "Build RAG and LLM inference systems in Python with multi-agent workflows.", must: ["rag", "llm", "inference"], expected: ["runara-speculative-decoding", "servbeyond-proposal-assistant"] },
  { id: "swe-cloud", variant: "cloud-backend", title: "Backend Engineer", jd: "Build backend cloud services using AWS, Kubernetes, FastAPI, PostgreSQL, and REST APIs.", must: ["aws", "kubernetes", "fastapi"], expected: ["servbeyond-platform-integrations", "servbeyond-intake-automation"] },
  { id: "mobile", variant: "mobile", title: "Mobile Engineer", jd: "Develop React Native mobile applications using TypeScript, WebRTC, and performance profiling.", must: ["react native", "webrtc", "typescript"], expected: ["locra-core", "svipes-screens"] },
];

for (const item of cases) {
  const job = jobFor(item.title, item.jd);
  const bundle = bundleFor(item.id, item.expected);
  assert(item.expected.every((id) => bundle.evidence.some((evidence) => evidence.id === id)), `${item.id}: strongest final-resume evidence was not selected`);
  const fallback = buildConservativeCoverLetter({ job, evidenceBundle: bundle });
  const validated = validateCoverLetter(fallback, bank, { jobDescription: job.description, evidenceText: bundle.allEvidence.map((entry) => entry.text).join(" ") });
  validateEvidenceClaims(validated, bundle, { job, bank });
  assert(validated.wordCount >= 180 && validated.wordCount <= 310 && validated.claimEvidence.length <= 3, `${item.id}: cover letter is not concise`);
}

const normalJob = jobFor(cases[1].title, cases[1].jd);
const normalAnalysis = analysis("cloud-backend", cases[1].must);
const normalSelection = selectionFor("swe-cloud");
const normalContext = v2Context(["servbeyond-platform-integrations", "servbeyond-intake-automation", "xelpmoc-sql-redis"]);
const normalBundle = buildCoverLetterEvidence({ bank, selection: normalSelection, ...normalContext });
const cloudBase = getCanonicalBaseResume("swe-cloud");
const canonicalCloudText = cloudBase.experience.find((entry) => entry.entryId === "xelpmoc-software-engineer").bullets.find((bullet) => bullet.sourceBulletId === "xelpmoc-sql-redis").text;
assert(normalBundle.allEvidence.find((item) => item.id === "xelpmoc-sql-redis")?.text === canonicalCloudText, "Cover-letter evidence did not preserve final canonical/tailored resume wording");
const validModelContent = buildConservativeCoverLetter({ job: normalJob, evidenceBundle: normalBundle });
let calls = 0;
let schemaIds = [];
const normal = await generateCoverLetter({
  client: { request: async ({ body }) => { calls += 1; schemaIds = body.output_config.format.schema.properties.claimEvidence.items.properties.evidenceIds.items.enum; return { text: JSON.stringify(validModelContent), stopReason: "end_turn", usage: { input_tokens: 100, output_tokens: 200 } }; } },
  apiKey: "fake", bank, job: normalJob, selection: normalSelection, ...normalContext, generateDir: here,
});
assert(calls === 1 && normal.modelCalls === 1 && normal.usedFallback === false, "Normal cover letter did not use exactly one model call");
assert(schemaIds.length <= 3 && schemaIds.every((id) => normal.evidence.some((entry) => entry.id === id)), "Model schema was not restricted to strongest final-resume evidence");
assert(normal.usage.input_tokens === 100 && normal.usage.output_tokens === 200, "Single-call usage metadata is inaccurate");

async function invalidModelFallsBack(mutator) {
  const unsafe = mutator(JSON.parse(JSON.stringify(validModelContent)));
  let requestCount = 0;
  const result = await generateCoverLetter({ client: { request: async () => { requestCount += 1; return { text: JSON.stringify(unsafe), stopReason: "end_turn", usage: { input_tokens: 10, output_tokens: 20 } }; } }, apiKey: "fake", bank, job: normalJob, selection: normalSelection, ...normalContext, generateDir: here });
  assert(requestCount === 1 && result.usedFallback, "Invalid model content did not use one-call deterministic fallback");
  return result;
}

const unsupported = await invalidModelFallsBack((content) => {
  const sentence = "I built Rust distributed systems and shipped them to production customers.";
  content.bodyParagraphs[0] = `${sentence} ${content.bodyParagraphs[0]}`;
  content.claimEvidence.push({ sentence, evidenceIds: [normalBundle.evidence[0].id] });
  return content;
});
assert(!/I built Rust/i.test(textOf(unsupported.content)), "Unsupported JD skill was claimed by the fallback");
assert(unsupported.diagnostics?.fallbackType === "evidence-validation failure" && unsupported.diagnostics?.usage?.input_tokens === 10 && unsupported.diagnostics?.evidenceIds?.length, "Post-response cover-letter validation diagnostics lost provider usage or evidence IDs");

const metric = await invalidModelFallsBack((content) => {
  const claim = content.claimEvidence.find((item) => /\d/.test(item.sentence));
  if (claim) {
    const changed = claim.sentence.replace(/\b\d+(?:\.\d+)?(?:%|[A-Za-z]+)?\b/, "999");
    content.bodyParagraphs = content.bodyParagraphs.map((paragraph) => paragraph.replace(claim.sentence, changed));
    claim.sentence = changed;
  } else content.opening = `Delivered 999 systems. ${content.opening}`;
  return content;
});
assert(!/\b999\b/.test(textOf(metric.content)), "Invented metric survived deterministic fallback");
for (const claim of metric.content.claimEvidence) {
  const source = normalBundle.allEvidence.filter((item) => claim.evidenceIds.includes(item.id)).map((item) => item.text).join(" ");
  for (const number of claim.sentence.match(/\b\d+(?:\.\d+)?(?:%|[A-Za-z]+)?\b/g) || []) assert(source.includes(number), `Metric '${number}' was not preserved exactly`);
}

const company = await invalidModelFallsBack((content) => {
  content.opening = `${content.opening} Acme is a global robotics leader with an innovative culture.`;
  return content;
});
assert(!/global robotics leader|innovative culture/i.test(textOf(company.content)), "Unsupported company fact survived deterministic fallback");

let failureCalls = 0;
const failedModel = await generateCoverLetter({ client: { request: async () => { failureCalls += 1; throw new Error("simulated model outage"); } }, apiKey: "fake", bank, job: normalJob, selection: normalSelection, ...normalContext, generateDir: here });
assert(failureCalls === 1 && failedModel.usedFallback && failedModel.content.wordCount >= 180, "Model failure did not produce a conservative one-call fallback");
assert(failedModel.diagnostics?.fallbackType === "request failure" && failedModel.diagnostics?.reason.includes("simulated model outage"), "Model failure diagnostic was not preserved");

const localResume = "Built production Python APIs for customer workflows and documented each release.\nReduced processing latency by 35% through verified caching and query optimization.\nShipped a cross-platform mobile application with React Native and TypeScript.";
const independent = await generateCoverLetter({ client: { request: async () => { throw new Error("offline"); } }, apiKey: "fake", bank, job: jobFor("Software Engineer", "Build Python APIs and mobile products."), selection: null, resumeText: localResume, generateDir: here });
assert(independent.usedFallback && independent.evidence.every((item) => item.id.startsWith("local-resume-")) && textOf(independent.content).includes("35%"), "Independent local-resume cover-letter fallback failed");

console.log(JSON.stringify({ normalTailoredResume: true, aiMatch: true, backendCloudMatch: true, mobileMatch: true, unsupportedNotClaimed: true, metricsExact: true, companyFactsJdOnly: true, independentGeneration: true, modelFailureFallback: true, singleModelCall: true }, null, 2));
