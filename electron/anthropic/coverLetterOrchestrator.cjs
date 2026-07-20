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
  return async function orchestrateCoverLetter({ job: rawJob, analysis, selection, signal, progress }) {
    const apiKey = keyProvider.readKey();
    if (!apiKey) throw codedError("KEY_NOT_CONFIGURED", "Anthropic API key is not configured.");
    const job = sanitizeJob(rawJob);
    const [identityModule, renderer, pricingModule, fileNameModule] = await Promise.all(["profileIdentity", "renderCoverLetter", "modelPricing", "resumeFileName"].map((name) => load(path.join(generateDir, `${name}.js`))));
    const bank = JSON.parse(fs.readFileSync(path.join(generateDir, "content-bank.json"), "utf8"));
    let identity; try { identity = identityModule.resolveResumeIdentity({ profile: getDefaultProfile(), bank }); } catch (error) { throw codedError("MISSING_PROFILE", error.message); }
    identityModule.validateFinalIdentity(identity);
    if (!fs.existsSync(paths.template("cover-letter.tex"))) throw codedError("MISSING_TEMPLATE", "The cover-letter template is missing.");
    const generated = await generateCoverLetter({ client, apiKey, bank, job, analysis, selection, signal, generateDir, progress });
    progress?.("Preparing cover letter PDF");
    const tex = renderer.renderCoverLetter({ bank, content: generated.content, identity, job });
    paths.ensureOutputDir();
    const texFileName = `${renderer.safeCoverLetterFileName(job.company, job.title)}-${Date.now()}.tex`;
    fs.writeFileSync(paths.resolveGeneratedFile(texFileName, ".tex"), tex, "utf8");
    const compiled = await compileResumeTex(texFileName);
    if (!compiled.ok) throw codedError(compiled.error.code, compiled.error.message);
    const pageCount = countPages(paths.resolveGeneratedFile(compiled.pdfFileName, ".pdf"));
    if (pageCount !== 1) throw codedError("VALIDATION_FAILED", `Generated cover letter is ${pageCount || "an unknown number of"} pages instead of one.`);
    const atsIntegrity = verifyPdfAtsIntegrity(paths.resolveGeneratedFile(compiled.pdfFileName, ".pdf"), { expectedName: identity.name, headings: [] });
    if (!atsIntegrity.valid) throw codedError("VALIDATION_FAILED", `Cover letter PDF text-layer check failed: ${atsIntegrity.errors.join("; ")}`);
    const usage = pricingModule.normalizeUsage(generated.model, generated.usage);
    return { content: generated.content, humanized: generated.humanized, texFileName, pdfFileName: compiled.pdfFileName, pageCount, atsIntegrity, atsWarning: ATS_WARNING, suggestedFileName: fileNameModule.userFacingFileName({ kind: "coverLetter", company: job.company, role: job.title }), model: generated.model, usage: { analysis: pricingModule.normalizeUsage("", {}), resumeSelection: pricingModule.normalizeUsage("", {}), coverLetter: usage }, estimatedCostUsd: pricingModule.estimateUsageCostUsd(usage), outputDisplayPath: paths.displayPath };
  };
}

module.exports = { createCoverLetterOrchestrator };
