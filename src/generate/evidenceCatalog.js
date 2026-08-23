import { inventorySkills, skillClassification, skillEvidenceIds } from "./skillInventory.js";

const normalize = (value) => String(value || "").trim().toLowerCase();

export function skillEvidenceId(skill) {
  return `skill:${normalize(skill).replace(/[^a-z0-9+#.]+/g, "-").replace(/^-|-$/g, "")}`;
}

export function summaryEvidenceId(summaryId) {
  return `summary:${summaryId}`;
}

export function projectEvidenceId(projectId) {
  return `project:${projectId}`;
}

export function experienceEvidenceId(entryId) {
  return `experience:${entryId}`;
}

export function educationEvidenceId(educationId) {
  return `education:${educationId}`;
}

function summaryAlternatives(bank, base) {
  const values = [
    ...Object.entries(bank.summary?.byVariant || {}).map(([id, text]) => ({ id: summaryEvidenceId(`variant:${id}`), summaryId: `variant:${id}`, text })),
    ...Object.entries(bank.summary?.byEmphasis || {}).map(([id, text]) => ({ id: summaryEvidenceId(`emphasis:${id}`), summaryId: `emphasis:${id}`, text })),
  ];
  return values.filter((item) => item.text !== base.summary);
}

export function buildVerifiedEvidenceCatalog(bank, base) {
  const currentExperienceBulletIds = new Set(base.experience.flatMap((entry) => entry.bullets.map((bullet) => bullet.sourceBulletId)));
  const currentProjectIds = new Set(base.projects.map((project) => project.entryId));
  const currentProjectBulletIds = new Set(base.projects.flatMap((entry) => entry.bullets.map((bullet) => bullet.sourceBulletId)));
  const experienceById = new Map((bank.experience || []).map((entry) => [entry.id, entry]));
  const educationSource = (bank.education || []).find((entry) => entry.id === base.education?.educationId) || {};
  const education = {
    id: educationEvidenceId(base.education.educationId),
    educationId: base.education.educationId,
    degree: base.education.degree || educationSource.degree,
    field: String(base.education.degree || educationSource.degree || "").split(",").slice(1).join(",").trim(),
    institution: educationSource.school,
    dates: base.education.dates || educationSource.dates,
  };

  const experience = base.experience.map((entry) => ({
    id: experienceEvidenceId(entry.entryId),
    entryId: entry.entryId,
    bullets: entry.bullets.map((bullet) => ({ id: bullet.sourceBulletId, text: bullet.text })),
  }));
  const alternativeExperienceBullets = base.experience.flatMap((entry) => {
    const source = experienceById.get(entry.entryId);
    return (source?.bullets || [])
      .filter((bullet) => !currentExperienceBulletIds.has(bullet.id))
      .map((bullet) => ({ id: bullet.id, entryId: entry.entryId, text: bullet.text }));
  });
  const projects = base.projects.map((project) => ({
    id: projectEvidenceId(project.entryId),
    projectId: project.entryId,
    title: project.title,
    bullets: project.bullets.map((bullet) => ({ id: bullet.sourceBulletId, text: bullet.text })),
  }));
  const alternativeProjects = (bank.projects || [])
    .filter((project) => !currentProjectIds.has(project.id))
    .map((project) => ({
      id: projectEvidenceId(project.id), projectId: project.id, title: project.org, role: project.role,
      bullets: project.bullets.map((bullet) => ({ id: bullet.id, text: bullet.text })),
    }));
  const skills = inventorySkills(bank).map((skill) => ({
    id: skillEvidenceId(skill.name),
    skill: skill.name,
    groupIds: skill.groupIds,
  }));
  const handsOnEvidence = Object.fromEntries(skills.flatMap((skill) => {
    const evidenceIds = skillEvidenceIds(bank, skill.skill);
    return skillClassification(bank, skill.skill) === "hands-on" ? [[skill.id, evidenceIds]] : [];
  }));
  const currentSummaryId = summaryEvidenceId(`base:${base.id}`);
  const currentEvidenceIds = new Set([
    currentSummaryId,
    ...experience.map((entry) => entry.id),
    ...projects.map((project) => project.id),
    ...currentExperienceBulletIds,
    ...currentProjectBulletIds,
    ...base.skills.flatMap((group) => group.items.map(skillEvidenceId)),
    education.id,
  ]);
  const catalog = {
    version: 2,
    base: {
      id: base.id,
      summary: { id: currentSummaryId, text: base.summary },
      experience,
      projects,
      education,
      renderedSkills: base.skills.map((group) => ({ group: group.label, items: group.items.map((skill) => ({ id: skillEvidenceId(skill), skill })) })),
    },
    alternatives: {
      experienceBullets: alternativeExperienceBullets,
      projects: alternativeProjects,
      summaries: summaryAlternatives(bank, base),
      skills: { defaultClassification: "knowledge", inventory: skills, handsOnEvidence },
    },
  };
  return { catalog, currentEvidenceIds };
}

export function indexVerifiedEvidenceCatalog(catalog) {
  const evidence = new Map();
  const add = (id, value, kind, current = false) => evidence.set(id, { id, value, kind, current });
  add(catalog.base.summary.id, catalog.base.summary, "summary", true);
  add(catalog.base.education.id, catalog.base.education, "education", true);
  for (const entry of catalog.base.experience) {
    add(entry.id, entry, "experience", true);
    for (const bullet of entry.bullets) add(bullet.id, { ...bullet, entryId: entry.entryId }, "experience-bullet", true);
  }
  for (const project of catalog.base.projects) {
    add(project.id, project, "project", true);
    for (const bullet of project.bullets) add(bullet.id, { ...bullet, projectId: project.projectId }, "project-bullet", true);
  }
  for (const group of catalog.base.renderedSkills) for (const skill of group.items) add(skill.id, skill, "skill", true);
  for (const bullet of catalog.alternatives.experienceBullets) add(bullet.id, bullet, "experience-bullet");
  for (const project of catalog.alternatives.projects) {
    add(project.id, project, "project");
    for (const bullet of project.bullets) add(bullet.id, { ...bullet, projectId: project.projectId }, "project-bullet");
  }
  for (const summary of catalog.alternatives.summaries) add(summary.id, summary, "summary");
  for (const skill of catalogSkillInventory(catalog)) add(skill.id, skill, "skill", Boolean(evidence.get(skill.id)?.current));
  return evidence;
}

export function catalogSkillInventory(catalog) {
  const source = catalog?.alternatives?.skills || {};
  return (source.inventory || []).map((skill) => ({
    ...skill,
    classification: Object.hasOwn(source.handsOnEvidence || {}, skill.id) ? "hands-on" : source.defaultClassification,
    evidenceIds: source.handsOnEvidence?.[skill.id] || [],
  }));
}
