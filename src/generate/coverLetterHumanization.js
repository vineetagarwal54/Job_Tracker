// Deterministic humanization guards for the cover letter (task Phase 11).
//
// The humanizer skill's rules are folded into generation as prompt constraints;
// this module is the code-side gate that (a) flags the generic AI phrases the
// humanizer guidance calls out, without banning them when they legitimately
// appear in the company/job-description context, and (b) revalidates that a
// humanized draft did not change any fact relative to the pre-humanized draft.

import { technologiesIn } from "./protectedTerms.js";

// Generic phrases the humanizer flags. Matched case-insensitively as phrases.
export const GENERIC_PHRASES = Object.freeze([
  "i am excited to apply",
  "i am thrilled",
  "perfect fit",
  "dynamic team",
  "cutting-edge",
  "passionate about",
  "leverage my skills",
  "i believe my background",
  "i am confident that",
  "fast-paced environment",
]);

function normalize(value) {
  return String(value || "").toLowerCase();
}

// Returns the generic phrases present in `text` that are NOT justified by the
// job description (a phrase echoing the JD, e.g. a company literally describing
// a "fast-paced environment", is allowed).
export function findGenericPhrases(text, options = {}) {
  const haystack = normalize(text);
  const jd = normalize(options.jobDescription);
  const found = [];
  for (const phrase of GENERIC_PHRASES) {
    if (haystack.includes(phrase) && !jd.includes(phrase)) found.push(phrase);
  }
  return found;
}

// Fact tokens that must be identical between the pre- and post-humanization
// drafts: every number/metric and every recognized technology. Humanization may
// change wording only, never these facts.
function factSignature(text) {
  const numbers = (normalize(text).match(/\b\d+(?:\.\d+)?(?:%|[a-z]+)?\b/g) || []).sort();
  const technologies = [...technologiesIn(text)].sort();
  return `${numbers.join("|")}::${technologies.join("|")}`;
}

// Revalidates a humanized cover letter against the pre-humanized version. If the
// humanized draft changed a numeric/metric fact, or introduced an unjustified
// generic phrase, the caller should fall back to the pre-humanized valid draft.
// Returns { valid, errors, generic }.
export function validateHumanizedCoverLetter(original, humanized, options = {}) {
  const errors = [];
  const originalText = [original.opening, ...(original.bodyParagraphs || []), original.closing].join(" ");
  const humanizedText = [humanized.opening, ...(humanized.bodyParagraphs || []), humanized.closing].join(" ");
  if (factSignature(originalText) !== factSignature(humanizedText)) {
    errors.push("humanized cover letter changed a fact (number or technology)");
  }
  const generic = findGenericPhrases(humanizedText, options);
  if (generic.length) errors.push(`humanized cover letter contains generic phrasing: ${generic.join(", ")}`);
  return { valid: errors.length === 0, errors, generic };
}
