const path = require("path");
const { pathToFileURL } = require("url");
const { MODELS } = require("./models.cjs");
const { COVER_LETTER_SYSTEM } = require("./prompts.cjs");
const { parseJsonText, sanitizeJob } = require("./validation.cjs");

async function generateCoverLetter({ client, apiKey, bank, job, analysis, selection, signal, generateDir, progress }) {
  const { COVER_LETTER_SCHEMA, validateCoverLetter } = await import(pathToFileURL(path.join(generateDir, "coverLetterValidation.js")).href);
  const { validateJobAnalysis } = await import(pathToFileURL(path.join(generateDir, "jobAnalysisValidation.js")).href);
  const { validateSelection } = await import(pathToFileURL(path.join(generateDir, "validateSelection.js")).href);
  const safeJob = sanitizeJob(job);
  validateJobAnalysis(analysis);
  const verifiedSelection = validateSelection(bank, selection, { requireUniqueActionVerbs: true });
  const { identity: _identity, ...safeBank } = bank;
  const stable = `${COVER_LETTER_SYSTEM}\nVERIFIED CONTENT BANK:\n${JSON.stringify(safeBank)}`;
  const evidence = verifiedSelection.rankedBullets.map((item) => ({ id: item.bullet.id, text: item.text }));
  progress?.("Drafting evidence-based cover letter");
  const response = await client.request({ apiKey, signal, stream: true, timeoutMs: 180000, body: {
    model: MODELS.writing,
    max_tokens: 2200,
    system: [{ type: "text", text: stable, cache_control: { type: "ephemeral" } }],
    output_config: { format: { type: "json_schema", schema: COVER_LETTER_SCHEMA } },
    messages: [{ role: "user", content: JSON.stringify({ job: safeJob, analysis, selectedEvidence: evidence, requirements: "150 to 350 words. Exactly two body paragraphs. No invented facts or numbers." }) }],
  } });
  progress?.("Validating cover letter claims");
  return { content: validateCoverLetter(parseJsonText(response.text, "Cover letter", { stopReason: response.stopReason }), bank), usage: response.usage || {}, model: MODELS.writing };
}

module.exports = { generateCoverLetter };
