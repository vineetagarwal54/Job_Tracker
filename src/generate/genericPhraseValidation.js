export const GENERIC_PHRASES = Object.freeze([
  "i am excited to apply", "i am thrilled", "perfect fit", "dynamic team", "cutting-edge",
  "passionate about", "leverage my skills", "i believe my background", "i am confident that", "fast-paced environment",
]);

export function findGenericPhrases(text, options = {}) {
  const haystack = String(text || "").toLowerCase();
  const jd = String(options.jobDescription || "").toLowerCase();
  return GENERIC_PHRASES.filter((phrase) => haystack.includes(phrase) && !jd.includes(phrase));
}
