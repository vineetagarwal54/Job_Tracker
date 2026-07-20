import { dedupeAccomplishments } from "./accomplishmentClusters.js";
import { isMandatoryEntry, reservationRank, MANDATORY_SKILL_GROUP_IDS } from "./mandatoryContent.js";

export const RESUME_LINE_BUDGET = Object.freeze({
  charactersPerBulletLine: 119,
  linePitchPt: 11.96,
  fixedOverheadLines: 27,
  referenceFreeLines: 5.15,
  referenceVariableLines: 27.85,
  availableVariableLines: 33,
  experienceHeadingLines: 2,
  projectHeadingLines: 1,
  // Number of skill rows folded into fixedOverheadLines. Each side of the
  // two-column skills block holds ceil(groups/2) rows; the measured overhead
  // assumed the mandatory floor. Extra groups beyond this cost real lines and
  // must not be treated as free (task Phase 7).
  referenceSkillRows: Math.ceil(MANDATORY_SKILL_GROUP_IDS.length / 2),
});

export function estimateBulletLines(chars) {
  return Math.ceil(chars / RESUME_LINE_BUDGET.charactersPerBulletLine);
}

export function openingActionVerb(text) {
  const match = String(text || "").trim().match(/^([A-Za-z]+)/);
  return match ? match[1].toLowerCase() : "";
}

function headingLinesFor(section) {
  return section === "experience"
    ? RESUME_LINE_BUDGET.experienceHeadingLines
    : RESUME_LINE_BUDGET.projectHeadingLines;
}

// Extra skill rows beyond the measured floor cost real vertical space.
function skillRowPenalty(skillGroupIds) {
  const count = Array.isArray(skillGroupIds) ? skillGroupIds.length : 0;
  const rows = Math.ceil(count / 2);
  return Math.max(0, rows - RESUME_LINE_BUDGET.referenceSkillRows);
}

// Deterministically fits a ranked, validated selection to the one-page budget
// while guaranteeing every mandatory employer and the mandatory project keep at
// least one bullet. Order of operations:
//   1. Remove duplicate accomplishments (clusters + similarity fallback).
//   2. Reserve one bullet for each mandatory entry (forced past budget/verb
//      checks so mandatory content can never be dropped by trimming).
//   3. Fill remaining space in ranked order, skipping duplicate action verbs
//      and stopping at the budget. Only nonmandatory-additional and optional
//      bullets are ever excluded for space.
export function budgetSelection(resolvedSelection) {
  const { kept, removed } = dedupeAccomplishments(resolvedSelection.rankedBullets);
  const excluded = removed.map((entry) => ({ ...entry, requiredLines: 0 }));

  const available =
    RESUME_LINE_BUDGET.availableVariableLines - skillRowPenalty(resolvedSelection.skillGroupIds);

  const includedEntries = new Map(); // key -> { section, entry, bullets: [] }
  const usedVerbs = new Set();
  const consumed = new Set(); // bullet ids already placed
  let usedLines = 0;

  const place = (item, force) => {
    const key = `${item.section}:${item.entry.id}`;
    const verb = openingActionVerb(item.text);
    const firstForEntry = !includedEntries.has(key);
    if (!force && verb && usedVerbs.has(verb)) {
      return { ok: false, reason: `duplicate action verb: ${verb}`, requiredLines: 0 };
    }
    const headingLines = firstForEntry ? headingLinesFor(item.section) : 0;
    const bulletLines = estimateBulletLines(item.text.length);
    const requiredLines = headingLines + bulletLines;
    if (!force && usedLines + requiredLines > available) {
      return { ok: false, reason: "line budget exhausted", requiredLines };
    }
    if (firstForEntry) {
      includedEntries.set(key, { section: item.section, entry: item.entry, bullets: [] });
      usedLines += headingLines;
    }
    includedEntries.get(key).bullets.push({ ...item, estimatedLines: bulletLines });
    usedLines += bulletLines;
    consumed.add(item.bullet.id);
    if (verb) usedVerbs.add(verb);
    return { ok: true };
  };

  // Phase A: reserve one bullet per mandatory entry, in page-reservation order.
  const mandatoryEntryKeys = [];
  for (const item of kept) {
    if (!isMandatoryEntry(item.entry.id)) continue;
    const key = `${item.section}:${item.entry.id}`;
    if (!mandatoryEntryKeys.includes(key)) mandatoryEntryKeys.push(key);
  }
  mandatoryEntryKeys.sort((a, b) => {
    const [sa, ea] = a.split(/:(.+)/);
    const [sb, eb] = b.split(/:(.+)/);
    return reservationRank(sa, ea) - reservationRank(sb, eb);
  });
  for (const key of mandatoryEntryKeys) {
    const candidates = kept.filter(
      (item) => `${item.section}:${item.entry.id}` === key && !consumed.has(item.bullet.id)
    );
    // Prefer the highest-ranked candidate whose action verb is still free so
    // the guaranteed bullet does not force a verb collision when avoidable.
    const preferred = candidates.find((item) => {
      const verb = openingActionVerb(item.text);
      return !verb || !usedVerbs.has(verb);
    });
    const chosen = preferred || candidates[0];
    if (chosen) place(chosen, true);
  }

  // Phase B: fill the remaining budget in ranked order.
  for (const item of kept) {
    if (consumed.has(item.bullet.id)) continue;
    const result = place(item, false);
    if (!result.ok) {
      excluded.push({
        id: item.bullet.id,
        entryId: item.entry.id,
        section: item.section,
        reason: result.reason,
        requiredLines: result.requiredLines,
      });
    }
  }

  if (resolvedSelection.rankedBullets.length > 0 && includedEntries.size === 0) {
    const error = new Error("Resume validation failed: no valid bullets survived fitting.");
    error.code = "VALIDATION_FAILED";
    throw error;
  }

  return {
    included: Array.from(includedEntries.values()),
    excluded,
    usedLines,
    availableLines: available,
    remainingLines: available - usedLines,
  };
}
