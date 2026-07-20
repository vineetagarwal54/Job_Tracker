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
      const [keywordModule, coverageModule, identityModule, renderModule, verifyModule, pricingModule, pageFittingModule, fileNameModule, fallbackModule, finalizeModule, warningsModule, emphasisModule, rankingModule] = await Promise.all(["keywordExtraction", "coverageScoring", "profileIdentity", "renderResume", "postRenderVerification", "modelPricing", "pageFitting", "resumeFileName", "fallbackSelection", "finalizeSelection", "resumeWarnings", "roleEmphasis", "bulletRanking"].map((name) => load(path.join(generateDir, `${name}.js`))));
      stage = "content-bank";
      let bank;
      try { bank = JSON.parse(fs.readFileSync(path.join(generateDir, "content-bank.json"), "utf8")); } catch (error) { throw codedError("VALIDATION_FAILED", `The resume content bank is missing or corrupt: ${error.message}`); }
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
        const fallbackVariant = fallbackModule.chooseFallbackVariant(bank, { extraction });
        analyzed = { analysis: fallbackModule.buildFallbackAnalysis({ extraction, job, variant: fallbackVariant }), usage: null, model: analyzeModelName() };
        usedAnalysisFallback = true;
      }

      // Multiple role-emphasis tags steer the summary, bullet ranking, skills,
      // projects, and page-space allocation. The primary emphasis also chooses
      // the concrete resume variant (so an enterprise-AI JD renders the ai-llm
      // variant with the enterprise summary, not the inference summary).
      const emphasisResult = emphasisModule.classifyEmphases({ job, extraction, analysis: analyzed.analysis });
      const variant = emphasisResult.variant;

      progress?.("Selecting resume variant");
      const preliminaryCoverage = coverageModule.scoreCoverage(bank, extraction, { analysis: analyzed.analysis });

      // --- Selection (Sonnet) with universal deterministic fallback. If the
      // model response or its validation fails, build a safe selection straight
      // from the verified bank so a bad model response never fails a resume the
      // bank can produce. ---
      stage = "selection";
      let generated;
      let usedSelectionFallback = false;
      let selectionFallbackReason = null;
      try {
        generated = await generateResumeSelection({ client, apiKey, bank, job, analysis: analyzed.analysis, extraction, coverage: preliminaryCoverage, variant, emphasis: emphasisResult.primary, emphases: emphasisResult.emphases, signal, generateDir, progress });
      } catch (error) {
        if (isCancellation(error, signal)) throw error;
        generated = buildFallbackGenerated({ fallbackModule, finalizeModule, bank, extraction, analysis: analyzed.analysis, variant, emphasisResult });
        usedSelectionFallback = true;
        selectionFallbackReason = error.message;
      }

      progress?.("Fitting content to one page");
      stage = "template";
      const templatePath = paths.template("main.tex");
      if (!fs.existsSync(templatePath)) throw codedError("MISSING_TEMPLATE", "The resume template is missing.");
      const template = fs.readFileSync(templatePath, "utf8");
      paths.ensureOutputDir();
      const texFileName = `${renderModule.safeResumeFileName(job.company, job.title)}-resume-${Date.now()}.tex`;

      // Compile-verify loop (Phase 8): the PDF page count is ground truth. If it
      // exceeds one page, deterministically drop the lowest-value nonmandatory
      // bullet and recompile. Retry up to three times; mandatory content is never
      // removed. No extra API call is made during trimming.
      stage = "render-compile";
      const jdContext = { extraction, analysis: analyzed.analysis };
      const rankScores = rankingModule.computeAllRankScores(bank, rankingModule.buildRankingContext({ extraction, analysis: analyzed.analysis, emphases: emphasisResult.emphases }));
      let currentSelection = generated.selection;
      let rendered;
      let compiled;
      let pageCount = null;
      const removedForFit = [];
      const addedForFit = [];
      for (let attempt = 0; attempt <= 3; attempt += 1) {
        rendered = renderModule.renderResume({ bank, selection: currentSelection, template, identity, jdContext });
        fs.writeFileSync(paths.resolveGeneratedFile(texFileName, ".tex"), rendered.tex, "utf8");
        progress?.(attempt === 0 ? "Compiling resume PDF" : `Refitting to one page (attempt ${attempt})`);
        compiled = await compileResumeTex(texFileName);
        if (!compiled.ok) throw codedError(compiled.error.code, compiled.error.message);
        pageCount = countPages(paths.resolveGeneratedFile(compiled.pdfFileName, ".pdf"));
        if (pageCount === 1) break;
        if (attempt === 3) throw codedError("VALIDATION_FAILED", `Generated resume is ${pageCount || "an unknown number of"} pages after trimming.`);
        const trim = pageFittingModule.trimOneBullet(bank, currentSelection, rankScores);
        if (!trim) throw codedError("VALIDATION_FAILED", "Resume exceeds one page and no nonmandatory bullet can be trimmed.");
        removedForFit.push(trim.removed);
        currentSelection = trim.selection;
      }

      // A sparse but valid one-page render gets a bounded chance to add one
      // high-value, already-ranked bullet. Never add filler and revert if the
      // PDF grows past one page.
      for (let attempt = 0; attempt < 2 && rendered?.budget?.availableLines - rendered?.budget?.usedLines >= 3; attempt += 1) {
        const expansion = pageFittingModule.addOneRelevantBullet(bank, currentSelection, rankScores);
        if (!expansion) break;
        const expanded = renderModule.renderResume({ bank, selection: expansion.selection, template, identity, jdContext });
        fs.writeFileSync(paths.resolveGeneratedFile(texFileName, ".tex"), expanded.tex, "utf8");
        const expandedCompiled = await compileResumeTex(texFileName);
        const expandedPages = expandedCompiled.ok ? countPages(paths.resolveGeneratedFile(expandedCompiled.pdfFileName, ".pdf")) : null;
        if (!expandedCompiled.ok || expandedPages !== 1) {
          fs.writeFileSync(paths.resolveGeneratedFile(texFileName, ".tex"), rendered.tex, "utf8");
          compiled = await compileResumeTex(texFileName);
          break;
        }
        currentSelection = expansion.selection; rendered = expanded; compiled = expandedCompiled; pageCount = expandedPages; addedForFit.push(expansion.added);
      }

      progress?.("Verifying PDF text layer");
      stage = "ats-verification";
      // Technical terms that must not be split in the extracted text. Only those
      // actually present in the rendered resume are required.
      const requiredTerms = TERM_WATCHLIST.filter((term) => renderedResumeText(rendered).toLowerCase().includes(term.toLowerCase()));
      const atsIntegrity = verifyPdfAtsIntegrity(paths.resolveGeneratedFile(compiled.pdfFileName, ".pdf"), { expectedName: identity.name, requiredTerms });
      if (!atsIntegrity.valid) throw codedError("VALIDATION_FAILED", `PDF ATS integrity check failed: ${atsIntegrity.errors.join("; ")}`);

      progress?.("Checking final keyword coverage");
      stage = "final-verification";
      const finalVerification = verifyModule.verifyFinalResume({ bank, extraction, analysis: analyzed.analysis, finalSelection: rendered.finalSelection, budget: rendered.budget, pageCount });

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
      ];

      const usage = {
        analysis: pricingModule.normalizeUsage(analyzed.model, analyzed.usage || {}),
        resumeSelection: pricingModule.normalizeUsage(generated.model, generated.usage || {}),
        coverLetter: pricingModule.normalizeUsage(generated.model, {}),
      };
      return {
        job: { company: job.company, title: job.title }, analysis: analyzed.analysis, preliminaryCoverage,
        selection: rendered.finalSelection, budget: rendered.budget, finalCoverage: finalVerification.coverage,
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
