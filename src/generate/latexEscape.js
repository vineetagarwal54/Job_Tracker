import { TECH_COMPOUNDS, PROTECTED_PHRASES } from "./protectedTerms.js";

// Wrap protected technical compounds and phrases in \mbox so a line break cannot
// split a hyphenated keyword or a two-word technical term ("TensorRT-LLM",
// "React Native"). Longest-first so a longer term is handled before any shorter
// overlap.
const TECHNICAL_TERMS = [...TECH_COMPOUNDS, ...PROTECTED_PHRASES].sort((a, b) => b.length - a.length);

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
