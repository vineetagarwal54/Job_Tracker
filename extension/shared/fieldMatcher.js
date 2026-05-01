// Scoring-based field resolver. Combines visible label text, autocomplete,
// input type, id/name keywords, options, and section/parent-block context to
// pick the best category for each detected field.
//
// Score sources (independent — they add up):
//   autocomplete match           +100
//   input type match             +80
//   phrase in label/aria/placeholder
//                                +90 + min(len, 30)
//   phrase in nearby text        +60 + min(len, 20)
//   phrase in section / block    +40
//   phrase in option text        +30
//   contextClue in section/block +25 each (capped)
//   keyword in id/name           +30
//   negativeClue anywhere        -70 (knocks out wrong categories)
//
// Buckets: ≥80 high · ≥40 review · else unknown.
//
// review/sensitive categories get demoted from "high" to "review" so the user
// still confirms them before submit. They are NOT excluded from autofill —
// the side panel decides that.

import {
  CATEGORIES,
  ALWAYS_REVIEW,
  SENSITIVE,
  profileKeyFor,
  expectedTypeFor,
  safetyFor,
} from "./fieldCategories.js";

const HIGH_THRESHOLD = 80;
const REVIEW_THRESHOLD = 40;

const PHRASE_LABEL_BONUS_CAP = 30;
const PHRASE_NEARBY_BONUS_CAP = 20;
const CONTEXT_CLUE_CAP = 50; // total points from contextClues

function normalize(s) {
  return (s || "")
    .toString()
    .toLowerCase()
    .replace(/[_\-\/]+/g, " ")
    .replace(/[.,!?:;'"()[\]{}\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// camelCase / snake_case / kebab-case → space-separated lowercase tokens.
function tokenize(s) {
  return normalize((s || "").toString().replace(/([a-z0-9])([A-Z])/g, "$1 $2"));
}

// Greenhouse renders custom questions with ids like `question_17719036004`
// and array-style names — neither carries semantic meaning, so we lean
// entirely on the rendered question text for those fields.
function isCustomQuestionField(field) {
  if (/^question[_-]?\d+$/i.test(field.id || "")) return true;
  if ((field.name || "").includes("answers_attributes")) return true;
  return false;
}

function labelText(field) {
  return normalize(
    [field.label, field.ariaLabel, field.placeholder].filter(Boolean).join(" ")
  );
}

function nearbyOnlyText(field) {
  return normalize(field.nearby || "");
}

function sectionText(field) {
  return normalize(
    [field.section, field.parentBlockText].filter(Boolean).join(" ")
  );
}

function optionsText(field) {
  if (!Array.isArray(field.options) || !field.options.length) return "";
  return normalize(field.options.join(" "));
}

// Returns the longest phrase in `phrases` that appears in `haystack`, or
// null. Longest-match wins so a more specific phrase beats a substring of
// itself.
function bestPhraseHit(haystack, phrases = []) {
  if (!haystack) return null;
  let best = null;

  for (const phrase of phrases) {
    const normalizedPhrase = normalize(phrase);
    if (!normalizedPhrase) continue;

    if (
      haystack.includes(normalizedPhrase) &&
      (!best || normalizedPhrase.length > best.length)
    ) {
      best = normalizedPhrase;
    }
  }

  return best;
}

function scoreCategory(field, cat, ctx) {
  let score = 0;
  const reasons = [];

  if (cat.autocomplete && ctx.autocomplete && cat.autocomplete.includes(ctx.autocomplete)) {
    score += 100;
    reasons.push(`autocomplete=${ctx.autocomplete}`);
  }

  if (cat.inputTypes && cat.inputTypes.includes(field.type)) {
    score += 80;
    reasons.push(`type=${field.type}`);
  }

  if (cat.phrases) {
    const labelHit = bestPhraseHit(ctx.label, cat.phrases);
    if (labelHit) {
      score += 90 + Math.min(labelHit.length, PHRASE_LABEL_BONUS_CAP);
      reasons.push(`label~"${labelHit}"`);
    } else {
      const nearbyHit = bestPhraseHit(ctx.nearby, cat.phrases);
      if (nearbyHit) {
        score += 60 + Math.min(nearbyHit.length, PHRASE_NEARBY_BONUS_CAP);
        reasons.push(`nearby~"${nearbyHit}"`);
      } else {
        const sectionHit = bestPhraseHit(ctx.section, cat.phrases);
        if (sectionHit) {
          score += 40;
          reasons.push(`section~"${sectionHit}"`);
        }
      }
    }

    // Options text: mostly useful for selects ("Yes/No" options on a yes/no
    // question, race options, etc.). Light bonus only.
    const optionHit = bestPhraseHit(ctx.options, cat.phrases);
    if (optionHit) {
      score += 30;
      reasons.push(`option~"${optionHit}"`);
    }
  }

  // Context clues: nudge fields toward the right category when their own
  // label is vague. e.g. "Year" inside an "Education" section.
  if (cat.contextClues && (ctx.section || ctx.nearby)) {
    let bonus = 0;
    const haystack = `${ctx.section} ${ctx.nearby}`;
    for (const clue of cat.contextClues) {
      const n = normalize(clue);
      if (n && haystack.includes(n)) {
        bonus += 25;
        reasons.push(`context+"${n}"`);
      }
    }
    score += Math.min(bonus, CONTEXT_CLUE_CAP);
  }

  // Negative clues: knock out wrong categories (e.g. "salary" on GPA).
  if (cat.negativeClues) {
    const haystack = `${ctx.label} ${ctx.nearby} ${ctx.section}`;
    for (const clue of cat.negativeClues) {
      const n = normalize(clue);
      if (n && haystack.includes(n)) {
        score -= 70;
        reasons.push(`neg-"${n}"`);
        break;
      }
    }
  }

  if (cat.keywords && !ctx.suppressIdName && ctx.idTokens) {
    const hit = cat.keywords.find((kw) => ctx.idTokens.includes(normalize(kw)));
    if (hit) {
      score += 30;
      reasons.push(`id~"${hit}"`);
    }
  }

  return { score, reasons };
}

export function classifyField(field) {
  const ctx = {
    autocomplete: normalize(field.autocomplete),
    label: labelText(field),
    nearby: nearbyOnlyText(field),
    section: sectionText(field),
    options: optionsText(field),
    idTokens: tokenize(`${field.id || ""} ${field.name || ""}`),
    suppressIdName: isCustomQuestionField(field),
  };

  let best = { id: "unknown", score: 0, reasons: [] };
  for (const cat of CATEGORIES) {
    const { score, reasons } = scoreCategory(field, cat, ctx);
    if (score > best.score) best = { id: cat.id, score, reasons };
  }

  let bucket;
  if (best.score >= HIGH_THRESHOLD) bucket = "high";
  else if (best.score >= REVIEW_THRESHOLD) bucket = "review";
  else {
    best = { id: "unknown", score: best.score, reasons: best.reasons };
    bucket = "unknown";
  }

  // Phrase-only categories (no autocomplete/input-type signal) are custom
  // application questions — even a strong phrase match isn't enough to
  // silently autofill, so cap them at review. ALWAYS_REVIEW covers the
  // safety set too.
  const matchedCat = best.id === "unknown"
    ? null
    : CATEGORIES.find((c) => c.id === best.id);
  const phraseOnly = matchedCat && !matchedCat.autocomplete && !matchedCat.inputTypes;
  if ((phraseOnly || ALWAYS_REVIEW.has(best.id)) && bucket === "high") bucket = "review";

  const reviewRequired = ALWAYS_REVIEW.has(best.id) || bucket === "review";
  const sensitive = SENSITIVE.has(best.id);

  return {
    category: best.id,
    profileKey: profileKeyFor(best.id),
    expectedType: expectedTypeFor(best.id),
    safetyLevel: safetyFor(best.id),
    confidence: best.score,
    bucket,
    reviewRequired,
    sensitive,
    reasons: best.reasons,
    // Legacy field name kept for backwards compat — same content as reasons.
    signals: best.reasons,
  };
}
