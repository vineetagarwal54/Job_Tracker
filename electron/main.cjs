const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const { execFile } = require("child_process");

// ── File-based storage ────────────────────────────────────────
// Stores all data in the OS-appropriate userData directory:
//   Windows: %APPDATA%/JobTrack/data.json
//   macOS:   ~/Library/Application Support/JobTrack/data.json
//   Linux:   ~/.config/JobTrack/data.json
// Survives reinstalls and is per-user.

const { autoUpdater } = require("electron-updater");

const PROTOCOL = "jobtrack";
const NATIVE_HOST_FLAG = "--native-messaging-host";
const NATIVE_HOST_NAME = "com.vineet.jobtrack";
const APP_DATA_KEY = "app_data_v3";
const RESUME_TEMPLATE_FILE = path.resolve(__dirname, "..", "resume", "template", "main.tex");
const RESUME_OUTPUT_DIR = path.resolve(__dirname, "..", "resume", "output");
const PROFILE_FIELDS = [
  "name", "firstName", "lastName", "email", "phone", "address", "city", "state",
  "zip", "country", "linkedin", "github", "portfolio", "school", "degree", "major",
  "graduationDate", "workAuthorization", "sponsorship", "shortAnswerNotes",
];
const isNativeMessagingHost = process.argv.some((arg) =>
  arg === NATIVE_HOST_FLAG || arg.startsWith(`${NATIVE_HOST_FLAG}=`)
) || (process.stdin.isTTY === false && process.argv.length <= 1);

autoUpdater.autoDownload = false;

function checkForUpdates() {
  if (!app.isPackaged) return;

  autoUpdater.checkForUpdates();
}

autoUpdater.on("update-available", async () => {
  const result = await dialog.showMessageBox({
    type: "info",
    buttons: ["Update now", "Later"],
    defaultId: 0,
    cancelId: 1,
    title: "Update available",
    message: "A new version of JobTrack is available.",
    detail: "Do you want to download and install the update now?"
  });

  if (result.response === 0) {
    autoUpdater.downloadUpdate();
  }
});

autoUpdater.on("update-downloaded", async () => {
  const result = await dialog.showMessageBox({
    type: "info",
    buttons: ["Restart and install", "Later"],
    defaultId: 0,
    cancelId: 1,
    title: "Update ready",
    message: "The update has been downloaded.",
    detail: "Restart JobTrack to install the latest version."
  });

  if (result.response === 0) {
    autoUpdater.quitAndInstall();
  }
});

autoUpdater.on("error", (error) => {
  console.error("Auto update error:", error);
});

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
if (process.defaultApp) {
  app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [
    path.resolve(process.argv[1]),
  ]);
} else {
  app.setAsDefaultProtocolClient(PROTOCOL);
}

// ── Single instance ──────────────────────────────────────────
function getDefaultProfile() {
  const store = readStore();
  const raw = store[APP_DATA_KEY];
  if (!raw) return null;
  let appData;
  try {
    appData = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
  const profiles = Array.isArray(appData?.applicationProfiles)
    ? appData.applicationProfiles
    : [];
  const profile = profiles.find((candidate) => candidate?.isDefault === true);
  if (!profile) return null;
  return PROFILE_FIELDS.reduce((safeProfile, field) => {
    if (profile[field] != null) safeProfile[field] = profile[field];
    return safeProfile;
  }, {});
}

function isWithinDirectory(candidate, directory) {
  const relative = path.relative(directory, candidate);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function compileResumeTex(fileName) {
  if (typeof fileName !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*\.tex$/i.test(fileName)) {
    return Promise.resolve({ ok: false, error: { code: "INVALID_OUTPUT_PATH", message: "Choose a safe generated .tex filename." } });
  }
  if (!fs.existsSync(RESUME_TEMPLATE_FILE)) {
    return Promise.resolve({ ok: false, error: { code: "MISSING_TEMPLATE", message: "The resume template is missing." } });
  }
  const texPath = path.resolve(RESUME_OUTPUT_DIR, fileName);
  if (!isWithinDirectory(texPath, RESUME_OUTPUT_DIR) || !fs.existsSync(texPath)) {
    return Promise.resolve({ ok: false, error: { code: "INVALID_OUTPUT_PATH", message: "The generated .tex file is not available in resume/output." } });
  }
  const pdfPath = path.join(RESUME_OUTPUT_DIR, `${path.basename(fileName, ".tex")}.pdf`);
  return new Promise((resolve) => {
    execFile("tectonic", [texPath, "--outdir", RESUME_OUTPUT_DIR], {
      cwd: RESUME_OUTPUT_DIR,
      windowsHide: true,
      timeout: 120000,
      maxBuffer: 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error?.code === "ENOENT") {
        resolve({ ok: false, error: { code: "TECTONIC_NOT_FOUND", message: "Tectonic was not found on PATH." } });
        return;
      }
      if (error) {
        resolve({ ok: false, error: { code: "COMPILATION_FAILED", message: stderr || stdout || error.message } });
        return;
      }
      if (!fs.existsSync(pdfPath) || !isWithinDirectory(pdfPath, RESUME_OUTPUT_DIR)) {
        resolve({ ok: false, error: { code: "INVALID_OUTPUT_PATH", message: "Tectonic did not create a PDF in resume/output." } });
        return;
      }
      resolve({ ok: true, fileName, pdfFileName: path.basename(pdfPath), stdout, stderr });
    });
  });
}

function writeNativeMessage(message) {
  const payload = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length, 0);
  process.stdout.write(Buffer.concat([header, payload]));
}

function runNativeMessagingHost() {
  let buffer = Buffer.alloc(0);
  let handled = false;
  process.stdin.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    if (handled || buffer.length < 4) return;
    const length = buffer.readUInt32LE(0);
    if (length > 1024 * 1024 || buffer.length < length + 4) return;
    handled = true;
    let request;
    try {
      request = JSON.parse(buffer.subarray(4, length + 4).toString("utf8"));
    } catch {
      writeNativeMessage({ ok: false, error: "Invalid native messaging request." });
      return;
    }
    if (request?.type !== "GET_DEFAULT_PROFILE") {
      writeNativeMessage({ ok: false, error: "Unsupported JobTrack request." });
      return;
    }
    try {
      const profile = getDefaultProfile();
      writeNativeMessage(profile
        ? { ok: true, profile }
        : { ok: false, error: "No default JobTrack application profile exists." });
    } catch (error) {
      writeNativeMessage({ ok: false, error: "JobTrack could not read its profile." });
      console.error(`[${NATIVE_HOST_NAME}]`, error);
    }
  });
}

const gotLock = isNativeMessagingHost || app.requestSingleInstanceLock();
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

  function createWindow() {
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

    ipcMain.handle("resume:compile", (_event, fileName) => compileResumeTex(fileName));

    // Once the renderer signals it's ready, flush any pending deep link
    ipcMain.on("renderer-ready", () => {
      if (pendingDeepLink) {
        sendQuickAdd(pendingDeepLink);
        pendingDeepLink = null;
      }
    });

    handleArgv(process.argv);
  }

  app.whenReady().then(() => {
    if (isNativeMessagingHost) {
      runNativeMessagingHost();
      return;
    }
    createWindow();
    checkForUpdates();
  });

  app.on("window-all-closed", () => {
    app.quit();
  });
}
