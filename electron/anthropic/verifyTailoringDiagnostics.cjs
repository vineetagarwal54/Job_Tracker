const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { tailoringDiffSchema } = require("./generateResumeSelection.cjs");
const { classifyTailoringFallback, logTailoringFallback } = require("./tailoringDiagnostics.cjs");

const assert = (condition, message) => { if (!condition) throw new Error(`FAIL: ${message}`); };
const root = path.resolve(__dirname, "..", "..");
const generateDir = path.join(root, "src", "generate");

async function main() {
  const bank = JSON.parse(fs.readFileSync(path.join(generateDir, "content-bank.json"), "utf8"));
  const { getCanonicalBaseResume } = await import(pathToFileURL(path.join(generateDir, "baseResumes.js")).href);
  const base = getCanonicalBaseResume("swe-cloud");
  const schema = tailoringDiffSchema(bank, base, { candidates: [], gaps: [], unsupportedMissing: [] });

  // Regression for the real API failure: raw Anthropic structured outputs do
  // not accept maxItems. Caps are enforced after parsing by applyTailoringDiff.
  const serialized = JSON.stringify(schema);
  assert(!serialized.includes('"maxItems"'), "provider-incompatible maxItems constraint returned");

  const schemaError = Object.assign(new Error("Invalid schema: maxItems is not supported in output_config.format.schema"), { code: "invalid_request_error", status: 400, requestId: "req_safe" });
  const schemaDiagnostic = classifyTailoringFallback(schemaError);
  assert(schemaDiagnostic.classification === "structured-output/schema failure", "schema failure classification");
  assert(schemaDiagnostic.stage === "structured-output-schema", "schema failure stage");

  assert(classifyTailoringFallback(Object.assign(new Error("bad JSON"), { code: "MALFORMED_RESPONSE" })).classification === "response parsing failure", "parsing failure classification");
  assert(classifyTailoringFallback(Object.assign(new Error("candidate application failed"), { tailoringStage: "tailoring-validation-application" })).classification === "tailoring validation/application failure", "validation failure classification");
  assert(classifyTailoringFallback(Object.assign(new Error("network unavailable"), { code: "NETWORK_ERROR" })).classification === "API/request failure", "request failure classification");

  const logged = [];
  const secretError = Object.assign(new Error("Request for person@example.com with sk-ant-secret and 240-555-1234 failed"), { code: "invalid_request_error" });
  const safeDiagnostic = classifyTailoringFallback(secretError);
  logTailoringFallback({ error: (...args) => logged.push(args) }, safeDiagnostic, secretError);
  const logText = JSON.stringify(logged);
  assert(!logText.includes("person@example.com") && !logText.includes("sk-ant-secret") && !logText.includes("240-555-1234"), "diagnostic log leaked sensitive values");

  console.log(JSON.stringify({ providerCompatibleSchema: true, classifications: 4, sanitizedLogging: true }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
