const normalize = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9+#./-]+/g, " ").replace(/\s+/g, " ").trim();

function bankSources(bank, options) {
  const allowedBullets = options?.bulletIds ? new Set(options.bulletIds) : null;
  const allowedGroups = options?.skillGroupIds ? new Set(options.skillGroupIds) : null;
  const sources = [];
  for (const group of bank.skillGroups || []) if (!allowedGroups || allowedGroups.has(group.id)) sources.push({ id: group.id, text: `${group.label} ${(group.items || []).join(" ")}` });
  for (const section of ["experience", "projects"]) for (const entry of bank[section] || []) for (const bullet of entry.bullets || []) {
    if (!allowedBullets || allowedBullets.has(bullet.id)) sources.push({ id: bullet.id, text: `${options?.bulletTexts?.[bullet.id] || bullet.text} ${(bullet.skills || []).join(" ")}` });
  }
  return sources.map((source) => ({ ...source, normalized: normalize(source.text) }));
}

export function scoreCoverage(bank, extraction, options = {}) {
  const sources = bankSources(bank, options);
  const keywords = extraction?.keywords || [];
  const matches = keywords.map((keyword) => {
    const ids = sources.filter((source) => source.normalized.includes(normalize(keyword.normalized))).map((source) => source.id);
    return { ...keyword, matchingIds: ids, covered: ids.length > 0 };
  });
  const group = (terms = []) => terms.map(normalize).filter(Boolean).map((term) => matches.find((item) => item.normalized === term) || { normalized: term, value: term, matchingIds: [], covered: false });
  const mustHave = group(options.analysis?.mustHaveKeywords);
  const niceToHave = group(options.analysis?.niceToHaveKeywords);
  const percent = (items) => items.length ? Math.round(items.filter((item) => item.covered).length * 10000 / items.length) / 100 : 100;
  return {
    coveredKeywords: matches.filter((item) => item.covered), uncoveredKeywords: matches.filter((item) => !item.covered),
    matchingBulletIds: [...new Set(matches.flatMap((item) => item.matchingIds))], coveragePercentage: percent(matches),
    mustHave: { covered: mustHave.filter((item) => item.covered), missing: mustHave.filter((item) => !item.covered), percentage: percent(mustHave) },
    niceToHave: { covered: niceToHave.filter((item) => item.covered), missing: niceToHave.filter((item) => !item.covered), percentage: percent(niceToHave) },
  };
}
