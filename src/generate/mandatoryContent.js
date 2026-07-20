// Deterministic personal-resume requirements for Vineet Agarwal.
//
// These are hard rules the LLM is never allowed to decide. The model may rank
// and rewrite bullets within these entries, but it may never remove an entry,
// a mandatory project, or a mandatory skill category. Enforced in code so a
// bad or adversarial model response cannot produce a resume that drops them.
//
// See PROJECT_CONTEXT.md sections 15-16 and the task Phase 1 requirements.

// Experience entries that must appear on every generated resume, each with at
// least one bullet. Ordered by page-reservation priority (Phase 8): when space
// is constrained these keep their single strongest bullet before any optional
// content is considered. Xelpmoc is the longest substantial professional role
// and is listed last only for ordering, never as "most droppable" -- no
// mandatory entry is ever dropped.
export const MANDATORY_EXPERIENCE_IDS = Object.freeze([
  "servbeyond-enterprise-ai-platform-intern", // ServBeyond Solutions
  "runara-ml-inference-engineer-intern", // Runara.ai
  "xelpmoc-software-engineer", // Xelpmoc Design and Tech
]);

// The one project that must appear on every resume. Locra is not duplicated
// into several projects; it is a single entry carrying multiple verified
// angles (on-device AI, offline/privacy, React Native/Android, local model
// storage, production mobile architecture).
export const MANDATORY_PROJECT_IDS = Object.freeze(["locra"]);

// Optional experience entries. Included only when relevance and space justify
// them, and never at the cost of a mandatory entry's bullet.
export const OPTIONAL_EXPERIENCE_IDS = Object.freeze([
  "svipes-software-engineer",
  "iiit-hyderabad-software-intern",
]);

// Mandatory skill categories, keyed to content-bank skillGroup ids. Every
// resume must include all of these regardless of the selected variant. The
// model may reorder technologies within a group and add relevant optional
// groups, but may not remove a mandatory group.
export const MANDATORY_SKILL_GROUP_IDS = Object.freeze([
  "applied-ai", // AI / LLM
  "languages", // Languages
  "backend", // Backend
  "frontend", // Frontend
  "cloud-devops", // Cloud and DevOps
]);

// Technologies that must be present inside their mandatory group. Matched
// case-insensitively against the group's items list.
export const MANDATORY_SKILL_ITEMS = Object.freeze({
  "cloud-devops": Object.freeze(["AWS", "Docker", "Kubernetes"]),
});

// Optional skill groups. Included only when their configured variants match
// the selected resume variant (Phase 7: filter by actual configured variants,
// do not allow unrelated groups merely because their ids exist).
export const OPTIONAL_SKILL_GROUP_IDS = Object.freeze([
  "databases",
  "llm-inference",
  "core-engineering",
]);

const MANDATORY_ENTRY_ID_SET = new Set([
  ...MANDATORY_EXPERIENCE_IDS,
  ...MANDATORY_PROJECT_IDS,
]);

export function isMandatoryEntry(entryId) {
  return MANDATORY_ENTRY_ID_SET.has(entryId);
}

export function isMandatorySkillGroup(groupId) {
  return MANDATORY_SKILL_GROUP_IDS.includes(groupId);
}

// Page-reservation ordering (Phase 8). Lower number reserves earlier. Mandatory
// experience first (in listed order), then the mandatory project, then optional
// content. Used to break ties and to decide trim order deterministically.
export function reservationRank(section, entryId) {
  const experienceIndex = MANDATORY_EXPERIENCE_IDS.indexOf(entryId);
  if (experienceIndex !== -1) return experienceIndex; // 0..N
  const projectIndex = MANDATORY_PROJECT_IDS.indexOf(entryId);
  if (projectIndex !== -1) return MANDATORY_EXPERIENCE_IDS.length + projectIndex;
  // Optional content sorts after all mandatory content.
  return 1000 + (section === "experience" ? 0 : 1);
}

// Returns the skillGroup ids that must appear for a given variant: all
// mandatory groups plus any requested/optional groups whose configured
// variants include the selected variant. Deterministic, order-preserving:
// mandatory groups first (in canonical order), then variant-eligible optional
// groups in bank order.
export function resolveSkillGroupIds(bank, requestedIds, variant) {
  const byId = new Map(bank.skillGroups.map((group) => [group.id, group]));
  const requested = new Set(requestedIds || []);
  const result = [];
  const seen = new Set();
  const push = (id) => {
    if (!id || seen.has(id) || !byId.has(id)) return;
    seen.add(id);
    result.push(id);
  };
  // Mandatory groups always, in canonical order.
  for (const id of MANDATORY_SKILL_GROUP_IDS) push(id);
  // Optional groups: include when requested AND variant-eligible, or when
  // variant-eligible even if not requested is NOT auto-added; we only add
  // requested ones that pass the variant filter. This honors "filter skill
  // groups by their actual configured variants".
  for (const group of bank.skillGroups) {
    if (seen.has(group.id)) continue;
    if (!requested.has(group.id)) continue;
    const variants = group.variants || [];
    if (variant && variants.length && !variants.includes(variant)) continue;
    push(group.id);
  }
  return result;
}

// Validates that a final skillGroup id list satisfies mandatory requirements.
// Returns { valid, errors }.
export function validateMandatorySkills(bank, skillGroupIds) {
  const errors = [];
  const byId = new Map(bank.skillGroups.map((group) => [group.id, group]));
  const present = new Set(skillGroupIds || []);
  for (const id of MANDATORY_SKILL_GROUP_IDS) {
    if (!present.has(id)) errors.push(`missing mandatory skill category '${id}'`);
  }
  for (const [groupId, items] of Object.entries(MANDATORY_SKILL_ITEMS)) {
    const group = byId.get(groupId);
    if (!group) {
      errors.push(`mandatory skill group '${groupId}' is absent from the bank`);
      continue;
    }
    const lowerItems = group.items.map((item) => item.toLowerCase());
    for (const required of items) {
      if (!lowerItems.includes(required.toLowerCase())) {
        errors.push(`mandatory skill group '${groupId}' must include '${required}'`);
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

// Deterministically injects the mandatory floor into a model selection. The
// model is schema-constrained to bullets tagged for the chosen variant, but
// some mandatory entries (e.g. Xelpmoc on an ai-llm resume) have no bullet for
// that variant, so the model literally cannot select them. Code therefore
// guarantees them: any missing mandatory entry is added with its strongest
// (lowest-priority-number) bullet, and skill groups are resolved to the
// mandatory-plus-variant set. Returns a new selection; does not mutate input.
export function ensureMandatoryContent(bank, selection, variant) {
  const cloneEntries = (list) =>
    (list || []).map((entry) => ({ ...entry, bullets: [...(entry.bullets || [])] }));
  const experience = cloneEntries(selection.experience);
  const projects = cloneEntries(selection.projects);

  const ensure = (list, section, ids) => {
    for (const id of ids) {
      const bankEntry = bank[section].find((entry) => entry.id === id);
      if (!bankEntry || !bankEntry.bullets.length) continue;
      const strongest = [...bankEntry.bullets].sort((a, b) => a.priority - b.priority)[0];
      const existing = list.find((entry) => entry.entryId === id);
      if (!existing) {
        list.push({ entryId: id, bullets: [{ id: strongest.id }] });
      } else if (!existing.bullets || existing.bullets.length === 0) {
        existing.bullets = [{ id: strongest.id }];
      }
    }
  };
  ensure(experience, "experience", MANDATORY_EXPERIENCE_IDS);
  ensure(projects, "projects", MANDATORY_PROJECT_IDS);

  return {
    ...selection,
    experience,
    projects,
    skillGroupIds: resolveSkillGroupIds(bank, selection.skillGroupIds, variant),
  };
}

// Validates that a final selection includes every mandatory experience entry,
// the mandatory project, and at least one bullet for each. Returns
// { valid, errors }.
export function validateMandatoryEntries(selection) {
  const errors = [];
  const bulletsFor = (section, id) => {
    const entry = (selection[section] || []).find((e) => e.entryId === id);
    return entry ? entry.bullets || [] : null;
  };
  for (const id of MANDATORY_EXPERIENCE_IDS) {
    const bullets = bulletsFor("experience", id);
    if (bullets === null) errors.push(`mandatory employer '${id}' is missing`);
    else if (bullets.length === 0) errors.push(`mandatory employer '${id}' has no bullets`);
  }
  for (const id of MANDATORY_PROJECT_IDS) {
    const bullets = bulletsFor("projects", id);
    if (bullets === null) errors.push(`mandatory project '${id}' is missing`);
    else if (bullets.length === 0) errors.push(`mandatory project '${id}' has no bullets`);
  }
  return { valid: errors.length === 0, errors };
}
