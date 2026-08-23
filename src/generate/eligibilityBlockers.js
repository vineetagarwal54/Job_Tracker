export const ALLOWED_ELIGIBILITY_BLOCKERS = [
  "citizenship requirement",
  "security-clearance requirement",
  "explicit CPT or OPT rejection",
];

const CITIZENSHIP = [
  /\b(?:u\.?s\.?|united states)\s+citizenship\s+(?:is\s+)?required\b/i,
  /\bmust\s+be\s+(?:a\s+)?(?:u\.?s\.?|united states)\s+citizen\b/i,
  /\b(?:u\.?s\.?|united states)\s+citizens?\s+only\b/i,
];
const CLEARANCE = [
  /\b(?:active|current)\s+(?:[a-z/ -]+\s+)?security\s+clearance\s+(?:is\s+)?required\b/i,
  /\bmust\s+(?:hold|have|possess|maintain|obtain)\s+(?:an?\s+)?(?:active\s+)?(?:[a-z/ -]+\s+)?security\s+clearance\b/i,
  /\b(?:security\s+clearance|secret\s+clearance|top\s+secret|ts\/sci)\s+(?:is\s+)?required\b/i,
];
const CPT_OPT = [
  /\b(?:cpt|opt)(?:\s*(?:\/|or|and)\s*(?:cpt|opt))?\s+(?:is\s+|are\s+)?not\s+(?:accepted|eligible|supported|permitted)\b/i,
  /\bno\s+(?:cpt|opt)(?:\s*(?:\/|or|and)\s*(?:cpt|opt))?\b/i,
  /\b(?:cannot|can't|do\s+not)\s+(?:accept|support|consider)\s+(?:candidates?\s+(?:on|using)\s+)?(?:cpt|opt)\b/i,
];

export function detectExplicitEligibilityBlockers(description) {
  const text = String(description || "");
  const found = [];
  if (CITIZENSHIP.some((pattern) => pattern.test(text))) found.push(ALLOWED_ELIGIBILITY_BLOCKERS[0]);
  if (CLEARANCE.some((pattern) => pattern.test(text))) found.push(ALLOWED_ELIGIBILITY_BLOCKERS[1]);
  if (CPT_OPT.some((pattern) => pattern.test(text))) found.push(ALLOWED_ELIGIBILITY_BLOCKERS[2]);
  return found;
}

export function validateEligibilityBlockers(blockers, description) {
  if (!Array.isArray(blockers)) throw new Error("Eligibility blockers must be an array.");
  const detected = detectExplicitEligibilityBlockers(description);
  for (const blocker of blockers) {
    if (!ALLOWED_ELIGIBILITY_BLOCKERS.includes(blocker)) throw new Error(`Unsupported eligibility blocker '${blocker}'.`);
    if (!detected.includes(blocker)) throw new Error(`Eligibility blocker '${blocker}' is not explicit in the job description.`);
  }
  return detected;
}
