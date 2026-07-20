export const RESUME_ERROR_MESSAGES = {
  KEY_NOT_CONFIGURED: "Add ANTHROPIC_API_KEY to the root .env file and restart JobTrack.",
  authentication_error: "Anthropic rejected the configured API key. Check .env and restart JobTrack.",
  permission_error: "The configured Anthropic key cannot use the required model.",
  rate_limit_error: "Anthropic rate limit reached. Try again shortly.",
  TIMEOUT: "The request timed out. Try again.", NETWORK_ERROR: "Could not reach Anthropic.", CANCELLED: "Generation cancelled.",
  GENERATION_ACTIVE: "Another generation is already running.", TECTONIC_NOT_FOUND: "Install Tectonic and ensure it is on PATH.",
  COMPILATION_FAILED: "Tectonic could not compile the generated document.", MISSING_TEMPLATE: "A required document template is missing.",
  INVALID_OUTPUT_PATH: "The generated file path was rejected.", MISSING_PROFILE: "No valid resume identity is available in the Application Profile or content bank.",
  MISSING_JOB_DESCRIPTION: "Save the full job description before generating.", MALFORMED_RESPONSE: "Anthropic returned an unreadable response.",
  VALIDATION_FAILED: "Generated content did not pass factual validation.",
  IDENTITY_INVALID: "The resume identity is incomplete or malformed. Check your name, phone, email, and links.",
};

export function messageForResumeError(error) {
  if (["VALIDATION_FAILED", "MALFORMED_RESPONSE", "IDENTITY_INVALID"].includes(error?.code) && error?.message) return error.message;
  return RESUME_ERROR_MESSAGES[error?.code] || error?.message || "Document generation failed.";
}

export function missingGenerationRequirements({ status, job, active }) {
  const missing = [];
  if (!status?.api?.configured) missing.push("Anthropic API key");
  if (!status?.tectonic?.available) missing.push("Tectonic");
  const description = String(job?.jd || "").trim() || String(job?.description || "").trim();
  if (!description) missing.push("job description");
  if (active) missing.push("another active generation");
  return missing;
}

export function subscribeToGeneration(resumeApi, callback) {
  if (!resumeApi?.onGenerationEvent) return () => {};
  const cleanup = resumeApi.onGenerationEvent(callback);
  return typeof cleanup === "function" ? cleanup : () => {};
}

export function documentHistoryEntry(type, result) {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    createdAt: new Date().toISOString(),
    variant: type === "resume" ? result.selection?.variant || result.analysis?.recommendedVariant || "" : "",
    pdfFileName: result.pdfFileName,
    texFileName: result.texFileName,
    mustHaveCoverage: type === "resume" ? Number(result.finalCoverage?.mustHave?.percentage || 0) : 0,
    estimatedCostUsd: Number(result.estimatedCostUsd || 0),
    // Persist the verified evidence for a generated resume so a later
    // cover-letter-only generation can reuse it without regenerating the resume.
    ...(type === "resume" && result.selection && result.analysis
      ? { source: { analysis: result.analysis, selection: result.selection, bulletEvidence: result.selection.rankedBullets || [], renderedSkills: result.renderedSkills || [], company: result.job?.company || "", role: result.job?.title || "", createdAt: new Date().toISOString(), pdfFileName: result.pdfFileName } }
      : {}),
  };
}

// The resumes available as a cover-letter source: any generated resume that
// carries its stored evidence, most recent first. `liveResult` is the resume
// just generated this session (also usable immediately).
export function coverLetterSources({ documents = [], liveResult = null, liveJob = null } = {}) {
  const sources = [];
  if (liveResult?.selection && liveResult?.analysis) {
    sources.push({
      id: "live",
      label: `Just generated: ${liveJob?.company || liveResult.job?.company || "resume"}`,
      analysis: liveResult.analysis,
      selection: liveResult.selection,
    });
  }
  for (const document of documents) {
    if (document?.type !== "resume" || !document?.source?.selection || !document?.source?.analysis) continue;
    sources.push({
      id: document.id,
      label: `${document.company || "Resume"} · ${new Date(document.createdAt).toLocaleDateString()}`,
      analysis: document.source.analysis,
      selection: document.source.selection,
      createdAt: document.createdAt,
    });
  }
  return sources;
}

export function quickGenerationHistoryEntry(job, type, result) {
  return {
    ...documentHistoryEntry(type, result),
    // Preserve the resume evidence object.  A string here used to make quick
    // resumes impossible to reuse for a factual cover letter.
    source: type === "resume" ? { ...(documentHistoryEntry(type, result).source || {}), origin: "quick-generate" } : { origin: "quick-generate" },
    company: String(job?.company || "Untitled"),
    title: String(job?.title || "Role"),
  };
}

export function allCoverLetterSources({ jobs = [], generationHistory = [], liveResult = null, liveJob = null } = {}) {
  const documents = [
    ...jobs.flatMap((job) => (job.generatedDocuments || []).map((document) => ({ ...document, company: job.company, title: job.role }))),
    ...generationHistory,
  ];
  return coverLetterSources({ documents, liveResult, liveJob })
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}
