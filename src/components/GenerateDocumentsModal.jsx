export function GenerateDocumentsModal({ open, job, generation, onClose, children }) {
  if (!open) return null;
  const isGenerating = generation.active;
  const completed = generation.resumeResult && !isGenerating;
  const choose = (documentChoice) => generation.generate({ job, documentChoice });
  return (
    <div style={overlay}>
      <div style={modal}>
        {!isGenerating && !completed && !generation.error && (
          <>
            <div style={title}>What do you want to generate?</div>
            <div style={{ display: "grid", gap: "12px", marginTop: "18px" }}>
              <Choice label="Resume" estimate="About $0.04" time="About 20 seconds" onClick={() => choose("resume")} />
              <Choice label="Resume + Cover Letter" estimate="About $0.05" time="About 35 seconds" onClick={() => choose("resume-and-cover-letter")} />
            </div>
          </>
        )}
        {isGenerating && <div style={{ padding: "14px 0" }}><div style={title}>{generation.progress || "Generating documents"}</div><div style={muted}>Elapsed: {generation.elapsedSeconds}s</div><div style={muted}>Estimated cost: ${Number(generation.estimatedCostUsd || 0).toFixed(2)}</div><button className="btn" onClick={generation.cancel} style={{ ...secondaryButton, marginTop: "18px", color: "#fbbf24" }}>Cancel</button></div>}
        {generation.error && !isGenerating && <div style={{ color: "#f87171" }}><div style={title}>Could not generate documents</div><div style={{ marginTop: "8px", lineHeight: 1.5 }}>{generation.error}</div></div>}
        {completed && <div><div style={title}>{generation.coverLetterError ? "Resume completed" : "Completed"}</div><div style={muted}>Estimated cost: ${Number(generation.estimatedCostUsd || 0).toFixed(4)}</div>{generation.coverLetterError && <div style={{ marginTop: "12px", color: "#fbbf24", fontSize: "13px" }}>Cover letter: {generation.coverLetterError}</div>}{children}</div>}
        {!isGenerating && <button className="btn" onClick={onClose} style={{ ...secondaryButton, marginTop: "20px" }}>Close</button>}
      </div>
    </div>
  );
}

function Choice({ label, estimate, time, onClick }) { return <button className="btn" onClick={onClick} style={{ textAlign: "left", padding: "18px", borderRadius: "10px", background: "#161a33", border: "1px solid #39417a", color: "#f1f5f9" }}><div style={{ fontWeight: 800, fontSize: "16px" }}>{label}</div><div style={{ color: "#a5b4fc", marginTop: "7px", fontSize: "13px" }}>{estimate} · {time}</div></button>; }
const overlay = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 120 };
const modal = { background: "#0e0e18", border: "1px solid #222233", borderRadius: "14px", width: "460px", maxWidth: "94vw", padding: "24px 26px" };
const title = { fontFamily: "Syne, sans-serif", fontSize: "19px", fontWeight: 700, color: "#f1f5f9" };
const muted = { marginTop: "10px", color: "#94a3b8", fontSize: "13px" };
const secondaryButton = { background: "#1a1a2e", color: "#a5b4fc", padding: "9px 14px", borderRadius: "7px" };
