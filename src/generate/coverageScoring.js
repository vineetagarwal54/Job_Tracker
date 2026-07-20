import { textContainsTerm, canonicalizeTerm } from "./protectedTerms.js";

function bankSources(bank, options) {
  const allowedBullets = options?.bulletIds ? new Set(options.bulletIds) : null;
  const allowedGroups = options?.skillGroupIds ? new Set(options.skillGroupIds) : null;
  const sources = [];
  if (Array.isArray(options?.renderedSkills)) {
    // Coverage reflects only the individual skills that actually render.
    for (const group of options.renderedSkills) {
      sources.push({ id: group.id, text: `${group.label} ${(group.items || []).join(" ")}` });
    }
  } else {
    for (const group of bank.skillGroups || []) {
      if (!allowedGroups || allowedGroups.has(group.id)) {
        sources.push({ id: group.id, text: `${group.label} ${(group.items || []).join(" ")}` });
      }
    }
  }
  for (const section of ["experience", "projects"]) {
    for (const entry of bank[section] || []) {
      for (const bullet of entry.bullets || []) {
        if (!allowedBullets || allowedBullets.has(bullet.id)) {
          sources.push({
            id: bullet.id,
            text: `${options?.bulletTexts?.[bullet.id] || bullet.text} ${(bullet.skills || []).join(" ")}`,
          });
        }
      }
    }
  }
  return sources;
}

// Exact/aliased coverage of JD keywords by the (optionally final) resume
// content. No unrestricted substring matching, so Java never matches
// JavaScript. Must-have requirements are weighted above preferred (task
// Phase 3); responsibilities and qualifications are tracked separately from
// technologies. When bulletIds/skillGroupIds are provided, coverage reflects
// only content that remains in the rendered resume.
export function scoreCoverage(bank, extraction, options = {}) {
  const sources = bankSources(bank, options);
  const keywords = extraction?.keywords || [];
  const matches = keywords.map((keyword) => {
    const ids = sources
      .filter((source) => textContainsTerm(source.text, keyword.normalized))
      .map((source) => source.id);
    return { ...keyword, matchingIds: ids, covered: ids.length > 0 };
  });

  const group = (terms = []) =>
    terms
      .map((term) => canonicalizeTerm(term))
      .filter(Boolean)
      .map(
        (term) =>
          matches.find((item) => item.normalized === term) || {
            normalized: term,
            value: term,
            matchingIds: sources.filter((source) => textContainsTerm(source.text, term)).map((s) => s.id),
            covered: sources.some((source) => textContainsTerm(source.text, term)),
          }
      );

  const percent = (items) =>
    items.length ? Math.round((items.filter((item) => item.covered).length * 10000) / items.length) / 100 : 100;

  const mustHave = group(options.analysis?.mustHaveKeywords);
  const niceToHave = group(options.analysis?.niceToHaveKeywords);
  const byCategory = (category) => matches.filter((item) => item.category === category);
  const responsibilities = byCategory("responsibility");
  const qualifications = byCategory("qualification");

  // Weighted score: must-haves count triple, preferred single. Gives a single
  // number that reflects the requirements that actually gate an application.
  const weighted = (() => {
    const mh = mustHave.length;
    const nh = niceToHave.length;
    if (mh === 0 && nh === 0) return percent(matches);
    const num = mustHave.filter((i) => i.covered).length * 3 + niceToHave.filter((i) => i.covered).length;
    const den = mh * 3 + nh;
    return Math.round((num * 10000) / den) / 100;
  })();

  return {
    coveredKeywords: matches.filter((item) => item.covered),
    uncoveredKeywords: matches.filter((item) => !item.covered),
    matchingBulletIds: [...new Set(matches.flatMap((item) => item.matchingIds))],
    coveragePercentage: percent(matches),
    weightedCoveragePercentage: weighted,
    mustHave: {
      covered: mustHave.filter((item) => item.covered),
      missing: mustHave.filter((item) => !item.covered),
      percentage: percent(mustHave),
    },
    niceToHave: {
      covered: niceToHave.filter((item) => item.covered),
      missing: niceToHave.filter((item) => !item.covered),
      percentage: percent(niceToHave),
    },
    responsibilities: {
      covered: responsibilities.filter((item) => item.covered),
      missing: responsibilities.filter((item) => !item.covered),
      percentage: percent(responsibilities),
    },
    qualifications: {
      covered: qualifications.filter((item) => item.covered),
      missing: qualifications.filter((item) => !item.covered),
      percentage: percent(qualifications),
    },
  };
}
