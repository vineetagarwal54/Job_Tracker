import fs from "node:fs";
import { getCanonicalBaseResume } from "./baseResumes.js";
import { extractJobKeywords } from "./keywordExtraction.js";
import { applyTailoringDiff, EMPTY_TAILORING_DIFF } from "./tailoringDiff.js";
import { buildRelevancePlan, scoreBaseResume, summarizeCoverageChange } from "./relevanceIntelligence.js";

const bank = JSON.parse(fs.readFileSync(new URL("./content-bank.json", import.meta.url), "utf8"));
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const analysis = (mustHaveKeywords = [], niceToHaveKeywords = []) => ({ mustHaveKeywords, niceToHaveKeywords, responsibilities: [] });
const planFor = (base, description, jobAnalysis) => {
  const extraction = extractJobKeywords(description);
  return { extraction, plan: buildRelevancePlan({ bank, base, job: { description }, extraction, analysis: jobAnalysis }) };
};

// A base that already says what the JD asks for produces no cosmetic work.
const mobile = getCanonicalBaseResume("mobile");
const matched = planFor(mobile, "React Native TypeScript Redux Toolkit WebRTC mobile development", analysis(["React Native"], ["WebRTC"]));
assert(matched.plan.baseCoverage.mustHave.percentage === 100, "Well-matched base must cover the must-have");
assert(matched.plan.candidates.length === 0, "Well-matched base should not produce tailoring candidates");
const unchanged = applyTailoringDiff({ bank, base: mobile, diff: { ...EMPTY_TAILORING_DIFF, baseResumeId: mobile.id }, extraction: matched.extraction, analysis: analysis(["React Native"], ["WebRTC"]), relevancePlan: matched.plan });
assert(JSON.stringify(unchanged.base) === JSON.stringify(mobile), "Zero-candidate tailoring changed the base");

// Repetition increases deterministic priority, while an incidental skill is not stuffed in.
const repeated = planFor(mobile, "Kubernetes Kubernetes Kubernetes Django", analysis());
const kubernetes = repeated.plan.terms.find((term) => term.term === "kubernetes");
const django = repeated.plan.terms.find((term) => term.term === "django");
assert(kubernetes.weight > django.weight, "Repeated technical term did not outrank an incidental term");
assert(repeated.plan.candidates.some((candidate) => candidate.matchedTerms.includes("kubernetes")), "Repeated supported term has no useful candidate");
assert(!repeated.plan.candidates.some((candidate) => candidate.matchedTerms.includes("django")), "Incidental one-off skill was offered for stuffing");

// A supported missing must-have may be added from the verified skill bank.
const missing = planFor(mobile, "Must have Kubernetes. Kubernetes Kubernetes cloud deployment.", analysis(["Kubernetes"]));
const skillCandidate = missing.plan.candidates.find((candidate) => candidate.type === "skill-edit" && candidate.replacementItem === "Kubernetes");
assert(skillCandidate, "Supported missing must-have did not produce a verified skill candidate");
const tailored = applyTailoringDiff({
  bank, base: mobile, extraction: missing.extraction, analysis: analysis(["Kubernetes"]), relevancePlan: missing.plan,
  diff: { version: 1, baseResumeId: mobile.id, bulletChanges: [], projectSwap: null, summaryChange: null, skillChanges: [{ candidateId: skillCandidate.id, type: "add", groupLabel: skillCandidate.groupLabel, replacementItem: skillCandidate.replacementItem, justification: "Kubernetes is an explicit must-have in the JD." }] },
});
assert(tailored.acceptedDiff.skillChanges.length === 1, "Valid high-benefit skill edit was rejected");
const after = scoreBaseResume(bank, tailored.base, missing.extraction, analysis(["Kubernetes"]));
const improvement = summarizeCoverageChange(missing.plan.baseCoverage, after);
assert(after.weightedCoveragePercentage >= missing.plan.baseCoverage.weightedCoveragePercentage, "Tailoring reduced relevant coverage");
assert(improvement.newlyCoveredMustHaves.includes("kubernetes"), "Final actual selection did not report its newly covered must-have");
const fabricatedCandidate = applyTailoringDiff({
  bank, base: mobile, extraction: missing.extraction, analysis: analysis(["Kubernetes"]), relevancePlan: missing.plan,
  diff: { version: 1, baseResumeId: mobile.id, bulletChanges: [], skillChanges: [{ candidateId: "skill-edit:invented", type: "add", groupLabel: skillCandidate.groupLabel, replacementItem: "Kubernetes", justification: "Kubernetes is required." }] },
});
assert(fabricatedCandidate.acceptedDiff.skillChanges.length === 0 && fabricatedCandidate.rejected.some((item) => /minimum-benefit candidate/.test(item.reason)), "Unranked or fabricated candidate was accepted");

// Unsupported requirements remain explicit gaps and never become candidates.
const unsupported = planFor(mobile, "Must have Rust. Rust Rust systems programming.", analysis(["Rust"]));
assert(unsupported.plan.unsupportedMissing.some((item) => item.term === "rust"), "Unsupported skill was not reported missing");
assert(!unsupported.plan.candidates.some((candidate) => candidate.matchedTerms.includes("rust")), "Unsupported skill became a tailoring candidate");

// Benefits and generic company prose never become resume gaps, while concrete
// unsupported technologies and processing requirements remain visible.
const noisyDescription = "What makes this a great company for people: paid vacation, health benefits, and excellent culture. Must have ASP.NET Core, C#, AWS CDK, EventBridge, PDF processing, and image processing.";
const noisyAnalysis = analysis(["ASP.NET Core", "C#", "AWS CDK", "EventBridge", "PDF processing", "image processing"]);
const noisy = planFor(mobile, noisyDescription, noisyAnalysis);
const noisyGaps = new Set(noisy.plan.unsupportedMissing.map((item) => item.term));
for (const term of ["great", "company", "people", "vacation", "paid", "what", "health", "benefits", "culture"]) assert(!noisyGaps.has(term), `Generic JD prose '${term}' leaked into unsupported gaps`);
for (const term of ["asp.net core", "c#", "aws cdk", "eventbridge", "pdf processing", "image processing"]) assert(noisyGaps.has(term), `Technical unsupported gap '${term}' was filtered out`);

// Conservative synonyms resolve to existing verified knowledge instead of
// becoming false unsupported gaps.
const aliasDescription = "Object-oriented programming, relational databases, SNS/SQS, code review, and distributed caching are required.";
const aliases = planFor(mobile, aliasDescription, analysis(["object-oriented programming", "relational databases", "SNS/SQS", "code review", "distributed caching"]));
const aliasGaps = new Set(aliases.plan.unsupportedMissing.map((item) => item.term));
for (const term of ["object-oriented programming", "relational databases", "sns", "sqs", "code review", "distributed caching"]) assert(!aliasGaps.has(term), `Verified alias '${term}' was reported unsupported`);

// A quantified source bullet cannot be offered in exchange for weaker keyword-only evidence.
const metricBank = {
  summary: { byVariant: {}, byEmphasis: {} }, skillGroups: [], projects: [],
  experience: [{ id: "exp", org: "Example", role: "Engineer", bullets: [
    { id: "measured", text: "Improved request throughput by 35% through verified service optimizations.", skills: [], priority: 1 },
    { id: "keyword-only", text: "Built Kubernetes services for cloud deployment workflows.", skills: ["Kubernetes"], priority: 2 },
  ] }],
};
const metricBase = { id: "metric-base", variant: "fullstack", summary: "Software engineer.", skills: [], experience: [{ entryId: "exp", bullets: [{ sourceBulletId: "measured", text: metricBank.experience[0].bullets[0].text }] }], projects: [], education: { educationId: "education" } };
const metricJd = "Kubernetes Kubernetes Kubernetes";
const metricExtraction = extractJobKeywords(metricJd);
const metricPlan = buildRelevancePlan({ bank: metricBank, base: metricBase, job: { description: metricJd }, extraction: metricExtraction, analysis: analysis(["Kubernetes"]) });
assert(!metricPlan.candidates.some((candidate) => candidate.type === "bullet-swap" && candidate.baseBulletId === "measured"), "Quantified bullet was offered for a weaker keyword-only replacement");

console.log(JSON.stringify({ wellMatchedZeroChange: true, supportedMustHaveChanged: true, repeatedTermPriority: true, unsupportedNeverInvented: true, noisyProseFiltered: true, technicalGapsPreserved: true, conservativeAliasesResolved: true, strongMetricPreserved: true, coverageImprovedOrPreserved: true }, null, 2));
