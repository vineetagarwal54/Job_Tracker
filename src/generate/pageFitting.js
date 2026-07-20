// Deterministic one-page trimming for the compile-verify loop (task Phase 8).
//
// The line budget is a pre-compile estimate; the compiled PDF is the ground
// truth. If it renders as more than one page, remove the single lowest-value
// nonmandatory bullet and recompile. Mandatory entries never lose their last
// bullet. Returns the trimmed selection plus the removed bullet, or null when
// nothing can be trimmed without touching mandatory content.

import { isMandatoryEntry } from "./mandatoryContent.js";

function bankBulletPriority(bank, entryId, bulletId) {
  for (const section of ["experience", "projects"]) {
    const entry = bank[section].find((e) => e.id === entryId);
    if (!entry) continue;
    const bullet = entry.bullets.find((b) => b.id === bulletId);
    if (bullet) return bullet.priority ?? 999;
  }
  return 999;
}

// Picks the lowest-value removable bullet across a selection and removes it.
// Removable = a bullet that is not the last remaining bullet of a mandatory
// entry. Optional-entry bullets are preferred over extra mandatory bullets;
// within that, the weakest (highest priority number) loses first.
export function trimOneBullet(bank, selection) {
  const candidates = [];
  for (const section of ["experience", "projects"]) {
    for (const entry of selection[section] || []) {
      const mandatory = isMandatoryEntry(entry.entryId);
      const bullets = entry.bullets || [];
      for (const bullet of bullets) {
        // Never remove the sole bullet of a mandatory entry.
        if (mandatory && bullets.length <= 1) continue;
        candidates.push({
          section,
          entryId: entry.entryId,
          bulletId: bullet.id,
          mandatory,
          priority: bankBulletPriority(bank, entry.entryId, bullet.id),
        });
      }
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    // Optional bullets first (mandatory === false sorts before true).
    if (a.mandatory !== b.mandatory) return a.mandatory ? 1 : -1;
    // Then weakest priority (larger number) first.
    return b.priority - a.priority;
  });
  const victim = candidates[0];
  const next = {
    ...selection,
    [victim.section]: selection[victim.section]
      .map((entry) =>
        entry.entryId === victim.entryId
          ? { ...entry, bullets: entry.bullets.filter((b) => b.id !== victim.bulletId) }
          : entry
      )
      .filter((entry) => (entry.bullets || []).length > 0),
  };
  return { selection: next, removed: victim };
}
