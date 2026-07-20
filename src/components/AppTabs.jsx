// Top-level mode switcher between Jobs and Application Profiles. Sits above
// the per-view header so each view can keep its own brand/actions row.
export function AppTabs({ activeView, onChange }) {
  const tabs = [
    { id: "jobs", label: "Jobs" },
    { id: "profiles", label: "Application Profiles" },
    { id: "ai-resume", label: "AI Resume" },
  ];

  return (
    <div style={{
      display: "flex", alignItems: "center",
      background: "#08080d",
      borderBottom: "1px solid #1a1a2e",
      padding: "0 32px",
    }}>
      {tabs.map(t => {
        const isActive = activeView === t.id;
        return (
          <button key={t.id} className="btn"
            onClick={() => onChange(t.id)}
            style={{
              background: "transparent",
              color: isActive ? "#a5b4fc" : "#5a6070",
              padding: "12px 16px",
              fontSize: "12px", fontWeight: 700, letterSpacing: "0.08em",
              textTransform: "uppercase",
              borderBottom: "2px solid " + (isActive ? "#6366f1" : "transparent"),
              borderRadius: 0,
              marginBottom: "-1px",
            }}>
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
