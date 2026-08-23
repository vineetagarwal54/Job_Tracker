const path = require("path");
const { pathToFileURL } = require("url");
const { SELECTION_SYSTEM } = require("./prompts.cjs");
const { parseJsonText } = require("./validation.cjs");
const { MODELS } = require("./models.cjs");

const MODEL = MODELS.writing;

function tailoringDiffSchema(_bank, base, relevancePlan = null) {
  const candidates = relevancePlan?.candidates || [];
  const decision = (ids, rewrite = false) => ({
    type: "array",
    items: {
      type: "object", additionalProperties: false,
      properties: {
        candidateId: { type: "string", enum: ids },
        ...(rewrite ? { rewrittenText: { type: "string" } } : {}),
        justification: { type: "string" },
      },
      required: rewrite ? ["candidateId", "rewrittenText", "justification"] : ["candidateId", "justification"],
    },
  });
  const regularIds = candidates.filter((candidate) => candidate.type !== "bullet-rewrite").map((candidate) => candidate.id);
  const rewriteIds = candidates.filter((candidate) => candidate.type === "bullet-rewrite").map((candidate) => candidate.id);
  const properties = {
    version: { type: "integer", enum: [1] },
    baseResumeId: { type: "string", enum: [base.id] },
  };
  const required = ["version", "baseResumeId"];
  if (regularIds.length) { properties.changes = decision(regularIds); required.push("changes"); }
  if (rewriteIds.length) { properties.bulletRewrites = decision(rewriteIds, true); required.push("bulletRewrites"); }
  return {
    type: "object", additionalProperties: false,
    properties,
    required,
  };
}

function findBaseBullet(base, entryId, bulletId) {
  return base.experience.find((entry) => entry.entryId === entryId)?.bullets.find((bullet) => bullet.sourceBulletId === bulletId)?.text || "";
}

function approvedCandidateContext(bank, base, relevancePlan) {
  const bullets = new Map(bank.experience.flatMap((entry) => entry.bullets.map((bullet) => [bullet.id, bullet.text])));
  const projects = new Map(bank.projects.map((project) => [project.id, project]));
  const summaries = new Map([
    ...Object.entries(bank.summary?.byVariant || {}).map(([id, text]) => [`variant:${id}`, text]),
    ...Object.entries(bank.summary?.byEmphasis || {}).map(([id, text]) => [`emphasis:${id}`, text]),
  ]);
  return (relevancePlan?.candidates || []).map((candidate) => {
    const context = { id: candidate.id, type: candidate.type, matchedTerms: candidate.matchedTerms, expectedGain: candidate.expectedGain, reason: candidate.reason };
    if (candidate.type === "bullet-swap") {
      context.baseText = findBaseBullet(base, candidate.entryId, candidate.baseBulletId);
      context.replacementText = bullets.get(candidate.replacementBulletId);
      context.preservesMetricStrength = candidate.preservesMetricStrength;
    } else if (candidate.type === "bullet-rewrite") {
      context.baseText = candidate.sourceText;
      context.allowedSupportedTerms = candidate.matchedTerms;
    } else if (candidate.type === "project-swap") {
      context.baseProject = base.projects.find((project) => project.entryId === candidate.baseProjectId);
      context.replacementProject = projects.get(candidate.replacementProjectId);
    } else if (candidate.type === "summary") {
      context.baseSummary = base.summary;
      context.replacementSummary = summaries.get(candidate.summaryId);
    } else if (candidate.type === "skill-edit") {
      context.skillGroup = candidate.groupLabel;
      context.skill = candidate.replacementItem;
      context.classification = candidate.classification;
    }
    return context;
  });
}

function compactCoverage(coverage) {
  const terms = (items) => (items || []).map((item) => item.normalized || item.value || item);
  return {
    coveragePercentage: coverage?.coveragePercentage ?? null,
    weightedCoveragePercentage: coverage?.weightedCoveragePercentage ?? null,
    coveredTerms: terms(coverage?.coveredKeywords),
    missingTerms: terms(coverage?.uncoveredKeywords),
    mustHave: { percentage: coverage?.mustHave?.percentage ?? null, covered: terms(coverage?.mustHave?.covered), missing: terms(coverage?.mustHave?.missing) },
  };
}

function expandCandidateSelections(proposal, relevancePlan) {
  const approved = new Map((relevancePlan?.candidates || []).map((candidate) => [candidate.id, candidate]));
  const diff = { version: 1, baseResumeId: relevancePlan.baseResumeId, summaryChange: null, bulletChanges: [], projectSwap: null, skillChanges: [] };
  const rejected = [];
  const selections = [...(Array.isArray(proposal?.changes) ? proposal.changes : []), ...(Array.isArray(proposal?.bulletRewrites) ? proposal.bulletRewrites : [])];
  for (const selection of selections) {
    const candidate = approved.get(selection?.candidateId);
    if (!candidate) { rejected.push({ type: "candidate", reason: "Model selected a candidate outside the approved relevance plan.", change: selection }); continue; }
    const common = { candidateId: candidate.id, justification: selection.justification };
    if (candidate.type === "bullet-swap") diff.bulletChanges.push({ ...common, type: "swap", entryId: candidate.entryId, baseBulletId: candidate.baseBulletId, replacementBulletId: candidate.replacementBulletId });
    else if (candidate.type === "bullet-rewrite") diff.bulletChanges.push({ ...common, type: "rewrite", entryId: candidate.entryId, baseBulletId: candidate.baseBulletId, rewrittenText: selection.rewrittenText });
    else if (candidate.type === "skill-edit") diff.skillChanges.push({ ...common, type: "add", groupLabel: candidate.groupLabel, replacementItem: candidate.replacementItem });
    else if (candidate.type === "project-swap" && !diff.projectSwap) diff.projectSwap = { ...common, baseProjectId: candidate.baseProjectId, replacementProjectId: candidate.replacementProjectId };
    else if (candidate.type === "summary" && !diff.summaryChange) diff.summaryChange = { ...common, summaryId: candidate.summaryId };
    else rejected.push({ type: candidate.type, reason: `Only one ${candidate.type} change is allowed.`, change: selection });
  }
  return { diff, rejected };
}

async function generateResumeSelection({ client, apiKey, bank, base, job, analysis, extraction, coverage, relevancePlan, signal, generateDir, progress }) {
  progress?.("Proposing minimal base-resume changes");
  const promptPlan = relevancePlan || { gaps: [], unsupportedMissing: [], candidates: [], minimumBenefit: null };
  if (!promptPlan.candidates.length) {
    const applied = (await import(pathToFileURL(path.join(generateDir, "tailoringDiff.js")).href)).applyTailoringDiff({ bank, base, diff: { version: 1, baseResumeId: base.id, bulletChanges: [], skillChanges: [] }, extraction, analysis, relevancePlan });
    return { ...applied, proposedDiff: { version: 1, baseResumeId: base.id, changes: [] }, usage: null, cacheUsage: null, model: MODEL, usedFallback: false, apiDurationMs: 0 };
  }
  const meaningfulGaps = (promptPlan.gaps || []).map(({ term, frequency, isMustHave, isResponsibility, weight, status }) => ({ term, frequency, isMustHave, isResponsibility, weight, status }));
  const dynamic = JSON.stringify({ selectedBase: base, job: { title: job.title, description: job.description }, analysis, baseCoverage: compactCoverage(coverage), meaningfulGaps, unsupportedMissing: promptPlan.unsupportedMissing, approvedCandidates: approvedCandidateContext(bank, base, promptPlan), minimumBenefit: promptPlan.minimumBenefit, instruction: "Prefer no changes. Put ordinary selections in changes. Put only bullet-rewrite selections in bulletRewrites with rewrittenText. Select only approved candidateId values and give a concrete JD-based justification. All referenced IDs and evidence are resolved deterministically after selection." });
  let response;
  const apiStartedAt = Date.now();
  try {
    response = await client.request({ apiKey, signal, stream: true, timeoutMs: 120000, body: { model: MODEL, max_tokens: 2000, system: SELECTION_SYSTEM, output_config: { effort: "high", format: { type: "json_schema", schema: tailoringDiffSchema(bank, base, relevancePlan) } }, messages: [{ role: "user", content: dynamic }] } });
  } catch (error) {
    if (error && !error.tailoringStage) error.tailoringStage = "selection-request";
    throw error;
  }
  let proposedDiff;
  try { proposedDiff = parseJsonText(response.text, "Sonnet tailoring diff", { stopReason: response.stopReason }); }
  catch (error) { if (error && !error.tailoringStage) error.tailoringStage = "response-parsing"; throw error; }
  const apiDurationMs = Date.now() - apiStartedAt;
  const expanded = expandCandidateSelections(proposedDiff, promptPlan);
  const { applyTailoringDiff } = await import(pathToFileURL(path.join(generateDir, "tailoringDiff.js")).href);
  let applied;
  try { applied = applyTailoringDiff({ bank, base, diff: expanded.diff, extraction, analysis, relevancePlan }); }
  catch (error) { if (error && !error.tailoringStage) error.tailoringStage = "tailoring-validation-application"; throw error; }
  applied.rejected = [...expanded.rejected, ...applied.rejected];
  progress?.("Validating bounded tailoring changes");
  return { ...applied, proposedDiff, usage: response.usage || null, cacheUsage: response.usage ? { cacheCreationInputTokens: response.usage.cache_creation_input_tokens ?? null, cacheReadInputTokens: response.usage.cache_read_input_tokens ?? null } : null, model: MODEL, usedFallback: false, apiDurationMs };
}

module.exports = { MODEL, approvedCandidateContext, expandCandidateSelections, tailoringDiffSchema, generateResumeSelection };
