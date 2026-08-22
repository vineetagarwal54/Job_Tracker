import canonicalBases from "./canonical-base-resumes.json" with { type: "json" };

export const RESUME_OPTIONS = Object.freeze([
  "AI / LLM",
  "Mobile / React Native",
  "Software Engineer / FullStack / Cloud",
]);

export const RESUME_OPTION_TO_BASE_ID = Object.freeze({
  "AI / LLM": "ai",
  "Mobile / React Native": "mobile",
  "Software Engineer / FullStack / Cloud": "swe-cloud",
});

const LEGACY_OPTION_TO_BASE_ID = Object.freeze({
  "AI/ML": "ai",
  Mobile: "mobile",
  Frontend: "swe-cloud",
  "General/Full-stack": "swe-cloud",
  Academic: "swe-cloud",
  Custom: "swe-cloud",
});

export function resolveBaseResumeId(option) {
  return RESUME_OPTION_TO_BASE_ID[option] || LEGACY_OPTION_TO_BASE_ID[option] || "swe-cloud";
}

export function getCanonicalBaseResume(id) {
  const base = canonicalBases.find((candidate) => candidate.id === id);
  if (!base) throw new Error(`Unknown canonical base resume '${id}'.`);
  return base;
}

export function getCanonicalBaseForOption(option) {
  return getCanonicalBaseResume(resolveBaseResumeId(option));
}

export { canonicalBases };
