const path = require("path");
const { pathToFileURL } = require("url");
const { SELECTION_SYSTEM } = require("./prompts.cjs");
const { parseJsonText } = require("./validation.cjs");
const { MODELS } = require("./models.cjs");

const MODEL = MODELS.writing;

function summaryIds(bank) {
  return [
    ...Object.keys(bank.summary?.byVariant || {}).map((key) => `variant:${key}`),
    ...Object.keys(bank.summary?.byEmphasis || {}).map((key) => `emphasis:${key}`),
  ];
}

function tailoringDiffSchema(bank, base) {
  const baseExperienceIds = base.experience.map((entry) => entry.entryId);
  const baseBulletIds = base.experience.flatMap((entry) => entry.bullets.map((bullet) => bullet.sourceBulletId));
  const experienceBulletIds = bank.experience.flatMap((entry) => entry.bullets.map((bullet) => bullet.id));
  const baseProjectIds = base.projects.map((project) => project.entryId);
  const replacementProjectIds = bank.projects.map((project) => project.id).filter((id) => !baseProjectIds.includes(id));
  const baseSkillLabels = base.skills.map((group) => group.label);
  const baseSkillItems = base.skills.flatMap((group) => group.items);
  const verifiedSkillItems = [...new Set(bank.skillGroups.flatMap((group) => group.items))];
  return {
    type: "object", additionalProperties: false,
    properties: {
      version: { type: "integer", enum: [1] },
      baseResumeId: { type: "string", enum: [base.id] },
      summaryChange: { type: "object", additionalProperties: false, properties: { summaryId: { type: "string", enum: summaryIds(bank) }, justification: { type: "string" } }, required: ["summaryId", "justification"] },
      bulletChanges: { type: "array", maxItems: 3, items: { type: "object", additionalProperties: false, properties: { type: { type: "string", enum: ["swap", "rewrite"] }, entryId: { type: "string", enum: baseExperienceIds }, baseBulletId: { type: "string", enum: baseBulletIds }, replacementBulletId: { type: "string", enum: experienceBulletIds }, rewrittenText: { type: "string" }, justification: { type: "string" } }, required: ["type", "entryId", "baseBulletId", "justification"] } },
      projectSwap: { type: "object", additionalProperties: false, properties: { baseProjectId: { type: "string", enum: baseProjectIds }, replacementProjectId: { type: "string", enum: replacementProjectIds }, justification: { type: "string" } }, required: ["baseProjectId", "replacementProjectId", "justification"] },
      skillChanges: { type: "array", maxItems: 4, items: { type: "object", additionalProperties: false, properties: { type: { type: "string", enum: ["add", "swap"] }, groupLabel: { type: "string", enum: baseSkillLabels }, baseItem: { type: "string", enum: baseSkillItems }, replacementItem: { type: "string", enum: verifiedSkillItems }, justification: { type: "string" } }, required: ["type", "groupLabel", "replacementItem", "justification"] } },
    },
    required: ["version", "baseResumeId", "bulletChanges", "skillChanges"],
  };
}

async function generateResumeSelection({ client, apiKey, bank, canonicalBases, base, job, analysis, extraction, coverage, signal, generateDir, progress }) {
  progress?.("Proposing minimal base-resume changes");
  const { identity: _identity, ...promptBank } = bank;
  const stable = `${SELECTION_SYSTEM}\nVERIFIED CONTENT BANK:\n${JSON.stringify(promptBank)}\nCANONICAL BASES:\n${JSON.stringify(canonicalBases)}`;
  const dynamic = JSON.stringify({ selectedBaseResumeId: base.id, job, analysis, deterministicKeywords: extraction, preliminaryCoverage: coverage, instruction: "Return only a small diff. Omit summaryChange and projectSwap when unchanged. Empty bulletChanges and skillChanges are preferred when the selected base already matches. Every justification must name an exact job-description term or responsibility." });
  const response = await client.request({ apiKey, signal, stream: true, timeoutMs: 240000, body: { model: MODEL, max_tokens: 5000, system: [{ type: "text", text: stable, cache_control: { type: "ephemeral" } }], output_config: { format: { type: "json_schema", schema: tailoringDiffSchema(bank, base) } }, messages: [{ role: "user", content: dynamic }] } });
  const proposedDiff = parseJsonText(response.text, "Sonnet tailoring diff", { stopReason: response.stopReason });
  const { applyTailoringDiff } = await import(pathToFileURL(path.join(generateDir, "tailoringDiff.js")).href);
  const applied = applyTailoringDiff({ bank, base, diff: proposedDiff, extraction, analysis });
  progress?.("Validating bounded tailoring changes");
  return { ...applied, proposedDiff, usage: response.usage || null, cacheUsage: response.usage ? { cacheCreationInputTokens: response.usage.cache_creation_input_tokens ?? null, cacheReadInputTokens: response.usage.cache_read_input_tokens ?? null } : null, model: MODEL, usedFallback: false };
}

module.exports = { MODEL, tailoringDiffSchema, generateResumeSelection };
