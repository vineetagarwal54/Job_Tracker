const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { pathToFileURL } = require("url");
const { generateSemanticResumeOptimization } = require("./semanticResumeOptimizer.cjs");
const { sanitizeJob } = require("./validation.cjs");
const { verifyPdfAtsIntegrity } = require("../resume/pdfVerify.cjs");
const { MODELS } = require("./models.cjs");
const { classifyTailoringFallback, logTailoringFallback } = require("./tailoringDiagnostics.cjs");

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

function createOrchestrator({ rootDir, client, keyProvider, getDefaultProfile, compileResumeTex, paths, logger = console }) {
  const generateDir = path.join(rootDir, "src", "generate");
  return async function orchestrate({ job: rawJob, signal, progress }) {
    const generationStartedAt = Date.now();
    const timings = { analysisMs: null, relevancePlanningMs: null, tailoringApiMs: null, compilePageFitMs: null, finalVerificationMs: null, totalMs: null };
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
      progress?.("Preparing verified resume evidence");
      const [identityModule, renderModule, pricingModule, fileNameModule, warningsModule, baseModule, tailoringModule, pageFitModule, semanticCoverageModule, blockerModule] = await Promise.all(["profileIdentity", "renderResume", "modelPricing", "resumeFileName", "resumeWarnings", "baseResumes", "tailoringDiff", "pageFitBackoff", "semanticRequirementCoverage", "eligibilityBlockers"].map((name) => load(path.join(generateDir, `${name}.js`))));
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
      const variant = canonicalBase.variant;
      timings.analysisMs = 0;
      timings.relevancePlanningMs = 0;

      // --- Selection (Sonnet) with universal deterministic fallback. If the
      // model response or its validation fails, keep the selected canonical base
      // unchanged so a bad model response cannot damage protected content. ---
      stage = "selection";
      let generated;
      let usedSelectionFallback = false;
      let selectionFallbackReason = null;
      let selectionFallbackDiagnostic = null;
      const selectionStartedAt = Date.now();
      try {
        generated = await generateSemanticResumeOptimization({ client, apiKey, bank, base: canonicalBase, job, signal, generateDir, progress });
        timings.tailoringApiMs = generated.apiDurationMs ?? (Date.now() - selectionStartedAt);
      } catch (error) {
        if (isCancellation(error, signal)) throw error;
        const completedDiagnostics = error.optimizerDiagnostics || {};
        generated = { ...tailoringModule.applyTailoringDiff({ bank, base: canonicalBase, diff: { ...tailoringModule.EMPTY_TAILORING_DIFF, baseResumeId: canonicalBase.id } }), proposedDiff: null, requirements: [], failedRequirementTrace: completedDiagnostics.requirementTrace || [], analysis: { roleFamily: job.title, seniority: "unknown", mustHaveKeywords: [], niceToHaveKeywords: [], responsibilities: [], blockers: blockerModule.detectExplicitEligibilityBlockers(job.description), recommendedVariant: canonicalBase.variant, reasoningSummary: "Semantic optimization failed; the selected canonical base was preserved unchanged." }, usage: completedDiagnostics.usage || null, cacheUsage: completedDiagnostics.cacheUsage || null, model: completedDiagnostics.model || MODELS.writing, usedFallback: true, backoffPlan: { candidates: [] }, requestMetrics: completedDiagnostics.requestMetrics || null };
        usedSelectionFallback = true;
        selectionFallbackDiagnostic = classifyTailoringFallback(error);
        selectionFallbackReason = selectionFallbackDiagnostic.message;
        logTailoringFallback(logger, selectionFallbackDiagnostic, error);
        timings.tailoringApiMs = completedDiagnostics.apiDurationMs ?? (Date.now() - selectionStartedAt);
      }
      const analyzed = { analysis: generated.analysis, usage: null, model: null };
      const usedAnalysisFallback = false;
      const preliminaryCoverage = semanticCoverageModule.computeSemanticRequirementCoverage(generated.requirements, canonicalBase, { version: 1, summaryChange: null, bulletChanges: [], projectSwap: null, skillChanges: [] });

      progress?.("Rendering tailored canonical base");
      stage = "template";
      const templatePath = paths.template("main.tex");
      if (!fs.existsSync(templatePath)) throw codedError("MISSING_TEMPLATE", "The resume template is missing.");
      const template = fs.readFileSync(templatePath, "utf8");
      paths.ensureOutputDir();
      const texFileName = `${renderModule.safeResumeFileName(job.company, job.title)}-resume-${Date.now()}.tex`;

      stage = "render-compile";
      const compileStartedAt = Date.now();
      const pageFit = await pageFitModule.fitTailoredBaseToOnePage({
        canonicalBase, tailoredBase: generated.base, acceptedDiff: generated.acceptedDiff, relevancePlan: generated.backoffPlan,
        renderAndCompile: async (candidateBase, attempt) => {
          const renderedAttempt = renderModule.renderCanonicalBase({ bank, base: candidateBase, template, identity });
          const finalSelection = tailoringModule.tailoredBaseEvidenceSelection(bank, candidateBase);
          renderedAttempt.finalSelection = finalSelection;
          renderedAttempt.renderedSkills = finalSelection.renderedSkills;
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
      timings.compilePageFitMs = Date.now() - compileStartedAt;

      progress?.("Verifying PDF text layer");
      stage = "ats-verification";
      // Technical terms that must not be split in the extracted text. Only those
      // actually present in the rendered resume are required.
      const requiredTerms = TERM_WATCHLIST.filter((term) => renderedResumeText(rendered).toLowerCase().includes(term.toLowerCase()));
      const atsIntegrity = verifyPdfAtsIntegrity(paths.resolveGeneratedFile(compiled.pdfFileName, ".pdf"), { expectedName: identity.name, requiredTerms });
      // The text-layer check never blocks a finished PDF; any finding rides
      // along as a warning next to the returned resume.
      const atsWarnings = (atsIntegrity.warnings || []).map((message) => ({ type: "ats-text-layer", severity: "info", message }));

      progress?.("Checking final verified requirement coverage");
      stage = "final-verification";
      const verificationStartedAt = Date.now();
      const finalVerification = {
        pageCount,
        includedBulletIds: [...rendered.finalSelection.experience, ...rendered.finalSelection.projects].flatMap((entry) => entry.bullets.map((bullet) => bullet.sourceBulletId)),
        renderedSkills: rendered.renderedSkills,
        protectedStructurePreserved: true,
        lexicalCoverage: null,
        coverage: semanticCoverageModule.computeSemanticRequirementCoverage(generated.requirements, generated.base, generated.acceptedDiff),
      };
      finalVerification.missingSkills = finalVerification.coverage.requirements.filter((item) => !item.covered && item.kind === "technical-skill").map((item) => item.text);
      finalVerification.densityRatio = generated.densityRatio;
      const coverageImprovement = semanticCoverageModule.summarizeSemanticCoverageChange(preliminaryCoverage, finalVerification.coverage);
      timings.finalVerificationMs = Date.now() - verificationStartedAt;
      timings.totalMs = Date.now() - generationStartedAt;

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
        analysis: pricingModule.normalizeUsage(null, {}),
        resumeSelection: pricingModule.normalizeUsage(generated.model, generated.usage || {}),
        coverLetter: pricingModule.normalizeUsage(generated.model, {}),
      };
      return {
        job: { company: job.company, title: job.title, resumeOption: job.resumeOption, baseResumeId: job.baseResumeId }, analysis: analyzed.analysis, preliminaryCoverage,
        baseResumeId: canonicalBase.id,
        selection: rendered.finalSelection, requirements: generated.requirements, finalCoverage: finalVerification.coverage,
        tailoring: { proposedDiff: generated.proposedDiff, acceptedDiff: generated.acceptedDiff, rejected: generated.rejected, failedRequirementTrace: generated.failedRequirementTrace || [], densityRatio: generated.densityRatio, candidateCount: null, meaningfulGaps: finalVerification.coverage.requirements.filter((item) => !item.covered), unsupportedMissing: finalVerification.coverage.unsupported.map((item) => ({ term: item.text, requirementId: item.id })), beforeCoverage: preliminaryCoverage, afterCoverage: finalVerification.coverage, coverageImprovement, backedOffForFit: pageFit.backedOff, pageFitAttempts: pageFit.attempts, optimizerVersion: 2, requestMetrics: generated.requestMetrics },
        verification: finalVerification, texFileName, pdfFileName: compiled.pdfFileName, pageCount,
        atsIntegrity, atsWarning: ATS_WARNING,
        warnings,
        fallback: { analysis: usedAnalysisFallback, selection: usedSelectionFallback, reason: selectionFallbackReason, diagnostic: selectionFallbackDiagnostic },
        timings,
        renderedSkills: rendered.renderedSkills || finalVerification.renderedSkills || null,
        suggestedFileName: fileNameModule.userFacingFileName({ kind: "resume", company: job.company, role: job.title }),
        models: { analysis: null, resumeSelection: generated.model }, usage,
        estimatedCostUsd: pricingModule.estimateGenerationCostUsd({ analysis: usage.analysis, resumeSelection: usage.resumeSelection }),
        outputDisplayPath: paths.displayPath,
      };
    } catch (error) {
      if (error && !error.stage) error.stage = stage;
      throw error;
    }
  };
}

module.exports = { createOrchestrator, countPages, ATS_WARNING };
