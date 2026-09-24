import { useState } from "react";
import { JobCard } from "./JobCard";
import { JobDetails } from "./JobDetails";
import { EmptyState } from "./EmptyState";

export function JobList({
  jobs,           // workspace-scoped unfiltered list — used for pin/move-to-bottom bounds
  filtered,       // visible list after filter+sort
  loading,
  hasActiveFilters,
  canDrag,
  canReorder,     // subset of canDrag — controls Pin/MoveToBottom visibility
  selectMode,
  selectedIds,
  onToggleSelect,
  workspaces,
  onEdit,
  onDelete,
  onMoveUp,
  onMoveDown,
  onReorder,
  onChangeStatus,
  onChangePriority,
  onPin,
  onMoveToBottom,
  onMoveToWorkspace,
}) {
  const [expandedId, setExpandedId] = useState(null);
  const [dragId, setDragId] = useState(null);
  const [dropTargetId, setDropTargetId] = useState(null);

  const toggleExpand = (id) => setExpandedId(prev => prev === id ? null : id);

  const handleDragStart = (e, id) => {
    setDragId(id);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e, targetId) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropTargetId(targetId);
    // Auto-scroll when dragging near viewport edges
    const threshold = 80, speed = 10;
    if (e.clientY < threshold) window.scrollBy(0, -speed);
    else if (e.clientY > window.innerHeight - threshold) window.scrollBy(0, speed);
  };

  const handleDrop = (e, targetId) => {
    e.preventDefault();
    setDropTargetId(null);
    if (dragId !== null && dragId !== targetId) onReorder(dragId, targetId);
    setDragId(null);
  };

  const handleDragEnd = () => {
    setDragId(null);
    setDropTargetId(null);
  };

  if (loading) {
    return (
      <div style={{ padding: "8px 32px 48px" }}>
        <div style={{ textAlign: "center", padding: "80px", color: "#5a6070", fontSize: "15px" }}>Loading...</div>
      </div>
    );
  }

  if (filtered.length === 0) {
    return (
      <div style={{ padding: "8px 32px 48px" }}>
        <EmptyState hasActiveFilters={hasActiveFilters} />
      </div>
    );
  }

  return (
    <div style={{ padding: "8px 32px 48px" }}>
      {filtered.map((job, idx) => {
        const isExpanded = expandedId === job.id;
        const overallIdx = jobs.indexOf(job);
        const dragEnabled = canDrag && !selectMode;
        return (
          <div key={job.id}
            draggable={dragEnabled}
            onDragStart={e => dragEnabled && handleDragStart(e, job.id)}
            onDragOver={e => dragEnabled && handleDragOver(e, job.id)}
            onDragLeave={() => dropTargetId === job.id && setDropTargetId(null)}
            onDrop={e => dragEnabled && handleDrop(e, job.id)}
            onDragEnd={handleDragEnd}
            style={{
              marginTop: "2px",
              opacity: dragId === job.id ? 0.4 : 1,
              transition: "opacity 0.15s",
              borderTop: dropTargetId === job.id && dragId !== job.id ? "2px solid #6366f1" : "2px solid transparent",
            }}>
            <JobCard
              job={job}
              canDrag={dragEnabled}
              isFirst={idx === 0}
              isLast={idx === filtered.length - 1}
              selectMode={selectMode}
              isSelected={selectedIds?.has(job.id)}
              onToggleSelect={() => onToggleSelect(job.id)}
              onToggleExpand={() => toggleExpand(job.id)}
              onEdit={() => onEdit(job)}
              onDelete={() => onDelete(job.id)}
              onMoveUp={() => onMoveUp(job.id)}
              onMoveDown={() => onMoveDown(job.id)}
            />
            {isExpanded && !selectMode && (
              <JobDetails
                job={job}
                canReorder={canReorder}
                isFirstOverall={overallIdx === 0}
                isLastOverall={overallIdx === jobs.length - 1}
                workspaces={workspaces}
                onChangeStatus={(s) => onChangeStatus(job.id, s)}
                onChangePriority={(p) => onChangePriority(job.id, p)}
                onPin={() => { onPin(job.id); setExpandedId(null); }}
                onMoveToBottom={() => { onMoveToBottom(job.id); setExpandedId(null); }}
                onMoveToWorkspace={(wsId) => { onMoveToWorkspace(job.id, wsId); setExpandedId(null); }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
