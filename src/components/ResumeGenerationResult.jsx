const values = (items) => (items || []).map(item => item.value || item.normalized || item).join(", ") || "None";

export function ResumeGenerationResult({ result, onOpen, onReveal, onOpenFolder, onGenerateAgain, onGenerateCoverLetter, coverActive }) {
  if (!result) return null;
  const included = result.verification?.includedBulletIds || [];
  const excluded = result.verification?.excluded || result.budget?.excluded || [];
  const coverage = result.finalCoverage || {};
  return (
    <div style={{ background: "#0e0e18", border: "1px solid #27315f", borderRadius: "12px", padding: "20px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
        <div><div style={{ color: "#4ade80", fontSize: "12px", fontWeight: 700 }}>RESUME COMPLETED</div><div style={{ fontFamily: "Syne, sans-serif", fontSize: "20px", fontWeight: 700, marginTop: "4px" }}>{result.job?.company} · {result.job?.title}</div></div>
        <div style={{ color: "#a5b4fc", fontSize: "13px" }}>{result.selection?.variant}</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "10px", marginTop: "16px" }}>
        <Metric label="Role family" value={result.analysis?.roleFamily} /><Metric label="Seniority" value={result.analysis?.seniority} />
        <Metric label="Must-have coverage" value={`${coverage.mustHave?.percentage ?? 0}%`} /><Metric label="Nice-to-have coverage" value={`${coverage.niceToHave?.percentage ?? 0}%`} />
        <Metric label="Pages" value={result.pageCount} /><Metric label="Estimated API cost" value={`$${Number(result.estimatedCostUsd || 0).toFixed(4)}`} />
      </div>
      <Detail label="Blockers" value={(result.analysis?.blockers || []).join(", ") || "None identified"} />
      <Detail label="Covered keywords" value={values(coverage.coveredKeywords)} />
      <Detail label="Missing keywords" value={values(coverage.uncoveredKeywords)} />
      <Detail label="Missing must-haves" value={values(coverage.mustHave?.missing)} />
      <Detail label="Covered must-haves" value={values(coverage.mustHave?.covered)} />
      <Detail label="Covered nice-to-haves" value={values(coverage.niceToHave?.covered)} />
      <Detail label="Missing nice-to-haves" value={values(coverage.niceToHave?.missing)} />
      <Detail label="Included bullets" value={included.join(", ")} />
      <Detail label="Excluded bullets" value={excluded.map(item => `${item.id} (${item.reason})`).join(", ") || "None"} />
      <Detail label="Models" value={`${result.models?.analysis || ""}; ${result.models?.resumeSelection || ""}`} />
      <Detail label="Analysis usage" value={formatUsage(result.usage?.analysis)} />
      <Detail label="Resume selection usage" value={formatUsage(result.usage?.resumeSelection)} />
      <Detail label="Files" value={`${result.pdfFileName}; ${result.texFileName}`} />
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "16px" }}>
        <Action onClick={() => onOpen(result.pdfFileName)}>Open PDF</Action><Action onClick={() => onReveal(result.pdfFileName)}>Reveal in File Explorer</Action><Action onClick={onOpenFolder}>Open Output Folder</Action><Action onClick={onGenerateAgain}>Generate Again</Action><Action onClick={onGenerateCoverLetter} disabled={coverActive}>{coverActive ? "Generating..." : "Generate Cover Letter"}</Action>
      </div>
    </div>
  );
}

function Metric({ label, value }) { return <div style={{ background: "#12121c", padding: "10px", borderRadius: "7px" }}><div style={{ fontSize: "10px", color: "#5a6070", textTransform: "uppercase" }}>{label}</div><div style={{ marginTop: "3px", color: "#e2e8f0" }}>{value || "Unknown"}</div></div>; }
function Detail({ label, value }) { return <div style={{ marginTop: "12px", fontSize: "12px", lineHeight: 1.6 }}><span style={{ color: "#5a6070", textTransform: "uppercase", fontWeight: 700 }}>{label}: </span><span style={{ color: "#b0b8c8" }}>{value || "None"}</span></div>; }
function Action({ children, ...props }) { return <button className="btn" {...props} style={{ background: "#1a1f3a", color: "#a5b4fc", padding: "8px 12px", borderRadius: "7px", opacity: props.disabled ? 0.5 : 1 }}>{children}</button>; }
function formatUsage(usage) { return usage ? `${usage.inputTokens} input, ${usage.outputTokens} output, ${usage.cacheCreationInputTokens} cache write, ${usage.cacheReadInputTokens} cache read tokens` : "Unavailable"; }
