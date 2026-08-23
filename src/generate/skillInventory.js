import { canonicalizeTerm, textContainsTerm } from "./protectedTerms.js";

const normalize = (value) => String(value || "").trim().toLowerCase();

export function inventorySkills(bank) {
  const byName = new Map();
  for (const group of bank.skillGroups || []) for (const item of group.items || []) {
    const key = normalize(item);
    if (!byName.has(key)) byName.set(key, { name: item, groupIds: [] });
    byName.get(key).groupIds.push(group.id);
  }
  return [...byName.values()];
}

function evidenceMap(bank) {
  return new Map(Object.entries(bank.skillMetadata?.handsOnEvidence || {}).map(([name, ids]) => [normalize(name), [...new Set(ids || [])]]));
}

export function skillClassification(bank, item) {
  return evidenceMap(bank).has(normalize(item)) ? "hands-on" : bank.skillMetadata?.defaultClassification || "knowledge";
}

export function skillEvidenceIds(bank, item) {
  return evidenceMap(bank).get(normalize(item)) || [];
}

export function isHandsOnSkill(bank, item) {
  return skillClassification(bank, item) === "hands-on";
}

export function inventorySkillForTerm(bank, term) {
  const canonical = canonicalizeTerm(term);
  return inventorySkills(bank).find((skill) => canonicalizeTerm(skill.name) === canonical)
    || inventorySkills(bank).find((skill) => textContainsTerm(skill.name, canonical));
}

export function skillClassificationForTerm(bank, term) {
  const skill = inventorySkillForTerm(bank, term);
  return skill ? skillClassification(bank, skill.name) : null;
}

export function classifyRenderedSkills(bank, renderedSkills = []) {
  return renderedSkills.map((group) => ({
    ...group,
    items: (group.items || []).map((item) => ({ item, classification: skillClassification(bank, item), evidenceIds: skillEvidenceIds(bank, item) })),
  }));
}

export function validateSkillInventory(bank) {
  const skills = inventorySkills(bank);
  const skillNames = new Set(skills.map((skill) => normalize(skill.name)));
  const bullets = new Set([...(bank.experience || []), ...(bank.projects || [])].flatMap((entry) => entry.bullets || []).map((bullet) => bullet.id));
  const errors = [];
  if (bank.skillMetadata?.defaultClassification !== "knowledge") errors.push("Unproven skills must default to knowledge.");
  for (const [name, ids] of Object.entries(bank.skillMetadata?.handsOnEvidence || {})) {
    if (!skillNames.has(normalize(name))) errors.push(`Hands-on skill '${name}' is absent from skillGroups.`);
    if (!Array.isArray(ids) || !ids.length) errors.push(`Hands-on skill '${name}' has no evidence IDs.`);
    for (const id of ids || []) if (!bullets.has(id)) errors.push(`Hands-on skill '${name}' references unknown evidence '${id}'.`);
  }
  const forbidden = skills.filter((skill) => ["unity", "webgl"].includes(normalize(skill.name))).map((skill) => skill.name);
  if (forbidden.length) errors.push(`Excluded skills are present: ${forbidden.join(", ")}.`);
  const handsOn = skills.filter((skill) => isHandsOnSkill(bank, skill.name));
  return { valid: errors.length === 0, errors, total: skills.length, handsOn: handsOn.length, knowledge: skills.length - handsOn.length, skills };
}
