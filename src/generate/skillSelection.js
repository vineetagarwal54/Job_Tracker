// Individual, JD-specific skill selection (task Part 2).
//
// The verified content bank remains the single source of truth: nothing here
// invents a skill. This module turns a set of skill GROUPS plus optional
// model-preferred items into the exact list of individual skills that appears
// in the rendered resume, ordered by JD importance and trimmed to what fits.
//
// Two modes:
//   - JD mode (an `extraction` or `analysis` is supplied): each category shows
//     only its mandatory items plus the items the job description actually
//     asks for, ordered must-have > nice-to-have > generic JD mention > bank
//     order. Optional (non-mandatory) categories with no meaningful match are
//     dropped so the section never carries an empty or filler one-item group.
//   - No-JD mode (neither supplied, e.g. the sample render): every included
//     group renders its full item list, preserving the original behaviour.

import { textContainsTerm, canonicalizeTerm } from "./protectedTerms.js";
import {
  MANDATORY_SKILL_GROUP_IDS,
  MANDATORY_SKILL_ITEMS,
  isMandatorySkillGroup,
} from "./mandatoryContent.js";

// Section-level ceilings. Chosen to keep the two-column Skills block compact:
// the measured one-page budget assumes roughly the mandatory floor of rows, so
// extra categories and long item runs cost real vertical space.
// For an experienced candidate the Skills block should read full, not thinned:
// each shown group fills toward a target from its own bank order (JD matched
// items first), 8 or 9 of the 12 groups appear when relevant, and the total is
// generous. The compile then count then trim loop remains the real one page
// guard, so these ceilings can be comfortable.
export const SKILL_LIMITS = Object.freeze({
  maxTotalItems: 40,
  maxItemsPerGroup: 8,
  minItemsPerGroup: 4,
  targetItemsPerGroup: 5,
  maxGroups: 10,
});

// Legacy caps for the no-JD path (the fixed sample render and ctx-less tests).
// The fuller-list policy above is JD-tailored only; the no-JD path keeps its
// original section total and per-group minimum so those fixtures stay stable.
const LEGACY_TOTAL_CAP = Object.freeze({ maxTotalItems: 32, minItemsPerGroup: 2 });

function lowerSet(items) {
  return new Set((items || []).map((item) => String(item).toLowerCase()));
}

function mandatoryItemsFor(groupId) {
  return lowerSet(MANDATORY_SKILL_ITEMS[groupId] || []);
}

// Normalized JD term buckets. must-have and nice-to-have come from the Haiku
// analysis; the deterministic keyword extraction supplies the broad technical
// mention set. All are canonicalized so aliases (k8s, postgres, node, unix)
// collapse onto their canonical skill.
function jdTermBuckets({ extraction, analysis }) {
  const canon = (list) => new Set((list || []).map((term) => canonicalizeTerm(term)).filter(Boolean));
  const mustHave = canon(analysis?.mustHaveKeywords);
  const niceToHave = canon(analysis?.niceToHaveKeywords);
  const mentioned = canon((extraction?.keywords || []).map((keyword) => keyword.normalized || keyword.value));
  return { mustHave, niceToHave, mentioned };
}

// True when the JD (any bucket) references the given skill item, using the same
// alias-aware, token-exact matcher as coverage so "Java" never matches
// "JavaScript" and "K8s"/"Postgres"/"Unix" match their canonical skills.
function jdReferences(buckets, item) {
  const canonical = canonicalizeTerm(item);
  if (buckets.mustHave.has(canonical) || buckets.niceToHave.has(canonical) || buckets.mentioned.has(canonical)) {
    return true;
  }
  // Fall back to phrase/token matching for multi-word skills (e.g. "System
  // Design", "Amazon Bedrock") that will not appear as a single keyword token.
  for (const bucket of ["mustHave", "niceToHave", "mentioned"]) {
    for (const term of buckets[bucket]) {
      if (textContainsTerm(item, term) || textContainsTerm(term, item)) return true;
    }
  }
  return false;
}

function itemScore(groupId, item, buckets, modelPreferred) {
  const canonical = canonicalizeTerm(item);
  if (mandatoryItemsFor(groupId).has(String(item).toLowerCase())) return 1000;
  let score = 0;
  if (buckets.mustHave.has(canonical)) score = Math.max(score, 60);
  if (buckets.niceToHave.has(canonical)) score = Math.max(score, 40);
  if (score === 0 && jdReferences(buckets, item)) score = 20;
  if (modelPreferred.has(canonical)) score += 5;
  return score;
}

// Is any item in the group an explicit JD must-have? Used to allow a single
// high-signal skill to keep an otherwise-thin category.
function groupHasMustHave(group, buckets) {
  return (group.items || []).some((item) => buckets.mustHave.has(canonicalizeTerm(item)));
}

// Resolves the individual skills that will actually render.
//
// Inputs:
//   skillGroupIds  - the categories selected upstream (mandatory floor already
//                    injected). Governs which groups may appear.
//   selectedSkills - optional model preference: [{ groupId, items }]. Verified
//                    items only (validated/sanitized before this call); used as
//                    a light ordering signal, never to add unverified skills.
//   variant        - active resume variant, for adding JD-relevant categories.
//   extraction/analysis - JD signal. Their presence switches on JD mode.
//
// Returns { groups: [{ id, label, items }], selectedItems, droppedGroups }.
export function resolveRenderedSkills(bank, {
  skillGroupIds = [],
  selectedSkills = [],
  variant = null,
  extraction = null,
  analysis = null,
} = {}) {
  const byId = new Map((bank.skillGroups || []).map((group) => [group.id, group]));
  // JD mode narrows to individual items. It only engages when the JD actually
  // carries signal, so an empty analysis/extraction safely renders full lists.
  const jdMode =
    (Array.isArray(extraction?.keywords) && extraction.keywords.length > 0) ||
    (Array.isArray(analysis?.mustHaveKeywords) && analysis.mustHaveKeywords.length > 0) ||
    (Array.isArray(analysis?.niceToHaveKeywords) && analysis.niceToHaveKeywords.length > 0);
  const buckets = jdTermBuckets({ extraction, analysis });

  const preferredByGroup = new Map();
  for (const entry of selectedSkills || []) {
    if (!entry || !byId.has(entry.groupId)) continue;
    const group = byId.get(entry.groupId);
    const groupItems = lowerSet(group.items);
    const preferred = new Set();
    for (const item of entry.items || []) {
      if (groupItems.has(String(item).toLowerCase())) preferred.add(canonicalizeTerm(item));
    }
    preferredByGroup.set(entry.groupId, preferred);
  }

  // Which categories are eligible to appear.
  const includedIds = [];
  const seen = new Set();
  const pushGroup = (id) => {
    if (!id || seen.has(id) || !byId.has(id)) return;
    seen.add(id);
    includedIds.push(id);
  };
  for (const id of MANDATORY_SKILL_GROUP_IDS) pushGroup(id);
  for (const id of skillGroupIds) pushGroup(id);
  // In JD mode the job description may pull in a relevant category the model
  // never requested (Operating Systems, Networking, Security, System Design),
  // as long as it is variant-eligible and the JD actually references it.
  if (jdMode) {
    for (const group of bank.skillGroups || []) {
      if (seen.has(group.id)) continue;
      const variantOk = !variant || !group.variants || group.variants.includes(variant);
      if (!variantOk) continue;
      const referenced = (group.items || []).some((item) => jdReferences(buckets, item));
      if (referenced) pushGroup(group.id);
    }
  }

  const resolvedMandatory = [];
  const resolvedOptional = [];
  const droppedGroups = [];
  for (const id of includedIds) {
    const group = byId.get(id);
    if (!group) continue;
    const mandatoryGroup = isMandatorySkillGroup(id);
    const preferred = preferredByGroup.get(id) || new Set();

    if (!jdMode) {
      // Preserve the original behaviour: render the full verified item list.
      (mandatoryGroup ? resolvedMandatory : resolvedOptional).push({ id, label: group.label, items: [...group.items], signal: 0 });
      continue;
    }

    const scored = group.items.map((item) => ({ item, score: itemScore(id, item, buckets, preferred) }));
    const kept = scored.filter((entry) => entry.score > 0);
    kept.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return group.items.indexOf(a.item) - group.items.indexOf(b.item);
    });
    let items = kept.map((entry) => entry.item);
    const jdMatchedCount = items.length;
    const signal = kept.reduce((sum, entry) => sum + Math.min(entry.score, 100), 0);

    if (!mandatoryGroup) {
      // An optional category appears when the JD references it at all; a single
      // relevant item is enough to earn its place. Truly irrelevant categories
      // are dropped so the section stays on-target.
      if (jdMatchedCount < 1 && !groupHasMustHave(group, buckets)) {
        droppedGroups.push(id);
        continue;
      }
    }

    // Fill toward a fuller list: JD matched items first (already ordered above),
    // then continue from the group's own bank order up to the per-group target,
    // even for items the JD did not explicitly match. A group never renders with
    // fewer items than its bank holds, down to the target.
    const target = Math.min(group.items.length, Math.max(SKILL_LIMITS.targetItemsPerGroup, SKILL_LIMITS.minItemsPerGroup));
    for (const item of group.items) {
      if (items.length >= target) break;
      if (!items.includes(item)) items.push(item);
    }

    if (items.length > SKILL_LIMITS.maxItemsPerGroup) items = items.slice(0, SKILL_LIMITS.maxItemsPerGroup);
    if (items.length) (mandatoryGroup ? resolvedMandatory : resolvedOptional).push({ id, label: group.label, items, signal });
  }

  // Mandatory categories always appear (in canonical order). Optional
  // categories are ranked by JD signal and capped so the section stays clean.
  resolvedOptional.sort((a, b) => b.signal - a.signal);
  const optionalBudget = Math.max(0, SKILL_LIMITS.maxGroups - resolvedMandatory.length);
  for (const group of resolvedOptional.slice(optionalBudget)) droppedGroups.push(group.id);
  const resolved = [...resolvedMandatory, ...resolvedOptional.slice(0, optionalBudget)]
    .map(({ id, label, items }) => ({ id, label, items }));

  // The fuller-list total applies to JD-tailored resumes; the no-JD fixture path
  // keeps the legacy total so the sample render stays byte-identical.
  enforceTotalCap(resolved, jdMode ? SKILL_LIMITS : LEGACY_TOTAL_CAP);

  return {
    groups: resolved,
    selectedItems: resolved.flatMap((group) => group.items),
    droppedGroups,
  };
}

// Trims the section to the total-item ceiling, removing the weakest trailing
// non-mandatory items first and never dropping a category below its minimum or
// removing a mandatory skill item (AWS/Docker/Kubernetes).
function enforceTotalCap(resolved, limits = SKILL_LIMITS) {
  const total = () => resolved.reduce((sum, group) => sum + group.items.length, 0);
  let guard = 0;
  while (total() > limits.maxTotalItems && guard < 200) {
    guard += 1;
    // Largest group with removable slack loses its last item.
    let target = null;
    for (const group of resolved) {
      const mandatory = mandatoryItemsFor(group.id);
      const removable = group.items.filter((item) => !mandatory.has(String(item).toLowerCase()));
      if (removable.length === 0) continue;
      if (group.items.length <= limits.minItemsPerGroup) continue;
      if (!target || group.items.length > target.items.length) target = group;
    }
    if (!target) break;
    const mandatory = mandatoryItemsFor(target.id);
    for (let i = target.items.length - 1; i >= 0; i -= 1) {
      if (!mandatory.has(String(target.items[i]).toLowerCase())) {
        target.items.splice(i, 1);
        break;
      }
    }
  }
}

// JD technical skills that neither a rendered skill nor a selected bullet
// covers. Deterministic, alias-aware; feeds the mismatch warnings and must NOT
// be added to the resume (verified bank only).
export function missingJobSkills({ extraction, analysis, renderedSkills = [], bulletTexts = {} }) {
  const covered = [];
  for (const group of renderedSkills) {
    covered.push(`${group.label} ${group.items.join(" ")}`);
  }
  for (const text of Object.values(bulletTexts || {})) covered.push(String(text));
  const haystack = covered.join(" \n ");

  const terms = new Map();
  for (const keyword of extraction?.keywords || []) {
    if (keyword.category === "technical") terms.set(keyword.normalized, keyword.value || keyword.normalized);
  }
  for (const term of analysis?.mustHaveKeywords || []) terms.set(canonicalizeTerm(term), term);
  for (const term of analysis?.niceToHaveKeywords || []) terms.set(canonicalizeTerm(term), term);

  const missing = [];
  for (const [normalized, value] of terms) {
    if (!normalized) continue;
    if (!textContainsTerm(haystack, normalized)) missing.push(value);
  }
  return [...new Set(missing)];
}
