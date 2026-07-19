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
});
