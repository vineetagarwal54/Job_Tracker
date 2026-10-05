// Runs the resume-tailor Claude Code commands (/tailor, /cover) for jobs,
// one at a time, in the user's resume-tailor folder.
//
// The renderer only ever sends job ids and a doc type. Everything else
// (JD text, company, role, the tailor folder, file paths) is read from the
// saved app data on disk and validated here before it touches the shell or
// the filesystem.

const { app, shell, nativeImage } = require("electron");
const { spawn, execFile } = require("child_process");
const { promisify } = require("util");
const path = require("path");
const fs = require("fs");

const execFileP = promisify(execFile);
const DOC_TYPES = new Set(["resume", "cover"]);
const JOB_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const RESUME_FILE = "Vineet_Agarwal_Resume.pdf";
const COVER_RE = /^Vineet_Agarwal_Cover_Letter_.*\.(pdf|docx)$/i;
// Keep in sync with RESUME_MASTER_KEY in src/constants.js.
const MASTER_KEY = { "AI/ML": "ai", "General/Full-stack": "swe", "Mobile": "mobile", "FDE": "fde" };

// Checked in order; first keyword hit wins. Word-boundary matching (not raw
// substring) so short entries like "ai"/"ml" don't false-positive inside
// unrelated words (e.g. "Retail" contains "ai", "HTML" contains "ml").
// TODO: masters/mobile.tex still uses the old pre-sync template (unlike
// ai/swe/fde). Until it's updated, a mobile-flavored title routes to swe,
// not mobile -- see the "mobile.tex not ready" branch in resolveMaster below.
const TITLE_KEYWORDS = [
  ["ai", ["ai", "ml", "machine learning", "llm", "genai", "generative", "inference", "applied scientist"]],
  ["fde", ["forward deployed", "solutions engineer", "customer engineer", "deployment engineer", "implementation engineer"]],
  ["mobile", ["mobile", "ios", "android", "react native"]],
];

function titleIncludes(title, phrase) {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<!\\w)${escaped}(?!\\w)`, "i").test(title);
}

function inferMasterFromRole(role) {
  const title = String(role || "");
  for (const [group, words] of TITLE_KEYWORDS) {
    const word = words.find((w) => titleIncludes(title, w));
    if (word) return { group, word };
  }
  return null;
}

// Resolves job.resume to a master key, tolerant of case/spacing/punctuation
// variants of the canonical labels above. "Auto" (let Claude pick) and any
// other unrecognized value fall through to keyword inference from job.role,
// then default to "swe" rather than skip pre-seeding -- `how` says which
// path was taken, for logging.
function resolveMaster(resumeValue, role) {
  const raw = String(resumeValue || "").trim();
  const squash = (s) => s.toLowerCase().replace(/[\s/_-]+/g, "");
  const norm = squash(raw);
  for (const [label, key] of Object.entries(MASTER_KEY)) {
    if (squash(label) === norm) return { key, how: label === raw ? "exact" : `normalized from "${raw}"` };
  }
  if (/full[\s-]?stack|general|^swe$/i.test(raw)) return { key: "swe", how: `swe-like label "${raw}"` };
  const hit = inferMasterFromRole(role);
  if (hit) {
    if (hit.group === "mobile") return { key: "swe", how: `matched "${hit.word}" in title; mobile.tex not ready, routed to swe` };
    return { key: hit.group, how: `matched "${hit.word}" in title` };
  }
  return { key: "swe", how: "no keyword, default swe" };
}
// 1x1 transparent PNG, used when the OS file icon can't be loaded (startDrag needs a non-empty icon).
const FALLBACK_ICON = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

let getAppData = () => null;
let notify = () => {};

let queue = [];       // [{ jobId, docType, folder, startedAt?, timedOutOnce? }]
let active = {};      // jobId -> { entry, child, killReason, timer } for jobs currently running, up to tailorConcurrencyOf()
let outcomes = {};    // jobId -> { failed, cancelled, message } for the current batch
// jobId -> { docStatus, resumePath, coverPath, lastRunLog, message, folder,
// durationMs, numTurns, fitLevel, keywordsCovered, keywordsTotal, missingKeywords, newWording }.
// The runner is the only writer; the renderer reads it via getState/events.
let results = {};

class TailorError extends Error {}

// ── Persistence ───────────────────────────────────────────────
const queuePath = () => path.join(app.getPath("userData"), "tailor-queue.json");

function persistQueue() {
  try {
    const tmp = `${queuePath()}.tmp`;
    const activeEntries = Object.values(active).map((a) => a.entry);
    fs.writeFileSync(tmp, JSON.stringify({ queue, active: activeEntries, results }, null, 2), "utf-8");
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
    // Interrupted runs go back to the front; startAttempt checks whether each
    // actually finished before re-running it. (saved.running is the pre-concurrency
    // single-entry shape, read for compatibility with an older queue file.)
    const savedActive = Array.isArray(saved.active) ? saved.active : (saved.running ? [saved.running] : []);
    queue = [...savedActive.filter(valid), ...queue];
    if (saved.results && typeof saved.results === "object") {
      for (const [id, r] of Object.entries(saved.results)) {
        if (JOB_ID_RE.test(id) && r && typeof r === "object") results[id] = r;
      }
    }
  } catch {}
  active = {};
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

// Same hand-edited-JSON convention as tailorEffort above -- no settings UI yet.
function tailorConcurrencyOf() {
  const { settings } = appData();
  const n = settings && Number(settings.tailorConcurrency);
  return Number.isInteger(n) && n >= 1 && n <= 3 ? n : 2;
}

function tailorTimeoutMsOf() {
  const { settings } = appData();
  const n = settings && Number(settings.tailorTimeoutMin);
  const minutes = Number.isFinite(n) && n > 0 && n <= 60 ? n : 6;
  return minutes * 60 * 1000;
}

function truncate(s, n) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function logEvent(log, startedAt, text) {
  log.write(`[${((Date.now() - startedAt) / 1000).toFixed(1)}s] ${text}\n`);
}

// Parses one NDJSON event from `claude --output-format stream-json --verbose` and
// writes a one-line summary to the log. Returns {report, durationMs, numTurns}
// when obj is the final "result" event, else null. Unrecognized event types
// (rate_limit_event, the "user" tool-result echo, etc.) are silently ignored.
function handleStreamEvent(obj, log, startedAt) {
  if (obj.type === "system") {
    if (obj.subtype === "init") {
      logEvent(log, startedAt, `system init: model ${obj.model || "unknown"}`);
    } else {
      const attempt = obj.attempt ?? obj.retry_attempt;
      const delay = obj.delay_ms ?? obj.delay;
      const extra = attempt != null || delay != null
        ? ` (attempt ${attempt ?? "?"}, delay ${delay != null ? `${delay}ms` : "?"})`
        : "";
      logEvent(log, startedAt, `system ${obj.subtype || "unknown"}${extra}`);
    }
  } else if (obj.type === "assistant") {
    for (const block of (obj.message && obj.message.content) || []) {
      if (block.type === "tool_use") {
        const detail = (block.input && (block.input.file_path || block.input.command)) || "";
        logEvent(log, startedAt, truncate(`tool_use: ${block.name} ${detail}`, 120));
      } else if (block.type === "thinking") {
        logEvent(log, startedAt, "thinking");
      } else if (block.type === "text") {
        logEvent(log, startedAt, `text (${(block.text || "").length} chars)`);
      }
    }
  } else if (obj.type === "user") {
    for (const block of (obj.message && obj.message.content) || []) {
      if (block.type === "tool_result") {
        const text = typeof block.content === "string" ? block.content : JSON.stringify(block.content);
        logEvent(log, startedAt, truncate(`tool_result: ${text}`, 120));
      }
    }
  } else if (obj.type === "result") {
    const totalS = ((obj.duration_ms || 0) / 1000).toFixed(1);
    const apiS = ((obj.duration_api_ms || 0) / 1000).toFixed(1);
    logEvent(log, startedAt, `result: ${totalS}s total, ${apiS}s API, ${obj.num_turns || 0} turns`);
    return { report: typeof obj.result === "string" ? obj.result : "", durationMs: obj.duration_ms || 0, numTurns: obj.num_turns || 0 };
  }
  return null;
}

// Parses /tailor's structured final report (see .claude/commands/tailor.md step 7)
// into {fitLevel, keywordsCovered, keywordsTotal, missingKeywords, newWording}.
// Best-effort: a report that doesn't match the format (e.g. /cover's free-text
// report) just yields all-null/empty fields, never throws.
function parseReport(text) {
  const out = { fitLevel: null, keywordsCovered: null, keywordsTotal: null, missingKeywords: [], newWording: [] };
  for (const line of String(text || "").split("\n")) {
    let m;
    if ((m = /^Fit:\s*(strong|partial|weak)\b/i.exec(line))) {
      out.fitLevel = m[1].toLowerCase();
    } else if ((m = /^Keywords:\s*(\d+)\s*\/\s*(\d+)\s*covered\.?\s*Missing:\s*(.*)$/i.exec(line))) {
      out.keywordsCovered = Number(m[1]);
      out.keywordsTotal = Number(m[2]);
      const missing = m[3].trim();
      out.missingKeywords = /^none$/i.test(missing) ? [] : missing.split(",").map((s) => s.trim()).filter(Boolean);
    } else if ((m = /^-\s*\[(Experience|Projects):\s*([^\]]+)\]\s*(.+)$/.exec(line))) {
      out.newWording.push({ section: m[1], heading: m[2].trim(), text: m[3].trim() });
    }
  }
  return out;
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
  const activeEntries = Object.values(active).map((a) => a.entry);
  const pending = [...activeEntries, ...queue].find((e) => e && String(e.jobId) === jobId);
  if (pending) return pending.folder;
  const prev = results[jobId] && results[jobId].folder;
  if (typeof prev === "string" && /^applications\/[A-Za-z0-9_-]+$/.test(prev)) return prev;
  const d = new Date(); // local date, not UTC
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const base = `applications/${slug(job.company, "Company")}_${slug(job.role, "Role")}_${date}`;
  const taken = (f) => fs.existsSync(path.join(dir, ...f.split("/")))
    || [...activeEntries, ...queue].some((e) => e && e.folder === f)
    || Object.entries(results).some(([id, r]) => id !== jobId && r && r.folder === f);
  return taken(base) ? `${base}_${jobId.slice(-4)}` : base;
}

// ── Status ────────────────────────────────────────────────────
function statusOf(jobId) {
  if (active[jobId]) return "generating";
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
  const message = outcome.failed ? (outcome.message || "") : (fields.message || "");
  update(jobId, { ...fields, docStatus, message });
}

const publicResult = (r) => ({
  docStatus: r.docStatus || null,
  resumePath: r.resumePath || "",
  coverPath: r.coverPath || "",
  lastRunLog: r.lastRunLog || "",
  message: r.message || "",
  durationMs: r.durationMs ?? null,
  numTurns: r.numTurns ?? null,
  fitLevel: r.fitLevel || null,
  keywordsCovered: r.keywordsCovered ?? null,
  keywordsTotal: r.keywordsTotal ?? null,
  missingKeywords: Array.isArray(r.missingKeywords) ? r.missingKeywords : [],
  newWording: Array.isArray(r.newWording) ? r.newWording : [],
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
      const activeEntries = Object.values(active).map((a) => a.entry);
      const dupe = [...activeEntries, ...queue].some((e) => e && String(e.jobId) === jobId && e.docType === docType);
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
  if (active[jobId]) {
    killChild(jobId, "cancel"); // settles when the process exits
  } else if (queue.length !== before) {
    settle(jobId, {});
  }
  return getState();
}

function killChild(jobId, reason) {
  const a = active[jobId];
  if (!a || !a.child) return;
  a.killReason = reason;
  if (process.platform === "win32") {
    // shell: true means child.pid is cmd.exe; /T takes claude and its tools (and
    // any of its own children) down too -- the whole tree, not just the shell.
    execFile("taskkill", ["/pid", String(a.child.pid), "/T", "/F"], () => {});
  } else {
    a.child.kill("SIGTERM");
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

function writeInbox(dir, job, entry, master) {
  const inbox = path.join(dir, "inbox");
  fs.mkdirSync(inbox, { recursive: true });
  const file = path.join(inbox, `${entry.jobId}.md`);
  const text = [
    `Company: ${job.company || ""}`,
    `Role: ${job.role || ""}`,
    `Link: ${job.link || ""}`,
    `Output folder: ${entry.folder}`,
    ...(master ? [`Master: ${master}`] : []),
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
  delete active[jobId];
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
  const cap = tailorConcurrencyOf();
  while (Object.keys(active).length < cap && queue.length > 0) {
    startAttempt(queue.shift());
  }
}

function startAttempt(entry) {
  const jobId = String(entry.jobId);
  active[jobId] = { entry };

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

  // Interrupted by an app restart (or this is a post-timeout retry): if the
  // prior attempt actually produced its file, keep it instead of redoing work.
  if (entry.startedAt) {
    const done = findOutput(folderAbs, entry.docType, entry.startedAt);
    if (done) return finish(entry, { [pathField]: done, lastRunLog: logPath });
  }

  entry.startedAt = Date.now();
  update(jobId);

  let log;
  try {
    const resolved = entry.docType === "resume" ? resolveMaster(job.resume, job.role) : null;
    const master = resolved && resolved.key;
    fs.mkdirSync(folderAbs, { recursive: true });
    const inboxRel = writeInbox(dir, job, entry, master);
    // Seed the resume tex and jd.md here with plain fs, not Claude's Write tool:
    // Write costs 40-50s on the ~10KB master tex, and this runs before claude is
    // even spawned.
    let texRel = null;
    if (master) {
      const masterTex = fs.readFileSync(path.join(dir, "masters", `${master}.tex`), "utf-8");
      fs.writeFileSync(path.join(folderAbs, "Vineet_Agarwal_Resume.tex"), `% master: ${master}\n${masterTex}`, "utf-8");
      fs.writeFileSync(path.join(folderAbs, "jd.md"), `${String(job.jd || "").trim()}\n`, "utf-8");
      texRel = `${entry.folder}/Vineet_Agarwal_Resume.tex`;
    } else if (entry.docType === "cover") {
      // Cover doesn't need a master or its own tex -- just jd.md (cheap, idempotent),
      // plus the existing tailored resume's path for consistency, if one exists yet.
      fs.writeFileSync(path.join(folderAbs, "jd.md"), `${String(job.jd || "").trim()}\n`, "utf-8");
      const existingTex = path.join(folderAbs, "Vineet_Agarwal_Resume.tex");
      texRel = fs.existsSync(existingTex) ? `${entry.folder}/Vineet_Agarwal_Resume.tex` : null;
    }
    const prompt = entry.docType === "resume"
      ? `/tailor JD=${inboxRel} TEX=${texRel} MASTER=${master}`
      : `/cover JD=${inboxRel}${texRel ? ` TEX=${texRel}` : ""}`;
    // prompt only contains a validated job id, derived relative paths, and a
    // fixed master key, so it is safe inside double quotes. cwd (which has a
    // space in it) is passed as an option, never through the shell.
    const streamFlags = "--output-format stream-json --verbose";
    const command = `claude -p "${prompt}" --effort ${tailorEffortOf()} ${streamFlags}`;

    log = fs.createWriteStream(logPath, { flags: "a" });
    log.on("error", () => {});
    log.write(`\n=== ${entry.docType} ${new Date().toISOString()} ===\n$ ${command}\n`);
    if (resolved) log.write(`resume: "${job.resume || ""}" -> master: ${resolved.key} (${resolved.how})\n`);
    if (entry.timedOutOnce) log.write("retry after timeout\n");

    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY; // resume-tailor runs on the Claude subscription
    // claude.cmd can only be launched through a shell on Windows.
    active[jobId].child = spawn(command, { cwd: dir, shell: true, windowsHide: true, env, stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    if (log) log.end();
    return fail(entry, "Could not start claude. Is Claude Code installed?", { lastRunLog: logPath });
  }

  const child = active[jobId].child;
  const runInfo = { report: "", durationMs: null, numTurns: null };
  let stdoutBuf = "";
  child.stdout.on("data", (chunk) => {
    stdoutBuf += chunk.toString("utf-8");
    let idx;
    while ((idx = stdoutBuf.indexOf("\n")) !== -1) {
      const line = stdoutBuf.slice(0, idx).trim();
      stdoutBuf = stdoutBuf.slice(idx + 1);
      if (!line) continue;
      try {
        const result = handleStreamEvent(JSON.parse(line), log, entry.startedAt);
        if (result) Object.assign(runInfo, result);
      } catch {
        log.write(line + "\n"); // defensive: not valid JSON, keep the raw line rather than drop it
      }
    }
  });
  child.stderr.on("data", (d) => log.write(d));
  const timer = setTimeout(() => killChild(jobId, "timeout"), tailorTimeoutMsOf());
  active[jobId].timer = timer;

  let done = false;
  const onExit = (code, err) => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    const reason = active[jobId] && active[jobId].killReason;
    log.end(`\n=== exit ${err ? err.message : code}${reason ? ` (${reason})` : ""} ===\n`);
    const fields = { lastRunLog: logPath };
    if (reason === "cancel") return finish(entry, fields);
    if (reason === "timeout") {
      if (!entry.timedOutOnce) {
        entry.timedOutOnce = true;
        delete active[jobId];
        queue.unshift(entry);
        update(jobId);
        processNext();
        return;
      }
      return fail(entry, "Timed out twice (after one retry). See run.log.", fields);
    }
    const output = findOutput(folderAbs, entry.docType, entry.startedAt);
    if (!output) {
      const what = entry.docType === "resume" ? "resume PDF" : "cover letter";
      return fail(entry, err ? "Could not start claude. Is Claude Code installed?" : `No ${what} was produced. See run.log.`, fields);
    }
    const parsed = runInfo.report ? parseReport(runInfo.report) : null;
    finish(entry, {
      ...fields,
      [pathField]: output,
      ...(runInfo.report ? { message: runInfo.report } : {}),
      ...(runInfo.durationMs != null ? { durationMs: runInfo.durationMs, numTurns: runInfo.numTurns } : {}),
      ...(parsed ? {
        fitLevel: parsed.fitLevel,
        keywordsCovered: parsed.keywordsCovered,
        keywordsTotal: parsed.keywordsTotal,
        missingKeywords: parsed.missingKeywords,
        newWording: parsed.newWording,
      } : {}),
    });
  };
  child.on("error", (err) => onExit(null, err));
  child.on("close", (code) => onExit(code));
}

// ── Save to bank ──────────────────────────────────────────────
// Matches bank/tags.yaml's header comment in the resume-tailor repo.
const ALLOWED_TAGS = new Set([
  "frontend", "backend", "ai", "infra", "realtime", "data",
  "client-facing", "leadership", "mobile", "perf", "security",
]);

// Inserts `line` into bank/bank_extra.md under "## <section>" / "### <heading>",
// creating the heading block (or the whole file) if it doesn't exist yet.
// Writes atomically (temp file + rename), same shape as persistQueue().
function appendToExtraBank(extraPath, section, heading, line) {
  let text;
  try {
    text = fs.readFileSync(extraPath, "utf-8");
  } catch {
    text = "# Content Bank (hand-maintained)\n\n## Experience\n\n## Projects\n";
  }
  const sectionHeader = `## ${section}`;
  const sectionStart = text.indexOf(sectionHeader);
  if (sectionStart === -1) throw new TailorError(`bank_extra.md has no "${sectionHeader}" section.`);
  const afterHeader = sectionStart + sectionHeader.length;
  const nextSection = text.indexOf("\n## ", afterHeader);
  const sectionEnd = nextSection === -1 ? text.length : nextSection;
  let sectionText = text.slice(afterHeader, sectionEnd);

  // Prefix match: a project heading in bank_extra.md carries a "(GitHub: ...)"
  // suffix the report's bare title doesn't.
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const headingMatch = new RegExp(`^### ${escaped}\\b`, "m").exec(sectionText);
  if (headingMatch) {
    const afterHeading = headingMatch.index + headingMatch[0].length;
    const nextHeading = sectionText.indexOf("\n### ", afterHeading);
    const insertAt = nextHeading === -1 ? sectionText.length : nextHeading;
    // Normalize to exactly one trailing newline before the insert point, so the
    // blank line that separates this heading's bullets from the next heading
    // (or end of section) is preserved rather than consumed by the insertion.
    const before = sectionText.slice(0, insertAt).replace(/\n*$/, "\n");
    sectionText = `${before}${line}\n${sectionText.slice(insertAt)}`;
  } else {
    sectionText = `${sectionText.replace(/\s*$/, "")}\n\n### ${heading}\n${line}\n`;
  }

  const newText = text.slice(0, afterHeader) + sectionText + text.slice(sectionEnd);
  const tmp = `${extraPath}.tmp`;
  fs.writeFileSync(tmp, newText, "utf-8");
  fs.renameSync(tmp, extraPath);
}

// Serializes the append-then-rebuild sequence across concurrent "Save to bank"
// calls (now plausible with tailorConcurrency > 1) via a simple lock file.
// A lock older than 60s is treated as abandoned (a crashed prior call) and
// cleared rather than deadlocking forever.
async function withBankLock(dir, fn) {
  const lockPath = path.join(dir, "bank", ".build.lock");
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const STALE_MS = 60 * 1000;
  for (;;) {
    try {
      fs.closeSync(fs.openSync(lockPath, "wx"));
      break;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      try {
        if (Date.now() - fs.statSync(lockPath).mtimeMs > STALE_MS) { fs.unlinkSync(lockPath); continue; }
      } catch {}
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  try {
    return await fn();
  } finally {
    try { fs.unlinkSync(lockPath); } catch {}
  }
}

// selections: [{section, heading, text, tags}]. Only entries that exactly match
// one of this job's own recorded newWording bullets are ever written -- the
// renderer's copy is never trusted on its own.
async function saveToBank(rawId, selections) {
  const jobId = checkId(rawId);
  const known = Array.isArray(results[jobId] && results[jobId].newWording) ? results[jobId].newWording : [];
  if (known.length === 0) throw new TailorError("No new wording to save for this job.");
  const valid = (Array.isArray(selections) ? selections : []).filter((s) =>
    s && typeof s.section === "string" && typeof s.heading === "string" && typeof s.text === "string"
    && known.some((n) => n.section === s.section && n.heading === s.heading && n.text === s.text)
    && Array.isArray(s.tags) && s.tags.length > 0 && s.tags.every((t) => ALLOWED_TAGS.has(t))
  );
  if (valid.length === 0) throw new TailorError("Nothing valid selected.");

  const dir = checkTailorDir(tailorDir());
  const extraPath = path.join(dir, "bank", "bank_extra.md");
  await withBankLock(dir, async () => {
    for (const sel of valid) {
      appendToExtraBank(extraPath, sel.section, sel.heading, `- [${sel.tags.join(", ")}] ${sel.text}`);
    }
    try {
      await execFileP("python", ["scripts/build_bank.py"], { cwd: dir });
    } catch (e) {
      throw new TailorError(`build_bank.py failed: ${(e && e.stderr) || (e && e.message) || "unknown error"}`);
    }
  });
  return { saved: valid.length };
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

module.exports = { init, generate, cancel, getState, openFile, showInFolder, startDrag, saveToBank, ipcResult };
