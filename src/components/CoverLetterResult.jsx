import { useState } from "react";

export function CoverLetterResult({ result, onOpen, onReveal, onOpenFolder }) {
  const [copied, setCopied] = useState(false);
  if (!result) return null;
  const copyDiagnostics = async () => {
    const data = { fallback: result.fallback, fallbackDiagnostics: result.fallbackDiagnostics || null, model: result.model, modelCalls: result.modelCalls, apiDurationMs: result.apiDurationMs, usage: result.usage?.coverLetter || null, evidenceIds: result.evidenceIds || [], requirementMatches: result.requirementMatches || [], pageCount: result.pageCount, atsIntegrity: result.atsIntegrity || null };
    await navigator.clipboard?.writeText?.(`JobTrack cover letter diagnostics\n${JSON.stringify(data, null, 2)}`);
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  };
  return <div style={{ background: "#0e0e18", border: "1px solid #21492f", borderRadius: "12px", padding: "20px" }}>
    <div style={{ color: "#4ade80", fontSize: "12px", fontWeight: 700 }}>COVER LETTER COMPLETED</div>
    <div style={{ marginTop: "6px", color: "#c8cdd5" }}>{result.content?.wordCount} words · {result.pageCount} page · {result.fallback ? "verified fallback" : "evidence validated"} · estimated cost ${Number(result.estimatedCostUsd || 0).toFixed(4)}</div>
    <div style={{ marginTop: "6px", color: "#7a8494", fontSize: "12px" }}>{result.model} · {result.pdfFileName}</div>
    <div style={{ marginTop: "6px", color: "#7a8494", fontSize: "12px" }}>{result.usage?.coverLetter?.inputTokens || 0} input · {result.usage?.coverLetter?.outputTokens || 0} output · {result.usage?.coverLetter?.cacheCreationInputTokens || 0} cache write · {result.usage?.coverLetter?.cacheReadInputTokens || 0} cache read tokens</div>
    {result.atsWarning && <div style={{ marginTop: "8px", fontSize: "12px", color: "#94a3b8", lineHeight: 1.5 }}>{result.atsWarning}</div>}
    <details style={{ marginTop: "12px", userSelect: "text" }}>
      <summary style={{ cursor: "pointer", color: "#5a6070", fontSize: "12px", fontWeight: 700, textTransform: "uppercase" }}>Advanced details</summary>
      <div style={{ marginTop: "8px", color: "#94a3b8", fontSize: "12px", lineHeight: 1.6 }}>
        <div>Fallback: {result.fallbackDiagnostics?.fallbackType || "None"}</div>
        <div>Stage / code: {result.fallbackDiagnostics ? `${result.fallbackDiagnostics.stage} / ${result.fallbackDiagnostics.code}` : "None"}</div>
        <div>Reason: {result.fallbackDiagnostics?.reason || "None"}</div>
        <div>API duration: {result.apiDurationMs ?? "Unavailable"} ms</div>
        <div>Evidence IDs: {(result.evidenceIds || []).join(", ") || "None"}</div>
        <button className="btn" onClick={copyDiagnostics} style={{ ...button, marginTop: "8px" }}>{copied ? "Diagnostics copied" : "Copy diagnostics"}</button>
      </div>
    </details>
    <div style={{ display: "flex", gap: "8px", marginTop: "14px", flexWrap: "wrap" }}>
      <button className="btn" onClick={() => window.resume?.saveCopy?.({ fileName: result.pdfFileName, suggestedName: result.suggestedFileName })} style={{ ...button, background: "#6366f1", color: "#fff" }}>Save Cover Letter</button>
      <button className="btn" onClick={() => onOpen(result.pdfFileName)} style={button}>Open Cover Letter</button>
      <button className="btn" onClick={() => onReveal(result.pdfFileName)} style={button}>Reveal Cover Letter</button>
      <button className="btn" onClick={onOpenFolder} style={button}>Open Output Folder</button>
    </div>
  </div>;
}
const button = { background: "#1a1f3a", color: "#a5b4fc", padding: "8px 12px", borderRadius: "7px" };
