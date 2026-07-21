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
const { MODELS } = require("./models.cjs");

const root = path.resolve(__dirname, "..", "..");
const assert = (condition, message) => { if (!condition) throw new Error(`FAIL: ${message}`); };

const fakeApp = { isPackaged: false, getPath: (name) => (name === "documents" ? path.join(root, "resume", "output") : root) };
const paths = createResumePaths({ app: fakeApp, rootDir: root });
const getDefaultProfile = () => ({ isDefault: true, fullName: "Test User", email: "test@example.test", phone: "240-555-1234", city: "College Park", state: "MD", linkedin: "https://example.test/in", github: "https://example.test/gh", portfolio: "https://example.test" });
const keyProvider = { readKey: () => "fake-key-for-mock" };

const JD = "Backend Engineer. Required: Python, FastAPI, PostgreSQL, Docker, Kubernetes, AWS, REST, WebSocket, JWT, RBAC, system design, microservices. Preferred: Redis, GraphQL, Node.js.";
const job = { company: "Test Co", title: "Backend Engineer", description: JD };

const VALID_ANALYSIS = {
  roleFamily: "backend", seniority: "entry",
  mustHaveKeywords: ["python", "aws", "docker", "kubernetes", "rest"],
  niceToHaveKeywords: ["redis", "postgresql"], responsibilities: ["build apis"],
  blockers: [], recommendedVariant: "cloud-backend", reasoningSummary: "Verified backend match.",
};
const VALID_SELECTION = {
  version: 1, variant: "cloud-backend", educationId: "umd-meng-software-engineering",
  skillGroupIds: ["cloud-devops", "backend", "languages"],
  skills: [
    { groupId: "backend", items: ["FastAPI", "REST APIs", "WebSocket"] },
    { groupId: "cloud-devops", items: ["AWS", "Docker", "Kubernetes"] },
    { groupId: "security", items: ["JWT", "RBAC"] },
  ],
  experience: [{ entryId: "xelpmoc-software-engineer", bullets: [{ id: "xelpmoc-api-performance" }] }],
  projects: [{ entryId: "terrapin-events", bullets: [{ id: "terrapin-events-platform" }] }],
};

// Mock client: analysisMode / selectionMode are "ok" | "throw".
function makeClient({ analysis = "ok", selection = "ok" } = {}) {
  return {
    request: async ({ body }) => {
      if (body.model === MODELS.analysis) {
        if (analysis === "throw") throw new Error("simulated analysis outage");
        return { content: [{ type: "text", text: JSON.stringify(VALID_ANALYSIS) }], usage: {}, stop_reason: "end_turn" };
      }
      if (selection === "throw") throw new Error("simulated selection outage");
      return { text: JSON.stringify(VALID_SELECTION), usage: null, stopReason: "end_turn" };
    },
  };
}

function makeOrchestrator(client) {
  return createOrchestrator({ rootDir: root, client, keyProvider, getDefaultProfile, compileResumeTex: (fileName) => compileGeneratedTex(paths, fileName), paths });
}

// Cover-letter mock client: call 1 returns a factual draft (numbers only from
// the verified bank), call 2 returns a faithful humanized rewrite that keeps
// every number and technology, so the two-pass humanizer accepts it.
function coverClient() {
  let calls = 0;
  const filler = "word ".repeat(45).trim();
  const draft = {
    version: 1,
    opening: filler,
    bodyParagraphs: [
      `Delivered a documentation assistant for 100 users and cut API response time from 75 seconds to under 10 seconds. ${"detail ".repeat(20).trim()}`,
      filler,
    ],
    closing: filler,
    claimEvidence: [
      { sentence: "Delivered a documentation assistant for 100 users and cut API response time from 75 seconds to under 10 seconds.", evidenceIds: ["servbeyond-rag-manual-lookup", "xelpmoc-api-performance"] },
    ],
  };
  const humanized = { ...draft, opening: `Direct opening line here. ${"note ".repeat(42).trim()}` };
  return {
    request: async () => {
      calls += 1;
      const payload = calls === 1 ? draft : humanized;
      return { text: JSON.stringify(payload), stopReason: "end_turn", usage: { input_tokens: 10, output_tokens: 20 } };
    },
  };
}

function assertResumeShape(result, label) {
  assert(result && result.pdfFileName, `${label}: produced a PDF`);
  assert(result.pageCount === 1, `${label}: resume is one page (got ${result.pageCount})`);
  assert(result.atsIntegrity && result.atsIntegrity.valid, `${label}: ATS text layer valid`);
  assert(Array.isArray(result.renderedSkills) && result.renderedSkills.length > 0, `${label}: individual skills rendered`);
  const groupIds = result.renderedSkills.map((g) => g.id);
  for (const mandatory of ["applied-ai", "languages", "backend", "frontend", "cloud-devops"]) {
    assert(groupIds.includes(mandatory), `${label}: mandatory skill category ${mandatory} present`);
  }
  const expIds = (result.selection.experience || []).map((e) => e.entryId);
  for (const mandatory of ["servbeyond-enterprise-ai-platform-intern", "runara-ml-inference-engineer-intern", "xelpmoc-software-engineer"]) {
    assert(expIds.includes(mandatory), `${label}: mandatory employer ${mandatory} present`);
  }
  assert((result.selection.projects || []).some((e) => e.entryId === "locra"), `${label}: mandatory project Locra present`);
}

async function main() {
  const tectonic = await checkTectonic();
  if (!tectonic.available) {
    console.log(JSON.stringify({ skipped: true, reason: "Tectonic not on PATH" }, null, 2));
    return;
  }

  // 1. Normal generation: model succeeds end to end.
  const normal = await makeOrchestrator(makeClient({})).call(null, { job });
  assertResumeShape(normal, "normal");
  assert(normal.fallback.selection === false && normal.fallback.analysis === false, "normal: no fallback used");

  // 2. Selection fallback: analysis ok, model selection fails -> deterministic
  //    resume from the verified bank.
  const selFallback = await makeOrchestrator(makeClient({ selection: "throw" })).call(null, { job });
  assertResumeShape(selFallback, "selection-fallback");
  assert(selFallback.fallback.selection === true, "selection-fallback: selection fallback flagged");
  assert(selFallback.warnings.some((w) => w.type === "selection-fallback"), "selection-fallback: warning surfaced");

  // 3. Analysis + selection fallback: both model calls fail -> resume still ships.
  const bothFallback = await makeOrchestrator(makeClient({ analysis: "throw", selection: "throw" })).call(null, { job });
  assertResumeShape(bothFallback, "both-fallback");
  assert(bothFallback.fallback.analysis === true && bothFallback.fallback.selection === true, "both-fallback: both fallbacks flagged");
  assert(bothFallback.warnings.some((w) => w.type === "analysis-fallback"), "both-fallback: analysis fallback warning surfaced");

  // 4. Recovery after failure: a prior failure never blocks a later generation.
  const recovered = await makeOrchestrator(makeClient({})).call(null, { job });
  assertResumeShape(recovered, "recovery");

  // 5. Enterprise-AI JD renders the enterprise summary (not inference) and one page.
  const enterpriseJob = { company: "Acme", title: "Enterprise AI Builder", description: "Ship internal AI tools and automations, agentic GenAI workflows, Salesforce and ServiceNow integrations, and drive adoption and measurable business impact. LangChain and RAG." };
  const enterprise = await makeOrchestrator(makeClient({ selection: "throw" })).call(null, { job: enterpriseJob });
  assertResumeShape(enterprise, "enterprise");
  assert(enterprise.primaryEmphasis === "enterprise-ai", "enterprise JD classified as enterprise-ai");

  // 6. Cover-letter-only: reuse the resume's stored evidence with a NEW JD and
  //    the two-pass humanizer, WITHOUT regenerating the resume.
  const orchestrateCover = createCoverLetterOrchestrator({ rootDir: root, client: coverClient(), keyProvider, getDefaultProfile, compileResumeTex: (fileName) => compileGeneratedTex(paths, fileName), paths });
  const newJd = { company: "Beta Corp", title: "Backend Engineer", description: "Backend engineer building REST APIs on AWS with Redis and PostgreSQL." };
  const cover = await orchestrateCover({ job: newJd, analysis: normal.analysis, selection: normal.selection });
  assert(cover.pageCount === 1, `cover-letter-only is one page (got ${cover.pageCount})`);
  assert(cover.atsIntegrity.valid, "cover-letter-only ATS text layer valid");
  assert(cover.humanized === true, "cover-letter-only ran the humanizer and kept it (facts preserved)");
  assert(cover.pdfFileName !== normal.pdfFileName, "cover-letter-only produced a separate document (did not touch the resume)");

  console.log(JSON.stringify({
    normalGeneration: true,
    selectionFallbackCompiles: true,
    analysisAndSelectionFallbackCompiles: true,
    recoveryAfterFailure: true,
    enterpriseEmphasisAndSummary: true,
    coverLetterOnlyReusesResume: true,
    humanizerRan: cover.humanized,
    onePage: [normal.pageCount, selFallback.pageCount, bothFallback.pageCount, recovered.pageCount, enterprise.pageCount, cover.pageCount],
  }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
