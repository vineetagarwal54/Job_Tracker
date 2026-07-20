export function CoverLetterResult({ result, onOpen, onReveal, onOpenFolder }) {
  if (!result) return null;
  return <div style={{ background: "#0e0e18", border: "1px solid #21492f", borderRadius: "12px", padding: "20px" }}>
    <div style={{ color: "#4ade80", fontSize: "12px", fontWeight: 700 }}>COVER LETTER COMPLETED</div>
    <div style={{ marginTop: "6px", color: "#c8cdd5" }}>{result.content?.wordCount} words · {result.pageCount} page · estimated cost ${Number(result.estimatedCostUsd || 0).toFixed(4)}</div>
    <div style={{ marginTop: "6px", color: "#7a8494", fontSize: "12px" }}>{result.model} · {result.pdfFileName}</div>
    <div style={{ marginTop: "6px", color: "#7a8494", fontSize: "12px" }}>{result.usage?.coverLetter?.inputTokens || 0} input · {result.usage?.coverLetter?.outputTokens || 0} output · {result.usage?.coverLetter?.cacheCreationInputTokens || 0} cache write · {result.usage?.coverLetter?.cacheReadInputTokens || 0} cache read tokens</div>
    {result.atsWarning && <div style={{ marginTop: "8px", fontSize: "12px", color: "#94a3b8", lineHeight: 1.5 }}>{result.atsWarning}</div>}
    <div style={{ display: "flex", gap: "8px", marginTop: "14px", flexWrap: "wrap" }}>
      <button className="btn" onClick={() => window.resume?.saveCopy?.({ fileName: result.pdfFileName, suggestedName: result.suggestedFileName })} style={{ ...button, background: "#6366f1", color: "#fff" }}>Save Cover Letter</button>
      <button className="btn" onClick={() => onOpen(result.pdfFileName)} style={button}>Open Cover Letter</button>
      <button className="btn" onClick={() => onReveal(result.pdfFileName)} style={button}>Reveal Cover Letter</button>
      <button className="btn" onClick={onOpenFolder} style={button}>Open Output Folder</button>
    </div>
  </div>;
}
const button = { background: "#1a1f3a", color: "#a5b4fc", padding: "8px 12px", borderRadius: "7px" };
