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
  const [dropTargetId, setDropTargetId] = useState(null);
  const [copiedId, setCopiedId] = useState(null);
  const [quickAddNotice, setQuickAddNotice] = useState("");
  const [showSetup, setShowSetup] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const result = await window.storage.get("jobs_v2");
        if (result) {
          setJobs(JSON.parse(result.value));
        } else {
          // Migrate from localStorage (old web/Electron versions) → new JSON file
          const legacy = localStorage.getItem("jobs_v2");
          if (legacy) {
            const data = JSON.parse(legacy);
            setJobs(data);
            await window.storage.set("jobs_v2", legacy);
          } else {
            setJobs(sampleJobs);
          }
        }
      } catch {
        setJobs(sampleJobs);
      }
      setLoading(false);
    })();
  }, []);

  // Helper: apply quick-add params to form
  const applyQuickAdd = (params) => {
    const prefilled = getEmptyForm();
    ["company", "role", "location", "salary", "link", "source", "workType", "deadline"].forEach(f => {
      if (params[f]) prefilled[f] = params[f];
    });
    setForm(prefilled);
    setShowForm(true);
    setEditId(null);
    setActiveTab("details");
    if (params.jdCopied === "1") {
      setQuickAddNotice("Job description copied to clipboard — switch to JD tab and paste it");
    } else {
      setQuickAddNotice("Auto-filled from job page — review and hit Add");
    }
  };

  // Quick Add: parse URL params from bookmarklet (web mode)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has("quickadd")) return;
    applyQuickAdd(Object.fromEntries(params.entries()));
    window.history.replaceState({}, "", window.location.pathname);
  }, []);

  // Quick Add: listen for deep-link from Electron (jobtrack:// protocol)
  useEffect(() => {
    if (!window.electronAPI) return;
    window.electronAPI.onQuickAdd((params) => applyQuickAdd(params));
    window.electronAPI.signalReady();
  }, []);

  const getBookmarkletCode = () => {
    // Each array entry MUST be a complete single-line JS statement.
    // .join("") produces a valid single-line bookmarklet.
    const code = [
      "javascript:void(function(){",
      "var d={},h=location.hostname,jd='',ats=/greenhouse|lever|workday|ashby|bamboo|icims|taleo|smartrecruiters|jazz|breezy|paylocity|myworkday|phenom/i;",

      // ── 1. JSON-LD structured data (most reliable when present) ──
      "try{document.querySelectorAll('script[type=\"application/ld+json\"]').forEach(function(s){try{var raw=JSON.parse(s.textContent),items=Array.isArray(raw)?raw:raw['@graph']?raw['@graph']:[raw];items.forEach(function(j){if(j['@type']==='JobPosting'){d.role=d.role||j.title||'';d.company=d.company||(j.hiringOrganization&&j.hiringOrganization.name)||'';if(j.jobLocation){var a=j.jobLocation.address||j.jobLocation;if(a.addressLocality)d.location=[a.addressLocality,a.addressRegion].filter(Boolean).join(', ')}if(j.baseSalary&&j.baseSalary.value){var bv=j.baseSalary.value;d.salary=bv.minValue?'$'+bv.minValue+(bv.maxValue?'-$'+bv.maxValue:''):'$'+(bv.value||'')}jd=jd||j.description||''}})}catch(e){}})}catch(e){}",

      // ── 2. Source detection ──
      "if(h.includes('handshake'))d.source='Handshake';else if(h.includes('linkedin'))d.source='LinkedIn';else if(h.includes('indeed'))d.source='Indeed';else if(h.includes('jobright'))d.source='Other';else d.source='Company Site';",

      // ── 3. Parse og:title / document.title (useful on both Handshake & company sites) ──
      // Typical patterns: "Role - Company | Handshake" or "Role | Company" or "Role at Company"
      "var ogT=(document.querySelector('meta[property=\"og:title\"]')||{}).content||document.title||'';",
      "var titleParts=ogT.split(/\\s*[\\|\\-\\u2013\\u2014]\\s*/);",
      "var atParts=ogT.split(/\\s+at\\s+/i);",

      // ── 4. Role ──
      // JSON-LD first (already set above), then og:title first segment, then h1 (skip generic headings)
      "if(!d.role&&titleParts.length>1)d.role=titleParts[0].trim();",
      "if(!d.role){var h1=(document.querySelector('h1')||{}).textContent||'';if(h1&&!/^(careers|jobs|join|open positions|work with us|opportunities)/i.test(h1.trim()))d.role=h1.trim()}",
      "if(!d.role&&titleParts.length)d.role=titleParts[0].trim();",

      // ── 5. Company ──
      // 5a. Handshake-specific: find employer link with numeric ID (skip nav link "Employers")
      "if(!d.company&&h.includes('handshake')){var aEls=document.querySelectorAll('a[href*=\"/employers/\"]');for(var i=0;i<aEls.length;i++){if(/\\/employers\\/\\d/.test(aEls[i].getAttribute('href'))){var t=aEls[i].textContent.trim();if(t&&t.length>1&&t.length<80){d.company=t;break}}}}",
      // 5b. Handshake fallback: parse "Role - Company | Handshake" from og:title
      "if(!d.company&&h.includes('handshake')&&titleParts.length>=2){var cp=titleParts[1].trim();if(!/handshake/i.test(cp))d.company=cp;else if(titleParts.length>=3)d.company=titleParts[1].trim()}",
      // 5c. "Role at Company" pattern
      "if(!d.company&&atParts.length>=2){var cp2=atParts[1].replace(/\\s*[\\|\\-].*/,'').trim();if(cp2&&cp2.length<80&&!ats.test(cp2))d.company=cp2}",
      // 5d. og:site_name (skip job boards and ATS platforms)
      "if(!d.company){var og=document.querySelector('meta[property=\"og:site_name\"]');if(og&&og.content&&!/handshake|linkedin|indeed|glassdoor/i.test(og.content)&&!ats.test(og.content))d.company=og.content.trim()}",
      // 5e. Data-attribute selectors
      "if(!d.company){var cEl=document.querySelector('[data-hook*=\"employer\"],[class*=\"employer-name\"],[class*=\"company-name\"],[data-testid*=\"employer\"],[data-testid*=\"company\"]');if(cEl)d.company=cEl.textContent.trim()}",
      // 5f. Company/employer links (non-Handshake)
      "if(!d.company&&!h.includes('handshake')){var cLinks=document.querySelectorAll('a[href*=\"/company\"],a[href*=\"/companies\"]');for(var i=0;i<cLinks.length;i++){var t=cLinks[i].textContent.trim();if(t&&t.length>1&&t.length<80){d.company=t;break}}}",
      // 5g. Last resort: second segment of title
      "if(!d.company&&titleParts.length>=2){var last=titleParts[titleParts.length-1].trim();if(last.length>1&&last.length<80)d.company=last}",

      // ── 6. Link ──
      "d.link=location.href;",

      // ── 7. Salary ──
      // 7a. Scoped: find small text blocks mentioning salary/compensation, extract $ from there
      "if(!d.salary){try{var sEls=document.querySelectorAll('div,span,dt,li,p,td,dd,section');for(var i=0;i<sEls.length;i++){var el=sEls[i],txt=el.innerText||'';if(txt.length>5&&txt.length<500&&/salary|compensation|pay|stipend|wage/i.test(txt)){var sm=txt.match(/\\$[\\d,]+(\\.[\\d]+)?(k|K)?\\s*([-\\u2013\\/]\\s*(\\$)?[\\d,]+(\\.[\\d]+)?(k|K)?)?\\s*(\\/\\s*(hr|hour|yr|year|month|mo|week|wk|annual))?/i);if(sm&&sm[0].length>3){d.salary=sm[0].trim();break}}}}catch(e){}}",
      // 7b. Fallback: body-wide scan but require the match to look like a real salary (>3 chars)
      "if(!d.salary){try{var bt=document.body.innerText;var sm=bt.match(/\\$[\\d,]+(\\.[\\d]+)?(k|K)?\\s*([-\\u2013\\/]\\s*(\\$)?[\\d,]+(\\.[\\d]+)?(k|K)?)?\\s*(\\/\\s*(hr|hour|yr|year|month|mo|week|wk|annual))?/i);if(sm&&sm[0].length>3)d.salary=sm[0].trim()}catch(e){}}",

      // ── 8. Job Description ──
      // 8a. Specific JD selectors (prefer "job-description" over generic "description")
      "if(!jd){var jdEl=document.querySelector('[class*=\"job-description\"],[class*=\"job_description\"],[id*=\"job-description\"],[id*=\"job_description\"],[class*=\"posting-description\"],[class*=\"job-detail\"],[class*=\"jobDetail\"]');if(jdEl&&jdEl.innerText.length>100)jd=jdEl.innerText}",
      // 8b. Broader description selectors
      "if(!jd||jd.length<200){var jdEl2=document.querySelector('[class*=\"description\"],[id*=\"description\"],article,[role=\"main\"]');if(jdEl2&&jdEl2.innerText.length>200)jd=jdEl2.innerText}",
      // 8c. Largest text block fallback (exclude nav/footer/header/sidebar)
      "if(!jd||jd.length<200){var best='';document.querySelectorAll('div,section,main').forEach(function(el){if(el.closest('nav,footer,header,[class*=\"sidebar\"],[class*=\"nav\"],[class*=\"footer\"],[class*=\"header\"]'))return;var t=el.innerText||'';if(t.length>300&&t.length>best.length&&t.length<50000)best=t});if(best.length>300)jd=best}",

      // ── 9. Clipboard + open app ──
      "var jdC=false;if(jd&&jd.length>50)try{navigator.clipboard.writeText(jd.trim().substring(0,15000));jdC=true}catch(e){}",
      "var p=new URLSearchParams();for(var k in d)if(d[k])p.set(k,String(d[k]).trim().substring(0,500));if(jdC)p.set('jdCopied','1');",
      "window.location='jobtrack://add?'+p.toString();",
      "}())",
    ].join("");
    return code;
  };

  const save = async (updated) => {
    setJobs(updated);
    try { await window.storage.set("jobs_v2", JSON.stringify(updated)); } catch {}
  };

  const exportJobs = () => {
    const blob = new Blob([JSON.stringify(jobs, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "jobtrack-export.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const importJobs = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const imported = JSON.parse(text);
        if (!Array.isArray(imported)) { alert("Invalid format: expected an array of jobs."); return; }
        const existingIds = new Set(jobs.map(j => j.id));
        const newJobs = imported.filter(j => !existingIds.has(j.id));
        if (newJobs.length === 0 && imported.length > 0) {
          if (confirm(`All ${imported.length} jobs already exist. Replace all data with imported file?`)) {
            save(imported);
          }
        } else {
          const merged = [...jobs, ...newJobs];
          save(merged);
          alert(`Imported ${newJobs.length} new job(s). ${imported.length - newJobs.length} duplicate(s) skipped.`);
        }
      } catch { alert("Failed to read file. Make sure it's a valid JSON export."); }
    };
    input.click();
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
    setQuickAddNotice("");
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

  const moveJob = (id, dir) => {
    const idx = jobs.findIndex(j => j.id === id);
    const target = idx + dir;
    if (idx === -1 || target < 0 || target >= jobs.length) return;
    const updated = [...jobs];
    [updated[idx], updated[target]] = [updated[target], updated[idx]];
    save(updated);
  };

  const pinJob = (id) => {
    const idx = jobs.findIndex(j => j.id === id);
    if (idx <= 0) return;
    const updated = [...jobs];
    const [moved] = updated.splice(idx, 1);
    updated.unshift(moved);
    save(updated);
  };

  const moveJobBottom = (id) => {
    const idx = jobs.findIndex(j => j.id === id);
    if (idx === -1 || idx === jobs.length - 1) return;
    const updated = [...jobs];
    const [moved] = updated.splice(idx, 1);
    updated.push(moved);
    save(updated);
  };

  const handleDragStart = (e, id) => {
    setDragId(id);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e, targetId) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (targetId !== undefined) setDropTargetId(targetId);
    // Auto-scroll when dragging near viewport edges
    const threshold = 80, speed = 10;
    if (e.clientY < threshold) window.scrollBy(0, -speed);
    else if (e.clientY > window.innerHeight - threshold) window.scrollBy(0, speed);
  };

  const handleDrop = (e, targetId) => {
    e.preventDefault();
    setDropTargetId(null);
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

  const handleDragEnd = () => {
    setDragId(null);
    setDropTargetId(null);
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
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <button className="btn" onClick={importJobs}
            style={{ background: "#1a1a2e", color: "#34d399", padding: "11px 18px", borderRadius: "8px", fontSize: "13px", fontWeight: 600, letterSpacing: "0.02em" }}>
            Import
          </button>
          <button className="btn" onClick={exportJobs}
            style={{ background: "#1a1a2e", color: "#fbbf24", padding: "11px 18px", borderRadius: "8px", fontSize: "13px", fontWeight: 600, letterSpacing: "0.02em" }}>
            Export
          </button>
          <button className="btn" onClick={() => setShowSetup(true)}
            style={{ background: "#1a1a2e", color: "#818cf8", padding: "11px 18px", borderRadius: "8px", fontSize: "13px", fontWeight: 600, letterSpacing: "0.02em" }}>
            Quick Add Setup
          </button>
          <button className="btn" onClick={() => { setShowForm(true); setEditId(null); setForm(getEmptyForm()); setActiveTab("details"); }}
            style={{ background: "#6366f1", color: "#fff", padding: "11px 22px", borderRadius: "8px", fontSize: "14px", fontWeight: 600, letterSpacing: "0.02em" }}>
            + Add Job
          </button>
        </div>
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
              onDragOver={e => canDrag && handleDragOver(e, job.id)}
              onDragLeave={() => dropTargetId === job.id && setDropTargetId(null)}
              onDrop={e => canDrag && handleDrop(e, job.id)}
              onDragEnd={handleDragEnd}
              style={{
                marginTop: "2px",
                opacity: dragId === job.id ? 0.4 : 1,
                transition: "opacity 0.15s",
                borderTop: dropTargetId === job.id && dragId !== job.id ? "2px solid #6366f1" : "2px solid transparent",
              }}>
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
                <div style={{ display: "flex", gap: "6px", flexShrink: 0, alignItems: "center" }}>
                  {canDrag && (
                    <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                      <button className="btn action-btn" onClick={e => { e.stopPropagation(); moveJob(job.id, -1); }}
                        disabled={filtered.indexOf(job) === 0}
                        style={{ background: "#1a1a2e", color: filtered.indexOf(job) === 0 ? "#2a2a3a" : "#94a3b8", padding: "2px 8px", borderRadius: "4px", fontSize: "11px", lineHeight: 1 }}
                        title="Move up">▲</button>
                      <button className="btn action-btn" onClick={e => { e.stopPropagation(); moveJob(job.id, 1); }}
                        disabled={filtered.indexOf(job) === filtered.length - 1}
                        style={{ background: "#1a1a2e", color: filtered.indexOf(job) === filtered.length - 1 ? "#2a2a3a" : "#94a3b8", padding: "2px 8px", borderRadius: "4px", fontSize: "11px", lineHeight: 1 }}
                        title="Move down">▼</button>
                    </div>
                  )}
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

                        {sortBy === "custom" && (
                          <>
                            <div style={{ fontSize: "12px", color: "#5a6070", letterSpacing: "0.06em", marginTop: "20px", marginBottom: "12px", fontWeight: 600 }}>REORDER</div>
                            <div style={{ display: "flex", gap: "8px" }}>
                              <button className="btn" onClick={() => { pinJob(job.id); setExpandedId(null); }}
                                disabled={jobs.indexOf(job) === 0}
                                style={{
                                  padding: "7px 16px", borderRadius: "6px", fontSize: "13px", fontWeight: 600,
                                  background: jobs.indexOf(job) === 0 ? "transparent" : "#0f1a2e",
                                  color: jobs.indexOf(job) === 0 ? "#3d4350" : "#60a5fa",
                                  border: "1px solid " + (jobs.indexOf(job) === 0 ? "#222233" : "#1e3a5f"),
                                }}>
                                ▲ Pin to Top
                              </button>
                              <button className="btn" onClick={() => { moveJobBottom(job.id); setExpandedId(null); }}
                                disabled={jobs.indexOf(job) === jobs.length - 1}
                                style={{
                                  padding: "7px 16px", borderRadius: "6px", fontSize: "13px", fontWeight: 600,
                                  background: jobs.indexOf(job) === jobs.length - 1 ? "transparent" : "#1a1a2e",
                                  color: jobs.indexOf(job) === jobs.length - 1 ? "#3d4350" : "#94a3b8",
                                  border: "1px solid " + (jobs.indexOf(job) === jobs.length - 1 ? "#222233" : "#2a2a3e"),
                                }}>
                                ▼ Move to Bottom
                              </button>
                            </div>
                          </>
                        )}
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

            {quickAddNotice && (
              <div style={{ margin: "14px 28px 0", padding: "10px 14px", background: "#1a2e1a", border: "1px solid #2d5a2d", borderRadius: "8px", fontSize: "13px", color: "#4ade80", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>{quickAddNotice}</span>
                <button className="btn" onClick={() => setQuickAddNotice("")}
                  style={{ background: "transparent", color: "#4ade80", padding: "2px 8px", fontSize: "16px", lineHeight: 1, fontWeight: 600 }}>
                  x
                </button>
              </div>
            )}

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
              <button className="btn" onClick={() => { setShowForm(false); setEditId(null); setForm(getEmptyForm()); setQuickAddNotice(""); }}
                style={{ background: "#1c1c2e", color: "#94a3b8", padding: "12px 20px", borderRadius: "8px", fontSize: "14px", fontWeight: 600 }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ─── Quick Add Setup Modal ─── */}
      {showSetup && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
          <div style={{ background: "#0e0e18", border: "1px solid #222233", borderRadius: "14px", width: "560px", maxWidth: "96vw", maxHeight: "92vh", overflow: "auto", padding: "28px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "22px" }}>
              <div style={{ fontFamily: "Syne, sans-serif", fontSize: "20px", fontWeight: 700, color: "#f1f5f9" }}>
                Quick Add Setup
              </div>
              <button className="btn" onClick={() => setShowSetup(false)}
                style={{ background: "transparent", color: "#5a6070", fontSize: "20px", lineHeight: 1, padding: "4px 8px" }}>
                x
              </button>
            </div>

            <div style={{ fontSize: "14px", color: "#94a3b8", lineHeight: "1.7", marginBottom: "24px" }}>
              Save a bookmarklet to your browser's bookmarks bar. When you're on a job posting page, click it to auto-extract the details and open JobTrack with the form pre-filled.
            </div>

            {/* Step 1 */}
            <div style={{ marginBottom: "20px" }}>
              <div style={{ fontSize: "12px", color: "#6366f1", letterSpacing: "0.08em", fontWeight: 700, marginBottom: "8px" }}>
                STEP 1 — SHOW YOUR BOOKMARKS BAR
              </div>
              <div style={{ fontSize: "13px", color: "#7a8494", lineHeight: "1.6" }}>
                Press <span style={{ color: "#e2e8f0", fontWeight: 600 }}>Ctrl+Shift+B</span> (Chrome/Edge) to toggle the bookmarks bar.
              </div>
            </div>

            {/* Step 2 */}
            <div style={{ marginBottom: "20px" }}>
              <div style={{ fontSize: "12px", color: "#6366f1", letterSpacing: "0.08em", fontWeight: 700, marginBottom: "10px" }}>
                STEP 2 — DRAG THIS TO YOUR BOOKMARKS BAR
              </div>
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

            {/* Step 3 */}
            <div style={{ marginBottom: "24px" }}>
              <div style={{ fontSize: "12px", color: "#6366f1", letterSpacing: "0.08em", fontWeight: 700, marginBottom: "8px" }}>
                STEP 3 — USE IT
              </div>
              <div style={{ fontSize: "13px", color: "#7a8494", lineHeight: "1.8" }}>
                1. Go to any job posting page<br />
                2. Click <span style={{ color: "#e2e8f0", fontWeight: 600 }}>"+ Save to JobTrack"</span> in your bookmarks bar<br />
                3. JobTrack opens with the form pre-filled<br />
                4. Review the details and hit <span style={{ color: "#e2e8f0", fontWeight: 600 }}>Add Application</span>
              </div>
            </div>

            {/* Supported platforms */}
            <div style={{ background: "#111119", border: "1px solid #1a1a2e", borderRadius: "10px", padding: "16px 20px" }}>
              <div style={{ fontSize: "12px", color: "#5a6070", letterSpacing: "0.08em", fontWeight: 700, marginBottom: "10px" }}>
                SUPPORTED PLATFORMS
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                {["Handshake", "Jobright", "LinkedIn", "Indeed", "Company Career Pages"].map(p => (
                  <span key={p} style={{ padding: "5px 12px", background: "#1a1a2e", borderRadius: "6px", fontSize: "12px", color: "#94a3b8", fontWeight: 600 }}>
                    {p}
                  </span>
                ))}
              </div>
              <div style={{ fontSize: "12px", color: "#5a6070", marginTop: "10px", lineHeight: "1.6" }}>
                Extracts: company, role, location, source, job link. Job description is copied to your clipboard for pasting into the JD tab.
              </div>
            </div>

            <button className="btn" onClick={() => setShowSetup(false)}
              style={{ width: "100%", marginTop: "20px", background: "#1c1c2e", color: "#94a3b8", padding: "12px", borderRadius: "8px", fontSize: "14px", fontWeight: 600 }}>
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
