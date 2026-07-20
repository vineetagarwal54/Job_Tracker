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
  const allowedSkillItems = [...new Set(bank.skillGroups.flatMap((group) => group.items))];
  const variantBulletRef = { type: "object", additionalProperties: false, properties: { id: { type: "string", enum: allowedBulletIds }, rewrittenText: { type: "string" }, justification: { type: "string" } }, required: ["id"] };
  const entryRefFor = (entryIds) => ({ type: "object", additionalProperties: false, properties: { entryId: { type: "string", enum: entryIds }, bullets: { type: "array", minItems: 1, items: variantBulletRef } }, required: ["entryId", "bullets"] });
  const skillsRef = { type: "array", items: { type: "object", additionalProperties: false, properties: { groupId: { type: "string", enum: allowedSkillGroupIds }, items: { type: "array", items: { type: "string", enum: allowedSkillItems } } }, required: ["groupId", "items"] } };
  return { type: "object", additionalProperties: false, properties: { version: { type: "integer", enum: [1] }, variant: { type: "string", enum: [variant] }, educationId: { type: "string", enum: allowedEducationIds }, skillGroupIds: { type: "array", minItems: 1, items: { type: "string", enum: allowedSkillGroupIds } }, skills: skillsRef, experience: { type: "array", items: entryRefFor(experienceEntryIds) }, projects: { type: "array", items: entryRefFor(projectEntryIds) } }, required: ["version", "variant", "educationId", "skillGroupIds", "experience", "projects"] };
}

async function generateResumeSelection({ client, apiKey, bank, job, analysis, extraction, coverage, variant, emphasis = null, emphases = null, signal, generateDir, progress }) {
  progress?.("Ranking verified experience");
  const { identity: _committedIdentity, ...promptBank } = bank;
  const stable = `${SELECTION_SYSTEM}\nCONTENT BANK:\n${JSON.stringify(promptBank)}`;
  const dynamic = JSON.stringify({ job, analysis, deterministicKeywords: extraction, preliminaryCoverage: coverage, selectedVariant: variant, instruction: "Return about 18 ranked bullets. Select only bullets tagged for the selected variant. For any bullet you rewrite, include 'justification' naming the exact job-description term or responsibility that motivated the change; cosmetic rewrites without a JD justification are reverted to the verified original. Also return 'skills': for each relevant skillGroup, list the specific individual items (copied verbatim from that group's verified items only) that the job description calls for, ordered by importance. Never invent a skill and never copy an item into a group it does not belong to; deterministic code enforces mandatory categories and items." });
  const response = await client.request({ apiKey, signal, stream: true, timeoutMs: 240000, body: { model: MODEL, max_tokens: 16000, system: [{ type: "text", text: stable, cache_control: { type: "ephemeral" } }], output_config: { format: { type: "json_schema", schema: selectionSchemaForVariant(bank, variant) } }, messages: [{ role: "user", content: dynamic }] } });
  progress?.("Rewriting selected bullets");
  let selection = canonicalizeSelection(bank, parseJsonText(response.text, "Sonnet selection", { stopReason: response.stopReason }), variant);
  if (selection.variant !== variant) throw Object.assign(new Error(`Sonnet returned variant '${selection.variant}' instead of '${variant}'.`), { code: "VALIDATION_FAILED" });
  const bulletIndex = new Map([...bank.experience, ...bank.projects].flatMap((entry) => entry.bullets.map((bullet) => [bullet.id, bullet])));
  for (const item of [...(selection.experience || []), ...(selection.projects || [])].flatMap((entry) => entry.bullets || [])) {
    const bullet = bulletIndex.get(item.id); if (bullet && !bullet.variants.includes(variant)) throw Object.assign(new Error(`Sonnet selected cross-variant bullet '${item.id}' without permission.`), { code: "VALIDATION_FAILED" });
  }
  const { finalizeSelection } = await import(pathToFileURL(path.join(generateDir, "finalizeSelection.js")).href);
  // Deterministically inject the mandatory floor, drop exploratory projects,
  // revert invalid rewrites, resolve individual JD-specific skills, and fit the
  // one-page budget. Shared with the deterministic fallback path so both
  // produce identically validated selections.
  const finalized = finalizeSelection(bank, selection, { variant, extraction, analysis, emphasis, emphases });
  progress?.("Validating factual claims");
  return { selection: finalized.selection, finalSelection: finalized.finalSelection, budget: finalized.budget, usage: response.usage || null, cacheUsage: response.usage ? { cacheCreationInputTokens: response.usage.cache_creation_input_tokens ?? null, cacheReadInputTokens: response.usage.cache_read_input_tokens ?? null } : null, model: MODEL, usedFallback: false };
}
module.exports = { MODEL, SELECTION_SCHEMA, selectionSchemaForVariant, generateResumeSelection };
