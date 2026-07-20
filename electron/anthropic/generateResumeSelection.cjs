const path = require("path"); const { pathToFileURL } = require("url"); const { SELECTION_SYSTEM } = require("./prompts.cjs"); const { parseJsonText } = require("./validation.cjs");
const { MODELS } = require("./models.cjs");
const MODEL = MODELS.writing;
const bulletRef = { type: "object", additionalProperties: false, properties: { id: { type: "string" }, rewrittenText: { type: "string" } }, required: ["id"] };
const entryRef = { type: "object", additionalProperties: false, properties: { entryId: { type: "string" }, bullets: { type: "array", items: bulletRef } }, required: ["entryId", "bullets"] };
const SELECTION_SCHEMA = { type: "object", additionalProperties: false, properties: { version: { type: "integer", enum: [1] }, variant: { type: "string", enum: ["ai-llm", "cloud-backend", "fullstack", "mobile", "academic"] }, educationId: { type: "string" }, skillGroupIds: { type: "array", items: { type: "string" } }, experience: { type: "array", items: entryRef }, projects: { type: "array", items: entryRef } }, required: ["version", "variant", "educationId", "skillGroupIds", "experience", "projects"] };

function canonicalValue(value, allowed) {
  if (typeof value !== "string") return value;
  return allowed.find((candidate) => candidate.toLowerCase() === value.toLowerCase()) || value;
}

function canonicalizeSelection(bank, selection, variant) {
  const educationIds = bank.education.map((item) => item.id);
  const skillGroupIds = bank.skillGroups.map((item) => item.id);
  const entryIds = {
    experience: bank.experience.map((item) => item.id),
    projects: bank.projects.map((item) => item.id),
  };
  const bulletIds = [...bank.experience, ...bank.projects].flatMap((entry) => entry.bullets.map((bullet) => bullet.id));
  const normalizeEntries = (section) => Array.isArray(selection?.[section]) ? selection[section].map((entry) => ({
    ...entry,
    entryId: canonicalValue(entry.entryId, entryIds[section]),
    bullets: Array.isArray(entry.bullets) ? entry.bullets.map((bullet) => ({ ...bullet, id: canonicalValue(bullet.id, bulletIds) })) : entry.bullets,
  })) : selection?.[section];
  return {
    ...selection,
    variant: canonicalValue(selection?.variant, [variant]),
    educationId: canonicalValue(selection?.educationId, educationIds),
    skillGroupIds: Array.isArray(selection?.skillGroupIds) ? selection.skillGroupIds.map((id) => canonicalValue(id, skillGroupIds)) : selection?.skillGroupIds,
    experience: normalizeEntries("experience"),
    projects: normalizeEntries("projects"),
  };
}

function selectionSchemaForVariant(bank, variant) {
  const allowedBulletIds = [...bank.experience, ...bank.projects]
    .flatMap((entry) => entry.bullets)
    .filter((bullet) => bullet.variants.includes(variant))
    .map((bullet) => bullet.id);
  const allowedEducationIds = bank.education.filter((item) => !item.variants || item.variants.includes(variant)).map((item) => item.id);
  const allowedSkillGroupIds = bank.skillGroups.map((group) => group.id);
  const experienceEntryIds = bank.experience.filter((entry) => entry.bullets.some((bullet) => bullet.variants.includes(variant))).map((entry) => entry.id);
  const projectEntryIds = bank.projects.filter((entry) => entry.bullets.some((bullet) => bullet.variants.includes(variant))).map((entry) => entry.id);
  const variantBulletRef = { type: "object", additionalProperties: false, properties: { id: { type: "string", enum: allowedBulletIds }, rewrittenText: { type: "string" } }, required: ["id"] };
  const entryRefFor = (entryIds) => ({ type: "object", additionalProperties: false, properties: { entryId: { type: "string", enum: entryIds }, bullets: { type: "array", minItems: 1, items: variantBulletRef } }, required: ["entryId", "bullets"] });
  return { type: "object", additionalProperties: false, properties: { version: { type: "integer", enum: [1] }, variant: { type: "string", enum: [variant] }, educationId: { type: "string", enum: allowedEducationIds }, skillGroupIds: { type: "array", minItems: 1, items: { type: "string", enum: allowedSkillGroupIds } }, experience: { type: "array", items: entryRefFor(experienceEntryIds) }, projects: { type: "array", items: entryRefFor(projectEntryIds) } }, required: ["version", "variant", "educationId", "skillGroupIds", "experience", "projects"] };
}

async function generateResumeSelection({ client, apiKey, bank, job, analysis, extraction, coverage, variant, signal, generateDir, progress }) {
  progress?.("Ranking verified experience");
  const { identity: _committedIdentity, ...promptBank } = bank;
  const stable = `${SELECTION_SYSTEM}\nCONTENT BANK:\n${JSON.stringify(promptBank)}`;
  const dynamic = JSON.stringify({ job, analysis, deterministicKeywords: extraction, preliminaryCoverage: coverage, selectedVariant: variant, instruction: "Return about 18 ranked bullets. Select only bullets tagged for the selected variant." });
  const response = await client.request({ apiKey, signal, stream: true, timeoutMs: 240000, body: { model: MODEL, max_tokens: 10000, system: [{ type: "text", text: stable, cache_control: { type: "ephemeral" } }], output_config: { format: { type: "json_schema", schema: selectionSchemaForVariant(bank, variant) } }, messages: [{ role: "user", content: dynamic }] } });
  progress?.("Rewriting selected bullets");
  const selection = canonicalizeSelection(bank, parseJsonText(response.text, "Sonnet selection", { stopReason: response.stopReason }), variant);
  if (selection.variant !== variant) throw Object.assign(new Error(`Sonnet returned variant '${selection.variant}' instead of '${variant}'.`), { code: "VALIDATION_FAILED" });
  const bulletIndex = new Map([...bank.experience, ...bank.projects].flatMap((entry) => entry.bullets.map((bullet) => [bullet.id, bullet])));
  for (const item of [...(selection.experience || []), ...(selection.projects || [])].flatMap((entry) => entry.bullets || [])) {
    const bullet = bulletIndex.get(item.id); if (bullet && !bullet.variants.includes(variant)) throw Object.assign(new Error(`Sonnet selected cross-variant bullet '${item.id}' without permission.`), { code: "VALIDATION_FAILED" });
  }
  const [{ validateSelection }, { budgetSelection }] = await Promise.all([import(pathToFileURL(path.join(generateDir, "validateSelection.js")).href), import(pathToFileURL(path.join(generateDir, "lineBudget.js")).href)]);
  let validated;
  try { validated = validateSelection(bank, selection, { requireUniqueActionVerbs: false }); }
  catch (error) { error.code = error.code || "VALIDATION_FAILED"; throw error; }
  let budget;
  try { budget = budgetSelection(validated); }
  catch (error) { error.code = error.code || "VALIDATION_FAILED"; throw error; }
  const includedIds = new Set(budget.included.flatMap((entry) => entry.bullets.map((item) => item.bullet.id)));
  const finalSelection = { ...selection, experience: selection.experience.map((entry) => ({ ...entry, bullets: entry.bullets.filter((item) => includedIds.has(item.id)) })).filter((entry) => entry.bullets.length), projects: selection.projects.map((entry) => ({ ...entry, bullets: entry.bullets.filter((item) => includedIds.has(item.id)) })).filter((entry) => entry.bullets.length) };
  try { validateSelection(bank, finalSelection, { requireUniqueActionVerbs: true }); }
  catch (error) { error.code = error.code || "VALIDATION_FAILED"; throw error; }
  progress?.("Validating factual claims");
  return { selection, finalSelection, budget, usage: response.usage || null, cacheUsage: response.usage ? { cacheCreationInputTokens: response.usage.cache_creation_input_tokens ?? null, cacheReadInputTokens: response.usage.cache_read_input_tokens ?? null } : null, model: MODEL };
}
module.exports = { MODEL, SELECTION_SCHEMA, selectionSchemaForVariant, generateResumeSelection };
