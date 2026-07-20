const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { pathToFileURL } = require("url");
const { analyzeJob } = require("./analyzeJob.cjs");
const { generateResumeSelection } = require("./generateResumeSelection.cjs");
const { sanitizeJob } = require("./validation.cjs");
const { verifyPdfAtsIntegrity } = require("../resume/pdfVerify.cjs");

const ATS_WARNING =
  "Upload this PDF as-is. Avoid Print to PDF or image conversion, which may remove the text layer used by applicant tracking systems.";

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
    const [keywordModule, coverageModule, identityModule, renderModule, verifyModule, pricingModule, pageFittingModule, fileNameModule] = await Promise.all(["keywordExtraction", "coverageScoring", "profileIdentity", "renderResume", "postRenderVerification", "modelPricing", "pageFitting", "resumeFileName"].map((name) => load(path.join(generateDir, `${name}.js`))));
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
    const template = fs.readFileSync(templatePath, "utf8");
    paths.ensureOutputDir();
    const texFileName = `${renderModule.safeResumeFileName(job.company, job.title)}-resume-${Date.now()}.tex`;

    // Compile-verify loop (Phase 8): the PDF page count is ground truth. If it
    // exceeds one page, deterministically drop the lowest-value nonmandatory
    // bullet and recompile. Retry up to three times; mandatory content is never
    // removed. No extra API call is made during trimming.
    let currentSelection = generated.selection;
    let rendered;
    let compiled;
    let pageCount = null;
    const removedForFit = [];
    for (let attempt = 0; attempt <= 3; attempt += 1) {
      rendered = renderModule.renderResume({ bank, selection: currentSelection, template, identity });
      fs.writeFileSync(paths.resolveGeneratedFile(texFileName, ".tex"), rendered.tex, "utf8");
      progress?.(attempt === 0 ? "Compiling resume PDF" : `Refitting to one page (attempt ${attempt})`);
      compiled = await compileResumeTex(texFileName);
      if (!compiled.ok) throw codedError(compiled.error.code, compiled.error.message);
      pageCount = countPages(paths.resolveGeneratedFile(compiled.pdfFileName, ".pdf"));
      if (pageCount === 1) break;
      if (attempt === 3) throw codedError("VALIDATION_FAILED", `Generated resume is ${pageCount || "an unknown number of"} pages after trimming.`);
      const trim = pageFittingModule.trimOneBullet(bank, currentSelection);
      if (!trim) throw codedError("VALIDATION_FAILED", "Resume exceeds one page and no nonmandatory bullet can be trimmed.");
      removedForFit.push(trim.removed);
      currentSelection = trim.selection;
    }

    progress?.("Verifying PDF text layer");
    const atsIntegrity = verifyPdfAtsIntegrity(paths.resolveGeneratedFile(compiled.pdfFileName, ".pdf"), { expectedName: identity.name });
    if (!atsIntegrity.valid) throw codedError("VALIDATION_FAILED", `PDF ATS integrity check failed: ${atsIntegrity.errors.join("; ")}`);

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
      atsIntegrity, atsWarning: ATS_WARNING, removedForFit,
      suggestedFileName: fileNameModule.userFacingFileName({ kind: "resume", company: job.company, role: job.title }),
      models: { analysis: analyzed.model, resumeSelection: generated.model }, usage,
      estimatedCostUsd: pricingModule.estimateGenerationCostUsd({ analysis: usage.analysis, resumeSelection: usage.resumeSelection }),
      outputDisplayPath: paths.displayPath,
    };
  };
}

module.exports = { createOrchestrator, countPages, ATS_WARNING };
