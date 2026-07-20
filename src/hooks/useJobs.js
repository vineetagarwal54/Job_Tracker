import { useState, useEffect, useCallback, useRef } from "react";
import { sampleJobs } from "../constants";
import { loadAppData, persistAppData, downloadJobsAsJson, pickJobsFile } from "../utils/storageHelpers";

const DEFAULT_WORKSPACE_NAME = "Internships";

// Owns the full app state: workspaces, the active workspace, and the jobs list.
// All persistence flows through `save`, which writes the full app-data blob
// atomically. Job-ordering operations (move/pin/reorder) are workspace-aware
// so reordering inside one workspace can't perturb another's order.
export function useJobs() {
  const [appData, setAppData] = useState({ workspaces: [], activeWorkspaceId: null, jobs: [], applicationProfiles: [], generationHistory: [] });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [toast, setToast] = useState(null);
  const appDataRef = useRef(appData);

  const { workspaces, activeWorkspaceId, jobs, applicationProfiles, generationHistory } = appData;

  useEffect(() => {
    (async () => {
      try {
        const loaded = await loadAppData();
        if (loaded) {
          appDataRef.current = loaded;
          setAppData(loaded);
        } else {
          // First-ever launch: seed with sample jobs in a default workspace.
          const ws = { id: Date.now(), name: DEFAULT_WORKSPACE_NAME };
          const seeded = {
            workspaces: [ws],
            activeWorkspaceId: ws.id,
            jobs: sampleJobs.map(j => ({ ...j, workspaceId: ws.id })),
            applicationProfiles: [],
            generationHistory: [],
          };
          appDataRef.current = seeded;
          setAppData(seeded);
        }
      } catch (err) {
        console.error("Failed to load app data:", err);
        setLoadError("Couldn't load your saved data. Your data file may be corrupted — a backup copy has been saved. Check the app's data folder before adding new jobs.");
      }
      setLoading(false);
    })();
  }, []);

  const save = useCallback(async (updates) => {
    if (loadError) {
      setToast({ message: "Can't save: unresolved load error. Restart the app or check your data folder.", type: "error" });
      return;
    }
    const current = appDataRef.current;
    const resolvedUpdates = typeof updates === "function" ? updates(current) : updates;
    const next = { ...current, ...resolvedUpdates };
    appDataRef.current = next;
    setAppData(next);
    try {
      await persistAppData(next);
    } catch (err) {
      console.error("Failed to save:", err);
      setToast({ message: "Failed to save changes. Try exporting a backup.", type: "error" });
    }
  }, [loadError]);

  // Job CRUD -----------------------------------------------------------------

  const addJob = useCallback((job) => {
    const wsId = job.workspaceId ?? activeWorkspaceId;
    save({ jobs: [...jobs, { ...job, id: Date.now(), workspaceId: wsId }] });
  }, [jobs, activeWorkspaceId, save]);

  const updateJob = useCallback((id, updates) => {
    save({ jobs: jobs.map(j => j.id === id ? { ...j, ...updates, id } : j) });
  }, [jobs, save]);

  const deleteJob = useCallback((id) => {
    save({ jobs: jobs.filter(j => j.id !== id) });
  }, [jobs, save]);

  // Ordering — workspace-scoped so reordering stays inside the current workspace.

  const moveJob = useCallback((id, dir) => {
    const job = jobs.find(j => j.id === id);
    if (!job) return;
    const wsJobs = jobs.filter(j => j.workspaceId === job.workspaceId);
    const wsIdx = wsJobs.findIndex(j => j.id === id);
    const targetWsIdx = wsIdx + dir;
    if (targetWsIdx < 0 || targetWsIdx >= wsJobs.length) return;
    const fromIdx = jobs.indexOf(wsJobs[wsIdx]);
    const toIdx = jobs.indexOf(wsJobs[targetWsIdx]);
    const updated = [...jobs];
    [updated[fromIdx], updated[toIdx]] = [updated[toIdx], updated[fromIdx]];
    save({ jobs: updated });
  }, [jobs, save]);

  const pinJob = useCallback((id) => {
    const job = jobs.find(j => j.id === id);
    if (!job) return;
    const firstWsIdx = jobs.findIndex(j => j.workspaceId === job.workspaceId);
    const jobIdx = jobs.findIndex(j => j.id === id);
    if (jobIdx <= firstWsIdx) return;
    const updated = [...jobs];
    const [moved] = updated.splice(jobIdx, 1);
    updated.splice(firstWsIdx, 0, moved);
    save({ jobs: updated });
  }, [jobs, save]);

  const moveJobBottom = useCallback((id) => {
    const job = jobs.find(j => j.id === id);
    if (!job) return;
    const wsJobs = jobs.filter(j => j.workspaceId === job.workspaceId);
    const lastWsJob = wsJobs[wsJobs.length - 1];
    const lastWsIdx = jobs.findIndex(j => j.id === lastWsJob.id);
    const jobIdx = jobs.findIndex(j => j.id === id);
    if (jobIdx >= lastWsIdx) return;
    const updated = [...jobs];
    const [moved] = updated.splice(jobIdx, 1);
    updated.splice(lastWsIdx, 0, moved);
    save({ jobs: updated });
  }, [jobs, save]);

  const reorderJobs = useCallback((fromId, toId) => {
    if (fromId === toId) return;
    const fromIdx = jobs.findIndex(j => j.id === fromId);
    const toIdx = jobs.findIndex(j => j.id === toId);
    if (fromIdx === -1 || toIdx === -1) return;
    const updated = [...jobs];
    const [moved] = updated.splice(fromIdx, 1);
    updated.splice(toIdx, 0, moved);
    save({ jobs: updated });
  }, [jobs, save]);

  // Workspace operations ------------------------------------------------------

  const switchWorkspace = useCallback((id) => {
    if (id === activeWorkspaceId) return;
    save({ activeWorkspaceId: id });
  }, [activeWorkspaceId, save]);

  const addWorkspace = useCallback((name) => {
    const trimmed = (name || "").trim();
    if (!trimmed) return;
    const ws = { id: Date.now(), name: trimmed };
    save({ workspaces: [...workspaces, ws], activeWorkspaceId: ws.id });
  }, [workspaces, save]);

  const renameWorkspace = useCallback((id, name) => {
    const trimmed = (name || "").trim();
    if (!trimmed) return;
    save({ workspaces: workspaces.map(w => w.id === id ? { ...w, name: trimmed } : w) });
  }, [workspaces, save]);

  // If `targetWorkspaceId` is given, jobs move there. Otherwise jobs in the
  // deleted workspace are removed too. Caller is responsible for confirming.
  const deleteWorkspace = useCallback((id, targetWorkspaceId = null) => {
    if (workspaces.length <= 1) return;
    const remaining = workspaces.filter(w => w.id !== id);
    const newActiveId = id === activeWorkspaceId ? remaining[0].id : activeWorkspaceId;
    const updatedJobs = targetWorkspaceId
      ? jobs.map(j => j.workspaceId === id ? { ...j, workspaceId: targetWorkspaceId } : j)
      : jobs.filter(j => j.workspaceId !== id);
    save({ workspaces: remaining, activeWorkspaceId: newActiveId, jobs: updatedJobs });
  }, [workspaces, jobs, activeWorkspaceId, save]);

  const moveJobsToWorkspace = useCallback((jobIds, targetWorkspaceId) => {
    const idSet = new Set(jobIds);
    save({ jobs: jobs.map(j => idSet.has(j.id) ? { ...j, workspaceId: targetWorkspaceId } : j) });
  }, [jobs, save]);

  const bulkUpdateJobs = useCallback((jobIds, updates) => {
    const idSet = new Set(jobIds);
    save({ jobs: jobs.map(j => idSet.has(j.id) ? { ...j, ...updates, id: j.id } : j) });
  }, [jobs, save]);

  const bulkDeleteJobs = useCallback((jobIds) => {
    const idSet = new Set(jobIds);
    save({ jobs: jobs.filter(j => !idSet.has(j.id)) });
  }, [jobs, save]);

  const reorderWorkspaces = useCallback((fromId, toId) => {
    if (fromId === toId) return;
    const fromIdx = workspaces.findIndex(w => w.id === fromId);
    const toIdx = workspaces.findIndex(w => w.id === toId);
    if (fromIdx === -1 || toIdx === -1) return;
    const updated = [...workspaces];
    const [moved] = updated.splice(fromIdx, 1);
    updated.splice(toIdx, 0, moved);
    save({ workspaces: updated });
  }, [workspaces, save]);

  // Application Profiles ------------------------------------------------------
  // Profiles share the appData blob so writes don't race with job edits. The
  // shape is intentionally flat — a future Chrome extension can read profiles
  // verbatim for autofill without transformation.

  const addProfile = useCallback((profile) => {
    const isFirst = applicationProfiles.length === 0;
    const willBeDefault = isFirst || profile.isDefault === true;
    // Promote a new profile to default if it's the first one OR the form
    // explicitly marked it. When promoting, demote every other profile.
    const next = willBeDefault
      ? applicationProfiles.map(p => ({ ...p, isDefault: false }))
      : applicationProfiles;
    save({
      applicationProfiles: [...next, { ...profile, id: Date.now(), isDefault: willBeDefault }],
    });
  }, [applicationProfiles, save]);

  const updateProfile = useCallback((id, updates) => {
    // Treat isDefault=true in updates as "make this the only default."
    const promoting = updates.isDefault === true;
    save({
      applicationProfiles: applicationProfiles.map(p => {
        if (p.id === id) return { ...p, ...updates, id };
        return promoting ? { ...p, isDefault: false } : p;
      }),
    });
  }, [applicationProfiles, save]);

  const deleteProfile = useCallback((id) => {
    const removed = applicationProfiles.find(p => p.id === id);
    let next = applicationProfiles.filter(p => p.id !== id);
    // Always keep one default if any profiles remain.
    if (removed?.isDefault && next.length > 0) {
      next = next.map((p, i) => i === 0 ? { ...p, isDefault: true } : p);
    }
    save({ applicationProfiles: next });
  }, [applicationProfiles, save]);

  const setDefaultProfile = useCallback((id) => {
    save({
      applicationProfiles: applicationProfiles.map(p => ({ ...p, isDefault: p.id === id })),
    });
  }, [applicationProfiles, save]);

  const addGeneratedDocument = useCallback((jobId, document) => {
    save(current => ({ jobs: current.jobs.map(job => job.id === jobId ? { ...job, generatedDocuments: [...(job.generatedDocuments || []), document] } : job) }));
  }, [save]);

  const removeGeneratedDocument = useCallback((jobId, documentId) => {
    save(current => ({ jobs: current.jobs.map(job => job.id === jobId ? { ...job, generatedDocuments: (job.generatedDocuments || []).filter(document => document.id !== documentId) } : job) }));
  }, [save]);

  const addGenerationHistoryEntry = useCallback((entry) => {
    save(current => ({ generationHistory: [...(current.generationHistory || []), entry] }));
  }, [save]);

  const removeGenerationHistoryEntry = useCallback((id) => {
    save(current => ({ generationHistory: (current.generationHistory || []).filter(entry => entry.id !== id) }));
  }, [save]);

  // Import / export -----------------------------------------------------------

  const exportJobs = useCallback(() => {
    const active = workspaces.find(w => w.id === activeWorkspaceId);
    const wsJobs = jobs.filter(j => j.workspaceId === activeWorkspaceId);
    downloadJobsAsJson(wsJobs, active?.name);
  }, [jobs, workspaces, activeWorkspaceId]);

  const importJobs = useCallback(async () => {
    try {
      const imported = await pickJobsFile();
      if (imported === null) return;
      if (!Array.isArray(imported)) {
        setToast({ message: "Invalid format: expected an array of jobs.", type: "error" });
        return;
      }
      const existingIds = new Set(jobs.map(j => j.id));
      // Imported jobs without a workspaceId (or pointing at a workspace that no
      // longer exists) land in the active workspace.
      const validWsIds = new Set(workspaces.map(w => w.id));
      const stamp = (j) => ({
        ...j,
        workspaceId: j.workspaceId && validWsIds.has(j.workspaceId) ? j.workspaceId : activeWorkspaceId,
      });
      const newJobs = imported.filter(j => !existingIds.has(j.id)).map(stamp);
      if (newJobs.length === 0 && imported.length > 0) {
        if (confirm(`All ${imported.length} jobs already exist. Replace this workspace's jobs with the imported file?`)) {
          // Replace only the active workspace's jobs; other workspaces stay intact.
          const otherJobs = jobs.filter(j => j.workspaceId !== activeWorkspaceId);
          save({ jobs: [...otherJobs, ...imported.map(stamp)] });
          setToast({ message: `Replaced workspace with ${imported.length} imported job(s).`, type: "success" });
        }
      } else {
        save({ jobs: [...jobs, ...newJobs] });
        const dupes = imported.length - newJobs.length;
        setToast({
          message: `Imported ${newJobs.length} new job(s)${dupes > 0 ? ` · ${dupes} duplicate(s) skipped` : ""}.`,
          type: "success",
        });
      }
    } catch (err) {
      console.error("Import failed:", err);
      setToast({ message: "Failed to read file. Make sure it's a valid JSON export.", type: "error" });
    }
  }, [jobs, workspaces, activeWorkspaceId, save]);

  return {
    jobs, workspaces, activeWorkspaceId,
    loading, loadError,
    toast, setToast,
    addJob, updateJob, deleteJob,
    moveJob, pinJob, moveJobBottom, reorderJobs,
    exportJobs, importJobs,
    switchWorkspace, addWorkspace, renameWorkspace, deleteWorkspace, reorderWorkspaces,
    moveJobsToWorkspace, bulkUpdateJobs, bulkDeleteJobs,
    applicationProfiles,
    addProfile, updateProfile, deleteProfile, setDefaultProfile,
    addGeneratedDocument, removeGeneratedDocument,
    generationHistory, addGenerationHistoryEntry, removeGenerationHistoryEntry,
  };
}
