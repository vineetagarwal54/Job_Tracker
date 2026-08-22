const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { pathToFileURL } = require("url");
const { analyzeJob } = require("./analyzeJob.cjs");
const { generateResumeSelection } = require("./generateResumeSelection.cjs");
const { sanitizeJob } = require("./validation.cjs");
const { verifyPdfAtsIntegrity } = require("../resume/pdfVerify.cjs");
const { MODELS } = require("./models.cjs");

// A failure that is a user cancellation, never a candidate for fallback.
function isCancellation(error, signal) {
  return Boolean(signal?.aborted) || error?.code === "CANCELLED" || error?.name === "AbortError" || /\babort|cancel/i.test(String(error?.message || ""));
}

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

// Technical terms that must survive intact (no hyphenation split) in the
// extracted PDF text when they appear on the resume (task Part 4).
const TERM_WATCHLIST = Object.freeze([
  "Electron", "speculative decoding", "TensorRT-LLM", "Node.js", "CI/CD",
  "React Native", "LangGraph", "Kubernetes", "PostgreSQL", "FastAPI",
]);

// Flattens the rendered resume's bullet texts and skill items into one string so
// we only require intactness for terms that actually appear on the page.
function renderedResumeText(rendered) {
  const parts = [];
  const selection = rendered?.finalSelection || {};
  for (const section of ["experience", "projects"]) {
    for (const entry of selection[section] || []) {
      for (const bullet of entry.bullets || []) parts.push(bullet.rewrittenText || "");
    }
  }
  for (const group of rendered?.renderedSkills || []) parts.push((group.items || []).join(" "));
  // Bullet objects in the final selection may omit text when unchanged; use the
  // rendered document BODY (after \begin{document}) as the authoritative source
  // so preamble comments and macros are never mistaken for resume content.
  const tex = String(rendered?.tex || "");
  parts.push(tex.slice(tex.indexOf("\\begin{document}")));
  return parts.join(" ");
}

function createOrchestrator({ rootDir, client, keyProvider, getDefaultProfile, compileResumeTex, paths }) {
  const generateDir = path.join(rootDir, "src", "generate");
  return async function orchestrate({ job: rawJob, signal, progress }) {
    // Stage tracking (task Part 1): every genuine technical failure carries the
    // exact stage that failed so the UI can show a useful message while keeping
    // the technical detail in advanced diagnostics.
    let stage = "initialization";
    try {
      stage = "api-key";
      const apiKey = keyProvider.readKey();
      if (!apiKey) throw codedError("KEY_NOT_CONFIGURED", "Anthropic API key is not configured.");
      stage = "job-validation";
      let job;
      try { job = sanitizeJob(rawJob); } catch (error) { throw codedError(/description/i.test(error.message) ? "MISSING_JOB_DESCRIPTION" : "VALIDATION_FAILED", error.message); }
      progress?.("Analyzing job requirements");
      const [keywordModule, identityModule, renderModule, pricingModule, fileNameModule, fallbackModule, warningsModule, emphasisModule, baseModule, tailoringModule, relevanceModule, pageFitModule] = await Promise.all(["keywordExtraction", "profileIdentity", "renderResume", "modelPricing", "resumeFileName", "fallbackSelection", "resumeWarnings", "roleEmphasis", "baseResumes", "tailoringDiff", "relevanceIntelligence", "pageFitBackoff"].map((name) => load(path.join(generateDir, `${name}.js`))));
      stage = "content-bank";
      let bank;
      try { bank = JSON.parse(fs.readFileSync(path.join(generateDir, "content-bank.json"), "utf8")); } catch (error) { throw codedError("VALIDATION_FAILED", `The resume content bank is missing or corrupt: ${error.message}`); }
      const baseResumeId = job.baseResumeId || "swe-cloud";
      let canonicalBase;
      try { canonicalBase = baseModule.getCanonicalBaseResume(baseResumeId); } catch (error) { throw codedError("VALIDATION_FAILED", error.message); }
      stage = "identity";
      let identity; try { identity = identityModule.resolveResumeIdentity({ profile: getDefaultProfile(), bank }); } catch (error) { throw codedError("MISSING_PROFILE", error.message); }
      // Validate the final rendered identity: name, ten-digit phone, email, and
      // link formats. Malformed required fields fail with a specific identity
      // error; missing links become warnings.
      const identityWarnings = (identityModule.validateFinalIdentity(identity).warnings || []).map((message) => ({ type: "identity", severity: "info", message }));
      const extraction = keywordModule.extractJobKeywords(job.description);

      // --- Analysis (Haiku) with deterministic fallback. An eligibility or
      // classification problem is never fatal: a failed analysis falls back to
      // a deterministic classification derived from the keyword extraction. ---
      stage = "analysis";
      let analyzed;
      let usedAnalysisFallback = false;
      try {
        analyzed = await analyzeJob({ client, apiKey, job, signal, generateDir });
      } catch (error) {
        if (isCancellation(error, signal)) throw error;
        analyzed = { analysis: fallbackModule.buildFallbackAnalysis({ extraction, job, variant: canonicalBase.variant }), usage: null, model: analyzeModelName() };
        usedAnalysisFallback = true;
      }

      // Multiple role-emphasis tags steer the summary, bullet ranking, skills,
      // projects, and page-space allocation. The primary emphasis also chooses
      // the concrete resume variant (so an enterprise-AI JD renders the ai-llm
      // variant with the enterprise summary, not the inference summary).
      const emphasisResult = emphasisModule.classifyEmphases({ job, extraction, analysis: analyzed.analysis });
      const variant = canonicalBase.variant;

      progress?.("Selecting resume variant");
      const relevancePlan = relevanceModule.buildRelevancePlan({ bank, base: canonicalBase, job, extraction, analysis: analyzed.analysis });
      const preliminaryCoverage = relevancePlan.baseCoverage;

      // --- Selection (Sonnet) with universal deterministic fallback. If the
      // model response or its validation fails, keep the selected canonical base
      // unchanged so a bad model response cannot damage protected content. ---
      stage = "selection";
      let generated;
      let usedSelectionFallback = false;
      let selectionFallbackReason = null;
      try {
        generated = await generateResumeSelection({ client, apiKey, bank, base: canonicalBase, job, analysis: analyzed.analysis, extraction, coverage: preliminaryCoverage, relevancePlan, signal, generateDir, progress });
      } catch (error) {
        if (isCancellation(error, signal)) throw error;
        generated = { ...tailoringModule.applyTailoringDiff({ bank, base: canonicalBase, diff: { ...tailoringModule.EMPTY_TAILORING_DIFF, baseResumeId: canonicalBase.id }, extraction, analysis: analyzed.analysis, relevancePlan }), proposedDiff: null, usage: null, cacheUsage: null, model: MODELS.writing, usedFallback: true };
        usedSelectionFallback = true;
        selectionFallbackReason = error.message;
      }

      progress?.("Rendering tailored canonical base");
      stage = "template";
      const templatePath = paths.template("main.tex");
      if (!fs.existsSync(templatePath)) throw codedError("MISSING_TEMPLATE", "The resume template is missing.");
      const template = fs.readFileSync(templatePath, "utf8");
      paths.ensureOutputDir();
      const texFileName = `${renderModule.safeResumeFileName(job.company, job.title)}-resume-${Date.now()}.tex`;

      stage = "render-compile";
      const pageFit = await pageFitModule.fitTailoredBaseToOnePage({
        canonicalBase, tailoredBase: generated.base, acceptedDiff: generated.acceptedDiff, relevancePlan,
        renderAndCompile: async (candidateBase, attempt) => {
          const renderedAttempt = renderModule.renderCanonicalBase({ bank, base: candidateBase, template, identity });
          const finalSelection = tailoringModule.tailoredBaseEvidenceSelection(bank, candidateBase);
          renderedAttempt.finalSelection = finalSelection;
          renderedAttempt.renderedSkills = finalSelection.renderedSkills;
          renderedAttempt.budget = { included: [], excluded: [], usedLines: null, availableLines: null, remainingLines: null };
          fs.writeFileSync(paths.resolveGeneratedFile(texFileName, ".tex"), renderedAttempt.tex, "utf8");
          progress?.(attempt.attempt === 1 ? "Compiling resume PDF" : "Backing off tailoring to preserve one page");
          const compiledAttempt = await compileResumeTex(texFileName);
          if (!compiledAttempt.ok) throw codedError(compiledAttempt.error.code, compiledAttempt.error.message);
          return { rendered: renderedAttempt, compiled: compiledAttempt, pageCount: countPages(paths.resolveGeneratedFile(compiledAttempt.pdfFileName, ".pdf")) };
        },
      });
      generated = { ...generated, base: pageFit.base, acceptedDiff: pageFit.acceptedDiff, densityRatio: pageFit.densityRatio };
      const { rendered, compiled } = pageFit.result;
      const pageCount = pageFit.pageCount;
      const removedForFit = [];
      const addedForFit = [];

      progress?.("Verifying PDF text layer");
      stage = "ats-verification";
      // Technical terms that must not be split in the extracted text. Only those
      // actually present in the rendered resume are required.
      const requiredTerms = TERM_WATCHLIST.filter((term) => renderedResumeText(rendered).toLowerCase().includes(term.toLowerCase()));
      const atsIntegrity = verifyPdfAtsIntegrity(paths.resolveGeneratedFile(compiled.pdfFileName, ".pdf"), { expectedName: identity.name, requiredTerms });
      // The text-layer check never blocks a finished PDF; any finding rides
      // along as a warning next to the returned resume.
      const atsWarnings = (atsIntegrity.warnings || []).map((message) => ({ type: "ats-text-layer", severity: "info", message }));

      progress?.("Checking final keyword coverage");
      stage = "final-verification";
      const finalVerification = tailoringModule.verifyTailoredBase({ bank, base: generated.base, extraction, analysis: analyzed.analysis, pageCount });
      finalVerification.densityRatio = generated.densityRatio;
      const coverageImprovement = relevanceModule.summarizeCoverageChange(preliminaryCoverage, finalVerification.coverage);

      // Eligibility / mismatch warnings never block generation; they explain the
      // mismatch alongside the finished resume. Coverage here reflects only the
      // skills and bullets that actually shipped in the rendered document.
      const warnings = [
        ...warningsModule.buildResumeWarnings({
          job, analysis: analyzed.analysis, coverage: finalVerification.coverage,
          missingSkills: finalVerification.missingSkills || [],
          usedAnalysisFallback, usedSelectionFallback,
          requestedVariant: variant,
          renderedVariant: rendered.finalSelection.variant,
        }),
        ...identityWarnings,
        ...atsWarnings,
      ];

      const usage = {
        analysis: pricingModule.normalizeUsage(analyzed.model, analyzed.usage || {}),
        resumeSelection: pricingModule.normalizeUsage(generated.model, generated.usage || {}),
        coverLetter: pricingModule.normalizeUsage(generated.model, {}),
      };
      return {
        job: { company: job.company, title: job.title, resumeOption: job.resumeOption, baseResumeId: job.baseResumeId }, analysis: analyzed.analysis, preliminaryCoverage,
        baseResumeId: canonicalBase.id,
        selection: rendered.finalSelection, budget: rendered.budget, finalCoverage: finalVerification.coverage,
        tailoring: { proposedDiff: generated.proposedDiff, acceptedDiff: generated.acceptedDiff, rejected: generated.rejected, densityRatio: generated.densityRatio, candidateCount: relevancePlan.candidates.length, meaningfulGaps: relevancePlan.gaps, unsupportedMissing: relevancePlan.unsupportedMissing, beforeCoverage: preliminaryCoverage, afterCoverage: finalVerification.coverage, coverageImprovement, backedOffForFit: pageFit.backedOff, pageFitAttempts: pageFit.attempts },
        verification: finalVerification, texFileName, pdfFileName: compiled.pdfFileName, pageCount,
        atsIntegrity, atsWarning: ATS_WARNING, removedForFit, addedForFit,
        warnings,
        fallback: { analysis: usedAnalysisFallback, selection: usedSelectionFallback, reason: selectionFallbackReason },
        emphases: emphasisResult.emphases, primaryEmphasis: emphasisResult.primary,
        renderedSkills: rendered.renderedSkills || finalVerification.renderedSkills || null,
        suggestedFileName: fileNameModule.userFacingFileName({ kind: "resume", company: job.company, role: job.title }),
        models: { analysis: analyzed.model, resumeSelection: generated.model }, usage,
        estimatedCostUsd: pricingModule.estimateGenerationCostUsd({ analysis: usage.analysis, resumeSelection: usage.resumeSelection }),
        outputDisplayPath: paths.displayPath,
      };
    } catch (error) {
      if (error && !error.stage) error.stage = stage;
      throw error;
    }
  };
}

function analyzeModelName() { return MODELS.analysis; }

// Builds a model-shaped `generated` object entirely from the verified bank when
// the model selection fails. Tries the closest variant, then general
// software-engineering variants, so an unusual JD still yields a valid resume.
function buildFallbackGenerated({ fallbackModule, finalizeModule, bank, extraction, analysis, variant: preferredVariant = null, emphasisResult = null }) {
  const candidates = [];
  if (preferredVariant) candidates.push(preferredVariant);
  const first = fallbackModule.chooseFallbackVariant(bank, { analysis, extraction });
  if (!candidates.includes(first)) candidates.push(first);
  for (const variant of ["fullstack", "cloud-backend", "ai-llm", "mobile"]) {
    if (!candidates.includes(variant)) candidates.push(variant);
  }
  const emphasis = emphasisResult?.primary || null;
  const emphases = emphasisResult?.emphases || null;
  let lastError = null;
  for (const variant of candidates) {
    try {
      const raw = fallbackModule.buildDeterministicSelection(bank, { variant, extraction, analysis });
      const finalized = finalizeModule.finalizeSelection(bank, raw, { variant, extraction, analysis, emphasis, emphases });
      return { selection: finalized.selection, finalSelection: finalized.finalSelection, budget: finalized.budget, usage: null, cacheUsage: null, model: MODELS.writing, usedFallback: true };
    } catch (error) { lastError = error; }
  }
  throw lastError || codedError("VALIDATION_FAILED", "Deterministic fallback selection failed for every variant.");
}

module.exports = { createOrchestrator, countPages, ATS_WARNING };
