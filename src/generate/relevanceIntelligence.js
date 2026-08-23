import { scoreCoverage } from "./coverageScoring.js";
import { canonicalizeTerm, textContainsTerm } from "./protectedTerms.js";
import { skillClassification, skillClassificationForTerm } from "./skillInventory.js";

export const MIN_RELEVANCE_BENEFIT = 6;

const COMPATIBLE_SKILL_GROUPS = Object.freeze({
  languages: ["languages"], backend: ["backend", "distributed-messaging"], frontend: ["frontend"], mobile: ["mobile", "frontend"], databases: ["databases"],
  "cloud and devops": ["aws-cloud", "azure-cloud", "cloud-devops", "observability"], "cloud & devops": ["aws-cloud", "azure-cloud", "cloud-devops", "observability"], "backend & cloud": ["backend", "distributed-messaging", "aws-cloud", "azure-cloud", "cloud-devops", "observability"],
  "real-time & data": ["backend", "distributed-messaging", "databases"], "applied ai": ["applied-ai", "llm-inference"], "ai / llm": ["applied-ai", "llm-inference"],
  "on-device ai": ["applied-ai", "llm-inference", "mobile"], "genai automation": ["applied-ai", "enterprise-automation", "salesforce", "azure-cloud"], "llm inference & optimization": ["llm-inference"],
  "core engineering": ["system-design", "security", "testing", "cs-foundations", "architecture-practices", "distributed-messaging", "observability"], "core concepts": ["system-design", "security", "testing", "cs-foundations", "architecture-practices", "distributed-messaging", "observability"], "architecture and practices": ["system-design", "security", "testing", "cs-foundations", "architecture-practices", "distributed-messaging", "observability"],
});

const NUMBER_PATTERN = /\b\d+(?:\.\d+)?(?:%|[A-Za-z]+)?\b/g;
const LOW_SIGNAL_TERMS = new Set(["ability", "build", "develop", "experience", "have", "implement", "knowledge", "maintain", "must", "preferred", "required", "responsibilities", "responsibility", "skills", "support", "using", "work"]);
const clone = (value) => JSON.parse(JSON.stringify(value));
const unique = (values) => [...new Set(values.filter(Boolean))];

function escapeRegex(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function frequency(text, term) {
  const normalizedText = String(text || "").toLowerCase();
  const normalized = String(term || "").toLowerCase().trim();
  if (!normalized) return 0;
  const matches = normalizedText.match(new RegExp(`(^|[^a-z0-9+#.])${escapeRegex(normalized)}(?=$|[^a-z0-9+#.])`, "g"));
  return matches?.length || 0;
}

function baseEvidence(base) {
  const bulletIds = [];
  const bulletTexts = {};
  for (const section of ["experience", "projects"]) for (const entry of base[section] || []) for (const bullet of entry.bullets || []) {
    bulletIds.push(bullet.sourceBulletId); bulletTexts[bullet.sourceBulletId] = bullet.text;
  }
  return {
    bulletIds, bulletTexts, includeBulletSkills: false,
    renderedSkills: (base.skills || []).map((group, index) => ({ id: `base-skill-${index}`, label: group.label, items: group.items })),
    extraSources: [{ id: "base-summary", text: base.summary || "" }],
  };
}

export function scoreBaseResume(bank, base, extraction, analysis) {
  return scoreCoverage(bank, extraction, { analysis, ...baseEvidence(base) });
}

function termRecords({ job, extraction, analysis, coverage, base }) {
  const must = new Set((analysis?.mustHaveKeywords || []).map(canonicalizeTerm));
  const nice = new Set((analysis?.niceToHaveKeywords || []).map(canonicalizeTerm));
  const responsibilities = new Set((analysis?.responsibilities || []).map(canonicalizeTerm));
  const values = [
    ...(extraction?.keywords || []).map((item) => ({ term: item.normalized, category: item.category })),
    ...[...must].map((term) => ({ term, category: "must-have" })),
    ...[...nice].map((term) => ({ term, category: "nice-to-have" })),
    ...[...responsibilities].map((term) => ({ term, category: "responsibility" })),
  ];
  const byTerm = new Map();
  const coverageItems = [...coverage.coveredKeywords, ...coverage.uncoveredKeywords, ...coverage.mustHave.covered, ...coverage.mustHave.missing];
  const bulletIds = new Set(base.experience.flatMap((entry) => entry.bullets.map((bullet) => bullet.sourceBulletId)).concat(base.projects.flatMap((entry) => entry.bullets.map((bullet) => bullet.sourceBulletId))));
  for (const value of values) {
    const term = canonicalizeTerm(value.term);
    if (!term) continue;
    const existing = byTerm.get(term) || { term, categories: new Set() };
    existing.categories.add(value.category); byTerm.set(term, existing);
  }
  return [...byTerm.values()].filter((record) => !LOW_SIGNAL_TERMS.has(record.term)).map((record) => {
    const count = frequency(job?.description, record.term);
    const match = coverageItems.find((item) => item.normalized === record.term);
    const matchingIds = unique(match?.matchingIds || []);
    const hasBulletEvidence = matchingIds.some((id) => bulletIds.has(id));
    const isMustHave = must.has(record.term);
    const isResponsibility = responsibilities.has(record.term) || record.categories.has("responsibility");
    const technical = [...record.categories].some((category) => ["language", "framework", "platform", "tool", "database", "technical"].includes(category));
    const weight = (isMustHave ? 14 : isResponsibility ? 9 : technical ? 6 : nice.has(record.term) ? 4 : 3) + Math.min(9, Math.max(0, count - 1) * 3);
    const covered = Boolean(match?.covered);
    const weak = covered && !hasBulletEvidence && (isMustHave || count >= 2);
    return { term: record.term, frequency: count, categories: [...record.categories].sort(), isMustHave, isResponsibility, weight, covered, weak, matchingIds, hasBulletEvidence, status: covered ? (weak ? "weak" : "covered") : "missing" };
  }).sort((a, b) => b.weight - a.weight || b.frequency - a.frequency || a.term.localeCompare(b.term));
}

function matches(text, records) { return records.filter((record) => textContainsTerm(text, record.term)); }
function metricCount(text) { return (String(text || "").match(NUMBER_PATTERN) || []).length; }
function summaryCatalog(bank) {
  return [
    ...Object.entries(bank.summary?.byVariant || {}).map(([key, text]) => ({ summaryId: `variant:${key}`, text })),
    ...Object.entries(bank.summary?.byEmphasis || {}).map(([key, text]) => ({ summaryId: `emphasis:${key}`, text })),
  ];
}
function allBankText(bank) {
  return [
    ...summaryCatalog(bank).map((item) => item.text),
    ...(bank.skillGroups || []).flatMap((group) => [group.label, ...group.items]),
    ...[...(bank.experience || []), ...(bank.projects || [])].flatMap((entry) => [entry.org, entry.role, ...(entry.bullets || []).flatMap((bullet) => [bullet.text, ...(bullet.skills || [])])]),
  ].join(" ");
}
function candidateGain(targetText, sourceText, records, baseCoverage) {
  const target = matches(targetText, records);
  const source = matches(sourceText, records);
  let gain = 0;
  const useful = [];
  for (const record of target) {
    if (record.status === "missing") { gain += record.weight; useful.push(record); }
    else if (record.weak && !source.some((item) => item.term === record.term)) { gain += Math.max(2, Math.round(record.weight * 0.35)); useful.push(record); }
  }
  for (const record of source) {
    if (!target.some((item) => item.term === record.term)) {
      const match = [...baseCoverage.coveredKeywords, ...baseCoverage.mustHave.covered].find((item) => item.normalized === record.term);
      if ((match?.matchingIds || []).length <= 1) gain -= record.weight;
    }
  }
  return { gain, useful };
}

export function relevanceUtility(base, relevancePlan) {
  const bulletEvidence = [...base.experience, ...base.projects].flatMap((entry) => entry.bullets.map((bullet) => bullet.text)).join(" ");
  const evidence = [base.summary, ...base.skills.flatMap((group) => [group.label, ...group.items]), bulletEvidence].join(" ");
  return relevancePlan.terms.reduce((total, record) => {
    if (!textContainsTerm(evidence, record.term)) return total;
    const evidenceBonus = record.weak && textContainsTerm(bulletEvidence, record.term) ? Math.max(2, Math.round(record.weight * 0.35)) : 0;
    return total + record.weight + evidenceBonus;
  }, 0);
}

export function buildRelevancePlan({ bank, base, job, extraction, analysis }) {
  const baseCoverage = scoreBaseResume(bank, base, extraction, analysis);
  const terms = termRecords({ job, extraction, analysis, coverage: baseCoverage, base });
  const gaps = terms.filter((term) => term.status !== "covered");
  const candidates = [];
  const bankExperience = new Map(bank.experience.map((entry) => [entry.id, entry]));
  const baseBulletIds = new Set(base.experience.flatMap((entry) => entry.bullets.map((bullet) => bullet.sourceBulletId)));

  for (const entry of base.experience) {
    const bankEntry = bankExperience.get(entry.entryId);
    if (!bankEntry) continue;
    for (const baseBullet of entry.bullets) {
      for (const replacement of bankEntry.bullets) {
        if (baseBulletIds.has(replacement.id)) continue;
        const result = candidateGain(`${replacement.text} ${(replacement.skills || []).join(" ")}`, baseBullet.text, terms, baseCoverage);
        if (metricCount(replacement.text) < metricCount(baseBullet.text)) continue;
        const expectedGain = result.gain;
        if (expectedGain >= MIN_RELEVANCE_BENEFIT) candidates.push({ id: `bullet-swap:${entry.entryId}:${baseBullet.sourceBulletId}:${replacement.id}`, type: "bullet-swap", entryId: entry.entryId, baseBulletId: baseBullet.sourceBulletId, replacementBulletId: replacement.id, matchedTerms: result.useful.map((item) => item.term), expectedGain, reason: `Adds verified evidence for ${result.useful.map((item) => item.term).join(", ")}.`, preservesMetricStrength: metricCount(replacement.text) >= metricCount(baseBullet.text) });
      }
      const source = bankEntry.bullets.find((bullet) => bullet.id === baseBullet.sourceBulletId);
      if (source) {
        const supported = matches(`${source.text} ${(source.skills || []).join(" ")}`, gaps).filter((record) => !textContainsTerm(baseBullet.text, record.term) && skillClassificationForTerm(bank, record.term) !== "knowledge");
        const expectedGain = supported.reduce((sum, record) => sum + record.weight, 0);
        if (expectedGain >= MIN_RELEVANCE_BENEFIT) candidates.push({ id: `bullet-rewrite:${entry.entryId}:${baseBullet.sourceBulletId}`, type: "bullet-rewrite", entryId: entry.entryId, baseBulletId: baseBullet.sourceBulletId, matchedTerms: supported.map((item) => item.term), expectedGain, reason: `May lightly expose already-supported terminology: ${supported.map((item) => item.term).join(", ")}.`, sourceText: baseBullet.text });
      }
    }
  }

  for (const baseProject of base.projects) for (const replacement of bank.projects) {
    if (base.projects.some((project) => project.entryId === replacement.id) || replacement.bullets.length < baseProject.bullets.length) continue;
    const sourceText = baseProject.bullets.map((bullet) => bullet.text).join(" ");
    const targetText = `${replacement.org} ${replacement.role} ${replacement.bullets.map((bullet) => `${bullet.text} ${(bullet.skills || []).join(" ")}`).join(" ")}`;
    const result = candidateGain(targetText, sourceText, terms, baseCoverage);
    if (metricCount(targetText) < metricCount(sourceText)) continue;
    const expectedGain = result.gain;
    if (expectedGain >= MIN_RELEVANCE_BENEFIT) candidates.push({ id: `project-swap:${baseProject.entryId}:${replacement.id}`, type: "project-swap", baseProjectId: baseProject.entryId, replacementProjectId: replacement.id, matchedTerms: result.useful.map((item) => item.term), expectedGain, reason: `Adds verified project evidence for ${result.useful.map((item) => item.term).join(", ")}.` });
  }

  for (const group of base.skills) {
    const compatible = COMPATIBLE_SKILL_GROUPS[group.label.toLowerCase()] || [];
    const items = bank.skillGroups.filter((bankGroup) => compatible.includes(bankGroup.id)).flatMap((bankGroup) => bankGroup.items);
    for (const item of unique(items)) {
      if (base.skills.some((baseGroup) => baseGroup.items.some((baseItem) => baseItem.toLowerCase() === item.toLowerCase()))) continue;
      const useful = matches(item, gaps).filter((record) => record.isMustHave || record.frequency >= 2 || record.isResponsibility);
      const expectedGain = useful.reduce((sum, record) => sum + record.weight, 0);
      if (expectedGain >= MIN_RELEVANCE_BENEFIT) candidates.push({ id: `skill-edit:${group.label}:${item}`, type: "skill-edit", groupLabel: group.label, replacementItem: item, classification: skillClassification(bank, item), matchedTerms: useful.map((record) => record.term), expectedGain, reason: `Adds a ${skillClassification(bank, item)} skill for ${useful.map((record) => record.term).join(", ")}.` });
    }
  }

  for (const summary of summaryCatalog(bank)) {
    if (summary.text === base.summary) continue;
    const result = candidateGain(summary.text, base.summary, terms, baseCoverage);
    if (result.gain >= MIN_RELEVANCE_BENEFIT) candidates.push({ id: `summary:${summary.summaryId}`, type: "summary", summaryId: summary.summaryId, matchedTerms: result.useful.map((item) => item.term), expectedGain: result.gain, reason: `Improves summary evidence for ${result.useful.map((item) => item.term).join(", ")}.` });
  }

  candidates.sort((a, b) => b.expectedGain - a.expectedGain || a.id.localeCompare(b.id));
  const usefulCandidates = candidates.slice(0, 20);
  const supportedText = allBankText(bank);
  const unsupportedMissing = gaps.filter((record) => !textContainsTerm(supportedText, record.term)).map((record) => ({ term: record.term, priority: record.weight, frequency: record.frequency, isMustHave: record.isMustHave }));
  return { version: 1, baseResumeId: base.id, minimumBenefit: MIN_RELEVANCE_BENEFIT, baseCoverage, terms, gaps, unsupportedMissing, candidates: usefulCandidates };
}

export function summarizeCoverageChange(before, after) {
  const beforeCovered = new Set(before.coveredKeywords.map((item) => item.normalized));
  const afterCovered = new Set(after.coveredKeywords.map((item) => item.normalized));
  const beforeMust = new Set(before.mustHave.covered.map((item) => item.normalized));
  const afterMust = new Set(after.mustHave.covered.map((item) => item.normalized));
  return {
    weightedPercentageDelta: Math.round((after.weightedCoveragePercentage - before.weightedCoveragePercentage) * 100) / 100,
    coveragePercentageDelta: Math.round((after.coveragePercentage - before.coveragePercentage) * 100) / 100,
    newlyCoveredTerms: [...afterCovered].filter((term) => !beforeCovered.has(term)),
    noLongerCoveredTerms: [...beforeCovered].filter((term) => !afterCovered.has(term)),
    newlyCoveredMustHaves: [...afterMust].filter((term) => !beforeMust.has(term)),
    noLongerCoveredMustHaves: [...beforeMust].filter((term) => !afterMust.has(term)),
  };
}
