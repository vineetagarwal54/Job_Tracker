// Runs the resume-tailor Claude Code commands (/tailor, /cover) for jobs,
// one at a time, in the user's resume-tailor folder.
//
// The renderer only ever sends job ids and a doc type. Everything else
// (JD text, company, role, the tailor folder, file paths) is read from the
// saved app data on disk and validated here before it touches the shell or
// the filesystem.

const { app, shell, nativeImage } = require("electron");
const { spawn, execFile } = require("child_process");
const path = require("path");
const fs = require("fs");

const TIMEOUT_MS = 10 * 60 * 1000;
const DOC_TYPES = new Set(["resume", "cover"]);
const JOB_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const RESUME_FILE = "Vineet_Agarwal_Resume.pdf";
const COVER_RE = /^Vineet_Agarwal_Cover_Letter_.*\.(pdf|docx)$/i;
// Keep in sync with RESUME_MASTER_KEY in src/constants.js.
const MASTER_KEY = { "AI/ML": "ai", "General/Full-stack": "swe", "Mobile": "mobile", "FDE": "fde" };
// 1x1 transparent PNG, used when the OS file icon can't be loaded (startDrag needs a non-empty icon).
const FALLBACK_ICON = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

let getAppData = () => null;
let notify = () => {};

let queue = [];       // [{ jobId, docType, folder, startedAt? }]
let running = null;   // the entry currently running
let child = null;
let killReason = null; // "cancel" | "timeout" while a kill is in progress
let outcomes = {};    // jobId -> { failed, cancelled, message } for the current batch
// jobId -> { docStatus, resumePath, coverPath, lastRunLog, message, folder }.
// The runner is the only writer; the renderer reads it via getState/events.
let results = {};

class TailorError extends Error {}

// ── Persistence ───────────────────────────────────────────────
const queuePath = () => path.join(app.getPath("userData"), "tailor-queue.json");

function persistQueue() {
  try {
    const tmp = `${queuePath()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ queue, running, results }, null, 2), "utf-8");
    fs.renameSync(tmp, queuePath());
  } catch (e) {
    console.error("[JobTrack] Failed to save tailor queue:", e);
  }
}

function init(opts) {
  getAppData = opts.getAppData;
  notify = opts.notify;
  try {
    const saved = JSON.parse(fs.readFileSync(queuePath(), "utf-8"));
    const valid = (e) => e && JOB_ID_RE.test(String(e.jobId)) && DOC_TYPES.has(e.docType) && typeof e.folder === "string";
    queue = Array.isArray(saved.queue) ? saved.queue.filter(valid) : [];
    // An interrupted run goes back to the front; processNext checks whether it
    // actually finished before re-running it.
    if (valid(saved.running)) queue.unshift(saved.running);
    if (saved.results && typeof saved.results === "object") {
      for (const [id, r] of Object.entries(saved.results)) {
        if (JOB_ID_RE.test(id) && r && typeof r === "object") results[id] = r;
      }
    }
  } catch {}
  running = null;
  persistQueue();
  processNext();
}

// ── Lookups ───────────────────────────────────────────────────
function appData() {
  try { return getAppData() || {}; } catch { return {}; }
}

function findJob(jobId) {
  const { jobs } = appData();
  if (!Array.isArray(jobs)) return null;
  return jobs.find((j) => j && String(j.id) === String(jobId)) || null;
}

function tailorDir() {
  const { settings } = appData();
  const saved = settings && settings.tailorDir;
  return typeof saved === "string" && saved.trim() ? saved.trim() : path.join(app.getPath("desktop"), "resume-tailor");
}

// Matches `claude --help`'s accepted --effort values. No settings UI for this yet;
// set settings.tailorEffort by hand if a level other than the default is wanted.
const TAILOR_EFFORT_VALUES = new Set(["low", "medium", "high", "xhigh", "max"]);

function tailorEffortOf() {
  const { settings } = appData();
  const saved = settings && settings.tailorEffort;
  return typeof saved === "string" && TAILOR_EFFORT_VALUES.has(saved) ? saved : "low";
}

function checkTailorDir(dir) {
  const ok = path.isAbsolute(dir)
    && fs.existsSync(path.join(dir, "CLAUDE.md"))
    && fs.existsSync(path.join(dir, ".claude", "commands", "tailor.md"));
  if (!ok) throw new TailorError(`Resume tailor folder not found: ${dir}`);
  return dir;
}

function isInside(parent, child) {
  const rel = path.relative(parent, child);
  return rel && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function checkId(jobId) {
  if (!JOB_ID_RE.test(String(jobId))) throw new TailorError("Invalid job.");
  return String(jobId);
}

const slug = (s, fallback) => String(s || "").replace(/[^A-Za-z0-9]+/g, "") || fallback;

// Folder relative to tailorDir. Reuses this job's earlier folder (queued or
// finished) so resume and cover letter land side by side. A new name that is
// already taken (another job, or a manual /tailor run) gets the job id's last
// 4 characters appended.
function folderFor(jobId, job, dir) {
  const pending = [running, ...queue].find((e) => e && String(e.jobId) === jobId);
  if (pending) return pending.folder;
  const prev = results[jobId] && results[jobId].folder;
  if (typeof prev === "string" && /^applications\/[A-Za-z0-9_-]+$/.test(prev)) return prev;
  const d = new Date(); // local date, not UTC
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const base = `applications/${slug(job.company, "Company")}_${slug(job.role, "Role")}_${date}`;
  const taken = (f) => fs.existsSync(path.join(dir, ...f.split("/")))
    || [running, ...queue].some((e) => e && e.folder === f)
    || Object.entries(results).some(([id, r]) => id !== jobId && r && r.folder === f);
  return taken(base) ? `${base}_${jobId.slice(-4)}` : base;
}

// ── Status ────────────────────────────────────────────────────
function statusOf(jobId) {
  if (running && String(running.jobId) === jobId) return "generating";
  if (queue.some((e) => String(e.jobId) === jobId)) return "queued";
  return null;
}

// Merges fields into the job's result, persists, and tells the renderer.
function update(jobId, fields = {}) {
  const r = { ...(results[jobId] || {}), ...fields };
  const live = statusOf(jobId);
  if (live) r.docStatus = live;
  results[jobId] = r;
  persistQueue();
  try { notify({ jobId, ...publicResult(r) }); } catch {}
}

// Final status once a job has nothing left queued.
function settle(jobId, fields) {
  if (statusOf(jobId)) return update(jobId, fields);
  const outcome = outcomes[jobId] || {};
  delete outcomes[jobId];
  const prev = results[jobId] || {};
  const hasDoc = Boolean(fields.resumePath || fields.coverPath || prev.resumePath || prev.coverPath);
  let docStatus = outcome.failed ? "failed" : "ready";
  if (outcome.cancelled && !outcome.failed) docStatus = hasDoc ? "ready" : null;
  update(jobId, { ...fields, docStatus, message: outcome.message || "" });
}

const publicResult = (r) => ({
  docStatus: r.docStatus || null,
  resumePath: r.resumePath || "",
  coverPath: r.coverPath || "",
  lastRunLog: r.lastRunLog || "",
  message: r.message || "",
});

function getState() {
  const out = {};
  for (const [id, r] of Object.entries(results)) out[id] = publicResult({ ...r, docStatus: statusOf(id) || r.docStatus });
  return { results: out };
}

// ── Queue ─────────────────────────────────────────────────────
function generate(jobIds, docTypes) {
  if (!Array.isArray(jobIds) || jobIds.length === 0 || jobIds.length > 500) throw new TailorError("No jobs selected.");
  if (!Array.isArray(docTypes) || docTypes.length === 0 || !docTypes.every((t) => DOC_TYPES.has(t))) {
    throw new TailorError("Invalid document type.");
  }
  const dir = checkTailorDir(tailorDir());
  const types = ["resume", "cover"].filter((t) => docTypes.includes(t)); // resume first
  let queued = 0;
  for (const rawId of jobIds) {
    const jobId = checkId(rawId);
    const job = findJob(jobId);
    if (!job || !String(job.jd || "").trim()) continue;
    if (!statusOf(jobId)) outcomes[jobId] = {};
    const folder = folderFor(jobId, job, dir);
    for (const docType of types) {
      const dupe = [running, ...queue].some((e) => e && String(e.jobId) === jobId && e.docType === docType);
      if (!dupe) { queue.push({ jobId, docType, folder }); queued++; }
    }
    update(jobId, { folder, message: "" });
  }
  processNext();
  return { queued };
}

function cancel(rawId) {
  const jobId = checkId(rawId);
  if (!statusOf(jobId)) return getState();
  const before = queue.length;
  queue = queue.filter((e) => String(e.jobId) !== jobId);
  outcomes[jobId] = { ...(outcomes[jobId] || {}), cancelled: true };
  if (running && String(running.jobId) === jobId) {
    killChild("cancel"); // settles when the process exits
  } else if (queue.length !== before) {
    settle(jobId, {});
  }
  return getState();
}

function killChild(reason) {
  if (!child) return;
  killReason = reason;
  if (process.platform === "win32") {
    // shell: true means child.pid is cmd.exe; /T takes claude and its tools down too.
    execFile("taskkill", ["/pid", String(child.pid), "/T", "/F"], () => {});
  } else {
    child.kill("SIGTERM");
  }
}

function findOutput(folderAbs, docType, since) {
  const fresh = (f) => {
    try { return fs.statSync(f).mtimeMs >= since - 2000; } catch { return false; }
  };
  if (docType === "resume") {
    const f = path.join(folderAbs, RESUME_FILE);
    return fresh(f) ? f : null;
  }
  let files = [];
  try { files = fs.readdirSync(folderAbs).filter((n) => COVER_RE.test(n)).map((n) => path.join(folderAbs, n)); } catch {}
  const newest = (ext) => files
    .filter((f) => f.toLowerCase().endsWith(ext) && fresh(f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
  return newest(".pdf") || newest(".docx") || null;
}

function writeInbox(dir, job, entry) {
  const inbox = path.join(dir, "inbox");
  fs.mkdirSync(inbox, { recursive: true });
  const file = path.join(inbox, `${entry.jobId}.md`);
  const text = [
    `Company: ${job.company || ""}`,
    `Role: ${job.role || ""}`,
    `Link: ${job.link || ""}`,
    `Output folder: ${entry.folder}`,
    "",
    "## Job description",
    "",
    String(job.jd || "").trim(),
    "",
  ].join("\n");
  fs.writeFileSync(file, text, "utf-8");
  return `inbox/${entry.jobId}.md`;
}

function finish(entry, fields) {
  const jobId = String(entry.jobId);
  running = null;
  child = null;
  killReason = null;
  persistQueue();
  settle(jobId, fields);
  processNext();
}

function fail(entry, message, fields = {}) {
  const jobId = String(entry.jobId);
  outcomes[jobId] = { ...(outcomes[jobId] || {}), failed: true, message };
  finish(entry, fields);
}

function processNext() {
  if (running || queue.length === 0) return;
  const entry = queue.shift();
  running = entry;
  const jobId = String(entry.jobId);

  let dir, job;
  try {
    dir = checkTailorDir(tailorDir());
    job = findJob(jobId);
    if (!job) throw new TailorError("Job no longer exists.");
    if (!String(job.jd || "").trim()) throw new TailorError("Paste the JD first.");
  } catch (e) {
    return fail(entry, e instanceof TailorError ? e.message : "Could not start.");
  }

  const folderAbs = path.join(dir, ...entry.folder.split("/"));
  const logPath = path.join(folderAbs, "run.log");
  const pathField = entry.docType === "resume" ? "resumePath" : "coverPath";

  // Interrupted by an app restart: if the run actually produced its file, keep it.
  if (entry.startedAt) {
    const done = findOutput(folderAbs, entry.docType, entry.startedAt);
    if (done) return finish(entry, { [pathField]: done, lastRunLog: logPath });
  }

  entry.startedAt = Date.now();
  update(jobId);

  let log;
  try {
    fs.mkdirSync(folderAbs, { recursive: true });
    const inboxRel = writeInbox(dir, job, entry);
    const master = entry.docType === "resume" ? MASTER_KEY[job.resume] : null;
    // Seed the resume tex and jd.md here with plain fs, not Claude's Write tool:
    // Write costs 40-50s on the ~10KB master tex, and this runs before claude is
    // even spawned.
    let texRel = null;
    if (master) {
      const masterTex = fs.readFileSync(path.join(dir, "masters", `${master}.tex`), "utf-8");
      fs.writeFileSync(path.join(folderAbs, "Vineet_Agarwal_Resume.tex"), `% master: ${master}\n${masterTex}`, "utf-8");
      fs.writeFileSync(path.join(folderAbs, "jd.md"), `${String(job.jd || "").trim()}\n`, "utf-8");
      texRel = `${entry.folder}/Vineet_Agarwal_Resume.tex`;
    }
    const prompt = entry.docType === "resume"
      ? (master ? `/tailor JD=${inboxRel} TEX=${texRel} MASTER=${master}` : `/tailor ${inboxRel}`)
      : `/cover ${inboxRel}`;
    // prompt only contains a validated job id, derived relative paths, and a
    // fixed master key, so it is safe inside double quotes. cwd (which has a
    // space in it) is passed as an option, never through the shell.
    const command = entry.docType === "resume"
      ? `claude -p "${prompt}" --effort ${tailorEffortOf()}`
      : `claude -p "${prompt}"`;

    log = fs.createWriteStream(logPath, { flags: "a" });
    log.on("error", () => {});
    log.write(`\n=== ${entry.docType} ${new Date().toISOString()} ===\n$ ${command}\n`);

    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY; // resume-tailor runs on the Claude subscription
    // claude.cmd can only be launched through a shell on Windows.
    child = spawn(command, { cwd: dir, shell: true, windowsHide: true, env, stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    if (log) log.end();
    return fail(entry, "Could not start claude. Is Claude Code installed?", { lastRunLog: logPath });
  }

  child.stdout.on("data", (d) => log.write(d));
  child.stderr.on("data", (d) => log.write(d));
  const timer = setTimeout(() => killChild("timeout"), TIMEOUT_MS);

  let done = false;
  const onExit = (code, err) => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    const reason = killReason;
    log.end(`\n=== exit ${err ? err.message : code}${reason ? ` (${reason})` : ""} ===\n`);
    const fields = { lastRunLog: logPath };
    if (reason === "cancel") return finish(entry, fields);
    if (reason === "timeout") return fail(entry, "Timed out after 10 minutes. See run.log.", fields);
    const output = findOutput(folderAbs, entry.docType, entry.startedAt);
    if (!output) {
      const what = entry.docType === "resume" ? "resume PDF" : "cover letter";
      return fail(entry, err ? "Could not start claude. Is Claude Code installed?" : `No ${what} was produced. See run.log.`, fields);
    }
    finish(entry, { ...fields, [pathField]: output });
  };
  child.on("error", (err) => onExit(null, err));
  child.on("close", (code) => onExit(code));
}

// ── Files ─────────────────────────────────────────────────────
// Resolves one of this job's own files from the runner's results (or the
// master PDF for "base"). Paths are still re-checked: they must live in the
// tailor folder and have the expected type.
function resolveFile(rawId, docType) {
  const jobId = checkId(rawId);
  const job = findJob(jobId);
  if (!job) throw new TailorError("Job not found.");
  const dir = checkTailorDir(tailorDir());
  const real = (p) => { try { return fs.realpathSync(p); } catch { return null; } };

  if (docType === "base") {
    const key = MASTER_KEY[job.resume];
    if (!key) throw new TailorError("No base resume for this version.");
    const file = real(path.join(dir, "masters", `${key}.pdf`));
    if (!file) throw new TailorError("Base resume PDF is missing.");
    return file;
  }

  const field = { resume: "resumePath", cover: "coverPath", log: "lastRunLog" }[docType];
  if (!field) throw new TailorError("Invalid document type.");
  const r = results[jobId] || {};
  const file = typeof r[field] === "string" && r[field] ? real(r[field]) : null;
  const apps = real(path.join(dir, "applications"));
  if (!file || !apps || !isInside(apps, file)) throw new TailorError("File not found.");
  const ok = docType === "log" ? path.basename(file) === "run.log" : /\.(pdf|docx)$/i.test(file);
  if (!ok) throw new TailorError("File not found.");
  return file;
}

async function openFile(jobId, docType) {
  const error = await shell.openPath(resolveFile(jobId, docType));
  if (error) throw new TailorError("Could not open the file.");
}

function showInFolder(jobId, docType) {
  shell.showItemInFolder(resolveFile(jobId, docType));
}

async function startDrag(sender, jobId, docType) {
  let file;
  try { file = resolveFile(jobId, docType); } catch { return; }
  if (docType === "log") return;
  let icon;
  try { icon = await app.getFileIcon(file); } catch {}
  if (!icon || icon.isEmpty()) icon = nativeImage.createFromDataURL(FALLBACK_ICON);
  sender.startDrag({ file, icon });
}

async function ipcResult(fn) {
  try {
    return { ok: true, result: await fn() };
  } catch (e) {
    return { ok: false, error: e instanceof TailorError ? e.message : "Unexpected error." };
  }
}

module.exports = { init, generate, cancel, getState, openFile, showInFolder, startDrag, ipcResult };
