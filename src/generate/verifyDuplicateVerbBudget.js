import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { budgetSelection } from "./lineBudget.js";
import { validateSelection } from "./validateSelection.js";
import { messageForResumeError } from "../utils/resumeGeneration.js";

const require = createRequire(import.meta.url);
const { generateResumeSelection } = require("../../electron/anthropic/generateResumeSelection.cjs");
const here = path.dirname(fileURLToPath(import.meta.url));
const bank = JSON.parse(fs.readFileSync(path.join(here, "content-bank.json"), "utf8"));
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const rejects = async (fn, label) => { try { await fn(); } catch { return; } throw new Error(`Accepted ${label}`); };

const selection = {
  version: 1, variant: "ai-llm", educationId: "umd-meng-software-engineering", skillGroupIds: ["llm-inference"],
  experience: [{ entryId: "servbeyond-enterprise-ai-platform-intern", bullets: [{ id: "servbeyond-rag-manual-lookup" }] }],
  projects: [
    { entryId: "reporesearchai-multi-agent-code-analysis", bullets: [{ id: "reporesearchai-agents-rag" }] },
    { entryId: "aws-video-analytics-streaming-platform", bullets: [{ id: "aws-video-analytics-platform" }] },
  ],
};

function selectionFromBudget(source, budget) {
  const next = { version: source.version, variant: source.variant, educationId: source.educationId, skillGroupIds: source.skillGroupIds, experience: [], projects: [] };
  for (const entry of budget.included) next[entry.section].push({ entryId: entry.entry.id, bullets: entry.bullets.map(({ bullet, text }) => text === bullet.text ? { id: bullet.id } : { id: bullet.id, rewrittenText: text }) });
  return next;
}

const resolved = validateSelection(bank, selection, { requireUniqueActionVerbs: false });
const budget = budgetSelection(resolved);
const includedIds = budget.included.flatMap((entry) => entry.bullets.map((item) => item.bullet.id));
const duplicate = budget.excluded.find((item) => item.id === "reporesearchai-agents-rag");
assert(includedIds[0] === "servbeyond-rag-manual-lookup", "First ranked Built bullet was not kept");
assert(!includedIds.includes("reporesearchai-agents-rag"), "Second Built bullet was not excluded");
assert(includedIds.includes("aws-video-analytics-platform"), "Lower-ranked bullet with a different verb was not considered");
assert(duplicate?.reason === "duplicate action verb: built", "Duplicate-verb exclusion reason is missing or incorrect");
validateSelection(bank, selectionFromBudget(selection, budget), { requireUniqueActionVerbs: true });

await rejects(() => validateSelection(bank, { ...selection, experience: [{ entryId: "servbeyond-enterprise-ai-platform-intern", bullets: [{ id: "servbeyond-agentic-workflows", rewrittenText: "Designed 999 enterprise workflows." }] }], projects: [] }), "invented-number rewrite");
await rejects(() => validateSelection(bank, { ...selection, experience: [{ entryId: "servbeyond-enterprise-ai-platform-intern", bullets: [{ id: "servbeyond-rag-manual-lookup", rewrittenText: "Built and shipped a RAG assistant over internal documentation using LangChain and OpenAI APIs, cutting 25 hours of manual lookup per week across 100 users." }] }], projects: [] }), "locked-metric removal");
await rejects(() => validateSelection(bank, { ...selection, experience: [{ entryId: "runara-ml-inference-engineer-intern", bullets: [{ id: "runara-speculative-decoding", rewrittenText: "Changed verified source text." }] }], projects: [] }), "non-rewritable change");
await rejects(() => validateSelection(bank, { ...selection, experience: [{ entryId: "servbeyond-enterprise-ai-platform-intern", bullets: [{ id: "missing-bullet" }] }], projects: [] }), "unknown bullet ID");
await rejects(() => validateSelection(bank, { ...selection, experience: [{ entryId: "servbeyond-enterprise-ai-platform-intern", bullets: [{ id: "servbeyond-rag-manual-lookup" }, { id: "servbeyond-rag-manual-lookup" }] }], projects: [] }), "duplicate bullet ID");

const crossVariant = { ...selection, variant: "cloud-backend", skillGroupIds: ["cloud-devops"], experience: [{ entryId: "servbeyond-enterprise-ai-platform-intern", bullets: [{ id: "servbeyond-rag-manual-lookup" }] }], projects: [] };
await rejects(() => generateResumeSelection({ client: { request: async () => ({ text: JSON.stringify(crossVariant), usage: null }) }, apiKey: "fake", bank, job: {}, analysis: {}, extraction: {}, coverage: {}, variant: "cloud-backend", generateDir: here }), "cross-variant selection");

const validCloudSelection = { ...crossVariant, experience: [{ entryId: "servbeyond-enterprise-ai-platform-intern", bullets: [{ id: "servbeyond-agentic-workflows" }] }] };
let requestSchema;
let requestMaxTokens;
let requestTimeoutMs;
await generateResumeSelection({ client: { request: async ({ body, timeoutMs }) => { requestSchema = body.output_config.format.schema; requestMaxTokens = body.max_tokens; requestTimeoutMs = timeoutMs; return { text: JSON.stringify(validCloudSelection), usage: null, stopReason: "end_turn" }; } }, apiKey: "fake", bank, job: {}, analysis: {}, extraction: {}, coverage: {}, variant: "cloud-backend", generateDir: here });
const allowedIds = requestSchema.properties.experience.items.properties.bullets.items.properties.id.enum;
assert(requestSchema.properties.variant.enum.length === 1 && requestSchema.properties.variant.enum[0] === "cloud-backend", "Output schema does not lock the selected variant");
assert(allowedIds.includes("servbeyond-agentic-workflows") && !allowedIds.includes("servbeyond-rag-manual-lookup"), "Output schema does not constrain bullet IDs to the selected variant");
assert(requestMaxTokens >= 10000, "Resume selection output ceiling is too low for the requested ranked bullets");
assert(requestTimeoutMs === 240000, "Resume selection timeout is too short for schema compilation and streaming");

const casedCloudSelection = { ...validCloudSelection, variant: "Cloud-Backend", educationId: "UMD-MENG-SOFTWARE-ENGINEERING", skillGroupIds: ["Cloud-Devops"], experience: [{ entryId: "Servbeyond-Enterprise-Ai-Platform-Intern", bullets: [{ id: "Servbeyond-Agentic-Workflows" }] }] };
const canonicalized = await generateResumeSelection({ client: { request: async () => ({ text: JSON.stringify(casedCloudSelection), usage: null }) }, apiKey: "fake", bank, job: {}, analysis: {}, extraction: {}, coverage: {}, variant: "cloud-backend", generateDir: here });
assert(canonicalized.finalSelection.variant === "cloud-backend" && canonicalized.finalSelection.experience[0].bullets[0].id === "servbeyond-agentic-workflows", "Schema enum casing was not canonicalized to bank IDs");

const safeReason = "Resume validation failed: rewrite introduced number '999'.";
assert(messageForResumeError({ code: "VALIDATION_FAILED", message: safeReason }) === safeReason, "Safe validation reason did not reach renderer message handling");
console.log(JSON.stringify({ firstDuplicateVerbWins: true, duplicateVerbExcluded: true, lowerRankedUniqueVerbIncluded: true, finalVerbValidation: true, rewriteProtections: true, crossVariantRejected: true, variantConstrainedSchema: true, enumCasingCanonicalized: true, outputCeilingRaised: true, resumeTimeoutConfigured: true, unknownAndDuplicateIdsRejected: true, safeValidationMessage: true }, null, 2));
