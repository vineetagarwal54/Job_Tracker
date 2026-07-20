// Deterministic composite bullet ranking and per-entry distribution limits
// (task Part 2).
//
// The final ordering used to fill and trim the one-page budget is a JD-aware
// composite score, not the static content-bank priority. It considers JD
// relevance, quantified evidence, production and business impact, technical
// depth, project maturity, and role duration. Per-entry limits keep a short,
// keyword-heavy role from consuming most of the resume.

import { textContainsTerm, canonicalizeTerm } from "./protectedTerms.js";
import { classifyProject } from "./projectMaturity.js";

// Approximate role duration in months, used as a mild seniority signal for
// EXTRA (non-reserved) experience bullets. Mandatory reservation already
// guarantees each employer at least one bullet regardless of duration.
const ROLE_MONTHS = Object.freeze({
  "xelpmoc-software-engineer": 18,
  "svipes-software-engineer": 6,
  "iiit-hyderabad-software-intern": 3,
  "servbeyond-enterprise-ai-platform-intern": 3,
  "runara-ml-inference-engineer-intern": 2,
});

const OPTIONAL_EXPERIENCE = new Set(["svipes-software-engineer", "iiit-hyderabad-software-intern"]);

const BUSINESS_IMPACT = /\b(users?|adoption|booking|revenue|cost|hours?|defects?|delivery|efficiency|accuracy|manual lookup|productivity)\b/i;
const PRODUCTION_IMPACT = /\b(throughput|latency|sub-?\s?\d|response time|scal\w*|concurrent|uptime|pods|autoscal\w*|real-time)\b/i;

export function buildRankingContext({ extraction = null, analysis = null, emphases = null } = {}) {
  const jdTerms = new Set();
  for (const keyword of extraction?.keywords || []) {
    const normalized = keyword.normalized || canonicalizeTerm(keyword.value);
    if (normalized) jdTerms.add(normalized);
  }
  for (const list of [analysis?.mustHaveKeywords, analysis?.niceToHaveKeywords]) {
    for (const term of list || []) {
      const normalized = canonicalizeTerm(term);
      if (normalized) jdTerms.add(normalized);
    }
  }
  const mustHave = new Set((analysis?.mustHaveKeywords || []).map((term) => canonicalizeTerm(term)));
  const emphasisSet = new Set((emphases || []).map((entry) => (typeof entry === "string" ? entry : entry.id)));
  return { jdTerms, mustHave, emphasisSet };
}

function bulletJdScore(bullet, text, ctx) {
  if (!ctx || !ctx.jdTerms || ctx.jdTerms.size === 0) return 0;
  const haystack = `${text} ${(bullet.skills || []).join(" ")}`;
  let score = 0;
  for (const term of ctx.jdTerms) {
    if (textContainsTerm(haystack, term)) score += ctx.mustHave?.has(term) ? 2 : 1;
  }
  return score;
}

// Per-entry bullet ceiling (task Part 2 distribution rules).
export function entryBulletLimit(entryId, emphasisSet = new Set()) {
  if (entryId === "runara-ml-inference-engineer-intern") return emphasisSet.has("llm-inference") ? 2 : 1;
  if (entryId === "locra") return (emphasisSet.has("mobile") || emphasisSet.has("ai-product")) ? 2 : 1;
  if (entryId === "servbeyond-enterprise-ai-platform-intern") return 2;
  if (entryId === "xelpmoc-software-engineer") return 2;
  if (OPTIONAL_EXPERIENCE.has(entryId)) return 1;
  return 2; // other projects: 1 to 2
}

// Composite rank score for a single resolved bullet item
// ({ section, entry, bullet, text }).
export function bulletRankScore(item, ctx) {
  const { entry, bullet, text, section } = item;
  const jd = bulletJdScore(bullet, text, ctx) * 10;
  const quantified = (bullet.lockedMetrics?.length || 0) * 3;
  const impact = (BUSINESS_IMPACT.test(text) ? 4 : 0) + (PRODUCTION_IMPACT.test(text) ? 3 : 0);
  const depth = Math.min(bullet.skills?.length || 0, 6);
  let maturity = 0;
  let duration = 0;
  if (section === "projects") {
    const cls = classifyProject(entry.id);
    maturity = cls === "flagship" ? 3 : cls === "exploratory" ? -8 : 1;
  } else {
    duration = Math.min((ROLE_MONTHS[entry.id] || 3) / 6, 3);
  }
  const priorityPenalty = (bullet.priority || 9) * 0.2;
  return jd + quantified + impact + depth + maturity + duration - priorityPenalty;
}

// All-bullets rank map (bulletId -> score) for the deterministic trim step, so a
// page overflow removes the lowest-ranked removable bullet by FINAL JD ranking
// rather than static content-bank priority.
export function computeAllRankScores(bank, ctx) {
  const scores = new Map();
  for (const section of ["experience", "projects"]) {
    for (const entry of bank[section] || []) {
      for (const bullet of entry.bullets || []) {
        scores.set(bullet.id, bulletRankScore({ section, entry, bullet, text: bullet.text }, ctx));
      }
    }
  }
  return scores;
}
