import { scoreCoverage } from "./coverageScoring.js";
import { validateSelection } from "./validateSelection.js";
import { verifyNoDuplicateAccomplishments } from "./accomplishmentClusters.js";
import { validateMandatoryEntries, validateMandatorySkills } from "./mandatoryContent.js";
import { missingJobSkills } from "./skillSelection.js";

function codedFail(message) {
  throw Object.assign(new Error(message), { code: "VALIDATION_FAILED" });
}

// Deterministic post-render check on the FINAL shipped document (task Phases 4,
// 8, 9). Confirms mandatory content survived fitting, no duplicate
// accomplishment remains, and reports keyword coverage of only the content that
// actually shipped.
export function verifyFinalResume({ bank, extraction, analysis, finalSelection, budget, pageCount = null }) {
  const validated = validateSelection(bank, finalSelection, { requireUniqueActionVerbs: true });

  const mandatoryEntries = validateMandatoryEntries(finalSelection);
  if (!mandatoryEntries.valid) codedFail(`Mandatory content missing from final resume: ${mandatoryEntries.errors.join("; ")}`);
  // Mandatory skill CATEGORIES are validated against the rendered skills so the
  // check reflects the actually-shipped document. Mandatory ITEMS
  // (AWS/Docker/Kubernetes) are checked against the rendered items too.
  const renderedSkills = Array.isArray(finalSelection.renderedSkills) ? finalSelection.renderedSkills : null;
  const skillGroupIds = renderedSkills ? renderedSkills.map((group) => group.id) : finalSelection.skillGroupIds;
  const skillBankView = renderedSkills
    ? { ...bank, skillGroups: renderedSkills.map((group) => ({ ...group })) }
    : bank;
  const mandatorySkills = validateMandatorySkills(skillBankView, skillGroupIds);
  if (!mandatorySkills.valid) codedFail(`Mandatory skills missing from final resume: ${mandatorySkills.errors.join("; ")}`);
  const duplicates = verifyNoDuplicateAccomplishments(validated.rankedBullets);
  if (!duplicates.valid) codedFail(`Duplicate accomplishments remain: ${duplicates.errors.join("; ")}`);

  const bulletIds = validated.rankedBullets.map((item) => item.bullet.id);
  const bulletTexts = Object.fromEntries(validated.rankedBullets.map((item) => [item.bullet.id, item.text]));
  const coverage = scoreCoverage(bank, extraction, {
    analysis,
    bulletIds,
    bulletTexts,
    skillGroupIds,
    renderedSkills: renderedSkills || undefined,
  });
  const missingSkills = missingJobSkills({ extraction, analysis, renderedSkills: renderedSkills || [], bulletTexts });
  return {
    coverage,
    pageCount,
    includedBulletIds: bulletIds,
    renderedSkills,
    missingSkills,
    excluded: budget.excluded,
    duplicateActionVerbs: false,
    duplicateAccomplishments: false,
    forbiddenClaims: false,
    lockedMetricsPreserved: true,
    mandatorySatisfied: true,
  };
}
