const path = require("path");
const { pathToFileURL } = require("url");
const { SELECTION_SYSTEM } = require("./prompts.cjs");
const { parseJsonText } = require("./validation.cjs");
const { MODELS } = require("./models.cjs");

const MODEL = MODELS.writing;

function summaryIds(bank) {
  return [
    ...Object.keys(bank.summary?.byVariant || {}).map((key) => `variant:${key}`),
    ...Object.keys(bank.summary?.byEmphasis || {}).map((key) => `emphasis:${key}`),
  ];
}

function tailoringDiffSchema(bank, base, relevancePlan = null) {
  const candidates = relevancePlan?.candidates || [];
  const idsFor = (type) => candidates.filter((candidate) => candidate.type === type).map((candidate) => candidate.id);
  const enumOrSentinel = (values) => values.length ? values : ["no-approved-candidates"];
  const baseExperienceIds = base.experience.map((entry) => entry.entryId);
  const baseBulletIds = base.experience.flatMap((entry) => entry.bullets.map((bullet) => bullet.sourceBulletId));
  const experienceBulletIds = bank.experience.flatMap((entry) => entry.bullets.map((bullet) => bullet.id));
  const baseProjectIds = base.projects.map((project) => project.entryId);
  const replacementProjectIds = bank.projects.map((project) => project.id).filter((id) => !baseProjectIds.includes(id));
  const baseSkillLabels = base.skills.map((group) => group.label);
  const baseSkillItems = base.skills.flatMap((group) => group.items);
  const verifiedSkillItems = [...new Set(bank.skillGroups.flatMap((group) => group.items))];
  const properties = {
      version: { type: "integer", enum: [1] },
      baseResumeId: { type: "string", enum: [base.id] },
      // Anthropic's raw structured-output schema does not support maxItems.
      // The hard 3/4 caps remain enforced by applyTailoringDiff below.
      bulletChanges: { type: "array", items: { type: "object", additionalProperties: false, properties: { candidateId: { type: "string", enum: enumOrSentinel([...idsFor("bullet-swap"), ...idsFor("bullet-rewrite")]) }, type: { type: "string", enum: ["swap", "rewrite"] }, entryId: { type: "string", enum: baseExperienceIds }, baseBulletId: { type: "string", enum: baseBulletIds }, replacementBulletId: { type: "string", enum: experienceBulletIds }, rewrittenText: { type: "string" }, justification: { type: "string" } }, required: relevancePlan ? ["candidateId", "type", "entryId", "baseBulletId", "justification"] : ["type", "entryId", "baseBulletId", "justification"] } },
      skillChanges: { type: "array", items: { type: "object", additionalProperties: false, properties: { candidateId: { type: "string", enum: enumOrSentinel(idsFor("skill-edit")) }, type: { type: "string", enum: ["add", "swap"] }, groupLabel: { type: "string", enum: baseSkillLabels }, baseItem: { type: "string", enum: baseSkillItems }, replacementItem: { type: "string", enum: verifiedSkillItems }, justification: { type: "string" } }, required: relevancePlan ? ["candidateId", "type", "groupLabel", "replacementItem", "justification"] : ["type", "groupLabel", "replacementItem", "justification"] } },
  };
  if (!relevancePlan || idsFor("summary").length) properties.summaryChange = { type: "object", additionalProperties: false, properties: { candidateId: { type: "string", enum: enumOrSentinel(idsFor("summary")) }, summaryId: { type: "string", enum: summaryIds(bank) }, justification: { type: "string" } }, required: relevancePlan ? ["candidateId", "summaryId", "justification"] : ["summaryId", "justification"] };
  if (!relevancePlan || idsFor("project-swap").length) properties.projectSwap = { type: "object", additionalProperties: false, properties: { candidateId: { type: "string", enum: enumOrSentinel(idsFor("project-swap")) }, baseProjectId: { type: "string", enum: baseProjectIds }, replacementProjectId: { type: "string", enum: replacementProjectIds }, justification: { type: "string" } }, required: relevancePlan ? ["candidateId", "baseProjectId", "replacementProjectId", "justification"] : ["baseProjectId", "replacementProjectId", "justification"] };
  return {
    type: "object", additionalProperties: false,
    properties,
    required: ["version", "baseResumeId", "bulletChanges", "skillChanges"],
  };
}

async function generateResumeSelection({ client, apiKey, bank, base, job, analysis, extraction, coverage, relevancePlan, signal, generateDir, progress }) {
  progress?.("Proposing minimal base-resume changes");
  const { identity: _identity, ...promptBank } = bank;
  const promptPlan = relevancePlan || { gaps: [], unsupportedMissing: [], candidates: [], minimumBenefit: null };
  const stable = `${SELECTION_SYSTEM}\nVERIFIED CONTENT BANK (reference only; changes are restricted to the approved candidates supplied with the job):\n${JSON.stringify(promptBank)}`;
  const dynamic = JSON.stringify({ selectedBase: base, job, analysis, deterministicKeywords: extraction, baseCoverage: coverage, meaningfulGaps: promptPlan.gaps, unsupportedMissing: promptPlan.unsupportedMissing, approvedCandidates: promptPlan.candidates, minimumBenefit: promptPlan.minimumBenefit, instruction: "Prefer an empty diff. Use only approved candidateId values. Each accepted proposal must address one of that candidate's matchedTerms and state the concrete JD reason. Never propose unsupported terms, cosmetic edits, or a weaker metric-heavy evidence trade." });
  let response;
  try {
    response = await client.request({ apiKey, signal, stream: true, timeoutMs: 240000, body: { model: MODEL, max_tokens: 5000, system: [{ type: "text", text: stable, cache_control: { type: "ephemeral" } }], output_config: { format: { type: "json_schema", schema: tailoringDiffSchema(bank, base, relevancePlan) } }, messages: [{ role: "user", content: dynamic }] } });
  } catch (error) {
    if (error && !error.tailoringStage) error.tailoringStage = "selection-request";
    throw error;
  }
  let proposedDiff;
  try { proposedDiff = parseJsonText(response.text, "Sonnet tailoring diff", { stopReason: response.stopReason }); }
  catch (error) { if (error && !error.tailoringStage) error.tailoringStage = "response-parsing"; throw error; }
  const { applyTailoringDiff } = await import(pathToFileURL(path.join(generateDir, "tailoringDiff.js")).href);
  let applied;
  try { applied = applyTailoringDiff({ bank, base, diff: proposedDiff, extraction, analysis, relevancePlan }); }
  catch (error) { if (error && !error.tailoringStage) error.tailoringStage = "tailoring-validation-application"; throw error; }
  progress?.("Validating bounded tailoring changes");
  return { ...applied, proposedDiff, usage: response.usage || null, cacheUsage: response.usage ? { cacheCreationInputTokens: response.usage.cache_creation_input_tokens ?? null, cacheReadInputTokens: response.usage.cache_read_input_tokens ?? null } : null, model: MODEL, usedFallback: false };
}

module.exports = { MODEL, tailoringDiffSchema, generateResumeSelection };
