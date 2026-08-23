import fs from "node:fs";
import { getCanonicalBaseResume } from "./baseResumes.js";
import { extractJobKeywords } from "./keywordExtraction.js";
import { buildRelevancePlan } from "./relevanceIntelligence.js";
import { applyTailoringDiff, tailoredBaseEvidenceSelection } from "./tailoringDiff.js";
import { buildCoverLetterEvidence, validateEvidenceClaims } from "./coverLetterEvidence.js";
import { buildConservativeCoverLetter } from "./coverLetterEvidence.js";
import { textContainsTerm } from "./protectedTerms.js";
import { missingJobSkills } from "./resumeGapReporting.js";
import { inventorySkills, isHandsOnSkill, skillClassification, validateSkillInventory } from "./skillInventory.js";

const bank = JSON.parse(fs.readFileSync(new URL("./content-bank.json", import.meta.url), "utf8"));
const assert = (condition, message) => { if (!condition) throw new Error(`FAIL: ${message}`); };
const analysis = (mustHaveKeywords = []) => ({ roleFamily: "test", seniority: "entry", mustHaveKeywords, niceToHaveKeywords: [], responsibilities: [], blockers: [], recommendedVariant: "cloud-backend", reasoningSummary: "test" });

const inventory = validateSkillInventory(bank);
assert(inventory.valid, inventory.errors.join("; "));
assert(inventory.total >= 300 && inventory.handsOn > 0 && inventory.knowledge > 0, "Master inventory is incomplete or unclassified");
assert(Object.entries(bank.skillMetadata.handsOnEvidence).every(([skill, ids]) => isHandsOnSkill(bank, skill) && ids.length), "Hands-on classification lacks evidence");
const invalidBank = JSON.parse(JSON.stringify(bank));
invalidBank.skillMetadata.handsOnEvidence.Terraform = ["invented-evidence"];
assert(!validateSkillInventory(invalidBank).valid, "A hands-on classification without existing evidence was accepted");

// Knowledge skills are eligible for strongly relevant Skills-only tailoring.
const base = getCanonicalBaseResume("swe-cloud");
const terraformJd = "Terraform is required. Build and maintain Terraform infrastructure using Terraform modules.";
const terraformExtraction = extractJobKeywords(terraformJd);
const terraformAnalysis = analysis(["Terraform"]);
const terraformPlan = buildRelevancePlan({ bank, base, job: { description: terraformJd }, extraction: terraformExtraction, analysis: terraformAnalysis });
const terraformCandidate = terraformPlan.candidates.find((candidate) => candidate.type === "skill-edit" && candidate.replacementItem === "Terraform");
assert(terraformCandidate?.classification === "knowledge" && skillClassification(bank, "Terraform") === "knowledge", "Relevant knowledge skill was not offered as a classified Skills edit");
const terraformTailored = applyTailoringDiff({ bank, base, extraction: terraformExtraction, analysis: terraformAnalysis, relevancePlan: terraformPlan, diff: { version: 1, baseResumeId: base.id, bulletChanges: [], skillChanges: [{ candidateId: terraformCandidate.id, type: "add", groupLabel: terraformCandidate.groupLabel, replacementItem: "Terraform", justification: "Terraform is an explicit repeated must-have." }] } });
assert(terraformTailored.acceptedDiff.skillChanges.length === 1 && terraformTailored.base.skills.some((group) => group.items.includes("Terraform")), "Knowledge skill could not enter Skills when strongly relevant");

// The same knowledge skill cannot be introduced into an accomplishment bullet.
const sourceBullet = base.experience.find((entry) => entry.entryId === "xelpmoc-software-engineer").bullets.find((bullet) => bullet.sourceBulletId === "xelpmoc-sql-redis");
const knowledgeRewrite = applyTailoringDiff({ bank, base, extraction: terraformExtraction, analysis: terraformAnalysis, diff: { version: 1, baseResumeId: base.id, skillChanges: [], bulletChanges: [{ type: "rewrite", entryId: "xelpmoc-software-engineer", baseBulletId: sourceBullet.sourceBulletId, rewrittenText: sourceBullet.text.replace(/\.$/, " with Terraform."), justification: "Terraform is required." }] } });
assert(!knowledgeRewrite.acceptedDiff.bulletChanges.length && knowledgeRewrite.rejected.some((item) => /Knowledge skill/.test(item.reason)), "Knowledge skill entered an accomplishment bullet");

// Cover-letter evidence excludes knowledge skills and rejects knowledge-only claims.
const selection = tailoredBaseEvidenceSelection(bank, terraformTailored.base);
const coverJob = { company: "Example", title: "Platform Engineer", description: terraformJd };
const bundle = buildCoverLetterEvidence({ bank, job: coverJob, analysis: terraformAnalysis, selection });
assert(!bundle.resumeSkills.includes("Terraform"), "Knowledge skill was exposed to cover-letter accomplishment generation");
const safeLetter = buildConservativeCoverLetter({ job: coverJob, evidenceBundle: bundle });
safeLetter.bodyParagraphs[0] = `I implemented Terraform in production. ${safeLetter.bodyParagraphs[0]}`;
safeLetter.claimEvidence.push({ sentence: "I implemented Terraform in production.", evidenceIds: [bundle.evidence[0].id] });
let knowledgeClaimRejected = false;
try { validateEvidenceClaims(safeLetter, bundle, { job: coverJob, bank }); } catch (error) { knowledgeClaimRejected = /knowledge-only skill 'Terraform'/.test(error.message); }
assert(knowledgeClaimRejected, "Knowledge skill served as cover-letter accomplishment evidence");

// Equivalent wording no longer creates false gaps.
const renderedSkills = [{ label: "Relevant", items: ["WebSockets", "Git", "message queues", "real-time", "OAuth2", "RBAC", "CI/CD"] }];
const aliasAnalysis = analysis(["WebSocket", "version control", "message queue", "realtime", "OAuth 2.0", "role-based access control", "continuous delivery"]);
const aliasMissing = missingJobSkills({ extraction: extractJobKeywords(aliasAnalysis.mustHaveKeywords.join(". ")), analysis: aliasAnalysis, renderedSkills, bulletTexts: {} });
assert(aliasMissing.length === 0, `Aliases left false gaps: ${aliasMissing.join(", ")}`);
for (const [text, term] of [["WebSocket", "WebSockets"], ["version control", "Git"], ["message queue", "message queues"], ["realtime", "real-time"], ["OAuth 2.0", "OAuth2"], ["role-based access control", "RBAC"], ["continuous delivery", "CI/CD"]]) assert(textContainsTerm(text, term), `${text} did not match ${term}`);

// Explicit exclusions remain absent and unsupported.
const forbidden = inventorySkills(bank).filter((skill) => /^(unity|webgl)$/i.test(skill.name));
assert(!forbidden.length, "Unity or WebGL entered the inventory");
const unsupportedJd = "Unity and WebGL are required. Unity Unity WebGL WebGL.";
const unsupportedAnalysis = analysis(["Unity", "WebGL"]);
const unsupportedExtraction = extractJobKeywords(unsupportedJd);
const unsupportedPlan = buildRelevancePlan({ bank, base, job: { description: unsupportedJd }, extraction: unsupportedExtraction, analysis: unsupportedAnalysis });
assert(["unity", "webgl"].every((term) => unsupportedPlan.unsupportedMissing.some((item) => item.term === term)), "Unity/WebGL were not retained as unsupported gaps");
assert(!unsupportedPlan.candidates.some((candidate) => candidate.matchedTerms.some((term) => ["unity", "webgl"].includes(term))), "Unity/WebGL produced tailoring candidates");

console.log(JSON.stringify({ totalSkills: inventory.total, handsOn: inventory.handsOn, knowledge: inventory.knowledge, knowledgeSkillsTailorSkillsOnly: true, handsOnRequiresEvidence: true, aliasesCloseFalseGaps: true, unityAndWebglUnsupported: true }, null, 2));
