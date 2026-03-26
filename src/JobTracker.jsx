import { useState, useEffect } from "react";
import {
  RESUME_VERSIONS, WORK_TYPES, SOURCES, PRIORITIES,
  STATUS_CONFIG, PRIORITY_CONFIG, STATUSES, getEmptyForm, sampleJobs,
} from "./constants";
import { globalStyles } from "./styles";
import { isDeadlineSoon, isDeadlinePast } from "./utils";
import { InfoBlock, FormField } from "./InfoBlock";

export default function JobTracker() {
  const [jobs, setJobs] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(getEmptyForm);
  const [editId, setEditId] = useState(null);
  const [filterStatus, setFilterStatus] = useState("All");
  const [filterResume, setFilterResume] = useState("All");
  const [filterPriority, setFilterPriority] = useState("All");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState("custom");
  const [expandedId, setExpandedId] = useState(null);
  const [activeTab, setActiveTab] = useState("details");
  const [dragId, setDragId] = useState(null);
  const [copiedId, setCopiedId] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const result = await window.storage.get("jobs_v2");
        const data = result ? JSON.parse(result.value) : sampleJobs;
        setJobs(data);
      } catch {
        setJobs(sampleJobs);
      }
      setLoading(false);
    })();
  }, []);

  const save = async (updated) => {
    setJobs(updated);
    try { await window.storage.set("jobs_v2", JSON.stringify(updated)); } catch {}
  };

  const handleSubmit = () => {
    if (!form.company || !form.role) return;
    if (editId !== null) {
      save(jobs.map(j => j.id === editId ? { ...form, id: editId } : j));
      setEditId(null);
    } else {
      save([...jobs, { ...form, id: Date.now() }]);
    }
    setForm(getEmptyForm());
    setShowForm(false);
  };

  const deleteJob = (id) => save(jobs.filter(j => j.id !== id));

  const startEdit = (job) => {
    setForm({ ...getEmptyForm(), ...job });
    setEditId(job.id);
    setShowForm(true);
    setExpandedId(null);
    setActiveTab("details");
  };

  const openExpanded = (id) => {
    setExpandedId(expandedId === id ? null : id);
    setActiveTab("details");
  };

  const hasActiveFilters = filterStatus !== "All" || filterPriority !== "All" || filterResume !== "All" || search;

  const clearFilters = () => {
    setFilterStatus("All");
    setFilterPriority("All");
    setFilterResume("All");
    setSearch("");
  };

  const canDrag = sortBy === "custom" && !hasActiveFilters;

  const handleDragStart = (e, id) => {
    setDragId(id);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDrop = (e, targetId) => {
    e.preventDefault();
    if (dragId === null || dragId === targetId) { setDragId(null); return; }
    const fromIdx = jobs.findIndex(j => j.id === dragId);
    const toIdx = jobs.findIndex(j => j.id === targetId);
    if (fromIdx === -1 || toIdx === -1) { setDragId(null); return; }
    const updated = [...jobs];
    const [moved] = updated.splice(fromIdx, 1);
    updated.splice(toIdx, 0, moved);
    save(updated);
    setDragId(null);
  };

  const filtered = jobs
    .filter(j => filterStatus === "All" || j.status === filterStatus)
    .filter(j => filterResume === "All" || j.resume === filterResume)
    .filter(j => filterPriority === "All" || j.priority === filterPriority)
    .filter(j => !search ||
      j.company.toLowerCase().includes(search.toLowerCase()) ||
      j.role.toLowerCase().includes(search.toLowerCase()) ||
      (j.location || "").toLowerCase().includes(search.toLowerCase())
    )
    .sort((a, b) => {
      if (sortBy === "custom") return 0;
      if (sortBy === "date") return new Date(b.date) - new Date(a.date);
      if (sortBy === "deadline") {
        if (!a.deadline) return 1;
        if (!b.deadline) return -1;
        return new Date(a.deadline) - new Date(b.deadline);
      }
      if (sortBy === "company") return a.company.localeCompare(b.company);
      if (sortBy === "status") return STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status);
      if (sortBy === "priority") return PRIORITIES.indexOf(a.priority) - PRIORITIES.indexOf(b.priority);
      return 0;
    });

  const statusCounts = STATUSES.reduce((acc, s) => ({ ...acc, [s]: jobs.filter(j => j.status === s).length }), {});

  return (
    <div style={{ minHeight: "100vh", background: "#0b0b12", fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif", color: "#e2e8f0" }}>
      <style>{globalStyles}</style>

      {/* ─── Header ─── */}
      <div style={{ background: "#0e0e18", borderBottom: "1px solid #1a1a2e", padding: "22px 32px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontFamily: "Syne, sans-serif", fontSize: "26px", fontWeight: 800, letterSpacing: "-0.02em", color: "#fff" }}>
            JOB<span style={{ color: "#6366f1" }}>TRACK</span>
          </div>
          <div style={{ fontSize: "13px", color: "#5a6070", marginTop: "3px", letterSpacing: "0.05em", fontWeight: 500 }}>VINEET · SUMMER 2026</div>
        </div>
        <button className="btn" onClick={() => { setShowForm(true); setEditId(null); setForm(getEmptyForm()); setActiveTab("details"); }}
          style={{ background: "#6366f1", color: "#fff", padding: "11px 22px", borderRadius: "8px", fontSize: "14px", fontWeight: 600, letterSpacing: "0.02em" }}>
          + Add Job
        </button>
      </div>

      {/* ─── Stats bar (clickable = filter by status) ─── */}
      <div style={{ display: "flex", borderBottom: "1px solid #1a1a2e", overflowX: "auto" }}>
        {STATUSES.filter(s => statusCounts[s] > 0).map(s => {
          const isActive = filterStatus === s;
          return (
            <div key={s} className="stat-card"
              onClick={() => setFilterStatus(isActive ? "All" : s)}
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
          <div style={{ fontSize: "22px", fontWeight: 700, color: "#e2e8f0", fontFamily: "Syne, sans-serif" }}>{jobs.length}</div>
          <div style={{ fontSize: "11px", color: "#5a6070", letterSpacing: "0.08em", marginTop: "2px", fontWeight: 600 }}>TOTAL</div>
        </div>
      </div>

      {/* ─── Compact filter bar ─── */}
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

        <span style={{ fontSize: "13px", color: "#3d4350", fontWeight: 500, whiteSpace: "nowrap" }}>
          {filtered.length} of {jobs.length}
        </span>
      </div>

      {/* ─── Job list ─── */}
      <div style={{ padding: "8px 32px 48px" }}>
        {loading ? (
          <div style={{ textAlign: "center", padding: "80px", color: "#5a6070", fontSize: "15px" }}>Loading...</div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: "center", padding: "80px", color: "#5a6070", fontSize: "15px" }}>
            {hasActiveFilters ? "No jobs match your filters." : "No jobs yet. Add your first application!"}
          </div>
        ) : filtered.map(job => {
          const sc = STATUS_CONFIG[job.status] || STATUS_CONFIG["Applied"];
          const pc = PRIORITY_CONFIG[job.priority] || PRIORITY_CONFIG["Medium"];
          const isExpanded = expandedId === job.id;
          const deadlineSoon = isDeadlineSoon(job.deadline);
          const deadlinePast = isDeadlinePast(job.deadline);

          return (
            <div key={job.id}
              draggable={canDrag}
              onDragStart={e => canDrag && handleDragStart(e, job.id)}
              onDragOver={canDrag ? handleDragOver : undefined}
              onDrop={e => canDrag && handleDrop(e, job.id)}
              onDragEnd={() => setDragId(null)}
              style={{ marginTop: "2px", opacity: dragId === job.id ? 0.4 : 1, transition: "opacity 0.15s" }}>
              <div className="job-row" onClick={() => openExpanded(job.id)}
                style={{ display: "flex", alignItems: "center", gap: "14px", padding: "16px 12px", borderBottom: "1px solid #151520" }}>

                {/* Drag handle (only in custom order mode) */}
                {canDrag && (
                  <div style={{ flexShrink: 0, cursor: "grab", color: "#3d4350", fontSize: "16px", lineHeight: 1, userSelect: "none", padding: "0 2px" }}
                    title="Drag to reorder">⠿</div>
                )}

                {/* Priority + Status dots stacked */}
                <div style={{ display: "flex", flexDirection: "column", gap: "4px", flexShrink: 0 }}>
                  <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: pc.color }} title={`${job.priority} priority`} />
                  <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: sc.dot }} title={job.status} />
                </div>

                {/* Company + Role + Location */}
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

                {/* Tags */}
                {job.workType && (
                  <span className="tag" style={{ background: "#15151f", color: "#6b7280", fontSize: "11px" }}>{job.workType}</span>
                )}
                <span className="tag" style={{ background: "#1a1a2e", color: "#818cf8", fontSize: "11px" }}>{job.resume}</span>
                <span className="tag" style={{ background: sc.bg, color: sc.color, fontSize: "11px" }}>{job.status}</span>

                {/* Date / Deadline */}
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

                {/* Actions */}
                <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
                  <button className="btn action-btn" onClick={e => { e.stopPropagation(); startEdit(job); }}
                    style={{ background: "#1a1a2e", color: "#818cf8", padding: "6px 12px", borderRadius: "6px", fontSize: "12px", fontWeight: 600 }}>
                    Edit
                  </button>
                  <button className="btn action-btn" onClick={e => { e.stopPropagation(); deleteJob(job.id); }}
                    style={{ background: "#2d1010", color: "#f87171", padding: "6px 12px", borderRadius: "6px", fontSize: "12px", fontWeight: 600 }}>
                    Del
                  </button>
                </div>
              </div>

              {/* ─── Expanded panel ─── */}
              {isExpanded && (
                <div style={{ background: "#0e0e18", borderBottom: "1px solid #151520", borderLeft: "3px solid " + sc.dot, borderRadius: "0 0 8px 8px" }}>
                  <div style={{ display: "flex", borderBottom: "1px solid #1a1a2e", paddingLeft: "22px" }}>
                    <button className={`tab-btn ${activeTab === "details" ? "active" : ""}`} onClick={() => setActiveTab("details")}>Details</button>
                    <button className={`tab-btn ${activeTab === "jd" ? "active" : ""}`} onClick={() => setActiveTab("jd")}>
                      Job Description {job.jd ? "" : "(empty)"}
                    </button>
                    <button className={`tab-btn ${activeTab === "status" ? "active" : ""}`} onClick={() => setActiveTab("status")}>Status</button>
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
                            <button className="btn" onClick={() => {
                              navigator.clipboard.writeText(job.jd);
                              setCopiedId(job.id);
                              setTimeout(() => setCopiedId(null), 2000);
                            }}
                              style={{ background: copiedId === job.id ? "#0f2e1a" : "#1a1a2e", color: copiedId === job.id ? "#4ade80" : "#818cf8", padding: "6px 14px", borderRadius: "6px", fontSize: "12px", fontWeight: 600 }}>
                              {copiedId === job.id ? "Copied!" : "Copy JD"}
                            </button>
                          </div>
                          <div className="jd-box">{job.jd}</div>
                        </div>
                      ) : (
                        <div style={{ fontSize: "14px", color: "#5a6070" }}>No job description saved. Click Edit to paste it in.</div>
                      )
                    )}

                    {activeTab === "status" && (
                      <div>
                        <div style={{ fontSize: "12px", color: "#5a6070", letterSpacing: "0.06em", marginBottom: "12px", fontWeight: 600 }}>CHANGE STATUS</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                          {STATUSES.map(s => (
                            <button key={s} className="btn" onClick={() => save(jobs.map(j => j.id === job.id ? { ...j, status: s } : j))}
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
                            <button key={p} className="btn" onClick={() => save(jobs.map(j => j.id === job.id ? { ...j, priority: p } : j))}
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
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ─── Add/Edit Modal ─── */}
      {showForm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
          <div style={{ background: "#0e0e18", border: "1px solid #222233", borderRadius: "14px", width: "580px", maxWidth: "96vw", maxHeight: "92vh", display: "flex", flexDirection: "column" }}>
            {/* Modal header */}
            <div style={{ padding: "22px 28px 0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ fontFamily: "Syne, sans-serif", fontSize: "18px", fontWeight: 700, color: "#f1f5f9" }}>
                {editId ? "Edit Application" : "New Application"}
              </div>
              <div style={{ display: "flex" }}>
                {["details", "jd"].map(t => (
                  <button key={t} className={`tab-btn ${activeTab === t ? "active" : ""}`} onClick={() => setActiveTab(t)}>
                    {t === "details" ? "Details" : "Job Description"}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ overflowY: "auto", padding: "18px 28px 28px", flex: 1 }}>
              {activeTab === "details" && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" }}>
                  <FormField label="COMPANY *">
                    <input className="form-input" value={form.company} onChange={e => setForm({ ...form, company: e.target.value })} placeholder="e.g. Google" />
                  </FormField>
                  <FormField label="ROLE *">
                    <input className="form-input" value={form.role} onChange={e => setForm({ ...form, role: e.target.value })} placeholder="e.g. SWE Intern" />
                  </FormField>

                  <FormField label="STATUS" col="1/2">
                    <select className="form-select" value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
                      {STATUSES.map(s => <option key={s}>{s}</option>)}
                    </select>
                  </FormField>
                  <FormField label="PRIORITY" col="2/3">
                    <select className="form-select" value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })}>
                      {PRIORITIES.map(p => <option key={p}>{p}</option>)}
                    </select>
                  </FormField>

                  <FormField label="DATE APPLIED" col="1/2">
                    <input type="date" className="form-input" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} />
                  </FormField>
                  <FormField label="DEADLINE" col="2/3">
                    <input type="date" className="form-input" value={form.deadline} onChange={e => setForm({ ...form, deadline: e.target.value })} />
                  </FormField>

                  <FormField label="LOCATION" col="1/2">
                    <input className="form-input" value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} placeholder="e.g. New York, NY" />
                  </FormField>
                  <FormField label="WORK TYPE" col="2/3">
                    <select className="form-select" value={form.workType} onChange={e => setForm({ ...form, workType: e.target.value })}>
                      {WORK_TYPES.map(w => <option key={w}>{w}</option>)}
                    </select>
                  </FormField>

                  <FormField label="SALARY / COMP">
                    <input className="form-input" value={form.salary} onChange={e => setForm({ ...form, salary: e.target.value })} placeholder="e.g. $40/hr or $120k–$150k" />
                  </FormField>

                  <FormField label="RESUME VERSION" col="1/2">
                    <select className="form-select" value={form.resume} onChange={e => setForm({ ...form, resume: e.target.value })}>
                      {RESUME_VERSIONS.map(r => <option key={r}>{r}</option>)}
                    </select>
                  </FormField>
                  <FormField label="SOURCE" col="2/3">
                    <select className="form-select" value={form.source} onChange={e => setForm({ ...form, source: e.target.value })}>
                      {SOURCES.map(s => <option key={s}>{s}</option>)}
                    </select>
                  </FormField>

                  <FormField label="RECRUITER NAME" col="1/2">
                    <input className="form-input" value={form.recruiter} onChange={e => setForm({ ...form, recruiter: e.target.value })} placeholder="e.g. Jane Smith" />
                  </FormField>
                  <FormField label="RECRUITER EMAIL" col="2/3">
                    <input className="form-input" value={form.recruiterEmail} onChange={e => setForm({ ...form, recruiterEmail: e.target.value })} placeholder="jane@company.com" />
                  </FormField>

                  <FormField label="JOB POSTING URL">
                    <input className="form-input" value={form.link} onChange={e => setForm({ ...form, link: e.target.value })} placeholder="https://..." />
                  </FormField>

                  <FormField label="NOTES">
                    <textarea className="form-input" style={{ minHeight: "80px", resize: "vertical" }} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Interview notes, contacts, next steps..." />
                  </FormField>
                </div>
              )}

              {activeTab === "jd" && (
                <div>
                  <div style={{ fontSize: "13px", color: "#5a6070", marginBottom: "10px", lineHeight: "1.6" }}>
                    Paste the full job description here. Useful for tailoring your resume and prepping for interviews.
                  </div>
                  <textarea className="form-input" style={{ minHeight: "360px", resize: "vertical", lineHeight: "1.8" }}
                    value={form.jd} onChange={e => setForm({ ...form, jd: e.target.value })}
                    placeholder="Paste the full job description here..." />
                </div>
              )}
            </div>

            {/* Modal footer */}
            <div style={{ padding: "0 28px 22px", display: "flex", gap: "10px" }}>
              <button className="btn" onClick={handleSubmit}
                style={{ flex: 1, background: "#6366f1", color: "#fff", padding: "12px", borderRadius: "8px", fontSize: "14px", fontWeight: 600 }}>
                {editId ? "Save Changes" : "Add Application"}
              </button>
              <button className="btn" onClick={() => { setShowForm(false); setEditId(null); setForm(getEmptyForm()); }}
                style={{ background: "#1c1c2e", color: "#94a3b8", padding: "12px 20px", borderRadius: "8px", fontSize: "14px", fontWeight: 600 }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
