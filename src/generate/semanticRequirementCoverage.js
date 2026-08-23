import { projectEvidenceId, skillEvidenceId, summaryEvidenceId, experienceEvidenceId } from "./evidenceCatalog.js";

export function finalRenderedEvidenceIds(base, acceptedDiff = null) {
  const ids = new Set([summaryEvidenceId(`base:${base.id}`)]);
  if (acceptedDiff?.summaryChange?.summaryId) {
    ids.delete(summaryEvidenceId(`base:${base.id}`));
    ids.add(summaryEvidenceId(acceptedDiff.summaryChange.summaryId));
  }
  for (const entry of base.experience || []) {
    ids.add(experienceEvidenceId(entry.entryId));
    for (const bullet of entry.bullets || []) ids.add(bullet.sourceBulletId);
  }
  for (const project of base.projects || []) {
    ids.add(projectEvidenceId(project.entryId));
    for (const bullet of project.bullets || []) ids.add(bullet.sourceBulletId);
  }
  for (const group of base.skills || []) for (const skill of group.items || []) ids.add(skillEvidenceId(skill));
  return ids;
}

function item(requirement, covered, survivingEvidenceIds) {
  return {
    id: requirement.id,
    value: requirement.text,
    text: requirement.text,
    priority: requirement.priority,
    kind: requirement.kind,
    optimizerStatus: requirement.status,
    covered,
    survivingEvidenceIds,
    reason: requirement.reason,
  };
}

export function computeSemanticRequirementCoverage(requirements, base, acceptedDiff = null) {
  const rendered = finalRenderedEvidenceIds(base, acceptedDiff);
  const records = (requirements || []).map((requirement) => {
    const supplied = [...(requirement.currentEvidenceIds || []), ...(requirement.candidateEvidenceIds || [])];
    const surviving = supplied.filter((id) => rendered.has(id));
    const renderedKnowledge = (requirement.knowledgeSkills || []).filter((skill) => rendered.has(skillEvidenceId(skill)));
    const knowledgeMayCover = requirement.status === "knowledge-only" && requirement.kind === "technical-skill";
    const covered = requirement.status === "knowledge-only"
      ? knowledgeMayCover && renderedKnowledge.length > 0
      : requirement.status !== "unsupported" && surviving.length > 0;
    return item(requirement, covered, [...new Set([...surviving, ...renderedKnowledge.map(skillEvidenceId)])]);
  });
  const split = (priority, covered) => records.filter((record) => record.priority === priority && record.covered === covered);
  const mustCovered = split("must", true); const mustMissing = split("must", false);
  const preferredCovered = split("preferred", true); const preferredMissing = split("preferred", false);
  const percentage = (covered, missing) => covered.length + missing.length ? Math.round(covered.length * 100 / (covered.length + missing.length)) : null;
  const coveredCount = records.filter((record) => record.covered).length;
  const weightedTotal = records.reduce((sum, record) => sum + (record.priority === "must" ? 2 : 1), 0);
  const weightedCovered = records.filter((record) => record.covered).reduce((sum, record) => sum + (record.priority === "must" ? 2 : 1), 0);
  return {
    version: 2,
    mustHave: { covered: mustCovered, missing: mustMissing, percentage: percentage(mustCovered, mustMissing) },
    niceToHave: { covered: preferredCovered, missing: preferredMissing, percentage: percentage(preferredCovered, preferredMissing) },
    unsupported: records.filter((record) => record.optimizerStatus === "unsupported"),
    requirements: records,
    coveragePercentage: records.length ? Math.round(coveredCount * 100 / records.length) : null,
    weightedCoveragePercentage: weightedTotal ? Math.round(weightedCovered * 100 / weightedTotal) : null,
    coveredKeywords: records.filter((record) => record.covered),
    uncoveredKeywords: records.filter((record) => !record.covered),
  };
}

export function summarizeSemanticCoverageChange(before, after) {
  const beforeCovered = new Set((before?.requirements || []).filter((item) => item.covered).map((item) => item.id));
  const afterCovered = new Set((after?.requirements || []).filter((item) => item.covered).map((item) => item.id));
  return {
    weightedPercentageDelta: (after?.weightedCoveragePercentage || 0) - (before?.weightedCoveragePercentage || 0),
    percentageDelta: (after?.coveragePercentage || 0) - (before?.coveragePercentage || 0),
    newlyCoveredTerms: (after?.requirements || []).filter((item) => afterCovered.has(item.id) && !beforeCovered.has(item.id)).map((item) => item.text),
    noLongerCoveredTerms: (before?.requirements || []).filter((item) => beforeCovered.has(item.id) && !afterCovered.has(item.id)).map((item) => item.text),
  };
}
