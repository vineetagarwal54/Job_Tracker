import { useState } from "react";

export function GenerateDocumentsModal({ open, job, generation, resumeSources = [], onClose, children }) {
  const [view, setView] = useState("choice");
  const [sourceId, setSourceId] = useState(resumeSources[0]?.id || "");
  const [jd, setJd] = useState(job?.description || "");
  if (!open) return null;
  const isGenerating = generation.active;
  const completed = (generation.resumeResult || generation.coverLetterResult) && !isGenerating;
  const choose = (documentChoice) => generation.generate({ job, documentChoice });
  const startCoverOnly = () => {
    const source = resumeSources.find((item) => item.id === sourceId) || resumeSources[0];
    generation.generateCoverLetterOnly({ job: { ...job, description: jd || job?.description }, source });
  };
  const close = () => { setView("choice"); onClose(); };

  return (
    <div style={overlay}>
      <div style={modal}>
        {!isGenerating && !completed && !generation.error && !generation.coverLetterError && view === "choice" && (
          <>
            <div style={title}>What do you want to generate?</div>
            <div style={{ display: "grid", gap: "12px", marginTop: "18px" }}>
              <Choice label="Resume" estimate="About $0.04" time="About 20 seconds" onClick={() => choose("resume")} />
              <Choice label="Resume + Cover Letter" estimate="About $0.06" time="About 45 seconds" onClick={() => choose("resume-and-cover-letter")} />
              <Choice label="Cover Letter Only" estimate="About $0.03" time="About 25 seconds" onClick={() => { setJd(job?.description || ""); setSourceId(resumeSources[0]?.id || ""); setView("cover-only"); }} />
            </div>
          </>
        )}

        {!isGenerating && !completed && view === "cover-only" && (
          <>
            <div style={title}>Cover Letter Only</div>
            {resumeSources.length === 0 ? (
              <div style={{ ...muted, color: "#fbbf24" }}>Generate a resume first. A cover letter reuses a generated resume's verified evidence.</div>
            ) : (
              <div style={{ display: "grid", gap: "12px", marginTop: "16px" }}>
                <label style={fieldLabel}>Base it on this resume
                  <select className="form-select" value={sourceId} onChange={(event) => setSourceId(event.target.value)} style={{ width: "100%", marginTop: "6px" }}>
                    {resumeSources.map((source) => <option key={source.id} value={source.id}>{source.label}</option>)}
                  </select>
                </label>
                <label style={fieldLabel}>Job description
                  <textarea value={jd} onChange={(event) => setJd(event.target.value)} rows={7} style={textarea} placeholder="Paste the job description for the cover letter" />
                </label>
                <div style={{ display: "flex", gap: "10px" }}>
                  <button className="btn" onClick={startCoverOnly} disabled={!jd.trim()} style={{ ...primaryButton, opacity: jd.trim() ? 1 : 0.5 }}>Generate Cover Letter</button>
                  <button className="btn" onClick={() => setView("choice")} style={secondaryButton}>Back</button>
                </div>
              </div>
            )}
          </>
        )}

        {isGenerating && <div style={{ padding: "14px 0" }}><div style={title}>{generation.progress || "Generating documents"}</div><div style={muted}>Elapsed: {generation.elapsedSeconds}s</div><div style={muted}>Estimated cost: ${Number(generation.estimatedCostUsd || 0).toFixed(2)}</div><button className="btn" onClick={generation.cancel} style={{ ...secondaryButton, marginTop: "18px", color: "#fbbf24" }}>Cancel</button></div>}
        {(generation.error || (generation.coverLetterError && !completed)) && !isGenerating && <div style={{ color: "#f87171" }}><div style={title}>Could not generate documents</div><div style={{ marginTop: "8px", lineHeight: 1.5 }}>{generation.error || generation.coverLetterError}</div></div>}
        {completed && <div><div style={title}>{generation.coverLetterError ? "Completed with a note" : "Completed"}</div><div style={muted}>Estimated cost: ${Number(generation.estimatedCostUsd || 0).toFixed(4)}</div>{generation.coverLetterError && <div style={{ marginTop: "12px", color: "#fbbf24", fontSize: "13px" }}>Cover letter: {generation.coverLetterError}</div>}{children}</div>}
        {!isGenerating && <button className="btn" onClick={close} style={{ ...secondaryButton, marginTop: "20px" }}>Close</button>}
      </div>
    </div>
  );
}

function Choice({ label, estimate, time, onClick }) { return <button className="btn" onClick={onClick} style={{ textAlign: "left", padding: "18px", borderRadius: "10px", background: "#161a33", border: "1px solid #39417a", color: "#f1f5f9" }}><div style={{ fontWeight: 800, fontSize: "16px" }}>{label}</div><div style={{ color: "#a5b4fc", marginTop: "7px", fontSize: "13px" }}>{estimate} · {time}</div></button>; }
const overlay = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 120 };
const modal = { background: "#0e0e18", border: "1px solid #222233", borderRadius: "14px", width: "460px", maxWidth: "94vw", padding: "24px 26px", maxHeight: "90vh", overflowY: "auto" };
const title = { fontFamily: "Syne, sans-serif", fontSize: "19px", fontWeight: 700, color: "#f1f5f9" };
const muted = { marginTop: "10px", color: "#94a3b8", fontSize: "13px" };
const fieldLabel = { fontSize: "12px", color: "#94a3b8", fontWeight: 600 };
const textarea = { width: "100%", marginTop: "6px", background: "#0b0b12", border: "1px solid #222233", borderRadius: "8px", color: "#e2e8f0", padding: "10px", fontSize: "13px", fontFamily: "inherit", resize: "vertical" };
const primaryButton = { background: "#6366f1", color: "#fff", padding: "10px 16px", borderRadius: "8px", fontWeight: 700 };
const secondaryButton = { background: "#1a1a2e", color: "#a5b4fc", padding: "9px 14px", borderRadius: "7px" };
