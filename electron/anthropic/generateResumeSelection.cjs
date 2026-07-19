const path = require("path"); const { pathToFileURL } = require("url"); const { SELECTION_SYSTEM } = require("./prompts.cjs"); const { parseJsonText } = require("./validation.cjs");
const MODEL = "claude-sonnet-5";
const bulletRef = { type: "object", additionalProperties: false, properties: { id: { type: "string" }, rewrittenText: { type: "string" } }, required: ["id"] };
const entryRef = { type: "object", additionalProperties: false, properties: { entryId: { type: "string" }, bullets: { type: "array", items: bulletRef } }, required: ["entryId", "bullets"] };
const SELECTION_SCHEMA = { type: "object", additionalProperties: false, properties: { version: { type: "integer", enum: [1] }, variant: { type: "string", enum: ["ai-llm", "cloud-backend", "fullstack", "mobile", "academic"] }, educationId: { type: "string" }, skillGroupIds: { type: "array", items: { type: "string" } }, experience: { type: "array", items: entryRef }, projects: { type: "array", items: entryRef } }, required: ["version", "variant", "educationId", "skillGroupIds", "experience", "projects"] };

async function generateResumeSelection({ client, apiKey, bank, job, analysis, extraction, coverage, variant, signal, generateDir, progress }) {
  progress?.("Ranking verified experience");
  const { identity: _committedIdentity, ...promptBank } = bank;
  const stable = `${SELECTION_SYSTEM}\nCONTENT BANK:\n${JSON.stringify(promptBank)}`;
  const dynamic = JSON.stringify({ job, analysis, deterministicKeywords: extraction, preliminaryCoverage: coverage, selectedVariant: variant, instruction: "Return about 18 ranked bullets. Select only bullets tagged for the selected variant." });
  const response = await client.request({ apiKey, signal, stream: true, body: { model: MODEL, max_tokens: 7000, system: [{ type: "text", text: stable, cache_control: { type: "ephemeral" } }], output_config: { format: { type: "json_schema", schema: SELECTION_SCHEMA } }, messages: [{ role: "user", content: dynamic }] } });
  progress?.("Validating selected bullets");
  const selection = parseJsonText(response.text, "Sonnet selection");
  const bulletIndex = new Map([...bank.experience, ...bank.projects].flatMap((entry) => entry.bullets.map((bullet) => [bullet.id, bullet])));
  for (const item of [...(selection.experience || []), ...(selection.projects || [])].flatMap((entry) => entry.bullets || [])) {
    const bullet = bulletIndex.get(item.id); if (bullet && !bullet.variants.includes(variant)) throw new Error(`Sonnet selected cross-variant bullet '${item.id}' without permission.`);
  }
  const [{ validateSelection }, { budgetSelection }] = await Promise.all([import(pathToFileURL(path.join(generateDir, "validateSelection.js")).href), import(pathToFileURL(path.join(generateDir, "lineBudget.js")).href)]);
  const validated = validateSelection(bank, selection, { requireUniqueActionVerbs: false }); const budget = budgetSelection(validated);
  const includedIds = new Set(budget.included.flatMap((entry) => entry.bullets.map((item) => item.bullet.id)));
  const finalSelection = { ...selection, experience: selection.experience.map((entry) => ({ ...entry, bullets: entry.bullets.filter((item) => includedIds.has(item.id)) })).filter((entry) => entry.bullets.length), projects: selection.projects.map((entry) => ({ ...entry, bullets: entry.bullets.filter((item) => includedIds.has(item.id)) })).filter((entry) => entry.bullets.length) };
  validateSelection(bank, finalSelection, { requireUniqueActionVerbs: true });
  progress?.("Preparing final selection");
  return { selection, finalSelection, budget, usage: response.usage || null, cacheUsage: response.usage ? { cacheCreationInputTokens: response.usage.cache_creation_input_tokens ?? null, cacheReadInputTokens: response.usage.cache_read_input_tokens ?? null } : null, model: MODEL };
}
module.exports = { MODEL, SELECTION_SCHEMA, generateResumeSelection };
