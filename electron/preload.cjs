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
  status: () => ipcRenderer.invoke("resume:status"),
  keyStatus: () => ipcRenderer.invoke("resume:key-status"),
  testApiKey: () => ipcRenderer.invoke("resume:key-test"),
  checkTectonic: () => ipcRenderer.invoke("resume:check-tectonic"),
  generate: (job) => ipcRenderer.invoke("resume:generate", job),
  generateCoverLetter: (input) => ipcRenderer.invoke("resume:generate-cover-letter", input),
  cancelGeneration: () => ipcRenderer.invoke("resume:cancel-generation"),
  openPdf: (fileName) => ipcRenderer.invoke("resume:open-generated", fileName),
  revealGenerated: (fileName) => ipcRenderer.invoke("resume:reveal-generated", fileName),
  saveCopy: (input) => ipcRenderer.invoke("resume:save-copy", input),
  saveBoth: (input) => ipcRenderer.invoke("resume:save-both", input),
  pickLocalPdf: () => ipcRenderer.invoke("resume:pick-local-pdf"),
  openOutputFolder: () => ipcRenderer.invoke("resume:open-output-folder"),
  onGenerationEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("resume:generation-event", listener);
    return () => ipcRenderer.removeListener("resume:generation-event", listener);
  },
});
