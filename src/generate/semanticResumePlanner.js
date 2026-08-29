import { compatibleSkillGroupLabel, TAILORING_CAPS } from "./tailoringDiff.js";
import { projectEvidenceId, skillEvidenceId } from "./evidenceCatalog.js";

export const SEMANTIC_UTILITY_WEIGHTS = Object.freeze({
  mustCoverageGain: 120,
  preferredCoverageGain: 42,
  evidenceStrengthStep: 10,
  additionalRequirement: 8,
  mustCoverageLoss: 150,
  preferredCoverageLoss: 55,
  quantifiedEvidenceLoss: 500,
  pageLineCost: 6,
  changePenalty: 12,
  minimumBulletUtility: 28,
  minimumSkillUtility: 24,
  minimumProjectUtility: 55,
  minimumSummaryUtility: 50,
});

const clone = (value) => JSON.parse(JSON.stringify(value));
const numberTokens = (text) => String(text || "").match(/\b\d+(?:\.\d+)?(?:%|[A-Za-z]+)?\b/g) || [];
const priorityValue = (requirement, mustValue, preferredValue) => requirement.priority === "must" ? mustValue : preferredValue;

function evidenceStrength(evidence) {
  if (!evidence) return 0;
  if (["experience-bullet", "project-bullet"].includes(evidence.kind)) return 5;
  if (["experience", "project"].includes(evidence.kind)) return 4;
  if (evidence.kind === "education") return 3;
  if (evidence.kind === "skill") return 2;
  if (evidence.kind === "summary") return 1;
  return 0;
}

function evidenceText(evidence) {
  return evidence?.value?.text || (evidence?.value?.bullets || []).map((bullet) => bullet.text).join(" ") || "";
}

function intersects(ids, candidates) {
  const values = new Set(candidates);
  return ids.some((id) => values.has(id));
}

function utilityForChange({ requirements, evidenceIndex, addedIds, removedIds = [], addedText = "", removedText = "" }) {
  let gain = 0;
  let loss = 0;
  let supported = 0;
  const requirementIds = [];
  for (const requirement of requirements) {
    const candidateSupports = intersects(requirement.candidateEvidenceIds || [], addedIds)
      || (requirement.evidenceExpectation === "knowledge" && intersects(requirement.knowledgeSkillIds || [], addedIds));
    if (candidateSupports) {
      supported += 1;
      requirementIds.push(requirement.id);
      if (!requirement.currentEvidenceIds.length) {
        gain += priorityValue(requirement, SEMANTIC_UTILITY_WEIGHTS.mustCoverageGain, SEMANTIC_UTILITY_WEIGHTS.preferredCoverageGain);
      } else {
        const currentStrength = Math.max(0, ...requirement.currentEvidenceIds.map((id) => evidenceStrength(evidenceIndex.get(id))));
        const candidateStrength = Math.max(0, ...addedIds.map((id) => evidenceStrength(evidenceIndex.get(id))));
        gain += Math.max(0, candidateStrength - currentStrength) * SEMANTIC_UTILITY_WEIGHTS.evidenceStrengthStep;
      }
    }
    const removedSoleSupport = intersects(requirement.currentEvidenceIds || [], removedIds)
      && !(requirement.currentEvidenceIds || []).some((id) => !removedIds.includes(id));
    if (removedSoleSupport && !candidateSupports) loss += priorityValue(requirement, SEMANTIC_UTILITY_WEIGHTS.mustCoverageLoss, SEMANTIC_UTILITY_WEIGHTS.preferredCoverageLoss);
  }
  gain += Math.max(0, supported - 1) * SEMANTIC_UTILITY_WEIGHTS.additionalRequirement;
  const removedMetrics = numberTokens(removedText);
  const retainedMetrics = new Set(numberTokens(addedText));
  const metricLoss = removedMetrics.filter((metric) => !retainedMetrics.has(metric)).length;
  const pageCost = Math.max(0, addedText.length - removedText.length) / 119 * SEMANTIC_UTILITY_WEIGHTS.pageLineCost;
  const utility = gain - loss - metricLoss * SEMANTIC_UTILITY_WEIGHTS.quantifiedEvidenceLoss - pageCost - SEMANTIC_UTILITY_WEIGHTS.changePenalty;
  return { utility, gain, loss, metricLoss, pageCost, requirementIds };
}

function candidateRecord(type, change, score, minimum) {
  return { type, change, score, acceptedForPlanning: score.requirementIds.length > 0 && score.utility >= minimum };
}

function bulletCandidates(base, catalog, evidenceIndex, requirements) {
  const output = [];
  for (const replacement of catalog.alternatives.experienceBullets || []) {
    const entry = base.experience.find((item) => item.entryId === replacement.entryId);
    if (!entry) continue;
    for (const current of entry.bullets) {
      const score = utilityForChange({ requirements, evidenceIndex, addedIds: [replacement.id], removedIds: [current.sourceBulletId], addedText: replacement.text, removedText: current.text });
      const change = {
        candidateId: `deterministic:bullet:${current.sourceBulletId}:${replacement.id}`,
        type: "swap", entryId: entry.entryId, baseBulletId: current.sourceBulletId, replacementBulletId: replacement.id,
        requirementIds: score.requirementIds,
        justification: `Deterministic semantic utility ${score.utility.toFixed(1)} from verified requirement evidence.`,
      };
      output.push(candidateRecord("bullet", change, score, SEMANTIC_UTILITY_WEIGHTS.minimumBulletUtility));
    }
  }
  return output;
}

function skillCandidates(base, catalog, evidenceIndex, requirements) {
  const rendered = new Set(base.skills.flatMap((group) => group.items.map(skillEvidenceId)));
  return (catalog.alternatives.skills.inventory || []).filter((skill) => !rendered.has(skill.id)).map((skill) => {
    const groupLabel = compatibleSkillGroupLabel(base, skill);
    const score = utilityForChange({ requirements, evidenceIndex, addedIds: [skill.id], addedText: skill.skill });
    const change = {
      candidateId: `deterministic:skill:${skill.id}`, type: "add", groupLabel,
      replacementItem: skill.skill, requirementIds: score.requirementIds,
      justification: `Deterministic semantic utility ${score.utility.toFixed(1)} from verified requirement evidence.`,
    };
    const record = candidateRecord("skill", change, score, SEMANTIC_UTILITY_WEIGHTS.minimumSkillUtility);
    if (!groupLabel) record.acceptedForPlanning = false;
    return record;
  });
}

function projectCandidates(base, catalog, evidenceIndex, requirements) {
  const output = [];
  for (const replacement of catalog.alternatives.projects || []) {
    const addedIds = [replacement.id, ...(replacement.bullets || []).map((bullet) => bullet.id)];
    const addedText = [replacement.title, replacement.role, ...(replacement.bullets || []).map((bullet) => bullet.text)].join(" ");
    for (const current of base.projects) {
      const removedIds = [projectEvidenceId(current.entryId), ...current.bullets.map((bullet) => bullet.sourceBulletId)];
      const removedText = [current.title, current.role, ...current.bullets.map((bullet) => bullet.text)].join(" ");
      const score = utilityForChange({ requirements, evidenceIndex, addedIds, removedIds, addedText, removedText });
      const change = {
        candidateId: `deterministic:project:${current.entryId}:${replacement.projectId}`,
        baseProjectId: current.entryId, replacementProjectId: replacement.projectId,
        requirementIds: score.requirementIds,
        justification: `Deterministic semantic utility ${score.utility.toFixed(1)} from verified requirement evidence.`,
      };
      output.push(candidateRecord("project", change, score, SEMANTIC_UTILITY_WEIGHTS.minimumProjectUtility));
    }
  }
  return output;
}

function summaryCandidates(base, catalog, evidenceIndex, requirements) {
  return (catalog.alternatives.summaries || []).map((summary) => {
    const score = utilityForChange({ requirements, evidenceIndex, addedIds: [summary.id], removedIds: [catalog.base.summary.id], addedText: summary.text, removedText: base.summary });
    const change = {
      candidateId: `deterministic:summary:${summary.summaryId}`, summaryId: summary.summaryId,
      requirementIds: score.requirementIds,
      justification: `Deterministic semantic utility ${score.utility.toFixed(1)} from verified requirement evidence.`,
    };
    return candidateRecord("summary", change, score, SEMANTIC_UTILITY_WEIGHTS.minimumSummaryUtility);
  });
}

export function planSemanticResumeChanges({ base, catalog, evidenceIndex, requirements }) {
  const proposed = [
    ...bulletCandidates(base, catalog, evidenceIndex, requirements),
    ...skillCandidates(base, catalog, evidenceIndex, requirements),
    ...projectCandidates(base, catalog, evidenceIndex, requirements),
    ...summaryCandidates(base, catalog, evidenceIndex, requirements),
  ].sort((left, right) => right.score.utility - left.score.utility || left.change.candidateId.localeCompare(right.change.candidateId));
  const diff = { version: 1, baseResumeId: base.id, summaryChange: null, bulletChanges: [], projectSwap: null, skillChanges: [] };
  const plannedIds = new Set();
  const plannedRequirements = new Set();
  const occupiedBullets = new Set();
  const usedEvidence = new Set();
  const rejected = [];
  for (const candidate of proposed) {
    if (!candidate.acceptedForPlanning) {
      if (candidate.score.requirementIds.length) rejected.push({ type: candidate.type, reason: `Deterministic utility ${candidate.score.utility.toFixed(1)} did not meet the ${candidate.type} threshold.`, change: clone(candidate.change), utility: candidate.score });
      continue;
    }
    if (candidate.score.requirementIds.every((id) => plannedRequirements.has(id))) continue;
    if (candidate.type === "bullet") {
      if (diff.bulletChanges.length >= TAILORING_CAPS.bulletChanges || occupiedBullets.has(candidate.change.baseBulletId) || usedEvidence.has(candidate.change.replacementBulletId)) continue;
      diff.bulletChanges.push(clone(candidate.change)); occupiedBullets.add(candidate.change.baseBulletId);
      usedEvidence.add(candidate.change.replacementBulletId);
    } else if (candidate.type === "skill") {
      if (diff.skillChanges.length >= TAILORING_CAPS.skillChanges) continue;
      diff.skillChanges.push(clone(candidate.change));
    } else if (candidate.type === "project") {
      if (diff.projectSwap) continue;
      diff.projectSwap = clone(candidate.change);
    } else if (candidate.type === "summary") {
      if (diff.summaryChange) continue;
      diff.summaryChange = clone(candidate.change);
    }
    plannedIds.add(candidate.change.candidateId);
    candidate.score.requirementIds.forEach((id) => plannedRequirements.add(id));
  }
  const candidates = proposed.filter((item) => plannedIds.has(item.change.candidateId)).map((item) => ({ id: item.change.candidateId, expectedGain: item.score.utility, utility: item.score }));
  const swappedBullets = new Set(diff.bulletChanges.map((change) => change.baseBulletId));
  const alternativeEntryById = new Map((catalog.alternatives.experienceBullets || []).map((bullet) => [bullet.id, bullet.entryId]));
  const baseBulletById = new Map(base.experience.flatMap((entry) => entry.bullets.map((bullet) => [bullet.sourceBulletId, { ...bullet, entryId: entry.entryId }])));
  const handsOnEvidence = catalog.alternatives.skills.handsOnEvidence || {};
  const skillNameById = new Map((catalog.alternatives.skills.inventory || []).map((skill) => [skill.id, skill.skill]));
  const rewriteOpportunities = requirements.filter((requirement) => requirement.priority === "must" && requirement.evidenceExpectation === "accomplishment")
    .flatMap((requirement) => (requirement.currentEvidenceIds || []).map((id) => ({ requirement, bullet: baseBulletById.get(id) })).filter((item) => item.bullet))
    .filter(({ requirement, bullet }) => !swappedBullets.has(bullet.sourceBulletId)
      && (requirement.candidateEvidenceIds || []).some((id) => alternativeEntryById.get(id) === bullet.entryId))
    .map(({ requirement, bullet }) => ({
      baseBulletId: bullet.sourceBulletId,
      entryId: bullet.entryId,
      originalBullet: bullet.text,
      requirementIds: [requirement.id],
      requirementTexts: [requirement.text],
      allowedSupportedTerminology: Object.entries(handsOnEvidence).filter(([, ids]) => ids.includes(bullet.sourceBulletId)).map(([id]) => skillNameById.get(id)).filter(Boolean),
    })).slice(0, 1);
  return { diff, candidates, rejected, rewriteOpportunities, evaluatedCandidates: proposed.map((item) => ({ type: item.type, candidateId: item.change.candidateId, utility: item.score.utility, acceptedForPlanning: plannedIds.has(item.change.candidateId), requirementIds: item.score.requirementIds })) };
}
