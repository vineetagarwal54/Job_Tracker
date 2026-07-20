export function AiResumeStatus({ status, defaultProfile, onTestApi, testing, testMessage, onOpenProfiles }) {
  const profileMissing = status?.profile?.missing || [];
  const items = [
    { label: "Anthropic API", ready: status?.api?.configured, detail: status?.api?.configured ? `Configured from ${status.api.source === "safeStorage" ? "secure local storage" : "environment"}` : "Not configured" },
    { label: "Tectonic", ready: status?.tectonic?.available, detail: status?.tectonic?.available ? status.tectonic.version : "Unavailable" },
    { label: "Default profile", ready: status?.profile?.ready, detail: status?.profile?.ready ? (defaultProfile?.name || "Ready") : `Missing: ${profileMissing.join(", ") || "default profile"}` },
  ];
  return (
    <div style={{ background: "#0e0e18", border: "1px solid #1a1a2e", borderRadius: "12px", padding: "18px" }}>
      <div style={{ fontFamily: "Syne, sans-serif", fontWeight: 700, marginBottom: "14px" }}>Readiness</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: "10px" }}>
        {items.map(item => <div key={item.label} style={{ background: "#12121c", borderRadius: "8px", padding: "12px", border: `1px solid ${item.ready ? "#21492f" : "#4a2222"}` }}>
          <div style={{ color: item.ready ? "#4ade80" : "#f87171", fontSize: "12px", fontWeight: 700 }}>{item.ready ? "READY" : "ACTION NEEDED"}</div>
          <div style={{ marginTop: "5px", fontWeight: 600 }}>{item.label}</div>
          <div style={{ color: "#7a8494", fontSize: "12px", marginTop: "3px" }}>{item.detail}</div>
        </div>)}
      </div>
      {!status?.api?.configured && <div style={{ color: "#fbbf24", fontSize: "13px", marginTop: "14px" }}>Add ANTHROPIC_API_KEY to the root .env file and restart JobTrack.</div>}
      <div style={{ display: "flex", gap: "10px", marginTop: "14px", flexWrap: "wrap" }}>
        <button className="btn" disabled={!status?.api?.configured || testing} onClick={onTestApi} style={{ background: "#1a1f3a", color: "#a5b4fc", padding: "8px 14px", borderRadius: "7px" }}>{testing ? "Testing..." : "Test API Connection"}</button>
        {!status?.profile?.ready && <button className="btn" onClick={onOpenProfiles} style={{ background: "#1a1a2e", color: "#94a3b8", padding: "8px 14px", borderRadius: "7px" }}>Open Application Profiles</button>}
        {testMessage && <span style={{ color: testMessage.ok ? "#4ade80" : "#f87171", fontSize: "13px", alignSelf: "center" }}>{testMessage.text}</span>}
      </div>
    </div>
  );
}
