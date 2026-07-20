import { useState } from "react";

const values = (items) => (items || []).map(item => item.value || item.normalized || item).join(", ") || "None";

export function ResumeGenerationResult({ result, onOpen, onReveal, onOpenFolder, onGenerateAgain, onGenerateCoverLetter, coverActive }) {
  const [saveMsg, setSaveMsg] = useState(null);
  if (!result) return null;
  const included = result.verification?.includedBulletIds || [];
  const excluded = result.verification?.excluded || result.budget?.excluded || [];
  const coverage = result.finalCoverage || {};
  const onePage = result.pageCount === 1;
  const atsOk = result.atsIntegrity ? result.atsIntegrity.valid : null;
  const removed = result.removedForFit || [];

  const save = async () => {
    setSaveMsg(null);
    const r = await window.resume?.saveCopy?.({ fileName: result.pdfFileName, suggestedName: result.suggestedFileName });
    if (r?.ok) setSaveMsg(`Saved to ${r.savedPath}`);
    else if (!r?.canceled) setSaveMsg("Save failed. Try Open Output Folder instead.");
  };

  return (
    <div style={{ background: "#0e0e18", border: "1px solid #27315f", borderRadius: "12px", padding: "20px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
        <div><div style={{ color: "#4ade80", fontSize: "12px", fontWeight: 700 }}>RESUME COMPLETED</div><div style={{ fontFamily: "Syne, sans-serif", fontSize: "20px", fontWeight: 700, marginTop: "4px" }}>{result.job?.company} · {result.job?.title}</div></div>
        <div style={{ color: "#a5b4fc", fontSize: "13px" }}>{result.selection?.variant}</div>
      </div>

      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "14px" }}>
        <Badge ok={onePage}>{onePage ? "One page" : `${result.pageCount || "?"} pages`}</Badge>
        <Badge ok={atsOk}>{atsOk === null ? "ATS text layer unchecked" : atsOk ? "ATS text layer" : "ATS text layer failed"}</Badge>
        <Badge ok={true} neutral>Must-have coverage {coverage.mustHave?.percentage ?? 0}%</Badge>
        {removed.length > 0 && <Badge ok={null} warn>Trimmed {removed.length} bullet{removed.length > 1 ? "s" : ""} to fit</Badge>}
      </div>

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

      <details style={{ marginTop: "16px" }}>
        <summary style={{ cursor: "pointer", color: "#5a6070", fontSize: "12px", fontWeight: 700, textTransform: "uppercase" }}>Advanced details</summary>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "10px", marginTop: "12px" }}>
          <Metric label="Role family" value={result.analysis?.roleFamily} /><Metric label="Seniority" value={result.analysis?.seniority} />
          <Metric label="Nice-to-have coverage" value={`${coverage.niceToHave?.percentage ?? 0}%`} /><Metric label="Estimated API cost" value={`$${Number(result.estimatedCostUsd || 0).toFixed(4)}`} />
        </div>
        <Detail label="Blockers" value={(result.analysis?.blockers || []).join(", ") || "None identified"} />
        <Detail label="Covered keywords" value={values(coverage.coveredKeywords)} />
        <Detail label="Missing keywords" value={values(coverage.uncoveredKeywords)} />
        <Detail label="Missing must-haves" value={values(coverage.mustHave?.missing)} />
        <Detail label="Covered must-haves" value={values(coverage.mustHave?.covered)} />
        <Detail label="Included bullets" value={included.join(", ")} />
        <Detail label="Excluded bullets" value={excluded.map(item => `${item.id} (${item.reason})`).join(", ") || "None"} />
        <Detail label="Trimmed to fit" value={removed.map(item => `${item.bulletId} (${item.entryId})`).join(", ") || "None"} />
        <Detail label="Models" value={`${result.models?.analysis || ""}; ${result.models?.resumeSelection || ""}`} />
        <Detail label="Analysis usage" value={formatUsage(result.usage?.analysis)} />
        <Detail label="Resume selection usage" value={formatUsage(result.usage?.resumeSelection)} />
        <Detail label="Files" value={`${result.pdfFileName}; ${result.texFileName}`} />
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "12px" }}>
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
