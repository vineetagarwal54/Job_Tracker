// Focused, application-owned prompt modules (task Part 3).
//
// The useful rules from the reference skill files (JD analyzer, resume tailor,
// resume quantifier, resume bullet writer, tech resume optimizer, cover-letter
// generator) are distilled here into small composable fragments.
// Each model call is assembled from ONLY the modules it needs, so we never send
// every rule to every call.

const JD_ANALYZER = `Classify the job posting for deterministic resume selection. Identify the role family, seniority, must-have requirements, and nice-to-have requirements. Blockers are limited to explicit citizenship, security-clearance, or CPT/OPT rejection requirements; generic no-sponsorship language is not a blocker for a full-time OPT candidate. Never invent a numeric score.`;

const RESUME_TAILOR = `The selected canonical resume is authoritative. Choose only from the supplied approved candidate IDs, never construct a resume or repeat resolved bank IDs. Prefer no change unless a candidate has a concrete positive JD benefit above the supplied threshold. Prioritize explicit must-haves, repeated technical terms, and stronger verified evidence. Do not make cosmetic changes, stuff one-off keywords, or trade quantified evidence for weaker keyword-only wording. Provide rewritten text only for an approved bullet-rewrite candidate. A knowledge-classified skill may be selected only for Skills; never insert it into a bullet or imply implementation experience. Never remove experience, education, sections, skills, bullets, or projects. Never output LaTeX, headings, contact information, or document structure.`;

const QUANTIFIER = `Preserve every metric exactly. Never invent, round, weaken, or drop a number. Use the verified numbers already present in the source; if a number is unknown, do not fabricate one.`;

const BULLET_WRITER = `Lead each rewritten bullet with a strong, distinct action verb; never repeat an opening action verb across the document. Use no em dash and no hyphen as a separator; keep conventional technical hyphenation intact. For every selected candidate, return its candidate ID and a justification naming the exact job-description term or responsibility that motivated the change. Do not make cosmetic edits that no job-description term justifies.`;

const V2_REWRITE = `A V2 bullet rewrite is a light edit of the supplied base bullet. Preserve every metric and factual claim exactly, add no new technology or accomplishment, and return only the schema fields type, baseBulletId, replacementBulletId, rewrittenText, requirementIds, and justification. Use an empty string for an unused conditional field. Never return a candidate ID.`;

const TECH_OPTIMIZER = `Surface an exact job-description term only when it is already supported by the selected base or verified content bank. Skill edits must reference verified bank items and an existing base category. Never invent a skill, claim, metric, technology, or accomplishment.`;

const SEMANTIC_RESUME_OPTIMIZER = `You are a constrained semantic evidence mapper for Resume Optimizer V2. Understand the job description as meaning, including alternatives, composites, responsibilities, qualifications, and required production depth. Return at most 12 meaningful requirements, prioritized in this order: explicit must-haves, major responsibilities, repeated or high-signal technologies, then preferred qualifications that materially differentiate candidates. Do not emit generic or redundant job-description sentences. For each requirement set evidenceExpectation to knowledge when the posting asks for knowledge, fundamentals, understanding, familiarity, or proficiency, and accomplishment when it asks the candidate to have built, implemented, deployed, developed, owned, participated in, or performed work professionally or in production. Map each requirement only to concrete IDs in the supplied verified evidence catalog. Cite already rendered evidence in currentEvidenceIds, alternative verified evidence in candidateEvidenceIds, and knowledge-classified skills in knowledgeSkillIds only for a knowledge expectation. Skills-only evidence cannot support an accomplishment expectation. Skill IDs present in alternatives.skills.handsOnEvidence are hands-on and every other supplied skill ID has defaultClassification knowledge. Do not assign coverage status and do not propose resume mutations, rewrites, projects, skills, summaries, or a tailoring diff. Deterministic code derives coverage and chooses any safe minimal changes. Return only the requested JSON.`;

const NO_FABRICATION = `Never claim CUDA kernel authoring, kernel fusion, GPU kernel optimization, or the teammates' 2 to 3 times speculative-decoding result as the candidate's own benchmark.`;

const COVER_LETTER = `Write a concise, natural cover letter using only the supplied final-resume evidence and the surviving Resume Optimizer V2 requirement matches. Do not independently reinterpret the job description or use a requirement marked uncovered. Select the two or three strongest supplied matches; do not force in unrelated bullets or repeat keywords. Knowledge-only skills never support an accomplishment claim. Every substantive candidate claim must be copied into claimEvidence and cite only the supplied resume evidence ID that supports it. Preserve metrics exactly. Never invent experience, skills, ownership, outcomes, company facts, motivation, names, addresses, or personal stories. Company-specific statements must be directly supported by the job description. Return only the requested JSON with exactly four short content paragraphs and no contact information, greeting, sign-off, headings, URLs, or LaTeX.`;

function compose(...modules) {
  return modules.filter(Boolean).join(" ");
}

// Assembled system prompts per call. Only the relevant modules are included.
const ANALYSIS_SYSTEM = compose(JD_ANALYZER, "Return only the requested JSON.");
const SELECTION_SYSTEM = compose(RESUME_TAILOR, QUANTIFIER, BULLET_WRITER, TECH_OPTIMIZER, NO_FABRICATION, "Output only the requested JSON.");
const SEMANTIC_OPTIMIZER_SYSTEM = compose(SEMANTIC_RESUME_OPTIMIZER, NO_FABRICATION);
const COVER_LETTER_SYSTEM = compose(COVER_LETTER, QUANTIFIER, "Use no em dash and no AI filler.");

module.exports = {
  modules: { JD_ANALYZER, RESUME_TAILOR, QUANTIFIER, BULLET_WRITER, V2_REWRITE, TECH_OPTIMIZER, SEMANTIC_RESUME_OPTIMIZER, NO_FABRICATION, COVER_LETTER },
  compose,
  ANALYSIS_SYSTEM,
  SELECTION_SYSTEM,
  SEMANTIC_OPTIMIZER_SYSTEM,
  COVER_LETTER_SYSTEM,
};
