import { STATUSES, STATUS_CONFIG } from "../constants";

export function Header({ totalJobs, statusCounts, filterStatus, onFilterStatus, onImport, onExport, onOpenSetup, onAddJob }) {
  return (
    <>
      <div style={{ background: "#0e0e18", borderBottom: "1px solid #1a1a2e", padding: "22px 32px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontFamily: "Syne, sans-serif", fontSize: "26px", fontWeight: 800, letterSpacing: "-0.02em", color: "#fff" }}>
            JOB<span style={{ color: "#6366f1" }}>TRACK</span>
          </div>
          <div style={{ fontSize: "13px", color: "#5a6070", marginTop: "3px", letterSpacing: "0.05em", fontWeight: 500 }}>APPLICATION TRACKER</div>
        </div>
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <button className="btn" onClick={onImport}
            style={{ background: "#1a1a2e", color: "#34d399", padding: "11px 18px", borderRadius: "8px", fontSize: "13px", fontWeight: 600, letterSpacing: "0.02em" }}>
            Import
          </button>
          <button className="btn" onClick={onExport}
            style={{ background: "#1a1a2e", color: "#fbbf24", padding: "11px 18px", borderRadius: "8px", fontSize: "13px", fontWeight: 600, letterSpacing: "0.02em" }}>
            Export
          </button>
          <button className="btn" onClick={onOpenSetup}
            style={{ background: "#1a1a2e", color: "#818cf8", padding: "11px 18px", borderRadius: "8px", fontSize: "13px", fontWeight: 600, letterSpacing: "0.02em" }}>
            Quick Add Setup
          </button>
          <button className="btn" onClick={onAddJob}
            style={{ background: "#6366f1", color: "#fff", padding: "11px 22px", borderRadius: "8px", fontSize: "14px", fontWeight: 600, letterSpacing: "0.02em" }}>
            + Add Job
          </button>
        </div>
      </div>

      {/* Stats bar — clicking a card toggles its status filter */}
      <div style={{ display: "flex", borderBottom: "1px solid #1a1a2e", overflowX: "auto" }}>
        {STATUSES.filter(s => statusCounts[s] > 0).map(s => {
          const isActive = filterStatus === s;
          return (
            <div key={s} className="stat-card"
              onClick={() => onFilterStatus(isActive ? "All" : s)}
              style={{ background: isActive ? STATUS_CONFIG[s].bg : "transparent" }}>
              <div style={{ fontSize: "22px", fontWeight: 700, color: STATUS_CONFIG[s].color, fontFamily: "Syne, sans-serif" }}>
                {statusCounts[s]}
              </div>
              <div style={{ fontSize: "11px", color: isActive ? STATUS_CONFIG[s].color : "#5a6070", letterSpacing: "0.08em", marginTop: "2px", fontWeight: 600 }}>
                {s.toUpperCase()}
              </div>
            </div>
          );
        })}
        <div style={{ padding: "12px 22px", marginLeft: "auto", display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <div style={{ fontSize: "22px", fontWeight: 700, color: "#e2e8f0", fontFamily: "Syne, sans-serif" }}>{totalJobs}</div>
          <div style={{ fontSize: "11px", color: "#5a6070", letterSpacing: "0.08em", marginTop: "2px", fontWeight: 600 }}>TOTAL</div>
        </div>
      </div>
    </>
  );
}
