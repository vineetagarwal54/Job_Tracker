// Classifies a raw detected field into one of the JobTrack profile categories
// and decorates it with the metadata the side panel and the (future) autofill
// engine need: a confidence bucket, a reviewRequired flag, and a sensitive
// flag for EEOC-style questions we will never auto-answer.
//
// Two-tier scoring:
//   1. Visible text (label + aria + placeholder + nearby) is matched against
//      multi-word PHRASES — the longest matching phrase wins, so
//      "located in the state" beats a stray "state" elsewhere in the doc.
//   2. autocomplete + input-type still short-circuit common fields
//      (firstName/email/phone/etc.) to a high score.
//   3. id/name keyword fallback fires only when the field isn't a Greenhouse
//      custom question (id like `question_17719036004`), where ids carry no
//      semantic meaning.
//
// Buckets: ≥80 high · ≥40 review · else unknown. Categories in ALWAYS_REVIEW
// are demoted from high to review — we never want to silently auto-fill
// authorization, sponsorship, residency, location-fit, or EEOC questions.

// const CATEGORIES = [
//   // ── Phrase-first categories (custom application questions) ────────────
//   // Listed before generic geo fields so a phrase hit on e.g. "located in the
//   // state" doesn't lose to a one-word "state" match on the city/state
//   // category — they are scored independently, but it keeps the file
//   // readable in the order a reader expects.

//   {
//     id: "earliestStartDate",
//     phrases: [
//       "soonest date you can start",
//       "soonest you can start",
//       "earliest date you can start",
//       "earliest possible start date",
//       "earliest start date",
//       "soonest start date",
//       "available start date",
//       "when can you start",
//       "what is your start date",
//       "start date",
//     ],
//   },
//   {
//     id: "currentLocation",
//     phrases: [
//       "where are you currently located",
//       "where are you located",
//       "where do you currently live",
//       "where do you live",
//       "current location city and state",
//       "current city and state",
//       "current location",
//       "your current location",
//       "city and state",
//       "your location",
//     ],
//   },
//   {
//     id: "workAuthorization",
//     phrases: [
//       "legally authorized to work in the united states",
//       "legally authorized to work",
//       "authorized to work in the united states",
//       "authorized to work in the us",
//       "authorized to work",
//       "work authorization",
//       "authorization to work",
//       "right to work",
//       "eligible to work",
//     ],
//   },
//   {
//     id: "sponsorship",
//     phrases: [
//       "now or in the future require sponsorship",
//       "future require sponsorship",
//       "require future sponsorship",
//       "require sponsorship",
//       "need sponsorship",
//       "visa sponsorship",
//       "employment visa status",
//       "sponsorship for employment",
//       "sponsorship",
//       "h-1b",
//       "h1b",
//       "f-1",
//       "f1 visa",
//       "cpt",
//       "opt",
//     ],
//   },
//   {
//     id: "locationRequirement",
//     phrases: [
//       "does this work for you",
//       "willing to relocate",
//       "able to relocate",
//       "willing to commute",
//       "hybrid attendance",
//       "remote in",
//       "remote work",
//       "in-office",
//       "in office",
//       "on-site",
//       "onsite",
//       "hybrid",
//       "relocate",
//       "commute",
//     ],
//   },
//   {
//     id: "stateResidency",
//     phrases: [
//       "currently a resident and located",
//       "resident and located in the state",
//       "currently a resident",
//       "located in the state",
//       "resident of the state",
//       "resident in the state",
//       "state of residence",
//     ],
//   },
//   {
//     id: "hispanicLatino",
//     phrases: [
//       "hispanic or latino",
//       "hispanic/latino",
//       "hispanic",
//       "latino",
//       "latinx",
//       "latine",
//     ],
//   },
//   {
//     id: "race",
//     phrases: [
//       "race / ethnicity",
//       "race or ethnicity",
//       "race/ethnicity",
//       "ethnicity",
//       "race",
//     ],
//   },
//   {
//     id: "gender",
//     phrases: [
//       "gender identity",
//       "gender",
//     ],
//   },
//   {
//     id: "veteranStatus",
//     phrases: [
//       "protected veteran status",
//       "protected veteran",
//       "veteran status",
//       "veteran",
//     ],
//   },
//   {
//     id: "disabilityStatus",
//     phrases: [
//       "disability status",
//       "disability",
//     ],
//   },

//   // ── Standard profile fields ──────────────────────────────────────────
//   // Autocomplete and input type carry most of the weight here; phrases and
//   // id/name keywords are fallbacks for forms that omit autocomplete.

//   {
//     id: "email",
//     autocomplete: ["email"],
//     inputTypes: ["email"],
//     phrases: ["email address", "e-mail address", "e-mail", "email"],
//     keywords: ["email"],
//   },
//   {
//     id: "phone",
//     autocomplete: ["tel", "tel-national", "tel-local"],
//     inputTypes: ["tel"],
//     phrases: ["phone number", "mobile number", "telephone number", "phone", "telephone"],
//     keywords: ["phone", "mobile", "telephone"],
//   },
//   {
//     id: "firstName",
//     autocomplete: ["given-name"],
//     phrases: ["first name", "given name", "preferred first name"],
//     keywords: ["firstname", "fname", "first name"],
//   },
//   {
//     id: "lastName",
//     autocomplete: ["family-name"],
//     phrases: ["last name", "family name", "surname"],
//     keywords: ["lastname", "lname", "last name", "surname"],
//   },
//   {
//     id: "address",
//     autocomplete: ["street-address", "address-line1"],
//     phrases: ["street address", "mailing address", "address line", "home address"],
//     keywords: ["address"],
//   },
//   {
//     id: "city",
//     autocomplete: ["address-level2"],
//     phrases: ["city", "town"],
//     keywords: ["city", "town"],
//   },
//   {
//     id: "state",
//     autocomplete: ["address-level1"],
//     phrases: ["state / province", "state or province", "state/province", "state", "province"],
//     keywords: ["state", "province", "region"],
//   },
//   {
//     id: "zip",
//     autocomplete: ["postal-code"],
//     phrases: ["zip code", "postal code", "zip / postal code", "postcode"],
//     keywords: ["zip", "postal", "postcode"],
//   },
//   {
//     id: "country",
//     autocomplete: ["country", "country-name"],
//     phrases: ["country of residence", "country"],
//     keywords: ["country"],
//   },
// ];

// // Categories that must never silently autofill — even at high confidence we
// // surface them for the user to confirm.
// const ALWAYS_REVIEW = new Set([
//   "workAuthorization",
//   "sponsorship",
//   "locationRequirement",
//   "stateResidency",
//   "gender",
//   "race",
//   "hispanicLatino",
//   "veteranStatus",
//   "disabilityStatus",
// ]);

// // EEOC-style questions: extra-prominent badge in the UI; we never store
// // these on a profile.
// const SENSITIVE = new Set([
//   "gender",
//   "race",
//   "hispanicLatino",
//   "veteranStatus",
//   "disabilityStatus",
// ]);

import {
  CATEGORIES,
  ALWAYS_REVIEW,
  SENSITIVE,
} from "./fieldCategories.js";

const HIGH_THRESHOLD = 80;
const REVIEW_THRESHOLD = 40;

// Cap the length-bonus so a 200-char question with one matched phrase
// doesn't dwarf everything else.
const PHRASE_LENGTH_BONUS_CAP = 30;

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

function visibleText(field) {
  return normalize(
    [field.label, field.ariaLabel, field.placeholder, field.nearby]
      .filter(Boolean)
      .join(" ")
  );
}

// Returns the longest phrase in `phrases` that appears in `haystack`, or
// null. Longest-match wins so a more specific phrase beats a substring
// of itself.
function bestPhraseHit(haystack, phrases = []) {
  let best = null;

  for (const phrase of phrases) {
    const normalizedPhrase = normalize(phrase);

    if (
      normalizedPhrase &&
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
  const signals = [];

  if (cat.autocomplete && ctx.autocomplete && cat.autocomplete.includes(ctx.autocomplete)) {
    score += 100;
    signals.push(`autocomplete=${ctx.autocomplete}`);
  }
  if (cat.inputTypes && cat.inputTypes.includes(field.type)) {
    score += 80;
    signals.push(`type=${field.type}`);
  }

  if (cat.phrases && ctx.visible) {
    const hit = bestPhraseHit(ctx.visible, cat.phrases);
    if (hit) {
      score += 90 + Math.min(hit.length, PHRASE_LENGTH_BONUS_CAP);
      signals.push(`phrase~${hit}`);
    }
  }

  if (cat.keywords && !ctx.suppressIdName && ctx.idTokens) {
    const hit = cat.keywords.find((kw) => ctx.idTokens.includes(kw));
    if (hit) {
      score += 30;
      signals.push(`id~${hit}`);
    }
  }

  return { score, signals };
}

export function classifyField(field) {
  const ctx = {
    autocomplete: normalize(field.autocomplete),
    visible: visibleText(field),
    idTokens: tokenize(`${field.id || ""} ${field.name || ""}`),
    suppressIdName: isCustomQuestionField(field),
  };

  let best = { id: "unknown", score: 0, signals: [] };
  for (const cat of CATEGORIES) {
    const { score, signals } = scoreCategory(field, cat, ctx);
    if (score > best.score) best = { id: cat.id, score, signals };
  }

  let bucket;
  if (best.score >= HIGH_THRESHOLD) bucket = "high";
  else if (best.score >= REVIEW_THRESHOLD) bucket = "review";
  else {
    best = { id: "unknown", score: best.score, signals: best.signals };
    bucket = "unknown";
  }

  // Phrase-only categories (no autocomplete, no input-type signal) are
  // custom application questions — even a strong phrase match isn't enough
  // to silently autofill, so cap them at review. ALWAYS_REVIEW categories
  // are all phrase-only too, so this also covers the safety set.
  const matchedCat = best.id === "unknown"
    ? null
    : CATEGORIES.find((c) => c.id === best.id);
  const phraseOnly = matchedCat && !matchedCat.autocomplete && !matchedCat.inputTypes;
  if ((phraseOnly || ALWAYS_REVIEW.has(best.id)) && bucket === "high") bucket = "review";

  const reviewRequired = ALWAYS_REVIEW.has(best.id) || bucket === "review";
  const sensitive = SENSITIVE.has(best.id);

  return {
    category: best.id,
    confidence: best.score,
    bucket,
    reviewRequired,
    sensitive,
    signals: best.signals,
  };
}
