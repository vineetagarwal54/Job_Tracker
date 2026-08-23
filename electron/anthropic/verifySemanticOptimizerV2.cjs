const path = require("path");
const { pathToFileURL } = require("url");
const { generateSemanticResumeOptimization, semanticOptimizerSchema, validateRequirements, resolveKnowledgeSkillNames, expandSemanticDiff } = require("./semanticResumeOptimizer.cjs");
const { SEMANTIC_OPTIMIZER_SYSTEM, SELECTION_SYSTEM } = require("./promptModules.cjs");

const root = path.resolve(__dirname, "..", "..");
const generateDir = path.join(root, "src", "generate");
const load = (name) => import(pathToFileURL(path.join(generateDir, `${name}.js`)).href);
const bank = require("../../src/generate/content-bank.json");
const assert = (condition, message) => { if (!condition) throw new Error(`FAIL: ${message}`); };

const requirement = (id, text, { priority = "must", kind = "technical-skill", status = "covered", current = [], candidate = [], knowledgeIds = [] } = {}) => ({
  id, text, priority, kind, status, currentEvidenceIds: current, candidateEvidenceIds: candidate, knowledgeSkillIds: knowledgeIds,
  reason: status === "unsupported" ? "No supplied verified evidence supports this requirement." : "Supplied evidence semantically supports this requirement.",
});

async function main() {
  const [{ getCanonicalBaseResume, canonicalBases }, evidenceModule, coverageModule, tailoringModule, skillModule] = await Promise.all([
    load("baseResumes"), load("evidenceCatalog"), load("semanticRequirementCoverage"), load("tailoringDiff"), load("skillInventory"),
  ]);
  const canonicalSnapshot = JSON.stringify(canonicalBases);
  const base = getCanonicalBaseResume("swe-cloud");
  const { catalog } = evidenceModule.buildVerifiedEvidenceCatalog(bank, base);
  const evidenceIndex = evidenceModule.indexVerifiedEvidenceCatalog(catalog);
  const catalogText = JSON.stringify(catalog);
  assert(!/vineet|@gmail|240353|linkedin|portfolio/i.test(catalogText), "catalog excludes identity and contact information");
  assert(catalog.base.id === "swe-cloud" && catalog.alternatives.experienceBullets.every((bullet) => base.experience.some((entry) => entry.entryId === bullet.entryId)), "catalog limits alternative experience bullets to the same base experiences");
  const allowedKnowledgeIds = semanticOptimizerSchema(base, catalog).properties.requirements.items.properties.knowledgeSkillIds.items.enum;
  assert(allowedKnowledgeIds.includes("skill:google-cloud-platform-gcp") && !allowedKnowledgeIds.includes("skill:python") && !allowedKnowledgeIds.includes("skill:not-real"), "structured output constrains knowledge references to verified knowledge-only skill IDs");
  assert(!catalog.alternatives.skills.inventory.some((skill) => skill.skill === "Python or JavaScript/TypeScript"), "grouped language wording requires no synthetic inventory skill");
  assert(!SEMANTIC_OPTIMIZER_SYSTEM.includes("For every selected candidate, return its candidate ID") && SEMANTIC_OPTIMIZER_SYSTEM.includes("Never return a candidate ID"), "V2 prompt uses its schema-specific rewrite contract");
  assert(SELECTION_SYSTEM.includes("For every selected candidate, return its candidate ID"), "legacy compatibility prompt remains unchanged");

  const semanticCases = [
    { area: "backend", requirement: requirement("backend-rest", "REST/API development", { current: ["xelpmoc-tourism-backend"] }) },
    { area: "full stack", requirement: requirement("frontend-framework", "frontend framework", { current: ["skill:react"] }) },
    { area: "cloud", requirement: requirement("containers", "containers", { current: ["skill:docker", "skill:kubernetes"] }) },
    { area: "AI/RAG", requirement: requirement("rag", "retrieval augmented generation", { current: ["servbeyond-sharepoint-retrieval"] }) },
    { area: "LLM infrastructure", requirement: requirement("llm-serving", "LLM inference infrastructure", { current: ["runara-speculative-decoding"] }) },
    { area: "mobile", requirement: requirement("mobile", "cross-platform mobile product development", { current: ["skill:react-native"] }) },
    { area: "mixed OR", requirement: requirement("language-or", "Python or JavaScript/TypeScript", { current: ["skill:python", "skill:javascript", "skill:typescript"] }) },
    { area: "browser alternatives", requirement: requirement("browser-automation", "browser automation using Playwright/Puppeteer/Selenium", { current: ["iiit-nlp-extraction"] }) },
    { area: "composite", requirement: requirement("sql-document", "SQL and document-store design", { current: ["skill:sql", "skill:mongodb", "xelpmoc-sql-redis"] }) },
    { area: "already matched", requirement: requirement("shipping", "production shipping experience", { current: ["experience:xelpmoc-software-engineer"] }) },
    { area: "unsupported", requirement: requirement("rust", "production Rust development", { status: "unsupported" }) },
  ];
  for (const item of semanticCases) {
    validateRequirements({ version: 2, baseResumeId: base.id, requirements: [item.requirement] }, catalog, evidenceIndex);
    const report = coverageModule.computeSemanticRequirementCoverage([item.requirement], base);
    if (item.requirement.status === "unsupported") assert(report.unsupported.length === 1 && report.mustHave.missing.length === 1, `${item.area}: unsupported requirement remains unsupported`);
    else assert(report.mustHave.covered.length === 1, `${item.area}: supplied semantic evidence covers the requirement`);
  }
  const groupedLanguage = semanticCases.find((item) => item.requirement.id === "language-or").requirement;
  assert(groupedLanguage.currentEvidenceIds.every((id) => evidenceIndex.has(id)) && groupedLanguage.knowledgeSkillIds.length === 0, "grouped programming-language requirement cites individual canonical skill IDs without free-form knowledge text");

  let arbitrarySkillRejected;
  try { validateRequirements({ version: 2, baseResumeId: base.id, requirements: [requirement("arbitrary", "Arbitrary technology", { status: "knowledge-only", knowledgeIds: ["skill:not-real"] })] }, catalog, evidenceIndex); } catch (error) { arbitrarySkillRejected = error; }
  assert(arbitrarySkillRejected, "unsupported arbitrary skill IDs are rejected deterministically");
  let handsOnAsKnowledgeRejected;
  try { validateRequirements({ version: 2, baseResumeId: base.id, requirements: [requirement("python-knowledge", "Python knowledge", { status: "knowledge-only", knowledgeIds: ["skill:python"] })] }, catalog, evidenceIndex); } catch (error) { handsOnAsKnowledgeRejected = error; }
  assert(handsOnAsKnowledgeRejected, "hands-on skill IDs cannot be mislabeled as knowledge-only");

  const gcpSkill = evidenceModule.catalogSkillInventory(catalog).find((skill) => skill.skill === "Google Cloud Platform (GCP)");
  assert(gcpSkill?.classification === "knowledge", "GCP is classified as knowledge-only without accomplishment evidence");
  let misclassifiedKnowledge;
  try { validateRequirements({ version: 2, baseResumeId: base.id, requirements: [requirement("docker-only", "professional container implementation", { kind: "experience", current: ["skill:docker"] })] }, catalog, evidenceIndex); } catch (error) { misclassifiedKnowledge = error; }
  assert(misclassifiedKnowledge, "skill-only knowledge evidence cannot be mislabeled as covered accomplishment experience");
  const gcpRequirement = requirement("gcp", "GCP/GKE/Cloud Run knowledge", { status: "knowledge-only", knowledgeIds: [gcpSkill.id] });
  validateRequirements({ version: 2, baseResumeId: base.id, requirements: [gcpRequirement] }, catalog, evidenceIndex);
  assert(!gcpRequirement.currentEvidenceIds.length && !gcpRequirement.candidateEvidenceIds.length, "knowledge-only requirements use only knowledgeSkillIds");
  assert(resolveKnowledgeSkillNames([gcpRequirement], catalog)[0].knowledgeSkillNames[0] === gcpSkill.skill, "validated skill IDs resolve deterministically to display names");
  const skillProposal = { version: 2, baseResumeId: base.id, roleFamily: "cloud", seniority: "entry", requirements: [gcpRequirement], diff: { bulletChanges: [], projectChanges: [], summaryChanges: [], skillChanges: [{ type: "add", skill: gcpSkill.skill, targetGroup: "Cloud and DevOps", baseItem: "", requirementIds: [gcpRequirement.id], justification: "The role requests GCP platform knowledge." }] } };
  const expandedSkill = expandSemanticDiff(skillProposal, catalog, evidenceIndex);
  const skillApplied = tailoringModule.applyTailoringDiff({ bank, base, diff: expandedSkill.diff, semanticRequirements: [gcpRequirement] });
  assert(skillApplied.acceptedDiff.skillChanges.length === 1, "knowledge-only technology may be added to Skills");
  assert(coverageModule.computeSemanticRequirementCoverage([gcpRequirement], skillApplied.base, skillApplied.acceptedDiff).mustHave.covered.length === 1, "rendered knowledge-only skill covers a technical-skill requirement");
  const productionGcp = { ...gcpRequirement, id: "gcp-production", text: "production GCP implementation experience", kind: "experience" };
  assert(coverageModule.computeSemanticRequirementCoverage([productionGcp], skillApplied.base, skillApplied.acceptedDiff).mustHave.missing.length === 1, "knowledge-only skill cannot satisfy professional implementation experience");

  const baseBullet = base.experience.find((entry) => entry.entryId === "iiit-hyderabad-software-intern").bullets[0];
  const knowledgeBulletProposal = { version: 2, baseResumeId: base.id, roleFamily: "cloud", seniority: "entry", requirements: [gcpRequirement], diff: { bulletChanges: [{ type: "rewrite", baseBulletId: baseBullet.sourceBulletId, replacementBulletId: "", rewrittenText: baseBullet.text, requirementIds: [gcpRequirement.id], justification: "Invalidly attempts to use knowledge-only evidence." }], projectChanges: [], summaryChanges: [], skillChanges: [] } };
  const rejectedKnowledgeBullet = expandSemanticDiff(knowledgeBulletProposal, catalog, evidenceIndex);
  assert(!rejectedKnowledgeBullet.diff.bulletChanges.length && rejectedKnowledgeBullet.rejected.some((item) => item.type === "bullet"), "knowledgeSkillIds cannot justify an experience bullet change");
  const rewriteRequirement = { ...gcpRequirement, status: "coverable", knowledgeSkillIds: [], candidateEvidenceIds: [baseBullet.sourceBulletId] };
  const forbiddenRewrite = tailoringModule.applyTailoringDiff({ bank, base, semanticRequirements: [rewriteRequirement], diff: { version: 1, baseResumeId: base.id, summaryChange: null, projectSwap: null, skillChanges: [], bulletChanges: [{ candidateId: "v2:forbidden", type: "rewrite", entryId: "iiit-hyderabad-software-intern", baseBulletId: baseBullet.sourceBulletId, rewrittenText: baseBullet.text.replace("Python and Selenium", "Python, Selenium, and Google Cloud Platform (GCP)"), requirementIds: [rewriteRequirement.id], justification: "The role requests GCP platform knowledge." }] } });
  assert(!forbiddenRewrite.acceptedDiff.bulletChanges.length && forbiddenRewrite.rejected.some((item) => /Knowledge skill|unsupported technology/i.test(item.reason)), "knowledge-only technology cannot become accomplishment evidence");

  const backedOff = coverageModule.computeSemanticRequirementCoverage([gcpRequirement], base, { version: 1, summaryChange: null, bulletChanges: [], projectSwap: null, skillChanges: [] });
  assert(backedOff.mustHave.missing.length === 1, "a requirement becomes missing when its only evidence is absent after page-fit backoff");
  assert(JSON.stringify(canonicalBases) === canonicalSnapshot, "canonical bases remain byte-for-byte unchanged");
  assert(skillModule.validateSkillInventory(bank).valid, "existing verified skill inventory remains valid");

  const requestRequirements = semanticCases.map((item) => item.requirement);
  let calls = 0; let captured;
  const client = { request: async (request) => {
    calls += 1; captured = request;
    return { text: JSON.stringify({ version: 2, baseResumeId: base.id, roleFamily: "full stack backend", seniority: "mid", blockers: [], requirements: requestRequirements, diff: { bulletChanges: [], projectChanges: [], skillChanges: [], summaryChanges: [] } }), usage: { input_tokens: 15000, output_tokens: 900, cache_creation_input_tokens: 14000 }, stopReason: "end_turn" };
  } };
  const optimized = await generateSemanticResumeOptimization({ client, apiKey: "mock", bank, base, job: { title: "Software Engineer", description: "Representative composite job description." }, generateDir });
  assert(calls === 1 && captured.stream === true, "optimizer uses one streamed Sonnet request");
  assert(captured.body.thinking.type === "disabled" && captured.body.output_config.effort === "low", "optimizer disables thinking and uses low effort");
  assert(captured.body.system[1].cache_control.type === "ephemeral", "stable evidence catalog is prompt-cache eligible");
  assert(optimized.requestMetrics.serializedRequestBytes < 75000, `serialized request stays below 75 KB (got ${optimized.requestMetrics.serializedRequestBytes})`);
  assert(optimized.requestMetrics.dynamicBytes < 1000, "dynamic JD payload is not duplicated across request objects");
  assert(optimized.acceptedDiff.bulletChanges.length === 0 && optimized.acceptedDiff.skillChanges.length === 0, "already matched evidence permits a zero-change result");

  console.log(JSON.stringify({
    semanticAreas: semanticCases.map((item) => item.area),
    explicitEquivalences: ["React -> frontend framework", "Selenium -> Playwright/Puppeteer/Selenium alternative", "Python -> Python or JavaScript/TypeScript", "Docker/Kubernetes -> containers", "SQL + MongoDB evidence -> SQL + document store"],
    knowledgeOnlySkillsOnly: true,
    unsupportedRemainsUnsupported: true,
    postBackoffCoverageRecomputed: true,
    canonicalBasesUnchanged: true,
    oneOptimizerCall: calls,
    serializedRequestBytes: optimized.requestMetrics.serializedRequestBytes,
    approximateInputTokens: optimized.requestMetrics.approximateInputTokens,
    catalogBytes: optimized.requestMetrics.catalogBytes,
    dynamicBytes: optimized.requestMetrics.dynamicBytes,
    mockedActualInputTokens: optimized.usage.input_tokens,
  }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
