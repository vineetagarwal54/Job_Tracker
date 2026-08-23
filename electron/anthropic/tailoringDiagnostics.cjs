const SAFE_MESSAGE_LIMIT = 500;

function sanitizeDiagnosticMessage(value) {
  return String(value || "Unknown tailoring failure.")
    .replace(/sk-ant-[A-Za-z0-9_-]+/gi, "[REDACTED_API_KEY]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]")
    .replace(/\b(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g, "[REDACTED_PHONE]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, SAFE_MESSAGE_LIMIT);
}

function classifyTailoringFallback(error) {
  const code = String(error?.code || error?.name || "UNKNOWN_ERROR");
  const rawMessage = String(error?.message || "");
  const signal = `${code} ${rawMessage}`.toLowerCase();
  let classification = "API/request failure";
  let stage = error?.tailoringStage || "selection-request";

  if (/schema|structured.output|output_config|compil.*grammar/.test(signal)) {
    classification = "structured-output/schema failure";
    stage = "structured-output-schema";
  } else if (code === "MALFORMED_RESPONSE" || /malformed json|empty json|truncated|parse/.test(signal)) {
    classification = "response parsing failure";
    stage = "response-parsing";
  } else if (/validation/.test(stage) || stage === "tailoring-validation-application" || /tailoring|candidate|validation|protected structure/.test(signal)) {
    classification = "tailoring validation/application failure";
    if (!/validation/.test(stage)) stage = "tailoring-validation-application";
  }

  return {
    classification,
    code,
    stage,
    message: sanitizeDiagnosticMessage(rawMessage),
  };
}

function logTailoringFallback(logger, diagnostic, error) {
  const write = logger?.error || logger?.warn;
  if (typeof write !== "function") return;
  write.call(logger, "[JobTrack] Tailoring diff fallback", {
    stage: diagnostic.stage,
    classification: diagnostic.classification,
    code: diagnostic.code,
    message: diagnostic.message,
    status: Number.isInteger(error?.status) ? error.status : undefined,
    requestId: typeof error?.requestId === "string" ? error.requestId.slice(0, 100) : undefined,
  });
}

module.exports = { classifyTailoringFallback, logTailoringFallback, sanitizeDiagnosticMessage };
