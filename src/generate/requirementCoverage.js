import { canonicalizeTerm, textContainsTerm } from "./protectedTerms.js";

// Deliberately small, explicit concept rules. Each outer array is an OR option;
// every term inside one option is required. This supports useful requirement
// semantics without fuzzy similarity or inferred technologies.
const CONCEPT_OPTIONS = Object.freeze({
  containers: [["docker"], ["kubernetes"]],
  "full-stack development": [["full-stack"]],
  "sql databases": [["sql"], ["postgresql"], ["mysql"]],
  "document store design": [["mongodb", "schema design"], ["dynamodb", "schema design"], ["nosql databases", "schema design"]],
  "production shipped applications": [["production", "shipped"]],
});

function termMatch(sources, term) {
  const matchingIds = sources.filter((source) => textContainsTerm(source.text, term)).map((source) => source.id);
  return { covered: matchingIds.length > 0, matchingIds };
}

function all(sources, terms) {
  const results = terms.map((term) => evaluateExpression(sources, term));
  return { covered: results.every((result) => result.covered), matchingIds: [...new Set(results.flatMap((result) => result.matchingIds))] };
}

function any(sources, terms) {
  const results = terms.map((term) => evaluateExpression(sources, term));
  const covered = results.filter((result) => result.covered);
  return { covered: covered.length > 0, matchingIds: [...new Set(covered.flatMap((result) => result.matchingIds))] };
}

function evaluateExpression(sources, value) {
  const expression = String(value || "").trim();
  const normalized = canonicalizeTerm(expression);
  if (!normalized) return { covered: false, matchingIds: [] };

  const direct = termMatch(sources, normalized);
  if (direct.covered) return direct;

  const concept = CONCEPT_OPTIONS[normalized];
  if (concept) {
    const options = concept.map((requiredTerms) => all(sources, requiredTerms));
    const covered = options.filter((option) => option.covered);
    return { covered: covered.length > 0, matchingIds: [...new Set(covered.flatMap((option) => option.matchingIds))] };
  }

  // A parenthetical comma list is an explicit alternative set, for example
  // browser automation (Playwright, Puppeteer, Selenium).
  const parenthetical = expression.match(/\(([^)]+)\)/)?.[1];
  if (parenthetical && parenthetical.includes(",")) return any(sources, parenthetical.split(",").map((item) => item.trim()).filter(Boolean));

  const orParts = expression.split(/\s+or\s+/i).map((item) => item.trim()).filter(Boolean);
  if (orParts.length > 1) return any(sources, orParts);

  // Slash alternatives are limited to simple names, preserving compounds such
  // as CI/CD and paths while supporting JavaScript/TypeScript.
  if (/^[A-Za-z0-9.+#-]+\s*\/\s*[A-Za-z0-9.+#-]+(?:\s*\/\s*[A-Za-z0-9.+#-]+)*$/.test(expression) && !/^ci\s*\/\s*cd$/i.test(expression)) {
    return any(sources, expression.split("/").map((item) => item.trim()));
  }

  const andParts = expression.split(/\s+and\s+/i).map((item) => item.trim()).filter(Boolean);
  if (andParts.length > 1) return all(sources, andParts);

  return direct;
}

export function evaluateRequirementCoverage(sources, requirement) {
  const result = evaluateExpression(sources, requirement);
  return { normalized: canonicalizeTerm(requirement), value: requirement, ...result };
}

export function requirementCoveredByText(text, requirement) {
  return evaluateRequirementCoverage([{ id: "rendered-resume", text: String(text || "") }], requirement).covered;
}
