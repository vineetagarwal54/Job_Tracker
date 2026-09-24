import { useState, useEffect } from "react";
import {
  RESUME_VERSIONS, WORK_TYPES, SOURCES, PRIORITIES, STATUSES,
} from "../constants";
import { validateJobForm } from "../utils/validation";
import { FormField } from "./FormField";

export function JobForm({ initialForm, editId, workspaces, quickAddNotice, onSubmit, onCancel, onDismissNotice }) {
  const [form, setForm] = useState(initialForm);
  const [errors, setErrors] = useState({});
  const [activeTab, setActiveTab] = useState("details");

  // Re-sync form when the parent opens the modal for a different job
  // (the parent remounts this component via `key`, so this is mostly a safety net).
  useEffect(() => {
    setForm(initialForm);
    setErrors({});
    setActiveTab("details");
  }, [initialForm]);

  const updateField = (field, value) => {
    setForm(f => ({ ...f, [field]: value }));
    // Clear an error the moment the user fixes it — don't wait for resubmit
    if (errors[field]) setErrors(e => { const next = { ...e }; delete next[field]; return next; });
  };

  const handleSubmit = () => {
    const { isValid, errors: validationErrors } = validateJobForm(form);
    if (!isValid) {
      setErrors(validationErrors);
      // If the user is on the JD tab, bounce them to Details so they can see the errors
      if (activeTab !== "details") setActiveTab("details");
      return;
    }
    onSubmit(form);
  };

  const fieldError = (field) => errors[field];
  const errorStyle = (field) => fieldError(field) ? { borderColor: "#f87171" } : undefined;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
      <div style={{ background: "#0e0e18", border: "1px solid #222233", borderRadius: "14px", width: "580px", maxWidth: "96vw", maxHeight: "92vh", display: "flex", flexDirection: "column" }}>
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
            <button className="btn" onClick={onDismissNotice}
              style={{ background: "transparent", color: "#4ade80", padding: "2px 8px", fontSize: "16px", lineHeight: 1, fontWeight: 600 }}>
              x
            </button>
          </div>
        )}

        <div style={{ overflowY: "auto", padding: "18px 28px 28px", flex: 1 }}>
          {activeTab === "details" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" }}>
              {workspaces && workspaces.length > 0 && (
                <FormField label="WORKSPACE" col="1/-1">
                  <select className="form-select"
                    value={form.workspaceId ?? ""}
                    onChange={e => updateField("workspaceId", Number(e.target.value))}>
                    {workspaces.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                </FormField>
              )}
              <FormField label="COMPANY *">
                <input className="form-input" value={form.company}
                  onChange={e => updateField("company", e.target.value)}
                  placeholder="e.g. Google"
                  style={errorStyle("company")} />
                {fieldError("company") && <FieldError message={fieldError("company")} />}
              </FormField>
              <FormField label="ROLE *">
                <input className="form-input" value={form.role}
                  onChange={e => updateField("role", e.target.value)}
                  placeholder="e.g. SWE Intern"
                  style={errorStyle("role")} />
                {fieldError("role") && <FieldError message={fieldError("role")} />}
              </FormField>

              <FormField label="STATUS" col="1/2">
                <select className="form-select" value={form.status} onChange={e => updateField("status", e.target.value)}>
                  {STATUSES.map(s => <option key={s}>{s}</option>)}
                </select>
              </FormField>
              <FormField label="PRIORITY" col="2/3">
                <select className="form-select" value={form.priority} onChange={e => updateField("priority", e.target.value)}>
                  {PRIORITIES.map(p => <option key={p}>{p}</option>)}
                </select>
              </FormField>

              <FormField label="DATE APPLIED" col="1/2">
                <input type="date" className="form-input" value={form.date} onChange={e => updateField("date", e.target.value)} />
              </FormField>
              <FormField label="DEADLINE" col="2/3">
                <input type="date" className="form-input" value={form.deadline} onChange={e => updateField("deadline", e.target.value)} />
              </FormField>

              <FormField label="LOCATION" col="1/2">
                <input className="form-input" value={form.location} onChange={e => updateField("location", e.target.value)} placeholder="e.g. New York, NY" />
              </FormField>
              <FormField label="WORK TYPE" col="2/3">
                <select className="form-select" value={form.workType} onChange={e => updateField("workType", e.target.value)}>
                  {WORK_TYPES.map(w => <option key={w}>{w}</option>)}
                </select>
              </FormField>

              <FormField label="SALARY / COMP">
                <input className="form-input" value={form.salary} onChange={e => updateField("salary", e.target.value)} placeholder="e.g. $40/hr or $120k–$150k" />
              </FormField>

              <FormField label="RESUME VERSION" col="1/2">
                <select className="form-select" value={form.resume} onChange={e => updateField("resume", e.target.value)}>
                  {RESUME_VERSIONS.map(r => <option key={r}>{r}</option>)}
                </select>
              </FormField>
              <FormField label="SOURCE" col="2/3">
                <select className="form-select" value={form.source} onChange={e => updateField("source", e.target.value)}>
                  {SOURCES.map(s => <option key={s}>{s}</option>)}
                </select>
              </FormField>

              <FormField label="RECRUITER NAME" col="1/2">
                <input className="form-input" value={form.recruiter} onChange={e => updateField("recruiter", e.target.value)} placeholder="e.g. Jane Smith" />
              </FormField>
              <FormField label="RECRUITER EMAIL" col="2/3">
                <input className="form-input" value={form.recruiterEmail} onChange={e => updateField("recruiterEmail", e.target.value)} placeholder="jane@company.com" />
              </FormField>

              <FormField label="JOB POSTING URL">
                <input className="form-input" value={form.link} onChange={e => updateField("link", e.target.value)} placeholder="https://..." />
              </FormField>

              <FormField label="NOTES">
                <textarea className="form-input" style={{ minHeight: "80px", resize: "vertical" }} value={form.notes} onChange={e => updateField("notes", e.target.value)} placeholder="Interview notes, contacts, next steps..." />
              </FormField>
            </div>
          )}

          {activeTab === "jd" && (
            <div>
              <div style={{ fontSize: "13px", color: "#5a6070", marginBottom: "10px", lineHeight: "1.6" }}>
                Paste the full job description here. Useful for tailoring your resume and prepping for interviews.
              </div>
              <textarea className="form-input" style={{ minHeight: "360px", resize: "vertical", lineHeight: "1.8" }}
                value={form.jd} onChange={e => updateField("jd", e.target.value)}
                placeholder="Paste the full job description here..." />
            </div>
          )}
        </div>

        <div style={{ padding: "0 28px 22px", display: "flex", gap: "10px" }}>
          <button className="btn" onClick={handleSubmit}
            style={{ flex: 1, background: "#6366f1", color: "#fff", padding: "12px", borderRadius: "8px", fontSize: "14px", fontWeight: 600 }}>
            {editId ? "Save Changes" : "Add Application"}
          </button>
          <button className="btn" onClick={onCancel}
            style={{ background: "#1c1c2e", color: "#94a3b8", padding: "12px 20px", borderRadius: "8px", fontSize: "14px", fontWeight: 600 }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function FieldError({ message }) {
  return <div style={{ fontSize: "12px", color: "#f87171", marginTop: "4px" }}>{message}</div>;
}
