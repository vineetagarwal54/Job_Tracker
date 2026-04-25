import { RESUME_VERSIONS, PRIORITIES, PRIORITY_CONFIG } from "../constants";

export function Filters({
  search, setSearch,
  filterPriority, setFilterPriority,
  filterResume, setFilterResume,
  sortBy, setSortBy,
  hasActiveFilters, clearFilters,
  filteredCount, totalCount,
  selectMode, onToggleSelectMode,
}) {
  return (
    <div style={{ padding: "12px 32px", borderBottom: "1px solid #1a1a2e", display: "flex", gap: "10px", alignItems: "center" }}>
      <input className="filter-select" placeholder="Search..."
        value={search} onChange={e => setSearch(e.target.value)}
        style={{ flex: 1, minWidth: "120px" }} />

      <select className="filter-select" value={filterPriority} onChange={e => setFilterPriority(e.target.value)}
        style={{ width: "120px", color: filterPriority !== "All" ? PRIORITY_CONFIG[filterPriority]?.color : undefined }}>
        <option value="All">All Priority</option>
        {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
      </select>

      <select className="filter-select" value={filterResume} onChange={e => setFilterResume(e.target.value)}
        style={{ width: "160px" }}>
        <option value="All">All Resumes</option>
        {RESUME_VERSIONS.map(r => <option key={r} value={r}>{r}</option>)}
      </select>

      <select className="filter-select" value={sortBy} onChange={e => setSortBy(e.target.value)}
        style={{ width: "155px" }}>
        <option value="custom">Custom Order</option>
        <option value="date">Sort by Applied</option>
        <option value="deadline">Sort by Deadline</option>
        <option value="company">Sort by Company</option>
        <option value="status">Sort by Status</option>
        <option value="priority">Sort by Priority</option>
      </select>

      {hasActiveFilters && (
        <button className="btn" onClick={clearFilters}
          style={{ background: "#1c1c2e", color: "#a5b4fc", padding: "8px 14px", borderRadius: "8px", fontSize: "13px", fontWeight: 600, whiteSpace: "nowrap" }}>
          Clear
        </button>
      )}

      {onToggleSelectMode && (
        <button className="btn" onClick={onToggleSelectMode}
          style={{
            background: selectMode ? "#1a1f3a" : "#1c1c2e",
            color: selectMode ? "#a5b4fc" : "#94a3b8",
            border: "1px solid " + (selectMode ? "#3b4486" : "transparent"),
            padding: "8px 14px", borderRadius: "8px", fontSize: "13px", fontWeight: 600, whiteSpace: "nowrap",
          }}>
          {selectMode ? "Selecting" : "Select"}
        </button>
      )}

      <span style={{ fontSize: "13px", color: "#3d4350", fontWeight: 500, whiteSpace: "nowrap" }}>
        {filteredCount} of {totalCount}
      </span>
    </div>
  );
}
