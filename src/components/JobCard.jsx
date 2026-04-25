import { STATUS_CONFIG, PRIORITY_CONFIG } from "../constants";
import { isDeadlineSoon, isDeadlinePast } from "../utils/deadline";

export function JobCard({ job, canDrag, isFirst, isLast, selectMode, isSelected, onToggleSelect, onToggleExpand, onEdit, onDelete, onMoveUp, onMoveDown }) {
  const sc = STATUS_CONFIG[job.status] || STATUS_CONFIG["Applied"];
  const pc = PRIORITY_CONFIG[job.priority] || PRIORITY_CONFIG["Medium"];
  const deadlineSoon = isDeadlineSoon(job.deadline);
  const deadlinePast = isDeadlinePast(job.deadline);

  const stopClick = (e, fn) => { e.stopPropagation(); fn(); };

  return (
    <div className="job-row" onClick={selectMode ? (e) => stopClick(e, onToggleSelect) : onToggleExpand}
      style={{
        display: "flex", alignItems: "center", gap: "14px", padding: "16px 12px",
        borderBottom: "1px solid #151520",
        background: selectMode && isSelected ? "#15182a" : undefined,
      }}>

      {selectMode && (
        <input type="checkbox"
          checked={!!isSelected}
          onChange={onToggleSelect}
          onClick={e => e.stopPropagation()}
          style={{ flexShrink: 0, width: "16px", height: "16px", cursor: "pointer", accentColor: "#6366f1" }} />
      )}

      {!selectMode && canDrag && (
        <div style={{ flexShrink: 0, cursor: "grab", color: "#3d4350", fontSize: "16px", lineHeight: 1, userSelect: "none", padding: "0 2px" }}
          title="Drag to reorder">⠿</div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "4px", flexShrink: 0 }}>
        <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: pc.color }} title={`${job.priority} priority`} />
        <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: sc.dot }} title={job.status} />
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: "10px" }}>
          <span style={{ fontFamily: "Syne, sans-serif", fontSize: "16px", fontWeight: 700, color: "#f1f5f9", letterSpacing: "-0.01em" }}>
            {job.company}
          </span>
          {job.salary && (
            <span style={{ fontSize: "13px", color: "#5a6070", fontWeight: 500 }}>{job.salary}</span>
          )}
        </div>
        <div style={{ fontSize: "14px", color: "#7a8494", marginTop: "3px", display: "flex", gap: "8px", alignItems: "center" }}>
          <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{job.role}</span>
          {job.location && (
            <span style={{ color: "#4a5060", flexShrink: 0 }}>· {job.location}</span>
          )}
        </div>
      </div>

      {job.workType && (
        <span className="tag" style={{ background: "#15151f", color: "#6b7280", fontSize: "11px" }}>{job.workType}</span>
      )}
      <span className="tag" style={{ background: "#1a1a2e", color: "#818cf8", fontSize: "11px" }}>{job.resume}</span>
      <span className="tag" style={{ background: sc.bg, color: sc.color, fontSize: "11px" }}>{job.status}</span>

      <div style={{ flexShrink: 0, textAlign: "right", minWidth: "90px" }}>
        {job.deadline ? (
          <div>
            {(deadlinePast || deadlineSoon) && (
              <div style={{ fontSize: "11px", fontWeight: 700, color: deadlinePast ? "#f87171" : "#fbbf24", letterSpacing: "0.05em", marginBottom: "2px" }}>
                {deadlinePast ? "EXPIRED" : "DUE SOON"}
              </div>
            )}
            <div style={{ fontSize: "13px", color: "#5a6070" }}>{job.deadline}</div>
          </div>
        ) : (
          <div style={{ fontSize: "13px", color: "#2e3340" }}>{job.date || "—"}</div>
        )}
      </div>

      <div style={{ display: "flex", gap: "6px", flexShrink: 0, alignItems: "center" }}>
        {canDrag && (
          <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
            <button className="btn action-btn" onClick={e => stopClick(e, onMoveUp)}
              disabled={isFirst}
              style={{ background: "#1a1a2e", color: isFirst ? "#2a2a3a" : "#94a3b8", padding: "2px 8px", borderRadius: "4px", fontSize: "11px", lineHeight: 1 }}
              title="Move up">▲</button>
            <button className="btn action-btn" onClick={e => stopClick(e, onMoveDown)}
              disabled={isLast}
              style={{ background: "#1a1a2e", color: isLast ? "#2a2a3a" : "#94a3b8", padding: "2px 8px", borderRadius: "4px", fontSize: "11px", lineHeight: 1 }}
              title="Move down">▼</button>
          </div>
        )}
        <button className="btn action-btn" onClick={e => stopClick(e, onEdit)}
          style={{ background: "#1a1a2e", color: "#818cf8", padding: "6px 12px", borderRadius: "6px", fontSize: "12px", fontWeight: 600 }}>
          Edit
        </button>
        <button className="btn action-btn" onClick={e => stopClick(e, onDelete)}
          style={{ background: "#2d1010", color: "#f87171", padding: "6px 12px", borderRadius: "6px", fontSize: "12px", fontWeight: 600 }}>
          Del
        </button>
      </div>
    </div>
  );
}
