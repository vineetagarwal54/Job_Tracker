import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { ALLOWED_BLOCKERS, JOB_ANALYSIS_SCHEMA, validateJobAnalysis } from "./jobAnalysisValidation.js";

const require = createRequire(import.meta.url);
const { analyzeJob } = require("../../electron/anthropic/analyzeJob.cjs");
const here = path.dirname(fileURLToPath(import.meta.url));
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const rejects = async (fn, label) => { try { await fn(); } catch { return; } throw new Error(`Accepted ${label}`); };
const base = { roleFamily: "software engineering", seniority: "intern", mustHaveKeywords: [], niceToHaveKeywords: [], responsibilities: [], blockers: [], recommendedVariant: "fullstack", reasoningSummary: "Verified role classification." };

const enrollmentQualification = validateJobAnalysis({ ...base, mustHaveKeywords: ["currently enrolled in an undergraduate or graduate program"] });
assert(enrollmentQualification.blockers.length === 0, "Enrollment qualification was converted to a blocker");
await rejects(() => validateJobAnalysis({ ...base, blockers: ["currently enrolled in an undergraduate or graduate program"] }), "unsupported enrollment blocker");
await rejects(() => validateJobAnalysis({ ...base, blockers: ["no sponsorship available"] }), "generic sponsorship blocker");
for (const blocker of ALLOWED_BLOCKERS) validateJobAnalysis({ ...base, blockers: [blocker] });
assert(validateJobAnalysis({ ...base, blockers: ["Security-Clearance Requirement"] }).blockers[0] === "security-clearance requirement", "Allowed blocker casing was not canonicalized");

const schemaBlockers = JOB_ANALYSIS_SCHEMA.properties.blockers.items.enum;
assert(JSON.stringify(schemaBlockers) === JSON.stringify(ALLOWED_BLOCKERS), "Analysis schema and blocker validator are out of sync");
let requestSchema;
let requestTimeoutMs;
const analyzed = await analyzeJob({
  client: { request: async ({ body, timeoutMs }) => { requestSchema = body.output_config.format.schema; requestTimeoutMs = timeoutMs; return { content: [{ type: "text", text: JSON.stringify(enrollmentQualification) }], usage: {} }; } },
  apiKey: "fake",
  job: { company: "Example", title: "Software Intern", description: "Applicants must currently be enrolled in an undergraduate or graduate program." },
  generateDir: here,
});
assert(analyzed.analysis.blockers.length === 0, "Enrollment requirement became a blocker during analysis");
assert(JSON.stringify(requestSchema.properties.blockers.items.enum) === JSON.stringify(ALLOWED_BLOCKERS), "Live analysis request did not use constrained blockers");
assert(requestTimeoutMs === 120000, "Job analysis timeout is too short");

console.log(JSON.stringify({ enrollmentIsQualification: true, unsupportedBlockerRejected: true, sponsorshipNotBlocker: true, allowedBlockersValidated: true, blockerCasingCanonicalized: true, blockerSchemaConstrained: true, analysisTimeoutConfigured: true }, null, 2));
