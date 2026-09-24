import { useEffect } from "react";

const TYPE_STYLES = {
  error:   { bg: "#2d1010", color: "#f87171", border: "#5a2020" },
  success: { bg: "#0f2e1a", color: "#4ade80", border: "#2d5a2d" },
  info:    { bg: "#1a1a2e", color: "#94a3b8", border: "#2a2a3e" },
};

export function Toast({ toast, onDismiss, autoDismissMs = 4000 }) {
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(onDismiss, autoDismissMs);
    return () => clearTimeout(t);
  }, [toast, onDismiss, autoDismissMs]);

  if (!toast) return null;
  const s = TYPE_STYLES[toast.type] || TYPE_STYLES.info;

  return (
    <div style={{
      position: "fixed", top: "20px", right: "20px", zIndex: 200,
      padding: "12px 18px", borderRadius: "8px", maxWidth: "400px",
      fontSize: "13px", fontWeight: 500, lineHeight: 1.5,
      background: s.bg, color: s.color, border: `1px solid ${s.border}`,
      boxShadow: "0 6px 24px rgba(0,0,0,0.4)",
      display: "flex", alignItems: "flex-start", gap: "10px",
    }}>
      <span style={{ flex: 1 }}>{toast.message}</span>
      <button onClick={onDismiss}
        style={{ background: "transparent", border: "none", color: "inherit", cursor: "pointer", fontSize: "16px", lineHeight: 1, padding: 0 }}>
        x
      </button>
    </div>
  );
}
