import { useState, useEffect, useRef } from "react";

// Tab-style workspace navigator. Each tab is draggable to reorder; double-click
// the name to rename inline; click "×" to request deletion (parent handles the
// confirmation flow). The "+" tab adds a new workspace.
export function WorkspaceSwitcher({
  workspaces,
  activeWorkspaceId,
  jobCounts,
  onSwitch,
  onAdd,
  onRename,
  onRequestDelete,
  onReorder,
}) {
  const [editingId, setEditingId] = useState(null);
  const [draftName, setDraftName] = useState("");
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [dragId, setDragId] = useState(null);
  const [dropTargetId, setDropTargetId] = useState(null);
  const editInputRef = useRef(null);
  const addInputRef = useRef(null);

  useEffect(() => {
    if (editingId !== null) editInputRef.current?.focus();
  }, [editingId]);

  useEffect(() => {
    if (adding) addInputRef.current?.focus();
  }, [adding]);

  const startEdit = (ws) => {
    setEditingId(ws.id);
    setDraftName(ws.name);
  };

  const commitEdit = () => {
    const trimmed = draftName.trim();
    if (trimmed && trimmed !== workspaces.find(w => w.id === editingId)?.name) {
      onRename(editingId, trimmed);
    }
    setEditingId(null);
  };

  const commitAdd = () => {
    const trimmed = newName.trim();
    if (trimmed) onAdd(trimmed);
    setAdding(false);
    setNewName("");
  };

  const handleDragStart = (e, id) => {
    setDragId(id);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e, id) => {
    if (dragId == null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropTargetId(id);
  };

  const handleDrop = (e, id) => {
    e.preventDefault();
    if (dragId != null && dragId !== id) onReorder?.(dragId, id);
    setDragId(null);
    setDropTargetId(null);
  };

  const handleDragEnd = () => {
    setDragId(null);
    setDropTargetId(null);
  };

  return (
    <div style={{
      display: "flex", alignItems: "stretch",
      padding: "0 32px", background: "#0a0a12",
      borderBottom: "1px solid #1a1a2e",
      overflowX: "auto",
    }}>
      {workspaces.map(ws => {
        const isActive = ws.id === activeWorkspaceId;
        const count = jobCounts?.[ws.id] ?? 0;
        const isEditing = editingId === ws.id;
        const isDragging = dragId === ws.id;
        const isDropTarget = dropTargetId === ws.id && dragId !== ws.id;
        const draggable = !isEditing && workspaces.length > 1;

        return (
          <div key={ws.id}
            draggable={draggable}
            onDragStart={e => draggable && handleDragStart(e, ws.id)}
            onDragOver={e => handleDragOver(e, ws.id)}
            onDragLeave={() => dropTargetId === ws.id && setDropTargetId(null)}
            onDrop={e => handleDrop(e, ws.id)}
            onDragEnd={handleDragEnd}
            onClick={() => !isEditing && onSwitch(ws.id)}
            onDoubleClick={() => startEdit(ws)}
            title={isEditing ? "" : "Click to switch · Double-click to rename · Drag to reorder"}
            style={{
              display: "flex", alignItems: "center", gap: "8px",
              padding: "11px 18px",
              borderBottom: "2px solid " + (isActive ? "#6366f1" : "transparent"),
              borderLeft: isDropTarget ? "2px solid #818cf8" : "2px solid transparent",
              background: isActive ? "#11142a" : "transparent",
              cursor: isEditing ? "default" : "pointer",
              opacity: isDragging ? 0.4 : 1,
              transition: "background 0.15s, opacity 0.15s",
              flexShrink: 0,
              userSelect: "none",
            }}>
            {isEditing ? (
              <input
                ref={editInputRef}
                value={draftName}
                onChange={e => setDraftName(e.target.value)}
                onBlur={commitEdit}
                onClick={e => e.stopPropagation()}
                onKeyDown={e => {
                  if (e.key === "Enter") commitEdit();
                  if (e.key === "Escape") setEditingId(null);
                }}
                style={{
                  background: "#0e0e18", color: "#f1f5f9",
                  border: "1px solid #3b4486", borderRadius: "4px",
                  padding: "3px 8px", fontSize: "13px", fontWeight: 600,
                  outline: "none", width: `${Math.max(draftName.length + 1, 8)}ch`,
                }} />
            ) : (
              <>
                <span style={{
                  fontSize: "13px", fontWeight: 600,
                  color: isActive ? "#f1f5f9" : "#7a8494",
                  whiteSpace: "nowrap",
                  letterSpacing: "0.01em",
                }}>
                  {ws.name}
                </span>
                <span style={{
                  fontSize: "11px",
                  padding: "2px 7px",
                  borderRadius: "10px",
                  background: isActive ? "#1f2347" : "#15151f",
                  color: isActive ? "#a5b4fc" : "#5a6070",
                  fontWeight: 600,
                  minWidth: "18px",
                  textAlign: "center",
                }}>
                  {count}
                </span>
                {workspaces.length > 1 && (
                  <button className="btn"
                    onClick={(e) => { e.stopPropagation(); onRequestDelete(ws.id); }}
                    title="Delete workspace"
                    style={{
                      background: "transparent",
                      color: isActive ? "#7080d0" : "#3d4350",
                      padding: "0 4px",
                      borderRadius: "4px",
                      fontSize: "14px",
                      lineHeight: 1,
                      fontWeight: 600,
                      marginLeft: "2px",
                    }}>
                    ×
                  </button>
                )}
              </>
            )}
          </div>
        );
      })}

      {adding ? (
        <div style={{
          display: "flex", alignItems: "center",
          padding: "11px 18px",
          borderBottom: "2px solid #3b4486",
          flexShrink: 0,
        }}>
          <input
            ref={addInputRef}
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onBlur={commitAdd}
            onKeyDown={e => {
              if (e.key === "Enter") commitAdd();
              if (e.key === "Escape") { setAdding(false); setNewName(""); }
            }}
            placeholder="Workspace name"
            style={{
              background: "#0e0e18", color: "#f1f5f9",
              border: "1px solid #3b4486", borderRadius: "4px",
              padding: "3px 8px", fontSize: "13px", fontWeight: 600,
              outline: "none", width: "180px",
            }} />
        </div>
      ) : (
        <button className="btn"
          onClick={() => setAdding(true)}
          title="Add workspace"
          style={{
            display: "flex", alignItems: "center", gap: "6px",
            background: "transparent", color: "#818cf8",
            border: "none", borderBottom: "2px solid transparent",
            padding: "11px 18px", fontSize: "13px", fontWeight: 600,
            flexShrink: 0,
            cursor: "pointer",
          }}>
          <span style={{ fontSize: "16px", lineHeight: 1 }}>+</span>
          <span>New</span>
        </button>
      )}
    </div>
  );
}
