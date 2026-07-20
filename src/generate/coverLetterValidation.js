import { findGenericPhrases } from "./coverLetterHumanization.js";

const FIELDS = ["version", "opening", "bodyParagraphs", "closing"];
// wordCount is a derived field this validator adds; tolerate it so re-validating
// an already-validated draft (e.g. before rendering) is idempotent.
const ALLOWED_FIELDS = [...FIELDS, "wordCount"];
const FORBIDDEN = [
  /cuda\s+(?:kernel|kernels|authoring|optimization)/i,
  /(?:fused|fuse|fusion)\s+(?:rmsnorm|linear|cuda|kernel)/i,
  /gpu\s+kernel\s+optimization/i,
  /[—–]/,
];
const LATEX = /\\(?:documentclass|begin|end|section|href|textbf|input|include|usepackage)\b|\$\$|\\\[/i;
const NUMBERS = /\b\d+(?:\.\d+)?(?:%|[A-Za-z]+)?\b/g;

function allBankNumbers(bank) {
  return new Set([...bank.experience, ...bank.projects].flatMap((entry) => entry.bullets).flatMap((bullet) => bullet.text.match(NUMBERS) || []).map((value) => value.toLowerCase()));
}

export function validateCoverLetter(value, bank, options = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Object.assign(new Error("Cover letter response must be an object."), { code: "VALIDATION_FAILED" });
  for (const key of Object.keys(value)) if (!ALLOWED_FIELDS.includes(key)) throw Object.assign(new Error(`Cover letter contains unknown field '${key}'.`), { code: "VALIDATION_FAILED" });
  for (const key of FIELDS) if (!Object.hasOwn(value, key)) throw Object.assign(new Error(`Cover letter is missing '${key}'.`), { code: "VALIDATION_FAILED" });
  if (value.version !== 1 || typeof value.opening !== "string" || typeof value.closing !== "string" || !Array.isArray(value.bodyParagraphs) || value.bodyParagraphs.length !== 2 || !value.bodyParagraphs.every((item) => typeof item === "string")) {
    throw Object.assign(new Error("Cover letter response has an invalid structure."), { code: "VALIDATION_FAILED" });
  }
  const paragraphs = [value.opening, ...value.bodyParagraphs, value.closing].map((item) => item.trim());
  if (paragraphs.some((item) => !item)) throw Object.assign(new Error("Cover letter paragraphs cannot be empty."), { code: "VALIDATION_FAILED" });
  const text = paragraphs.join(" ");
  const words = text.split(/\s+/).filter(Boolean).length;
  if (words < 150 || words > 350) throw Object.assign(new Error(`Cover letter must contain 150 to 350 words; received ${words}.`), { code: "VALIDATION_FAILED" });
  if (LATEX.test(text)) throw Object.assign(new Error("Cover letter response contains LaTeX commands."), { code: "VALIDATION_FAILED" });
  for (const pattern of FORBIDDEN) if (pattern.test(text)) throw Object.assign(new Error("Cover letter contains a forbidden claim or separator."), { code: "VALIDATION_FAILED" });
  const allowedNumbers = allBankNumbers(bank);
  for (const number of text.match(NUMBERS) || []) if (!allowedNumbers.has(number.toLowerCase())) throw Object.assign(new Error(`Cover letter introduced unverified number '${number}'.`), { code: "VALIDATION_FAILED" });
  const generic = findGenericPhrases(text, { jobDescription: options.jobDescription });
  if (generic.length) throw Object.assign(new Error(`Cover letter contains generic AI phrasing: ${generic.join(", ")}.`), { code: "VALIDATION_FAILED" });
  return { version: 1, opening: paragraphs[0], bodyParagraphs: paragraphs.slice(1, 3), closing: paragraphs[3], wordCount: words };
}

export const COVER_LETTER_SCHEMA = { type: "object", additionalProperties: false, properties: {
  version: { type: "integer", enum: [1] }, opening: { type: "string" }, bodyParagraphs: { type: "array", minItems: 2, maxItems: 2, items: { type: "string" } }, closing: { type: "string" },
}, required: FIELDS };
