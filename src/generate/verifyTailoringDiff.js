import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyTailoringDiff, EMPTY_TAILORING_DIFF, TAILORING_CAPS } from "./tailoringDiff.js";
import { getCanonicalBaseResume } from "./baseResumes.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const bank = JSON.parse(fs.readFileSync(path.join(here, "content-bank.json"), "utf8"));
const base = getCanonicalBaseResume("swe-cloud");
const extraction = { keywords: ["sql", "mobile", "credentials", "kubernetes", "django"].map((normalized) => ({ normalized, value: normalized })) };
const analysis = { mustHaveKeywords: ["sql", "kubernetes", "django"], niceToHaveKeywords: ["mobile", "credentials"], responsibilities: ["improve SQL performance"] };
const assert = (condition, message) => { if (!condition) throw new Error(`FAIL: ${message}`); };
const apply = (diff) => applyTailoringDiff({ bank, base, diff: { version: 1, baseResumeId: base.id, bulletChanges: [], skillChanges: [], ...diff }, extraction, analysis });
const counts = (resume) => ({ experience: resume.experience.length, projects: resume.projects.length, education: Boolean(resume.education), skills: resume.skills.length, bullets: resume.experience.reduce((sum, entry) => sum + entry.bullets.length, 0) });
const originalCounts = counts(base);

const zero = apply(EMPTY_TAILORING_DIFF);
assert(JSON.stringify(zero.base) === JSON.stringify(base), "zero-change diff preserves the base byte-for-byte");

const swap = apply({ bulletChanges: [{ type: "swap", entryId: "xelpmoc-software-engineer", baseBulletId: "xelpmoc-tourism-backend", replacementBulletId: "xelpmoc-credentials-wallet", justification: "The JD emphasizes credentials." }] });
assert(swap.acceptedDiff.bulletChanges.length === 1 && swap.base.experience.find((entry) => entry.entryId === "xelpmoc-software-engineer").bullets.some((bullet) => bullet.sourceBulletId === "xelpmoc-credentials-wallet"), "same-experience bullet swap applied");

const rewriteText = "Reduced SQL API response time from 75s to under 10s and raised throughput 4x by refactoring SQL joins, indexing high-traffic tables, and adding a Redis caching layer.";
const rewrite = apply({ bulletChanges: [{ type: "rewrite", entryId: "xelpmoc-software-engineer", baseBulletId: "xelpmoc-sql-redis", rewrittenText: rewriteText, justification: "The JD requires SQL performance work." }] });
assert(rewrite.acceptedDiff.bulletChanges.length === 1 && rewrite.base.experience.find((entry) => entry.entryId === "xelpmoc-software-engineer").bullets[0].text === rewriteText, "justified light rewrite applied");

const project = apply({ projectSwap: { baseProjectId: "serverless-video-analytics", replacementProjectId: "terrapin-events", justification: "The JD requires Kubernetes." } });
assert(project.acceptedDiff.projectSwap?.replacementProjectId === "terrapin-events" && project.base.projects.length === base.projects.length, "one-for-one project swap applied");

const skill = apply({ skillChanges: [{ type: "add", groupLabel: "Backend", replacementItem: "Django", justification: "The JD requires Django." }] });
assert(skill.acceptedDiff.skillChanges.length === 1 && skill.base.skills.find((group) => group.label === "Backend").items.includes("Django"), "verified skill addition applied");

const capChanges = [
  { type: "swap", entryId: "xelpmoc-software-engineer", baseBulletId: "xelpmoc-tourism-backend", replacementBulletId: "xelpmoc-credentials-wallet", justification: "mobile" },
  { type: "swap", entryId: "xelpmoc-software-engineer", baseBulletId: "xelpmoc-webrtc", replacementBulletId: "xelpmoc-firebase-twilio", justification: "mobile" },
  { type: "swap", entryId: "servbeyond-enterprise-ai-platform-intern", baseBulletId: "servbeyond-sharepoint-retrieval", replacementBulletId: "servbeyond-company-genai-assistant", justification: "mobile" },
  { type: "swap", entryId: "svipes-software-engineer", baseBulletId: "svipes-video-perf", replacementBulletId: "svipes-screens", justification: "mobile" },
];
const capped = apply({ bulletChanges: capChanges });
assert(capped.acceptedDiff.bulletChanges.length <= TAILORING_CAPS.bulletChanges && capped.rejected.some((item) => /cap exceeded/.test(item.reason)), "bullet cap enforced");

const protectedAttempt = apply({ removeExperienceIds: ["runara-ml-inference-engineer-intern"], removeEducation: true, removeSkills: true });
assert(JSON.stringify(counts(protectedAttempt.base)) === JSON.stringify(originalCounts) && protectedAttempt.rejected.some((item) => item.type === "protected-structure"), "protected content removal rejected");

const fabricated = apply({
  bulletChanges: [{ type: "rewrite", entryId: "xelpmoc-software-engineer", baseBulletId: "xelpmoc-sql-redis", rewrittenText: "Reduced API response time by 99% with Rust.", justification: "The JD requires SQL." }],
  skillChanges: [{ type: "add", groupLabel: "Backend", replacementItem: "Rust", justification: "The JD requires Django." }],
});
assert(fabricated.acceptedDiff.bulletChanges.length === 0 && fabricated.acceptedDiff.skillChanges.length === 0 && fabricated.rejected.length === 2, "fabricated claims and skills rejected");

const repeatedVerb = apply({ bulletChanges: [{ type: "rewrite", entryId: "xelpmoc-software-engineer", baseBulletId: "xelpmoc-sql-redis", rewrittenText: rewriteText.replace(/^Reduced/, "Architected"), justification: "The JD requires SQL performance work." }] });
assert(repeatedVerb.acceptedDiff.bulletChanges.length === 0 && repeatedVerb.rejected.some((item) => /repeated opening action verb/.test(item.reason)), "tailoring was allowed to worsen opening-action-verb duplication");

for (const result of [zero, swap, rewrite, project, skill, capped, protectedAttempt, fabricated, repeatedVerb]) {
  assert(JSON.stringify(counts(result.base)) === JSON.stringify(originalCounts), "every result preserves protected structure and bullet density");
  assert(result.densityRatio >= 0.85 && result.densityRatio <= 1.15, "every result stays within the density guard");
}

console.log(JSON.stringify({ zeroChange: true, bulletSwap: true, justifiedRewrite: true, projectSwap: true, skillEdit: true, capsEnforced: true, protectedContentPreserved: true, fabricationRejected: true, actionVerbDuplicationNotWorsened: true }, null, 2));
