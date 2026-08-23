const path = require("path");
const { pathToFileURL } = require("url");
const { SEMANTIC_OPTIMIZER_SYSTEM } = require("./prompts.cjs");
const { parseJsonText } = require("./validation.cjs");
const { MODELS } = require("./models.cjs");
const { sanitizeDiagnosticMessage } = require("./tailoringDiagnostics.cjs");

const MODEL = MODELS.writing;
const REQUIREMENT_PRIORITIES = ["must", "preferred"];
const REQUIREMENT_KINDS = ["technical-skill", "experience", "responsibility", "qualification"];

const stringArray = { type: "array", items: { type: "string" } };
const changeCommon = {
  requirementIds: stringArray,
  justification: { type: "string" },
};

function catalogSkillRecords(catalog) {
  const skills = catalog?.alternatives?.skills || {};
  const handsOn = skills.handsOnEvidence || {};
  const byId = new Map();
  for (const group of catalog?.base?.renderedSkills || []) for (const skill of group.items || []) {
    byId.set(skill.id, { id: skill.id, skill: skill.skill, classification: Object.hasOwn(handsOn, skill.id) ? "hands-on" : skills.defaultClassification });
  }
  for (const skill of skills.inventory || []) {
    byId.set(skill.id, { ...skill, classification: Object.hasOwn(handsOn, skill.id) ? "hands-on" : skills.defaultClassification });
  }
  return [...byId.values()];
}

function semanticOptimizerSchema(base, catalog) {
  const knowledgeSkillIds = catalogSkillRecords(catalog).filter((skill) => skill.classification === "knowledge").map((skill) => skill.id);
  return {
    type: "object", additionalProperties: false,
    properties: {
      version: { type: "integer", enum: [2] },
      baseResumeId: { type: "string", enum: [base.id] },
      roleFamily: { type: "string" },
      seniority: { type: "string" },
      blockers: { type: "array", items: { type: "string", enum: ["citizenship requirement", "security-clearance requirement", "explicit CPT or OPT rejection"] } },
      requirements: {
        type: "array",
        items: {
          type: "object", additionalProperties: false,
          properties: {
            id: { type: "string" }, text: { type: "string" },
            priority: { type: "string", enum: REQUIREMENT_PRIORITIES },
            kind: { type: "string", enum: REQUIREMENT_KINDS },
            currentEvidenceIds: stringArray, candidateEvidenceIds: stringArray,
            knowledgeSkillIds: { type: "array", items: { type: "string", enum: knowledgeSkillIds } }, reason: { type: "string" },
          },
          required: ["id", "text", "priority", "kind", "currentEvidenceIds", "candidateEvidenceIds", "knowledgeSkillIds", "reason"],
        },
      },
      diff: {
        type: "object", additionalProperties: false,
        properties: {
          bulletChanges: {
            type: "array",
            items: { type: "object", additionalProperties: false, properties: {
              type: { type: "string", enum: ["swap", "rewrite"] }, baseBulletId: { type: "string" },
              replacementBulletId: { type: "string" }, rewrittenText: { type: "string" }, ...changeCommon,
            }, required: ["type", "baseBulletId", "replacementBulletId", "rewrittenText", "requirementIds", "justification"] },
          },
          projectChanges: {
            type: "array",
            items: { type: "object", additionalProperties: false, properties: {
              baseProjectId: { type: "string" }, replacementProjectId: { type: "string" }, ...changeCommon,
            }, required: ["baseProjectId", "replacementProjectId", "requirementIds", "justification"] },
          },
          skillChanges: {
            type: "array",
            items: { type: "object", additionalProperties: false, properties: {
              type: { type: "string", enum: ["add", "swap"] }, skill: { type: "string" }, targetGroup: { type: "string" }, baseItem: { type: "string" }, ...changeCommon,
            }, required: ["type", "skill", "targetGroup", "baseItem", "requirementIds", "justification"] },
          },
          summaryChanges: {
            type: "array",
            items: { type: "object", additionalProperties: false, properties: { summaryId: { type: "string" }, ...changeCommon }, required: ["summaryId", "requirementIds", "justification"] },
          },
        },
        required: ["bulletChanges", "projectChanges", "skillChanges", "summaryChanges"],
      },
    },
    required: ["version", "baseResumeId", "roleFamily", "seniority", "blockers", "requirements", "diff"],
  };
}

const fail = (message, stage = "semantic-validation") => { const error = Object.assign(new Error(message), { code: "VALIDATION_FAILED", tailoringStage: stage }); throw error; };
const normalize = (value) => String(value || "").trim().toLowerCase();

function normalizeRequirements(result, catalog, evidenceIndex) {
  if (result?.version !== 2 || result?.baseResumeId !== catalog.base.id || !Array.isArray(result?.requirements)) fail("Semantic optimizer returned an invalid top-level contract.");
  const ids = new Set();
  const skillById = new Map(catalogSkillRecords(catalog).map((skill) => [skill.id, skill]));
  const requirements = [];
  const issues = [];
  for (const requirement of result.requirements) {
    const id = String(requirement?.id || "").trim();
    if (!id || ids.has(id) || !String(requirement?.text || "").trim() || !REQUIREMENT_PRIORITIES.includes(requirement?.priority) || !REQUIREMENT_KINDS.includes(requirement?.kind)) {
      issues.push({ requirementId: id || null, discardedEvidenceId: null, field: "requirement", reason: "Requirement record is missing a unique ID, text, priority, or kind and was discarded." });
      continue;
    }
    ids.add(id);
    const discardedEvidence = [];
    const discard = (evidenceId, field, reason) => { const issue = { requirementId: sanitizeDiagnosticMessage(id), discardedEvidenceId: sanitizeDiagnosticMessage(evidenceId), field, reason }; discardedEvidence.push(issue); issues.push(issue); };
    const accomplishmentRequired = ["experience", "responsibility"].includes(requirement.kind);
    const validEvidence = (values, field, requireCurrent) => [...new Set(Array.isArray(values) ? values.map(String) : [])].filter((evidenceId) => {
      const evidence = evidenceIndex.get(evidenceId);
      if (!evidence) { discard(evidenceId, field, "Unknown evidence ID."); return false; }
      if (requireCurrent && !evidence.current) { discard(evidenceId, field, "Evidence is not current in the selected canonical base."); return false; }
      if (accomplishmentRequired && evidence.kind === "skill") { discard(evidenceId, field, "Skills-only evidence cannot satisfy an experience or responsibility requirement."); return false; }
      return true;
    });
    const currentEvidenceIds = validEvidence(requirement.currentEvidenceIds, "currentEvidenceIds", true);
    const candidateEvidenceIds = validEvidence(requirement.candidateEvidenceIds, "candidateEvidenceIds", false);
    const knowledgeSkillIds = [...new Set(Array.isArray(requirement.knowledgeSkillIds) ? requirement.knowledgeSkillIds.map(String) : [])].filter((skillId) => {
      const skill = skillById.get(skillId);
      if (requirement.kind !== "technical-skill") { discard(skillId, "knowledgeSkillIds", "Knowledge-only evidence is ignored for non-technical requirements."); return false; }
      if (!skill) { discard(skillId, "knowledgeSkillIds", "Unknown skill evidence ID."); return false; }
      if (skill.classification !== "knowledge") { discard(skillId, "knowledgeSkillIds", "Skill is classified as hands-on, not knowledge-only."); return false; }
      return true;
    });
    const status = currentEvidenceIds.length ? "covered" : candidateEvidenceIds.length ? "coverable" : knowledgeSkillIds.length ? "knowledge-only" : "unsupported";
    requirements.push({ id, text: String(requirement.text).trim(), priority: requirement.priority, kind: requirement.kind, status, currentEvidenceIds, candidateEvidenceIds, knowledgeSkillIds, reason: String(requirement.reason || "").trim(), discardedEvidence });
  }
  return { requirements, requirementIds: new Set(requirements.map((item) => item.id)), issues };
}

const validateRequirements = normalizeRequirements;

function resolveKnowledgeSkillNames(requirements, catalog) {
  const skillById = new Map(catalogSkillRecords(catalog).map((skill) => [skill.id, skill.skill]));
  return requirements.map((requirement) => ({ ...requirement, knowledgeSkillNames: requirement.knowledgeSkillIds.map((id) => skillById.get(id)) }));
}

function requirementsSupportChange(change, requirementIds, evidenceIds) {
  if (!Array.isArray(change.requirementIds) || !change.requirementIds.length || change.requirementIds.some((id) => !requirementIds.has(id))) return false;
  const requirements = change.requirementIds.map((id) => evidenceIds.get(id));
  return requirements.some((requirement) => requirement && requirement.status !== "unsupported");
}

function expandSemanticDiff(result, catalog, evidenceIndex) {
  const requirements = new Map(result.requirements.map((requirement) => [requirement.id, requirement]));
  const requirementIds = new Set(requirements.keys());
  const bulletLocations = new Map(catalog.base.experience.flatMap((entry) => entry.bullets.map((bullet) => [bullet.id, entry.entryId])));
  const diff = { version: 1, baseResumeId: catalog.base.id, summaryChange: null, bulletChanges: [], projectSwap: null, skillChanges: [] };
  const rejected = [];
  const acceptLink = (change, evidenceIds, allowKnowledgeSkill = false) => requirementsSupportChange(change, requirementIds, requirements)
    && change.requirementIds.some((id) => {
      const requirement = requirements.get(id);
      return evidenceIds.some((evidenceId) => requirement.currentEvidenceIds.includes(evidenceId) || requirement.candidateEvidenceIds.includes(evidenceId)
        || (allowKnowledgeSkill && requirement.status === "knowledge-only" && requirement.knowledgeSkillIds.includes(evidenceId)));
    });
  for (const [index, change] of (result.diff?.bulletChanges || []).entries()) {
    const entryId = bulletLocations.get(change.baseBulletId);
    const evidenceIds = change.type === "swap" ? [change.replacementBulletId] : [change.baseBulletId];
    if (!entryId || !acceptLink(change, evidenceIds)) { rejected.push({ type: "bullet", reason: "Semantic bullet change lacks a valid base target or requirement-evidence link.", change }); continue; }
    diff.bulletChanges.push({ candidateId: `v2:bullet:${index}:${change.baseBulletId}`, type: change.type, entryId, baseBulletId: change.baseBulletId, replacementBulletId: change.replacementBulletId || undefined, rewrittenText: change.rewrittenText || undefined, requirementIds: change.requirementIds, justification: change.justification });
  }
  for (const [index, change] of (result.diff?.skillChanges || []).entries()) {
    const skill = catalog.alternatives.skills.inventory.find((item) => normalize(item.skill) === normalize(change.skill));
    if (!skill || !acceptLink(change, [skill.id], true)) { rejected.push({ type: "skill", reason: "Semantic skill change lacks a verified skill or requirement-evidence link.", change }); continue; }
    diff.skillChanges.push({ candidateId: `v2:skill:${index}:${skill.id}`, type: change.type, groupLabel: change.targetGroup, baseItem: change.baseItem || undefined, replacementItem: skill.skill, requirementIds: change.requirementIds, justification: change.justification });
  }
  const project = result.diff?.projectChanges?.[0];
  for (const change of (result.diff?.projectChanges || []).slice(1)) rejected.push({ type: "project", reason: "Project swap cap exceeded.", change });
  if (project) {
    const replacementId = `project:${project.replacementProjectId}`;
    if (acceptLink(project, [replacementId, ...(evidenceIndex.get(replacementId)?.value?.bullets || []).map((bullet) => bullet.id)])) diff.projectSwap = { candidateId: `v2:project:${project.baseProjectId}:${project.replacementProjectId}`, baseProjectId: project.baseProjectId, replacementProjectId: project.replacementProjectId, requirementIds: project.requirementIds, justification: project.justification };
    else rejected.push({ type: "project", reason: "Semantic project change lacks a verified requirement-evidence link.", change: project });
  }
  const summary = result.diff?.summaryChanges?.[0];
  for (const change of (result.diff?.summaryChanges || []).slice(1)) rejected.push({ type: "summary", reason: "Summary change cap exceeded.", change });
  if (summary) {
    const evidenceId = `summary:${summary.summaryId}`;
    if (acceptLink(summary, [evidenceId])) diff.summaryChange = { candidateId: `v2:summary:${summary.summaryId}`, summaryId: summary.summaryId, requirementIds: summary.requirementIds, justification: summary.justification };
    else rejected.push({ type: "summary", reason: "Semantic summary change lacks a verified requirement-evidence link.", change: summary });
  }
  return { diff, rejected };
}

function compatibilityAnalysis(result, base, blockers) {
  return {
    roleFamily: result.roleFamily,
    seniority: result.seniority,
    mustHaveKeywords: result.requirements.filter((item) => item.priority === "must").map((item) => item.text),
    niceToHaveKeywords: result.requirements.filter((item) => item.priority === "preferred").map((item) => item.text),
    responsibilities: result.requirements.filter((item) => item.kind === "responsibility").map((item) => item.text),
    blockers, recommendedVariant: base.variant,
    reasoningSummary: "Requirements were mapped semantically to verified resume evidence by Resume Optimizer V2.",
  };
}

async function generateSemanticResumeOptimization({ client, apiKey, bank, base, job, signal, generateDir, progress }) {
  progress?.("Semantically optimizing verified resume evidence");
  const [{ buildVerifiedEvidenceCatalog, indexVerifiedEvidenceCatalog }, { applyTailoringDiff }, { detectExplicitEligibilityBlockers }] = await Promise.all([
    import(pathToFileURL(path.join(generateDir, "evidenceCatalog.js")).href),
    import(pathToFileURL(path.join(generateDir, "tailoringDiff.js")).href),
    import(pathToFileURL(path.join(generateDir, "eligibilityBlockers.js")).href),
  ]);
  const { catalog } = buildVerifiedEvidenceCatalog(bank, base);
  const evidenceIndex = indexVerifiedEvidenceCatalog(catalog);
  const catalogText = JSON.stringify(catalog);
  const userText = JSON.stringify({
    job: { title: job.title, description: job.description },
    instruction: "Return all meaningful requirements and the smallest useful diff. Empty change arrays are preferred when the selected base already covers the role. For unused conditional fields such as replacementBulletId, rewrittenText, and baseItem, return an empty string.",
  });
  const body = {
    model: MODEL, max_tokens: 6000, thinking: { type: "disabled" },
    system: [
      { type: "text", text: SEMANTIC_OPTIMIZER_SYSTEM },
      { type: "text", text: `VERIFIED EVIDENCE CATALOG\n${catalogText}`, cache_control: { type: "ephemeral" } },
    ],
    output_config: { effort: "low", format: { type: "json_schema", schema: semanticOptimizerSchema(base, catalog) } },
    messages: [{ role: "user", content: userText }],
  };
  const requestMetrics = { serializedRequestBytes: Buffer.byteLength(JSON.stringify(body)), catalogBytes: Buffer.byteLength(catalogText), dynamicBytes: Buffer.byteLength(userText) };
  requestMetrics.approximateInputTokens = Math.ceil(requestMetrics.serializedRequestBytes / 4);
  const diagnostics = { model: MODEL, apiDurationMs: null, usage: null, cacheUsage: null, requestMetrics };
  const withDiagnostics = (error) => { if (error && !error.optimizerDiagnostics) error.optimizerDiagnostics = { ...diagnostics }; return error; };
  const apiStartedAt = Date.now();
  let response;
  try { response = await client.request({ apiKey, signal, stream: true, timeoutMs: 120000, body }); }
  catch (error) { diagnostics.apiDurationMs = Date.now() - apiStartedAt; if (error && !error.tailoringStage) error.tailoringStage = "semantic-optimizer-request"; throw withDiagnostics(error); }
  diagnostics.apiDurationMs = Date.now() - apiStartedAt;
  diagnostics.usage = response.usage || null;
  diagnostics.cacheUsage = response.usage ? { cacheCreationInputTokens: response.usage.cache_creation_input_tokens ?? null, cacheReadInputTokens: response.usage.cache_read_input_tokens ?? null } : null;
  let proposal;
  try { proposal = parseJsonText(response.text, "Sonnet semantic resume optimization", { stopReason: response.stopReason }); }
  catch (error) { if (error && !error.tailoringStage) error.tailoringStage = "semantic-response-parsing"; throw withDiagnostics(error); }
  diagnostics.requirementTrace = Array.isArray(proposal?.requirements) ? proposal.requirements.map((requirement) => ({
    id: sanitizeDiagnosticMessage(requirement?.id),
    text: sanitizeDiagnosticMessage(requirement?.text),
    priority: sanitizeDiagnosticMessage(requirement?.priority),
    kind: sanitizeDiagnosticMessage(requirement?.kind),
    currentEvidenceIds: Array.isArray(requirement?.currentEvidenceIds) ? requirement.currentEvidenceIds.map((id) => sanitizeDiagnosticMessage(id)) : [],
    candidateEvidenceIds: Array.isArray(requirement?.candidateEvidenceIds) ? requirement.candidateEvidenceIds.map((id) => sanitizeDiagnosticMessage(id)) : [],
    knowledgeSkillIds: Array.isArray(requirement?.knowledgeSkillIds) ? requirement.knowledgeSkillIds.map((id) => sanitizeDiagnosticMessage(id)) : [],
    reason: sanitizeDiagnosticMessage(requirement?.reason),
  })) : [];
  let normalized;
  try {
    normalized = normalizeRequirements(proposal, catalog, evidenceIndex);
  }
  catch (error) { if (error && !error.tailoringStage) error.tailoringStage = "semantic-validation"; throw withDiagnostics(error); }
  const blockers = detectExplicitEligibilityBlockers(job.description);
  proposal = { ...proposal, requirements: resolveKnowledgeSkillNames(normalized.requirements, catalog) };
  diagnostics.requirementTrace = proposal.requirements.map((requirement) => ({
    id: sanitizeDiagnosticMessage(requirement.id), text: sanitizeDiagnosticMessage(requirement.text), priority: requirement.priority, kind: requirement.kind, derivedStatus: requirement.status,
    currentEvidenceIds: requirement.currentEvidenceIds, candidateEvidenceIds: requirement.candidateEvidenceIds, knowledgeSkillIds: requirement.knowledgeSkillIds,
    discardedEvidence: requirement.discardedEvidence, reason: sanitizeDiagnosticMessage(requirement.reason),
  }));
  const expanded = expandSemanticDiff(proposal, catalog, evidenceIndex);
  let applied;
  try { applied = applyTailoringDiff({ bank, base, diff: expanded.diff, semanticRequirements: proposal.requirements }); }
  catch (error) { if (error && !error.tailoringStage) error.tailoringStage = "semantic-tailoring-application"; throw withDiagnostics(error); }
  applied.rejected = [...expanded.rejected, ...applied.rejected];
  const requirementById = new Map(proposal.requirements.map((item) => [item.id, item]));
  const candidates = [...applied.acceptedDiff.bulletChanges, ...applied.acceptedDiff.skillChanges, applied.acceptedDiff.projectSwap, applied.acceptedDiff.summaryChange].filter(Boolean).map((change) => ({
    id: change.candidateId,
    expectedGain: (change.requirementIds || []).reduce((sum, id) => sum + (requirementById.get(id)?.priority === "must" ? 2 : 1), 0),
  }));
  progress?.("Validating bounded semantic tailoring changes");
  return {
    ...applied, proposedDiff: proposal.diff, requirements: proposal.requirements, requirementIssues: normalized.issues,
    analysis: compatibilityAnalysis(proposal, base, blockers), usage: diagnostics.usage,
    cacheUsage: diagnostics.cacheUsage,
    model: MODEL, usedFallback: false, apiDurationMs: diagnostics.apiDurationMs,
    backoffPlan: { candidates },
    requestMetrics,
  };
}

module.exports = { MODEL, semanticOptimizerSchema, normalizeRequirements, validateRequirements, resolveKnowledgeSkillNames, expandSemanticDiff, generateSemanticResumeOptimization };
