import { getCanonicalBaseResume } from "./baseResumes.js";
import { buildTailoringBackoffQueue, fitTailoredBaseToOnePage, validateBaseProtections } from "./pageFitBackoff.js";

const clone = (value) => JSON.parse(JSON.stringify(value));
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const rejects = async (work, code) => { try { await work(); } catch (error) { assert(error.code === code, `Expected ${code}, received ${error.code}: ${error.message}`); return; } throw new Error(`Expected ${code}`); };
const canonical = getCanonicalBaseResume("mobile");
const emptyDiff = () => ({ version: 1, summaryChange: null, bulletChanges: [], projectSwap: null, skillChanges: [] });
const plan = (candidates = []) => ({ candidates });
const compileBy = (pagesFor) => async (base, context) => ({ pageCount: pagesFor(base, context), marker: context.reason });

// Tailoring that compiles on the first attempt is retained exactly.
const immediateBase = clone(canonical);
immediateBase.summary = `${immediateBase.summary} React Native.`;
const immediateDiff = emptyDiff();
immediateDiff.summaryChange = { candidateId: "summary-fit", summaryId: "variant:mobile", justification: "React Native" };
const immediate = await fitTailoredBaseToOnePage({ canonicalBase: canonical, tailoredBase: immediateBase, acceptedDiff: immediateDiff, relevancePlan: plan([{ id: "summary-fit", expectedGain: 10 }]), renderAndCompile: compileBy(() => 1) });
assert(immediate.attempts.length === 1 && immediate.backedOff.length === 0 && immediate.base.summary === immediateBase.summary, "Immediately fitting tailoring was not retained");

// Overflowing light rewrites are reverted before other change types.
const rewriteBase = clone(canonical);
const originalBullet = canonical.experience[0].bullets[0];
rewriteBase.experience[0].bullets[0].text = `${originalBullet.text} overflow-rewrite`;
const rewriteDiff = emptyDiff();
rewriteDiff.bulletChanges.push({ candidateId: "rewrite-overflow", type: "rewrite", entryId: canonical.experience[0].entryId, baseBulletId: originalBullet.sourceBulletId, rewrittenText: rewriteBase.experience[0].bullets[0].text, justification: "React Native" });
const rewriteFit = await fitTailoredBaseToOnePage({ canonicalBase: canonical, tailoredBase: rewriteBase, acceptedDiff: rewriteDiff, relevancePlan: plan([{ id: "rewrite-overflow", expectedGain: 20 }]), renderAndCompile: compileBy((base) => base.experience[0].bullets[0].text.includes("overflow-rewrite") ? 2 : 1) });
assert(rewriteFit.backedOff[0]?.type === "rewrite" && rewriteFit.base.experience[0].bullets[0].text === originalBullet.text, "Overflowing rewrite was not reverted");

// Skill additions are undone without removing any canonical skill item.
const skillBase = clone(canonical);
skillBase.skills[0].items.push("Overflow Skill");
const skillDiff = emptyDiff();
skillDiff.skillChanges.push({ candidateId: "skill-overflow", type: "add", groupLabel: skillBase.skills[0].label, replacementItem: "Overflow Skill", justification: "repeated skill" });
const skillFit = await fitTailoredBaseToOnePage({ canonicalBase: canonical, tailoredBase: skillBase, acceptedDiff: skillDiff, relevancePlan: plan([{ id: "skill-overflow", expectedGain: 7 }]), renderAndCompile: compileBy((base) => base.skills[0].items.includes("Overflow Skill") ? 2 : 1) });
assert(skillFit.backedOff[0]?.type === "skill" && JSON.stringify(skillFit.base.skills) === JSON.stringify(canonical.skills), "Overflowing skill addition was not cleanly reverted");

// Within a backoff tier, lower relevance is removed first.
const multipleBase = clone(canonical);
multipleBase.skills[0].items.push("Low Value", "High Value");
const multipleDiff = emptyDiff();
multipleDiff.skillChanges = [
  { candidateId: "skill-high", type: "add", groupLabel: multipleBase.skills[0].label, replacementItem: "High Value", justification: "high" },
  { candidateId: "skill-low", type: "add", groupLabel: multipleBase.skills[0].label, replacementItem: "Low Value", justification: "low" },
];
const multiplePlan = plan([{ id: "skill-high", expectedGain: 18 }, { id: "skill-low", expectedGain: 7 }]);
assert(buildTailoringBackoffQueue(multipleDiff, multiplePlan).map((item) => item.change.candidateId).join(",") === "skill-low,skill-high", "Backoff queue did not rank the lowest-value change first");
const multipleFit = await fitTailoredBaseToOnePage({ canonicalBase: canonical, tailoredBase: multipleBase, acceptedDiff: multipleDiff, relevancePlan: multiplePlan, renderAndCompile: compileBy((base) => base.skills[0].items.some((item) => item.endsWith("Value")) ? 2 : 1) });
assert(multipleFit.backedOff.map((item) => item.candidateId).join(",") === "skill-low,skill-high", "Multiple changes were not backed off by increasing relevance gain");

// A project swap is reverted one-for-one to the exact canonical project.
const projectBase = clone(canonical);
projectBase.projects[0] = { ...clone(projectBase.projects[0]), entryId: "overflow-project", title: "Overflow Project" };
const projectDiff = emptyDiff();
projectDiff.projectSwap = { candidateId: "project-overflow", baseProjectId: canonical.projects[0].entryId, replacementProjectId: "overflow-project", justification: "project evidence" };
const projectFit = await fitTailoredBaseToOnePage({ canonicalBase: canonical, tailoredBase: projectBase, acceptedDiff: projectDiff, relevancePlan: plan([{ id: "project-overflow", expectedGain: 12 }]), renderAndCompile: compileBy((base) => base.projects.some((project) => project.entryId === "overflow-project") ? 2 : 1) });
assert(projectFit.backedOff[0]?.type === "project" && JSON.stringify(projectFit.base.projects) === JSON.stringify(canonical.projects), "Overflowing project swap was not reverted one-for-one");

// Worst case returns the exact canonical base after all accepted tailoring is reverted.
const allBase = clone(canonical);
allBase.summary = `${canonical.summary} overflow-summary`;
allBase.skills[0].items.push("Overflow Skill");
allBase.experience[0].bullets[0].text = `${originalBullet.text} overflow-rewrite`;
allBase.projects[0] = { ...clone(allBase.projects[0]), entryId: "overflow-project" };
const allDiff = emptyDiff();
allDiff.summaryChange = { candidateId: "summary-all", summaryId: "variant:mobile", justification: "summary" };
allDiff.bulletChanges = rewriteDiff.bulletChanges;
allDiff.skillChanges = skillDiff.skillChanges;
allDiff.projectSwap = projectDiff.projectSwap;
const allPlan = plan([{ id: "summary-all", expectedGain: 8 }, { id: "rewrite-overflow", expectedGain: 9 }, { id: "skill-overflow", expectedGain: 7 }, { id: "project-overflow", expectedGain: 10 }]);
const allFit = await fitTailoredBaseToOnePage({ canonicalBase: canonical, tailoredBase: allBase, acceptedDiff: allDiff, relevancePlan: allPlan, renderAndCompile: compileBy((base) => JSON.stringify(base) === JSON.stringify(canonical) ? 1 : 2) });
assert(JSON.stringify(allFit.base) === JSON.stringify(canonical) && allFit.pageCount === 1, "Worst-case backoff did not return the exact canonical base");

// Protected structure and bullet counts can never fall below the base.
const missingBullet = clone(canonical); missingBullet.experience[0].bullets.pop();
await rejects(() => Promise.resolve(validateBaseProtections(canonical, missingBullet)), "BASE_STRUCTURE_VIOLATION");
const missingProject = clone(canonical); missingProject.projects.pop();
await rejects(() => Promise.resolve(validateBaseProtections(canonical, missingProject)), "BASE_STRUCTURE_VIOLATION");

// A broken canonical base is an explicit validation error, never a trim request.
await rejects(() => fitTailoredBaseToOnePage({ canonicalBase: canonical, tailoredBase: clone(canonical), acceptedDiff: emptyDiff(), relevancePlan: plan(), renderAndCompile: compileBy(() => 2) }), "BASE_VALIDATION_FAILED");

for (const result of [immediate, rewriteFit, skillFit, multipleFit, projectFit, allFit]) assert(result.pageCount === 1, "A page-fit scenario did not finish at exactly one page");
console.log(JSON.stringify({ fitsImmediately: true, rewriteReverted: true, skillReverted: true, lowestValueFirst: true, projectReverted: true, exactBaseFallback: true, structureProtected: true, baseOverflowExplicit: true, finalOnePage: true }, null, 2));
