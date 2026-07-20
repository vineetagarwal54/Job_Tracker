// Focused, application-owned prompt modules (task Part 3).
//
// The useful rules from the reference skill files (JD analyzer, resume tailor,
// resume quantifier, resume bullet writer, tech resume optimizer, cover-letter
// generator, humanizer) are distilled here into small composable fragments.
// Each model call is assembled from ONLY the modules it needs, so we never send
// every rule to every call.

const JD_ANALYZER = `Classify the job posting for deterministic resume selection. Identify the role family, seniority, must-have requirements, and nice-to-have requirements. Blockers are limited to explicit citizenship, security-clearance, or CPT/OPT rejection requirements; generic no-sponsorship language is not a blocker for a full-time OPT candidate. Never invent a numeric score.`;

const RESUME_TAILOR = `Select and lightly rewrite only verified bank bullets, ranked most relevant to the job description first. Prefer bullets whose skills and outcomes match the must-have requirements. Use only bank IDs. Never output LaTeX, summaries, skills prose, education prose, headings, URLs, contact information, or document structure.`;

const QUANTIFIER = `Preserve every metric exactly. Never invent, round, weaken, or drop a number. Use the verified numbers already present in the source; if a number is unknown, do not fabricate one.`;

const BULLET_WRITER = `Lead each bullet with a strong, distinct action verb; never repeat an opening action verb across the document. Use no em dash and no hyphen as a separator; keep conventional technical hyphenation intact. For every rewritten bullet, return its original id, the rewritten text, and a justification naming the exact job-description term or responsibility that motivated the change. Do not make cosmetic edits that no job-description term justifies.`;

const TECH_OPTIMIZER = `Optimize for applicant tracking systems: surface the exact technical terms the job description uses when they are already true of the candidate. For skills, select INDIVIDUAL items the job description calls for, copied verbatim from each category's verified items only, ordered by importance; never invent a skill, never move an item between categories, and never introduce a technology the source bullet does not support.`;

const NO_FABRICATION = `Never claim CUDA kernel authoring, kernel fusion, GPU kernel optimization, or the teammates' 2 to 3 times speculative-decoding result as the candidate's own benchmark.`;

const COVER_LETTER = `Write a direct professional cover letter using only the supplied verified content bank, the selected resume evidence, the job description, and the validated analysis. Return only the requested JSON. Do not output contact information, greeting, sign-off, headings, URLs, or LaTeX. Write exactly four content paragraphs: a brief opening, two evidence-based body paragraphs, and a concise closing. Do not invent company facts, metrics, responsibilities, technologies, names, addresses, or personal stories.`;

const HUMANIZER = `Rewrite the supplied cover letter so it reads as natural human writing. Remove AI tells: inflated or promotional phrasing, filler, the rule of three, negative parallelisms, and generic openers such as "I am excited to apply", "passionate about", "perfect fit", "cutting-edge", or "leverage my skills". Keep every fact, number, technology, scope, and outcome identical to the input; change wording only, never meaning. Return the same JSON structure with the same four paragraphs. Use no em dash and no AI filler.`;

function compose(...modules) {
  return modules.filter(Boolean).join(" ");
}

// Assembled system prompts per call. Only the relevant modules are included.
const ANALYSIS_SYSTEM = compose(JD_ANALYZER, "Return only the requested JSON.");
const SELECTION_SYSTEM = compose(RESUME_TAILOR, QUANTIFIER, BULLET_WRITER, TECH_OPTIMIZER, NO_FABRICATION, "Output only the requested JSON.");
const COVER_LETTER_SYSTEM = compose(COVER_LETTER, QUANTIFIER, "Use no em dash and no AI filler.");
const HUMANIZER_SYSTEM = compose(HUMANIZER, QUANTIFIER);

module.exports = {
  modules: { JD_ANALYZER, RESUME_TAILOR, QUANTIFIER, BULLET_WRITER, TECH_OPTIMIZER, NO_FABRICATION, COVER_LETTER, HUMANIZER },
  compose,
  ANALYSIS_SYSTEM,
  SELECTION_SYSTEM,
  COVER_LETTER_SYSTEM,
  HUMANIZER_SYSTEM,
};
