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

function validateBulletText(bullet, text) {
  for (const metric of bullet.lockedMetrics) {
    if (!text.includes(metric)) fail(`rewrite of '${bullet.id}' removed locked metric '${metric}'`);
  }
  if (!bullet.rewritable && text !== bullet.text) fail(`'${bullet.id}' is not rewritable`);
  const sourceNumbers = numbersIn(bullet.text);
  for (const number of numbersIn(text)) {
    if (!sourceNumbers.has(number)) fail(`rewrite of '${bullet.id}' introduced number '${number}'`);
  }
  for (const pattern of FORBIDDEN_CLAIM_PATTERNS) {
    if (pattern.test(text)) fail(`'${bullet.id}' contains a forbidden CUDA-authoring claim`);
  }
}

function actionVerb(text) {
  const match = text.trim().match(/^([A-Za-z]+)/);
  return match ? match[1].toLowerCase() : "";
}

export function validateSelection(bank, selection, options = {}) {
  const { requireUniqueActionVerbs = true } = options;
  assertKnownFields(selection, ["version", "variant", "educationId", "skillGroupIds", "experience", "projects"], "selection");
  if (selection.version !== 1) fail("version must be 1");
  if (!VARIANT_IDS.has(selection.variant)) fail(`unknown variant '${selection.variant}'`);
  if (!Array.isArray(bank.education) || !bank.education.some((education) => education.id === selection.educationId)) fail(`unknown education '${selection.educationId}'`);
  if (!Array.isArray(selection.skillGroupIds) || selection.skillGroupIds.length === 0) fail("skillGroupIds must be a non-empty array");
  const skillIds = new Set(bank.skillGroups.map((group) => group.id));
  for (const id of selection.skillGroupIds) if (!skillIds.has(id)) fail(`unknown skill group '${id}'`);

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
        assertKnownFields(selectedBullet, ["id", "rewrittenText"], `${selectedEntry.entryId} bullet`);
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
