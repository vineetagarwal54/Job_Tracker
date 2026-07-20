function sanitizeJob(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Job input must be an object.");
  for (const key of Object.keys(input)) if (!["title", "company", "description"].includes(key)) throw new Error(`Unknown job field '${key}'.`);
  const result = {}; for (const key of ["title", "company", "description"]) { result[key] = typeof input[key] === "string" ? input[key].trim() : ""; if (!result[key]) throw new Error(`Job ${key} is required.`); }
  if (result.description.length > 100000) throw new Error("Job description is too long."); return result;
}
function parseJsonText(text, label, { stopReason = null } = {}) {
  if (stopReason === "max_tokens") throw Object.assign(new Error(`${label} was truncated before its JSON response completed.`), { code: "MALFORMED_RESPONSE", reason: "max_tokens" });
  if (stopReason === "refusal") throw Object.assign(new Error(`${label} was refused by Anthropic before valid JSON was produced.`), { code: "MALFORMED_RESPONSE", reason: "refusal" });
  if (typeof text !== "string" || !text.trim()) throw Object.assign(new Error(`${label} returned an empty JSON response.`), { code: "MALFORMED_RESPONSE", reason: "empty" });
  try { return JSON.parse(text); }
  catch { throw Object.assign(new Error(`${label} returned malformed JSON after completing with stop reason '${stopReason || "unknown"}'.`), { code: "MALFORMED_RESPONSE", reason: stopReason || "unknown" }); }
}
module.exports = { sanitizeJob, parseJsonText };
