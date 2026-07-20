import { scoreCoverage } from "./coverageScoring.js";
import { validateSelection } from "./validateSelection.js";
import { verifyNoDuplicateAccomplishments } from "./accomplishmentClusters.js";
import { validateMandatoryEntries, validateMandatorySkills } from "./mandatoryContent.js";

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
  const mandatorySkills = validateMandatorySkills(bank, finalSelection.skillGroupIds);
  if (!mandatorySkills.valid) codedFail(`Mandatory skills missing from final resume: ${mandatorySkills.errors.join("; ")}`);
  const duplicates = verifyNoDuplicateAccomplishments(validated.rankedBullets);
  if (!duplicates.valid) codedFail(`Duplicate accomplishments remain: ${duplicates.errors.join("; ")}`);

  const bulletIds = validated.rankedBullets.map((item) => item.bullet.id);
  const bulletTexts = Object.fromEntries(validated.rankedBullets.map((item) => [item.bullet.id, item.text]));
  const coverage = scoreCoverage(bank, extraction, {
    analysis,
    bulletIds,
    bulletTexts,
    skillGroupIds: finalSelection.skillGroupIds,
  });
  return {
    coverage,
    pageCount,
    includedBulletIds: bulletIds,
    excluded: budget.excluded,
    duplicateActionVerbs: false,
    duplicateAccomplishments: false,
    forbiddenClaims: false,
    lockedMetricsPreserved: true,
    mandatorySatisfied: true,
  };
}
