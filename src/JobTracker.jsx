import { useState, useEffect, useMemo, useCallback } from "react";
import { STATUSES, getEmptyForm } from "./constants";
import { globalStyles } from "./styles";

import { useJobs } from "./hooks/useJobs";
import { useFilters } from "./hooks/useFilters";
import { useJobSorting } from "./hooks/useJobSorting";

import { Header } from "./components/Header";
import { Filters } from "./components/Filters";
import { JobList } from "./components/JobList";
import { JobForm } from "./components/JobForm";
import { QuickAddSetup } from "./components/QuickAddSetup";
import { Toast } from "./components/Toast";
import { WorkspaceSwitcher } from "./components/WorkspaceSwitcher";
import { AppTabs } from "./components/AppTabs";
import { ApplicationProfilesPage } from "./components/ApplicationProfilesPage";
import { AiResumePage } from "./components/AiResumePage";
import { QuickGenerateModal } from "./components/QuickGenerateModal";
import { allCoverLetterSources } from "./utils/resumeGeneration";

const QUICK_ADD_FIELDS = ["company", "role", "location", "salary", "link", "source", "workType", "deadline"];

export default function JobTracker() {
  const {
    jobs, workspaces, activeWorkspaceId,
    loading, loadError, toast, setToast,
    addJob, updateJob, deleteJob,
    moveJob, pinJob, moveJobBottom, reorderJobs,
    exportJobs, importJobs,
    switchWorkspace, addWorkspace, renameWorkspace, deleteWorkspace, reorderWorkspaces,
    moveJobsToWorkspace, bulkUpdateJobs, bulkDeleteJobs,
    applicationProfiles,
    addProfile, updateProfile, deleteProfile, setDefaultProfile,
    addGeneratedDocument, removeGeneratedDocument,
    generationHistory, addGenerationHistoryEntry, removeGenerationHistoryEntry,
  } = useJobs();

  // Top-level view: "jobs" (existing tracker) or "profiles" (new autofill profiles).
  const [activeView, setActiveView] = useState("jobs");
  const [resumeStatus, setResumeStatus] = useState(null);
  const [showQuickGenerate, setShowQuickGenerate] = useState(false);

  const refreshResumeStatus = useCallback(async () => {
    if (!window.resume?.status) return;
    try { setResumeStatus(await window.resume.status()); } catch { setResumeStatus({ api: { configured: false }, tectonic: { available: false } }); }
  }, []);

  useEffect(() => { refreshResumeStatus(); }, [refreshResumeStatus]);

  const filters = useFilters();

  // All jobs in the active workspace, before search/status/etc filters.
  const workspaceJobs = useMemo(
    () => jobs.filter(j => j.workspaceId === activeWorkspaceId),
    [jobs, activeWorkspaceId]
  );

  const filtered = useJobSorting(workspaceJobs, filters);

  const [formState, setFormState] = useState(null);
  const [quickAddNotice, setQuickAddNotice] = useState("");
  const [showSetup, setShowSetup] = useState(false);

  // Multi-select state
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  // Pending workspace deletion (parent owns the dialog flow).
  const [deletingWorkspaceId, setDeletingWorkspaceId] = useState(null);

  // Clear selection when leaving select mode or switching workspace.
  useEffect(() => {
    if (!selectMode) setSelectedIds(new Set());
  }, [selectMode]);
  useEffect(() => {
    setSelectedIds(new Set());
    setSelectMode(false);
  }, [activeWorkspaceId]);

  const openAddForm = useCallback(() => {
    setFormState({ initialForm: { ...getEmptyForm(), workspaceId: activeWorkspaceId }, editId: null });
  }, [activeWorkspaceId]);

  const openEditForm = useCallback((job) => {
    setFormState({ initialForm: { ...getEmptyForm(), ...job }, editId: job.id });
  }, []);

  const closeForm = useCallback(() => {
    setFormState(null);
    setQuickAddNotice("");
  }, []);

  const submitForm = useCallback((form) => {
    if (formState?.editId != null) updateJob(formState.editId, form);
    else addJob(form);
    closeForm();
  }, [formState, addJob, updateJob, closeForm]);

  // Quick Add: pre-fill form from deep-link params (web URL or Electron jobtrack:// protocol)
  const applyQuickAdd = useCallback((params) => {
    const prefilled = { ...getEmptyForm(), workspaceId: activeWorkspaceId };
    QUICK_ADD_FIELDS.forEach(f => { if (params[f]) prefilled[f] = params[f]; });
    setFormState({ initialForm: prefilled, editId: null });
    setQuickAddNotice(
      params.jdCopied === "1"
        ? "Job description copied to clipboard — switch to JD tab and paste it"
        : "Auto-filled from job page — review and hit Add"
    );
  }, [activeWorkspaceId]);

  // Web mode: read ?quickadd=... params on load
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has("quickadd")) return;
    applyQuickAdd(Object.fromEntries(params.entries()));
    window.history.replaceState({}, "", window.location.pathname);
  }, [applyQuickAdd]);

  // Electron mode: listen for deep-link events
  useEffect(() => {
    if (!window.electronAPI) return;
    window.electronAPI.onQuickAdd((params) => applyQuickAdd(params));
    window.electronAPI.signalReady();
  }, [applyQuickAdd]);

  const statusCounts = useMemo(
    () => STATUSES.reduce((acc, s) => ({ ...acc, [s]: workspaceJobs.filter(j => j.status === s).length }), {}),
    [workspaceJobs]
  );

  const workspaceJobCounts = useMemo(() => {
    const counts = {};
    for (const w of workspaces) counts[w.id] = 0;
    for (const j of jobs) {
      if (counts[j.workspaceId] != null) counts[j.workspaceId]++;
    }
    return counts;
  }, [jobs, workspaces]);

  const canDrag = filters.sortBy === "custom" && !filters.hasActiveFilters && !selectMode;

  // Selection handlers --------------------------------------------------------
  const toggleSelect = useCallback((id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const selectAllVisible = useCallback(() => {
    setSelectedIds(new Set(filtered.map(j => j.id)));
  }, [filtered]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const handleBulkMove = useCallback((targetWsId) => {
    if (selectedIds.size === 0 || targetWsId == null) return;
    const count = selectedIds.size;
    moveJobsToWorkspace(Array.from(selectedIds), targetWsId);
    const targetName = workspaces.find(w => w.id === targetWsId)?.name ?? "workspace";
    setToast({ message: `Moved ${count} job(s) to "${targetName}".`, type: "success" });
    setSelectedIds(new Set());
    setSelectMode(false);
  }, [selectedIds, moveJobsToWorkspace, workspaces, setToast]);

  const handleBulkStatus = useCallback((status) => {
    if (selectedIds.size === 0 || !status) return;
    const count = selectedIds.size;
    bulkUpdateJobs(Array.from(selectedIds), { status });
    setToast({ message: `Updated ${count} job(s) to "${status}".`, type: "success" });
  }, [selectedIds, bulkUpdateJobs, setToast]);

  const handleBulkDelete = useCallback(() => {
    if (selectedIds.size === 0) return;
    const count = selectedIds.size;
    if (!confirm(`Delete ${count} selected job(s)? This cannot be undone.`)) return;
    bulkDeleteJobs(Array.from(selectedIds));
    setToast({ message: `Deleted ${count} job(s).`, type: "success" });
    setSelectedIds(new Set());
    setSelectMode(false);
  }, [selectedIds, bulkDeleteJobs, setToast]);

  const handleSingleMoveToWorkspace = useCallback((jobId, targetWsId) => {
    moveJobsToWorkspace([jobId], targetWsId);
    const targetName = workspaces.find(w => w.id === targetWsId)?.name ?? "workspace";
    setToast({ message: `Moved to "${targetName}".`, type: "success" });
  }, [moveJobsToWorkspace, workspaces, setToast]);

  // Workspace deletion flow ---------------------------------------------------
  const requestDeleteWorkspace = useCallback((id) => {
    setDeletingWorkspaceId(id);
  }, []);

  const cancelDeleteWorkspace = useCallback(() => {
    setDeletingWorkspaceId(null);
  }, []);

  const confirmDeleteWorkspace = useCallback((targetWorkspaceId) => {
    if (deletingWorkspaceId == null) return;
    deleteWorkspace(deletingWorkspaceId, targetWorkspaceId);
    setDeletingWorkspaceId(null);
  }, [deletingWorkspaceId, deleteWorkspace]);

  const deletingWorkspace = workspaces.find(w => w.id === deletingWorkspaceId);
  const deletingWorkspaceJobCount = deletingWorkspaceId != null ? (workspaceJobCounts[deletingWorkspaceId] ?? 0) : 0;
  const otherWorkspaces = workspaces.filter(w => w.id !== deletingWorkspaceId);

  return (
    <div style={{ minHeight: "100vh", background: "#0b0b12", fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif", color: "#e2e8f0" }}>
      <style>{globalStyles}</style>

      <Toast toast={toast} onDismiss={() => setToast(null)} />

      {loadError && (
        <div style={{
          background: "#2d1010", borderBottom: "1px solid #5a2020", padding: "12px 32px",
          fontSize: "13px", color: "#f87171", display: "flex", alignItems: "center", gap: "12px",
        }}>
          <span style={{ fontWeight: 700 }}>Load error:</span>
          <span style={{ flex: 1 }}>{loadError}</span>
        </div>
      )}

      <AppTabs activeView={activeView} onChange={setActiveView} />

      {activeView === "profiles" ? (
        <ApplicationProfilesPage
          profiles={applicationProfiles}
          onAdd={addProfile}
          onUpdate={updateProfile}
          onDelete={deleteProfile}
          onSetDefault={setDefaultProfile}
        />
      ) : activeView === "ai-resume" ? (
        <AiResumePage
          jobs={jobs}
          generationHistory={generationHistory}
          status={resumeStatus}
          onRefreshStatus={refreshResumeStatus}
          onRemoveJobHistory={removeGeneratedDocument}
          onRemoveQuickHistory={removeGenerationHistoryEntry}
        />
      ) : (
        <>
      <Header
        totalJobs={workspaceJobs.length}
        statusCounts={statusCounts}
        filterStatus={filters.filterStatus}
        onFilterStatus={filters.setFilterStatus}
        onImport={importJobs}
        onExport={exportJobs}
        onOpenSetup={() => setShowSetup(true)}
        onAddJob={openAddForm}
        onQuickGenerate={() => setShowQuickGenerate(true)}
      />

      <WorkspaceSwitcher
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspaceId}
        jobCounts={workspaceJobCounts}
        onSwitch={switchWorkspace}
        onAdd={addWorkspace}
        onRename={renameWorkspace}
        onRequestDelete={requestDeleteWorkspace}
        onReorder={reorderWorkspaces}
      />

      <Filters
        search={filters.search} setSearch={filters.setSearch}
        filterPriority={filters.filterPriority} setFilterPriority={filters.setFilterPriority}
        filterResume={filters.filterResume} setFilterResume={filters.setFilterResume}
        sortBy={filters.sortBy} setSortBy={filters.setSortBy}
        hasActiveFilters={filters.hasActiveFilters} clearFilters={filters.clearFilters}
        filteredCount={filtered.length} totalCount={workspaceJobs.length}
        selectMode={selectMode}
        onToggleSelectMode={() => setSelectMode(s => !s)}
      />

      {selectMode && (
        <SelectionBar
          selectedCount={selectedIds.size}
          totalVisible={filtered.length}
          workspaces={workspaces}
          activeWorkspaceId={activeWorkspaceId}
          onSelectAll={selectAllVisible}
          onClear={clearSelection}
          onExit={() => setSelectMode(false)}
          onMove={handleBulkMove}
          onChangeStatus={handleBulkStatus}
          onDelete={handleBulkDelete}
        />
      )}

      <JobList
        jobs={workspaceJobs}
        filtered={filtered}
        loading={loading}
        hasActiveFilters={filters.hasActiveFilters}
        canDrag={canDrag}
        canReorder={filters.sortBy === "custom"}
        selectMode={selectMode}
        selectedIds={selectedIds}
        onToggleSelect={toggleSelect}
        workspaces={workspaces}
        onEdit={openEditForm}
        onDelete={deleteJob}
        onMoveUp={(id) => moveJob(id, -1)}
        onMoveDown={(id) => moveJob(id, 1)}
        onReorder={reorderJobs}
        onChangeStatus={(id, status) => updateJob(id, { status })}
        onChangePriority={(id, priority) => updateJob(id, { priority })}
        onPin={pinJob}
        onMoveToBottom={moveJobBottom}
        onMoveToWorkspace={handleSingleMoveToWorkspace}
        resumeStatus={resumeStatus}
        onAddGenerated={addGeneratedDocument}
        onOpenGenerated={(fileName) => window.resume?.openPdf(fileName)}
        onRevealGenerated={(fileName) => window.resume?.revealGenerated(fileName)}
        onRemoveGenerated={removeGeneratedDocument}
        coverLetterSources={allCoverLetterSources({ jobs, generationHistory })}
      />

      {formState && (
        <JobForm
          key={formState.editId ?? "new"}
          initialForm={formState.initialForm}
          editId={formState.editId}
          workspaces={workspaces}
          quickAddNotice={quickAddNotice}
          onSubmit={submitForm}
          onCancel={closeForm}
          onDismissNotice={() => setQuickAddNotice("")}
        />
      )}

      {showSetup && <QuickAddSetup onClose={() => setShowSetup(false)} />}
      <QuickGenerateModal open={showQuickGenerate} status={resumeStatus} onClose={() => setShowQuickGenerate(false)} onAddHistory={addGenerationHistoryEntry} />

      {deletingWorkspace && (
        <DeleteWorkspaceDialog
          workspace={deletingWorkspace}
          jobCount={deletingWorkspaceJobCount}
          otherWorkspaces={otherWorkspaces}
          onConfirm={confirmDeleteWorkspace}
          onCancel={cancelDeleteWorkspace}
        />
      )}
        </>
      )}
    </div>
  );
}

// Bulk-action toolbar shown when selection mode is on. Each picker resets to
// its placeholder after firing so the same action can be reapplied.
function SelectionBar({
  selectedCount, totalVisible, workspaces, activeWorkspaceId,
  onSelectAll, onClear, onExit, onMove, onChangeStatus, onDelete,
}) {
  const targets = workspaces.filter(w => w.id !== activeWorkspaceId);
  const hasSelection = selectedCount > 0;
  const allSelected = selectedCount === totalVisible && totalVisible > 0;

  const handleMove = (e) => {
    const v = e.target.value;
    if (!v) return;
    onMove(Number(v));
    e.target.value = "";
  };

  const handleStatus = (e) => {
    const v = e.target.value;
    if (!v) return;
    onChangeStatus(v);
    e.target.value = "";
  };

  return (
    <div style={{
      position: "sticky", top: 0,
      display: "flex", alignItems: "center", gap: "10px",
      padding: "10px 32px", background: "#11142a",
      borderBottom: "1px solid #1a1a2e",
      flexWrap: "wrap",
    }}>
      <span style={{ fontSize: "13px", color: "#a5b4fc", fontWeight: 600, whiteSpace: "nowrap" }}>
        {selectedCount} selected
      </span>

      <span style={{ width: "1px", height: "20px", background: "#2a2a3e", margin: "0 4px" }} />

      <select
        onChange={handleMove}
        disabled={!hasSelection || targets.length === 0}
        defaultValue=""
        title={targets.length === 0 ? "No other workspaces" : "Move selected to workspace"}
        className="filter-select"
        style={{
          padding: "7px 10px", borderRadius: "6px", fontSize: "12px", fontWeight: 600,
          background: "#1a1f3a", color: "#a5b4fc", border: "1px solid #3b4486",
          cursor: hasSelection && targets.length > 0 ? "pointer" : "not-allowed",
          opacity: hasSelection && targets.length > 0 ? 1 : 0.5,
        }}>
        <option value="" disabled>Move to Workspace…</option>
        {targets.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
      </select>

      <select
        onChange={handleStatus}
        disabled={!hasSelection}
        defaultValue=""
        title="Change status of selected jobs"
        className="filter-select"
        style={{
          padding: "7px 10px", borderRadius: "6px", fontSize: "12px", fontWeight: 600,
          background: "#1a1f3a", color: "#a5b4fc", border: "1px solid #3b4486",
          cursor: hasSelection ? "pointer" : "not-allowed",
          opacity: hasSelection ? 1 : 0.5,
        }}>
        <option value="" disabled>Change Status…</option>
        {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
      </select>

      <button className="btn"
        onClick={onDelete}
        disabled={!hasSelection}
        style={{
          background: "#2d1010", color: "#f87171",
          padding: "7px 14px", borderRadius: "6px", fontSize: "12px", fontWeight: 600,
          border: "1px solid #5a2020",
          opacity: hasSelection ? 1 : 0.5,
          cursor: hasSelection ? "pointer" : "not-allowed",
        }}>
        Delete
      </button>

      <span style={{ width: "1px", height: "20px", background: "#2a2a3e", margin: "0 4px" }} />

      <button className="btn"
        onClick={allSelected ? onClear : onSelectAll}
        disabled={totalVisible === 0}
        style={{
          background: "transparent", color: "#94a3b8",
          padding: "7px 12px", borderRadius: "6px", fontSize: "12px", fontWeight: 600,
          border: "1px solid #2a2a3e",
        }}>
        {allSelected ? "Clear Selection" : `Select all (${totalVisible})`}
      </button>

      <button className="btn"
        onClick={onExit}
        style={{
          marginLeft: "auto",
          background: "transparent", color: "#94a3b8",
          padding: "7px 12px", borderRadius: "6px", fontSize: "12px", fontWeight: 600,
          border: "1px solid #2a2a3e",
        }}>
        Exit Select Mode
      </button>
    </div>
  );
}

// Confirmation dialog for workspace deletion. When the workspace has jobs,
// the user must explicitly choose: move the jobs to another workspace, or
// delete them along with the workspace.
function DeleteWorkspaceDialog({ workspace, jobCount, otherWorkspaces, onConfirm, onCancel }) {
  const [target, setTarget] = useState(otherWorkspaces[0]?.id ?? null);

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
      <div style={{ background: "#0e0e18", border: "1px solid #222233", borderRadius: "14px", width: "440px", maxWidth: "94vw", padding: "24px 26px" }}>
        <div style={{ fontFamily: "Syne, sans-serif", fontSize: "18px", fontWeight: 700, color: "#f1f5f9", marginBottom: "10px" }}>
          Delete "{workspace.name}"?
        </div>

        {jobCount === 0 ? (
          <div style={{ fontSize: "13px", color: "#94a3b8", lineHeight: 1.6, marginBottom: "20px" }}>
            This workspace has no jobs. It will be permanently removed.
          </div>
        ) : (
          <>
            <div style={{ fontSize: "13px", color: "#94a3b8", lineHeight: 1.6, marginBottom: "16px" }}>
              "{workspace.name}" contains <strong style={{ color: "#f1f5f9" }}>{jobCount} job{jobCount === 1 ? "" : "s"}</strong>. Choose what to do with them:
            </div>

            <label style={{ display: "block", fontSize: "12px", color: "#5a6070", letterSpacing: "0.06em", fontWeight: 600, marginBottom: "6px" }}>
              MOVE JOBS TO
            </label>
            <select
              value={target ?? ""}
              onChange={e => setTarget(Number(e.target.value))}
              className="form-select"
              style={{ width: "100%", marginBottom: "16px" }}>
              {otherWorkspaces.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </>
        )}

        <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
          <button className="btn"
            onClick={onCancel}
            style={{ background: "#1c1c2e", color: "#94a3b8", padding: "10px 18px", borderRadius: "8px", fontSize: "13px", fontWeight: 600 }}>
            Cancel
          </button>
          {jobCount > 0 && (
            <button className="btn"
              onClick={() => { if (confirm(`Permanently delete "${workspace.name}" AND its ${jobCount} job(s)? This cannot be undone.`)) onConfirm(null); }}
              style={{ background: "#2d1010", color: "#f87171", padding: "10px 18px", borderRadius: "8px", fontSize: "13px", fontWeight: 600 }}>
              Delete jobs too
            </button>
          )}
          <button className="btn"
            onClick={() => onConfirm(jobCount > 0 ? target : null)}
            disabled={jobCount > 0 && target == null}
            style={{ background: "#6366f1", color: "#fff", padding: "10px 18px", borderRadius: "8px", fontSize: "13px", fontWeight: 600 }}>
            {jobCount > 0 ? "Move & Delete" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}
