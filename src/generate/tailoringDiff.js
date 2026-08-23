import { rewriteViolation } from "./resumeEvidenceValidation.js";
import { textContainsTerm } from "./protectedTerms.js";
import { scoreCoverage } from "./coverageScoring.js";
import { missingJobSkills } from "./resumeGapReporting.js";
import { MIN_RELEVANCE_BENEFIT, relevanceUtility } from "./relevanceIntelligence.js";
import { inventorySkills, isHandsOnSkill } from "./skillInventory.js";

export const TAILORING_CAPS = Object.freeze({ bulletChanges: 3, projectSwaps: 1, skillChanges: 4 });

export const EMPTY_TAILORING_DIFF = Object.freeze({
  version: 1,
  summaryChange: null,
  bulletChanges: [],
  projectSwap: null,
  skillChanges: [],
});

const NUMBER_PATTERN = /\b\d+(?:\.\d+)?(?:%|[A-Za-z]+)?\b/g;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizedTerms(extraction, analysis) {
  const values = [
    ...(extraction?.keywords || []).flatMap((item) => [item.normalized, item.value]),
    ...(analysis?.mustHaveKeywords || []),
    ...(analysis?.niceToHaveKeywords || []),
    ...(analysis?.responsibilities || []),
  ];
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function justified(justification, terms) {
  return typeof justification === "string" && justification.trim() && terms.some((term) => textContainsTerm(justification, term));
}

function matchesJd(text, terms) {
  return terms.some((term) => textContainsTerm(text, term));
}

function tokens(text) {
  return new Set(String(text || "").toLowerCase().match(/[a-z0-9+#.]+/g) || []);
}

function similarity(a, b) {
  const left = tokens(a);
  const right = tokens(b);
  const union = new Set([...left, ...right]);
  if (!union.size) return 1;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / union.size;
}

function density(base) {
  const parts = [base.summary];
  for (const group of base.skills || []) parts.push(group.label, ...(group.items || []));
  for (const section of ["experience", "projects"]) {
    for (const entry of base[section] || []) for (const bullet of entry.bullets || []) parts.push(bullet.text);
  }
  return parts.join(" ").replace(/\s+/g, "").length;
}

function densityIsSafe(original, candidate) {
  const ratio = density(candidate) / Math.max(1, density(original));
  return ratio >= 0.85 && ratio <= 1.15;
}

function duplicateOpeningVerbCount(base) {
  const counts = new Map();
  for (const entry of [...(base.experience || []), ...(base.projects || [])]) for (const bullet of entry.bullets || []) {
    const verb = String(bullet.text || "").trim().match(/^[A-Za-z]+/)?.[0]?.toLowerCase();
    if (verb) counts.set(verb, (counts.get(verb) || 0) + 1);
  }
  return [...counts.values()].reduce((total, count) => total + Math.max(0, count - 1), 0);
}

function actionVerbsAreSafe(original, candidate) {
  return duplicateOpeningVerbCount(candidate) <= duplicateOpeningVerbCount(original);
}

function summaryCatalog(bank) {
  const entries = [];
  for (const [key, text] of Object.entries(bank.summary?.byVariant || {})) entries.push([`variant:${key}`, text]);
  for (const [key, text] of Object.entries(bank.summary?.byEmphasis || {})) entries.push([`emphasis:${key}`, text]);
  return new Map(entries);
}

function bankIndex(bank) {
  const experience = new Map(bank.experience.map((entry) => [entry.id, entry]));
  const projects = new Map(bank.projects.map((entry) => [entry.id, entry]));
  const bullets = new Map();
  for (const entry of [...bank.experience, ...bank.projects]) {
    for (const bullet of entry.bullets) bullets.set(bullet.id, { bullet, entry });
  }
  const skillItems = new Map();
  for (const group of bank.skillGroups) for (const item of group.items) {
    const key = item.toLowerCase();
    if (!skillItems.has(key)) skillItems.set(key, []);
    skillItems.get(key).push({ item, groupId: group.id });
  }
  return { experience, projects, bullets, skillItems };
}

const BASE_SKILL_GROUP_COMPATIBILITY = Object.freeze({
  languages: ["languages"],
  backend: ["backend", "distributed-messaging"],
  frontend: ["frontend"],
  mobile: ["mobile", "frontend"],
  databases: ["databases"],
  "cloud and devops": ["aws-cloud", "azure-cloud", "cloud-devops", "observability"],
  "cloud & devops": ["aws-cloud", "azure-cloud", "cloud-devops", "observability"],
  "backend & cloud": ["backend", "distributed-messaging", "aws-cloud", "azure-cloud", "cloud-devops", "observability"],
  "real-time & data": ["backend", "distributed-messaging", "databases"],
  "applied ai": ["applied-ai", "llm-inference"],
  "ai / llm": ["applied-ai", "llm-inference"],
  "on-device ai": ["applied-ai", "llm-inference", "mobile"],
  "genai automation": ["applied-ai", "enterprise-automation", "salesforce", "azure-cloud"],
  "llm inference & optimization": ["llm-inference"],
  "core engineering": ["system-design", "security", "testing", "cs-foundations", "architecture-practices", "distributed-messaging", "observability"],
  "core concepts": ["system-design", "security", "testing", "cs-foundations", "architecture-practices", "distributed-messaging", "observability"],
  "architecture and practices": ["system-design", "security", "testing", "cs-foundations", "architecture-practices", "distributed-messaging", "observability"],
});

function reject(rejected, type, reason, change) {
  rejected.push({ type, reason, change: clone(change) });
}

function findBaseBullet(base, entryId, bulletId) {
  const entry = base.experience.find((candidate) => candidate.entryId === entryId);
  const index = entry?.bullets.findIndex((bullet) => bullet.sourceBulletId === bulletId) ?? -1;
  return { entry, index, bullet: index >= 0 ? entry.bullets[index] : null };
}

function validKnownFields(value, allowed) {
  return value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).every((key) => allowed.includes(key));
}

export function applyTailoringDiff({ bank, base, diff, extraction = null, analysis = null, relevancePlan = null }) {
  const original = clone(base);
  let tailored = clone(base);
  const accepted = { version: 1, summaryChange: null, bulletChanges: [], projectSwap: null, skillChanges: [] };
  const rejected = [];
  const index = bankIndex(bank);
  const terms = normalizedTerms(extraction, analysis);
  const candidate = diff && typeof diff === "object" && !Array.isArray(diff) ? diff : {};
  const knownTopFields = ["version", "baseResumeId", "summaryChange", "bulletChanges", "projectSwap", "skillChanges"];
  for (const key of Object.keys(candidate)) if (!knownTopFields.includes(key)) reject(rejected, "protected-structure", `Unsupported field '${key}' cannot modify protected base structure.`, { [key]: candidate[key] });
  if (candidate.version !== undefined && candidate.version !== 1) reject(rejected, "diff", "Diff version must be 1.", { version: candidate.version });
  if (candidate.baseResumeId !== undefined && candidate.baseResumeId !== base.id) reject(rejected, "diff", "Diff targets a different canonical base.", { baseResumeId: candidate.baseResumeId });

  const relevanceCandidates = new Map((relevancePlan?.candidates || []).map((item) => [item.id, item]));
  const relevanceCandidate = (change, type) => {
    if (!relevancePlan) return null;
    const found = relevanceCandidates.get(change?.candidateId);
    if (!found || found.type !== type || found.expectedGain < (relevancePlan.minimumBenefit || MIN_RELEVANCE_BENEFIT)) return false;
    return found;
  };
  const relevanceReasonIsValid = (change, found) => !relevancePlan || (found && justified(change.justification, found.matchedTerms));
  const positiveBenefit = (before, after) => !relevancePlan || relevanceUtility(after, relevancePlan) - relevanceUtility(before, relevancePlan) >= (relevancePlan.minimumBenefit || MIN_RELEVANCE_BENEFIT);

  if (candidate.summaryChange) {
    const change = candidate.summaryChange;
    const summaries = summaryCatalog(bank);
    const relevant = relevanceCandidate(change, "summary");
    if (!validKnownFields(change, ["candidateId", "summaryId", "justification"])) reject(rejected, "summary", "Summary change contains unsupported fields.", change);
    else if (relevancePlan && !relevant) reject(rejected, "summary", "Summary change is not an approved minimum-benefit candidate.", change);
    else if (relevant && relevant.summaryId !== change.summaryId) reject(rejected, "summary", "Summary change does not match its approved candidate.", change);
    else if (!summaries.has(change.summaryId)) reject(rejected, "summary", "Summary must reference a verified bank summary ID.", change);
    else if (!justified(change.justification, terms) || !relevanceReasonIsValid(change, relevant)) reject(rejected, "summary", "Summary change is not justified by its concrete JD gap.", change);
    else if (!matchesJd(summaries.get(change.summaryId), terms)) reject(rejected, "summary", "Verified summary does not surface a JD term.", change);
    else {
      const next = clone(tailored);
      next.summary = summaries.get(change.summaryId);
      if (!densityIsSafe(original, next)) reject(rejected, "summary", "Summary change exceeds the density guard.", change);
      else if (!positiveBenefit(tailored, next)) reject(rejected, "summary", "Summary change has no positive relevance benefit.", change);
      else { tailored = next; accepted.summaryChange = clone(change); }
    }
  }

  const bulletChanges = Array.isArray(candidate.bulletChanges) ? candidate.bulletChanges : [];
  for (const [position, change] of bulletChanges.entries()) {
    if (position >= TAILORING_CAPS.bulletChanges) { reject(rejected, "bullet", "Bullet modification cap exceeded.", change); continue; }
    const relevantType = change.type === "swap" ? "bullet-swap" : change.type === "rewrite" ? "bullet-rewrite" : null;
    const relevant = relevanceCandidate(change, relevantType);
    if (!validKnownFields(change, ["candidateId", "type", "entryId", "baseBulletId", "replacementBulletId", "rewrittenText", "justification"])) { reject(rejected, "bullet", "Bullet change contains unsupported fields.", change); continue; }
    if (relevancePlan && !relevant) { reject(rejected, "bullet", "Bullet change is not an approved minimum-benefit candidate.", change); continue; }
    if (relevant && (relevant.entryId !== change.entryId || relevant.baseBulletId !== change.baseBulletId || (change.type === "swap" && relevant.replacementBulletId !== change.replacementBulletId))) { reject(rejected, "bullet", "Bullet change does not match its approved candidate.", change); continue; }
    const located = findBaseBullet(tailored, change.entryId, change.baseBulletId);
    if (!located.entry || !located.bullet) { reject(rejected, "bullet", "Bullet change does not target a bullet in the selected base experience.", change); continue; }
    if (!justified(change.justification, terms) || !relevanceReasonIsValid(change, relevant)) { reject(rejected, "bullet", "Bullet change is not justified by its concrete JD gap.", change); continue; }
    let replacement;
    if (change.type === "swap") {
      const found = index.bullets.get(change.replacementBulletId);
      if (!found || found.entry.id !== change.entryId || index.projects.has(found.entry.id)) { reject(rejected, "bullet", "Bullet swaps must use a verified bullet from the same experience.", change); continue; }
      if (located.entry.bullets.some((bullet) => bullet.sourceBulletId === change.replacementBulletId)) { reject(rejected, "bullet", "Replacement bullet is already present in the base experience.", change); continue; }
      if (!matchesJd(found.bullet.text, terms)) { reject(rejected, "bullet", "Replacement bullet does not surface a JD term.", change); continue; }
      replacement = { sourceBulletId: found.bullet.id, text: found.bullet.text };
    } else if (change.type === "rewrite") {
      const source = index.bullets.get(change.baseBulletId)?.bullet;
      const text = String(change.rewrittenText || "").trim();
      if (!source || !text) { reject(rejected, "bullet", "Rewrite must target verified evidence and provide text.", change); continue; }
      const sourceForValidation = { ...source, text: located.bullet.text, lockedMetrics: [...new Set([...(source.lockedMetrics || []).filter((metric) => located.bullet.text.includes(metric)), ...(located.bullet.text.match(NUMBER_PATTERN) || [])])] };
      const violation = rewriteViolation(sourceForValidation, text);
      const surfacedKnowledge = inventorySkills(bank).find((skill) => !isHandsOnSkill(bank, skill.name) && !textContainsTerm(located.bullet.text, skill.name) && textContainsTerm(text, skill.name));
      const lengthRatio = text.length / located.bullet.text.length;
      if (violation) { reject(rejected, "bullet", `Rewrite ${violation}.`, change); continue; }
      if (surfacedKnowledge) { reject(rejected, "bullet", `Knowledge skill '${surfacedKnowledge.name}' cannot be inserted into accomplishment evidence.`, change); continue; }
      if (similarity(located.bullet.text, text) < 0.55 || lengthRatio < 0.75 || lengthRatio > 1.25) { reject(rejected, "bullet", "Rewrite is not a light edit of the base bullet.", change); continue; }
      if (!matchesJd(text, terms) || (relevant && !relevant.matchedTerms.some((term) => textContainsTerm(text, term)))) { reject(rejected, "bullet", "Rewrite does not surface the approved JD term.", change); continue; }
      replacement = { sourceBulletId: source.id, text };
    } else { reject(rejected, "bullet", "Unknown bullet change type.", change); continue; }
    const next = clone(tailored);
    const nextLocated = findBaseBullet(next, change.entryId, change.baseBulletId);
    nextLocated.entry.bullets[nextLocated.index] = replacement;
    if (!densityIsSafe(original, next)) reject(rejected, "bullet", "Bullet change exceeds the density guard.", change);
    else if (!actionVerbsAreSafe(original, next)) reject(rejected, "bullet", "Bullet change would add a repeated opening action verb.", change);
    else if (!positiveBenefit(tailored, next)) reject(rejected, "bullet", "Bullet change has no positive relevance benefit.", change);
    else { tailored = next; accepted.bulletChanges.push(clone(change)); }
  }

  if (candidate.projectSwap) {
    const change = candidate.projectSwap;
    const relevant = relevanceCandidate(change, "project-swap");
    if (!validKnownFields(change, ["candidateId", "baseProjectId", "replacementProjectId", "justification"])) reject(rejected, "project", "Project swap contains unsupported fields.", change);
    else if (relevancePlan && !relevant) reject(rejected, "project", "Project swap is not an approved minimum-benefit candidate.", change);
    else if (relevant && (relevant.baseProjectId !== change.baseProjectId || relevant.replacementProjectId !== change.replacementProjectId)) reject(rejected, "project", "Project swap does not match its approved candidate.", change);
    else if (!justified(change.justification, terms) || !relevanceReasonIsValid(change, relevant)) reject(rejected, "project", "Project swap is not justified by its concrete JD gap.", change);
    else {
      const slot = tailored.projects.findIndex((project) => project.entryId === change.baseProjectId);
      const replacement = index.projects.get(change.replacementProjectId);
      if (slot < 0) reject(rejected, "project", "Project swap must replace a project in the selected base.", change);
      else if (!replacement || tailored.projects.some((project) => project.entryId === replacement.id)) reject(rejected, "project", "Replacement project must be a different verified bank project.", change);
      else if (replacement.bullets.length < tailored.projects[slot].bullets.length) reject(rejected, "project", "Replacement project lacks enough verified bullets to preserve bullet density.", change);
      else if (!matchesJd(`${replacement.org} ${replacement.role} ${replacement.bullets.map((bullet) => bullet.text).join(" ")}`, terms)) reject(rejected, "project", "Replacement project does not surface a JD term.", change);
      else {
        const bulletCount = tailored.projects[slot].bullets.length;
        const bullets = [...replacement.bullets].sort((a, b) => a.priority - b.priority).slice(0, bulletCount).map((bullet) => ({ sourceBulletId: bullet.id, text: bullet.text }));
        const next = clone(tailored);
        next.projects[slot] = { entryId: replacement.id, title: replacement.org, role: replacement.role, dates: replacement.dates || "", bullets };
        if (!densityIsSafe(original, next)) reject(rejected, "project", "Project swap exceeds the density guard.", change);
        else if (!actionVerbsAreSafe(original, next)) reject(rejected, "project", "Project swap would add a repeated opening action verb.", change);
        else if (!positiveBenefit(tailored, next)) reject(rejected, "project", "Project swap has no positive relevance benefit.", change);
        else { tailored = next; accepted.projectSwap = clone(change); }
      }
    }
  }

  const skillChanges = Array.isArray(candidate.skillChanges) ? candidate.skillChanges : [];
  for (const [position, change] of skillChanges.entries()) {
    if (position >= TAILORING_CAPS.skillChanges) { reject(rejected, "skill", "Skill modification cap exceeded.", change); continue; }
    const relevant = relevanceCandidate(change, "skill-edit");
    if (!validKnownFields(change, ["candidateId", "type", "groupLabel", "baseItem", "replacementItem", "justification"])) { reject(rejected, "skill", "Skill change contains unsupported fields.", change); continue; }
    if (relevancePlan && !relevant) { reject(rejected, "skill", "Skill change is not an approved minimum-benefit candidate.", change); continue; }
    if (relevant && (relevant.groupLabel !== change.groupLabel || relevant.replacementItem !== change.replacementItem)) { reject(rejected, "skill", "Skill change does not match its approved candidate.", change); continue; }
    const group = tailored.skills.find((candidateGroup) => candidateGroup.label.toLowerCase() === String(change.groupLabel || "").toLowerCase());
    const verifiedCandidates = index.skillItems.get(String(change.replacementItem || "").toLowerCase()) || [];
    const compatibleGroupIds = BASE_SKILL_GROUP_COMPATIBILITY[String(change.groupLabel || "").toLowerCase()] || [];
    const verified = verifiedCandidates.find((candidateItem) => compatibleGroupIds.includes(candidateItem.groupId));
    const verifiedItem = verified?.item;
    if (!group) { reject(rejected, "skill", "Skill change must target an existing base skill category.", change); continue; }
    if (!verifiedItem) { reject(rejected, "skill", "Skill addition must reference a verified item compatible with the targeted category.", change); continue; }
    if (!justified(change.justification, terms) || !relevanceReasonIsValid(change, relevant)) { reject(rejected, "skill", "Skill change is not justified by its concrete JD gap.", change); continue; }
    if (!matchesJd(verifiedItem, terms)) { reject(rejected, "skill", "Skill change does not add a JD term.", change); continue; }
    if (tailored.skills.some((candidateGroup) => candidateGroup.items.some((item) => item.toLowerCase() === verifiedItem.toLowerCase()))) { reject(rejected, "skill", "Skill is already present in the base.", change); continue; }
    const next = clone(tailored);
    const nextGroup = next.skills.find((candidateGroup) => candidateGroup.label === group.label);
    if (change.type === "add") nextGroup.items.push(verifiedItem);
    else if (change.type === "swap") {
      const itemIndex = nextGroup.items.findIndex((item) => item.toLowerCase() === String(change.baseItem || "").toLowerCase());
      if (itemIndex < 0) { reject(rejected, "skill", "Skill swap must replace an item in the targeted category.", change); continue; }
      nextGroup.items[itemIndex] = verifiedItem;
    } else { reject(rejected, "skill", "Unknown skill change type.", change); continue; }
    if (!densityIsSafe(original, next)) reject(rejected, "skill", "Skill change exceeds the density guard.", change);
    else if (!positiveBenefit(tailored, next)) reject(rejected, "skill", "Skill change has no positive relevance benefit.", change);
    else { tailored = next; accepted.skillChanges.push(clone(change)); }
  }

  return { base: tailored, acceptedDiff: accepted, rejected, densityRatio: density(tailored) / Math.max(1, density(original)) };
}

export function tailoredBaseEvidenceSelection(bank, base) {
  const skillGroups = base.skills.map((group, index) => ({ id: `base-skill-${index}`, label: group.label, items: [...group.items] }));
  const bankBullets = new Map([...bank.experience, ...bank.projects].flatMap((entry) => entry.bullets.map((bullet) => [bullet.id, bullet.text])));
  const selectedBullet = (bullet) => bankBullets.get(bullet.sourceBulletId) === bullet.text
    ? { id: bullet.sourceBulletId }
    : { id: bullet.sourceBulletId, rewrittenText: bullet.text };
  return {
    version: 1,
    variant: base.variant,
    educationId: base.education.educationId,
    skillGroupIds: [bank.skillGroups[0].id],
    renderedSkills: skillGroups,
    experience: base.experience.map((entry) => ({ entryId: entry.entryId, bullets: entry.bullets.map(selectedBullet) })),
    projects: base.projects.map((entry) => ({ entryId: entry.entryId, bullets: entry.bullets.map(selectedBullet) })),
  };
}

export function verifyTailoredBase({ bank, base, extraction, analysis, pageCount }) {
  const selection = tailoredBaseEvidenceSelection(bank, base);
  const bulletTexts = {};
  for (const section of ["experience", "projects"]) for (const entry of base[section]) for (const bullet of entry.bullets) bulletTexts[bullet.sourceBulletId] = bullet.text;
  const bulletIds = Object.keys(bulletTexts);
  const coverage = scoreCoverage(bank, extraction, { analysis, bulletIds, bulletTexts, renderedSkills: selection.renderedSkills, skillGroupIds: selection.skillGroupIds, includeBulletSkills: false, extraSources: [{ id: "base-summary", text: base.summary }] });
  return {
    coverage,
    pageCount,
    includedBulletIds: bulletIds,
    renderedSkills: selection.renderedSkills,
    missingSkills: missingJobSkills({ extraction, analysis, renderedSkills: selection.renderedSkills, bulletTexts }),
    excluded: [],
    protectedStructurePreserved: true,
    densityRatio: 1,
  };
}
