import { useState } from "react";

// Keep in sync with bank/tags.yaml's header comment and electron/tailorRunner.cjs's
// ALLOWED_TAGS in the resume-tailor repo.
const TAGS = ["frontend", "backend", "ai", "infra", "realtime", "data", "client-facing", "leadership", "mobile", "perf", "security"];

const toggleBtn = (active) => ({
  padding: "4px 10px", borderRadius: "6px", fontSize: "11px", fontWeight: 600,
  background: active ? "#1a1a2e" : "transparent",
  color: active ? "#a5b4fc" : "#5a6070",
  border: "1px solid " + (active ? "#a5b4fc" : "#222233"),
});

// Lists a job's run's new-wording bullets (doc.newWording, from tailorRunner.cjs's
// parsed report) so the user can pick which to promote into bank/bank_extra.md,
// with tags chosen per bullet. Posts through window.tailor.saveToBank, which
// re-validates every selection against the job's own recorded bullets server-side.
export function SaveToBankModal({ job, doc, onClose }) {
  const items = doc?.newWording || [];
  const [state, setState] = useState(() => items.map(() => ({ checked: true, tags: [] })));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const toggleChecked = (i) => setState((s) => s.map((it, idx) => (idx === i ? { ...it, checked: !it.checked } : it)));
  const toggleTag = (i, tag) => setState((s) => s.map((it, idx) => {
    if (idx !== i) return it;
    const has = it.tags.includes(tag);
    return { ...it, tags: has ? it.tags.filter((t) => t !== tag) : [...it.tags, tag] };
  }));

  const toSave = state
    .map((it, i) => ({ ...it, item: items[i] }))
    .filter((it) => it.checked);

  const save = async () => {
    setError("");
    if (toSave.length === 0) { setError("Check at least one bullet to save."); return; }
    if (toSave.some((it) => it.tags.length === 0)) { setError("Tag every checked bullet before saving."); return; }
    const api = window.tailor;
    if (!api) { setError("Resume generation needs the JobTrack desktop app. Restart it fully."); return; }
    setSaving(true);
    try {
      const selections = toSave.map((it) => ({ section: it.item.section, heading: it.item.heading, text: it.item.text, tags: it.tags }));
      const res = await api.saveToBank(job.id, selections);
      if (!res.ok) { setError(res.error); return; }
      onClose();
    } catch {
      setError("Save to bank isn't available. Restart JobTrack.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
      <div style={{ background: "#0e0e18", border: "1px solid #222233", borderRadius: "14px", width: "560px", maxWidth: "94vw", maxHeight: "80vh", overflowY: "auto", padding: "24px 26px" }}>
        <div style={{ fontFamily: "Syne, sans-serif", fontSize: "18px", fontWeight: 700, color: "#f1f5f9", marginBottom: "6px" }}>
          Save to bank
        </div>
        <div style={{ fontSize: "13px", color: "#94a3b8", lineHeight: 1.6, marginBottom: "18px" }}>
          New wording from this run. Checked bullets are appended to bank/bank_extra.md under their heading, tagged as chosen below, then the bank is rebuilt.
        </div>

        {items.length === 0 ? (
          <div style={{ fontSize: "13px", color: "#5a6070" }}>No new wording recorded for this run.</div>
        ) : (
          items.map((it, i) => (
            <div key={i} style={{ marginBottom: "16px", paddingBottom: "14px", borderBottom: i < items.length - 1 ? "1px solid #1a1a2e" : "none" }}>
              <label style={{ display: "flex", alignItems: "flex-start", gap: "8px", cursor: "pointer" }}>
                <input type="checkbox" checked={state[i].checked} onChange={() => toggleChecked(i)}
                  style={{ width: "14px", height: "14px", marginTop: "3px", cursor: "pointer", accentColor: "#6366f1" }} />
                <span>
                  <span style={{ fontSize: "11px", color: "#5a6070", letterSpacing: "0.04em", display: "block", marginBottom: "2px" }}>
                    [{it.section}: {it.heading}]
                  </span>
                  <span style={{ fontSize: "13px", color: "#e2e8f0" }}>{it.text}</span>
                </span>
              </label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "8px", marginLeft: "22px" }}>
                {TAGS.map((tag) => (
                  <button key={tag} className="btn" disabled={!state[i].checked} onClick={() => toggleTag(i, tag)} style={toggleBtn(state[i].tags.includes(tag))}>
                    {tag}
                  </button>
                ))}
              </div>
            </div>
          ))
        )}

        {error && <div style={{ fontSize: "13px", color: "#f87171", marginBottom: "12px" }}>{error}</div>}

        <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end", marginTop: "8px" }}>
          <button className="btn" onClick={onClose}
            style={{ background: "#1c1c2e", color: "#94a3b8", padding: "10px 18px", borderRadius: "8px", fontSize: "13px", fontWeight: 600 }}>
            Cancel
          </button>
          {items.length > 0 && (
            <button className="btn" disabled={saving} onClick={save}
              style={{ background: "#6366f1", color: "#fff", padding: "10px 18px", borderRadius: "8px", fontSize: "13px", fontWeight: 600, opacity: saving ? 0.6 : 1 }}>
              {saving ? "Saving…" : "Save"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
