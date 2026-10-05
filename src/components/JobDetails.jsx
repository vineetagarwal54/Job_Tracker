import { useState } from "react";
import { STATUSES, PRIORITIES, STATUS_CONFIG, PRIORITY_CONFIG, DOC_STATUS_CONFIG, RESUME_MASTER_KEY } from "../constants";
import { isDeadlineSoon, isDeadlinePast } from "../utils/deadline";
import { cleanJobDescription } from "../utils/jobDescriptionCleaner";
import { InfoBlock } from "./InfoBlock";
import { SaveToBankModal } from "./SaveToBankModal";

export function JobDetails({
  job,
  doc,
  canReorder,
  isFirstOverall,
  isLastOverall,
  workspaces,
  onChangeStatus,
  onChangePriority,
  onPin,
  onMoveToBottom,
  onMoveToWorkspace,
}) {
  const [activeTab, setActiveTab] = useState("details");
  const [copied, setCopied] = useState(false);

  const sc = STATUS_CONFIG[job.status] || STATUS_CONFIG["Applied"];
  const pc = PRIORITY_CONFIG[job.priority] || PRIORITY_CONFIG["Medium"];
  const deadlineSoon = isDeadlineSoon(job.deadline);
  const deadlinePast = isDeadlinePast(job.deadline);

  const copyJd = () => {
    // Re-clean on copy so manually-pasted HTML doesn't leak into the clipboard
    const text = cleanJobDescription(job.jd);
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={{ background: "#0e0e18", borderBottom: "1px solid #151520", borderLeft: "3px solid " + sc.dot, borderRadius: "0 0 8px 8px" }}>
      <div style={{ display: "flex", borderBottom: "1px solid #1a1a2e", paddingLeft: "22px" }}>
        <button className={`tab-btn ${activeTab === "details" ? "active" : ""}`} onClick={() => setActiveTab("details")}>Details</button>
        <button className={`tab-btn ${activeTab === "jd" ? "active" : ""}`} onClick={() => setActiveTab("jd")}>
          Job Description {job.jd ? "" : "(empty)"}
        </button>
        <button className={`tab-btn ${activeTab === "status" ? "active" : ""}`} onClick={() => setActiveTab("status")}>Status</button>
        <button className={`tab-btn ${activeTab === "docs" ? "active" : ""}`} onClick={() => setActiveTab("docs")}>Documents</button>
      </div>

      <div style={{ padding: "18px 26px 22px" }}>
        {activeTab === "details" && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "16px" }}>
            {job.salary && <InfoBlock label="SALARY" value={job.salary} />}
            {job.location && <InfoBlock label="LOCATION" value={`${job.location} · ${job.workType}`} />}
            {job.source && <InfoBlock label="SOURCE" value={job.source} />}
            {job.date && <InfoBlock label="APPLIED" value={job.date} />}
            {job.deadline && <InfoBlock label="DEADLINE" value={job.deadline} color={deadlinePast ? "#f87171" : deadlineSoon ? "#fbbf24" : undefined} />}
            {job.priority && <InfoBlock label="PRIORITY" value={job.priority} color={pc.color} />}
            {job.recruiter && <InfoBlock label="RECRUITER" value={job.recruiter + (job.recruiterEmail ? ` · ${job.recruiterEmail}` : "")} />}
            {job.link && (
              <div>
                <div style={{ fontSize: "11px", color: "#5a6070", letterSpacing: "0.06em", marginBottom: "5px", fontWeight: 600 }}>JOB LINK</div>
                <a href={job.link} target="_blank" rel="noreferrer" style={{ fontSize: "14px", color: "#818cf8", fontWeight: 500 }}>Open posting</a>
              </div>
            )}
            {job.notes && (
              <div style={{ gridColumn: "1/-1" }}>
                <div style={{ fontSize: "11px", color: "#5a6070", letterSpacing: "0.06em", marginBottom: "5px", fontWeight: 600 }}>NOTES</div>
                <div style={{ fontSize: "14px", color: "#b0b8c8", lineHeight: "1.7" }}>{job.notes}</div>
              </div>
            )}
          </div>
        )}

        {activeTab === "jd" && (
          job.jd ? (
            <div>
              <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "10px" }}>
                <button className="btn" onClick={copyJd}
                  style={{ background: copied ? "#0f2e1a" : "#1a1a2e", color: copied ? "#4ade80" : "#818cf8", padding: "6px 14px", borderRadius: "6px", fontSize: "12px", fontWeight: 600 }}>
                  {copied ? "Copied!" : "Copy JD"}
                </button>
              </div>
              <div className="jd-box">{job.jd}</div>
            </div>
          ) : (
            <div style={{ fontSize: "14px", color: "#5a6070" }}>No job description saved. Click Edit to paste it in.</div>
          )
        )}

        {activeTab === "docs" && <DocumentsTab job={job} doc={doc} />}

        {activeTab === "status" && (
          <div>
            <div style={{ fontSize: "12px", color: "#5a6070", letterSpacing: "0.06em", marginBottom: "12px", fontWeight: 600 }}>CHANGE STATUS</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
              {STATUSES.map(s => (
                <button key={s} className="btn" onClick={() => onChangeStatus(s)}
                  style={{
                    padding: "7px 16px", borderRadius: "6px", fontSize: "13px", fontWeight: 600,
                    background: job.status === s ? STATUS_CONFIG[s].bg : "transparent",
                    color: job.status === s ? STATUS_CONFIG[s].color : "#5a6070",
                    border: "1px solid " + (job.status === s ? STATUS_CONFIG[s].color : "#222233"),
                  }}>
                  {s}
                </button>
              ))}
            </div>
            <div style={{ fontSize: "12px", color: "#5a6070", letterSpacing: "0.06em", marginTop: "20px", marginBottom: "12px", fontWeight: 600 }}>CHANGE PRIORITY</div>
            <div style={{ display: "flex", gap: "8px" }}>
              {PRIORITIES.map(p => (
                <button key={p} className="btn" onClick={() => onChangePriority(p)}
                  style={{
                    padding: "7px 16px", borderRadius: "6px", fontSize: "13px", fontWeight: 600,
                    background: job.priority === p ? PRIORITY_CONFIG[p].bg : "transparent",
                    color: job.priority === p ? PRIORITY_CONFIG[p].color : "#5a6070",
                    border: "1px solid " + (job.priority === p ? PRIORITY_CONFIG[p].color : "#222233"),
                  }}>
                  {p}
                </button>
              ))}
            </div>

            {workspaces && workspaces.length > 1 && (
              <>
                <div style={{ fontSize: "12px", color: "#5a6070", letterSpacing: "0.06em", marginTop: "20px", marginBottom: "12px", fontWeight: 600 }}>MOVE TO WORKSPACE</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                  {workspaces.map(w => {
                    const isCurrent = job.workspaceId === w.id;
                    return (
                      <button key={w.id} className="btn"
                        onClick={() => !isCurrent && onMoveToWorkspace(w.id)}
                        disabled={isCurrent}
                        style={{
                          padding: "7px 16px", borderRadius: "6px", fontSize: "13px", fontWeight: 600,
                          background: isCurrent ? "#1a1f3a" : "transparent",
                          color: isCurrent ? "#a5b4fc" : "#94a3b8",
                          border: "1px solid " + (isCurrent ? "#3b4486" : "#222233"),
                          cursor: isCurrent ? "default" : "pointer",
                        }}>
                        {w.name}{isCurrent ? " (current)" : ""}
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            {canReorder && (
              <>
                <div style={{ fontSize: "12px", color: "#5a6070", letterSpacing: "0.06em", marginTop: "20px", marginBottom: "12px", fontWeight: 600 }}>REORDER</div>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button className="btn" onClick={onPin}
                    disabled={isFirstOverall}
                    style={{
                      padding: "7px 16px", borderRadius: "6px", fontSize: "13px", fontWeight: 600,
                      background: isFirstOverall ? "transparent" : "#0f1a2e",
                      color: isFirstOverall ? "#3d4350" : "#60a5fa",
                      border: "1px solid " + (isFirstOverall ? "#222233" : "#1e3a5f"),
                    }}>
                    ▲ Pin to Top
                  </button>
                  <button className="btn" onClick={onMoveToBottom}
                    disabled={isLastOverall}
                    style={{
                      padding: "7px 16px", borderRadius: "6px", fontSize: "13px", fontWeight: 600,
                      background: isLastOverall ? "transparent" : "#1a1a2e",
                      color: isLastOverall ? "#3d4350" : "#94a3b8",
                      border: "1px solid " + (isLastOverall ? "#222233" : "#2a2a3e"),
                    }}>
                    ▼ Move to Bottom
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const docBtn = (color, enabled = true) => ({
  background: "#1a1a2e", color: enabled ? color : "#3d4350", padding: "7px 14px", borderRadius: "6px",
  fontSize: "12px", fontWeight: 600, cursor: enabled ? "pointer" : "not-allowed",
});

// Generate / open the tailored resume and cover letter. window.tailor only
// takes job ids and doc types; the main process resolves every path.
function DocumentsTab({ job, doc }) {
  const [error, setError] = useState("");
  const [showSaveToBank, setShowSaveToBank] = useState(false);
  const api = window.tailor;
  const status = doc?.docStatus;
  const busy = status === "queued" || status === "generating";
  const hasJd = Boolean((job.jd || "").trim());
  const canGenerate = Boolean(api) && hasJd && !busy;
  const dc = status && DOC_STATUS_CONFIG[status];
  const baseKey = RESUME_MASTER_KEY[job.resume];

  const call = async (fn) => {
    setError("");
    if (!api) { setError("Resume generation needs the JobTrack desktop app. Restart it fully."); return; }
    try {
      const res = await fn();
      if (!res.ok) setError(res.error);
    } catch {
      setError("Resume generation isn't available. Restart JobTrack.");
    }
  };

  const generateLabel = (text) => (hasJd ? text : "Paste the JD first");

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px", marginBottom: "16px" }}>
        <button className="btn" disabled={!canGenerate} title={hasJd ? "" : "Paste the JD first"}
          onClick={() => call(() => api.generate([job.id], ["resume"]))}
          style={docBtn("#a5b4fc", canGenerate)}>
          {generateLabel("Generate resume")}
        </button>
        <button className="btn" disabled={!canGenerate} title={hasJd ? "" : "Paste the JD first"}
          onClick={() => call(() => api.generate([job.id], ["cover"]))}
          style={docBtn("#a5b4fc", canGenerate)}>
          {generateLabel("Generate cover letter")}
        </button>
        {busy && (
          <button className="btn" onClick={() => call(() => api.cancel(job.id))} style={docBtn("#f87171")}>Cancel</button>
        )}
        {dc && (
          <span className="tag" style={{ background: dc.bg, color: dc.color, fontSize: "11px" }}>{dc.label}</span>
        )}
        {status === "ready" && doc.durationMs != null && (
          <span style={{ fontSize: "11px", color: "#5a6070" }}>Ready in {(doc.durationMs / 1000).toFixed(1)}s ({doc.numTurns} turns)</span>
        )}
      </div>

      {status === "ready" && doc.fitLevel && (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px", marginBottom: "14px", fontSize: "12px", color: "#5a6070" }}>
          <span>Fit: {doc.fitLevel}</span>
          {doc.keywordsTotal != null && (
            <span>· Keywords: {doc.keywordsCovered}/{doc.keywordsTotal}{doc.missingKeywords?.length ? ` (missing: ${doc.missingKeywords.slice(0, 3).join(", ")})` : ""}</span>
          )}
          <span>· New wording: {doc.newWording?.length || 0}</span>
          {doc.newWording?.length > 0 && (
            <button className="btn" onClick={() => setShowSaveToBank(true)} style={docBtn("#a5b4fc")}>
              Save to bank ({doc.newWording.length})
            </button>
          )}
        </div>
      )}

      {showSaveToBank && (
        <SaveToBankModal job={job} doc={doc} onClose={() => setShowSaveToBank(false)} />
      )}

      {status === "failed" && (
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "14px", padding: "10px 14px", background: "#2d1010", borderRadius: "8px" }}>
          <span style={{ fontSize: "13px", color: "#f87171", flex: 1 }}>{doc.message || "Generation failed."}</span>
          {doc.lastRunLog && (
            <button className="btn" onClick={() => call(() => api.openFile(job.id, "log"))} style={docBtn("#f87171")}>Show log</button>
          )}
        </div>
      )}

      {doc?.resumePath && <DocRow label="RESUME" type="resume" path={doc.resumePath} job={job} call={call} />}
      {doc?.coverPath && <DocRow label="COVER LETTER" type="cover" path={doc.coverPath} job={job} call={call} />}

      {!doc?.resumePath && baseKey && (
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "10px" }}>
          <span style={{ fontSize: "13px", color: "#5a6070" }}>No tailored resume yet.</span>
          <button className="btn" onClick={() => call(() => api.openFile(job.id, "base"))} style={docBtn("#94a3b8")}>
            Open base resume ({job.resume})
          </button>
        </div>
      )}

      {error && <div style={{ fontSize: "13px", color: "#f87171", marginTop: "8px" }}>{error}</div>}
    </div>
  );
}

function DocRow({ label, type, path, job, call }) {
  const name = path.split(/[\\/]/).pop();
  return (
    <div style={{ marginBottom: "12px" }}>
      <div style={{ fontSize: "11px", color: "#5a6070", letterSpacing: "0.06em", marginBottom: "6px", fontWeight: 600 }}>{label}</div>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" }}>
        <div draggable
          onDragStart={e => {
            // Hand the drag to the OS (webContents.startDrag) and keep it from
            // triggering the job list's row reordering.
            e.preventDefault();
            e.stopPropagation();
            window.tailor.startDrag(job.id, type);
          }}
          title="Drag into an upload field or a folder"
          style={{
            display: "flex", alignItems: "center", gap: "8px", padding: "7px 12px", borderRadius: "6px",
            background: "#12121c", border: "1px solid #222233", color: "#e2e8f0", fontSize: "13px",
            cursor: "grab", userSelect: "none", maxWidth: "360px",
          }}>
          <span style={{ color: "#a5b4fc", fontWeight: 700, fontSize: "11px" }}>{name.split(".").pop().toUpperCase()}</span>
          <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{name}</span>
        </div>
        <button className="btn" onClick={() => call(() => window.tailor.openFile(job.id, type))} style={docBtn("#818cf8")}>Open</button>
        <button className="btn" onClick={() => call(() => window.tailor.showInFolder(job.id, type))} style={docBtn("#94a3b8")}>Show in folder</button>
      </div>
    </div>
  );
}
