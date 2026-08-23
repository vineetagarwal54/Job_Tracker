// Focused, application-owned prompt modules (task Part 3).
//
// The useful rules from the reference skill files (JD analyzer, resume tailor,
// resume quantifier, resume bullet writer, tech resume optimizer, cover-letter
// generator) are distilled here into small composable fragments.
// Each model call is assembled from ONLY the modules it needs, so we never send
// every rule to every call.

const JD_ANALYZER = `Classify the job posting for deterministic resume selection. Identify the role family, seniority, must-have requirements, and nice-to-have requirements. Blockers are limited to explicit citizenship, security-clearance, or CPT/OPT rejection requirements; generic no-sponsorship language is not a blocker for a full-time OPT candidate. Never invent a numeric score.`;

const RESUME_TAILOR = `The selected canonical resume is authoritative. Propose only a minimal diff against it, never a complete resume. Prefer no change unless an approved candidate has a concrete, positive JD benefit above the supplied threshold. Prioritize explicit must-haves, repeated technical terms, and stronger verified evidence. Do not make cosmetic changes, stuff one-off keywords, or trade quantified evidence for weaker keyword-only wording. Use only supplied candidate, canonical, and content-bank IDs. You may propose at most three bullet changes, one one-for-one project swap, and four verified skill additions or swaps. A knowledge-classified skill may be added only to Skills; never insert it into a bullet or imply implementation experience. Never remove experience, education, sections, skills, bullets without replacement, or projects without replacement. Never output LaTeX, headings, contact information, or document structure.`;

const QUANTIFIER = `Preserve every metric exactly. Never invent, round, weaken, or drop a number. Use the verified numbers already present in the source; if a number is unknown, do not fabricate one.`;

const BULLET_WRITER = `Lead each bullet with a strong, distinct action verb; never repeat an opening action verb across the document. Use no em dash and no hyphen as a separator; keep conventional technical hyphenation intact. For every rewritten bullet, return its original id, the rewritten text, and a justification naming the exact job-description term or responsibility that motivated the change. Do not make cosmetic edits that no job-description term justifies.`;

const TECH_OPTIMIZER = `Surface an exact job-description term only when it is already supported by the selected base or verified content bank. Skill edits must reference verified bank items and an existing base category. Never invent a skill, claim, metric, technology, or accomplishment.`;

const NO_FABRICATION = `Never claim CUDA kernel authoring, kernel fusion, GPU kernel optimization, or the teammates' 2 to 3 times speculative-decoding result as the candidate's own benchmark.`;

const COVER_LETTER = `Write a concise, natural cover letter using only the supplied final-resume evidence, job description, and validated analysis. Select the two or three strongest verified matches; do not force in unrelated bullets or repeat keywords. Every substantive candidate claim must be copied into claimEvidence and cite only the supplied resume evidence ID that supports it. Preserve metrics exactly. Never invent experience, skills, ownership, outcomes, company facts, motivation, names, addresses, or personal stories. Company-specific statements must be directly supported by the job description. Return only the requested JSON with exactly four short content paragraphs and no contact information, greeting, sign-off, headings, URLs, or LaTeX.`;

function compose(...modules) {
  return modules.filter(Boolean).join(" ");
}

// Assembled system prompts per call. Only the relevant modules are included.
const ANALYSIS_SYSTEM = compose(JD_ANALYZER, "Return only the requested JSON.");
const SELECTION_SYSTEM = compose(RESUME_TAILOR, QUANTIFIER, BULLET_WRITER, TECH_OPTIMIZER, NO_FABRICATION, "Output only the requested JSON.");
const COVER_LETTER_SYSTEM = compose(COVER_LETTER, QUANTIFIER, "Use no em dash and no AI filler.");

module.exports = {
  modules: { JD_ANALYZER, RESUME_TAILOR, QUANTIFIER, BULLET_WRITER, TECH_OPTIMIZER, NO_FABRICATION, COVER_LETTER },
  compose,
  ANALYSIS_SYSTEM,
  SELECTION_SYSTEM,
  COVER_LETTER_SYSTEM,
};
