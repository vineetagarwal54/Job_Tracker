const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { generateCoverLetter } = require("./generateCoverLetter.cjs");
const { sanitizeJob } = require("./validation.cjs");
const { countPages, ATS_WARNING } = require("./orchestrator.cjs");
const { verifyPdfAtsIntegrity } = require("../resume/pdfVerify.cjs");

const load = (file) => import(pathToFileURL(file).href);
const codedError = (code, message) => Object.assign(new Error(message), { code });

function createCoverLetterOrchestrator({ rootDir, client, keyProvider, getDefaultProfile, compileResumeTex, paths }) {
  const generateDir = path.join(rootDir, "src", "generate");
  return async function orchestrateCoverLetter({ job: rawJob, analysis, selection, resumeText = "", signal, progress }) {
    const apiKey = keyProvider.readKey();
    if (!apiKey) throw codedError("KEY_NOT_CONFIGURED", "Anthropic API key is not configured.");
    const job = sanitizeJob(rawJob);
    const [identityModule, renderer, pricingModule, fileNameModule, keywordModule, fallbackModule] = await Promise.all(["profileIdentity", "renderCoverLetter", "modelPricing", "resumeFileName", "keywordExtraction", "fallbackAnalysis"].map((name) => load(path.join(generateDir, `${name}.js`))));
    const bank = JSON.parse(fs.readFileSync(path.join(generateDir, "content-bank.json"), "utf8"));
    let identity; try { identity = identityModule.resolveResumeIdentity({ profile: getDefaultProfile(), bank }); } catch (error) { throw codedError("MISSING_PROFILE", error.message); }
    identityModule.validateFinalIdentity(identity);
    if (!fs.existsSync(paths.template("cover-letter.tex"))) throw codedError("MISSING_TEMPLATE", "The cover-letter template is missing.");
    if (!resumeText && !selection) throw codedError("VALIDATION_FAILED", "Select a generated resume or a readable local PDF.");
    const effectiveAnalysis = analysis || fallbackModule.buildFallbackAnalysis({ extraction: keywordModule.extractJobKeywords(job.description), job, variant: selection?.variant || "fullstack" });
    const generated = await generateCoverLetter({ client, apiKey, bank, job, analysis: effectiveAnalysis, selection, resumeText, signal, generateDir, progress });
    paths.ensureOutputDir();
    const texFileName = `${renderer.safeCoverLetterFileName(job.company, job.title)}-${Date.now()}.tex`;
    const validationOptions = { jobDescription: job.description, evidenceText: generated.evidence.map((item) => item.text).join(" ") };
    const compileContent = async (content) => {
      const tex = renderer.renderCoverLetter({ bank, content, identity, job, validationOptions });
      fs.writeFileSync(paths.resolveGeneratedFile(texFileName, ".tex"), tex, "utf8");
      const compiled = await compileResumeTex(texFileName);
      if (!compiled.ok) throw codedError(compiled.error.code, compiled.error.message);
      return { content, compiled, pageCount: countPages(paths.resolveGeneratedFile(compiled.pdfFileName, ".pdf")) };
    };
    progress?.("Preparing cover letter PDF");
    let output = await compileContent(generated.content);
    let usedPageFitFallback = false;
    if (output.pageCount !== 1 && !generated.usedFallback) {
      progress?.("Using concise verified cover letter fallback");
      output = await compileContent(generated.conservativeContent);
      usedPageFitFallback = true;
    }
    const { compiled, pageCount } = output;
    if (pageCount !== 1) throw codedError("VALIDATION_FAILED", `Generated cover letter is ${pageCount || "an unknown number of"} pages instead of one.`);
    const atsIntegrity = verifyPdfAtsIntegrity(paths.resolveGeneratedFile(compiled.pdfFileName, ".pdf"), { expectedName: identity.name, headings: [] });
    // The text-layer check never blocks a finished cover letter; any finding
    // rides along as a warning next to the returned result.
    const warnings = (atsIntegrity.warnings || []).map((message) => ({ type: "ats-text-layer", severity: "info", message }));
    const usage = pricingModule.normalizeUsage(generated.model, generated.usage);
    return { content: output.content, fallback: generated.usedFallback || usedPageFitFallback, modelCalls: generated.modelCalls, evidenceIds: generated.evidence.map((item) => item.id), texFileName, pdfFileName: compiled.pdfFileName, pageCount, atsIntegrity, atsWarning: ATS_WARNING, warnings, suggestedFileName: fileNameModule.userFacingFileName({ kind: "coverLetter", company: job.company, role: job.title }), model: generated.model, usage: { analysis: pricingModule.normalizeUsage("", {}), resumeSelection: pricingModule.normalizeUsage("", {}), coverLetter: usage }, estimatedCostUsd: pricingModule.estimateUsageCostUsd(usage), outputDisplayPath: paths.displayPath };
  };
}

module.exports = { createCoverLetterOrchestrator };
