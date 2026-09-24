import { useState, useEffect } from "react";
import { FormField } from "./InfoBlock";

const STATE_LABELS = {
  not_configured: { text: "Not configured", color: "#5a6070" },
  disabled: { text: "Connected · sync disabled", color: "#94a3b8" },
  idle: { text: "Connected", color: "#60a5fa" },
  pending: { text: "Pending · changes waiting to sync", color: "#fbbf24" },
  syncing: { text: "Syncing...", color: "#818cf8" },
  synced: { text: "Synced", color: "#4ade80" },
  error: { text: "Error", color: "#f87171" },
};

const btnStyle = (color) => ({
  background: "#1a1a2e", color, padding: "9px 14px", borderRadius: "8px", fontSize: "13px", fontWeight: 600,
});

const UNAVAILABLE = "Sync service isn't available in this window. Fully quit and restart the JobTrack desktop app.";

// window.githubSync is exposed by the Electron preload; without it (browser
// mode, or an app process started before the preload changed) show a notice.
export default function GitHubSyncSection() {
  const [status, setStatus] = useState(null);
  const [owner, setOwner] = useState("");
  const [repo, setRepo] = useState("");
  const [branch, setBranch] = useState("main");
  const [enabled, setEnabled] = useState(false);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  const api = window.githubSync;

  useEffect(() => {
    if (!api) return;
    api.getStatus().then(res => {
      if (!res.ok) return;
      const s = res.result;
      setStatus(s);
      setOwner(s.owner);
      setRepo(s.repo);
      setBranch(s.branch || "main");
      setEnabled(s.enabled);
    }).catch(() => setMessage({ text: UNAVAILABLE, color: "#f87171" }));
    return api.onStatus(setStatus);
  }, []);

  const run = async (fn, successText) => {
    setBusy(true);
    setMessage(null);
    let res;
    try { res = await fn(); } catch { res = { ok: false, error: UNAVAILABLE }; }
    setBusy(false);
    if (!res.ok) { setMessage({ text: res.error, color: "#f87171" }); return; }
    if (res.result && typeof res.result === "object") setStatus(res.result);
    const text = typeof res.result === "string" ? res.result : successText;
    if (text) setMessage({ text, color: "#4ade80" });
  };

  const save = () => run(async () => {
    const res = await api.saveConfig({ owner, repo, branch, enabled, token });
    if (res.ok) setToken("");
    return res;
  }, "Settings saved.");

  const disconnect = () => run(() => api.removeToken(), "Token removed.");

  const label = status ? STATE_LABELS[status.state] || STATE_LABELS.idle : null;

  const boxStyle = { background: "#111119", border: "1px solid #1a1a2e", borderRadius: "10px", padding: "16px 20px", marginTop: "20px" };
  const heading = (
    <div style={{ fontSize: "12px", color: "#5a6070", letterSpacing: "0.08em", fontWeight: 700, marginBottom: "8px" }}>
      CHATGPT JOB SYNC
    </div>
  );

  if (!api) {
    return (
      <div style={boxStyle}>
        {heading}
        <div style={{ fontSize: "12px", color: "#f87171", lineHeight: "1.6" }}>{UNAVAILABLE}</div>
      </div>
    );
  }

  return (
    <div style={boxStyle}>
      {heading}
      <div style={{ fontSize: "12px", color: "#7a8494", lineHeight: "1.6", marginBottom: "14px" }}>
        Mirrors a sanitized <span style={{ color: "#e2e8f0" }}>applications.json</span> to a private GitHub repo so
        job searches can skip roles you've already applied to. Only company, role, link, status, applied date,
        location, resume variant, and source are synced — never JDs, notes, resumes, salary, recruiter, or personal data.
      </div>

      {label && (
        <div style={{ fontSize: "13px", fontWeight: 600, color: label.color, marginBottom: "4px" }}>
          {label.text}{status.state === "error" && status.lastError ? `: ${status.lastError}` : ""}
        </div>
      )}
      {status && status.state === "error" && (
        <div style={{ fontSize: "12px", color: "#7a8494", marginBottom: "4px" }}>Changes not yet synced. Use Sync Now to retry.</div>
      )}
      {status && status.state === "not_configured" && status.lastError && (
        <div style={{ fontSize: "12px", color: "#f87171", marginBottom: "4px" }}>{status.lastError}</div>
      )}
      {status && status.lastSuccessAt && (
        <div style={{ fontSize: "12px", color: "#5a6070", marginBottom: "4px" }}>
          Last successful sync: {new Date(status.lastSuccessAt).toLocaleString()}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginTop: "12px" }}>
        <FormField label="GITHUB OWNER" col="1/2">
          <input className="form-input" value={owner} onChange={e => setOwner(e.target.value)} placeholder="your-username" />
        </FormField>
        <FormField label="PRIVATE REPOSITORY" col="2/3">
          <input className="form-input" value={repo} onChange={e => setRepo(e.target.value)} placeholder="job-index" />
        </FormField>
        <FormField label="BRANCH" col="1/2">
          <input className="form-input" value={branch} onChange={e => setBranch(e.target.value)} placeholder="main" />
        </FormField>
        <FormField label="SYNC" col="2/3">
          <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "14px", color: "#e2e8f0", padding: "10px 0", cursor: "pointer" }}>
            <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
            Enable sync
          </label>
        </FormField>
        <FormField label="FINE-GRAINED TOKEN">
          <input className="form-input" type="password" autoComplete="off" spellCheck={false} value={token}
            onChange={e => setToken(e.target.value)}
            placeholder={status && status.tokenConfigured ? "Token configured · paste a new one to replace" : "github_pat_..."} />
        </FormField>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "14px" }}>
        <button className="btn" disabled={busy} onClick={save} style={{ ...btnStyle("#fff"), background: "#6366f1" }}>Save / Connect</button>
        <button className="btn" disabled={busy} onClick={() => run(() => api.testConnection())} style={btnStyle("#818cf8")}>Test Connection</button>
        <button className="btn" disabled={busy} onClick={() => run(() => api.syncNow())} style={btnStyle("#34d399")}>Sync Now</button>
        {status && status.tokenConfigured && (
          <button className="btn" disabled={busy} onClick={disconnect} style={{ ...btnStyle("#f87171"), background: "#2d1010" }}>Remove Token</button>
        )}
      </div>

      {message && (
        <div style={{ fontSize: "12px", color: message.color, marginTop: "10px" }}>{message.text}</div>
      )}
    </div>
  );
}
