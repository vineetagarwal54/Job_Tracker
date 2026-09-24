import bank from "./content-bank.json" with { type: "json" };
import { canonicalBases, getCanonicalBaseResume } from "./baseResumes.js";
import { buildVerifiedEvidenceCatalog, indexVerifiedEvidenceCatalog, projectEvidenceId, skillEvidenceId } from "./evidenceCatalog.js";
import { semanticGoldenFixtures } from "./semanticGoldenFixtures.js";
import { planSemanticResumeChanges } from "./semanticResumePlanner.js";
import { computeSemanticRequirementCoverage } from "./semanticRequirementCoverage.js";
import { applyTailoringDiff, TAILORING_CAPS } from "./tailoringDiff.js";

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const clone = (value) => JSON.parse(JSON.stringify(value));
const normalizedPlan = (plan) => JSON.stringify({
  diff: plan.diff,
  candidateOrdering: plan.evaluatedCandidates,
  selectedUtilities: plan.acceptedCandidates,
  rejected: plan.rejected.map((item) => ({ candidateId: item.candidateId, type: item.type, reason: item.reason })),
});

function requirement(id, { priority = "must", kind = "experience", expectation = "accomplishment", current = [], candidate = [], knowledge = [], status } = {}) {
  return {
    id,
    text: id,
    priority,
    kind,
    evidenceExpectation: expectation,
    currentEvidenceIds: current,
    candidateEvidenceIds: candidate,
    knowledgeSkillIds: knowledge,
    status: status || (current.length ? "covered" : candidate.length ? "coverable" : knowledge.length ? "knowledge-only" : "unsupported"),
  };
}

function syntheticFixture({ bullets = [], alternatives = [], skills = ["Base"], skillInventory = [], handsOnEvidence = {}, projects = [], alternativeProjects = [], summaries = [] } = {}) {
  const baseProjects = projects.length ? projects : [{ entryId: "p1", title: "Base Project", role: "Builder", dates: "", bullets: [{ sourceBulletId: "p1-b1", text: "Built the base project." }] }];
  const base = {
    id: "synthetic",
    variant: "cloud-backend",
    summary: "Base summary.",
    skills: [{ label: "Backend", items: skills }],
    experience: [{ entryId: "exp", title: "Example", role: "Engineer", dates: "", location: "", bullets: bullets.map((item) => ({ sourceBulletId: item.id, text: item.text })) }],
    projects: clone(baseProjects),
    education: { educationId: "edu", degree: "Degree", dates: "", gpa: "", notes: [] },
  };
  const allSkills = [...new Set([...skills, ...skillInventory.map((item) => item.skill)])].map((skill) => skillInventory.find((item) => item.skill === skill) || ({ id: skillEvidenceId(skill), skill, groupIds: ["backend"] }));
  const catalog = {
    version: 2,
    base: {
      id: base.id,
      summary: { id: `summary:base:${base.id}`, text: base.summary },
      experience: [{ id: "experience:exp", entryId: "exp", bullets: bullets.map((item) => ({ id: item.id, text: item.text, lockedMetrics: item.lockedMetrics || [] })) }],
      projects: baseProjects.map((project) => ({ id: projectEvidenceId(project.entryId), projectId: project.entryId, title: project.title, bullets: project.bullets.map((bullet) => ({ id: bullet.sourceBulletId, text: bullet.text, lockedMetrics: bullet.lockedMetrics || [] })) })),
      education: { id: "education:edu", educationId: "edu", degree: "Degree" },
      renderedSkills: [{ group: "Backend", items: skills.map((skill) => ({ id: skillEvidenceId(skill), skill })) }],
    },
    alternatives: {
      experienceBullets: alternatives.map((item) => ({ id: item.id, entryId: "exp", text: item.text, lockedMetrics: item.lockedMetrics || [] })),
      projects: clone(alternativeProjects),
      summaries: clone(summaries),
      skills: { defaultClassification: "knowledge", inventory: allSkills, handsOnEvidence },
    },
  };
  return { base, catalog, evidenceIndex: indexVerifiedEvidenceCatalog(catalog) };
}

function plan(input, requirements) {
  return planSemanticResumeChanges({ ...input, requirements });
}

// Marginal coverage: Skill A covers R1 + R2; Skill B covers only R1.
const marginalInput = syntheticFixture({
  skills: ["Base"],
  skillInventory: [
    { id: "skill:skill-a", skill: "Skill A", groupIds: ["backend"] },
    { id: "skill:skill-b", skill: "Skill B", groupIds: ["backend"] },
  ],
});
const marginalPlan = plan(marginalInput, [
  requirement("r1", { priority: "preferred", kind: "technical-skill", expectation: "knowledge", candidate: ["skill:skill-a", "skill:skill-b"] }),
  requirement("r2", { kind: "technical-skill", expectation: "knowledge", candidate: ["skill:skill-a"] }),
]);
assert(marginalPlan.diff.skillChanges.some((change) => change.replacementItem === "Skill A"), "multi-requirement candidate was not selected");
const skillBAfterA = marginalPlan.evaluatedCandidates.find((item) => item.iteration > 1 && item.candidateId === "deterministic:skill:add:skill:skill-b");
assert(skillBAfterA && skillBAfterA.marginalUtility <= 0, "competing candidate retained duplicate first-coverage credit");
const selectedA = marginalPlan.acceptedCandidates.find((item) => item.addedEvidenceIds.includes("skill:skill-a"));
assert(selectedA?.mustCoverageGained.includes("r2") && selectedA?.preferredCoverageGained.includes("r1"), "A+B candidate did not receive only its then-uncovered requirement value");

// A cheaper candidate covers A first; the later A+B project is rescored for B
// only and therefore falls below the useful-utility boundary.
const overlapProjectInput = syntheticFixture({
  skills: ["Base"],
  skillInventory: [{ id: "skill:overlap-a", skill: "Overlap A", groupIds: ["backend"] }],
  alternativeProjects: [{ id: "project:p2", projectId: "p2", title: "Large Project", role: "Builder", bullets: [{ id: "p2-b1", text: "Built " + "substantial verified project evidence ".repeat(16) }] }],
});
const overlapProjectPlan = plan(overlapProjectInput, [
  requirement("overlap-a", { priority: "preferred", kind: "technical-skill", expectation: "knowledge", candidate: ["skill:overlap-a", "project:p2"] }),
  requirement("remaining-b", { priority: "preferred", candidate: ["project:p2"] }),
]);
const rescoredProject = overlapProjectPlan.evaluatedCandidates.find((item) => item.iteration > 1 && item.candidateId === "deterministic:project:p1:p2");
assert(overlapProjectPlan.diff.skillChanges.some((change) => change.replacementItem === "Overlap A") && rescoredProject?.preferredCoverageGained.join(",") === "remaining-b", "A+B candidate was not rescored for only remaining B value after A was planned");

// Exact bounded assignment: selecting B1 alone blocks B2's slot, while the
// B1+B2 matching covers more than either best single pair.
const assignmentInput = syntheticFixture({
  bullets: [{ id: "a1", text: "Base one." }, { id: "a2", text: "Base two." }],
  alternatives: [{ id: "b1", text: "Alternative one." }, { id: "b2", text: "Alternative two." }],
});
const assignmentPlan = plan(assignmentInput, [
  requirement("assign-r1", { candidate: ["b1"] }),
  requirement("assign-r2", { candidate: ["b1"] }),
  requirement("assign-r3", { candidate: ["b2"] }),
]);
assert(assignmentPlan.diff.bulletChanges.length === 2 && new Set(assignmentPlan.diff.bulletChanges.map((change) => change.replacementBulletId)).size === 2, "exact bullet matching did not select the higher-value two-pair assignment");

// Project gains cannot compensate for loss of the sole current MUST support.
const projectInput = syntheticFixture({
  projects: [{ entryId: "p1", title: "Must Project", role: "Builder", dates: "", bullets: [{ sourceBulletId: "p1-b1", text: "Must evidence." }] }],
  alternativeProjects: [{ id: "project:p2", projectId: "p2", title: "Preferred Project", role: "Builder", bullets: [{ id: "p2-b1", text: "Preferred evidence." }] }],
});
const projectPlan = plan(projectInput, [
  requirement("project-must", { current: ["project:p1"] }),
  requirement("project-pref-1", { priority: "preferred", candidate: ["project:p2"] }),
  requirement("project-pref-2", { priority: "preferred", candidate: ["p2-b1"] }),
]);
assert(!projectPlan.diff.projectSwap && projectPlan.rejected.some((item) => item.type === "project" && item.reason === "must-have coverage regression"), "project swap was allowed to trade away sole MUST support");

// A same-coverage swap wins when adding the skill would wrap the Skills line.
const swapSkills = ["GraphQL", "Node.js", "Express", "WebSocket", "Redis", "SQL"];
const skillSwapInput = syntheticFixture({ skills: swapSkills, skillInventory: [{ id: "skill:grpc", skill: "gRPC", groupIds: ["backend"] }] });
const protectedSkillRequirements = swapSkills.filter((skill) => skill !== "GraphQL").map((skill) => requirement(`keep-${skill}`, { kind: "technical-skill", expectation: "knowledge", current: [skillEvidenceId(skill)] }));
const skillSwapPlan = plan(skillSwapInput, [...protectedSkillRequirements, requirement("need-grpc", { kind: "technical-skill", expectation: "knowledge", candidate: ["skill:grpc"] })]);
assert(skillSwapPlan.diff.skillChanges[0]?.type === "swap" && skillSwapPlan.diff.skillChanges[0]?.baseItem === "GraphQL", "lower-page-cost safe skill swap was not preferred to an addition");

// Explicit locked metrics are hard constraints, not score penalties.
const metricInput = syntheticFixture({ bullets: [{ id: "metric-base", text: "Reduced latency by 35%.", lockedMetrics: ["35%"] }], alternatives: [{ id: "metric-alt", text: "Improved service reliability." }] });
const metricPlan = plan(metricInput, [requirement("metric-gain", { candidate: ["metric-alt"] })]);
assert(!metricPlan.diff.bulletChanges.length && metricPlan.rejected.some((item) => item.reason === "Rejected because protected metric would be lost"), "locked 35% metric was not rejected before ranking");

// Rewrite opportunity is semantic and independent of the already-used swap cap.
const rewriteInput = syntheticFixture({
  bullets: [{ id: "rw-a1", text: "Base one." }, { id: "rw-a2", text: "Base two." }, { id: "rw-a3", text: "Base three." }, { id: "rw-a4", text: "Built a distributed service." }],
  alternatives: [{ id: "rw-b1", text: "Candidate one." }, { id: "rw-b2", text: "Candidate two." }, { id: "rw-b3", text: "Candidate three." }],
  skillInventory: [{ id: "skill:kubernetes", skill: "Kubernetes", groupIds: ["backend"] }],
  handsOnEvidence: { "skill:kubernetes": ["rw-a4"] },
});
const rewritePlan = plan(rewriteInput, [
  requirement("rw-r1", { candidate: ["rw-b1"] }),
  requirement("rw-r2", { candidate: ["rw-b2"] }),
  requirement("rw-r3", { candidate: ["rw-b3"] }),
  requirement("rw-current", { current: ["rw-a4"] }),
]);
assert(rewritePlan.diff.bulletChanges.length === 3 && rewritePlan.rewriteOpportunities.length === 1, "rewrite opportunity incorrectly depended on unused bullet capacity");

const strongerSwapInput = syntheticFixture({
  bullets: [{ id: "strong-a", text: "Built a distributed service." }],
  alternatives: [{ id: "strong-b", text: "Built a Kubernetes orchestration service." }],
  skillInventory: [{ id: "skill:kubernetes", skill: "Kubernetes", groupIds: ["backend"] }],
  handsOnEvidence: { "skill:kubernetes": ["strong-a"] },
});
const strongerSwapPlan = plan(strongerSwapInput, [
  requirement("strong-current", { current: ["strong-a"], candidate: ["strong-b"] }),
  requirement("strong-new", { candidate: ["strong-b"] }),
]);
assert(strongerSwapPlan.diff.bulletChanges.length === 1 && strongerSwapPlan.rewriteOpportunities.length === 0, "rewrite remained eligible after a superior verified swap was selected");

const zeroInput = syntheticFixture({ skills: ["Node.js"] });
const zeroPlan = plan(zeroInput, [requirement("already-covered", { kind: "technical-skill", expectation: "knowledge", current: ["skill:node.js"] })]);
assert(!zeroPlan.diff.summaryChange && !zeroPlan.diff.projectSwap && !zeroPlan.diff.bulletChanges.length && !zeroPlan.diff.skillChanges.length, "zero-change JD did not remain a valid success");

// Permanent determinism and safety properties for every semantic golden fixture.
const canonicalSnapshot = JSON.stringify(canonicalBases);
for (const fixture of semanticGoldenFixtures) {
  const base = getCanonicalBaseResume(fixture.baseResumeId);
  const { catalog } = buildVerifiedEvidenceCatalog(bank, base);
  const evidenceIndex = indexVerifiedEvidenceCatalog(catalog);
  const requirements = fixture.expected.requirements.map((expected, index) => {
    const valid = expected.validEvidenceIds || [];
    const knowledgeOnly = expected.status === "knowledge-only";
    const current = knowledgeOnly ? [] : valid.filter((id) => evidenceIndex.get(id)?.current);
    const candidate = knowledgeOnly ? [] : valid.filter((id) => evidenceIndex.has(id) && !evidenceIndex.get(id)?.current);
    const knowledge = knowledgeOnly ? valid.filter((id) => evidenceIndex.get(id)?.kind === "skill") : [];
    return requirement(`${fixture.id}-r${index + 1}`, {
      priority: expected.priority,
      kind: expected.evidenceExpectation === "accomplishment" ? "experience" : "technical-skill",
      expectation: expected.evidenceExpectation || (knowledgeOnly ? "knowledge" : "knowledge"),
      current,
      candidate,
      knowledge,
      status: knowledgeOnly ? "knowledge-only" : undefined,
    });
  });
  const first = planSemanticResumeChanges({ base, catalog, evidenceIndex, requirements });
  const second = planSemanticResumeChanges({ base, catalog, evidenceIndex, requirements });
  const applied = applyTailoringDiff({ bank, base, diff: first.diff, semanticRequirements: requirements });
  const beforeCoverage = computeSemanticRequirementCoverage(requirements, base);
  const afterCoverage = computeSemanticRequirementCoverage(requirements, applied.base, applied.acceptedDiff);
  assert(normalizedPlan(first) === normalizedPlan(second), `${fixture.id}: planner output is not byte-deterministic`);
  assert(first.baselineMustCoverage.every((id) => first.finalMustCoverage.includes(id)), `${fixture.id}: planned MUST coverage regressed`);
  assert(afterCoverage.mustHave.covered.length >= beforeCoverage.mustHave.covered.length, `${fixture.id}: applied complete diff regressed MUST coverage`);
  assert(first.acceptedCandidates.every((item) => item.marginalUtility > 0), `${fixture.id}: non-positive marginal candidate was accepted`);
  for (const accepted of first.acceptedCandidates) {
    const addedText = accepted.addedEvidenceIds.map((id) => evidenceIndex.get(id)?.value?.text || "").join(" ");
    const lostMetric = accepted.removedEvidenceIds.flatMap((id) => evidenceIndex.get(id)?.value?.lockedMetrics || []).find((metric) => !addedText.includes(metric));
    assert(!lostMetric, `${fixture.id}: accepted change removed protected metric '${lostMetric}'`);
    assert(!accepted.coverageLost.some((id) => first.baselineMustCoverage.includes(id)), `${fixture.id}: accepted change removed sole MUST evidence`);
  }
  for (const change of first.diff.bulletChanges) {
    const replacement = catalog.alternatives.experienceBullets.find((bullet) => bullet.id === change.replacementBulletId);
    assert(replacement?.entryId === change.entryId, `${fixture.id}: bullet swap crossed experience boundaries`);
  }
  assert(applied.base.projects.length === base.projects.length && Number(Boolean(first.diff.projectSwap)) <= TAILORING_CAPS.projectSwaps, `${fixture.id}: project count/cap changed`);
  for (const change of first.diff.skillChanges.filter((item) => item.type === "swap")) {
    const group = base.skills.find((item) => item.label === change.groupLabel);
    const appliedGroup = applied.base.skills.find((item) => item.label === change.groupLabel);
    assert(group?.items.includes(change.baseItem) && appliedGroup?.items.length === group.items.length, `${fixture.id}: skill swap did not preserve a same-group slot`);
  }
  const knowledgeIds = new Set((catalog.alternatives.skills.inventory || []).filter((skill) => !Object.hasOwn(catalog.alternatives.skills.handsOnEvidence || {}, skill.id)).map((skill) => skill.id));
  assert(first.acceptedCandidates.filter((item) => item.type === "bullet").every((item) => item.addedEvidenceIds.every((id) => !knowledgeIds.has(id))), `${fixture.id}: knowledge-only skill became accomplishment evidence`);
  assert(first.diff.bulletChanges.length <= TAILORING_CAPS.bulletChanges && first.diff.skillChanges.length <= TAILORING_CAPS.skillChanges, `${fixture.id}: tailoring caps were exceeded`);
}
assert(JSON.stringify(canonicalBases) === canonicalSnapshot, "canonical resume content changed during planner verification");

console.log(JSON.stringify({
  marginalUtility: true,
  exactBulletAssignment: true,
  mustMonotonicity: true,
  protectedMetricHardConstraint: true,
  skillSwap: true,
  semanticRewriteGate: true,
  zeroChange: true,
  deterministicGoldenFixtures: semanticGoldenFixtures.length,
  safetyProperties: ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"],
}, null, 2));
