import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AiResumeStatus } from "./AiResumeStatus";
import { ResumeGenerationPanel } from "./ResumeGenerationPanel";
import { ResumeGenerationResult } from "./ResumeGenerationResult";
import { CoverLetterResult } from "./CoverLetterResult";
import { documentHistoryEntry, messageForResumeError, missingGenerationRequirements, subscribeToGeneration } from "../utils/resumeGeneration";

export function AiResumePage({ jobs, defaultProfile, status, onRefreshStatus, requestedJob, onOpenProfiles, onAddHistory, onRemoveHistory }) {
  const [selectedJobId, setSelectedJobId] = useState(requestedJob?.jobId ?? "");
  const [active, setActive] = useState(false);
  const [coverActive, setCoverActive] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [resumeResult, setResumeResult] = useState(null);
  const [coverResult, setCoverResult] = useState(null);
  const [testing, setTesting] = useState(false);
  const [testMessage, setTestMessage] = useState(null);
  const cleanupRef = useRef(() => {});
  const processedRequest = useRef(null);
  const selectedJob = useMemo(() => jobs.find(job => String(job.id) === String(selectedJobId)) || null, [jobs, selectedJobId]);
  const missing = missingGenerationRequirements({ status, profile: defaultProfile, job: selectedJob, active });

  const cleanupListener = useCallback(() => { cleanupRef.current(); cleanupRef.current = () => {}; }, []);
  useEffect(() => () => { cleanupListener(); window.resume?.cancelGeneration(); }, [cleanupListener]);

  const listen = useCallback(() => {
    cleanupListener();
    cleanupRef.current = subscribeToGeneration(window.resume, event => {
      if (["started", "progress"].includes(event.type)) setProgress(event.message);
      if (event.type === "cancelled") { setProgress("Generation cancelled"); setError(""); }
      if (event.type === "failed") setError(event.message || "Generation failed.");
    });
  }, [cleanupListener]);

  const generateResume = useCallback(async (job = selectedJob, generateCoverAfter = false) => {
    const requirements = missingGenerationRequirements({ status, profile: defaultProfile, job, active: false });
    if (!job || requirements.length) { setError(`Required: ${requirements.join(", ")}.`); return; }
    setSelectedJobId(job.id); setError(""); setResumeResult(null); setCoverResult(null); setActive(true); setProgress("Analyzing job requirements"); listen();
    try {
      const response = await window.resume.generate({ company: job.company, title: job.role, description: job.jd });
      if (!response.ok) { if (response.error?.code !== "CANCELLED") setError(messageForResumeError(response.error)); return; }
      setResumeResult(response.result); setProgress("Resume completed");
      onAddHistory(job.id, documentHistoryEntry("resume", response.result));
      if (generateCoverAfter) {
        setCoverActive(true); setProgress("Preparing cover letter");
        const coverResponse = await window.resume.generateCoverLetter({ job: { company: job.company, title: job.role, description: job.jd }, analysis: response.result.analysis, selection: response.result.selection });
        if (!coverResponse.ok) { if (coverResponse.error?.code !== "CANCELLED") setError(messageForResumeError(coverResponse.error)); }
        else { setCoverResult(coverResponse.result); setProgress("Cover letter completed"); onAddHistory(job.id, documentHistoryEntry("cover-letter", coverResponse.result)); }
        setCoverActive(false);
      }
    } catch { setError("JobTrack could not start resume generation."); }
    finally { setActive(false); cleanupListener(); }
  }, [selectedJob, status, defaultProfile, listen, cleanupListener, onAddHistory]);

  useEffect(() => {
    if (!requestedJob || requestedJob.nonce === processedRequest.current || !status) return;
    processedRequest.current = requestedJob.nonce;
    const job = jobs.find(item => item.id === requestedJob.jobId);
    if (job) generateResume(job, requestedJob.type === "cover-letter");
  }, [requestedJob, status, jobs, generateResume]);

  const generateCoverLetter = async () => {
    if (!selectedJob || !resumeResult) return;
    setCoverActive(true); setError(""); setProgress("Preparing cover letter"); listen();
    try {
      const response = await window.resume.generateCoverLetter({ job: { company: selectedJob.company, title: selectedJob.role, description: selectedJob.jd }, analysis: resumeResult.analysis, selection: resumeResult.selection });
      if (!response.ok) { if (response.error?.code !== "CANCELLED") setError(messageForResumeError(response.error)); return; }
      setCoverResult(response.result); setProgress("Cover letter completed"); onAddHistory(selectedJob.id, documentHistoryEntry("cover-letter", response.result));
    } catch { setError("JobTrack could not start cover-letter generation."); }
    finally { setCoverActive(false); cleanupListener(); }
  };

  const cancel = async () => { await window.resume.cancelGeneration(); setProgress("Cancelling generation"); };
  const testApi = async () => { setTesting(true); setTestMessage(null); const result = await window.resume.testApiKey(); setTestMessage({ ok: result.ok, text: result.ok ? "Connection successful." : messageForResumeError(result.error) }); setTesting(false); };
  const fileAction = async (method, fileName) => { const response = await window.resume[method](fileName); if (!response.ok) setError(messageForResumeError(response.error)); };

  return <>
    <div style={{ background: "#0e0e18", borderBottom: "1px solid #1a1a2e", padding: "22px 32px" }}><div style={{ fontFamily: "Syne, sans-serif", fontSize: "26px", fontWeight: 800 }}>AI <span style={{ color: "#6366f1" }}>RESUME</span></div><div style={{ color: "#5a6070", fontSize: "13px", marginTop: "4px" }}>Verified content, deterministic one-page rendering</div></div>
    <div style={{ padding: "24px 32px 48px", maxWidth: "1100px", margin: "0 auto", display: "grid", gap: "16px" }}>
      <AiResumeStatus status={status} defaultProfile={defaultProfile} onTestApi={testApi} testing={testing} testMessage={testMessage} onOpenProfiles={onOpenProfiles} onRefresh={onRefreshStatus} />
      <ResumeGenerationPanel jobs={jobs} selectedJobId={selectedJobId} onSelectJob={setSelectedJobId} missing={missing} active={active || coverActive} progress={progress} onGenerate={() => generateResume()} onCancel={cancel} />
      {error && <div style={{ background: "#2d1010", border: "1px solid #5a2020", color: "#f87171", padding: "12px", borderRadius: "8px" }}>{error}</div>}
      <ResumeGenerationResult result={resumeResult} onOpen={file => fileAction("openPdf", file)} onReveal={file => fileAction("revealGenerated", file)} onOpenFolder={() => fileAction("openOutputFolder")} onGenerateAgain={() => generateResume()} onGenerateCoverLetter={generateCoverLetter} coverActive={coverActive} />
      <CoverLetterResult result={coverResult} onOpen={file => fileAction("openPdf", file)} onReveal={file => fileAction("revealGenerated", file)} onOpenFolder={() => fileAction("openOutputFolder")} />
      {selectedJob && <History job={selectedJob} onOpen={file => fileAction("openPdf", file)} onReveal={file => fileAction("revealGenerated", file)} onRemove={id => onRemoveHistory(selectedJob.id, id)} onRegenerate={document => generateResume(selectedJob, document.type === "cover-letter")} />}
    </div>
  </>;
}

function History({ job, onOpen, onReveal, onRemove, onRegenerate }) {
  const documents = [...(job.generatedDocuments || [])].reverse();
  if (!documents.length) return null;
  return <div style={{ background: "#0e0e18", border: "1px solid #1a1a2e", borderRadius: "12px", padding: "18px" }}><div style={{ fontFamily: "Syne, sans-serif", fontWeight: 700, marginBottom: "10px" }}>Generated document history</div>{documents.map(document => <div key={document.id} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 0", borderTop: "1px solid #1a1a2e", flexWrap: "wrap" }}><span style={{ color: "#a5b4fc", minWidth: "90px" }}>{document.type}</span><span style={{ color: "#7a8494", fontSize: "12px", flex: 1 }}>{new Date(document.createdAt).toLocaleString()} · {document.pdfFileName}</span><button className="btn" onClick={() => onOpen(document.pdfFileName)} style={historyButton}>Open</button><button className="btn" onClick={() => onReveal(document.pdfFileName)} style={historyButton}>Reveal</button><button className="btn" onClick={() => onRegenerate(document)} style={historyButton}>Regenerate</button><button className="btn" onClick={() => onRemove(document.id)} style={{ ...historyButton, color: "#f87171" }}>Remove</button></div>)}</div>;
}
const historyButton = { background: "#1a1a2e", color: "#94a3b8", padding: "6px 9px", borderRadius: "6px", fontSize: "11px" };
