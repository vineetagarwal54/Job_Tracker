import { textContainsTerm, canonicalizeTerm } from "./protectedTerms.js";
import { requirementCoveredByText } from "./requirementCoverage.js";

export function missingJobSkills({ extraction, analysis, renderedSkills = [], bulletTexts = {} }) {
  const haystack = [...renderedSkills.map((group) => `${group.label} ${(group.items || []).join(" ")}`), ...Object.values(bulletTexts || {})].join(" \n ");
  const terms = new Map();
  for (const keyword of extraction?.keywords || []) if (keyword.category === "technical") terms.set(keyword.normalized, keyword.value || keyword.normalized);
  for (const term of analysis?.mustHaveKeywords || []) terms.set(canonicalizeTerm(term), term);
  for (const term of analysis?.niceToHaveKeywords || []) terms.set(canonicalizeTerm(term), term);
  return [...new Set([...terms].filter(([normalized, value]) => normalized && !requirementCoveredByText(haystack, value)).map(([, value]) => value))];
}
