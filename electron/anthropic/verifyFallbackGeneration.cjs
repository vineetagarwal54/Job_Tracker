// Orchestrator integration test for the universal fallback flow (task Part 1).
//
// Drives the REAL createOrchestrator with a mocked Anthropic client (no paid
// API calls) and the REAL Tectonic compile, proving the fallback path is
// actually connected to runtime generation and still ships a valid one-page
// PDF when the model fails. Skips compile assertions only if Tectonic is
// absent from PATH.

const fs = require("fs");
const path = require("path");
const { createOrchestrator } = require("./orchestrator.cjs");
const { createCoverLetterOrchestrator } = require("./coverLetterOrchestrator.cjs");
const { createResumePaths } = require("../resume/paths.cjs");
const { checkTectonic, compileGeneratedTex } = require("../resume/compiler.cjs");

const root = path.resolve(__dirname, "..", "..");
const assert = (condition, message) => { if (!condition) throw new Error(`FAIL: ${message}`); };

const fakeApp = { isPackaged: false, getPath: (name) => (name === "documents" ? path.join(root, "resume", "output") : root) };
const paths = createResumePaths({ app: fakeApp, rootDir: root });
const getDefaultProfile = () => ({ isDefault: true, fullName: "Test User", email: "test@example.test", phone: "240-555-1234", city: "College Park", state: "MD", linkedin: "https://example.test/in", github: "https://example.test/gh", portfolio: "https://example.test" });
const keyProvider = { readKey: () => "fake-key-for-mock" };

const JD = "Backend Engineer. Required: Python, FastAPI, PostgreSQL, Docker, Kubernetes, AWS, REST, WebSocket, JWT, RBAC, system design, microservices. Preferred: Redis, GraphQL, Node.js.";
const job = { company: "Test Co", title: "Backend Engineer", description: JD };

const validOptimization = (baseResumeId) => ({
  version: 2, baseResumeId, roleFamily: "backend software engineering", seniority: "entry",
  requirements: [{ id: "req-python", text: "Python", priority: "must", kind: "technical-skill", status: "covered", currentEvidenceIds: ["skill:python"], candidateEvidenceIds: [], knowledgeSkills: [], reason: "Python is rendered in the selected base." }],
  diff: { bulletChanges: [], projectChanges: [], skillChanges: [], summaryChanges: [] },
});

// Mock client modes are "ok", "throw", or "malformed".
function makeClient({ selection = "ok" } = {}) {
  let calls = 0;
  return {
    get calls() { return calls; },
    request: async ({ body }) => {
      calls += 1;
      if (selection === "throw") throw new Error("simulated selection outage");
      if (selection === "malformed") return { text: "{not-json", usage: null, stopReason: "end_turn" };
      assert(!JSON.stringify(body.output_config.format.schema).includes('"maxItems"'), "normal optimizer uses a provider-compatible structured-output schema");
      return { text: JSON.stringify(validOptimization(body.output_config.format.schema.properties.baseResumeId.enum[0])), usage: { input_tokens: 1000, output_tokens: 100 }, stopReason: "end_turn" };
    },
  };
}

function makeOrchestrator(client) {
  return createOrchestrator({ rootDir: root, client, keyProvider, getDefaultProfile, compileResumeTex: (fileName) => compileGeneratedTex(paths, fileName), paths });
}

// Cover-letter mock client returns a factual draft grounded in verified bank
// evidence. The active flow must make exactly one writing-model call.
function coverClient() {
  let calls = 0;
  const filler = "word ".repeat(45).trim();
  const draft = {
    version: 1,
    opening: filler,
    bodyParagraphs: [
      `Delivered platform automation for 100 employees and cut API response time from 75 seconds to under 10 seconds. ${"detail ".repeat(20).trim()}`,
      filler,
    ],
    closing: filler,
    claimEvidence: [
      { sentence: "Delivered platform automation for 100 employees and cut API response time from 75 seconds to under 10 seconds.", evidenceIds: ["servbeyond-platform-integrations", "xelpmoc-sql-redis"] },
    ],
  };
  return {
    get calls() { return calls; },
    request: async () => {
      calls += 1;
      return { text: JSON.stringify(draft), stopReason: "end_turn", usage: { input_tokens: 10, output_tokens: 20 } };
    },
  };
}

function assertResumeShape(result, label, expectedBase = "swe-cloud") {
  assert(result && result.pdfFileName, `${label}: produced a PDF`);
  assert(result.pageCount === 1, `${label}: resume is one page (got ${result.pageCount})`);
  assert(result.atsIntegrity && result.atsIntegrity.valid, `${label}: ATS text layer valid`);
  assert(Array.isArray(result.renderedSkills) && result.renderedSkills.length > 0, `${label}: individual skills rendered`);
  assert(result.baseResumeId === expectedBase, `${label}: selected canonical base retained`);
  assert(result.tailoring && result.tailoring.densityRatio >= 0.85, `${label}: bounded tailoring metadata returned`);
  assert(Array.isArray(result.tailoring.pageFitAttempts) && result.tailoring.pageFitAttempts.at(-1)?.pageCount === 1, `${label}: compile-driven page-fit verification returned`);
  assert(Array.isArray(result.tailoring.backedOffForFit), `${label}: page-fit backoff metadata returned`);
  const expIds = (result.selection.experience || []).map((e) => e.entryId);
  assert(expIds.includes("servbeyond-enterprise-ai-platform-intern") && expIds.includes("xelpmoc-software-engineer"), `${label}: protected base employers present`);
  assert((result.selection.projects || []).some((e) => e.entryId === "locra"), `${label}: mandatory project Locra present`);
}

async function main() {
  const tectonic = await checkTectonic();
  if (!tectonic.available) {
    console.log(JSON.stringify({ skipped: true, reason: "Tectonic not on PATH" }, null, 2));
    return;
  }

  // 1. Normal generation: model succeeds end to end.
  const normalClient = makeClient({});
  const normal = await makeOrchestrator(normalClient).call(null, { job });
  assertResumeShape(normal, "normal");
  assert(normal.fallback.selection === false && normal.fallback.analysis === false, "normal: no fallback used");
  assert(normalClient.calls === 1, "normal: one semantic optimizer request used");
  assert(normal.finalCoverage.mustHave.covered.some((item) => item.id === "req-python"), "normal: semantic requirement coverage returned");
  assert(["analysisMs", "relevancePlanningMs", "tailoringApiMs", "compilePageFitMs", "finalVerificationMs", "totalMs"].every((key) => Number.isFinite(normal.timings?.[key]) && normal.timings[key] >= 0), "normal: stage timings returned");

  // 2. Selection fallback: analysis ok, model selection fails -> deterministic
  //    resume from the verified bank.
  const selFallback = await makeOrchestrator(makeClient({ selection: "throw" })).call(null, { job });
  assertResumeShape(selFallback, "selection-fallback");
  assert(selFallback.fallback.selection === true, "selection-fallback: selection fallback flagged");
  assert(selFallback.fallback.diagnostic?.classification === "API/request failure", "selection-fallback: classified diagnostic returned");
  assert(selFallback.fallback.reason === "simulated selection outage", "selection-fallback: safe reason returned");
  assert(selFallback.warnings.some((w) => w.type === "selection-fallback"), "selection-fallback: warning surfaced");
  assert(JSON.stringify(selFallback.selection) === JSON.stringify(normal.selection), "selection-fallback: canonical base remained byte-for-byte equivalent at the selection layer");

  const malformedSelection = await makeOrchestrator(makeClient({ selection: "malformed" })).call(null, { job });
  assertResumeShape(malformedSelection, "malformed-selection");
  assert(malformedSelection.fallback.selection === true, "malformed-selection: canonical selection fallback used");
  assert(malformedSelection.fallback.diagnostic?.classification === "response parsing failure", "malformed-selection: parsing failure classified");
  assert(JSON.stringify(malformedSelection.selection) === JSON.stringify(normal.selection), "malformed-selection: malformed output did not alter the canonical base");

  // 4. Recovery after failure: a prior failure never blocks a later generation.
  const recovered = await makeOrchestrator(makeClient({})).call(null, { job });
  assertResumeShape(recovered, "recovery");

  let compileFailure;
  try {
    await createOrchestrator({ rootDir: root, client: makeClient({}), keyProvider, getDefaultProfile, compileResumeTex: async () => ({ ok: false, error: { code: "COMPILATION_FAILED", message: "simulated compiler failure" } }), paths })({ job });
  } catch (error) { compileFailure = error; }
  assert(compileFailure?.code === "COMPILATION_FAILED" && compileFailure?.stage === "render-compile", "compile failure is explicit and stage-labelled");

  const mobileJob = { ...job, resumeOption: "Mobile / React Native", baseResumeId: "mobile" };
  const mobile = await makeOrchestrator(makeClient({})).call(null, { job: mobileJob });
  assertResumeShape(mobile, "mobile-choice", "mobile");

  // 5. JD classification remains available, but the saved resume choice keeps
  //    the canonical base authoritative.
  const enterpriseJob = { company: "Acme", title: "Enterprise AI Builder", description: "Ship internal AI tools and automations, agentic GenAI workflows, Salesforce and ServiceNow integrations, and drive adoption and measurable business impact. LangChain and RAG." };
  const enterprise = await makeOrchestrator(makeClient({ selection: "throw" })).call(null, { job: enterpriseJob });
  assertResumeShape(enterprise, "enterprise");
  assert(enterprise.baseResumeId === "swe-cloud", "enterprise JD keeps selected default base");

  // 6. Cover-letter-only: reuse the resume's stored evidence with a NEW JD and
  //    one writing-model call, WITHOUT regenerating the resume.
  const coverApi = coverClient();
  const orchestrateCover = createCoverLetterOrchestrator({ rootDir: root, client: coverApi, keyProvider, getDefaultProfile, compileResumeTex: (fileName) => compileGeneratedTex(paths, fileName), paths });
  const newJd = { company: "Beta Corp", title: "Backend Engineer", description: "Backend engineer building REST APIs on AWS with Redis and PostgreSQL." };
  const cover = await orchestrateCover({ job: newJd, selection: normal.selection });
  assert(cover.pageCount === 1, `cover-letter-only is one page (got ${cover.pageCount})`);
  assert(cover.atsIntegrity.valid, "cover-letter-only ATS text layer valid");
  assert(cover.modelCalls === 1 && coverApi.calls === 1, "cover-letter-only used exactly one writing-model call");
  assert(cover.pdfFileName !== normal.pdfFileName, "cover-letter-only produced a separate document (did not touch the resume)");

  console.log(JSON.stringify({
    normalGeneration: true,
    selectionFallbackCompiles: true,
    oneCallSemanticOptimizer: normalClient.calls === 1,
    recoveryAfterFailure: true,
    malformedSelectionFallsBack: true,
    compileFailureExplicit: true,
    selectedJobResumeOptionAuthoritative: true,
    selectedBaseRemainsAuthoritative: true,
    coverLetterOnlyReusesResume: true,
    singleCoverLetterCall: coverApi.calls === 1,
    onePage: [normal.pageCount, selFallback.pageCount, recovered.pageCount, mobile.pageCount, enterprise.pageCount, cover.pageCount],
  }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
