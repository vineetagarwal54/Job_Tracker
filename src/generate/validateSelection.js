import { technologiesIn, acronymsIn, compoundsIn, textContainsTerm } from "./protectedTerms.js";

const FORBIDDEN_CLAIM_PATTERNS = [
  /cuda\s+(?:kernel|kernels|authoring|optimization)/i,
  /(?:fused|fuse|fusion)\s+(?:rmsnorm|linear|cuda|kernel)/i,
  /gpu\s+kernel\s+optimization/i,
];
const NUMBER_PATTERN = /\b\d+(?:\.\d+)?(?:%|[A-Za-z]+)?\b/g;
const VARIANT_IDS = new Set(["ai-llm", "cloud-backend", "fullstack", "mobile", "academic"]);

function fail(message) {
  throw new Error(`Invalid resume selection: ${message}`);
}

function assertKnownFields(value, allowed, context) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${context} must be an object`);
  for (const field of Object.keys(value)) {
    if (!allowed.includes(field)) fail(`${context} contains unknown field '${field}'`);
  }
}

function indexEntries(bank) {
  const entries = new Map();
  const bullets = new Map();
  for (const section of ["experience", "projects"]) {
    for (const entry of bank[section]) {
      entries.set(entry.id, { entry, section });
      for (const bullet of entry.bullets) bullets.set(bullet.id, { bullet, entry, section });
    }
  }
  return { entries, bullets };
}

function numbersIn(text) {
  return new Set((text.match(NUMBER_PATTERN) || []).map((number) => number.toLowerCase()));
}

// Returns a reason string when `text` is an invalid rendering of `bullet`, or
// null when it is acceptable. Non-throwing so it can drive both hard validation
// and graceful rewrite reversion (task Phase 5).
export function rewriteViolation(bullet, text) {
  for (const metric of bullet.lockedMetrics) {
    if (!text.includes(metric)) return `removed locked metric '${metric}'`;
  }
  if (!bullet.rewritable && text !== bullet.text) return "is not rewritable";
  const sourceNumbers = numbersIn(bullet.text);
  for (const number of numbersIn(text)) {
    if (!sourceNumbers.has(number)) return `introduced number '${number}'`;
  }
  for (const pattern of FORBIDDEN_CLAIM_PATTERNS) {
    if (pattern.test(text)) return "contains a forbidden CUDA-authoring claim";
  }
  // Rewrite-only protections (task Phases 5 and 6). A rewrite must not
  // introduce an unsupported technology, and must preserve any acronym or
  // technical compound present in the source.
  if (text !== bullet.text) {
    const sourceTech = technologiesIn(bullet.text);
    for (const tech of technologiesIn(text)) {
      if (!sourceTech.has(tech)) return `introduced unsupported technology '${tech}'`;
    }
    for (const acronym of acronymsIn(bullet.text)) {
      if (!acronymsIn(text).includes(acronym)) return `dropped acronym '${acronym}'`;
    }
    for (const compound of compoundsIn(bullet.text)) {
      if (!compoundsIn(text).includes(compound)) return `dropped technical compound '${compound}'`;
    }
  }
  return null;
}

function validateBulletText(bullet, text) {
  const violation = rewriteViolation(bullet, text);
  if (violation) fail(`rewrite of '${bullet.id}' ${violation}`);
}

// True when a rewrite's justification references a real JD term/responsibility.
// A cosmetic rewrite (changed wording with no JD-grounded reason) is rejected.
function justificationReferencesJd(justification, jdTerms) {
  if (typeof justification !== "string" || !justification.trim()) return false;
  for (const term of jdTerms) {
    if (term && textContainsTerm(justification, term)) return true;
  }
  return false;
}

// Deterministically reverts any rewrite that violates a rewrite rule back to the
// verified original bullet text (task Phase 5: "reject the rewrite, use the
// original bullet"). When a JD-term set is supplied, also reverts cosmetic
// rewrites whose justification does not reference a real JD term or
// responsibility (task Part 3). Returns { selection, reverted } and never throws.
export function sanitizeSelectionRewrites(bank, selection, options = {}) {
  const jdTerms = options.jdTerms instanceof Set ? options.jdTerms : (Array.isArray(options.jdTerms) ? new Set(options.jdTerms) : null);
  const indexed = indexEntries(bank);
  const reverted = [];
  const revert = (selected, reason) => {
    reverted.push({ id: selected.id, reason });
    const { rewrittenText, justification, ...rest } = selected;
    return rest;
  };
  const fixEntry = (entry) => ({
    ...entry,
    bullets: (entry.bullets || []).map((selected) => {
      if (typeof selected.rewrittenText !== "string") return selected;
      const indexedBullet = indexed.bullets.get(selected.id);
      if (!indexedBullet) return selected;
      const violation = rewriteViolation(indexedBullet.bullet, selected.rewrittenText);
      if (violation) return revert(selected, violation);
      // Require a valid, JD-grounded justification for any actual text change.
      const changed = selected.rewrittenText.trim() !== indexedBullet.bullet.text.trim();
      if (changed && jdTerms && jdTerms.size > 0 && !justificationReferencesJd(selected.justification, jdTerms)) {
        return revert(selected, "cosmetic rewrite without a valid JD-term justification");
      }
      return selected;
    }),
  });
  return {
    selection: {
      ...selection,
      experience: (selection.experience || []).map(fixEntry),
      projects: (selection.projects || []).map(fixEntry),
    },
    reverted,
  };
}

function actionVerb(text) {
  const match = text.trim().match(/^([A-Za-z]+)/);
  return match ? match[1].toLowerCase() : "";
}

export function validateSelection(bank, selection, options = {}) {
  const { requireUniqueActionVerbs = true } = options;
  assertKnownFields(selection, ["version", "variant", "emphasis", "emphases", "educationId", "skillGroupIds", "skills", "renderedSkills", "experience", "projects"], "selection");
  if (selection.version !== 1) fail("version must be 1");
  if (!VARIANT_IDS.has(selection.variant)) fail(`unknown variant '${selection.variant}'`);
  if (!Array.isArray(bank.education) || !bank.education.some((education) => education.id === selection.educationId)) fail(`unknown education '${selection.educationId}'`);
  if (!Array.isArray(selection.skillGroupIds) || selection.skillGroupIds.length === 0) fail("skillGroupIds must be a non-empty array");
  const skillGroups = new Map(bank.skillGroups.map((group) => [group.id, group]));
  for (const id of selection.skillGroupIds) {
    const group = skillGroups.get(id);
    if (!group) fail(`unknown skill group '${id}'`);
  }
  // Optional per-item skill selection: every referenced item must be a verified
  // bank skill in its declared group. This is what stops the model from
  // inventing a skill via the individual-skill contract.
  if (selection.skills !== undefined) {
    if (!Array.isArray(selection.skills)) fail("skills must be an array");
    for (const entry of selection.skills) {
      assertKnownFields(entry, ["groupId", "items"], "skills entry");
      const group = skillGroups.get(entry.groupId);
      if (!group) fail(`unknown skill group '${entry.groupId}' in skills`);
      if (!Array.isArray(entry.items)) fail(`skills.items for '${entry.groupId}' must be an array`);
      const known = new Set(group.items.map((item) => item.toLowerCase()));
      for (const item of entry.items) {
        if (!known.has(String(item).toLowerCase())) fail(`unknown skill '${item}' for group '${entry.groupId}'`);
      }
    }
  }

  const indexed = indexEntries(bank);
  const rankedBullets = [];
  const selectedBulletIds = new Set();
  for (const section of ["experience", "projects"]) {
    if (!Array.isArray(selection[section])) fail(`${section} must be an array`);
    for (const selectedEntry of selection[section]) {
      assertKnownFields(selectedEntry, ["entryId", "bullets"], `${section} entry`);
      const indexedEntry = indexed.entries.get(selectedEntry.entryId);
      if (!indexedEntry || indexedEntry.section !== section) fail(`unknown ${section} entry '${selectedEntry.entryId}'`);
      if (!Array.isArray(selectedEntry.bullets) || selectedEntry.bullets.length === 0) fail(`${selectedEntry.entryId}: bullets must be a non-empty array`);
      for (const selectedBullet of selectedEntry.bullets) {
        assertKnownFields(selectedBullet, ["id", "rewrittenText", "justification"], `${selectedEntry.entryId} bullet`);
        const indexedBullet = indexed.bullets.get(selectedBullet.id);
        if (!indexedBullet || indexedBullet.entry.id !== selectedEntry.entryId) fail(`unknown bullet '${selectedBullet.id}' for '${selectedEntry.entryId}'`);
        if (selectedBulletIds.has(selectedBullet.id)) fail(`duplicate selected bullet '${selectedBullet.id}'`);
        selectedBulletIds.add(selectedBullet.id);
        const text = selectedBullet.rewrittenText ?? indexedBullet.bullet.text;
        if (typeof text !== "string" || !text.trim()) fail(`'${selectedBullet.id}' must resolve to non-empty text`);
        validateBulletText(indexedBullet.bullet, text);
        rankedBullets.push({ section, entry: indexedEntry.entry, bullet: indexedBullet.bullet, text });
      }
    }
  }
  if (requireUniqueActionVerbs) {
    const verbs = new Map();
    for (const item of rankedBullets) {
      const verb = actionVerb(item.text);
      if (!verb) fail(`'${item.bullet.id}' has no action verb`);
      if (verbs.has(verb)) fail(`action verb '${verb}' repeats in '${item.bullet.id}' and '${verbs.get(verb)}'`);
      verbs.set(verb, item.bullet.id);
    }
  }
  return { ...selection, rankedBullets };
}
