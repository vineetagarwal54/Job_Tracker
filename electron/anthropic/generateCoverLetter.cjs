const path = require("path");
const { pathToFileURL } = require("url");
const { MODELS } = require("./models.cjs");
const { COVER_LETTER_SYSTEM } = require("./prompts.cjs");
const { parseJsonText, sanitizeJob } = require("./validation.cjs");
const { sanitizeDiagnosticMessage } = require("./tailoringDiagnostics.cjs");

function isCancellation(error, signal) {
  return Boolean(signal?.aborted) || error?.code === "CANCELLED" || error?.name === "AbortError" || /\babort|cancel/i.test(String(error?.message || ""));
}

function fallbackDiagnostic(error, stage, apiDurationMs, usage, evidenceIds, stopReason) {
  const signal = `${error?.code || ""} ${error?.message || ""} ${stopReason || ""}`.toLowerCase();
  let fallbackType = "request failure";
  if (/max_tokens|max token|truncat/.test(signal)) fallbackType = "max-token/truncation failure";
  else if (/schema|structured.output|output_config/.test(signal)) fallbackType = "structured-output/schema failure";
  else if (stage === "parsing" || /malformed|json|parse/.test(signal)) fallbackType = "parsing failure";
  else if (stage === "evidence-validation" || /evidence|validation|metric|claim/.test(signal)) fallbackType = "evidence-validation failure";
  return { fallbackType, stage, code: String(error?.code || error?.name || "UNKNOWN_ERROR"), reason: sanitizeDiagnosticMessage(error?.message), apiDurationMs, usage: usage || null, evidenceIds };
}

async function generateCoverLetter({ client, apiKey, bank, job, selection, resumeText = "", requirements = [], finalCoverage = null, signal, generateDir, progress }) {
  const validation = await import(pathToFileURL(path.join(generateDir, "coverLetterValidation.js")).href);
  const evidenceModule = await import(pathToFileURL(path.join(generateDir, "coverLetterEvidence.js")).href);
  const safeJob = sanitizeJob(job);
  const evidenceBundle = evidenceModule.buildCoverLetterEvidence({ bank, selection, resumeText, requirements, finalCoverage });
  if (!evidenceBundle.evidence.length) throw Object.assign(new Error("No verified resume evidence is available for the cover letter."), { code: "VALIDATION_FAILED" });

  progress?.("Writing evidence-based cover letter");
  let response = null;
  let content;
  let usedFallback = false;
  let diagnostics = null;
  let stage = "request";
  let apiDurationMs = null;
  const apiStartedAt = Date.now();
  try {
    response = await client.request({ apiKey, signal, stream: true, timeoutMs: 180000, body: {
      model: MODELS.writing,
      max_tokens: 1800,
      thinking: { type: "disabled" },
      system: COVER_LETTER_SYSTEM,
      output_config: { effort: "low", format: { type: "json_schema", schema: validation.coverLetterSchema(evidenceBundle.evidence.map((item) => item.id)) } },
      messages: [{ role: "user", content: JSON.stringify({
        job: safeJob,
        finalResumeEvidence: evidenceBundle.evidence,
        finalResumeSkills: evidenceBundle.resumeSkills,
        structuredRequirements: requirements,
        finalRequirementCoverage: finalCoverage,
        strongestSurvivingMatches: evidenceBundle.requirementMatches,
        requirements: "Write 200 to 300 words in exactly four short paragraphs. Emphasize only the 2 or 3 strongest supplied evidence items. Every substantive candidate claim must appear verbatim in claimEvidence and cite only its supporting finalResumeEvidence ID. Preserve every metric exactly. Describe the company only with facts stated in the JD. If the JD gives no supported motivation, use a factual general closing. Avoid filler, keyword stuffing, and claims based only on an unsupported JD requirement.",
      }) }],
    } });
    apiDurationMs = Date.now() - apiStartedAt;
    stage = "parsing";
    const parsed = parseJsonText(response.text, "Cover letter", { stopReason: response.stopReason });
    progress?.("Validating cover letter evidence");
    stage = "evidence-validation";
    content = validation.validateCoverLetter(parsed, bank, { jobDescription: safeJob.description, evidenceText: evidenceBundle.allEvidence.map((item) => item.text).join(" ") });
    evidenceModule.validateEvidenceClaims(content, evidenceBundle, { job: safeJob, bank });
  } catch (error) {
    if (isCancellation(error, signal)) throw error;
    apiDurationMs ??= Date.now() - apiStartedAt;
    usedFallback = true;
    diagnostics = fallbackDiagnostic(error, stage, apiDurationMs, response?.usage, evidenceBundle.evidence.map((item) => item.id), response?.stopReason);
    progress?.("Using conservative verified cover letter fallback");
    content = evidenceModule.buildConservativeCoverLetter({ job: safeJob, evidenceBundle });
    content = validation.validateCoverLetter(content, bank, { jobDescription: safeJob.description, evidenceText: evidenceBundle.allEvidence.map((item) => item.text).join(" ") });
    evidenceModule.validateEvidenceClaims(content, evidenceBundle, { job: safeJob, bank });
  }

  let conservativeContent = content;
  if (!usedFallback) {
    conservativeContent = evidenceModule.buildConservativeCoverLetter({ job: safeJob, evidenceBundle });
    conservativeContent = validation.validateCoverLetter(conservativeContent, bank, { jobDescription: safeJob.description, evidenceText: evidenceBundle.allEvidence.map((item) => item.text).join(" ") });
    evidenceModule.validateEvidenceClaims(conservativeContent, evidenceBundle, { job: safeJob, bank });
  }
  return { content, conservativeContent, usedFallback, evidence: evidenceBundle.evidence, usage: response?.usage || null, model: MODELS.writing, modelCalls: 1, apiDurationMs, diagnostics, requirementMatches: evidenceBundle.requirementMatches };
}

module.exports = { generateCoverLetter, fallbackDiagnostic };
