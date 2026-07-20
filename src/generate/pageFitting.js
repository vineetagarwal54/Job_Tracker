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
// within that, the lowest FINAL JD rank loses first (falling back to static
// content-bank priority when no ranking is supplied).
export function trimOneBullet(bank, selection, rankScores = null) {
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
          rank: rankScores && rankScores.has(bullet.id) ? rankScores.get(bullet.id) : null,
        });
      }
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    // Optional bullets first (mandatory === false sorts before true).
    if (a.mandatory !== b.mandatory) return a.mandatory ? 1 : -1;
    // Then lowest final JD rank first; fall back to weakest static priority.
    if (a.rank !== null && b.rank !== null && a.rank !== b.rank) return a.rank - b.rank;
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

// The inverse of trimming: when the deterministic line budget shows genuinely
// useful room, add the highest-ranked unused verified bullet. The compiler is
// still the authority; callers keep the change only after a one-page compile.
export function addOneRelevantBullet(bank, selection, rankScores = null) {
  const selected = new Set();
  for (const section of ["experience", "projects"]) for (const entry of selection[section] || []) for (const bullet of entry.bullets || []) selected.add(bullet.id);
  const candidates = [];
  for (const section of ["experience", "projects"]) for (const entry of bank[section] || []) {
    const existing = (selection[section] || []).find((item) => item.entryId === entry.id);
    const count = existing?.bullets?.length || 0;
    // Never turn an absent entry into filler; prefer strengthening selected
    // ServBeyond/Xelpmoc experience and already-selected mandatory projects.
    if (!existing || count >= 3) continue;
    for (const bullet of entry.bullets || []) if (!selected.has(bullet.id)) candidates.push({ section, entry, bullet, score: rankScores?.get(bullet.id) || 0, preferred: /servbeyond|xelpmoc/i.test(entry.id) ? 2 : 1 });
  }
  candidates.sort((a, b) => (b.preferred - a.preferred) || (b.score - a.score) || ((a.bullet.priority || 999) - (b.bullet.priority || 999)));
  const chosen = candidates[0];
  if (!chosen) return null;
  const next = { ...selection, [chosen.section]: selection[chosen.section].map((entry) => entry.entryId === chosen.entry.id ? { ...entry, bullets: [...entry.bullets, { id: chosen.bullet.id }] } : entry) };
  return { selection: next, added: { entryId: chosen.entry.id, bulletId: chosen.bullet.id, section: chosen.section } };
}
