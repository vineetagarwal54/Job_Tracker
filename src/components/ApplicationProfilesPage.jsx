import { useState, useCallback } from "react";
import { getEmptyProfile } from "../constants";
import { ApplicationProfileForm } from "./ApplicationProfileForm";
import { ApplicationProfileCard } from "./ApplicationProfileCard";

// Top-level page for managing application profiles. Owns the form modal and
// hands CRUD calls back through to useJobs via props.
export function ApplicationProfilesPage({
  profiles,
  onAdd,
  onUpdate,
  onDelete,
  onSetDefault,
}) {
  const [formState, setFormState] = useState(null);

  const openCreate = useCallback(() => {
    setFormState({ initialForm: getEmptyProfile(), editId: null });
  }, []);

  const openEdit = useCallback((profile) => {
    setFormState({ initialForm: { ...getEmptyProfile(), ...profile }, editId: profile.id });
  }, []);

  const closeForm = useCallback(() => setFormState(null), []);

  const submit = useCallback((form) => {
    if (formState?.editId != null) onUpdate(formState.editId, form);
    else onAdd(form);
    closeForm();
  }, [formState, onUpdate, onAdd, closeForm]);

  const handleDelete = useCallback((profile) => {
    if (!confirm(`Delete profile "${profile.name || "Untitled"}"? This cannot be undone.`)) return;
    onDelete(profile.id);
  }, [onDelete]);

  return (
    <>
      <div style={{
        background: "#0e0e18", borderBottom: "1px solid #1a1a2e",
        padding: "22px 32px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div>
          <div style={{
            fontFamily: "Syne, sans-serif", fontSize: "26px", fontWeight: 800,
            letterSpacing: "-0.02em", color: "#fff",
          }}>
            JOB<span style={{ color: "#6366f1" }}>TRACK</span>
          </div>
          <div style={{
            fontSize: "13px", color: "#5a6070", marginTop: "3px",
            letterSpacing: "0.05em", fontWeight: 500,
          }}>
            APPLICATION PROFILES
          </div>
        </div>
        <button className="btn" onClick={openCreate}
          style={{
            background: "#6366f1", color: "#fff",
            padding: "11px 22px", borderRadius: "8px",
            fontSize: "14px", fontWeight: 600, letterSpacing: "0.02em",
          }}>
          + New Profile
        </button>
      </div>

      <div style={{ padding: "26px 32px", maxWidth: "960px", margin: "0 auto" }}>
        <div style={{
          fontSize: "13px", color: "#7a8494", marginBottom: "16px", lineHeight: 1.6,
        }}>
          Profiles store the personal info you reuse across job applications. They're
          saved locally only — nothing leaves your machine. The default profile will
          be used by the upcoming Chrome extension to autofill applications.
        </div>

        {profiles.length === 0 ? (
          <EmptyProfiles onCreate={openCreate} />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {profiles.map(p => (
              <ApplicationProfileCard
                key={p.id}
                profile={p}
                onEdit={() => openEdit(p)}
                onDelete={() => handleDelete(p)}
                onSetDefault={() => onSetDefault(p.id)}
              />
            ))}
          </div>
        )}
      </div>

      {formState && (
        <ApplicationProfileForm
          key={formState.editId ?? "new"}
          initialForm={formState.initialForm}
          editId={formState.editId}
          allowDefaultToggle={profiles.length > 0}
          onSubmit={submit}
          onCancel={closeForm}
        />
      )}
    </>
  );
}

function EmptyProfiles({ onCreate }) {
  return (
    <div style={{
      textAlign: "center", padding: "70px 32px",
      background: "#0a0a12", border: "1px dashed #222233", borderRadius: "12px",
    }}>
      <div style={{
        fontFamily: "Syne, sans-serif", fontSize: "18px", fontWeight: 700,
        color: "#c8cdd5", marginBottom: "8px",
      }}>
        No application profiles yet
      </div>
      <div style={{ fontSize: "13px", color: "#5a6070", marginBottom: "22px" }}>
        Create your first profile to get started.
      </div>
      <button className="btn" onClick={onCreate}
        style={{
          background: "#6366f1", color: "#fff",
          padding: "11px 22px", borderRadius: "8px",
          fontSize: "14px", fontWeight: 600, letterSpacing: "0.02em",
        }}>
        + Create your first profile
      </button>
    </div>
  );
}
