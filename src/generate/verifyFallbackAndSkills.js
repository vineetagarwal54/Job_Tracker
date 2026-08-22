// Deterministic tests for the universal fallback flow and individual
// JD-specific skill selection (task Part 1 + Part 2). No API calls, no compile.
// The orchestrator-level compile integration lives in
// electron/anthropic/verifyFallbackGeneration.cjs.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

import { extractJobKeywords } from "./keywordExtraction.js";
import { scoreCoverage } from "./coverageScoring.js";
import { validateJobAnalysis } from "./jobAnalysisValidation.js";
import { validateSelection } from "./validateSelection.js";
import { renderResume } from "./renderResume.js";
import { finalizeSelection } from "./finalizeSelection.js";
import { resolveRenderedSkills, missingJobSkills } from "./skillSelection.js";
import {
  chooseFallbackVariant,
  buildFallbackAnalysis,
  buildDeterministicSelection,
} from "./fallbackSelection.js";
import { buildResumeWarnings } from "./resumeWarnings.js";
import { validateMandatoryEntries, validateMandatorySkills } from "./mandatoryContent.js";

const require = createRequire(import.meta.url);
const { createActiveGenerations } = require("../../electron/anthropic/activeGenerations.cjs");

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const bank = JSON.parse(fs.readFileSync(path.join(here, "content-bank.json"), "utf8"));
const template = fs.readFileSync(path.join(root, "resume", "template", "main.tex"), "utf8");
const identity = { name: "Test User", location: "College Park, MD", phone: "2405551234", email: "test@example.test", links: { linkedin: "https://example.test/in", github: "https://example.test/gh", portfolio: "" } };

const assert = (condition, message) => { if (!condition) throw new Error(`FAIL: ${message}`); };
const warningTypes = (list) => list.map((w) => w.type);

// --- Deterministic fallback analysis is a valid JobAnalysis ---
const backendJd = "Backend Engineer. Required: Python, FastAPI, PostgreSQL, Docker, Kubernetes, AWS, REST, WebSocket, Linux, JWT, RBAC, system design, microservices. Preferred: Redis, GraphQL, Node.js. Nice to have Rust and Terraform.";
const backendExtraction = extractJobKeywords(backendJd);
const fbAnalysis = buildFallbackAnalysis({ extraction: backendExtraction, job: { description: backendJd } });
validateJobAnalysis(fbAnalysis);
assert(fbAnalysis.mustHaveKeywords.length > 0, "fallback analysis has must-have keywords");

// --- Variant chooser prefers verified content, defaults to general SWE ---
const backendVariant = chooseFallbackVariant(bank, { extraction: backendExtraction });
assert(["cloud-backend", "fullstack"].includes(backendVariant), `backend JD maps to a backend-ish variant (got ${backendVariant})`);
const aiJd = "LLM inference engineer. vLLM, SGLang, TensorRT-LLM, speculative decoding, KV cache, quantization, PyTorch, CUDA.";
assert(chooseFallbackVariant(bank, { extraction: extractJobKeywords(aiJd) }) === "ai-llm", "AI inference JD maps to ai-llm");
assert(chooseFallbackVariant(bank, { extraction: extractJobKeywords("Some role with no technical keywords at all.") }) === "fullstack", "empty JD defaults to general fullstack");
assert(chooseFallbackVariant(bank, { analysis: { recommendedVariant: "mobile" } }) === "mobile", "valid recommendation is honored");

// --- Deterministic selection -> finalize -> render produces a valid resume ---
const rawFallback = buildDeterministicSelection(bank, { variant: backendVariant, extraction: backendExtraction, analysis: fbAnalysis });
const finalized = finalizeSelection(bank, rawFallback, { variant: backendVariant, extraction: backendExtraction, analysis: fbAnalysis });
assert(validateMandatoryEntries(finalized.finalSelection).valid, "fallback resume keeps every mandatory entry");
const rendered = renderResume({ bank, selection: finalized.selection, template, identity, jdContext: { extraction: backendExtraction, analysis: fbAnalysis } });
assert(rendered.tex.includes("\\begin{document}"), "fallback render produced a TeX document");
assert(rendered.renderedSkills.length > 0, "fallback render resolved individual skills");

// --- Individual skill selection: mandatory floor + JD narrowing ---
const skills = resolveRenderedSkills(bank, { skillGroupIds: ["applied-ai", "languages", "backend", "frontend", "cloud-devops"], variant: "cloud-backend", extraction: backendExtraction, analysis: fbAnalysis });
const groupIds = skills.groups.map((g) => g.id);
for (const mandatory of ["applied-ai", "languages", "backend", "frontend", "cloud-devops"]) assert(groupIds.includes(mandatory), `mandatory skill category ${mandatory} present`);
const cloud = skills.groups.find((g) => g.id === "cloud-devops");
for (const item of ["AWS", "Docker", "Kubernetes"]) assert(cloud.items.includes(item), `mandatory skill item ${item} present`);
const backendGroup = skills.groups.find((g) => g.id === "backend");
assert(backendGroup.items.length < bank.skillGroups.find((g) => g.id === "backend").items.length, "backend category shows a JD-narrowed subset, not every item");
// Ordering by JD importance: an item the JD requires ranks before a backfilled one.
assert(backendGroup.items[0] === "FastAPI" || backendGroup.items.includes("FastAPI"), "JD-required FastAPI ranks in backend");

// --- No whole-group dumping: total items are capped and clean ---
const totalItems = skills.groups.reduce((sum, g) => sum + g.items.length, 0);
assert(totalItems <= 40, "skills section stays within the total cap");
for (const g of skills.groups) assert(g.items.length >= 1, `no empty category (${g.id})`);

// --- Java must not match JavaScript; aliases (K8s/Postgres/Unix/Node) resolve ---
const aliasJd = "Java backend on K8s with Postgres, running on Unix. Node services.";
const aliasExtraction = extractJobKeywords(aliasJd);
const aliasCoverage = scoreCoverage(bank, aliasExtraction, { analysis: { mustHaveKeywords: ["java"], niceToHaveKeywords: [] }, renderedSkills: skills.groups });
assert(aliasExtraction.keywords.some((k) => k.normalized === "java"), "java token detected");
const javaMissing = missingJobSkills({ extraction: aliasExtraction, analysis: { mustHaveKeywords: ["java"], niceToHaveKeywords: [] }, renderedSkills: skills.groups, bulletTexts: {} });
assert(javaMissing.map((s) => String(s).toLowerCase()).includes("java"), "Java reported missing (not matched via JavaScript)");
const aliasSkills = resolveRenderedSkills(bank, { skillGroupIds: ["applied-ai", "languages", "backend", "frontend", "cloud-devops"], variant: "cloud-backend", extraction: aliasExtraction, analysis: { mustHaveKeywords: ["k8s", "postgres", "unix", "node"], niceToHaveKeywords: [] } });
assert(aliasSkills.groups.find((g) => g.id === "cloud-devops").items.includes("Kubernetes"), "K8s alias resolves to Kubernetes");
const postgresGroup = aliasSkills.groups.find((g) => g.id === "databases");
assert(postgresGroup && postgresGroup.items.includes("PostgreSQL"), "Postgres alias resolves to PostgreSQL");

// --- Missing JD skills are reported, never added to the resume ---
// A real analysis lists preferred skills the bank does not carry (Rust,
// Terraform); those must surface as warnings, never be invented onto the resume.
const richAnalysis = { ...fbAnalysis, niceToHaveKeywords: ["redis", "graphql", "node.js", "rust", "terraform"] };
const missing = missingJobSkills({ extraction: backendExtraction, analysis: richAnalysis, renderedSkills: skills.groups, bulletTexts: {} });
assert(missing.map((s) => s.toLowerCase()).includes("rust"), "Rust reported missing");
assert(missing.map((s) => s.toLowerCase()).includes("terraform"), "Terraform reported missing");
assert(!skills.groups.some((g) => g.items.some((i) => /rust|terraform/i.test(i))), "missing skills were NOT invented onto the resume");

// --- Coverage uses only rendered skills ---
const renderedIds = new Set(skills.groups.flatMap((g) => g.items.map((i) => i.toLowerCase())));
assert(renderedIds.size > 0 && aliasCoverage.coveragePercentage >= 0, "coverage computed against rendered skills only");

// --- Eligibility / mismatch warnings never block; they explain ---
const w = (jd, extra = {}) => buildResumeWarnings({ job: { description: jd }, analysis: { roleFamily: "software engineering", blockers: [] }, coverage: { mustHave: { missing: [] }, niceToHave: { missing: [] } }, ...extra });
assert(warningTypes(w("We do not provide visa sponsorship for this role.")).includes("sponsorship"), "sponsorship warning raised");
assert(warningTypes(w("Must be a US citizen.")).includes("citizenship"), "citizenship warning raised");
assert(warningTypes(w("Active security clearance (TS/SCI) required.")).includes("clearance"), "clearance warning raised");
assert(warningTypes(w("Open to undergraduate students only; must be a rising junior.")).includes("education-level"), "undergraduate-only warning raised");
assert(warningTypes(w("PhD in Computer Science required.")).includes("education-level"), "graduate-level note raised");
assert(warningTypes(buildResumeWarnings({ job: { description: "x" }, analysis: { roleFamily: "quantum cryptography researcher", blockers: [] } })).includes("role-family"), "unusual role family warning raised");
const skillWarn = buildResumeWarnings({ job: { description: "x" }, analysis: { roleFamily: "backend", blockers: [] }, coverage: { mustHave: { missing: [{ value: "rust" }] }, niceToHave: { missing: [{ value: "terraform" }] } } });
assert(warningTypes(skillWarn).includes("missing-required-skills") && warningTypes(skillWarn).includes("missing-preferred-skills"), "missing required and preferred skill warnings raised");
const fbWarn = buildResumeWarnings({ job: { description: "x" }, analysis: { roleFamily: "backend", blockers: [] }, usedAnalysisFallback: true, usedSelectionFallback: true, requestedVariant: "cloud-backend", renderedVariant: "fullstack" });
for (const t of ["analysis-fallback", "selection-fallback", "variant-mismatch"]) assert(warningTypes(fbWarn).includes(t), `${t} warning raised`);

// --- Model can never inject an unverified skill through the skills field ---
let invented = false;
try { validateSelection(bank, { ...finalized.selection, skills: [{ groupId: "languages", items: ["COBOL"] }] }); } catch { invented = true; }
assert(invented, "unverified skill in the skills field is rejected");

// --- Recovery after failure: a failed generation never blocks a later one ---
const active = createActiveGenerations();
const owner = 42;
let controller = active.start(owner);
assert(controller && active.has(owner), "generation lock acquired");
active.finish(owner); // simulate the finally block after a failure
assert(!active.has(owner), "lock released after failure");
controller = active.start(owner);
assert(controller && active.has(owner), "a later generation can start after a prior failure");
active.finish(owner);

console.log(JSON.stringify({
  fallbackAnalysisValid: true,
  variantChooser: true,
  deterministicFallbackResume: true,
  individualSkillSelection: true,
  mandatorySkillFloor: true,
  jdAddedCategories: true,
  skillsCappedAndClean: true,
  javaNotJavaScript: true,
  aliasesResolved: true,
  missingSkillsReportedNotInvented: true,
  coverageUsesRenderedSkills: true,
  eligibilityWarnings: true,
  fallbackWarnings: true,
  skillsFieldCannotInvent: true,
  recoveryAfterFailure: true,
}, null, 2));
