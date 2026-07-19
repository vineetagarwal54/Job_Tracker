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

contextBridge.exposeInMainWorld("resume", {
  compile: (fileName) => ipcRenderer.invoke("resume:compile", fileName),
  keyStatus: () => ipcRenderer.invoke("resume:key-status"),
  saveApiKey: (key, options) => ipcRenderer.invoke("resume:key-save", key, options),
  deleteApiKey: () => ipcRenderer.invoke("resume:key-delete"),
  testApiKey: () => ipcRenderer.invoke("resume:key-test"),
  analyzeJob: (job) => ipcRenderer.invoke("resume:analyze-job", job),
  generate: (job) => ipcRenderer.invoke("resume:generate", job),
  cancelGeneration: () => ipcRenderer.invoke("resume:cancel-generation"),
  onGenerationEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("resume:generation-event", listener);
    return () => ipcRenderer.removeListener("resume:generation-event", listener);
  },
});
