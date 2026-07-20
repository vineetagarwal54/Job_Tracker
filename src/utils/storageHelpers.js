const LEGACY_KEY = "jobs_v2";
const APP_DATA_KEY = "app_data_v3";

const DEFAULT_WORKSPACE_NAME = "Internships";

// Returns { workspaces, activeWorkspaceId, jobs, applicationProfiles } — null
// if no saved data exists. On first run with legacy data, transparently migrates
// old jobs into a default "Internships" workspace so no data is lost. Older
// saves missing newer fields (e.g. applicationProfiles) are normalized on load.
export async function loadAppData() {
  const result = await window.storage.get(APP_DATA_KEY);
  if (result) return normalizeAppData(JSON.parse(result.value));

  // Migration path: legacy jobs_v2 (Electron storage)
  const legacyResult = await window.storage.get(LEGACY_KEY);
  if (legacyResult) {
    const oldJobs = JSON.parse(legacyResult.value);
    return migrateLegacyJobs(oldJobs);
  }

  // Migration path: legacy jobs_v2 (browser localStorage)
  const legacyLocal = localStorage.getItem(LEGACY_KEY);
  if (legacyLocal) {
    const oldJobs = JSON.parse(legacyLocal);
    return migrateLegacyJobs(oldJobs);
  }

  return null;
}

// Fills in defaults for any fields a saved blob is missing, so adding new
// top-level fields stays backward-compatible without one-off migrations.
function normalizeAppData(data) {
  return {
    workspaces: data.workspaces ?? [],
    activeWorkspaceId: data.activeWorkspaceId ?? null,
    jobs: (data.jobs ?? []).map(job => ({ ...job, generatedDocuments: Array.isArray(job.generatedDocuments) ? job.generatedDocuments : [] })),
    applicationProfiles: data.applicationProfiles ?? [],
    generationHistory: Array.isArray(data.generationHistory) ? data.generationHistory : [],
  };
}

async function migrateLegacyJobs(oldJobs) {
  const ws = { id: Date.now(), name: DEFAULT_WORKSPACE_NAME };
  const migrated = {
    workspaces: [ws],
    activeWorkspaceId: ws.id,
    jobs: (oldJobs || []).map(j => ({ ...j, workspaceId: ws.id })),
    applicationProfiles: [],
    generationHistory: [],
  };
  await window.storage.set(APP_DATA_KEY, JSON.stringify(migrated));
  return migrated;
}

export async function persistAppData(data) {
  await window.storage.set(APP_DATA_KEY, JSON.stringify(data));
}

// Exports the jobs in the current workspace as a JSON array (kept as flat array
// for backward compatibility with existing exports).
export function downloadJobsAsJson(jobs, workspaceName) {
  const blob = new Blob([JSON.stringify(jobs, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const safeName = (workspaceName || "jobtrack").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  a.download = `${safeName}-export.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// Opens a native file picker and resolves with the parsed JSON array.
// Resolves with null if the user cancels; rejects if the file can't be parsed.
export function pickJobsFile() {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async (e) => {
      const file = e.target.files?.[0];
      if (!file) return resolve(null);
      try {
        const text = await file.text();
        resolve(JSON.parse(text));
      } catch (err) {
        reject(err);
      }
    };
    input.click();
  });
}
