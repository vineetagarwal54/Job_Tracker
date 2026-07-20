const { app, BrowserWindow, ipcMain, dialog, safeStorage, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const { createAnthropicClient } = require("./anthropic/apiClient.cjs");
const { createKeyStore } = require("./anthropic/keyStore.cjs");
const { analyzeJob } = require("./anthropic/analyzeJob.cjs");
const { createOrchestrator } = require("./anthropic/orchestrator.cjs");
const { createActiveGenerations } = require("./anthropic/activeGenerations.cjs");
const { createCoverLetterOrchestrator } = require("./anthropic/coverLetterOrchestrator.cjs");
const { MODELS } = require("./anthropic/models.cjs");
const { resolveAnthropicEnvironment } = require("./config/environment.cjs");
const { createResumePaths } = require("./resume/paths.cjs");
const { checkTectonic, compileGeneratedTex } = require("./resume/compiler.cjs");

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
const PROFILE_FIELDS = [
  "name", "fullName", "firstName", "lastName", "email", "phone", "address", "city", "state",
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

function serializeResumeError(error) {
  const safeMessages = {
    KEY_NOT_CONFIGURED: "Add ANTHROPIC_API_KEY to the root .env file and restart JobTrack.", authentication_error: "Anthropic rejected the configured API key.", permission_error: "The configured Anthropic key does not have permission for this request.", rate_limit_error: "Anthropic rate limit reached. Try again shortly.", TIMEOUT: "The Anthropic request timed out.", NETWORK_ERROR: "JobTrack could not reach Anthropic.", CANCELLED: "Generation cancelled.", GENERATION_ACTIVE: "Another generation is already active.", TECTONIC_NOT_FOUND: "Tectonic was not found on PATH.", COMPILATION_FAILED: "Tectonic could not compile the generated document.", MISSING_TEMPLATE: "The document template is missing.", INVALID_OUTPUT_PATH: "The generated file path was rejected.", MISSING_PROFILE: "No valid resume identity is available in the Application Profile or content bank.", MISSING_JOB_DESCRIPTION: "Save a full job description before generating.", MALFORMED_RESPONSE: "Anthropic returned an unreadable response.", VALIDATION_FAILED: error?.message || "Generated content failed factual validation.",
  };
  const code = error?.code || "RESUME_ERROR";
  return { code, message: safeMessages[code] || "Resume generation failed.", status: error?.status || null, retryable: Boolean(error?.retryable) };
}

function registerResumeIpc() {
  const rootDir = app.getAppPath();
  const paths = createResumePaths({ app, rootDir });
  const keyStore = createKeyStore({ safeStorage, userDataPath: app.getPath("userData") });
  const environment = resolveAnthropicEnvironment({ isPackaged: app.isPackaged, executablePath: process.execPath, projectRoot: rootDir });
  const keyProvider = {
    readKey: () => environment.key || keyStore.readKey(),
    status: () => environment.configured ? { configured: true, source: "environment" } : { ...keyStore.status(), source: keyStore.status().configured ? "safeStorage" : "environment" },
  };
  const client = createAnthropicClient();
  const generateDir = path.join(rootDir, "src", "generate");
  const compileResumeTex = (fileName) => compileGeneratedTex(paths, fileName);
  const orchestrate = createOrchestrator({ rootDir, client, keyProvider, getDefaultProfile, compileResumeTex, paths });
  const orchestrateCoverLetter = createCoverLetterOrchestrator({ rootDir, client, keyProvider, getDefaultProfile, compileResumeTex, paths });
  const active = createActiveGenerations();
  ipcMain.handle("resume:key-status", () => keyProvider.status());
  ipcMain.handle("resume:status", async () => ({ api: keyProvider.status(), tectonic: await checkTectonic(), outputDisplayPath: paths.displayPath, models: MODELS }));
  ipcMain.handle("resume:key-test", async () => {
    try {
      await client.request({ apiKey: keyProvider.readKey(), body: { model: MODELS.analysis, max_tokens: 1, messages: [{ role: "user", content: "Reply OK" }] } });
      return { ok: true, model: MODELS.analysis };
    } catch (error) { return { ok: false, error: serializeResumeError(error) }; }
  });
  ipcMain.handle("resume:analyze-job", async (_event, job) => {
    try { const result = await analyzeJob({ client, apiKey: keyProvider.readKey(), job, generateDir }); return { ok: true, ...result }; }
    catch (error) { return { ok: false, error: serializeResumeError(error) }; }
  });
  ipcMain.handle("resume:generate", async (event, job) => {
    const owner = event.sender.id;
    const controller = active.start(owner);
    if (!controller) return { ok: false, error: { code: "GENERATION_ACTIVE", message: "A resume generation is already running for this window." } };
    const send = (type, message, result) => { if (!event.sender.isDestroyed()) event.sender.send("resume:generation-event", { type, message, result }); };
    send("started", "Analyzing job requirements");
    try { const result = await orchestrate({ job, signal: controller.signal, progress: (message) => send("progress", message) }); send("completed", "Resume completed", result); return { ok: true, result }; }
    catch (error) { const cancelled = error?.code === "CANCELLED" || controller.signal.aborted; send(cancelled ? "cancelled" : "failed", cancelled ? "Resume generation cancelled" : error.message); return { ok: false, error: serializeResumeError(cancelled ? Object.assign(new Error("Resume generation cancelled."), { code: "CANCELLED" }) : error) }; }
    finally { active.finish(owner); }
  });
  ipcMain.handle("resume:generate-cover-letter", async (event, input) => {
    const owner = event.sender.id; const controller = active.start(owner);
    if (!controller) return { ok: false, error: { code: "GENERATION_ACTIVE", message: "Another generation is already active." } };
    const send = (type, message, result) => { if (!event.sender.isDestroyed()) event.sender.send("resume:generation-event", { type, message, result, documentType: "cover-letter" }); };
    send("started", "Preparing cover letter");
    try { const result = await orchestrateCoverLetter({ ...input, signal: controller.signal, progress: (message) => send("progress", message) }); send("completed", "Cover letter completed", result); return { ok: true, result }; }
    catch (error) { const cancelled = error?.code === "CANCELLED" || controller.signal.aborted; const safe = cancelled ? Object.assign(new Error("Generation cancelled."), { code: "CANCELLED" }) : error; send(cancelled ? "cancelled" : "failed", serializeResumeError(safe).message); return { ok: false, error: serializeResumeError(safe) }; }
    finally { active.finish(owner); }
  });
  ipcMain.handle("resume:cancel-generation", (event) => active.cancel(event.sender.id) ? { ok: true } : { ok: false, message: "No resume generation is active." });
  ipcMain.handle("resume:compile", (_event, fileName) => compileResumeTex(fileName));
  ipcMain.handle("resume:check-tectonic", () => checkTectonic());
  ipcMain.handle("resume:open-generated", async (_event, fileName) => { try { const file = paths.resolveGeneratedFile(fileName, ".pdf"); if (!fs.existsSync(file)) throw Object.assign(new Error(), { code: "INVALID_OUTPUT_PATH" }); const message = await shell.openPath(file); return message ? { ok: false, error: { code: "INVALID_OUTPUT_PATH", message: "The generated PDF could not be opened." } } : { ok: true }; } catch (error) { return { ok: false, error: serializeResumeError(error) }; } });
  ipcMain.handle("resume:reveal-generated", (_event, fileName) => { try { const file = paths.resolveGeneratedFile(fileName); if (!fs.existsSync(file)) throw Object.assign(new Error(), { code: "INVALID_OUTPUT_PATH" }); shell.showItemInFolder(file); return { ok: true }; } catch (error) { return { ok: false, error: serializeResumeError(error) }; } });
  ipcMain.handle("resume:open-output-folder", async () => { paths.ensureOutputDir(); const message = await shell.openPath(paths.outputDir); return message ? { ok: false, error: { code: "INVALID_OUTPUT_PATH", message: "The output folder could not be opened." } } : { ok: true }; });
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
    registerResumeIpc();
    createWindow();
    checkForUpdates();
  });

  app.on("window-all-closed", () => {
    app.quit();
  });
}
