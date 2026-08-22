import { RESUME_VARIANTS, ALLOWED_BLOCKERS } from "./jobAnalysisValidation.js";

// Deterministic JobAnalysis used only when the Haiku call is unavailable.
export function buildFallbackAnalysis({ extraction = null, job = null, variant = null } = {}) {
  const description = String(job?.description || "");
  const technical = (extraction?.keywords || []).filter((keyword) => keyword.category === "technical").map((keyword) => keyword.value || keyword.normalized);
  const responsibilities = (extraction?.keywords || []).filter((keyword) => keyword.category === "responsibility").map((keyword) => keyword.value || keyword.normalized).slice(0, 8);
  const blockers = [];
  if (/\b(u\.?s\.?\s*citizen|citizenship|must be a citizen)\b/i.test(description)) blockers.push("citizenship requirement");
  if (/\b(security clearance|ts\/sci|secret clearance|polygraph)\b/i.test(description)) blockers.push("security-clearance requirement");
  const seniority = /\bintern(ship)?\b/i.test(description) ? "intern" : /\b(senior|staff|principal|lead)\b/i.test(description) ? "senior" : "entry";
  return {
    roleFamily: "software engineering", seniority,
    mustHaveKeywords: [...new Set(technical)].slice(0, 12), niceToHaveKeywords: [], responsibilities,
    blockers: blockers.filter((blocker) => ALLOWED_BLOCKERS.includes(blocker)),
    recommendedVariant: variant && RESUME_VARIANTS.includes(variant) ? variant : "fullstack",
    reasoningSummary: "Deterministic fallback classification from keyword extraction (model analysis unavailable).",
  };
}
