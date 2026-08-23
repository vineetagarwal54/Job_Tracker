const fs = require("fs");
const os = require("os");
const path = require("path");
const { pathToFileURL } = require("url");
const { parseEnv, resolveAnthropicEnvironment } = require("./config/environment.cjs");
const { createResumePaths } = require("./resume/paths.cjs");
const { createAnthropicClient } = require("./anthropic/apiClient.cjs");

const root = path.resolve(__dirname, "..");
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const rejects = async (fn, label) => { try { await fn(); } catch { return; } throw new Error(`Accepted ${label}`); };

async function main() {
  const parsed = parseEnv("# comment\r\n ANTHROPIC_API_KEY = 'fake-key' \r\nEMPTY=\r\nQUOTED=\"value\"\r\n");
  assert(parsed.ANTHROPIC_API_KEY === "fake-key" && parsed.QUOTED === "value", "Environment parser failed");
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "jobtrack-env-"));
  fs.writeFileSync(path.join(temp, ".env"), "ANTHROPIC_API_KEY=file-key\n", "utf8");
  assert(resolveAnthropicEnvironment({ env: { ANTHROPIC_API_KEY: "process-key" }, projectRoot: temp }).key === "process-key", "Process environment did not take precedence");
  assert(resolveAnthropicEnvironment({ env: {}, projectRoot: temp }).key === "file-key", "Root .env was not loaded");
  assert(!resolveAnthropicEnvironment({ env: {}, projectRoot: path.join(temp, "missing") }).configured, "Missing key reported configured");
  fs.rmSync(temp, { recursive: true });
  assert(fs.readFileSync(path.join(root, ".gitignore"), "utf8").split(/\r?\n/).includes(".env"), ".env is not gitignored");
  assert(fs.readFileSync(path.join(root, ".env.example"), "utf8").trim() === "ANTHROPIC_API_KEY=your_anthropic_api_key_here", ".env.example is unsafe");
  const preload = fs.readFileSync(path.join(root, "electron", "preload.cjs"), "utf8");
  const renderer = fs.readFileSync(path.join(root, "src", "components", "AiResumePage.jsx"), "utf8");
  const jobDetails = fs.readFileSync(path.join(root, "src", "components", "JobDetails.jsx"), "utf8");
  const quickGenerate = fs.readFileSync(path.join(root, "src", "components", "QuickGenerateModal.jsx"), "utf8");
  const generationHook = fs.readFileSync(path.join(root, "src", "hooks", "useDocumentGeneration.js"), "utf8");
  assert(!preload.includes("ANTHROPIC_API_KEY") && !renderer.includes("ANTHROPIC_API_KEY"), "API key name reached preload or AI Resume renderer");
  assert(!preload.includes("saveApiKey") && !preload.includes("deleteApiKey"), "Preload exposes API key mutation");
  const fakeApp = { isPackaged: false, getPath: name => name === "documents" ? path.join(root, "resume", "output") : root };
  const paths = createResumePaths({ app: fakeApp, rootDir: root });
  assert(paths.resolveGeneratedFile("example-resume.pdf").startsWith(paths.outputDir), "Generated path escaped output directory");
  await rejects(() => Promise.resolve(paths.resolveGeneratedFile("..\\private.pdf")), "arbitrary generated path");
  const packagedDocuments = path.join(root, "resume", "output", ".packaged-documents");
  const packagedPaths = createResumePaths({ app: { isPackaged: true, getPath: () => packagedDocuments }, rootDir: root });
  assert(packagedPaths.outputDir === path.join(packagedDocuments, "JobTrack", "Resumes"), "Packaged output is not in Documents");
  const client = createAnthropicClient({ maxRetries: 0, fetchImpl: async () => new Response(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "bad key" } }), { status: 401, headers: { "content-type": "application/json" } }) });
  try { await client.request({ apiKey: "invalid", body: {} }); } catch (error) { assert(error.code === "authentication_error", "Invalid key error was unclear"); }
  const generation = await import(pathToFileURL(path.join(root, "src", "utils", "resumeGeneration.js")).href);
  const identity = await import(pathToFileURL(path.join(root, "src", "generate", "profileIdentity.js")).href);
  const bank = JSON.parse(fs.readFileSync(path.join(root, "src", "generate", "content-bank.json"), "utf8"));
  let removed = 0; const api = { onGenerationEvent: () => () => { removed++; } }; const cleanup = generation.subscribeToGeneration(api, () => {}); cleanup(); assert(removed === 1, "Generation event listener was not removed");
  const missing = generation.missingGenerationRequirements({ status: { api: { configured: true }, tectonic: { available: true } }, job: { jd: "" }, active: false });
  assert(missing.includes("job description"), "Missing job description was not blocked");
  assert(!missing.includes("default Application Profile") && !missing.includes("profile name"), "Profile remains a UI prerequisite");
  const profileIdentity = identity.resolveResumeIdentity({ profile: { fullName: "Profile Name", email: "profile@example.test" }, bank });
  assert(profileIdentity.name === "Profile Name", "Valid profile did not override bank identity");
  const bankIdentity = identity.resolveResumeIdentity({ profile: { fullName: "", email: "" }, bank });
  assert(bankIdentity.name === bank.identity.name, "Incomplete profile did not fall back to bank identity");
  let missingIdentity = false; try { identity.resolveResumeIdentity({ profile: null, bank: { identity: { name: "", email: "", links: {} } } }); } catch (error) { missingIdentity = error.code === "MISSING_PROFILE"; }
  assert(missingIdentity, "Invalid profile and bank did not return MISSING_PROFILE");
  assert(!renderer.includes("ResumeGenerationPanel") && !renderer.includes("selectedJobId"), "AI Resume page still owns job generation");
  assert(jobDetails.includes("Generate") && !jobDetails.includes("ai-resume"), "Saved-job Generate action or tab cleanup missing");
  assert(quickGenerate.includes("navigator.clipboard?.readText") && quickGenerate.includes("looksLikeJobDescription"), "Quick Generate clipboard filtering missing");
  assert(!quickGenerate.includes("addJob(") && quickGenerate.includes("quickGenerationHistoryEntry"), "Quick Generate mutates jobs or lacks history metadata");
  assert(generationHook.includes("requirements: resume.requirements, finalCoverage: resume.finalCoverage"), "Cover letter does not reuse final V2 requirements and coverage");
  assert(generationHook.includes("clearInterval") && generationHook.includes("subscribeToGeneration"), "Timer or listener cleanup missing");
  console.log(JSON.stringify({ envParser: true, processPrecedence: true, envGitignored: true, keyBoundary: true, missingKeyStatus: true, invalidKeyError: true, profileOptional: true, identityFallback: true, savedJobFlow: true, quickGenerate: true, reuseFinalV2Coverage: true, securePaths: true, listenerCleanup: true }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
