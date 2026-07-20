// Deterministic rule tests for the personal-resume requirements (task Phase 13).
// No API calls. Exercises mandatory content, duplicate prevention, rewrite
// guards, acronym/compound preservation, summary/skill/project selection,
// filenames, cover-letter humanization guards, one-page trimming, and PDF
// text-layer integrity on the already-compiled sample.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

import { validateSelection, sanitizeSelectionRewrites } from "./validateSelection.js";
import { budgetSelection } from "./lineBudget.js";
import {
  ensureMandatoryContent,
  validateMandatoryEntries,
  validateMandatorySkills,
  resolveSkillGroupIds,
  MANDATORY_EXPERIENCE_IDS,
} from "./mandatoryContent.js";
import { dedupeAccomplishments, verifyNoDuplicateAccomplishments } from "./accomplishmentClusters.js";
import { selectSummary } from "./summaryVariants.js";
import { filterExploratoryProjects, classifyProject } from "./projectMaturity.js";
import { userFacingFileName, compactName } from "./resumeFileName.js";
import { findGenericPhrases, validateHumanizedCoverLetter } from "./coverLetterHumanization.js";
import { trimOneBullet } from "./pageFitting.js";
import { escapeLatexWithProtectedTerms } from "./latexEscape.js";

const require = createRequire(import.meta.url);
const { verifyPdfAtsIntegrity } = require("../../electron/resume/pdfVerify.cjs");

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const bank = JSON.parse(fs.readFileSync(path.join(here, "content-bank.json"), "utf8"));

const assert = (condition, message) => { if (!condition) throw new Error(`FAIL: ${message}`); };
const rejects = (fn, label) => { try { fn(); } catch { return; } throw new Error(`FAIL: accepted ${label}`); };
const rankedFor = (selection) => validateSelection(bank, selection, { requireUniqueActionVerbs: false });

// --- Mandatory injection: ai-llm model selection missing Xelpmoc + Locra ---
const bare = {
  version: 1,
  variant: "ai-llm",
  educationId: "umd-meng-software-engineering",
  skillGroupIds: ["llm-inference"],
  experience: [{ entryId: "servbeyond-enterprise-ai-platform-intern", bullets: [{ id: "servbeyond-rag-manual-lookup" }] }],
  projects: [{ entryId: "reporesearchai-multi-agent-code-analysis", bullets: [{ id: "reporesearchai-agents-rag" }] }],
};
const injected = ensureMandatoryContent(bank, bare, "ai-llm");
assert(validateMandatoryEntries(injected).valid, "mandatory employers + Locra injected");
for (const id of MANDATORY_EXPERIENCE_IDS) {
  assert(injected.experience.some((e) => e.entryId === id && e.bullets.length >= 1), `mandatory employer ${id} has >=1 bullet`);
}
assert(injected.projects.some((e) => e.entryId === "locra" && e.bullets.length >= 1), "Locra present with a bullet");
assert(validateMandatorySkills(bank, injected.skillGroupIds).valid, "mandatory skills present incl AWS/Docker/Kubernetes");
for (const required of ["applied-ai", "languages", "backend", "frontend", "cloud-devops"]) {
  assert(injected.skillGroupIds.includes(required), `mandatory skill group ${required} present`);
}

// --- Skill-group variant filtering: an unrelated optional group is dropped ---
const skills = resolveSkillGroupIds(bank, ["frontend", "core-engineering"], "ai-llm");
assert(!skills.includes("core-engineering"), "core-engineering (not ai-llm) filtered out");
assert(skills.includes("frontend"), "mandatory frontend kept despite variant tags");

// --- Budget reserves every mandatory entry even when optional content competes ---
const full = JSON.parse(fs.readFileSync(path.join(here, "sample-ai-selection.json"), "utf8"));
const budget = budgetSelection(rankedFor(ensureMandatoryContent(bank, full, "ai-llm")));
const includedEntryIds = new Set(budget.included.map((entry) => entry.entry.id));
for (const id of [...MANDATORY_EXPERIENCE_IDS, "locra"]) assert(includedEntryIds.has(id), `budget kept mandatory ${id}`);

// --- Duplicate accomplishment prevention: cluster + similarity ---
const clusterPair = rankedFor({
  ...bare,
  experience: [{ entryId: "servbeyond-enterprise-ai-platform-intern", bullets: [{ id: "servbeyond-rag-manual-lookup" }, { id: "servbeyond-documentation-rag" }] }],
  projects: [],
});
const deduped = dedupeAccomplishments(clusterPair.rankedBullets);
assert(deduped.kept.length === 1, "cluster dedup keeps one RAG bullet");
assert(!verifyNoDuplicateAccomplishments(clusterPair.rankedBullets).valid, "final check flags duplicate cluster");
const near = [
  { section: "projects", entry: { id: "x" }, bullet: { id: "a" }, text: "Built a real-time collaborative whiteboard with WebSocket and PostgreSQL." },
  { section: "projects", entry: { id: "x" }, bullet: { id: "b" }, text: "Built a real-time collaborative whiteboard using WebSocket and PostgreSQL." },
];
assert(dedupeAccomplishments(near).kept.length === 1, "similarity fallback drops near-duplicate");

// --- Rewrite guards ---
const rw = (id, entryId, section, text) => ({ ...bare, experience: section === "experience" ? [{ entryId, bullets: [{ id, rewrittenText: text }] }] : [], projects: section === "projects" ? [{ entryId, bullets: [{ id, rewrittenText: text }] }] : [] });
rejects(() => validateSelection(bank, rw("servbeyond-rag-manual-lookup", "servbeyond-enterprise-ai-platform-intern", "experience", "Built and shipped 999 RAG assistants.")), "invented number");
rejects(() => validateSelection(bank, rw("servbeyond-rag-manual-lookup", "servbeyond-enterprise-ai-platform-intern", "experience", "Built and shipped a RAG assistant over internal documentation using LangChain and OpenAI APIs, cutting 25 hours of manual lookup per week and reaching 95% answer accuracy across 100 users on Kubernetes.")), "unsupported technology");
rejects(() => validateSelection(bank, rw("servbeyond-agentic-workflows", "servbeyond-enterprise-ai-platform-intern", "experience", "Designed agentic GenAI workflows across Salesforce, ServiceNow, and AWS using Amazon Bedrock for orchestration and REST integration into a normalized data layer.")), "dropped SOAP acronym");
rejects(() => validateSelection(bank, rw("xelpmoc-api-performance", "xelpmoc-software-engineer", "experience", "Reduced API response time from 75 seconds to under 10 seconds and increased throughput 4x by refactoring SQL joins, indexing tables, and adding Redis caching.")), "dropped high-traffic compound");

// --- Sanitizer reverts a bad rewrite to the original instead of failing ---
const badRewrite = { ...bare, experience: [{ entryId: "servbeyond-enterprise-ai-platform-intern", bullets: [{ id: "servbeyond-agentic-workflows", rewrittenText: "Designed agentic GenAI workflows across Salesforce, ServiceNow, and AWS using Amazon Bedrock for orchestration and REST integration into a normalized data layer." }] }], projects: [] };
const sani = sanitizeSelectionRewrites(bank, badRewrite);
assert(sani.reverted.some((r) => r.id === "servbeyond-agentic-workflows"), "bad rewrite reverted");
assert(!sani.selection.experience[0].bullets[0].rewrittenText, "reverted bullet drops rewrittenText");
validateSelection(bank, sani.selection, { requireUniqueActionVerbs: false });

// --- Acronym/compound survive escaping (\mbox wrap keeps them intact) ---
assert(escapeLatexWithProtectedTerms("Benchmarked on TensorRT-LLM").includes("\\mbox{TensorRT-LLM}"), "TensorRT-LLM wrapped in mbox");
assert(escapeLatexWithProtectedTerms("CI/CD pipelines").includes("\\mbox{CI/CD}"), "CI/CD wrapped in mbox");

// --- Role-specific summary selection ---
const summaries = new Set(["ai-llm", "cloud-backend", "fullstack", "mobile"].map((v) => selectSummary(bank, v)));
assert(summaries.size === 4, "each variant yields a distinct summary");
assert(selectSummary(bank, "mobile").toLowerCase().includes("react native"), "mobile summary emphasizes React Native");

// --- Project maturity filtering ---
assert(classifyProject("google-adk-experiments") === "exploratory", "google-adk classified exploratory");
const withExploratory = { ...bare, projects: [{ entryId: "locra", bullets: [{ id: "locra-on-device-vision" }] }, { entryId: "google-adk-experiments", bullets: [{ id: "google-adk-orchestration" }] }] };
const filtered = filterExploratoryProjects(withExploratory);
assert(!filtered.projects.some((e) => e.entryId === "google-adk-experiments"), "exploratory dropped when stronger present");
assert(filtered.projects.some((e) => e.entryId === "locra"), "mandatory Locra retained");

// --- Filenames ---
assert(userFacingFileName({ kind: "resume", company: "Scale AI, Inc." }) === "Vineet_Agarwal_Resume_ScaleAI.pdf", "clean resume filename");
assert(userFacingFileName({ kind: "coverLetter", company: "Ford & Co" }) === "Vineet_Agarwal_CoverLetter_FordAndCo.pdf", "cover-letter filename cleans & to And");
assert(userFacingFileName({ kind: "resume", company: "Scale", existingNames: ["Vineet_Agarwal_Resume_Scale.pdf"] }) === "Vineet_Agarwal_Resume_Scale_v2.pdf", "collision yields _v2");
assert(!/\d{10,}/.test(userFacingFileName({ kind: "resume", company: "Scale" })), "no epoch timestamp in user-facing name");
assert(compactName("OpenAI") === "OpenAI", "compactName preserves OpenAI");

// --- Cover-letter humanization guards ---
assert(findGenericPhrases("I am passionate about distributed systems").includes("passionate about"), "generic phrase flagged");
assert(findGenericPhrases("We build for a fast-paced environment", { jobDescription: "You will thrive in a fast-paced environment." }).length === 0, "JD-context phrase allowed");
const draft = { opening: "o", bodyParagraphs: ["cut 25 hours per week", "b2"], closing: "c" };
assert(!validateHumanizedCoverLetter(draft, { ...draft, bodyParagraphs: ["cut 12 hours per week", "b2"] }).valid, "humanization changing a number is rejected");
assert(validateHumanizedCoverLetter(draft, { ...draft, bodyParagraphs: ["saved 25 hours weekly", "b2"] }).valid, "faithful humanization accepted");

// --- One-page trimming never removes the sole bullet of a mandatory entry ---
const minimal = ensureMandatoryContent(bank, { ...bare, experience: [], projects: [] }, "ai-llm");
let trimmed = minimal;
for (let i = 0; i < 20; i += 1) {
  const step = trimOneBullet(bank, trimmed);
  if (!step) break;
  trimmed = step.selection;
}
assert(validateMandatoryEntries(trimmed).valid, "trimming preserves one bullet per mandatory entry");

// --- PDF text-layer integrity on the compiled sample (if present) ---
const samplePdf = path.join(root, "resume", "output", "sample-ai-resume.pdf");
let pdfChecked = false;
if (fs.existsSync(samplePdf)) {
  const integrity = verifyPdfAtsIntegrity(samplePdf, { expectedName: "Jordan Example" });
  assert(integrity.valid, `sample PDF ATS integrity: ${integrity.errors.join("; ")}`);
  assert(integrity.pageCount === 1, "sample PDF is one page");
  pdfChecked = true;
}

console.log(JSON.stringify({
  mandatoryInjection: true,
  skillVariantFiltering: true,
  budgetReservesMandatory: true,
  duplicateClusterRejected: true,
  similarityDuplicateRejected: true,
  rewriteGuards: true,
  acronymCompoundPreserved: true,
  summaryVariants: true,
  projectMaturityFiltering: true,
  cleanFilenames: true,
  coverLetterHumanization: true,
  onePageTrimmingSafe: true,
  pdfTextLayerChecked: pdfChecked,
}, null, 2));
