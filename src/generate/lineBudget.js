export const RESUME_LINE_BUDGET = Object.freeze({
  charactersPerBulletLine: 119,
  linePitchPt: 11.96,
  fixedOverheadLines: 27,
  referenceFreeLines: 5.15,
  referenceVariableLines: 27.85,
  availableVariableLines: 33,
  experienceHeadingLines: 2,
  projectHeadingLines: 1,
});

export function estimateBulletLines(chars) {
  return Math.ceil(chars / RESUME_LINE_BUDGET.charactersPerBulletLine);
}

export function budgetSelection(resolvedSelection) {
  const includedEntries = new Map();
  const excluded = [];
  let usedLines = 0;

  for (const item of resolvedSelection.rankedBullets) {
    const key = `${item.section}:${item.entry.id}`;
    const firstForEntry = !includedEntries.has(key);
    const headingLines = firstForEntry
      ? item.section === "experience"
        ? RESUME_LINE_BUDGET.experienceHeadingLines
        : RESUME_LINE_BUDGET.projectHeadingLines
      : 0;
    const bulletLines = estimateBulletLines(item.text.length);
    const requiredLines = headingLines + bulletLines;
    if (usedLines + requiredLines > RESUME_LINE_BUDGET.availableVariableLines) {
      excluded.push({ id: item.bullet.id, entryId: item.entry.id, section: item.section, reason: "line budget exhausted", requiredLines });
      continue;
    }
    if (firstForEntry) {
      includedEntries.set(key, { section: item.section, entry: item.entry, bullets: [] });
      usedLines += headingLines;
    }
    includedEntries.get(key).bullets.push({ ...item, estimatedLines: bulletLines });
    usedLines += bulletLines;
  }

  return {
    included: Array.from(includedEntries.values()),
    excluded,
    usedLines,
    availableLines: RESUME_LINE_BUDGET.availableVariableLines,
    remainingLines: RESUME_LINE_BUDGET.availableVariableLines - usedLines,
  };
}
