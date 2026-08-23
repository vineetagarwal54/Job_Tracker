const path = require("path");
const { pathToFileURL } = require("url");
const { createAnthropicClient } = require("./apiClient.cjs");
const { generateSemanticResumeOptimization } = require("./semanticResumeOptimizer.cjs");

async function main() {
  if (process.env.JOBTRACK_RUN_LIVE_GOLDEN !== "1" || !process.env.ANTHROPIC_API_KEY) {
    console.log("Live semantic golden evaluation skipped. Set JOBTRACK_RUN_LIVE_GOLDEN=1 and ANTHROPIC_API_KEY to opt in.");
    return;
  }
  const root = path.resolve(__dirname, "..", "..");
  const generateDir = path.join(root, "src", "generate");
  const load = (name) => import(pathToFileURL(path.join(generateDir, `${name}.js`)).href);
  const [{ semanticGoldenFixtures }, { getCanonicalBaseResume }] = await Promise.all([load("semanticGoldenFixtures"), load("baseResumes")]);
  const bank = require("../../src/generate/content-bank.json");
  const client = createAnthropicClient();
  const discrepancies = [];
  for (const fixture of semanticGoldenFixtures) {
    try {
      const result = await generateSemanticResumeOptimization({ client, apiKey: process.env.ANTHROPIC_API_KEY, bank, base: getCanonicalBaseResume(fixture.baseResumeId), job: { title: fixture.id, description: fixture.job }, generateDir });
      const cited = new Set(result.requirements.flatMap((item) => [...item.currentEvidenceIds, ...item.candidateEvidenceIds, ...item.knowledgeSkillIds]));
      for (const expected of fixture.expected.requirements) if (!expected.validEvidenceIds.some((id) => cited.has(id))) discrepancies.push({ fixture: fixture.id, issue: "missing expected evidence match", allowedEvidenceIds: expected.validEvidenceIds });
      for (const term of fixture.expected.unsupported) if (!result.requirements.some((item) => item.status === "unsupported" && item.text.toLowerCase().includes(term.toLowerCase()))) discrepancies.push({ fixture: fixture.id, issue: `unsupported requirement not retained: ${term}` });
      if (!fixture.expected.allowedChangeTypes.length && [result.acceptedDiff.summaryChange, result.acceptedDiff.projectSwap, ...result.acceptedDiff.bulletChanges, ...result.acceptedDiff.skillChanges].filter(Boolean).length) discrepancies.push({ fixture: fixture.id, issue: "expected zero changes" });
    } catch (error) { discrepancies.push({ fixture: fixture.id, issue: error.message }); }
  }
  console.log(JSON.stringify({ fixtures: semanticGoldenFixtures.length, discrepancies }, null, 2));
  if (discrepancies.length) process.exitCode = 1;
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
