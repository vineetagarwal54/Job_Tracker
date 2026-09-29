const { contextBridge, ipcRenderer } = require("electron");

// Storage backed by a JSON file on disk (via main process IPC)
// Data lives in the OS userData directory (per-user) — survives reinstalls
contextBridge.exposeInMainWorld("storage", {
  get: (key) => ipcRenderer.invoke("storage:get", key),
  set: (key, value) => ipcRenderer.invoke("storage:set", key, value),
});

contextBridge.exposeInMainWorld("electronAPI", {
  onQuickAdd: (callback) => {
    ipcRenderer.on("quick-add", (_event, params) => callback(params));
  },
  signalReady: () => {
    ipcRenderer.send("renderer-ready");
  },
});

// GitHub sync — fixed, narrow API. The token can be sent in via saveConfig
// but is never returned; status only reports whether one is configured.
contextBridge.exposeInMainWorld("githubSync", {
  getStatus: () => ipcRenderer.invoke("github-sync:get-status"),
  saveConfig: (config) => ipcRenderer.invoke("github-sync:save-config", config),
  removeToken: () => ipcRenderer.invoke("github-sync:remove-token"),
  testConnection: () => ipcRenderer.invoke("github-sync:test"),
  syncNow: () => ipcRenderer.invoke("github-sync:sync-now"),
  onStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("github-sync:status", listener);
    return () => ipcRenderer.removeListener("github-sync:status", listener);
  },
});

// Resume tailor — takes only job ids and a doc type ("resume" | "cover" |
// "base" | "log"); paths and commands are resolved in the main process.
contextBridge.exposeInMainWorld("tailor", {
  generate: (jobIds, docTypes) => ipcRenderer.invoke("tailor:generate", jobIds, docTypes),
  cancel: (jobId) => ipcRenderer.invoke("tailor:cancel", jobId),
  openFile: (jobId, docType) => ipcRenderer.invoke("tailor:open", jobId, docType),
  showInFolder: (jobId, docType) => ipcRenderer.invoke("tailor:show", jobId, docType),
  startDrag: (jobId, docType) => ipcRenderer.send("tailor:start-drag", jobId, docType),
  getState: () => ipcRenderer.invoke("tailor:get-state"),
  onStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("tailor:status", listener);
    return () => ipcRenderer.removeListener("tailor:status", listener);
  },
});
