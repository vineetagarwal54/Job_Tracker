import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { getCanonicalBaseResume } from "./baseResumes.js";
import { tailoredBaseEvidenceSelection } from "./tailoringDiff.js";
import { validateResumeEvidenceSelection, rewriteViolation } from "./resumeEvidenceValidation.js";
import { messageForResumeError } from "../utils/resumeGeneration.js";

const require = createRequire(import.meta.url);
const { generateResumeSelection, tailoringDiffSchema } = require("../../electron/anthropic/generateResumeSelection.cjs");
const here = path.dirname(fileURLToPath(import.meta.url));
const bank = JSON.parse(fs.readFileSync(path.join(here, "content-bank.json"), "utf8"));
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const base = getCanonicalBaseResume("swe-cloud");
const selection = tailoredBaseEvidenceSelection(bank, base);
const verified = validateResumeEvidenceSelection(bank, selection);
assert(verified.rankedBullets.length === [...base.experience, ...base.projects].reduce((sum, entry) => sum + entry.bullets.length, 0), "Final canonical evidence selection lost bullets");
const measured = bank.experience.flatMap((entry) => entry.bullets).find((bullet) => bullet.id === "xelpmoc-sql-redis");
assert(rewriteViolation(measured, "Reduced API response time to 999 seconds."), "Invented rewrite metric was accepted");
let unknownRejected = false;
try { validateResumeEvidenceSelection(bank, { ...selection, experience: [{ entryId: "missing", bullets: [{ id: "missing" }] }] }); } catch { unknownRejected = true; }
assert(unknownRejected, "Unknown final-resume evidence was accepted");

const diff = { version: 1, baseResumeId: base.id, bulletChanges: [], skillChanges: [] };
let requestSchema; let requestMaxTokens; let requestTimeoutMs;
const generated = await generateResumeSelection({ client: { request: async ({ body, timeoutMs }) => { requestSchema = body.output_config.format.schema; requestMaxTokens = body.max_tokens; requestTimeoutMs = timeoutMs; return { text: JSON.stringify(diff), usage: null, stopReason: "end_turn" }; } }, apiKey: "fake", bank, base, job: {}, analysis: {}, extraction: {}, coverage: {}, generateDir: here });
assert(requestSchema.properties.baseResumeId.enum[0] === "swe-cloud", "Tailoring schema does not lock the selected base");
assert(requestSchema.properties.bulletChanges.maxItems === 3 && requestSchema.properties.skillChanges.maxItems === 4, "Tailoring caps are absent from the schema");
assert(requestMaxTokens === 5000 && requestTimeoutMs === 240000, "Tailoring request bounds changed unexpectedly");
assert(generated.acceptedDiff.bulletChanges.length === 0 && generated.base.id === "swe-cloud", "Zero-change diff did not preserve the canonical base");
assert(tailoringDiffSchema(bank, base).additionalProperties === false, "Tailoring schema permits structural fields");
const safeReason = "Canonical base validation failed.";
assert(messageForResumeError({ code: "VALIDATION_FAILED", message: safeReason }) === safeReason, "Safe validation reason was hidden");
console.log(JSON.stringify({ finalEvidenceValidated: true, rewriteMetricsProtected: true, unknownEvidenceRejected: true, canonicalBaseLocked: true, tailoringCaps: true, requestBounds: true, safeErrors: true }, null, 2));
