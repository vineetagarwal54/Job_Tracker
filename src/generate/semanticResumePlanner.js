import { compatibleSkillGroupLabel, TAILORING_CAPS } from "./tailoringDiff.js";
import { projectEvidenceId, skillEvidenceId } from "./evidenceCatalog.js";

// All optimizer policy lives here. The 119-character bullet calibration comes
// from scripts/calibrate-wrap.js and the measured XCharter template. The other
// widths are geometry-derived: headings/summary use the full text width while
// each Skills minipage is 0.48 of that width. Compilation remains authoritative.
export const SEMANTIC_PLANNER_CONFIG = Object.freeze({
  utility: Object.freeze({
    mustCoverageGain: 120,
    preferredCoverageGain: 42,
    mustCoverageLoss: 150,
    preferredCoverageLoss: 55,
    evidenceStrengthStep: 10,
    pageLineCost: 6,
    minimumUsefulUtility: 0,
    rewriteOpportunityGain: 32,
    preferredRewriteOpportunityGain: 25,
  }),
  changeCosts: Object.freeze({
    skillAdd: 6,
    skillSwap: 8,
    bulletSwap: 18,
    bulletRewrite: 18,
    projectSwap: 34,
    summaryChange: 18,
  }),
  wrapCharacters: Object.freeze({
    experienceBullet: 119,
    projectBullet: 119,
    summary: 124,
    projectHeading: 124,
    skillLine: 60,
  }),
});

// Kept as a compatibility export for existing diagnostics consumers.
export const SEMANTIC_UTILITY_WEIGHTS = Object.freeze({
  ...SEMANTIC_PLANNER_CONFIG.utility,
  ...SEMANTIC_PLANNER_CONFIG.changeCosts,
});

const clone = (value) => JSON.parse(JSON.stringify(value));
const sorted = (values) => [...values].sort((left, right) => left.localeCompare(right));
const lower = (value) => String(value || "").trim().toLowerCase();
const MAX_EVALUATED_DIAGNOSTICS = 200;
const MAX_REJECTED_DIAGNOSTICS = 120;

function evidenceStrength(evidence) {
  if (!evidence) return 0;
  if (["experience-bullet", "project-bullet"].includes(evidence.kind)) return 5;
  if (["experience", "project"].includes(evidence.kind)) return 4;
  if (evidence.kind === "education") return 3;
  if (evidence.kind === "skill") return 2;
  if (evidence.kind === "summary") return 1;
  return 0;
}

function requirementSupportIds(requirement) {
  if (requirement.status === "unsupported") return [];
  const ids = [...(requirement.currentEvidenceIds || []), ...(requirement.candidateEvidenceIds || [])];
  if (requirement.evidenceExpectation === "knowledge" && ["technical-skill", "qualification"].includes(requirement.kind)) ids.push(...(requirement.knowledgeSkillIds || []));
  return [...new Set(ids)];
}

function coverageFor(requirements, evidenceIds, evidenceIndex) {
  const records = new Map();
  for (const requirement of requirements) {
    const survivingEvidenceIds = requirementSupportIds(requirement).filter((id) => evidenceIds.has(id));
    records.set(requirement.id, {
      covered: survivingEvidenceIds.length > 0,
      survivingEvidenceIds,
      strength: Math.max(0, ...survivingEvidenceIds.map((id) => evidenceStrength(evidenceIndex.get(id)))),
    });
  }
  return records;
}

function wrapLines(text, charactersPerLine) {
  const length = String(text || "").trim().length;
  return length ? Math.ceil(length / charactersPerLine) : 0;
}

function lineDelta(before, after, kind) {
  const width = SEMANTIC_PLANNER_CONFIG.wrapCharacters[kind];
  return Math.max(0, wrapLines(after, width) - wrapLines(before, width));
}

function skillLine(groupLabel, items) {
  return `${groupLabel}: ${items.join(", ")}`;
}

function estimatePageCost(candidate, state) {
  if (candidate.type === "bullet") return candidate.pageChanges.reduce((sum, change) => sum + lineDelta(change.removedText, change.addedText, "experienceBullet"), 0);
  if (candidate.type === "summary") return lineDelta(candidate.removedText, candidate.addedText, "summary");
  if (candidate.type === "project") {
    const current = candidate.currentProject;
    const replacement = candidate.replacementProject;
    const headingCost = lineDelta(`${current.title || ""} ${current.role || ""} ${current.dates || ""}`, `${replacement.title || ""} ${replacement.role || ""}`, "projectHeading");
    const beforeBullets = current.bullets || [];
    const afterBullets = (replacement.bullets || []).slice(0, beforeBullets.length);
    return headingCost + beforeBullets.reduce((sum, bullet, index) => sum + lineDelta(bullet.text, afterBullets[index]?.text, "projectBullet"), 0);
  }
  if (candidate.type === "skill") {
    const change = candidate.change;
    const beforeItems = [...(state.skillGroups.get(change.groupLabel) || [])];
    const afterItems = [...beforeItems];
    if (change.type === "add") afterItems.push(change.replacementItem);
    else {
      const index = afterItems.findIndex((item) => lower(item) === lower(change.baseItem));
      if (index >= 0) afterItems[index] = change.replacementItem;
    }
    return lineDelta(skillLine(change.groupLabel, beforeItems), skillLine(change.groupLabel, afterItems), "skillLine");
  }
  return 0;
}

function protectedMetrics(evidenceIndex, evidenceIds) {
  return [...new Set(evidenceIds.flatMap((id) => evidenceIndex.get(id)?.value?.lockedMetrics || []))];
}

function lostProtectedMetrics(candidate, evidenceIndex) {
  const addedText = String(candidate.addedText || "");
  return protectedMetrics(evidenceIndex, candidate.removedIds).filter((metric) => !addedText.includes(metric));
}

function candidateCost(candidate) {
  if (candidate.type === "bullet") return candidate.changes.length * SEMANTIC_PLANNER_CONFIG.changeCosts.bulletSwap;
  if (candidate.type === "skill") return SEMANTIC_PLANNER_CONFIG.changeCosts[candidate.change.type === "swap" ? "skillSwap" : "skillAdd"];
  if (candidate.type === "project") return SEMANTIC_PLANNER_CONFIG.changeCosts.projectSwap;
  return SEMANTIC_PLANNER_CONFIG.changeCosts.summaryChange;
}

function stateAfterEvidence(state, candidate) {
  const evidenceIds = new Set(state.survivingEvidenceIds);
  for (const id of candidate.removedIds) evidenceIds.delete(id);
  for (const id of candidate.addedIds) evidenceIds.add(id);
  return evidenceIds;
}

function scoreCandidate(candidate, state, requirements, evidenceIndex) {
  const before = coverageFor(requirements, state.survivingEvidenceIds, evidenceIndex);
  const after = coverageFor(requirements, stateAfterEvidence(state, candidate), evidenceIndex);
  const mustCoverageGained = [];
  const preferredCoverageGained = [];
  const coverageLost = [];
  const requirementIds = new Set();
  let evidenceStrengthGain = 0;
  let gain = 0;
  let loss = 0;
  for (const requirement of requirements) {
    const prior = before.get(requirement.id);
    const next = after.get(requirement.id);
    if (requirementSupportIds(requirement).some((id) => candidate.addedIds.includes(id) || candidate.removedIds.includes(id))) requirementIds.add(requirement.id);
    if (!prior.covered && next.covered) {
      (requirement.priority === "must" ? mustCoverageGained : preferredCoverageGained).push(requirement.id);
      gain += requirement.priority === "must" ? SEMANTIC_PLANNER_CONFIG.utility.mustCoverageGain : SEMANTIC_PLANNER_CONFIG.utility.preferredCoverageGain;
    } else if (prior.covered && !next.covered) {
      coverageLost.push(requirement.id);
      loss += requirement.priority === "must" ? SEMANTIC_PLANNER_CONFIG.utility.mustCoverageLoss : SEMANTIC_PLANNER_CONFIG.utility.preferredCoverageLoss;
    } else if (prior.covered && next.covered) {
      const delta = next.strength - prior.strength;
      evidenceStrengthGain += delta;
      gain += delta * SEMANTIC_PLANNER_CONFIG.utility.evidenceStrengthStep;
    }
  }
  const estimatedPageCost = estimatePageCost(candidate, state);
  const changeCost = candidateCost(candidate);
  const marginalUtility = gain - loss - changeCost - estimatedPageCost * SEMANTIC_PLANNER_CONFIG.utility.pageLineCost;
  return {
    marginalUtility,
    utility: marginalUtility,
    mustCoverageGained,
    preferredCoverageGained,
    coverageLost,
    evidenceStrengthGain,
    changeCost,
    estimatedPageCost,
    requirementIds: sorted(requirementIds),
    addedEvidenceIds: sorted(candidate.addedIds),
    removedEvidenceIds: sorted(candidate.removedIds),
  };
}

function initialPlanningState(base, evidenceIndex, requirements) {
  const survivingEvidenceIds = new Set([...evidenceIndex.values()].filter((evidence) => evidence.current).map((evidence) => evidence.id));
  const initialCoverage = coverageFor(requirements, survivingEvidenceIds, evidenceIndex);
  return {
    survivingEvidenceIds,
    evidenceAdded: new Set(),
    evidenceRemoved: new Set(),
    coveredRequirementIds: new Set([...initialCoverage].filter(([, value]) => value.covered).map(([id]) => id)),
    mustHaveCoverage: new Set(requirements.filter((requirement) => requirement.priority === "must" && initialCoverage.get(requirement.id)?.covered).map((requirement) => requirement.id)),
    preferredCoverage: new Set(requirements.filter((requirement) => requirement.priority === "preferred" && initialCoverage.get(requirement.id)?.covered).map((requirement) => requirement.id)),
    occupiedBulletSlots: new Set(),
    usedReplacementEvidence: new Set(),
    selectedProjectReplacement: null,
    selectedSkills: new Set(base.skills.flatMap((group) => group.items.map(skillEvidenceId))),
    occupiedSkillItems: new Set(),
    skillGroups: new Map(base.skills.map((group) => [group.label, [...group.items]])),
    estimatedPageCost: 0,
    bulletChanges: 0,
    skillChanges: 0,
  };
}

function applyCandidateToState(state, candidate, requirements, evidenceIndex, score) {
  for (const id of candidate.removedIds) {
    state.survivingEvidenceIds.delete(id);
    state.evidenceRemoved.add(id);
    state.evidenceAdded.delete(id);
  }
  for (const id of candidate.addedIds) {
    state.survivingEvidenceIds.add(id);
    state.evidenceAdded.add(id);
    state.evidenceRemoved.delete(id);
  }
  if (candidate.type === "bullet") {
    for (const change of candidate.changes) {
      state.occupiedBulletSlots.add(change.baseBulletId);
      state.usedReplacementEvidence.add(change.replacementBulletId);
      state.bulletChanges += 1;
    }
  } else if (candidate.type === "project") state.selectedProjectReplacement = candidate.change.replacementProjectId;
  else if (candidate.type === "skill") {
    const change = candidate.change;
    const items = state.skillGroups.get(change.groupLabel);
    if (change.type === "swap") {
      const index = items.findIndex((item) => lower(item) === lower(change.baseItem));
      if (index >= 0) items[index] = change.replacementItem;
      state.selectedSkills.delete(skillEvidenceId(change.baseItem));
      state.occupiedSkillItems.add(skillEvidenceId(change.baseItem));
    } else items.push(change.replacementItem);
    state.selectedSkills.add(skillEvidenceId(change.replacementItem));
    state.skillChanges += 1;
  }
  state.estimatedPageCost += score.estimatedPageCost;
  const coverage = coverageFor(requirements, state.survivingEvidenceIds, evidenceIndex);
  state.coveredRequirementIds = new Set([...coverage].filter(([, value]) => value.covered).map(([id]) => id));
  state.mustHaveCoverage = new Set(requirements.filter((requirement) => requirement.priority === "must" && coverage.get(requirement.id)?.covered).map((requirement) => requirement.id));
  state.preferredCoverage = new Set(requirements.filter((requirement) => requirement.priority === "preferred" && coverage.get(requirement.id)?.covered).map((requirement) => requirement.id));
}

function bulletPairCandidates(base, catalog) {
  const output = [];
  for (const replacement of catalog.alternatives.experienceBullets || []) {
    const entry = base.experience.find((item) => item.entryId === replacement.entryId);
    if (!entry) continue;
    for (const current of entry.bullets) {
      const change = {
        candidateId: `deterministic:bullet:${current.sourceBulletId}:${replacement.id}`,
        type: "swap",
        entryId: entry.entryId,
        baseBulletId: current.sourceBulletId,
        replacementBulletId: replacement.id,
        requirementIds: [],
        justification: "Deterministic marginal utility from verified requirement evidence.",
      };
      output.push({ id: change.candidateId, type: "bullet", change, changes: [change], pageChanges: [{ addedText: replacement.text, removedText: current.text }], addedIds: [replacement.id], removedIds: [current.sourceBulletId], addedText: replacement.text, removedText: current.text });
    }
  }
  return output;
}

function bulletCombinations(pairs, maxChanges) {
  const byEntry = new Map();
  for (const pair of pairs) {
    if (!byEntry.has(pair.change.entryId)) byEntry.set(pair.change.entryId, []);
    byEntry.get(pair.change.entryId).push(pair);
  }
  const output = [];
  for (const [entryId, entryPairs] of [...byEntry].sort(([left], [right]) => left.localeCompare(right))) {
    const ordered = [...entryPairs].sort((left, right) => left.id.localeCompare(right.id));
    const visit = (start, chosen, baseIds, replacementIds) => {
      if (chosen.length) {
        const changes = chosen.map((item) => item.change);
        output.push({
          id: `deterministic:bullet-combo:${entryId}:${changes.map((change) => `${change.baseBulletId}>${change.replacementBulletId}`).join("|")}`,
          type: "bullet",
          changes,
          pairCandidates: chosen,
          pageChanges: chosen.flatMap((item) => item.pageChanges),
          addedIds: chosen.flatMap((item) => item.addedIds),
          removedIds: chosen.flatMap((item) => item.removedIds),
          addedText: chosen.map((item) => item.addedText).join(" "),
          removedText: chosen.map((item) => item.removedText).join(" "),
        });
      }
      if (chosen.length >= maxChanges) return;
      for (let index = start; index < ordered.length; index += 1) {
        const pair = ordered[index];
        if (baseIds.has(pair.change.baseBulletId) || replacementIds.has(pair.change.replacementBulletId)) continue;
        visit(index + 1, [...chosen, pair], new Set([...baseIds, pair.change.baseBulletId]), new Set([...replacementIds, pair.change.replacementBulletId]));
      }
    };
    visit(0, [], new Set(), new Set());
  }
  return output;
}

function skillCandidates(base, catalog) {
  const inventory = catalog.alternatives.skills.inventory || [];
  const handsOn = catalog.alternatives.skills.handsOnEvidence || {};
  const classification = (id) => Object.hasOwn(handsOn, id) ? "hands-on" : catalog.alternatives.skills.defaultClassification;
  const rendered = new Set(base.skills.flatMap((group) => group.items.map(skillEvidenceId)));
  const output = [];
  for (const skill of inventory.filter((item) => !rendered.has(item.id)).sort((left, right) => left.id.localeCompare(right.id))) {
    const groupLabel = compatibleSkillGroupLabel(base, skill);
    if (!groupLabel) continue;
    const addChange = { candidateId: `deterministic:skill:add:${skill.id}`, type: "add", groupLabel, replacementItem: skill.skill, requirementIds: [], justification: "Deterministic marginal utility from verified requirement evidence." };
    output.push({ id: addChange.candidateId, type: "skill", change: addChange, changes: [addChange], addedIds: [skill.id], removedIds: [], addedText: skill.skill, removedText: "" });
    const group = base.skills.find((item) => item.label === groupLabel);
    for (const baseItem of group.items) {
      const baseId = skillEvidenceId(baseItem);
      if (classification(baseId) !== classification(skill.id)) continue;
      const swapChange = { candidateId: `deterministic:skill:swap:${baseId}:${skill.id}`, type: "swap", groupLabel, baseItem, replacementItem: skill.skill, requirementIds: [], justification: "Deterministic marginal utility from verified requirement evidence." };
      output.push({ id: swapChange.candidateId, type: "skill", change: swapChange, changes: [swapChange], addedIds: [skill.id], removedIds: [baseId], addedText: skill.skill, removedText: baseItem });
    }
  }
  return output;
}

function projectCandidates(base, catalog) {
  const output = [];
  for (const replacement of catalog.alternatives.projects || []) for (const current of base.projects) {
    const addedIds = [replacement.id, ...(replacement.bullets || []).map((bullet) => bullet.id)];
    const removedIds = [projectEvidenceId(current.entryId), ...current.bullets.map((bullet) => bullet.sourceBulletId)];
    const addedText = [replacement.title, replacement.role, ...(replacement.bullets || []).map((bullet) => bullet.text)].join(" ");
    const removedText = [current.title, current.role, ...current.bullets.map((bullet) => bullet.text)].join(" ");
    const change = { candidateId: `deterministic:project:${current.entryId}:${replacement.projectId}`, baseProjectId: current.entryId, replacementProjectId: replacement.projectId, requirementIds: [], justification: "Deterministic marginal utility from verified requirement evidence." };
    output.push({ id: change.candidateId, type: "project", change, changes: [change], addedIds, removedIds, addedText, removedText, currentProject: current, replacementProject: replacement });
  }
  return output;
}

function summaryCandidates(base, catalog) {
  return (catalog.alternatives.summaries || []).map((summary) => {
    const change = { candidateId: `deterministic:summary:${summary.summaryId}`, summaryId: summary.summaryId, requirementIds: [], justification: "Deterministic marginal utility from verified requirement evidence." };
    return { id: change.candidateId, type: "summary", change, changes: [change], addedIds: [summary.id], removedIds: [catalog.base.summary.id], addedText: summary.text, removedText: base.summary };
  });
}

function infeasibleReason(candidate, state, requirements, evidenceIndex, diff) {
  const componentCandidates = candidate.type === "bullet" ? (candidate.pairCandidates || [candidate]) : [candidate];
  if (componentCandidates.some((component) => lostProtectedMetrics(component, evidenceIndex).length)) return "Rejected because protected metric would be lost";
  if (candidate.type === "bullet") {
    if (state.bulletChanges + candidate.changes.length > TAILORING_CAPS.bulletChanges) return "bullet cap";
    if (candidate.changes.some((change) => state.occupiedBulletSlots.has(change.baseBulletId))) return "conflicting bullet slot";
    if (candidate.changes.some((change) => state.usedReplacementEvidence.has(change.replacementBulletId))) return "duplicate replacement evidence";
  }
  if (candidate.type === "skill") {
    if (state.skillChanges >= TAILORING_CAPS.skillChanges) return "skill cap";
    if (state.selectedSkills.has(candidate.addedIds[0])) return "duplicate replacement evidence";
    if (candidate.change.type === "swap" && state.occupiedSkillItems.has(candidate.removedIds[0])) return "conflicting skill slot";
  }
  if (candidate.type === "project" && diff.projectSwap) return "project cap";
  if (candidate.type === "summary" && diff.summaryChange) return "summary cap";
  for (const component of componentCandidates) {
    const after = coverageFor(requirements, stateAfterEvidence(state, component), evidenceIndex);
    for (const requirement of requirements) if (requirement.priority === "must" && state.mustHaveCoverage.has(requirement.id) && !after.get(requirement.id)?.covered) return "must-have coverage regression";
  }
  return null;
}

function diagnostic(candidate, score, iteration, id = candidate.id, type = candidate.type) {
  return {
    candidateId: id,
    type,
    selectedAtIteration: iteration,
    marginalUtility: score.marginalUtility,
    mustCoverageGained: score.mustCoverageGained,
    preferredCoverageGained: score.preferredCoverageGained,
    coverageLost: score.coverageLost,
    evidenceStrengthGain: score.evidenceStrengthGain,
    changeCost: score.changeCost,
    estimatedPageCost: score.estimatedPageCost,
    requirementIds: score.requirementIds,
    addedEvidenceIds: score.addedEvidenceIds,
    removedEvidenceIds: score.removedEvidenceIds,
  };
}

function stateDiagnostic(state) {
  return {
    coveredRequirementIds: sorted(state.coveredRequirementIds),
    survivingEvidenceIds: sorted(state.survivingEvidenceIds),
    evidenceAdded: sorted(state.evidenceAdded),
    evidenceRemoved: sorted(state.evidenceRemoved),
    mustHaveCoverage: sorted(state.mustHaveCoverage),
    preferredCoverage: sorted(state.preferredCoverage),
    occupiedBulletSlots: sorted(state.occupiedBulletSlots),
    usedReplacementEvidence: sorted(state.usedReplacementEvidence),
    selectedProjectReplacement: state.selectedProjectReplacement,
    selectedSkills: sorted(state.selectedSkills),
    estimatedPageCost: state.estimatedPageCost,
  };
}

function makeRewriteOpportunities({ base, catalog, requirements, diff }) {
  const selectedSwapRequirements = new Set(diff.bulletChanges.flatMap((change) => change.requirementIds || []));
  const swappedBullets = new Set(diff.bulletChanges.map((change) => change.baseBulletId));
  const bulletById = new Map(base.experience.flatMap((entry) => entry.bullets.map((bullet) => [bullet.sourceBulletId, { ...bullet, entryId: entry.entryId }])));
  const handsOnEvidence = catalog.alternatives.skills.handsOnEvidence || {};
  const skillNameById = new Map((catalog.alternatives.skills.inventory || []).map((skill) => [skill.id, skill.skill]));
  const opportunities = [];
  for (const requirement of requirements) {
    const highValuePreferred = requirement.priority === "preferred" && requirement.kind === "responsibility" && (requirement.candidateEvidenceIds || []).length > 0;
    if (!(requirement.priority === "must" || highValuePreferred) || requirement.evidenceExpectation !== "accomplishment" || selectedSwapRequirements.has(requirement.id)) continue;
    for (const id of requirement.currentEvidenceIds || []) {
      const bullet = bulletById.get(id);
      if (!bullet || swappedBullets.has(id)) continue;
      const allowedSupportedTerminology = Object.entries(handsOnEvidence)
        .filter(([, ids]) => ids.includes(id))
        .map(([skillId]) => skillNameById.get(skillId))
        .filter((name) => name && !lower(bullet.text).includes(lower(name)))
        .sort((left, right) => left.localeCompare(right));
      if (!allowedSupportedTerminology.length) continue;
      const opportunityGain = requirement.priority === "must" ? SEMANTIC_PLANNER_CONFIG.utility.rewriteOpportunityGain : SEMANTIC_PLANNER_CONFIG.utility.preferredRewriteOpportunityGain;
      const estimatedMarginalUtility = opportunityGain - SEMANTIC_PLANNER_CONFIG.changeCosts.bulletRewrite;
      if (estimatedMarginalUtility <= SEMANTIC_PLANNER_CONFIG.utility.minimumUsefulUtility) continue;
      opportunities.push({ candidateId: `deterministic:rewrite:${id}`, baseBulletId: id, entryId: bullet.entryId, originalBullet: bullet.text, requirementIds: [requirement.id], requirementTexts: [requirement.text], allowedSupportedTerminology, estimatedMarginalUtility, estimatedPageCost: 0, changeCost: SEMANTIC_PLANNER_CONFIG.changeCosts.bulletRewrite });
    }
  }
  return opportunities.sort((left, right) => right.estimatedMarginalUtility - left.estimatedMarginalUtility || left.candidateId.localeCompare(right.candidateId)).slice(0, 1);
}

export function planSemanticResumeChanges({ base, catalog, evidenceIndex, requirements }) {
  const baselineState = initialPlanningState(base, evidenceIndex, requirements);
  const baselineMustCoverage = new Set(baselineState.mustHaveCoverage);
  const state = initialPlanningState(base, evidenceIndex, requirements);
  const pairs = bulletPairCandidates(base, catalog);
  const bulletOptions = bulletCombinations(pairs, TAILORING_CAPS.bulletChanges);
  const atomicCandidates = [...skillCandidates(base, catalog), ...projectCandidates(base, catalog), ...summaryCandidates(base, catalog)];
  const diff = { version: 1, baseResumeId: base.id, summaryChange: null, bulletChanges: [], projectSwap: null, skillChanges: [] };
  const acceptedDiagnostics = [];
  const evaluatedCandidates = [];
  const rejected = [];
  const rejectedKeys = new Set();
  const selectedCandidateIds = new Set();
  const rejectOnce = (candidate, reason, score = null) => {
    const key = `${candidate.id}:${reason}`;
    if (rejectedKeys.has(key)) return;
    rejectedKeys.add(key);
    if (rejected.length < MAX_REJECTED_DIAGNOSTICS) rejected.push({ candidateId: candidate.id, type: candidate.type, reason, change: clone(candidate.change || candidate.changes), utility: score ? clone(score) : null });
  };

  let iteration = 1;
  while (true) {
    const remainingBulletCap = TAILORING_CAPS.bulletChanges - state.bulletChanges;
    const options = [...atomicCandidates.filter((candidate) => !selectedCandidateIds.has(candidate.id)), ...bulletOptions.filter((candidate) => candidate.changes.length <= remainingBulletCap)];
    const scored = [];
    for (const candidate of options) {
      const reason = infeasibleReason(candidate, state, requirements, evidenceIndex, diff);
      if (reason) { rejectOnce(candidate, reason); continue; }
      const score = scoreCandidate(candidate, state, requirements, evidenceIndex);
      scored.push({ candidate, score });
    }
    scored.sort((left, right) => right.score.marginalUtility - left.score.marginalUtility || left.candidate.id.localeCompare(right.candidate.id));
    for (const [order, item] of scored.entries()) {
      if (evaluatedCandidates.length >= MAX_EVALUATED_DIAGNOSTICS) break;
      evaluatedCandidates.push({ iteration, order: order + 1, type: item.candidate.type, candidateId: item.candidate.id, marginalUtility: item.score.marginalUtility, acceptedForPlanning: false, mustCoverageGained: item.score.mustCoverageGained, preferredCoverageGained: item.score.preferredCoverageGained, coverageLost: item.score.coverageLost, evidenceStrengthGain: item.score.evidenceStrengthGain, changeCost: item.score.changeCost, estimatedPageCost: item.score.estimatedPageCost, requirementIds: item.score.requirementIds, addedEvidenceIds: item.score.addedEvidenceIds, removedEvidenceIds: item.score.removedEvidenceIds });
    }
    const winner = scored[0];
    if (!winner || winner.score.marginalUtility <= SEMANTIC_PLANNER_CONFIG.utility.minimumUsefulUtility) {
      for (const item of scored.filter((entry) => entry.score.marginalUtility <= SEMANTIC_PLANNER_CONFIG.utility.minimumUsefulUtility)) rejectOnce(item.candidate, "non-positive marginal utility", item.score);
      break;
    }
    const evaluation = evaluatedCandidates.find((item) => item.iteration === iteration && item.candidateId === winner.candidate.id);
    if (evaluation) evaluation.acceptedForPlanning = true;
    selectedCandidateIds.add(winner.candidate.id);

    if (winner.candidate.type === "bullet") {
      const remaining = winner.candidate.changes.map((change) => pairs.find((pair) => pair.id === change.candidateId));
      while (remaining.length) {
        const marginalPairs = remaining.map((pair) => ({ pair, score: scoreCandidate(pair, state, requirements, evidenceIndex) }))
          .sort((left, right) => right.score.marginalUtility - left.score.marginalUtility || left.pair.id.localeCompare(right.pair.id));
        const selected = marginalPairs[0];
        if (selected.score.marginalUtility <= 0) throw new Error(`Exact bullet assignment selected non-positive constituent '${selected.pair.id}'.`);
        selected.pair.change.requirementIds = selected.score.requirementIds;
        selected.pair.change.justification = `Deterministic marginal utility ${selected.score.marginalUtility.toFixed(1)} from verified requirement evidence.`;
        diff.bulletChanges.push(clone(selected.pair.change));
        applyCandidateToState(state, selected.pair, requirements, evidenceIndex, selected.score);
        acceptedDiagnostics.push(diagnostic(selected.pair, selected.score, iteration, selected.pair.id, "bullet"));
        remaining.splice(remaining.indexOf(selected.pair), 1);
      }
    } else {
      winner.candidate.change.requirementIds = winner.score.requirementIds;
      winner.candidate.change.justification = `Deterministic marginal utility ${winner.score.marginalUtility.toFixed(1)} from verified requirement evidence.`;
      if (winner.candidate.type === "skill") diff.skillChanges.push(clone(winner.candidate.change));
      else if (winner.candidate.type === "project") diff.projectSwap = clone(winner.candidate.change);
      else diff.summaryChange = clone(winner.candidate.change);
      applyCandidateToState(state, winner.candidate, requirements, evidenceIndex, winner.score);
      acceptedDiagnostics.push(diagnostic(winner.candidate, winner.score, iteration));
    }
    iteration += 1;
  }

  for (const requirementId of baselineMustCoverage) if (!state.mustHaveCoverage.has(requirementId)) throw new Error(`Must-have coverage invariant failed for '${requirementId}'.`);

  // Diagnose unselected exact assignments after the winning matching is known.
  for (const option of bulletOptions) {
    const selectedCount = option.changes.filter((change) => diff.bulletChanges.some((selected) => selected.candidateId === change.candidateId)).length;
    if (selectedCount && selectedCount !== option.changes.length) rejectOnce(option, "conflicting bullet slot");
    else if (!selectedCount && !rejectedKeys.has(`${option.id}:Rejected because protected metric would be lost`)) rejectOnce(option, "lower-value assignment combination");
  }

  const finalCoverage = coverageFor(requirements, state.survivingEvidenceIds, evidenceIndex);
  const candidates = acceptedDiagnostics.map((item) => {
    const without = new Set(state.survivingEvidenceIds);
    for (const id of item.addedEvidenceIds) without.delete(id);
    for (const id of item.removedEvidenceIds) without.add(id);
    const withoutCoverage = coverageFor(requirements, without, evidenceIndex);
    const soleMustCoverageIds = requirements.filter((requirement) => requirement.priority === "must" && finalCoverage.get(requirement.id)?.covered && !withoutCoverage.get(requirement.id)?.covered).map((requirement) => requirement.id).sort();
    return { id: item.candidateId, type: item.type, expectedGain: item.marginalUtility, estimatedPageCost: item.estimatedPageCost, mustCoverageGained: item.mustCoverageGained, soleMustCoverageIds, utility: clone(item) };
  });

  return {
    diff,
    candidates,
    rejected,
    rewriteOpportunities: makeRewriteOpportunities({ base, catalog, requirements, diff }),
    evaluatedCandidates,
    acceptedCandidates: acceptedDiagnostics,
    baselineMustCoverage: sorted(baselineMustCoverage),
    finalMustCoverage: sorted(state.mustHaveCoverage),
    planningState: stateDiagnostic(state),
  };
}
