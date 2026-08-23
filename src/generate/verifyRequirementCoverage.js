import fs from "node:fs";
import { getCanonicalBaseResume } from "./baseResumes.js";
import { scoreCoverage } from "./coverageScoring.js";
import { extractJobKeywords } from "./keywordExtraction.js";
import { buildRelevancePlan } from "./relevanceIntelligence.js";
import { skillClassification, skillEvidenceIds } from "./skillInventory.js";
import { textContainsTerm } from "./protectedTerms.js";

const bank = JSON.parse(fs.readFileSync(new URL("./content-bank.json", import.meta.url), "utf8"));
const assert = (condition, message) => { if (!condition) throw new Error(message); };

const requirements = [
  "Python or JavaScript/TypeScript",
  "SQL and document store design",
  "browser automation (Playwright, Puppeteer, Selenium)",
  "containers",
  "full-stack development",
  "production shipped applications",
];
const noisyWords = ["change", "same", "including", "without", "sites", "169+", "company", "copy", "benefits"];
const description = `Must have ${requirements.join("; ")}. What will change is the same across sites, including 169+ company locations, without affecting company copy or benefits. GCP is preferred, and GCP knowledge is useful.`;
const analysis = { mustHaveKeywords: requirements, niceToHaveKeywords: ["GCP"], responsibilities: [] };
const extraction = extractJobKeywords(description);
const renderedSkills = [
  { id: "languages", label: "Languages", items: ["Python", "JavaScript", "TypeScript", "SQL"] },
  { id: "data", label: "Databases", items: ["PostgreSQL", "MongoDB", "schema design"] },
  { id: "testing", label: "Testing", items: ["Selenium"] },
  { id: "platform", label: "Cloud", items: ["Docker", "Kubernetes"] },
];
const extraSources = [{ id: "summary", text: "Full-stack engineer who shipped production applications." }];
const coverage = scoreCoverage(bank, extraction, { analysis, renderedSkills, bulletIds: [], extraSources });

// The previous exact whole-phrase behavior marked every one of these missing.
const legacyCovered = requirements.filter((requirement) => [...renderedSkills.flatMap((group) => group.items), extraSources[0].text].some((text) => textContainsTerm(text, requirement))).length;
assert(legacyCovered === 0, `Regression fixture no longer represents the six exact-phrase false negatives (${legacyCovered} were exact matches)`);
assert(coverage.mustHave.covered.length === requirements.length && coverage.mustHave.percentage === 100, "Concept-level must-have coverage did not correct all six false negatives");
assert(coverage.niceToHave.missing.some((item) => item.value === "GCP"), "An available but unrendered knowledge skill should remain a missing preferred requirement");

const compositeAnalysis = { mustHaveKeywords: ["SQL and document store design", "production shipped applications"], niceToHaveKeywords: [], responsibilities: [] };
const incompleteComposite = scoreCoverage(bank, extraction, { analysis: compositeAnalysis, renderedSkills: [{ id: "partial", label: "Partial", items: ["SQL", "MongoDB"] }], bulletIds: [], extraSources: [{ id: "production-only", text: "Production applications." }] });
assert(incompleteComposite.mustHave.percentage === 0, "Composite requirements were covered without every necessary component");

const base = getCanonicalBaseResume("swe-cloud");
const plan = buildRelevancePlan({ bank, base, job: { description }, extraction, analysis });
const unsupported = new Set(plan.unsupportedMissing.map((item) => item.term));
for (const word of noisyWords) assert(!unsupported.has(word), `Generic unsupported-gap noise '${word}' was retained`);
for (const alternative of ["playwright", "puppeteer"]) assert(!unsupported.has(alternative), `Unselected OR alternative '${alternative}' was reported missing after the requirement was covered`);

const gcpCandidate = plan.candidates.find((candidate) => candidate.type === "skill-edit" && /gcp/i.test(candidate.replacementItem));
assert(gcpCandidate, "GCP knowledge was not available as a Skills-only tailoring candidate");
assert(skillClassification(bank, gcpCandidate.replacementItem) === "knowledge" && skillEvidenceIds(bank, gcpCandidate.replacementItem).length === 0, "GCP was incorrectly upgraded to professional hands-on evidence");
assert(![...unsupported].some((term) => /gcp|google cloud/.test(term)), "Verified GCP knowledge was reported unsupported");

console.log(JSON.stringify({
  regressionRequirements: requirements.length,
  requirementCoverageBefore: `${legacyCovered}/${requirements.length}`,
  requirementCoverageAfter: `${coverage.mustHave.covered.length}/${requirements.length}`,
  falseNegativesCorrected: requirements,
  unsupportedNoiseBefore: noisyWords.length,
  unsupportedNoiseAfter: noisyWords.filter((word) => unsupported.has(word)).length,
  intentionallyMissing: ["GCP (available as knowledge for Skills-only tailoring, absent from this rendered fixture)"],
  gcpSkillsOnly: true,
}, null, 2));
