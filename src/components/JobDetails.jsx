import { useCallback, useState } from "react";
import { STATUSES, PRIORITIES, STATUS_CONFIG, PRIORITY_CONFIG } from "../constants";
import { isDeadlineSoon, isDeadlinePast } from "../utils/deadline";
import { cleanJobDescription } from "../utils/jobDescriptionCleaner";
import { documentHistoryEntry, missingGenerationRequirements, coverLetterSources } from "../utils/resumeGeneration";
import { useDocumentGeneration } from "../hooks/useDocumentGeneration";
import { InfoBlock } from "./InfoBlock";
import { GenerateDocumentsModal } from "./GenerateDocumentsModal";
import { ResumeGenerationResult } from "./ResumeGenerationResult";
import { CoverLetterResult } from "./CoverLetterResult";

export function JobDetails({ job, canReorder, isFirstOverall, isLastOverall, workspaces, onChangeStatus, onChangePriority, onPin, onMoveToBottom, onMoveToWorkspace, resumeStatus, onAddGenerated, onOpenGenerated, onRevealGenerated, onRemoveGenerated, globalResumeSources = [] }) {
  const [activeTab, setActiveTab] = useState("details");
  const [copied, setCopied] = useState(false);
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const generation = useDocumentGeneration({
    status: resumeStatus,
    onResumeComplete: useCallback((result) => onAddGenerated(documentHistoryEntry("resume", result)), [onAddGenerated]),
    onCoverLetterComplete: useCallback((result) => onAddGenerated(documentHistoryEntry("cover-letter", result)), [onAddGenerated]),
  });
  const sc = STATUS_CONFIG[job.status] || STATUS_CONFIG.Applied;
  const pc = PRIORITY_CONFIG[job.priority] || PRIORITY_CONFIG.Medium;
  const resumeMissing = missingGenerationRequirements({ status: resumeStatus, job, active: generation.active });
  const documentJob = { company: job.company || "Untitled", title: job.role || "Role", description: job.jd };
  const resumeSources = [...coverLetterSources({ documents: (job.generatedDocuments || []).map((document) => ({ ...document, company: job.company })), liveResult: generation.resumeResult, liveJob: documentJob }), ...globalResumeSources.filter((source) => source.id !== "live")];
  const openGenerate = () => { generation.reset(); setShowGenerateModal(true); };
  const [saveBothMessage, setSaveBothMessage] = useState("");
  const saveBoth = async () => {
    const result = await window.resume?.saveBoth?.({ files: [
      { fileName: generation.resumeResult.pdfFileName, suggestedName: generation.resumeResult.suggestedFileName },
      { fileName: generation.coverLetterResult.pdfFileName, suggestedName: generation.coverLetterResult.suggestedFileName },
    ] });
    if (result?.canceled) return;
    setSaveBothMessage(result?.ok ? `Saved both documents to ${result.savedPaths?.[0] ? "the selected folder" : "the selected folder"}.` : result?.partial ? `Saved ${result.savedPaths?.length || 0} document(s); ${result.error?.message || "the other file could not be saved"}.` : result?.error?.message || "Could not save both documents.");
  };
  const copyJd = () => { navigator.clipboard.writeText(cleanJobDescription(job.jd)); setCopied(true); setTimeout(() => setCopied(false), 2000); };

  return <div style={{ background: "#0e0e18", borderBottom: "1px solid #151520", borderLeft: `3px solid ${sc.dot}`, borderRadius: "0 0 8px 8px" }}>
    <div style={{ padding: "16px 26px", borderBottom: "1px solid #1a1a2e", display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
      {job.jd ? <button className="btn" onClick={openGenerate} disabled={resumeMissing.length > 0} style={{ background: resumeMissing.length ? "#24243a" : "#6366f1", color: resumeMissing.length ? "#5a6070" : "#fff", padding: "10px 18px", borderRadius: "8px", fontWeight: 800 }}>Generate</button> : <span style={{ color: "#94a3b8", fontSize: "13px" }}>Add a job description to generate documents.</span>}
      {job.jd && resumeMissing.length > 0 && <span style={{ color: "#f87171", fontSize: "12px" }}>Required: {resumeMissing.join(", ")}.</span>}
      {generation.active && <span style={{ color: "#a5b4fc", fontSize: "13px" }}>{generation.progress} · Elapsed: {generation.elapsedSeconds}s</span>}
    </div>
    <div style={{ display: "flex", borderBottom: "1px solid #1a1a2e", paddingLeft: "22px" }}>
      <button className={`tab-btn ${activeTab === "details" ? "active" : ""}`} onClick={() => setActiveTab("details")}>Details</button>
      <button className={`tab-btn ${activeTab === "jd" ? "active" : ""}`} onClick={() => setActiveTab("jd")}>Job Description {job.jd ? "" : "(empty)"}</button>
      <button className={`tab-btn ${activeTab === "status" ? "active" : ""}`} onClick={() => setActiveTab("status")}>Status</button>
    </div>
    <div style={{ padding: "18px 26px 22px" }}>
      {activeTab === "details" && <Details job={job} deadlineSoon={isDeadlineSoon(job.deadline)} deadlinePast={isDeadlinePast(job.deadline)} pc={pc} />}
      {activeTab === "jd" && (job.jd ? <div><div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "10px" }}><button className="btn" onClick={copyJd} style={{ ...historyButton, color: copied ? "#4ade80" : "#818cf8" }}>{copied ? "Copied!" : "Copy JD"}</button></div><div className="jd-box">{job.jd}</div></div> : <div style={{ fontSize: "14px", color: "#5a6070" }}>No job description saved. Click Edit to paste it in.</div>)}
      {activeTab === "status" && <StatusControls job={job} workspaces={workspaces} canReorder={canReorder} isFirstOverall={isFirstOverall} isLastOverall={isLastOverall} onChangeStatus={onChangeStatus} onChangePriority={onChangePriority} onPin={onPin} onMoveToBottom={onMoveToBottom} onMoveToWorkspace={onMoveToWorkspace} />}
      {(generation.resumeResult || generation.coverLetterResult || generation.error || generation.coverLetterError) && <div style={{ marginTop: "20px" }}>
        {generation.error && <div style={errorBox}>{generation.error}</div>}
        {generation.coverLetterError && <div style={{ ...errorBox, color: "#fbbf24", borderColor: "#5a4a20", background: "#241d0e" }}>Resume completed. Cover letter: {generation.coverLetterError}</div>}
        {generation.resumeResult && generation.coverLetterResult && <button className="btn" onClick={saveBoth} style={{ background: "#6366f1", color: "#fff", padding: "9px 16px", borderRadius: "8px", fontWeight: 700, marginBottom: "12px" }}>Save Both</button>}
        {saveBothMessage && <div style={{ color: "#a5b4fc", fontSize: "12px", marginBottom: "10px" }}>{saveBothMessage}</div>}
        <ResumeGenerationResult result={generation.resumeResult} onOpen={onOpenGenerated} onReveal={onRevealGenerated} onOpenFolder={() => window.resume.openOutputFolder()} onGenerateAgain={openGenerate} />
        <CoverLetterResult result={generation.coverLetterResult} onOpen={onOpenGenerated} onReveal={onRevealGenerated} onOpenFolder={() => window.resume.openOutputFolder()} />
      </div>}
      <History documents={job.generatedDocuments || []} onOpen={onOpenGenerated} onReveal={onRevealGenerated} onRegenerate={openGenerate} onRemove={onRemoveGenerated} />
    </div>
    <GenerateDocumentsModal open={showGenerateModal} job={documentJob} generation={generation} resumeSources={resumeSources} onClose={() => setShowGenerateModal(false)} />
  </div>;
}

function Details({ job, deadlineSoon, deadlinePast, pc }) { return <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "16px" }}>{job.salary && <InfoBlock label="SALARY" value={job.salary} />}{job.location && <InfoBlock label="LOCATION" value={`${job.location} · ${job.workType}`} />}{job.source && <InfoBlock label="SOURCE" value={job.source} />}{job.date && <InfoBlock label="APPLIED" value={job.date} />}{job.deadline && <InfoBlock label="DEADLINE" value={job.deadline} color={deadlinePast ? "#f87171" : deadlineSoon ? "#fbbf24" : undefined} />}{job.priority && <InfoBlock label="PRIORITY" value={job.priority} color={pc.color} />}{job.recruiter && <InfoBlock label="RECRUITER" value={job.recruiter + (job.recruiterEmail ? ` · ${job.recruiterEmail}` : "")} />}{job.link && <div><div style={smallLabel}>JOB LINK</div><a href={job.link} target="_blank" rel="noreferrer" style={{ fontSize: "14px", color: "#818cf8", fontWeight: 500 }}>Open posting</a></div>}{job.notes && <div style={{ gridColumn: "1/-1" }}><div style={smallLabel}>NOTES</div><div style={{ fontSize: "14px", color: "#b0b8c8", lineHeight: 1.7 }}>{job.notes}</div></div>}</div>; }
function StatusControls({ job, workspaces, canReorder, isFirstOverall, isLastOverall, onChangeStatus, onChangePriority, onPin, onMoveToBottom, onMoveToWorkspace }) { return <div><div style={smallLabel}>CHANGE STATUS</div><div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>{STATUSES.map(s => <button key={s} className="btn" onClick={() => onChangeStatus(s)} style={{ padding: "7px 16px", borderRadius: "6px", fontSize: "13px", fontWeight: 600, background: job.status === s ? STATUS_CONFIG[s].bg : "transparent", color: job.status === s ? STATUS_CONFIG[s].color : "#5a6070", border: `1px solid ${job.status === s ? STATUS_CONFIG[s].color : "#222233"}` }}>{s}</button>)}</div><div style={{ ...smallLabel, marginTop: "20px" }}>CHANGE PRIORITY</div><div style={{ display: "flex", gap: "8px" }}>{PRIORITIES.map(p => <button key={p} className="btn" onClick={() => onChangePriority(p)} style={{ padding: "7px 16px", borderRadius: "6px", fontSize: "13px", fontWeight: 600, background: job.priority === p ? PRIORITY_CONFIG[p].bg : "transparent", color: job.priority === p ? PRIORITY_CONFIG[p].color : "#5a6070", border: `1px solid ${job.priority === p ? PRIORITY_CONFIG[p].color : "#222233"}` }}>{p}</button>)}</div>{workspaces?.length > 1 && <><div style={{ ...smallLabel, marginTop: "20px" }}>MOVE TO WORKSPACE</div><div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>{workspaces.map(w => <button key={w.id} className="btn" onClick={() => job.workspaceId !== w.id && onMoveToWorkspace(w.id)} disabled={job.workspaceId === w.id} style={historyButton}>{w.name}{job.workspaceId === w.id ? " (current)" : ""}</button>)}</div></>}{canReorder && <div style={{ display: "flex", gap: "8px", marginTop: "20px" }}><button className="btn" onClick={onPin} disabled={isFirstOverall} style={historyButton}>▲ Pin to Top</button><button className="btn" onClick={onMoveToBottom} disabled={isLastOverall} style={historyButton}>▼ Move to Bottom</button></div>}</div>; }
function History({ documents, onOpen, onReveal, onRegenerate, onRemove }) { return <div style={{ marginTop: "20px" }}><div style={smallLabel}>GENERATED DOCUMENTS</div>{documents.length === 0 ? <div style={{ color: "#5a6070", fontSize: "13px" }}>No generated documents yet.</div> : [...documents].reverse().map(document => <div key={document.id} style={{ display: "flex", alignItems: "center", gap: "8px", borderTop: "1px solid #1a1a2e", padding: "10px 0", flexWrap: "wrap" }}><span style={{ color: "#a5b4fc", minWidth: "90px" }}>{document.type}</span><span style={{ color: "#7a8494", fontSize: "12px", flex: 1 }}>{new Date(document.createdAt).toLocaleString()} · {document.pdfFileName}</span><button className="btn" onClick={() => onOpen(document.pdfFileName)} style={historyButton}>Open</button><button className="btn" onClick={() => onReveal(document.pdfFileName)} style={historyButton}>Reveal</button><button className="btn" onClick={onRegenerate} style={historyButton}>Regenerate</button><button className="btn" onClick={() => onRemove(document.id)} style={{ ...historyButton, color: "#f87171" }}>Remove</button></div>)}</div>; }
const smallLabel = { fontSize: "11px", color: "#5a6070", letterSpacing: "0.06em", marginBottom: "12px", fontWeight: 600 };
const historyButton = { background: "#1a1a2e", color: "#94a3b8", padding: "6px 9px", borderRadius: "6px", fontSize: "11px" };
const errorBox = { background: "#2d1010", border: "1px solid #5a2020", color: "#f87171", padding: "12px", borderRadius: "8px", marginBottom: "12px" };
