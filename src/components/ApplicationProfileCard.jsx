// Card view of one application profile. The default profile gets a colored
// border + DEFAULT badge so it's visually distinct in the list.
export function ApplicationProfileCard({ profile, onEdit, onDelete, onSetDefault }) {
  const isDefault = !!profile.isDefault;
  const fullName = [profile.firstName, profile.lastName].filter(Boolean).join(" ");

  return (
    <div style={{
      background: "#0e0e18",
      border: `1px solid ${isDefault ? "#3b4486" : "#1a1a2e"}`,
      borderRadius: "12px",
      padding: "18px 20px",
      display: "flex",
      flexDirection: "column",
      gap: "14px",
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
            <span style={{
              fontFamily: "Syne, sans-serif", fontSize: "17px", fontWeight: 700,
              color: "#f1f5f9", letterSpacing: "-0.01em",
            }}>
              {profile.name || "Untitled profile"}
            </span>
            {isDefault && (
              <span className="tag" style={{
                background: "#1f2347", color: "#a5b4fc", fontSize: "10px",
                letterSpacing: "0.08em",
              }}>
                DEFAULT
              </span>
            )}
          </div>
          {fullName && (
            <div style={{ fontSize: "13px", color: "#7a8494", marginTop: "4px" }}>{fullName}</div>
          )}
        </div>

        <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
          {!isDefault && (
            <button className="btn" onClick={onSetDefault}
              title="Make this the default profile"
              style={{
                background: "#1a1a2e", color: "#a5b4fc",
                padding: "6px 12px", borderRadius: "6px",
                fontSize: "12px", fontWeight: 600,
              }}>
              Set Default
            </button>
          )}
          <button className="btn" onClick={onEdit}
            style={{
              background: "#1a1a2e", color: "#818cf8",
              padding: "6px 12px", borderRadius: "6px",
              fontSize: "12px", fontWeight: 600,
            }}>
            Edit
          </button>
          <button className="btn" onClick={onDelete}
            style={{
              background: "#2d1010", color: "#f87171",
              padding: "6px 12px", borderRadius: "6px",
              fontSize: "12px", fontWeight: 600,
            }}>
            Del
          </button>
        </div>
      </div>

      <div style={{
        display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
        gap: "10px 24px",
      }}>
        <Detail label="Email" value={profile.email} />
        <Detail label="Phone" value={profile.phone} />
        <Detail label="Location" value={[profile.city, profile.state, profile.country].filter(Boolean).join(", ")} />
        <Detail label="School" value={profile.school} />
        <Detail label="Degree" value={[profile.degree, profile.major].filter(Boolean).join(", ")} />
        <Detail label="Graduation" value={profile.graduationDate} />
      </div>
    </div>
  );
}

function Detail({ label, value }) {
  if (!value) return null;
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{
        fontSize: "10px", color: "#5a6070",
        letterSpacing: "0.1em", fontWeight: 600,
        textTransform: "uppercase",
      }}>
        {label}
      </div>
      <div style={{
        fontSize: "13px", color: "#c8cdd5", marginTop: "2px",
        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
      }}>
        {value}
      </div>
    </div>
  );
}
