import { TECH_COMPOUNDS } from "./protectedTerms.js";

// Wrap protected technical compounds in \mbox so a line break cannot split a
// hyphenated keyword (a parser can rejoin "TensorRT-LLM" as "TensorRTLLM").
// Longest-first so "TensorRT-LLM" is handled before any shorter overlap.
const TECHNICAL_TERMS = [...TECH_COMPOUNDS].sort((a, b) => b.length - a.length);

export function escapeLatex(value) {
  return String(value ?? "").replace(/[&%$#_{}~^\\]/g, (character) => {
    const replacements = {
      "&": "\\&", "%": "\\%", "$": "\\$", "#": "\\#", "_": "\\_",
      "{": "\\{", "}": "\\}", "~": "\\textasciitilde{}", "^": "\\textasciicircum{}", "\\": "\\textbackslash{}",
    };
    return replacements[character];
  });
}

export function escapeLatexWithProtectedTerms(value) {
  let escaped = escapeLatex(value);
  for (const term of TECHNICAL_TERMS) {
    escaped = escaped.replaceAll(term, `\\mbox{${term}}`);
  }
  return escaped;
}
