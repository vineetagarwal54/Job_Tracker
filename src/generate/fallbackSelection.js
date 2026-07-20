// Universal deterministic fallback (task Part 1).
//
// When the model call or its validation fails, the app must still ship the
// strongest TRUTHFUL resume the verified bank can produce rather than error
// out. Everything here is pure, verified-bank-only selection: it never invents
// content, never rewrites a bullet, and always returns a selection that passes
// the same downstream validation, budgeting, and mandatory-floor checks as a
// model selection.

import { textContainsTerm, canonicalizeTerm } from "./protectedTerms.js";
import { RESUME_VARIANTS, ALLOWED_BLOCKERS } from "./jobAnalysisValidation.js";

// General software-engineering fallback order: the broadest variant first so an
// unclassifiable JD still gets a coherent resume.
const GENERAL_VARIANT_ORDER = ["fullstack", "cloud-backend", "ai-llm", "mobile"];
const ACADEMIC_SIGNAL = /\b(research|ph\.?d|doctoral|publication|academia|laboratory|professor)\b/i;

function jdTermSet({ extraction, analysis }) {
  const terms = new Set();
  for (const keyword of extraction?.keywords || []) {
    const normalized = keyword.normalized || canonicalizeTerm(keyword.value);
    if (normalized) terms.add(normalized);
  }
  for (const list of [analysis?.mustHaveKeywords, analysis?.niceToHaveKeywords]) {
    for (const term of list || []) {
      const normalized = canonicalizeTerm(term);
      if (normalized) terms.add(normalized);
    }
  }
  return terms;
}

// How well a bullet matches the JD: count of its verified skills/text that the
// JD references. Alias-aware and token-exact (no "java" inside "javascript").
function bulletMatchScore(bullet, jdTerms) {
  let score = 0;
  const haystack = `${bullet.text} ${(bullet.skills || []).join(" ")}`;
  for (const term of jdTerms) {
    if (textContainsTerm(haystack, term)) score += 1;
  }
  return score;
}

// Picks the closest verified variant, or a general software-engineering
// fallback. Honors a valid model/analysis recommendation; otherwise scores each
// variant by how much of its verified content the JD actually asks for.
export function chooseFallbackVariant(bank, { analysis = null, extraction = null } = {}) {
  if (analysis?.recommendedVariant && RESUME_VARIANTS.includes(analysis.recommendedVariant)) {
    return analysis.recommendedVariant;
  }
  const jdTerms = jdTermSet({ extraction, analysis });
  const scores = new Map();
  for (const section of ["experience", "projects"]) {
    for (const entry of bank[section] || []) {
      for (const bullet of entry.bullets || []) {
        const match = bulletMatchScore(bullet, jdTerms);
        if (match === 0) continue;
        for (const variant of bullet.variants || []) {
          scores.set(variant, (scores.get(variant) || 0) + match);
        }
      }
    }
  }
  const roleText = `${analysis?.roleFamily || ""} ${analysis?.reasoningSummary || ""}`;
  const academic = ACADEMIC_SIGNAL.test(roleText);
  let best = null;
  let bestScore = -1;
  const order = academic ? ["academic", ...GENERAL_VARIANT_ORDER] : GENERAL_VARIANT_ORDER;
  for (const variant of order) {
    const score = scores.get(variant) || 0;
    if (score > bestScore) { best = variant; bestScore = score; }
  }
  if (bestScore <= 0) return academic ? "academic" : GENERAL_VARIANT_ORDER[0];
  return best;
}

// Deterministic JobAnalysis used when the Haiku analysis call fails. Shape
// matches validateJobAnalysis exactly so the rest of the pipeline is unchanged.
export function buildFallbackAnalysis({ extraction = null, job = null, variant = null } = {}) {
  const description = String(job?.description || "");
  const technical = (extraction?.keywords || [])
    .filter((keyword) => keyword.category === "technical")
    .map((keyword) => keyword.value || keyword.normalized);
  const responsibilities = (extraction?.keywords || [])
    .filter((keyword) => keyword.category === "responsibility")
    .map((keyword) => keyword.value || keyword.normalized)
    .slice(0, 8);
  const blockers = [];
  if (/\b(u\.?s\.?\s*citizen|citizenship|must be a citizen)\b/i.test(description)) blockers.push("citizenship requirement");
  if (/\b(security clearance|ts\/sci|secret clearance|polygraph)\b/i.test(description)) blockers.push("security-clearance requirement");
  const seniority = /\bintern(ship)?\b/i.test(description)
    ? "intern"
    : /\b(senior|staff|principal|lead)\b/i.test(description)
      ? "senior"
      : "entry";
  return {
    roleFamily: "software engineering",
    seniority,
    mustHaveKeywords: [...new Set(technical)].slice(0, 12),
    niceToHaveKeywords: [],
    responsibilities,
    blockers: blockers.filter((blocker) => ALLOWED_BLOCKERS.includes(blocker)),
    recommendedVariant: variant && RESUME_VARIANTS.includes(variant) ? variant : "fullstack",
    reasoningSummary: "Deterministic fallback classification from keyword extraction (model analysis unavailable).",
  };
}

// Builds a safe, valid selection entirely from the verified bank for the chosen
// variant, ranked by JD relevance then bank priority. No rewrites are emitted,
// so nothing can violate a rewrite rule. The caller runs the same mandatory
// injection, dedupe, budgeting, and validation as the model path.
export function buildDeterministicSelection(bank, { variant, extraction = null, analysis = null } = {}) {
  const jdTerms = jdTermSet({ extraction, analysis });
  const educationEntry = (bank.education || []).find(
    (entry) => !entry.variants || entry.variants.includes(variant)
  ) || bank.education?.[0];

  const buildSection = (section) => {
    const entries = [];
    for (const entry of bank[section] || []) {
      if (entry.variants && !entry.variants.includes(variant)) continue;
      const bullets = (entry.bullets || [])
        .filter((bullet) => (bullet.variants || []).includes(variant))
        .map((bullet) => ({ bullet, score: bulletMatchScore(bullet, jdTerms) }))
        .sort((a, b) => (b.score - a.score) || (a.bullet.priority - b.bullet.priority))
        .map((ranked) => ({ id: ranked.bullet.id }));
      if (bullets.length) entries.push({ entryId: entry.id, bullets });
    }
    return entries;
  };

  return {
    version: 1,
    variant,
    educationId: educationEntry?.id,
    skillGroupIds: [...(bank.skillGroups || []).filter((group) => (group.variants || []).includes(variant)).map((group) => group.id)],
    experience: buildSection("experience"),
    projects: buildSection("projects"),
  };
}
