const TECHNICAL_TERMS = ["TensorRT-LLM", "full-stack", "end-to-end", "CI/CD", "4-bit"];

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
