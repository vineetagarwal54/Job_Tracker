const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");

// ── File-based storage ────────────────────────────────────────
// Stores all data in the OS-appropriate userData directory:
//   Windows: %APPDATA%/JobTrack/data.json
//   macOS:   ~/Library/Application Support/JobTrack/data.json
//   Linux:   ~/.config/JobTrack/data.json
// Survives reinstalls and is per-user.
function getDataPath() {
  const dir = path.join(app.getPath("userData"));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "data.json");
}

function readStore() {
  const dataPath = getDataPath();
  if (!fs.existsSync(dataPath)) return {};
  try {
    const raw = fs.readFileSync(dataPath, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    console.error("[JobTrack] Failed to read data.json:", err);
    // Back up corrupted file so a save doesn't overwrite recoverable data
    try {
      const backup = `${dataPath}.corrupted-${Date.now()}`;
      fs.copyFileSync(dataPath, backup);
      console.error("[JobTrack] Backed up corrupted file to:", backup);
    } catch (backupErr) {
      console.error("[JobTrack] Failed to back up corrupted file:", backupErr);
    }
    // Re-throw so renderer sees the error instead of getting an empty store
    throw err;
  }
}

function writeStore(data) {
  const dataPath = getDataPath();
  // Atomic write: write to temp file, then rename, so a crash mid-write
  // cannot leave a truncated/corrupt data.json
  const tmp = `${dataPath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  fs.renameSync(tmp, dataPath);
}

// ── Custom protocol ──────────────────────────────────────────
const PROTOCOL = "jobtrack";
if (process.defaultApp) {
  app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [
    path.resolve(process.argv[1]),
  ]);
} else {
  app.setAsDefaultProtocolClient(PROTOCOL);
}

// ── Single instance ──────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  let mainWindow = null;
  let pendingDeepLink = null;

  function parseDeepLink(url) {
    if (!url || !url.startsWith(`${PROTOCOL}://`)) return null;
    try {
      const parsed = new URL(url);
      const params = Object.fromEntries(parsed.searchParams.entries());
      if (Object.keys(params).length > 0) return params;
    } catch {}
    return null;
  }

  function sendQuickAdd(params) {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send("quick-add", params);
    mainWindow.show();
    mainWindow.focus();
  }

  function handleArgv(argv) {
    const deepLink = argv.find((a) => a.startsWith(`${PROTOCOL}://`));
    const params = parseDeepLink(deepLink);
    if (params) {
      if (mainWindow) sendQuickAdd(params);
      else pendingDeepLink = params;
    }
  }

  app.on("second-instance", (_e, argv) => {
    handleArgv(argv);
  });

  app.on("open-url", (event, url) => {
    event.preventDefault();
    const params = parseDeepLink(url);
    if (params) {
      if (mainWindow) sendQuickAdd(params);
      else pendingDeepLink = params;
    }
  });

  app.whenReady().then(() => {
    const isDev = !app.isPackaged;

    mainWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      title: "JobTrack",
      backgroundColor: "#0b0b12",
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    if (isDev) {
      mainWindow.loadURL("http://localhost:5173");
    } else {
      mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
    }

    mainWindow.on("closed", () => {
      mainWindow = null;
    });

    // ── Storage IPC handlers ──────────────────────────────────
    ipcMain.handle("storage:get", (_event, key) => {
      const store = readStore();
      return store[key] !== undefined ? { value: store[key] } : null;
    });

    ipcMain.handle("storage:set", (_event, key, value) => {
      // If the existing store is corrupt, readStore throws and has already
      // backed up the bad file. Start fresh so the write can succeed.
      let store;
      try { store = readStore(); } catch { store = {}; }
      store[key] = value;
      writeStore(store);
    });

    // Once the renderer signals it's ready, flush any pending deep link
    ipcMain.on("renderer-ready", () => {
      if (pendingDeepLink) {
        sendQuickAdd(pendingDeepLink);
        pendingDeepLink = null;
      }
    });

    handleArgv(process.argv);
  });

  app.on("window-all-closed", () => {
    app.quit();
  });
}
