const path = require("path");
const { pathToFileURL } = require("url");
const { createOrchestrator } = require("./orchestrator.cjs");
const { createCoverLetterOrchestrator } = require("./coverLetterOrchestrator.cjs");
const { createResumePaths } = require("../resume/paths.cjs");
const { checkTectonic, compileGeneratedTex } = require("../resume/compiler.cjs");
const { MODELS } = require("./models.cjs");

const root = path.resolve(__dirname, "..", "..");
const generateDir = path.join(root, "src", "generate");
const load = (name) => import(pathToFileURL(path.join(generateDir, `${name}.js`)).href);
const assert = (condition, message) => { if (!condition) throw new Error(`FAIL: ${message}`); };
const fakeApp = { isPackaged: false, getPath: (name) => name === "documents" ? path.join(root, "resume", "output") : root };
const paths = createResumePaths({ app: fakeApp, rootDir: root });
const compile = (fileName) => compileGeneratedTex(paths, fileName);
const keyProvider = { readKey: () => "mock-key" };
const getDefaultProfile = () => ({ isDefault: true, fullName: "Test User", email: "test@example.test", phone: "240-555-1234", city: "College Park", state: "MD", linkedin: "https://example.test/in", github: "https://example.test/gh", portfolio: "https://example.test" });

const cases = [
  { name: "AI / LLM", option: "AI / LLM", base: "ai", variant: "ai-llm", jd: "AI engineer building multi-agent RAG systems with Python, LangChain, vector search, evaluation, and LLM inference.", must: ["multi-agent systems", "RAG", "Python"] },
  { name: "GenAI / RAG", option: "AI / LLM", base: "ai", variant: "ai-llm", jd: "GenAI engineer. Must have RAG, RAG, Claude, SharePoint, prompt evaluation, and document retrieval workflows.", must: ["RAG", "Claude", "SharePoint"] },
  { name: "Backend", option: "Software Engineer / FullStack / Cloud", base: "swe-cloud", variant: "cloud-backend", jd: "Backend engineer. Must have FastAPI, PostgreSQL, Redis, REST APIs, and Python. Build reliable microservices.", must: ["FastAPI", "PostgreSQL", "Redis"] },
  { name: "Cloud / platform", option: "Software Engineer / FullStack / Cloud", base: "swe-cloud", variant: "cloud-backend", jd: "Platform engineer using AWS, Kubernetes, Docker, CI/CD, Lambda, and API Gateway. Kubernetes is required.", must: ["AWS", "Kubernetes", "Docker"] },
  { name: "Full-stack", option: "Software Engineer / FullStack / Cloud", base: "swe-cloud", variant: "fullstack", jd: "Full-stack engineer using React, TypeScript, Node.js, REST APIs, PostgreSQL, and responsive product interfaces.", must: ["React", "TypeScript", "Node.js"] },
  { name: "React Native / mobile", option: "Mobile / React Native", base: "mobile", variant: "mobile", jd: "Mobile engineer. React Native, TypeScript, Redux Toolkit, WebRTC, Android, and offline-first product development are required.", must: ["React Native", "TypeScript", "WebRTC"] },
  { name: "Ambiguous general SWE", option: "Software Engineer / FullStack / Cloud", base: "swe-cloud", variant: "fullstack", jd: "Software engineer who can build dependable products, collaborate across teams, review code, and improve system quality.", must: [] },
  { name: "Unsupported technologies", option: "Software Engineer / FullStack / Cloud", base: "swe-cloud", variant: "fullstack", jd: "Must have Rust, Rust, Elixir, and Pulumi for distributed systems production work.", must: ["Rust", "Elixir", "Pulumi"], unsupported: "rust" },
  { name: "Base already strongly matched", option: "Mobile / React Native", base: "mobile", variant: "mobile", jd: "React Native TypeScript Redux Toolkit WebRTC mobile development with Expo and Android.", must: ["React Native", "TypeScript", "WebRTC"], expectZero: true },
];

function analysisFor(testCase) {
  return { roleFamily: testCase.name, seniority: "entry", mustHaveKeywords: testCase.must, niceToHaveKeywords: [], responsibilities: [], blockers: [], recommendedVariant: testCase.variant, reasoningSummary: "Mocked deterministic regression analysis." };
}

function proposalFor(body) {
  const dynamic = JSON.parse(body.messages[0].content);
  const diff = { version: 1, baseResumeId: dynamic.selectedBase.id, changes: [] };
  const candidate = dynamic.approvedCandidates.find((item) => item.type !== "bullet-rewrite");
  if (!candidate) return diff;
  const justification = `${candidate.matchedTerms[0]} is an explicit or repeated JD requirement.`;
  diff.changes.push({ candidateId: candidate.id, justification });
  return diff;
}

function resumeClient(testCase) {
  return { request: async ({ body }) => {
    if (body.model === MODELS.analysis) return { content: [{ type: "text", text: JSON.stringify(analysisFor(testCase)) }], usage: { input_tokens: 20, output_tokens: 10 }, stop_reason: "end_turn" };
    return { text: JSON.stringify(proposalFor(body)), usage: { input_tokens: 100, output_tokens: 20 }, stopReason: "end_turn" };
  } };
}

function counts(base) {
  return { experience: base.experience.length, projects: base.projects.length, bullets: [...base.experience, ...base.projects].reduce((sum, entry) => sum + entry.bullets.length, 0), skills: base.skills.length };
}

async function main() {
  const tectonic = await checkTectonic();
  if (!tectonic.available) throw new Error("FAIL: Tectonic is required for production regression verification");
  const [{ getCanonicalBaseResume }, { validateResumeEvidenceSelection }] = await Promise.all([load("baseResumes"), load("resumeEvidenceValidation")]);
  const bank = require("../../src/generate/content-bank.json");
  const results = [];

  for (const testCase of cases) {
    const resume = await createOrchestrator({ rootDir: root, client: resumeClient(testCase), keyProvider, getDefaultProfile, compileResumeTex: compile, paths })({ job: { company: "Regression Co", title: testCase.name, description: testCase.jd, resumeOption: testCase.option, baseResumeId: testCase.base } });
    const base = getCanonicalBaseResume(testCase.base);
    const expected = counts(base);
    const actual = { experience: resume.selection.experience.length, projects: resume.selection.projects.length, bullets: [...resume.selection.experience, ...resume.selection.projects].reduce((sum, entry) => sum + entry.bullets.length, 0), skills: resume.selection.renderedSkills.length };
    assert(resume.baseResumeId === testCase.base, `${testCase.name}: selected base changed`);
    assert(JSON.stringify(actual) === JSON.stringify(expected), `${testCase.name}: protected structure or density changed`);
    assert(resume.pageCount === 1 && resume.atsIntegrity.valid, `${testCase.name}: resume is not a one-page ATS-readable PDF`);
    assert(resume.tailoring.densityRatio >= 0.85, `${testCase.name}: density fell below guard`);
    assert(resume.tailoring.acceptedDiff.bulletChanges.length <= 3 && resume.tailoring.acceptedDiff.skillChanges.length <= 4 && Number(Boolean(resume.tailoring.acceptedDiff.projectSwap)) <= 1, `${testCase.name}: tailoring cap exceeded`);
    assert(resume.tailoring.coverageImprovement.weightedPercentageDelta >= 0, `${testCase.name}: relevant coverage decreased`);
    validateResumeEvidenceSelection(bank, resume.selection);
    if (testCase.unsupported) assert(resume.tailoring.unsupportedMissing.some((item) => item.term === testCase.unsupported), `${testCase.name}: unsupported requirement was not retained as a gap`);
    if (testCase.expectZero) assert(!resume.tailoring.acceptedDiff.summaryChange && !resume.tailoring.acceptedDiff.projectSwap && !resume.tailoring.acceptedDiff.bulletChanges.length && !resume.tailoring.acceptedDiff.skillChanges.length, `${testCase.name}: strongly matched base was changed`);

    const coverClient = { calls: 0, request: async function request() { this.calls += 1; throw new Error("simulated writing failure"); } };
    let cover;
    try {
      cover = await createCoverLetterOrchestrator({ rootDir: root, client: coverClient, keyProvider, getDefaultProfile, compileResumeTex: compile, paths })({ job: { company: "Regression Co", title: testCase.name, description: testCase.jd }, analysis: resume.analysis, selection: resume.selection });
    } catch (error) {
      throw new Error(`${testCase.name}: cover-letter regression failed: ${error.message}`, { cause: error });
    }
    const finalIds = new Set([...resume.selection.experience, ...resume.selection.projects].flatMap((entry) => entry.bullets.map((bullet) => bullet.id)));
    assert(cover.pageCount === 1 && cover.atsIntegrity.valid, `${testCase.name}: cover letter is not a one-page ATS-readable PDF`);
    assert(cover.modelCalls === 1 && coverClient.calls === 1, `${testCase.name}: cover letter made more than one model call`);
    assert(cover.evidenceIds.every((id) => finalIds.has(id)), `${testCase.name}: cover letter did not use final post-backoff resume evidence`);
    results.push({ case: testCase.name, base: resume.baseResumeId, accepted: resume.tailoring.acceptedDiff.bulletChanges.length + resume.tailoring.acceptedDiff.skillChanges.length + Number(Boolean(resume.tailoring.acceptedDiff.projectSwap)) + Number(Boolean(resume.tailoring.acceptedDiff.summaryChange)), backedOff: resume.tailoring.backedOffForFit.length, resumePages: resume.pageCount, coverPages: cover.pageCount, atsReadable: resume.atsIntegrity.valid && cover.atsIntegrity.valid });
  }
  console.log(JSON.stringify({ cases: results, allPassed: true }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
