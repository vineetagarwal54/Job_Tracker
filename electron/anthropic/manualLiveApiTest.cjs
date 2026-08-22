const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { createAnthropicClient } = require("./apiClient.cjs");
const { analyzeJob } = require("./analyzeJob.cjs");
const { generateResumeSelection } = require("./generateResumeSelection.cjs");

const load = (file) => import(pathToFileURL(file).href);

async function main() {
  const mode = process.argv[2];
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || !["analyze", "generate"].includes(mode)) throw new Error("Usage: set ANTHROPIC_API_KEY, then run node electron/anthropic/manualLiveApiTest.cjs analyze|generate");
  const root = path.resolve(__dirname, "..", "..");
  const generateDir = path.join(root, "src", "generate");
  const client = createAnthropicClient();
  const job = { title: "Example AI Engineer", company: "Example Robotics", description: "Build Python model serving systems for large language models. Experience with TensorRT-LLM and AWS is preferred. Candidates must collaborate on benchmarking and numerical validation.", resumeOption: "AI / LLM", baseResumeId: "ai" };
  const analyzed = await analyzeJob({ client, apiKey, job, generateDir });
  if (mode === "analyze") {
    console.log(JSON.stringify({ model: analyzed.model, analysis: analyzed.analysis, usage: analyzed.usage }, null, 2));
    return;
  }

  const bank = JSON.parse(fs.readFileSync(path.join(generateDir, "content-bank.json"), "utf8"));
  const [{ extractJobKeywords }, { getCanonicalBaseForOption }, { buildRelevancePlan }] = await Promise.all([
    load(path.join(generateDir, "keywordExtraction.js")),
    load(path.join(generateDir, "baseResumes.js")),
    load(path.join(generateDir, "relevanceIntelligence.js")),
  ]);
  const base = getCanonicalBaseForOption(job.resumeOption);
  const extraction = extractJobKeywords(job.description);
  const relevancePlan = buildRelevancePlan({ bank, base, job, extraction, analysis: analyzed.analysis });
  const result = await generateResumeSelection({ client, apiKey, bank, base, job, analysis: analyzed.analysis, extraction, coverage: relevancePlan.baseCoverage, relevancePlan, generateDir, progress: console.error });
  console.log(JSON.stringify({ model: result.model, proposedDiff: result.proposedDiff, acceptedDiff: result.acceptedDiff, rejected: result.rejected, cacheUsage: result.cacheUsage }, null, 2));
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
