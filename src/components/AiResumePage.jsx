import { useMemo, useState } from "react";
import { AiResumeStatus } from "./AiResumeStatus";
import { messageForResumeError } from "../utils/resumeGeneration";

export function AiResumePage({ jobs, generationHistory, status, onRefreshStatus, onRemoveJobHistory, onRemoveQuickHistory }) {
  const [testing, setTesting] = useState(false);
  const [testMessage, setTestMessage] = useState(null);
  const [error, setError] = useState("");
  const history = useMemo(() => [
    ...jobs.flatMap(job => (job.generatedDocuments || []).map(document => ({ ...document, source: "saved-job", company: job.company || "Untitled", title: job.role || "Role", jobId: job.id }))),
    ...(generationHistory || []),
  ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)), [jobs, generationHistory]);
  const action = async (method, fileName) => { const result = await window.resume?.[method]?.(fileName); if (!result?.ok) setError(messageForResumeError(result?.error)); };
  const testApi = async () => { setTesting(true); setTestMessage(null); const result = await window.resume.testApiKey(); setTestMessage({ ok: result.ok, text: result.ok ? "Connection successful." : messageForResumeError(result.error) }); setTesting(false); };
  return <><div style={{ background: "#0e0e18", borderBottom: "1px solid #1a1a2e", padding: "22px 32px" }}><div style={{ fontFamily: "Syne, sans-serif", fontSize: "26px", fontWeight: 800 }}>AI <span style={{ color: "#6366f1" }}>RESUME</span></div><div style={{ color: "#5a6070", fontSize: "13px", marginTop: "4px" }}>API status and generated document history</div></div><div style={{ padding: "24px 32px 48px", maxWidth: "1100px", margin: "0 auto", display: "grid", gap: "16px" }}><AiResumeStatus status={status} onTestApi={testApi} testing={testing} testMessage={testMessage} onRefresh={onRefreshStatus} />{error && <div style={errorBox}>{error}</div>}<div style={panel}><div style={heading}>Generated document history</div>{history.length === 0 ? <div style={{ color: "#5a6070", fontSize: "13px" }}>No generated documents yet.</div> : history.map(document => <div key={`${document.source}-${document.id}`} style={row}><span style={{ color: "#a5b4fc", minWidth: "105px" }}>{document.type}</span><span style={{ color: "#c8cdd5", minWidth: "180px" }}>{document.company} · {document.title}</span>{document.source === "quick-generate" && <span style={tag}>Quick Generate</span>}<span style={{ color: "#7a8494", fontSize: "12px", flex: 1 }}>{new Date(document.createdAt).toLocaleString()} · {document.pdfFileName}</span><button className="btn" onClick={() => action("openPdf", document.pdfFileName)} style={button}>Open</button><button className="btn" onClick={() => action("revealGenerated", document.pdfFileName)} style={button}>Reveal</button><button className="btn" onClick={() => document.source === "quick-generate" ? onRemoveQuickHistory(document.id) : onRemoveJobHistory(document.jobId, document.id)} style={{ ...button, color: "#f87171" }}>Remove</button></div>)}</div><button className="btn" onClick={() => action("openOutputFolder")} style={{ ...button, justifySelf: "start" }}>Open Output Folder</button></div></>;
}
const panel = { background: "#0e0e18", border: "1px solid #1a1a2e", borderRadius: "12px", padding: "18px" };
const heading = { fontFamily: "Syne, sans-serif", fontWeight: 700, marginBottom: "10px" };
const row = { display: "flex", alignItems: "center", gap: "10px", padding: "10px 0", borderTop: "1px solid #1a1a2e", flexWrap: "wrap" };
const button = { background: "#1a1a2e", color: "#94a3b8", padding: "6px 9px", borderRadius: "6px", fontSize: "11px" };
const tag = { color: "#a5b4fc", border: "1px solid #39417a", borderRadius: "999px", padding: "2px 7px", fontSize: "10px", fontWeight: 700 };
const errorBox = { background: "#2d1010", border: "1px solid #5a2020", color: "#f87171", padding: "12px", borderRadius: "8px" };
