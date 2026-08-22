const path = require("path");
const { pathToFileURL } = require("url");
const { MODELS } = require("./models.cjs");
const { COVER_LETTER_SYSTEM } = require("./prompts.cjs");
const { parseJsonText, sanitizeJob } = require("./validation.cjs");

function isCancellation(error, signal) {
  return Boolean(signal?.aborted) || error?.code === "CANCELLED" || error?.name === "AbortError" || /\babort|cancel/i.test(String(error?.message || ""));
}

async function generateCoverLetter({ client, apiKey, bank, job, analysis, selection, resumeText = "", signal, generateDir, progress }) {
  const validation = await import(pathToFileURL(path.join(generateDir, "coverLetterValidation.js")).href);
  const evidenceModule = await import(pathToFileURL(path.join(generateDir, "coverLetterEvidence.js")).href);
  const { validateJobAnalysis } = await import(pathToFileURL(path.join(generateDir, "jobAnalysisValidation.js")).href);
  const safeJob = sanitizeJob(job);
  validateJobAnalysis(analysis);
  const evidenceBundle = evidenceModule.buildCoverLetterEvidence({ bank, job: safeJob, analysis, selection, resumeText });
  if (!evidenceBundle.evidence.length) throw Object.assign(new Error("No verified resume evidence is available for the cover letter."), { code: "VALIDATION_FAILED" });

  progress?.("Writing evidence-based cover letter");
  let response = null;
  let content;
  let usedFallback = false;
  try {
    response = await client.request({ apiKey, signal, stream: true, timeoutMs: 180000, body: {
      model: MODELS.writing,
      max_tokens: 1800,
      system: COVER_LETTER_SYSTEM,
      output_config: { format: { type: "json_schema", schema: validation.coverLetterSchema(evidenceBundle.evidence.map((item) => item.id)) } },
      messages: [{ role: "user", content: JSON.stringify({
        job: safeJob,
        analysis,
        finalResumeEvidence: evidenceBundle.evidence,
        finalResumeSkills: evidenceBundle.resumeSkills,
        requirements: "Write 200 to 300 words in exactly four short paragraphs. Emphasize only the 2 or 3 strongest supplied evidence items. Every substantive candidate claim must appear verbatim in claimEvidence and cite only its supporting finalResumeEvidence ID. Preserve every metric exactly. Describe the company only with facts stated in the JD. If the JD gives no supported motivation, use a factual general closing. Avoid filler, keyword stuffing, and claims based only on an unsupported JD requirement.",
      }) }],
    } });
    progress?.("Validating cover letter evidence");
    content = validation.validateCoverLetter(parseJsonText(response.text, "Cover letter", { stopReason: response.stopReason }), bank, { jobDescription: safeJob.description, evidenceText: evidenceBundle.allEvidence.map((item) => item.text).join(" ") });
    evidenceModule.validateEvidenceClaims(content, evidenceBundle, { job: safeJob, bank });
  } catch (error) {
    if (isCancellation(error, signal)) throw error;
    usedFallback = true;
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
  return { content, conservativeContent, usedFallback, evidence: evidenceBundle.evidence, usage: response?.usage || null, model: MODELS.writing, modelCalls: 1 };
}

module.exports = { generateCoverLetter };
