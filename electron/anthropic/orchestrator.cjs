const fs = require("fs"); const path = require("path"); const zlib = require("zlib"); const { pathToFileURL } = require("url");
const { analyzeJob } = require("./analyzeJob.cjs"); const { generateResumeSelection } = require("./generateResumeSelection.cjs"); const { sanitizeJob } = require("./validation.cjs");
const load = (file) => import(pathToFileURL(file).href);
const countPages = (file) => {
  const bytes = fs.readFileSync(file); const chunks = [bytes.toString("latin1")]; let cursor = 0;
  while ((cursor = bytes.indexOf(Buffer.from("stream"), cursor)) !== -1) {
    let start = cursor + 6; if (bytes[start] === 13) start++; if (bytes[start] === 10) start++;
    const end = bytes.indexOf(Buffer.from("endstream"), start); if (end === -1) break;
    let compressedEnd = end; while (compressedEnd > start && (bytes[compressedEnd - 1] === 10 || bytes[compressedEnd - 1] === 13)) compressedEnd--;
    try { chunks.push(zlib.inflateSync(bytes.subarray(start, compressedEnd)).toString("latin1")); } catch {}
    cursor = end + 9;
  }
  const matches = chunks.join("\n").match(/\/Type\s*\/Page(?!s)\b/g); return matches?.length || null;
};

function createOrchestrator({ rootDir, client, keyStore, getDefaultProfile, compileResumeTex }) {
  const generateDir = path.join(rootDir, "src", "generate"); const outputDir = path.join(rootDir, "resume", "output");
  return async function orchestrate({ job: rawJob, signal, progress }) {
    const apiKey = keyStore.readKey(); if (!apiKey) throw new Error("Anthropic API key is not configured.");
    const job = sanitizeJob(rawJob); progress?.("Analyzing requirements");
    const [keywordModule, coverageModule, identityModule, renderModule, verifyModule] = await Promise.all(["keywordExtraction", "coverageScoring", "profileIdentity", "renderResume", "postRenderVerification"].map((name) => load(path.join(generateDir, `${name}.js`))));
    const profile = getDefaultProfile(); if (!profile) throw new Error("No default JobTrack Application Profile exists.");
    const identity = identityModule.applicationProfileToIdentity(profile);
    const bank = JSON.parse(fs.readFileSync(path.join(generateDir, "content-bank.json"), "utf8"));
    const extraction = keywordModule.extractJobKeywords(job.description);
    const analyzed = await analyzeJob({ client, apiKey, job, signal, generateDir });
    const preliminaryCoverage = coverageModule.scoreCoverage(bank, extraction, { analysis: analyzed.analysis });
    const generated = await generateResumeSelection({ client, apiKey, bank, job, analysis: analyzed.analysis, extraction, coverage: preliminaryCoverage, variant: analyzed.analysis.recommendedVariant, signal, generateDir, progress });
    const templatePath = path.join(rootDir, "resume", "template", "main.tex"); if (!fs.existsSync(templatePath)) throw new Error("The resume template is missing.");
    const rendered = renderModule.renderResume({ bank, selection: generated.selection, template: fs.readFileSync(templatePath, "utf8"), identity });
    fs.mkdirSync(outputDir, { recursive: true }); const base = renderModule.safeResumeFileName(job.company, job.title); const texFileName = `${base}.tex`; const texPath = path.join(outputDir, texFileName); fs.writeFileSync(texPath, rendered.tex, "utf8");
    const compiled = await compileResumeTex(texFileName); if (!compiled.ok) { const error = new Error(compiled.error.message); error.code = compiled.error.code; throw error; }
    const pageCount = countPages(path.join(outputDir, compiled.pdfFileName));
    const finalVerification = verifyModule.verifyFinalResume({ bank, extraction, analysis: analyzed.analysis, finalSelection: rendered.finalSelection, budget: rendered.budget, pageCount });
    return { analysis: analyzed.analysis, preliminaryCoverage, selection: rendered.finalSelection, budget: rendered.budget, finalCoverage: finalVerification.coverage, verification: finalVerification, texFileName, pdfFileName: compiled.pdfFileName, models: { analysis: analyzed.model, selection: generated.model }, cacheUsage: generated.cacheUsage };
  };
}
module.exports = { createOrchestrator, countPages };
