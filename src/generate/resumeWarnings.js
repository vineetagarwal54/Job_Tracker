// Deterministic eligibility / mismatch warnings (task Part 1).
//
// Eligibility and profile mismatches must WARN, never block generation. This
// module turns the JD text, the (possibly fallback) analysis, and the final
// coverage into a plain list of human-readable warnings surfaced next to the
// finished resume. Pure and deterministic: no API calls, no model text.

const PATTERNS = {
  sponsorship: /\b(no|not|without|unable to|cannot|will not|do not|does not|won'?t)\b[^.\n]{0,40}\bsponsor(ship)?\b|\bsponsorship\s+(is\s+)?not\b|\bno\s+visa\b/i,
  citizenship: /\b(u\.?s\.?\s*citizen(ship)?|must be a citizen|green card|permanent resident|citizens? only)\b/i,
  clearance: /\b(security clearance|active clearance|ts\/sci|secret clearance|polygraph|clearable)\b/i,
  undergraduateOnly: /\b(undergraduate (students? )?only|bachelor'?s students? only|currently (enrolled|pursuing)[^.\n]{0,40}\b(bachelor|undergraduate)\b|rising (junior|senior|sophomore)|pursuing a bachelor)\b/i,
  graduateAlternative: /\bbachelor'?s?\b[^.\n]{0,40}\b(?:or|and\/?or)\b[^.\n]{0,40}\bmaster'?s?\b|\bmaster'?s?\b[^.\n]{0,40}\b(?:or|and\/?or)\b[^.\n]{0,40}\bbachelor'?s?\b/i,
  graduateOnly: /\b(ph\.?d\b|doctoral|master'?s (degree )?(is )?required|graduate students? only|must have a master)\b/i,
};

const KNOWN_ROLE_FAMILIES = [
  "ai", "ml", "machine learning", "llm", "software", "backend", "frontend",
  "full stack", "fullstack", "mobile", "cloud", "platform", "data", "devops",
  "infrastructure", "engineer", "developer",
];

const values = (items) => (items || []).map((item) => item?.value || item?.normalized || item).filter(Boolean);

function push(list, type, severity, message) {
  if (message) list.push({ type, severity, message });
}

// Builds the warning list. All inputs are optional so a partial pipeline
// (e.g. analysis fallback before coverage exists) can still produce warnings.
export function buildResumeWarnings({
  job = null,
  analysis = null,
  coverage = null,
  missingSkills = [],
  usedAnalysisFallback = false,
  usedSelectionFallback = false,
  requestedVariant = null,
  renderedVariant = null,
} = {}) {
  const warnings = [];
  const description = String(job?.description || "");
  const blockers = new Set((analysis?.blockers || []).map((blocker) => String(blocker).toLowerCase()));

  if (blockers.has("citizenship requirement") || PATTERNS.citizenship.test(description)) {
    push(warnings, "citizenship", "warning",
      "This role appears to require US citizenship or permanent residency. The resume was still generated; confirm you meet the requirement before applying.");
  }
  if (blockers.has("security-clearance requirement") || PATTERNS.clearance.test(description)) {
    push(warnings, "clearance", "warning",
      "This role appears to require a security clearance. The resume was still generated; confirm eligibility before applying.");
  }
  if (PATTERNS.sponsorship.test(description)) {
    push(warnings, "sponsorship", "info",
      "This posting mentions visa sponsorship restrictions. Generation was not blocked; verify this against your work authorization.");
  }
  if (PATTERNS.undergraduateOnly.test(description) && !PATTERNS.graduateAlternative.test(description) && !PATTERNS.graduateOnly.test(description)) {
    push(warnings, "education-level", "warning",
      "This posting reads as undergraduate-only. Your profile is a graduate student, so this may be a mismatch. The resume was still generated.");
  }
  if (PATTERNS.graduateOnly.test(description)) {
    push(warnings, "education-level", "info",
      "This posting emphasizes graduate or doctoral qualifications. Confirm your degree level matches.");
  }

  if (analysis?.roleFamily) {
    const family = String(analysis.roleFamily).toLowerCase();
    const known = KNOWN_ROLE_FAMILIES.some((token) => family.includes(token));
    if (!known) {
      push(warnings, "role-family", "info",
        `The role family "${analysis.roleFamily}" is unusual for this profile. The closest verified emphasis was used.`);
    }
  }

  const missingRequired = values(coverage?.mustHave?.missing);
  if (missingRequired.length) {
    push(warnings, "missing-required-skills", "warning",
      `The job lists required skills not present on your resume: ${missingRequired.join(", ")}. These were not invented onto the resume.`);
  }
  const missingPreferred = values(coverage?.niceToHave?.missing);
  if (missingPreferred.length) {
    push(warnings, "missing-preferred-skills", "info",
      `Preferred skills not present on your resume: ${missingPreferred.join(", ")}.`);
  }
  const otherMissing = (missingSkills || []).filter(
    (skill) => !missingRequired.includes(skill) && !missingPreferred.includes(skill)
  );
  if (otherMissing.length) {
    push(warnings, "missing-skills", "info",
      `Other skills mentioned in the job description that are not on your resume: ${otherMissing.join(", ")}.`);
  }

  if (usedAnalysisFallback) {
    push(warnings, "analysis-fallback", "info",
      "Job analysis could not be completed by the model, so a deterministic classification was used.");
  }
  if (usedSelectionFallback) {
    push(warnings, "selection-fallback", "info",
      "The semantic optimizer was unavailable, so the selected canonical base was kept unchanged.");
  }
  if (requestedVariant && renderedVariant && requestedVariant !== renderedVariant) {
    push(warnings, "variant-mismatch", "info",
      `The job did not map cleanly to a resume variant; the closest emphasis "${renderedVariant}" was used.`);
  }

  return warnings;
}
