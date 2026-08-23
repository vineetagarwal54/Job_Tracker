const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { generateCoverLetter } = require("./generateCoverLetter.cjs");
const { sanitizeJob } = require("./validation.cjs");
const { countPages, ATS_WARNING } = require("./orchestrator.cjs");
const { verifyPdfAtsIntegrity } = require("../resume/pdfVerify.cjs");
const { sanitizeDiagnosticMessage } = require("./tailoringDiagnostics.cjs");

const load = (file) => import(pathToFileURL(file).href);
const codedError = (code, message) => Object.assign(new Error(message), { code });

function createCoverLetterOrchestrator({ rootDir, client, keyProvider, getDefaultProfile, compileResumeTex, paths }) {
  const generateDir = path.join(rootDir, "src", "generate");
  return async function orchestrateCoverLetter({ job: rawJob, selection, resumeText = "", requirements = [], finalCoverage = null, signal, progress }) {
    const apiKey = keyProvider.readKey();
    if (!apiKey) throw codedError("KEY_NOT_CONFIGURED", "Anthropic API key is not configured.");
    const job = sanitizeJob(rawJob);
    const [identityModule, renderer, pricingModule, fileNameModule] = await Promise.all(["profileIdentity", "renderCoverLetter", "modelPricing", "resumeFileName"].map((name) => load(path.join(generateDir, `${name}.js`))));
    const bank = JSON.parse(fs.readFileSync(path.join(generateDir, "content-bank.json"), "utf8"));
    let identity; try { identity = identityModule.resolveResumeIdentity({ profile: getDefaultProfile(), bank }); } catch (error) { throw codedError("MISSING_PROFILE", error.message); }
    identityModule.validateFinalIdentity(identity);
    if (!fs.existsSync(paths.template("cover-letter.tex"))) throw codedError("MISSING_TEMPLATE", "The cover-letter template is missing.");
    if (!resumeText && !selection) throw codedError("VALIDATION_FAILED", "Select a generated resume or a readable local PDF.");
    const generated = await generateCoverLetter({ client, apiKey, bank, job, selection, resumeText, requirements, finalCoverage, signal, generateDir, progress });
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
    let output;
    let usedPageFitFallback = false;
    let diagnostics = generated.diagnostics;
    try { output = await compileContent(generated.content); }
    catch (error) {
      if (generated.usedFallback) throw error;
      progress?.("Using concise verified cover letter fallback");
      output = await compileContent(generated.conservativeContent);
      usedPageFitFallback = true;
      diagnostics = { fallbackType: "render/page-fit fallback", stage: "render", code: String(error?.code || "RENDER_FAILED"), reason: sanitizeDiagnosticMessage(error?.message), apiDurationMs: generated.apiDurationMs, usage: generated.usage, evidenceIds: generated.evidence.map((item) => item.id) };
    }
    if (output.pageCount !== 1 && !generated.usedFallback && !usedPageFitFallback) {
      const generatedPageCount = output.pageCount;
      progress?.("Using concise verified cover letter fallback");
      output = await compileContent(generated.conservativeContent);
      usedPageFitFallback = true;
      diagnostics = { fallbackType: "render/page-fit fallback", stage: "page-fit", code: "PAGE_OVERFLOW", reason: `Generated cover letter rendered to ${generatedPageCount || "an unknown number of"} pages.`, apiDurationMs: generated.apiDurationMs, usage: generated.usage, evidenceIds: generated.evidence.map((item) => item.id) };
    }
    const { compiled, pageCount } = output;
    if (pageCount !== 1) throw codedError("VALIDATION_FAILED", `Generated cover letter is ${pageCount || "an unknown number of"} pages instead of one.`);
    const atsIntegrity = verifyPdfAtsIntegrity(paths.resolveGeneratedFile(compiled.pdfFileName, ".pdf"), { expectedName: identity.name, headings: [] });
    // The text-layer check never blocks a finished cover letter; any finding
    // rides along as a warning next to the returned result.
    const warnings = (atsIntegrity.warnings || []).map((message) => ({ type: "ats-text-layer", severity: "info", message }));
    const usage = pricingModule.normalizeUsage(generated.model, generated.usage);
    return { content: output.content, fallback: generated.usedFallback || usedPageFitFallback, fallbackDiagnostics: diagnostics, modelCalls: generated.modelCalls, evidenceIds: generated.evidence.map((item) => item.id), requirementMatches: generated.requirementMatches, apiDurationMs: generated.apiDurationMs, texFileName, pdfFileName: compiled.pdfFileName, pageCount, atsIntegrity, atsWarning: ATS_WARNING, warnings, suggestedFileName: fileNameModule.userFacingFileName({ kind: "coverLetter", company: job.company, role: job.title }), model: generated.model, usage: { analysis: pricingModule.normalizeUsage("", {}), resumeSelection: pricingModule.normalizeUsage("", {}), coverLetter: usage }, estimatedCostUsd: pricingModule.estimateUsageCostUsd(usage), outputDisplayPath: paths.displayPath };
  };
}

module.exports = { createCoverLetterOrchestrator };
