import { useState, useEffect } from "react";
import { WORK_AUTH_OPTIONS, SPONSORSHIP_OPTIONS } from "../constants";
import { validateProfileForm } from "../utils/validation";
import { FormField } from "./FormField";

// Modal form for creating/editing an application profile. Uses the same
// 2-column grid + inline-error pattern as JobForm, with section labels
// to keep ~20 fields legible.
export function ApplicationProfileForm({ initialForm, editId, allowDefaultToggle, onSubmit, onCancel }) {
  const [form, setForm] = useState(initialForm);
  const [errors, setErrors] = useState({});

  useEffect(() => {
    setForm(initialForm);
    setErrors({});
  }, [initialForm]);

  const updateField = (field, value) => {
    setForm(f => ({ ...f, [field]: value }));
    if (errors[field]) setErrors(e => { const next = { ...e }; delete next[field]; return next; });
  };

  const handleSubmit = () => {
    const { isValid, errors: validationErrors } = validateProfileForm(form);
    if (!isValid) {
      setErrors(validationErrors);
      return;
    }
    onSubmit(form);
  };

  const fieldError = (field) => errors[field];
  const errorStyle = (field) => fieldError(field) ? { borderColor: "#f87171" } : undefined;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
      <div style={{ background: "#0e0e18", border: "1px solid #222233", borderRadius: "14px", width: "640px", maxWidth: "96vw", maxHeight: "92vh", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "22px 28px 16px", borderBottom: "1px solid #1a1a2e" }}>
          <div style={{ fontFamily: "Syne, sans-serif", fontSize: "18px", fontWeight: 700, color: "#f1f5f9" }}>
            {editId ? "Edit Profile" : "New Application Profile"}
          </div>
          <div style={{ fontSize: "12px", color: "#5a6070", marginTop: "4px" }}>
            Saved locally. Used to autofill applications later.
          </div>
        </div>

        <div style={{ overflowY: "auto", padding: "18px 28px 28px", flex: 1 }}>
          <SectionLabel>Identity</SectionLabel>
          <Grid>
            <FormField label="PROFILE NAME *">
              <input className="form-input" value={form.name}
                onChange={e => updateField("name", e.target.value)}
                placeholder="e.g. Standard, EU-only, etc."
                style={errorStyle("name")} />
              {fieldError("name") && <FieldError message={fieldError("name")} />}
            </FormField>

            <FormField label="FIRST NAME *" col="1/2">
              <input className="form-input" value={form.firstName}
                onChange={e => updateField("firstName", e.target.value)}
                style={errorStyle("firstName")} />
              {fieldError("firstName") && <FieldError message={fieldError("firstName")} />}
            </FormField>
            <FormField label="LAST NAME *" col="2/3">
              <input className="form-input" value={form.lastName}
                onChange={e => updateField("lastName", e.target.value)}
                style={errorStyle("lastName")} />
              {fieldError("lastName") && <FieldError message={fieldError("lastName")} />}
            </FormField>

            <FormField label="EMAIL *" col="1/2">
              <input className="form-input" value={form.email}
                onChange={e => updateField("email", e.target.value)}
                placeholder="you@example.com"
                style={errorStyle("email")} />
              {fieldError("email") && <FieldError message={fieldError("email")} />}
            </FormField>
            <FormField label="PHONE" col="2/3">
              <input className="form-input" value={form.phone}
                onChange={e => updateField("phone", e.target.value)}
                placeholder="+1 555 555 1234" />
            </FormField>
          </Grid>

          <SectionLabel>Address</SectionLabel>
          <Grid>
            <FormField label="STREET ADDRESS">
              <input className="form-input" value={form.address}
                onChange={e => updateField("address", e.target.value)}
                placeholder="123 Main St" />
            </FormField>
            <FormField label="CITY" col="1/2">
              <input className="form-input" value={form.city}
                onChange={e => updateField("city", e.target.value)} />
            </FormField>
            <FormField label="STATE / REGION" col="2/3">
              <input className="form-input" value={form.state}
                onChange={e => updateField("state", e.target.value)} />
            </FormField>
            <FormField label="ZIP / POSTAL" col="1/2">
              <input className="form-input" value={form.zip}
                onChange={e => updateField("zip", e.target.value)} />
            </FormField>
            <FormField label="COUNTRY" col="2/3">
              <input className="form-input" value={form.country}
                onChange={e => updateField("country", e.target.value)} />
            </FormField>
          </Grid>

          <SectionLabel>Online presence</SectionLabel>
          <Grid>
            <FormField label="LINKEDIN URL">
              <input className="form-input" value={form.linkedin}
                onChange={e => updateField("linkedin", e.target.value)}
                placeholder="https://linkedin.com/in/..." />
            </FormField>
            <FormField label="GITHUB URL">
              <input className="form-input" value={form.github}
                onChange={e => updateField("github", e.target.value)}
                placeholder="https://github.com/..." />
            </FormField>
            <FormField label="PORTFOLIO URL">
              <input className="form-input" value={form.portfolio}
                onChange={e => updateField("portfolio", e.target.value)}
                placeholder="https://..." />
            </FormField>
          </Grid>

          <SectionLabel>Education</SectionLabel>
          <Grid>
            <FormField label="SCHOOL">
              <input className="form-input" value={form.school}
                onChange={e => updateField("school", e.target.value)}
                placeholder="e.g. University of California, Berkeley" />
            </FormField>
            <FormField label="DEGREE" col="1/2">
              <input className="form-input" value={form.degree}
                onChange={e => updateField("degree", e.target.value)}
                placeholder="e.g. B.S." />
            </FormField>
            <FormField label="MAJOR" col="2/3">
              <input className="form-input" value={form.major}
                onChange={e => updateField("major", e.target.value)}
                placeholder="e.g. Computer Science" />
            </FormField>
            <FormField label="GRADUATION DATE" col="1/2">
              <input type="month" className="form-input" value={form.graduationDate}
                onChange={e => updateField("graduationDate", e.target.value)} />
            </FormField>
          </Grid>

          <SectionLabel>Work eligibility</SectionLabel>
          <Grid>
            <FormField label="AUTHORIZED TO WORK?" col="1/2">
              <select className="form-select" value={form.workAuthorization}
                onChange={e => updateField("workAuthorization", e.target.value)}>
                {WORK_AUTH_OPTIONS.map(o => <option key={o} value={o}>{o || "—"}</option>)}
              </select>
            </FormField>
            <FormField label="REQUIRES SPONSORSHIP?" col="2/3">
              <select className="form-select" value={form.sponsorship}
                onChange={e => updateField("sponsorship", e.target.value)}>
                {SPONSORSHIP_OPTIONS.map(o => <option key={o} value={o}>{o || "—"}</option>)}
              </select>
            </FormField>
          </Grid>

          <SectionLabel>Notes</SectionLabel>
          <Grid>
            <FormField label="COMMON SHORT ANSWERS">
              <textarea className="form-input" style={{ minHeight: "100px", resize: "vertical" }}
                value={form.shortAnswerNotes}
                onChange={e => updateField("shortAnswerNotes", e.target.value)}
                placeholder="Reusable answers — 'Why this company?', salary expectations, etc." />
            </FormField>

            {allowDefaultToggle && (
              <FormField label="DEFAULT PROFILE">
                <label style={{ display: "flex", alignItems: "center", gap: "10px", fontSize: "13px", color: "#94a3b8", cursor: "pointer" }}>
                  <input type="checkbox" checked={!!form.isDefault}
                    onChange={e => updateField("isDefault", e.target.checked)}
                    style={{ width: "16px", height: "16px", accentColor: "#6366f1", cursor: "pointer" }} />
                  Use this as the default profile for autofill
                </label>
              </FormField>
            )}
          </Grid>
        </div>

        <div style={{ padding: "0 28px 22px", display: "flex", gap: "10px" }}>
          <button className="btn" onClick={handleSubmit}
            style={{ flex: 1, background: "#6366f1", color: "#fff", padding: "12px", borderRadius: "8px", fontSize: "14px", fontWeight: 600 }}>
            {editId ? "Save Changes" : "Create Profile"}
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

function SectionLabel({ children }) {
  return (
    <div style={{
      fontSize: "11px", color: "#5a6070", letterSpacing: "0.1em",
      fontWeight: 700, marginTop: "18px", marginBottom: "10px",
      textTransform: "uppercase",
    }}>
      {children}
    </div>
  );
}

function Grid({ children }) {
  return <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" }}>{children}</div>;
}

function FieldError({ message }) {
  return <div style={{ fontSize: "12px", color: "#f87171", marginTop: "4px" }}>{message}</div>;
}
