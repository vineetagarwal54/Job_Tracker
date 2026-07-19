const { ANALYSIS_SYSTEM } = require("./prompts.cjs"); const { parseJsonText, sanitizeJob } = require("./validation.cjs");
const MODEL = "claude-haiku-4-5-20251001";

async function analyzeJob({ client, apiKey, job, signal, generateDir }) {
  const safeJob = sanitizeJob(job);
  const { JOB_ANALYSIS_SCHEMA, validateJobAnalysis } = await import(`${require("node:url").pathToFileURL(require("node:path").join(generateDir, "jobAnalysisValidation.js")).href}`);
  const response = await client.request({ apiKey, signal, body: { model: MODEL, max_tokens: 1500, system: ANALYSIS_SYSTEM, output_config: { format: { type: "json_schema", schema: JOB_ANALYSIS_SCHEMA } }, messages: [{ role: "user", content: JSON.stringify(safeJob) }] } });
  const text = response.content.find((block) => block.type === "text")?.text; if (!text) throw new Error("Haiku returned no analysis JSON.");
  return { analysis: validateJobAnalysis(parseJsonText(text, "Haiku analysis")), usage: response.usage || null, model: MODEL };
}
module.exports = { MODEL, analyzeJob };
