const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { pathToFileURL } = require("url");
const { analyzeJob } = require("./analyzeJob.cjs");
const { generateResumeSelection } = require("./generateResumeSelection.cjs");
const { sanitizeJob } = require("./validation.cjs");

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
  return chunks.join("\n").match(/\/Type\s*\/Page(?!s)\b/g)?.length || null;
};

function codedError(code, message) { return Object.assign(new Error(message), { code }); }

function createOrchestrator({ rootDir, client, keyProvider, getDefaultProfile, compileResumeTex, paths }) {
  const generateDir = path.join(rootDir, "src", "generate");
  return async function orchestrate({ job: rawJob, signal, progress }) {
    const apiKey = keyProvider.readKey();
    if (!apiKey) throw codedError("KEY_NOT_CONFIGURED", "Anthropic API key is not configured.");
    let job;
    try { job = sanitizeJob(rawJob); } catch (error) { throw codedError(/description/i.test(error.message) ? "MISSING_JOB_DESCRIPTION" : "VALIDATION_FAILED", error.message); }
    progress?.("Analyzing job requirements");
    const [keywordModule, coverageModule, identityModule, renderModule, verifyModule, pricingModule] = await Promise.all(["keywordExtraction", "coverageScoring", "profileIdentity", "renderResume", "postRenderVerification", "modelPricing"].map((name) => load(path.join(generateDir, `${name}.js`))));
    const bank = JSON.parse(fs.readFileSync(path.join(generateDir, "content-bank.json"), "utf8"));
    let identity; try { identity = identityModule.resolveResumeIdentity({ profile: getDefaultProfile(), bank }); } catch (error) { throw codedError("MISSING_PROFILE", error.message); }
    const extraction = keywordModule.extractJobKeywords(job.description);
    const analyzed = await analyzeJob({ client, apiKey, job, signal, generateDir });
    progress?.("Selecting resume variant");
    const preliminaryCoverage = coverageModule.scoreCoverage(bank, extraction, { analysis: analyzed.analysis });
    const generated = await generateResumeSelection({ client, apiKey, bank, job, analysis: analyzed.analysis, extraction, coverage: preliminaryCoverage, variant: analyzed.analysis.recommendedVariant, signal, generateDir, progress });
    progress?.("Fitting content to one page");
    const templatePath = paths.template("main.tex");
    if (!fs.existsSync(templatePath)) throw codedError("MISSING_TEMPLATE", "The resume template is missing.");
    const rendered = renderModule.renderResume({ bank, selection: generated.selection, template: fs.readFileSync(templatePath, "utf8"), identity });
    paths.ensureOutputDir();
    const base = `${renderModule.safeResumeFileName(job.company, job.title)}-resume-${Date.now()}`;
    const texFileName = `${base}.tex`;
    fs.writeFileSync(paths.resolveGeneratedFile(texFileName, ".tex"), rendered.tex, "utf8");
    progress?.("Compiling resume PDF");
    const compiled = await compileResumeTex(texFileName);
    if (!compiled.ok) throw codedError(compiled.error.code, compiled.error.message);
    const pageCount = countPages(paths.resolveGeneratedFile(compiled.pdfFileName, ".pdf"));
    if (pageCount !== 1) throw codedError("VALIDATION_FAILED", `Generated resume is ${pageCount || "an unknown number of"} pages instead of one.`);
    progress?.("Checking final keyword coverage");
    const finalVerification = verifyModule.verifyFinalResume({ bank, extraction, analysis: analyzed.analysis, finalSelection: rendered.finalSelection, budget: rendered.budget, pageCount });
    const usage = {
      analysis: pricingModule.normalizeUsage(analyzed.model, analyzed.usage),
      resumeSelection: pricingModule.normalizeUsage(generated.model, generated.usage),
      coverLetter: pricingModule.normalizeUsage(generated.model, {}),
    };
    return {
      job: { company: job.company, title: job.title }, analysis: analyzed.analysis, preliminaryCoverage,
      selection: rendered.finalSelection, budget: rendered.budget, finalCoverage: finalVerification.coverage,
      verification: finalVerification, texFileName, pdfFileName: compiled.pdfFileName, pageCount,
      models: { analysis: analyzed.model, resumeSelection: generated.model }, usage,
      estimatedCostUsd: pricingModule.estimateGenerationCostUsd({ analysis: usage.analysis, resumeSelection: usage.resumeSelection }),
      outputDisplayPath: paths.displayPath,
    };
  };
}

module.exports = { createOrchestrator, countPages };
