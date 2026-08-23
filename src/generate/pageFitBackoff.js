const clone = (value) => JSON.parse(JSON.stringify(value));

function contentCharacters(base) {
  const values = [base.summary];
  for (const group of base.skills || []) values.push(group.label, ...(group.items || []));
  for (const section of ["experience", "projects"]) for (const entry of base[section] || []) {
    values.push(entry.title, entry.role, entry.dates);
    for (const bullet of entry.bullets || []) values.push(bullet.text);
  }
  values.push(base.education?.degree, base.education?.dates, base.education?.gpa, ...(base.education?.notes || []));
  return values.join(" ").replace(/\s+/g, "").length;
}

function fail(code, message) { throw Object.assign(new Error(message), { code }); }

export function validateBaseProtections(canonicalBase, candidate) {
  if (!candidate || candidate.id !== canonicalBase.id || candidate.variant !== canonicalBase.variant) fail("BASE_STRUCTURE_VIOLATION", "Tailored resume no longer targets its canonical base.");
  if (!candidate.summary || !Array.isArray(candidate.skills) || candidate.skills.length !== canonicalBase.skills.length) fail("BASE_STRUCTURE_VIOLATION", "Tailoring changed protected summary or skill-section structure.");
  if (JSON.stringify(candidate.education) !== JSON.stringify(canonicalBase.education)) fail("BASE_STRUCTURE_VIOLATION", "Tailoring changed protected education content.");
  if (candidate.experience?.length !== canonicalBase.experience.length || candidate.projects?.length !== canonicalBase.projects.length) fail("BASE_STRUCTURE_VIOLATION", "Tailoring changed protected experience or project counts.");
  for (let index = 0; index < canonicalBase.skills.length; index += 1) {
    const original = canonicalBase.skills[index]; const current = candidate.skills[index];
    if (current?.label !== original.label || current.items.length < original.items.length) fail("BASE_STRUCTURE_VIOLATION", "Tailoring removed a protected skill category or item.");
  }
  for (let index = 0; index < canonicalBase.experience.length; index += 1) {
    const original = canonicalBase.experience[index]; const current = candidate.experience[index];
    const originalHeading = { entryId: original.entryId, title: original.title, role: original.role, dates: original.dates, location: original.location };
    const currentHeading = { entryId: current?.entryId, title: current?.title, role: current?.role, dates: current?.dates, location: current?.location };
    if (JSON.stringify(currentHeading) !== JSON.stringify(originalHeading) || current.bullets.length !== original.bullets.length) fail("BASE_STRUCTURE_VIOLATION", "Tailoring changed a protected experience or bullet count.");
  }
  for (let index = 0; index < canonicalBase.projects.length; index += 1) {
    const original = canonicalBase.projects[index]; const current = candidate.projects[index];
    if (!current || current.bullets.length !== original.bullets.length) fail("BASE_STRUCTURE_VIOLATION", "Tailoring changed a protected project or project bullet count.");
  }
  const densityRatio = contentCharacters(candidate) / Math.max(1, contentCharacters(canonicalBase));
  if (densityRatio < 0.85) fail("BASE_DENSITY_VIOLATION", `Tailored resume density fell to ${densityRatio.toFixed(3)} of its canonical base.`);
  return { densityRatio, bulletCount: [...candidate.experience, ...candidate.projects].reduce((sum, entry) => sum + entry.bullets.length, 0) };
}

function gainFor(change, relevancePlan) {
  return relevancePlan?.candidates?.find((candidate) => candidate.id === change?.candidateId)?.expectedGain ?? 0;
}

export function buildTailoringBackoffQueue(acceptedDiff, relevancePlan) {
  const actions = [];
  for (const [index, change] of (acceptedDiff?.bulletChanges || []).entries()) actions.push({ kind: change.type === "rewrite" ? "rewrite" : "bullet", index, change: clone(change), relevanceGain: gainFor(change, relevancePlan) });
  for (const [index, change] of (acceptedDiff?.skillChanges || []).entries()) actions.push({ kind: "skill", index, change: clone(change), relevanceGain: gainFor(change, relevancePlan) });
  if (acceptedDiff?.projectSwap) actions.push({ kind: "project", index: 0, change: clone(acceptedDiff.projectSwap), relevanceGain: gainFor(acceptedDiff.projectSwap, relevancePlan) });
  if (acceptedDiff?.summaryChange) actions.push({ kind: "summary", index: 0, change: clone(acceptedDiff.summaryChange), relevanceGain: gainFor(acceptedDiff.summaryChange, relevancePlan) });
  const order = { rewrite: 0, skill: 1, bullet: 2, project: 3, summary: 4 };
  return actions.sort((left, right) => order[left.kind] - order[right.kind] || left.relevanceGain - right.relevanceGain || left.index - right.index);
}

function revertAction(current, canonicalBase, action) {
  const next = clone(current);
  if (action.kind === "summary") next.summary = canonicalBase.summary;
  else if (action.kind === "project") {
    const slot = canonicalBase.projects.findIndex((project) => project.entryId === action.change.baseProjectId);
    if (slot >= 0) next.projects[slot] = clone(canonicalBase.projects[slot]);
  } else if (action.kind === "skill") {
    const originalGroup = canonicalBase.skills.find((group) => group.label.toLowerCase() === String(action.change.groupLabel || "").toLowerCase());
    const groupIndex = canonicalBase.skills.indexOf(originalGroup);
    if (groupIndex >= 0) {
      const group = next.skills[groupIndex];
      if (action.change.type === "add") group.items = group.items.filter((item) => item.toLowerCase() !== String(action.change.replacementItem || "").toLowerCase());
      else {
        const itemIndex = group.items.findIndex((item) => item.toLowerCase() === String(action.change.replacementItem || "").toLowerCase());
        if (itemIndex >= 0) group.items[itemIndex] = action.change.baseItem;
      }
    }
  } else {
    const entryIndex = canonicalBase.experience.findIndex((entry) => entry.entryId === action.change.entryId);
    const bulletIndex = canonicalBase.experience[entryIndex]?.bullets.findIndex((bullet) => bullet.sourceBulletId === action.change.baseBulletId) ?? -1;
    if (entryIndex >= 0 && bulletIndex >= 0) next.experience[entryIndex].bullets[bulletIndex] = clone(canonicalBase.experience[entryIndex].bullets[bulletIndex]);
  }
  return next;
}

function removeAcceptedAction(acceptedDiff, action) {
  const next = clone(acceptedDiff);
  if (action.kind === "summary") next.summaryChange = null;
  else if (action.kind === "project") next.projectSwap = null;
  else if (action.kind === "skill") next.skillChanges = next.skillChanges.filter((change) => change.candidateId !== action.change.candidateId);
  else next.bulletChanges = next.bulletChanges.filter((change) => change.candidateId !== action.change.candidateId);
  return next;
}

function sameBase(left, right) { return JSON.stringify(left) === JSON.stringify(right); }

export async function fitTailoredBaseToOnePage({ canonicalBase, tailoredBase, acceptedDiff, relevancePlan, renderAndCompile }) {
  let current = clone(tailoredBase);
  let remainingDiff = clone(acceptedDiff);
  validateBaseProtections(canonicalBase, current);
  const attempts = [];
  const backedOff = [];
  const compile = async (reason) => {
    const result = await renderAndCompile(current, { attempt: attempts.length + 1, reason });
    attempts.push({ attempt: attempts.length + 1, reason, pageCount: result.pageCount });
    return result;
  };
  let result = await compile("accepted-tailoring");
  if (result.pageCount === 1) return { base: current, acceptedDiff: remainingDiff, backedOff, attempts, pageCount: 1, result, ...validateBaseProtections(canonicalBase, current) };

  for (const action of buildTailoringBackoffQueue(acceptedDiff, relevancePlan)) {
    current = revertAction(current, canonicalBase, action);
    remainingDiff = removeAcceptedAction(remainingDiff, action);
    validateBaseProtections(canonicalBase, current);
    backedOff.push({ type: action.kind, candidateId: action.change.candidateId || null, requirementIds: [...(action.change.requirementIds || [])], relevanceGain: action.relevanceGain, resolution: "reverted", reason: "page-overflow" });
    result = await compile(`reverted-${action.kind}`);
    if (result.pageCount === 1) return { base: current, acceptedDiff: remainingDiff, backedOff, attempts, pageCount: 1, result, ...validateBaseProtections(canonicalBase, current) };
  }

  if (!sameBase(current, canonicalBase)) {
    current = clone(canonicalBase);
    remainingDiff = { version: 1, summaryChange: null, bulletChanges: [], projectSwap: null, skillChanges: [] };
    validateBaseProtections(canonicalBase, current);
    result = await compile("unchanged-canonical-base");
  }
  if (result.pageCount !== 1) fail("BASE_VALIDATION_FAILED", `Canonical base '${canonicalBase.id}' compiled to ${result.pageCount || "an unknown number of"} pages; tailoring backoff cannot alter base content.`);
  return { base: current, acceptedDiff: remainingDiff, backedOff, attempts, pageCount: 1, result, ...validateBaseProtections(canonicalBase, current) };
}
