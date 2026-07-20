// Shared selection finalization used by BOTH the model path and the
// deterministic fallback path (task Part 1). Given a raw selection (from the
// model or built from the bank), it applies the mandatory floor, drops
// exploratory projects, reverts invalid rewrites, resolves individual
// JD-specific skills, fits the one-page budget, and returns a validated
// selection plus its final (budgeted) form. Deterministic; no API calls.

import { validateSelection, sanitizeSelectionRewrites } from "./validateSelection.js";
import { budgetSelection } from "./lineBudget.js";
import {
  ensureMandatoryContent,
  validateMandatorySkills,
} from "./mandatoryContent.js";
import { filterExploratoryProjects } from "./projectMaturity.js";
import { resolveRenderedSkills } from "./skillSelection.js";
import { buildRankingContext } from "./bulletRanking.js";

function coded(message) {
  return Object.assign(new Error(message), { code: "VALIDATION_FAILED" });
}

export function finalizeSelection(bank, rawSelection, { variant, extraction = null, analysis = null, emphasis = null, emphases = null } = {}) {
  // Guarantee the mandatory floor (employers, Locra, skill categories/items),
  // then drop exploratory optional projects now that Locra is present.
  let selection = ensureMandatoryContent(bank, rawSelection, variant);
  if (emphasis) selection = { ...selection, emphasis, emphases: emphases || selection.emphases };
  selection = filterExploratoryProjects(selection);
  // Revert any rewrite that violates a rule, or any cosmetic rewrite whose
  // justification does not reference a real JD term, to the verified original
  // text instead of aborting generation.
  const rankingContext = buildRankingContext({ extraction, analysis, emphases: emphases || selection.emphases });
  selection = sanitizeSelectionRewrites(bank, selection, { jdTerms: rankingContext.jdTerms }).selection;

  // Individual, JD-specific skill selection. The resolved categories replace
  // skillGroupIds so the line budget and every downstream check see exactly
  // what renders, and renderedSkills carries the per-item choices through.
  const skillResolution = resolveRenderedSkills(bank, {
    skillGroupIds: selection.skillGroupIds,
    selectedSkills: selection.skills || [],
    variant,
    extraction,
    analysis,
  });
  selection = {
    ...selection,
    skillGroupIds: skillResolution.groups.map((group) => group.id),
    renderedSkills: skillResolution.groups,
  };

  const mandatorySkills = validateMandatorySkills(bank, selection.skillGroupIds);
  if (!mandatorySkills.valid) throw coded(`Mandatory skills missing: ${mandatorySkills.errors.join("; ")}`);

  let validated;
  try { validated = validateSelection(bank, selection, { requireUniqueActionVerbs: false }); }
  catch (error) { error.code = error.code || "VALIDATION_FAILED"; throw error; }

  let budget;
  try { budget = budgetSelection(validated, rankingContext); }
  catch (error) { error.code = error.code || "VALIDATION_FAILED"; throw error; }

  const includedIds = new Set(budget.included.flatMap((entry) => entry.bullets.map((item) => item.bullet.id)));
  const finalSelection = {
    ...selection,
    experience: selection.experience.map((entry) => ({ ...entry, bullets: entry.bullets.filter((item) => includedIds.has(item.id)) })).filter((entry) => entry.bullets.length),
    projects: selection.projects.map((entry) => ({ ...entry, bullets: entry.bullets.filter((item) => includedIds.has(item.id)) })).filter((entry) => entry.bullets.length),
  };
  try { validateSelection(bank, finalSelection, { requireUniqueActionVerbs: true }); }
  catch (error) { error.code = error.code || "VALIDATION_FAILED"; throw error; }

  return { selection, finalSelection, budget, droppedSkillGroups: skillResolution.droppedGroups };
}
