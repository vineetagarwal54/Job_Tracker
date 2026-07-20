export const RESUME_VARIANTS = ["ai-llm", "cloud-backend", "fullstack", "mobile", "academic"];
export const ALLOWED_BLOCKERS = ["citizenship requirement", "security-clearance requirement", "explicit CPT or OPT rejection"];
const FIELDS = ["roleFamily", "seniority", "mustHaveKeywords", "niceToHaveKeywords", "responsibilities", "blockers", "recommendedVariant", "reasoningSummary"];

export function validateJobAnalysis(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Job analysis must be an object.");
  for (const field of Object.keys(value)) if (!FIELDS.includes(field)) throw new Error(`Job analysis contains unknown field '${field}'.`);
  for (const field of FIELDS) if (!Object.hasOwn(value, field)) throw new Error(`Job analysis is missing '${field}'.`);
  for (const field of ["roleFamily", "seniority", "reasoningSummary"]) if (typeof value[field] !== "string") throw new Error(`Job analysis '${field}' must be a string.`);
  for (const field of ["mustHaveKeywords", "niceToHaveKeywords", "responsibilities", "blockers"]) if (!Array.isArray(value[field]) || !value[field].every((item) => typeof item === "string")) throw new Error(`Job analysis '${field}' must be a string array.`);
  if (!RESUME_VARIANTS.includes(value.recommendedVariant)) throw new Error("Job analysis recommended an invalid variant.");
  const blockers = value.blockers.map((blocker) => {
    const canonical = ALLOWED_BLOCKERS.find((allowed) => allowed.toLowerCase() === blocker.trim().toLowerCase());
    if (!canonical) throw new Error(`Job analysis contains unsupported blocker '${blocker}'.`);
    return canonical;
  });
  if (Object.values(value).some((item) => typeof item === "number")) throw new Error("Job analysis must not contain a numeric score.");
  return { ...value, blockers };
}

export const JOB_ANALYSIS_SCHEMA = { type: "object", additionalProperties: false, properties: {
  roleFamily: { type: "string" }, seniority: { type: "string" }, mustHaveKeywords: { type: "array", items: { type: "string" } }, niceToHaveKeywords: { type: "array", items: { type: "string" } }, responsibilities: { type: "array", items: { type: "string" } }, blockers: { type: "array", items: { type: "string", enum: ALLOWED_BLOCKERS } }, recommendedVariant: { type: "string", enum: RESUME_VARIANTS }, reasoningSummary: { type: "string" },
}, required: FIELDS };
