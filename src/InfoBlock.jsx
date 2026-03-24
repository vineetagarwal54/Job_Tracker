export function InfoBlock({ label, value, color }) {
  return (
    <div>
      <div style={{ fontSize: "11px", color: "#5a6070", letterSpacing: "0.06em", marginBottom: "5px", fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: "14px", color: color || "#b0b8c8", fontWeight: 500 }}>{value}</div>
    </div>
  );
}

export function FormField({ label, children, col = "1/-1" }) {
  return (
    <div style={{ gridColumn: col }}>
      <label style={{ fontSize: "12px", color: "#8892a4", letterSpacing: "0.06em", fontWeight: 500 }}>{label}</label>
      <div style={{ marginTop: "5px" }}>{children}</div>
    </div>
  );
}
