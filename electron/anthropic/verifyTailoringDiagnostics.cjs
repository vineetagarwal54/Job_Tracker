const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { generateResumeSelection, tailoringDiffSchema } = require("./generateResumeSelection.cjs");
const { classifyTailoringFallback, logTailoringFallback } = require("./tailoringDiagnostics.cjs");

const assert = (condition, message) => { if (!condition) throw new Error(`FAIL: ${message}`); };
const root = path.resolve(__dirname, "..", "..");
const generateDir = path.join(root, "src", "generate");

async function main() {
  const bank = JSON.parse(fs.readFileSync(path.join(generateDir, "content-bank.json"), "utf8"));
  const { getCanonicalBaseResume } = await import(pathToFileURL(path.join(generateDir, "baseResumes.js")).href);
  const base = getCanonicalBaseResume("swe-cloud");
  const schema = tailoringDiffSchema(bank, base, { candidates: [{ id: "candidate-only", type: "skill-edit" }], gaps: [], unsupportedMissing: [] });

  // Regression for the real API failure: raw Anthropic structured outputs do
  // not accept maxItems. Caps are enforced after parsing by applyTailoringDiff.
  const serialized = JSON.stringify(schema);
  assert(!serialized.includes('"maxItems"'), "provider-incompatible maxItems constraint returned");

  const largeBank = JSON.parse(JSON.stringify(bank));
  largeBank.skillGroups.push({ id: "synthetic-large-inventory", label: "Synthetic", items: Array.from({ length: 350 }, (_, index) => `Synthetic Skill ${index}`) });
  const scopedPlan = { version: 1, baseResumeId: base.id, minimumBenefit: 6, terms: [], gaps: [], unsupportedMissing: [], candidates: [{ id: "summary:variant:ai-llm", type: "summary", summaryId: "variant:ai-llm", matchedTerms: ["ai"], expectedGain: 6, reason: "Verified summary candidate." }] };
  const smallSchema = tailoringDiffSchema(bank, base, scopedPlan);
  const largeSchema = tailoringDiffSchema(largeBank, base, scopedPlan);
  assert(JSON.stringify(smallSchema) === JSON.stringify(largeSchema), "bank-wide skills changed the candidate-scoped schema");
  const rewriteSchema = tailoringDiffSchema(bank, base, { ...scopedPlan, candidates: [...scopedPlan.candidates, { id: "bullet-rewrite:test", type: "bullet-rewrite" }] });
  assert(!rewriteSchema.properties.changes.items.properties.candidateId.enum.includes("bullet-rewrite:test"), "rewrite candidate leaked into ordinary changes");
  assert(rewriteSchema.properties.bulletRewrites.items.required.includes("rewrittenText"), "rewrite contract does not require rewritten text");
  let outgoingBody;
  await generateResumeSelection({
    client: { request: async ({ body }) => { outgoingBody = body; return { text: JSON.stringify({ version: 1, baseResumeId: base.id, changes: [] }), usage: null, stopReason: "end_turn" }; } },
    apiKey: "fake", bank: largeBank, base, job: { title: "AI Engineer", description: "Build verified AI systems." }, analysis: {}, extraction: {}, coverage: {}, relevancePlan: scopedPlan, generateDir,
  });
  const schemaBytes = Buffer.byteLength(JSON.stringify(outgoingBody.output_config.format.schema));
  const promptBytes = Buffer.byteLength(`${outgoingBody.system}${outgoingBody.messages[0].content}`);
  assert(schemaBytes < 1500, `candidate-scoped schema is unexpectedly large (${schemaBytes} bytes)`);
  assert(!JSON.stringify(outgoingBody).includes("Synthetic Skill 349"), "unapproved large-inventory skill leaked into outgoing request");
  assert(outgoingBody.output_config.effort === "low", "tailoring selection did not request low effort");
  assert(outgoingBody.thinking?.type === "disabled", "adaptive thinking was not disabled for constrained selection");
  assert(outgoingBody.max_tokens === 4000, "selection output headroom does not protect against the observed max_tokens truncation");
  const dynamicInstruction = JSON.parse(outgoingBody.messages[0].content).instruction;
  assert(/at most 3 bullet/.test(dynamicInstruction) && /at most 1 project/.test(dynamicInstruction) && /at most 4 skill/.test(dynamicInstruction) && /one short sentence/.test(dynamicInstruction), "selection caps or concise-justification instruction missing");

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

  console.log(JSON.stringify({ providerCompatibleSchema: true, largeInventoryCandidateScoped: true, schemaBytes, promptBytes, thinkingDisabled: true, lowEffort: true, outputHeadroom: 4000, conciseCappedSelection: true, classifications: 4, sanitizedLogging: true }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
