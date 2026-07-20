function sanitizeJob(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Job input must be an object.");
  for (const key of Object.keys(input)) if (!["title", "company", "description"].includes(key)) throw new Error(`Unknown job field '${key}'.`);
  const result = {}; for (const key of ["title", "company", "description"]) { result[key] = typeof input[key] === "string" ? input[key].trim() : ""; if (!result[key]) throw new Error(`Job ${key} is required.`); }
  if (result.description.length > 100000) throw new Error("Job description is too long."); return result;
}
function parseJsonText(text, label) { try { return JSON.parse(text); } catch { throw Object.assign(new Error(`${label} returned malformed JSON.`), { code: "MALFORMED_RESPONSE" }); } }
module.exports = { sanitizeJob, parseJsonText };
