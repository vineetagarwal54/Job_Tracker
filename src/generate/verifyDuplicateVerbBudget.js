import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { budgetSelection } from "./lineBudget.js";
import { validateSelection } from "./validateSelection.js";
import { messageForResumeError } from "../utils/resumeGeneration.js";
import { getCanonicalBaseResume, canonicalBases } from "./baseResumes.js";

const require = createRequire(import.meta.url);
const { generateResumeSelection, tailoringDiffSchema } = require("../../electron/anthropic/generateResumeSelection.cjs");
const here = path.dirname(fileURLToPath(import.meta.url));
const bank = JSON.parse(fs.readFileSync(path.join(here, "content-bank.json"), "utf8"));
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const rejects = async (fn, label) => { try { await fn(); } catch { return; } throw new Error(`Accepted ${label}`); };

const selection = {
  version: 1, variant: "ai-llm", educationId: "umd-meng-software-engineering", skillGroupIds: ["llm-inference"],
  experience: [{ entryId: "servbeyond-enterprise-ai-platform-intern", bullets: [{ id: "servbeyond-rag-assistant" }] }],
  projects: [
    { entryId: "repo-research-ai", bullets: [{ id: "repo-research-agents" }] },
    { entryId: "serverless-video-analytics", bullets: [{ id: "video-analytics-core" }] },
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
const duplicate = budget.excluded.find((item) => item.id === "repo-research-agents");
assert(includedIds[0] === "servbeyond-rag-assistant", "First ranked Built bullet was not kept");
assert(!includedIds.includes("repo-research-agents"), "Second Built bullet was not excluded");
assert(includedIds.includes("video-analytics-core"), "Lower-ranked bullet with a different verb was not considered");
assert(duplicate?.reason === "duplicate action verb: built", "Duplicate-verb exclusion reason is missing or incorrect");
validateSelection(bank, selectionFromBudget(selection, budget), { requireUniqueActionVerbs: true });

await rejects(() => validateSelection(bank, { ...selection, experience: [{ entryId: "servbeyond-enterprise-ai-platform-intern", bullets: [{ id: "servbeyond-agentic-workflows", rewrittenText: "Designed 999 enterprise workflows." }] }], projects: [] }), "invented-number rewrite");
await rejects(() => validateSelection(bank, { ...selection, experience: [{ entryId: "servbeyond-enterprise-ai-platform-intern", bullets: [{ id: "servbeyond-proposal-assistant", rewrittenText: "Shipped a multi-agent RAG proposal assistant for business development staff." }] }], projects: [] }), "locked-metric removal");
await rejects(() => validateSelection(bank, { ...selection, experience: [{ entryId: "servbeyond-enterprise-ai-platform-intern", bullets: [{ id: "missing-bullet" }] }], projects: [] }), "unknown bullet ID");
await rejects(() => validateSelection(bank, { ...selection, experience: [{ entryId: "servbeyond-enterprise-ai-platform-intern", bullets: [{ id: "servbeyond-rag-assistant" }, { id: "servbeyond-rag-assistant" }] }], projects: [] }), "duplicate bullet ID");

const base = getCanonicalBaseResume("swe-cloud");
const diff = { version: 1, baseResumeId: base.id, bulletChanges: [], skillChanges: [] };
let requestSchema;
let requestMaxTokens;
let requestTimeoutMs;
const generatedDiff = await generateResumeSelection({ client: { request: async ({ body, timeoutMs }) => { requestSchema = body.output_config.format.schema; requestMaxTokens = body.max_tokens; requestTimeoutMs = timeoutMs; return { text: JSON.stringify(diff), usage: null, stopReason: "end_turn" }; } }, apiKey: "fake", bank, canonicalBases, base, job: {}, analysis: {}, extraction: {}, coverage: {}, generateDir: here });
assert(requestSchema.properties.baseResumeId.enum[0] === "swe-cloud", "Diff schema does not lock the selected canonical base");
assert(requestSchema.properties.bulletChanges.maxItems === 3 && requestSchema.properties.skillChanges.maxItems === 4, "Diff schema does not enforce tailoring caps");
assert(requestMaxTokens === 5000, "Tailoring diff output ceiling is not bounded");
assert(requestTimeoutMs === 240000, "Resume selection timeout is too short for schema compilation and streaming");
assert(generatedDiff.acceptedDiff.bulletChanges.length === 0 && generatedDiff.base.id === "swe-cloud", "Zero-change diff did not preserve the selected base");
assert(tailoringDiffSchema(bank, base).additionalProperties === false, "Tailoring schema permits structural fields");

const safeReason = "Resume validation failed: rewrite introduced number '999'.";
assert(messageForResumeError({ code: "VALIDATION_FAILED", message: safeReason }) === safeReason, "Safe validation reason did not reach renderer message handling");
console.log(JSON.stringify({ firstDuplicateVerbWins: true, duplicateVerbExcluded: true, lowerRankedUniqueVerbIncluded: true, finalVerbValidation: true, rewriteProtections: true, canonicalBaseLocked: true, diffCapsInSchema: true, boundedOutput: true, resumeTimeoutConfigured: true, unknownAndDuplicateIdsRejected: true, safeValidationMessage: true }, null, 2));
