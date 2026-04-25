export function FormField({ label, children, col = "1/-1" }) {
  return (
    <div style={{ gridColumn: col }}>
      <label style={{ fontSize: "12px", color: "#8892a4", letterSpacing: "0.06em", fontWeight: 500 }}>{label}</label>
      <div style={{ marginTop: "5px" }}>{children}</div>
    </div>
  );
}
