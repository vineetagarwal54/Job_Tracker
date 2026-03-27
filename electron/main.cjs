const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");

// ── File-based storage ────────────────────────────────────────
// Stores all data in %APPDATA%/JobTrack/data.json
// Survives reinstalls, works across browsers (same Electron app)
function getDataPath() {
  const dir = path.join(app.getPath("userData"));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "data.json");
}

function readStore() {
  try {
    const raw = fs.readFileSync(getDataPath(), "utf-8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function writeStore(data) {
  fs.writeFileSync(getDataPath(), JSON.stringify(data, null, 2), "utf-8");
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
      const store = readStore();
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
