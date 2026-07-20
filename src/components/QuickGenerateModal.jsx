import { useEffect, useState } from "react";
import { useDocumentGeneration } from "../hooks/useDocumentGeneration";
import { quickGenerationHistoryEntry, coverLetterSources } from "../utils/resumeGeneration";
import { GenerateDocumentsModal } from "./GenerateDocumentsModal";
import { ResumeGenerationResult } from "./ResumeGenerationResult";
import { CoverLetterResult } from "./CoverLetterResult";

export function looksLikeJobDescription(text) {
  const value = String(text || "").trim();
  if (value.length <= 200 || /^https?:\/\/\S+$/i.test(value)) return false;
  const words = value.match(/[A-Za-z0-9+#./-]+/g) || [];
  return words.length > 20 && (/[.!?]/.test(value) || /\r?\n/.test(value));
}

export function QuickGenerateModal({ open, status, onClose, onAddHistory }) {
  const [form, setForm] = useState({ company: "Untitled", title: "Role", description: "" });
  const [choiceOpen, setChoiceOpen] = useState(false);
  const generation = useDocumentGeneration({
    status,
    onResumeComplete: (result, job) => onAddHistory(quickGenerationHistoryEntry(job, "resume", result)),
    onCoverLetterComplete: (result, job) => onAddHistory(quickGenerationHistoryEntry(job, "cover-letter", result)),
  });

  useEffect(() => {
    if (!open) return;
    setForm({ company: "Untitled", title: "Role", description: "" });
    generation.reset();
    let disposed = false;
    navigator.clipboard?.readText?.().then((text) => {
      if (!disposed && looksLikeJobDescription(text)) setForm(current => current.description ? current : { ...current, description: text.trim() });
    }).catch(() => {});
    return () => { disposed = true; };
  }, [open]);

  if (!open) return null;
  const update = (field, value) => setForm(current => ({ ...current, [field]: value }));
  const close = () => { if (!generation.active) { setChoiceOpen(false); onClose(); } };
  const job = { company: form.company || "Untitled", title: form.title || "Role", description: form.description };
  return <>
    {!choiceOpen && <div style={overlay}><div style={modal}><div style={title}>Quick Generate</div><div style={muted}>Generate documents without creating a saved job.</div><label style={label}>COMPANY (OPTIONAL)</label><input className="form-input" value={form.company} onChange={e => update("company", e.target.value)} /><label style={label}>ROLE (OPTIONAL)</label><input className="form-input" value={form.title} onChange={e => update("title", e.target.value)} /><label style={label}>JOB DESCRIPTION</label><textarea className="form-input" value={form.description} onChange={e => update("description", e.target.value)} style={{ minHeight: "220px", resize: "vertical" }} /><div style={{ display: "flex", gap: "10px", justifyContent: "flex-end", marginTop: "16px" }}><button className="btn" onClick={close} style={secondary}>Close</button><button className="btn" onClick={() => setChoiceOpen(true)} disabled={!form.description.trim()} style={{ ...primary, opacity: form.description.trim() ? 1 : .5 }}>Continue</button></div></div></div>}
    <GenerateDocumentsModal open={choiceOpen} job={job} generation={generation} resumeSources={coverLetterSources({ liveResult: generation.resumeResult, liveJob: job })} onClose={close}><div style={{ marginTop: "16px" }}><ResumeGenerationResult result={generation.resumeResult} onOpen={file => window.resume.openPdf(file)} onReveal={file => window.resume.revealGenerated(file)} onOpenFolder={() => window.resume.openOutputFolder()} onGenerateAgain={() => { generation.reset(); }} /><CoverLetterResult result={generation.coverLetterResult} onOpen={file => window.resume.openPdf(file)} onReveal={file => window.resume.revealGenerated(file)} onOpenFolder={() => window.resume.openOutputFolder()} /></div></GenerateDocumentsModal>
  </>;
}

const overlay = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 110 };
const modal = { background: "#0e0e18", border: "1px solid #222233", borderRadius: "14px", width: "660px", maxWidth: "94vw", padding: "24px 26px" };
const title = { fontFamily: "Syne, sans-serif", fontSize: "20px", fontWeight: 700 };
const muted = { color: "#94a3b8", fontSize: "13px", marginTop: "6px", marginBottom: "14px" };
const label = { display: "block", color: "#5a6070", fontSize: "11px", letterSpacing: ".06em", fontWeight: 700, margin: "14px 0 6px" };
const secondary = { background: "#1a1a2e", color: "#94a3b8", padding: "10px 16px", borderRadius: "8px" };
const primary = { background: "#6366f1", color: "#fff", padding: "10px 16px", borderRadius: "8px" };
