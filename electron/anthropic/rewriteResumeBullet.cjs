const { MODELS } = require("./models.cjs");
const { parseJsonText } = require("./validation.cjs");
const { sanitizeDiagnosticMessage } = require("./tailoringDiagnostics.cjs");

const REWRITE_SYSTEM = `Lightly rewrite one verified resume bullet to surface the supplied requirement language. Preserve every metric, technology, acronym, factual claim, scope, and accomplishment. Use only terminology explicitly supplied in allowedSupportedTerminology or already present in the original bullet. Do not add ownership, production depth, tools, outcomes, or claims. Return only the requested JSON.`;
const schema = {
  type: "object", additionalProperties: false,
  properties: { rewrittenText: { type: "string" } },
  required: ["rewrittenText"],
};

async function rewriteResumeBullet({ client, apiKey, signal, originalBullet, requirementTexts, allowedSupportedTerminology }) {
  const body = {
    model: MODELS.writing, max_tokens: 500, thinking: { type: "disabled" },
    system: REWRITE_SYSTEM,
    output_config: { effort: "low", format: { type: "json_schema", schema } },
    messages: [{ role: "user", content: JSON.stringify({ originalBullet, requirementTexts, allowedSupportedTerminology }) }],
  };
  const requestBytes = Buffer.byteLength(JSON.stringify(body));
  const startedAt = Date.now();
  let response;
  try {
    response = await client.request({ apiKey, signal, stream: true, timeoutMs: 45000, body });
    const parsed = parseJsonText(response.text, "optional resume bullet rewrite", { stopReason: response.stopReason });
    if (!String(parsed?.rewrittenText || "").trim()) throw Object.assign(new Error("Optional rewrite returned no text."), { code: "EMPTY_REWRITE" });
    return { ok: true, rewrittenText: String(parsed.rewrittenText).trim(), apiDurationMs: Date.now() - startedAt, usage: response.usage || null, requestBytes };
  } catch (error) {
    return { ok: false, rewrittenText: originalBullet, apiDurationMs: Date.now() - startedAt, usage: response?.usage || error?.usage || null, requestBytes, diagnostic: { stage: "optional-bullet-rewrite", code: String(error?.code || "REWRITE_FAILED"), reason: sanitizeDiagnosticMessage(error?.message) } };
  }
}

module.exports = { REWRITE_SYSTEM, rewriteResumeBullet };
