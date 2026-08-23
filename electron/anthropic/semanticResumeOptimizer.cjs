const path = require("path");
const { pathToFileURL } = require("url");
const { SEMANTIC_OPTIMIZER_SYSTEM } = require("./prompts.cjs");
const { parseJsonText } = require("./validation.cjs");
const { MODELS } = require("./models.cjs");

const MODEL = MODELS.writing;
const REQUIREMENT_PRIORITIES = ["must", "preferred"];
const REQUIREMENT_KINDS = ["technical-skill", "experience", "responsibility", "qualification"];
const REQUIREMENT_STATUSES = ["covered", "coverable", "knowledge-only", "unsupported"];

const stringArray = { type: "array", items: { type: "string" } };
const changeCommon = {
  requirementIds: stringArray,
  justification: { type: "string" },
};

function semanticOptimizerSchema(base) {
  return {
    type: "object", additionalProperties: false,
    properties: {
      version: { type: "integer", enum: [2] },
      baseResumeId: { type: "string", enum: [base.id] },
      roleFamily: { type: "string" },
      seniority: { type: "string" },
      requirements: {
        type: "array",
        items: {
          type: "object", additionalProperties: false,
          properties: {
            id: { type: "string" }, text: { type: "string" },
            priority: { type: "string", enum: REQUIREMENT_PRIORITIES },
            kind: { type: "string", enum: REQUIREMENT_KINDS },
            status: { type: "string", enum: REQUIREMENT_STATUSES },
            currentEvidenceIds: stringArray, candidateEvidenceIds: stringArray,
            knowledgeSkills: stringArray, reason: { type: "string" },
          },
          required: ["id", "text", "priority", "kind", "status", "currentEvidenceIds", "candidateEvidenceIds", "knowledgeSkills", "reason"],
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
    required: ["version", "baseResumeId", "roleFamily", "seniority", "requirements", "diff"],
  };
}

const fail = (message, stage = "semantic-validation") => { const error = Object.assign(new Error(message), { code: "VALIDATION_FAILED", tailoringStage: stage }); throw error; };
const normalize = (value) => String(value || "").trim().toLowerCase();

function validateRequirements(result, catalog, evidenceIndex) {
  if (result?.version !== 2 || result?.baseResumeId !== catalog.base.id || !Array.isArray(result?.requirements)) fail("Semantic optimizer returned an invalid top-level contract.");
  const ids = new Set();
  const skillByName = new Map(catalog.alternatives.skills.inventory.map((skill) => [normalize(skill.skill), { ...skill, classification: Object.hasOwn(catalog.alternatives.skills.handsOnEvidence, skill.id) ? "hands-on" : catalog.alternatives.skills.defaultClassification }]));
  for (const requirement of result.requirements) {
    if (!requirement?.id || ids.has(requirement.id) || !String(requirement.text || "").trim()) fail("Semantic optimizer returned a missing or duplicate requirement ID.");
    ids.add(requirement.id);
    if (!REQUIREMENT_PRIORITIES.includes(requirement.priority) || !REQUIREMENT_KINDS.includes(requirement.kind) || !REQUIREMENT_STATUSES.includes(requirement.status)) fail(`Requirement '${requirement.id}' has an invalid classification.`);
    for (const id of [...requirement.currentEvidenceIds, ...requirement.candidateEvidenceIds]) if (!evidenceIndex.has(id)) fail(`Requirement '${requirement.id}' references unknown evidence '${id}'.`);
    for (const id of requirement.currentEvidenceIds) if (!evidenceIndex.get(id).current) fail(`Requirement '${requirement.id}' labels non-current evidence '${id}' as current.`);
    const knowledge = requirement.knowledgeSkills.map((name) => skillByName.get(normalize(name)));
    const cited = [...requirement.currentEvidenceIds, ...requirement.candidateEvidenceIds].map((id) => evidenceIndex.get(id));
    if (knowledge.some((skill) => !skill)) fail(`Requirement '${requirement.id}' references an unknown knowledge skill.`);
    if (requirement.status === "covered" && !requirement.currentEvidenceIds.length) fail(`Covered requirement '${requirement.id}' lacks current evidence.`);
    if (requirement.status === "coverable" && !requirement.candidateEvidenceIds.length) fail(`Coverable requirement '${requirement.id}' lacks candidate evidence.`);
    if (["covered", "coverable"].includes(requirement.status) && cited.length && cited.every((item) => item.kind === "skill" && item.value.classification !== "hands-on")) fail(`Requirement '${requirement.id}' must classify skill-only knowledge evidence as knowledge-only.`);
    if (["experience", "responsibility"].includes(requirement.kind) && ["covered", "coverable"].includes(requirement.status) && cited.every((item) => item.kind === "skill")) fail(`Requirement '${requirement.id}' demands accomplishment evidence, not only Skills entries.`);
    if (requirement.status === "knowledge-only" && (!knowledge.length || knowledge.some((skill) => skill.classification !== "knowledge") || knowledge.some((skill) => ![...requirement.currentEvidenceIds, ...requirement.candidateEvidenceIds].includes(skill.id)))) fail(`Knowledge-only requirement '${requirement.id}' lacks verified knowledge-only skill evidence.`);
    if (requirement.status === "unsupported" && (requirement.currentEvidenceIds.length || requirement.candidateEvidenceIds.length || requirement.knowledgeSkills.length)) fail(`Unsupported requirement '${requirement.id}' cannot cite supporting evidence.`);
  }
  return ids;
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
  const acceptLink = (change, evidenceIds) => requirementsSupportChange(change, requirementIds, requirements)
    && change.requirementIds.some((id) => {
      const requirement = requirements.get(id);
      return evidenceIds.some((evidenceId) => requirement.currentEvidenceIds.includes(evidenceId) || requirement.candidateEvidenceIds.includes(evidenceId));
    });
  for (const [index, change] of (result.diff?.bulletChanges || []).entries()) {
    const entryId = bulletLocations.get(change.baseBulletId);
    const evidenceIds = change.type === "swap" ? [change.replacementBulletId] : [change.baseBulletId];
    if (!entryId || !acceptLink(change, evidenceIds)) { rejected.push({ type: "bullet", reason: "Semantic bullet change lacks a valid base target or requirement-evidence link.", change }); continue; }
    diff.bulletChanges.push({ candidateId: `v2:bullet:${index}:${change.baseBulletId}`, type: change.type, entryId, baseBulletId: change.baseBulletId, replacementBulletId: change.replacementBulletId || undefined, rewrittenText: change.rewrittenText || undefined, requirementIds: change.requirementIds, justification: change.justification });
  }
  for (const [index, change] of (result.diff?.skillChanges || []).entries()) {
    const skill = catalog.alternatives.skills.inventory.find((item) => normalize(item.skill) === normalize(change.skill));
    if (!skill || !acceptLink(change, [skill.id])) { rejected.push({ type: "skill", reason: "Semantic skill change lacks a verified skill or requirement-evidence link.", change }); continue; }
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

function compatibilityAnalysis(result, base) {
  return {
    roleFamily: result.roleFamily,
    seniority: result.seniority,
    mustHaveKeywords: result.requirements.filter((item) => item.priority === "must").map((item) => item.text),
    niceToHaveKeywords: result.requirements.filter((item) => item.priority === "preferred").map((item) => item.text),
    responsibilities: result.requirements.filter((item) => item.kind === "responsibility").map((item) => item.text),
    blockers: [], recommendedVariant: base.variant,
    reasoningSummary: "Requirements were mapped semantically to verified resume evidence by Resume Optimizer V2.",
  };
}

async function generateSemanticResumeOptimization({ client, apiKey, bank, base, job, signal, generateDir, progress }) {
  progress?.("Semantically optimizing verified resume evidence");
  const [{ buildVerifiedEvidenceCatalog, indexVerifiedEvidenceCatalog }, { applyTailoringDiff }] = await Promise.all([
    import(pathToFileURL(path.join(generateDir, "evidenceCatalog.js")).href),
    import(pathToFileURL(path.join(generateDir, "tailoringDiff.js")).href),
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
    output_config: { effort: "low", format: { type: "json_schema", schema: semanticOptimizerSchema(base) } },
    messages: [{ role: "user", content: userText }],
  };
  const serializedRequestBytes = Buffer.byteLength(JSON.stringify(body));
  const apiStartedAt = Date.now();
  let response;
  try { response = await client.request({ apiKey, signal, stream: true, timeoutMs: 120000, body }); }
  catch (error) { if (error && !error.tailoringStage) error.tailoringStage = "semantic-optimizer-request"; throw error; }
  let proposal;
  try { proposal = parseJsonText(response.text, "Sonnet semantic resume optimization", { stopReason: response.stopReason }); }
  catch (error) { if (error && !error.tailoringStage) error.tailoringStage = "semantic-response-parsing"; throw error; }
  const requirementIds = validateRequirements(proposal, catalog, evidenceIndex);
  if (!requirementIds.size) fail("Semantic optimizer returned no meaningful requirements.");
  const expanded = expandSemanticDiff(proposal, catalog, evidenceIndex);
  const applied = applyTailoringDiff({ bank, base, diff: expanded.diff, semanticRequirements: proposal.requirements });
  applied.rejected = [...expanded.rejected, ...applied.rejected];
  const requirementById = new Map(proposal.requirements.map((item) => [item.id, item]));
  const candidates = [...applied.acceptedDiff.bulletChanges, ...applied.acceptedDiff.skillChanges, applied.acceptedDiff.projectSwap, applied.acceptedDiff.summaryChange].filter(Boolean).map((change) => ({
    id: change.candidateId,
    expectedGain: (change.requirementIds || []).reduce((sum, id) => sum + (requirementById.get(id)?.priority === "must" ? 2 : 1), 0),
  }));
  progress?.("Validating bounded semantic tailoring changes");
  return {
    ...applied, proposedDiff: proposal.diff, requirements: proposal.requirements,
    analysis: compatibilityAnalysis(proposal, base), usage: response.usage || null,
    cacheUsage: response.usage ? { cacheCreationInputTokens: response.usage.cache_creation_input_tokens ?? null, cacheReadInputTokens: response.usage.cache_read_input_tokens ?? null } : null,
    model: MODEL, usedFallback: false, apiDurationMs: Date.now() - apiStartedAt,
    backoffPlan: { candidates },
    requestMetrics: { serializedRequestBytes, catalogBytes: Buffer.byteLength(catalogText), dynamicBytes: Buffer.byteLength(userText), approximateInputTokens: Math.ceil(serializedRequestBytes / 4) },
  };
}

module.exports = { MODEL, semanticOptimizerSchema, validateRequirements, expandSemanticDiff, generateSemanticResumeOptimization };
