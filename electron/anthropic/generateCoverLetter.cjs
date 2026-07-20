const path = require("path");
const { pathToFileURL } = require("url");
const { MODELS } = require("./models.cjs");
const { COVER_LETTER_SYSTEM, HUMANIZER_SYSTEM } = require("./prompts.cjs");
const { parseJsonText, sanitizeJob } = require("./validation.cjs");

// Two-pass cover-letter generation (task Part 5):
//   1. Generate a factual first draft from verified evidence only.
//   2. Validate facts and numbers.
//   3. Humanize the draft (second model pass).
//   4. Validate facts, numbers, technologies, and meaning again.
//   5. Fall back to the first valid draft if humanization changed a fact.
async function generateCoverLetter({ client, apiKey, bank, job, analysis, selection, signal, generateDir, progress }) {
  const { COVER_LETTER_SCHEMA, validateCoverLetter } = await import(pathToFileURL(path.join(generateDir, "coverLetterValidation.js")).href);
  const { validateJobAnalysis } = await import(pathToFileURL(path.join(generateDir, "jobAnalysisValidation.js")).href);
  const { validateSelection } = await import(pathToFileURL(path.join(generateDir, "validateSelection.js")).href);
  const { validateHumanizedCoverLetter } = await import(pathToFileURL(path.join(generateDir, "coverLetterHumanization.js")).href);
  const safeJob = sanitizeJob(job);
  validateJobAnalysis(analysis);
  const verifiedSelection = validateSelection(bank, selection, { requireUniqueActionVerbs: true });
  const { identity: _identity, ...safeBank } = bank;
  const stable = `${COVER_LETTER_SYSTEM}\nVERIFIED CONTENT BANK:\n${JSON.stringify(safeBank)}`;
  const evidence = verifiedSelection.rankedBullets.map((item) => ({ id: item.bullet.id, text: item.text }));

  // Pass 1: factual first draft.
  progress?.("Drafting evidence-based cover letter");
  const draftResponse = await client.request({ apiKey, signal, stream: true, timeoutMs: 180000, body: {
    model: MODELS.writing,
    max_tokens: 2200,
    system: [{ type: "text", text: stable, cache_control: { type: "ephemeral" } }],
    output_config: { format: { type: "json_schema", schema: COVER_LETTER_SCHEMA } },
    messages: [{ role: "user", content: JSON.stringify({ job: safeJob, analysis, selectedEvidence: evidence, requirements: "Approximately 150 to 320 words in four paragraphs. No invented facts or numbers; use only the supplied evidence." }) }],
  } });
  progress?.("Validating cover letter claims");
  const draft = validateCoverLetter(parseJsonText(draftResponse.text, "Cover letter", { stopReason: draftResponse.stopReason }), bank, { jobDescription: safeJob.description });

  // Pass 2: humanize, then revalidate facts. On any failure keep the factual
  // draft (never ship a version that changed a fact).
  let content = draft;
  let humanized = false;
  const usageTotals = accumulateUsage({}, draftResponse.usage);
  try {
    progress?.("Humanizing cover letter");
    const humanizeResponse = await client.request({ apiKey, signal, stream: true, timeoutMs: 180000, body: {
      model: MODELS.writing,
      max_tokens: 2200,
      system: HUMANIZER_SYSTEM,
      output_config: { format: { type: "json_schema", schema: COVER_LETTER_SCHEMA } },
      messages: [{ role: "user", content: JSON.stringify({ draft: { version: 1, opening: draft.opening, bodyParagraphs: draft.bodyParagraphs, closing: draft.closing }, jobDescription: safeJob.description, requirements: "Keep every number, technology, scope, and outcome identical. Change wording only. Return the same four paragraphs." }) }],
    } });
    accumulateUsage(usageTotals, humanizeResponse.usage);
    const candidate = validateCoverLetter(parseJsonText(humanizeResponse.text, "Humanized cover letter", { stopReason: humanizeResponse.stopReason }), bank, { jobDescription: safeJob.description });
    const check = validateHumanizedCoverLetter(draft, candidate, { jobDescription: safeJob.description });
    if (check.valid) {
      content = candidate;
      humanized = true;
    }
  } catch {
    // Humanization pass failed to produce a valid factual draft: keep pass 1.
  }

  progress?.("Validating cover letter claims");
  return { content, humanized, usage: usageTotals, model: MODELS.writing };
}

function accumulateUsage(totals, usage) {
  if (!usage) return totals;
  for (const key of ["input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"]) {
    if (typeof usage[key] === "number") totals[key] = (totals[key] || 0) + usage[key];
  }
  return totals;
}

module.exports = { generateCoverLetter };
