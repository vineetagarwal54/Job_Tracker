import { getBookmarkletCode } from "../utils/bookmarklet";

const SUPPORTED_PLATFORMS = ["Handshake", "Jobright", "LinkedIn", "Indeed", "Company Career Pages"];

export function QuickAddSetup({ onClose }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
      <div style={{ background: "#0e0e18", border: "1px solid #222233", borderRadius: "14px", width: "560px", maxWidth: "96vw", maxHeight: "92vh", overflow: "auto", padding: "28px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "22px" }}>
          <div style={{ fontFamily: "Syne, sans-serif", fontSize: "20px", fontWeight: 700, color: "#f1f5f9" }}>
            Quick Add Setup
          </div>
          <button className="btn" onClick={onClose}
            style={{ background: "transparent", color: "#5a6070", fontSize: "20px", lineHeight: 1, padding: "4px 8px" }}>
            x
          </button>
        </div>

        <div style={{ fontSize: "14px", color: "#94a3b8", lineHeight: "1.7", marginBottom: "24px" }}>
          Save a bookmarklet to your browser's bookmarks bar. When you're on a job posting page, click it to auto-extract the details and open JobTrack with the form pre-filled.
        </div>

        <Step n={1} title="SHOW YOUR BOOKMARKS BAR">
          Press <Kbd>Ctrl+Shift+B</Kbd> (Windows/Linux) or <Kbd>Cmd+Shift+B</Kbd> (Mac) in Chrome/Edge to toggle the bookmarks bar.
        </Step>

        <div style={{ marginBottom: "20px" }}>
          <StepHeader n={2} title="DRAG THIS TO YOUR BOOKMARKS BAR" />
          <div style={{ display: "flex", justifyContent: "center", padding: "16px" }}>
            <a
              href={getBookmarkletCode()}
              onClick={e => e.preventDefault()}
              draggable="true"
              style={{
                display: "inline-block", padding: "14px 28px", background: "linear-gradient(135deg, #6366f1, #818cf8)",
                color: "#fff", borderRadius: "10px", fontSize: "15px", fontWeight: 700, fontFamily: "Syne, sans-serif",
                textDecoration: "none", cursor: "grab", userSelect: "none",
                boxShadow: "0 4px 20px rgba(99,102,241,0.3)", letterSpacing: "0.02em",
              }}>
              + Save to JobTrack
            </a>
          </div>
          <div style={{ textAlign: "center", fontSize: "12px", color: "#5a6070", marginTop: "4px" }}>
            Drag the button above into your bookmarks bar
          </div>
        </div>

        <Step n={3} title="USE IT">
          1. Go to any job posting page<br />
          2. Click <Kbd>"+ Save to JobTrack"</Kbd> in your bookmarks bar<br />
          3. JobTrack opens with the form pre-filled<br />
          4. Review the details and hit <Kbd>Add Application</Kbd>
        </Step>

        <div style={{ background: "#111119", border: "1px solid #1a1a2e", borderRadius: "10px", padding: "16px 20px" }}>
          <div style={{ fontSize: "12px", color: "#5a6070", letterSpacing: "0.08em", fontWeight: 700, marginBottom: "10px" }}>
            SUPPORTED PLATFORMS
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
            {SUPPORTED_PLATFORMS.map(p => (
              <span key={p} style={{ padding: "5px 12px", background: "#1a1a2e", borderRadius: "6px", fontSize: "12px", color: "#94a3b8", fontWeight: 600 }}>
                {p}
              </span>
            ))}
          </div>
          <div style={{ fontSize: "12px", color: "#5a6070", marginTop: "10px", lineHeight: "1.6" }}>
            Extracts: company, role, location, source, job link. Job description is copied to your clipboard for pasting into the JD tab.
          </div>
        </div>

        <button className="btn" onClick={onClose}
          style={{ width: "100%", marginTop: "20px", background: "#1c1c2e", color: "#94a3b8", padding: "12px", borderRadius: "8px", fontSize: "14px", fontWeight: 600 }}>
          Done
        </button>
      </div>
    </div>
  );
}

function StepHeader({ n, title }) {
  return (
    <div style={{ fontSize: "12px", color: "#6366f1", letterSpacing: "0.08em", fontWeight: 700, marginBottom: "8px" }}>
      STEP {n} — {title}
    </div>
  );
}

function Step({ n, title, children }) {
  return (
    <div style={{ marginBottom: "20px" }}>
      <StepHeader n={n} title={title} />
      <div style={{ fontSize: "13px", color: "#7a8494", lineHeight: "1.8" }}>{children}</div>
    </div>
  );
}

function Kbd({ children }) {
  return <span style={{ color: "#e2e8f0", fontWeight: 600 }}>{children}</span>;
}
