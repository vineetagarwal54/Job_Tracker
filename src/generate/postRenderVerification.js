import { scoreCoverage } from "./coverageScoring.js";
import { validateSelection } from "./validateSelection.js";

export function verifyFinalResume({ bank, extraction, analysis, finalSelection, budget, pageCount = null }) {
  const validated = validateSelection(bank, finalSelection, { requireUniqueActionVerbs: true });
  const bulletIds = validated.rankedBullets.map((item) => item.bullet.id);
  const bulletTexts = Object.fromEntries(validated.rankedBullets.map((item) => [item.bullet.id, item.text]));
  const coverage = scoreCoverage(bank, extraction, { analysis, bulletIds, bulletTexts, skillGroupIds: finalSelection.skillGroupIds });
  return { coverage, pageCount, includedBulletIds: bulletIds, excluded: budget.excluded, duplicateActionVerbs: false, forbiddenClaims: false, lockedMetricsPreserved: true };
}
