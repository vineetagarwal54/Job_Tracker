export function ResumeGenerationPanel({ jobs, selectedJobId, onSelectJob, missing, active, progress, onGenerate, onCancel }) {
  return (
    <div style={{ background: "#0e0e18", border: "1px solid #1a1a2e", borderRadius: "12px", padding: "18px" }}>
      <div style={{ fontFamily: "Syne, sans-serif", fontWeight: 700, marginBottom: "12px" }}>Generate from a saved job</div>
      <select className="form-select" value={selectedJobId ?? ""} onChange={event => onSelectJob(event.target.value)} style={{ width: "100%" }}>
        <option value="">Select a job</option>
        {jobs.map(job => <option key={job.id} value={job.id}>{job.company} · {job.role}</option>)}
      </select>
      {missing.length > 0 && <div style={{ color: "#f87171", fontSize: "12px", marginTop: "10px" }}>Required: {missing.join(", ")}.</div>}
      {active && <div style={{ marginTop: "14px", padding: "12px", borderRadius: "8px", background: "#11142a", color: "#a5b4fc", fontSize: "13px" }}>{progress || "Starting generation"}</div>}
      <div style={{ display: "flex", gap: "10px", marginTop: "14px" }}>
        <button className="btn" disabled={missing.length > 0 || active} onClick={onGenerate} style={{ background: missing.length || active ? "#24243a" : "#6366f1", color: missing.length || active ? "#5a6070" : "#fff", padding: "10px 18px", borderRadius: "8px", fontWeight: 700 }}>Generate Resume</button>
        {active && <button className="btn" onClick={onCancel} style={{ background: "#2d1010", color: "#f87171", padding: "10px 18px", borderRadius: "8px" }}>Cancel</button>}
      </div>
    </div>
  );
}
