import { useState } from "react";

const values = (items) => (items || []).map(item => item.value || item.normalized || item).join(", ") || "None";
const BASE_LABELS = Object.freeze({ ai: "AI / LLM", mobile: "Mobile / React Native", "swe-cloud": "Software Engineer / FullStack / Cloud" });

export function ResumeGenerationResult({ result, onOpen, onReveal, onOpenFolder, onGenerateAgain, onGenerateCoverLetter, coverActive }) {
  const [saveMsg, setSaveMsg] = useState(null);
  const [diagnosticsCopied, setDiagnosticsCopied] = useState(false);
  if (!result) return null;
  const included = result.verification?.includedBulletIds || [];
  const coverage = result.finalCoverage || {};
  const onePage = result.pageCount === 1;
  const atsOk = result.atsIntegrity ? result.atsIntegrity.valid : null;
  const warnings = result.warnings || [];
  const renderedSkills = result.renderedSkills || result.verification?.renderedSkills || [];
  const coverageImprovement = result.tailoring?.coverageImprovement || {};
  const backedOffForFit = result.tailoring?.backedOffForFit || [];
  const semanticCoverageUnavailable = Boolean(result.fallback?.selection);
  const semanticValues = (items) => semanticCoverageUnavailable ? "Not evaluated due to optimizer fallback" : values(items);
  const acceptedChangeLabels = describeAcceptedChanges(result.tailoring?.acceptedDiff);

  const save = async () => {
    setSaveMsg(null);
    const r = await window.resume?.saveCopy?.({ fileName: result.pdfFileName, suggestedName: result.suggestedFileName });
    if (r?.ok) setSaveMsg(`Saved to ${r.savedPath}`);
    else if (!r?.canceled) setSaveMsg("Save failed. Try Open Output Folder instead.");
  };
  const copyDiagnostics = async () => {
    await navigator.clipboard?.writeText?.(diagnosticText(result));
    setDiagnosticsCopied(true);
    setTimeout(() => setDiagnosticsCopied(false), 2000);
  };

  return (
    <div style={{ background: "#0e0e18", border: "1px solid #27315f", borderRadius: "12px", padding: "20px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
        <div><div style={{ color: "#4ade80", fontSize: "12px", fontWeight: 700 }}>RESUME COMPLETED</div><div style={{ fontFamily: "Syne, sans-serif", fontSize: "20px", fontWeight: 700, marginTop: "4px" }}>{result.job?.company} · {result.job?.title}</div></div>
        <div style={{ color: "#a5b4fc", fontSize: "13px" }}>{result.selection?.variant}</div>
      </div>
      {acceptedChangeLabels.length > 0 && <div style={{ marginTop: "10px", color: "#b0b8c8", fontSize: "12px", lineHeight: 1.5 }}>Accepted changes: {acceptedChangeLabels.join(", ")}</div>}

      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "14px" }}>
        <Badge ok={onePage}>{onePage ? "One page" : `${result.pageCount || "?"} pages`}</Badge>
        <Badge ok={atsOk}>{atsOk === null ? "ATS text layer unchecked" : atsOk ? "ATS text layer" : "ATS text layer failed"}</Badge>
        <Badge ok={true} neutral>{semanticCoverageUnavailable ? "Must-have coverage unavailable" : `Must-have coverage ${coverage.mustHave?.percentage ?? 0}%`}</Badge>
        {backedOffForFit.length > 0 && <Badge ok={null} warn>Reverted {backedOffForFit.length} change{backedOffForFit.length > 1 ? "s" : ""} for one page</Badge>}
      </div>

      {warnings.length > 0 && (
        <div style={{ marginTop: "14px", background: "#1a1608", border: "1px solid #4a3f15", borderRadius: "8px", padding: "12px 14px", userSelect: "text" }}>
          <div style={{ color: "#facc15", fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>
            {warnings.length} {warnings.length === 1 ? "note" : "notes"} · resume was still generated
          </div>
          <ul style={{ margin: "8px 0 0", paddingLeft: "18px", color: "#e2d9b8", fontSize: "12px", lineHeight: 1.55 }}>
            {warnings.map((warning, index) => (
              <li key={index} style={{ marginTop: index ? "4px" : 0, color: warning.severity === "warning" ? "#fcd34d" : "#cbd5e1" }}>
                {warning.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div style={{ marginTop: "12px", fontSize: "12px", color: "#94a3b8", lineHeight: 1.5 }}>
        {result.atsWarning || "Upload this PDF as-is. Avoid Print to PDF or image conversion, which may remove the text layer used by applicant tracking systems."}
      </div>

      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "16px" }}>
        <Action primary onClick={save}>Save Resume</Action>
        <Action onClick={() => onOpen(result.pdfFileName)}>Open Resume</Action>
        {onGenerateAgain && <Action onClick={onGenerateAgain}>Generate Again</Action>}
        {onGenerateCoverLetter && <Action onClick={onGenerateCoverLetter} disabled={coverActive}>{coverActive ? "Generating..." : "Generate Cover Letter"}</Action>}
      </div>
      {saveMsg && <div style={{ marginTop: "10px", fontSize: "12px", color: "#a5b4fc" }}>{saveMsg}</div>}

      <details style={{ marginTop: "16px", userSelect: "text" }}>
        <summary style={{ cursor: "pointer", color: "#5a6070", fontSize: "12px", fontWeight: 700, textTransform: "uppercase" }}>Advanced details</summary>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "10px", marginTop: "12px" }}>
          <Metric label="Role family" value={result.analysis?.roleFamily} /><Metric label="Seniority" value={result.analysis?.seniority} />
          <Metric label="Nice-to-have coverage" value={semanticCoverageUnavailable ? "Unavailable" : `${coverage.niceToHave?.percentage ?? 0}%`} /><Metric label="Estimated API cost" value={`$${Number(result.estimatedCostUsd || 0).toFixed(4)}`} />
        </div>
        <Detail label="Blockers" value={(result.analysis?.blockers || []).join(", ") || "None identified"} />
        <Detail label="Missing must-haves" value={semanticValues(coverage.mustHave?.missing)} />
        <Detail label="Covered must-haves" value={semanticValues(coverage.mustHave?.covered)} />
        <Detail label="Missing preferred requirements" value={semanticValues(coverage.niceToHave?.missing)} />
        <Detail label="Covered preferred requirements" value={semanticValues(coverage.niceToHave?.covered)} />
        <Detail label="Coverage before / after" value={semanticCoverageUnavailable ? "Not evaluated due to optimizer fallback" : `${result.tailoring?.beforeCoverage?.weightedCoveragePercentage ?? 0}% / ${coverage.weightedCoveragePercentage ?? 0}% weighted; ${result.tailoring?.beforeCoverage?.coveragePercentage ?? 0}% / ${coverage.coveragePercentage ?? 0}% matched terms`} />
        <Detail label="Newly covered terms" value={semanticCoverageUnavailable ? "Not evaluated due to optimizer fallback" : (coverageImprovement.newlyCoveredTerms || []).join(", ") || "None"} />
        <Detail label="Coverage lost" value={semanticCoverageUnavailable ? "Not evaluated due to optimizer fallback" : (coverageImprovement.noLongerCoveredTerms || []).join(", ") || "None"} />
        <Detail label="Unsupported JD gaps" value={semanticCoverageUnavailable ? "Not evaluated due to optimizer fallback" : (result.tailoring?.unsupportedMissing || []).map((item) => item.term).join(", ") || "None"} />
        <Detail label="Unsupported requirements" value={semanticCoverageUnavailable ? "Not evaluated due to optimizer fallback" : (coverage.unsupported || []).map((item) => item.value || item.text).join(", ") || "None"} />
        <Detail label="Raw lexical coverage" value={result.verification?.lexicalCoverage ? `${result.verification.lexicalCoverage.coveragePercentage}% (diagnostic only)` : "Disabled in the V2 production path"} />
        <Detail label="Skills shown" value={renderedSkills.map((group) => `${group.label}: ${group.items.join(", ")}`).join(" · ") || "None"} />
        <Detail label="Missing JD skills" value={semanticCoverageUnavailable ? "Not evaluated due to optimizer fallback" : (result.verification?.missingSkills || []).join(", ") || "None"} />
        <Detail label="Generation mode" value={result.fallback?.selection ? "Canonical base unchanged after tailoring fallback" : result.fallback?.analysis ? "Minimal base tailoring with fallback analysis" : "Minimal canonical-base tailoring"} />
        {result.fallback?.selection && <Detail label="Tailoring fallback type" value={result.fallback?.diagnostic?.classification || "Unclassified tailoring failure"} />}
        {result.fallback?.selection && <Detail label="Tailoring fallback reason" value={result.fallback?.reason || "No reason was provided"} />}
        {result.fallback?.selection && <Detail label="Tailoring fallback stage / code" value={`${result.fallback?.diagnostic?.stage || "selection"} / ${result.fallback?.diagnostic?.code || "UNKNOWN_ERROR"}`} />}
        <Detail label="Base resume" value={BASE_LABELS[result.baseResumeId] || "Software Engineer / FullStack / Cloud"} />
        <Detail label="Accepted tailoring changes" value={`${result.tailoring?.acceptedDiff?.bulletChanges?.length || 0} bullets, ${result.tailoring?.acceptedDiff?.projectSwap ? 1 : 0} project, ${result.tailoring?.acceptedDiff?.skillChanges?.length || 0} skills${result.tailoring?.acceptedDiff?.summaryChange ? ", summary" : ""}`} />
        <Detail label="Rejected tailoring changes" value={String(result.tailoring?.rejected?.length || 0)} />
        <Detail label="Backed off for page fit" value={backedOffForFit.map((item) => item.type).join(", ") || "None"} />
        <Detail label="Included bullets" value={included.join(", ")} />
        <Detail label="Models" value={`${result.models?.analysis || ""}; ${result.models?.resumeSelection || ""}`} />
        <Detail label="Analysis usage" value={formatUsage(result.usage?.analysis)} />
        <Detail label="Tailoring diff usage" value={formatUsage(result.usage?.resumeSelection)} />
        <Detail label="Optimizer request size" value={formatRequestMetrics(result.tailoring?.requestMetrics)} />
        <Detail label="Stage timings" value={formatTimings(result.timings)} />
        <Detail label="Files" value={`${result.pdfFileName}; ${result.texFileName}`} />
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "12px" }}>
          <Action onClick={copyDiagnostics}>{diagnosticsCopied ? "Diagnostics copied" : "Copy diagnostics"}</Action>
          <Action onClick={() => onReveal(result.pdfFileName)}>Reveal Resume</Action>
          <Action onClick={onOpenFolder}>Open Output Folder</Action>
        </div>
      </details>
    </div>
  );
}

function Badge({ children, ok, neutral, warn }) {
  const color = warn ? { bg: "#2a2410", fg: "#facc15", bd: "#4a3f15" } : neutral ? { bg: "#12121c", fg: "#a5b4fc", bd: "#27315f" } : ok ? { bg: "#0f2417", fg: "#4ade80", bd: "#1c4a30" } : { bg: "#2d1010", fg: "#f87171", bd: "#5a2020" };
  return <span style={{ background: color.bg, color: color.fg, border: `1px solid ${color.bd}`, padding: "4px 10px", borderRadius: "999px", fontSize: "12px", fontWeight: 600 }}>{children}</span>;
}
function Metric({ label, value }) { return <div style={{ background: "#12121c", padding: "10px", borderRadius: "7px" }}><div style={{ fontSize: "10px", color: "#5a6070", textTransform: "uppercase" }}>{label}</div><div style={{ marginTop: "3px", color: "#e2e8f0" }}>{value || "Unknown"}</div></div>; }
function Detail({ label, value }) { return <div style={{ marginTop: "12px", fontSize: "12px", lineHeight: 1.6 }}><span style={{ color: "#5a6070", textTransform: "uppercase", fontWeight: 700 }}>{label}: </span><span style={{ color: "#b0b8c8" }}>{value || "None"}</span></div>; }
function Action({ children, primary, ...props }) { return <button className="btn" {...props} style={{ background: primary ? "#6366f1" : "#1a1f3a", color: primary ? "#fff" : "#a5b4fc", padding: "8px 12px", borderRadius: "7px", opacity: props.disabled ? 0.5 : 1 }}>{children}</button>; }
function formatUsage(usage) { return usage ? `${usage.inputTokens} input, ${usage.outputTokens} output, ${usage.cacheCreationInputTokens} cache write, ${usage.cacheReadInputTokens} cache read tokens` : "Unavailable"; }
function formatRequestMetrics(metrics) { return metrics ? `${metrics.serializedRequestBytes} serialized bytes; approximately ${metrics.approximateInputTokens} tokens; ${metrics.catalogBytes} catalog bytes; ${metrics.dynamicBytes} dynamic bytes` : "Unavailable"; }
function formatTimings(timings) {
  if (!timings) return "Unavailable";
  return `legacy analysis ${timings.analysisMs ?? "?"} ms; legacy relevance planning ${timings.relevancePlanningMs ?? "?"} ms; semantic optimizer API ${timings.tailoringApiMs ?? "?"} ms; compile/page fit ${timings.compilePageFitMs ?? "?"} ms; final verification ${timings.finalVerificationMs ?? "?"} ms; total ${timings.totalMs ?? "?"} ms`;
}
function describeAcceptedChanges(diff = {}) {
  const bullets = diff.bulletChanges?.length || 0;
  return [
    ...(bullets ? [`${bullets} experience bullet update${bullets === 1 ? "" : "s"}`] : []),
    ...(diff.projectSwap ? ["1 project swap"] : []),
    ...(diff.skillChanges || []).map((item) => `${item.type === "add" ? "added" : "swapped"} skill ${item.replacementItem}`),
    ...(diff.summaryChange ? ["summary update"] : []),
  ];
}
function diagnosticText(result) {
  const accepted = result.tailoring?.acceptedDiff || {};
  const coverage = result.finalCoverage || {};
  const diagnostic = {
    fallback: result.fallback?.selection ? {
      type: result.fallback?.diagnostic?.classification || "Unclassified tailoring failure",
      reason: result.fallback?.reason || "No reason was provided",
      stageCode: `${result.fallback?.diagnostic?.stage || "selection"} / ${result.fallback?.diagnostic?.code || "UNKNOWN_ERROR"}`,
    } : null,
    optimizerVersion: result.tailoring?.optimizerVersion || null,
    requestMetrics: result.tailoring?.requestMetrics || null,
    providerUsage: result.usage?.resumeSelection || null,
    timings: result.timings || null,
    candidateCount: result.tailoring?.candidateCount ?? null,
    accepted: [accepted.summaryChange, ...(accepted.bulletChanges || []), accepted.projectSwap, ...(accepted.skillChanges || [])].filter(Boolean).map((item) => ({ candidateId: item.candidateId, requirementIds: item.requirementIds || [], type: item.type || (item.summaryId ? "summary" : item.replacementProjectId ? "project" : "skill") })),
    rejected: (result.tailoring?.rejected || []).map((item) => ({ type: item.type, reason: item.reason, requirementIds: item.change?.requirementIds || [] })),
    backedOff: (result.tailoring?.backedOffForFit || []).map((item) => ({ type: item.type, candidateId: item.candidateId, requirementIds: item.requirementIds || [] })),
    requirementTrace: result.fallback?.selection ? (result.tailoring?.failedRequirementTrace || []) : (coverage.requirements || []).map((item) => ({
      id: item.id, text: item.text, priority: item.priority, kind: item.kind,
      optimizerStatus: item.optimizerStatus,
      currentEvidenceIds: item.currentEvidenceIds || [],
      candidateEvidenceIds: item.candidateEvidenceIds || [],
      knowledgeSkills: item.knowledgeSkillNames || item.knowledgeSkillIds || [],
      finalCovered: Boolean(item.covered),
      finalSurvivingEvidenceIds: item.survivingEvidenceIds || [],
      reason: item.reason,
    })),
    coverage: {
      beforeWeighted: result.tailoring?.beforeCoverage?.weightedCoveragePercentage ?? null,
      afterWeighted: coverage.weightedCoveragePercentage ?? null,
      beforeMatched: result.tailoring?.beforeCoverage?.coveragePercentage ?? null,
      afterMatched: coverage.coveragePercentage ?? null,
      missingMustHaves: (coverage.mustHave?.missing || []).map((item) => item.value || item.normalized || item),
      unsupportedGaps: (result.tailoring?.unsupportedMissing || []).map((item) => item.term),
    },
  };
  return `JobTrack resume diagnostics\n${JSON.stringify(diagnostic, null, 2)}`;
}
