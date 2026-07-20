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

export function openingActionVerb(text) {
  const match = String(text || "").trim().match(/^([A-Za-z]+)/);
  return match ? match[1].toLowerCase() : "";
}

export function budgetSelection(resolvedSelection) {
  const includedEntries = new Map();
  const excluded = [];
  const includedVerbs = new Set();
  let usedLines = 0;

  for (const item of resolvedSelection.rankedBullets) {
    const verb = openingActionVerb(item.text);
    if (verb && includedVerbs.has(verb)) {
      excluded.push({ id: item.bullet.id, entryId: item.entry.id, section: item.section, reason: `duplicate action verb: ${verb}`, requiredLines: 0 });
      continue;
    }
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
    if (verb) includedVerbs.add(verb);
  }

  if (resolvedSelection.rankedBullets.length > 0 && includedEntries.size === 0) {
    const error = new Error("Resume validation failed: duplicate action verb handling produced no valid bullets.");
    error.code = "VALIDATION_FAILED";
    throw error;
  }

  return {
    included: Array.from(includedEntries.values()),
    excluded,
    usedLines,
    availableLines: RESUME_LINE_BUDGET.availableVariableLines,
    remainingLines: RESUME_LINE_BUDGET.availableVariableLines - usedLines,
  };
}
