const fs = require("fs");
const { execFile } = require("child_process");

function runTectonic(args, options = {}) {
  return new Promise((resolve) => execFile("tectonic", args, { windowsHide: true, timeout: 120000, maxBuffer: 1024 * 1024, ...options }, (error, stdout, stderr) => resolve({ error, stdout, stderr })));
}

async function checkTectonic() {
  const result = await runTectonic(["--version"], { timeout: 10000 });
  if (result.error?.code === "ENOENT") return { available: false, version: "", error: { code: "TECTONIC_NOT_FOUND", message: "Tectonic was not found on PATH." } };
  if (result.error) return { available: false, version: "", error: { code: "TECTONIC_NOT_FOUND", message: "Tectonic could not be started." } };
  return { available: true, version: String(result.stdout || result.stderr).trim().split(/\r?\n/)[0] };
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A network or package-download problem is transient: tectonic fetches its
// bundle and any missing packages over the network on first use. These strings
// come from that fetch path, never from a genuine LaTeX error in the document.
const TRANSIENT_HINT = /(connection (?:refused|reset|timed out)|failed to (?:fetch|download|connect|resolve)|could not (?:resolve|connect|reach|download)|unable to (?:connect|reach|download|open the? ?bundle)|error (?:fetching|downloading)|\bdownloading\b|\bfetching\b|name resolution|no route to host|no such host|network is unreachable|temporary failure|proxy|\btls\b|\bssl\b|handshake|offline)/i;

// Keep the last few non-empty diagnostic lines so a genuine LaTeX error carries
// its real cause instead of a generic message.
function lastRelevantLines(text, n = 6) {
  const lines = String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.slice(-n).join(" | ");
}

// Turn a failed tectonic run into a tagged error. TECTONIC_TRANSIENT and
// TECTONIC_TIMEOUT are safe to retry; COMPILATION_FAILED is a real document
// error and must never be retried. COMPILATION_FAILED keeps its code so the
// existing UI copy still applies, but now carries the real stderr tail.
function classifyTectonicError(result) {
  if (result.error?.code === "ENOENT") return { code: "TECTONIC_NOT_FOUND", message: "Tectonic was not found on PATH." };
  if (result.error?.killed || result.error?.signal === "SIGTERM") return { code: "TECTONIC_TIMEOUT", message: "Tectonic timed out while compiling the document." };
  const stderr = String(result.stderr || "");
  const stdout = String(result.stdout || "");
  if (TRANSIENT_HINT.test(stderr) || TRANSIENT_HINT.test(stdout)) {
    const detail = lastRelevantLines(stderr) || lastRelevantLines(stdout);
    return { code: "TECTONIC_TRANSIENT", message: `Tectonic hit a network or package-download problem${detail ? `: ${detail}` : "."}` };
  }
  const detail = lastRelevantLines(stderr) || lastRelevantLines(stdout);
  return { code: "COMPILATION_FAILED", message: `Tectonic could not compile the document${detail ? `: ${detail}` : "."}` };
}

async function compileGeneratedTex(paths, fileName) {
  let texPath;
  try { texPath = paths.resolveGeneratedFile(fileName, ".tex"); } catch (error) { return { ok: false, error: { code: error.code, message: error.message } }; }
  if (!fs.existsSync(texPath)) return { ok: false, error: { code: "INVALID_OUTPUT_PATH", message: "The generated TeX file does not exist." } };
  paths.ensureOutputDir();

  // Persistent package cache so tectonic downloads its bundle once and reuses it
  // across runs. TECTONIC_CACHE_DIR is the variable tectonic reads for this.
  const options = { cwd: paths.outputDir };
  if (paths.cacheDir) {
    try { fs.mkdirSync(paths.cacheDir, { recursive: true }); } catch {}
    options.env = { ...process.env, TECTONIC_CACHE_DIR: paths.cacheDir };
  }
  const args = [texPath, "--outdir", paths.outputDir];

  // Retry only transient network and timeout failures, with short exponential
  // backoff. A genuine LaTeX error returns immediately and is never retried.
  let lastTransient = null;
  for (let attempt = 0; attempt <= 2; attempt += 1) {
    const result = await runTectonic(args, options);
    if (!result.error) {
      const pdfFileName = fileName.replace(/\.tex$/i, ".pdf");
      const pdfPath = paths.resolveGeneratedFile(pdfFileName, ".pdf");
      if (!fs.existsSync(pdfPath)) return { ok: false, error: { code: "COMPILATION_FAILED", message: "Tectonic did not create the expected PDF." } };
      return { ok: true, texFileName: fileName, pdfFileName };
    }
    const classified = classifyTectonicError(result);
    if (classified.code !== "TECTONIC_TRANSIENT" && classified.code !== "TECTONIC_TIMEOUT") return { ok: false, error: classified };
    lastTransient = classified;
    if (attempt < 2) await delay(500 * 2 ** attempt);
  }
  return { ok: false, error: lastTransient };
}

module.exports = { checkTectonic, compileGeneratedTex };
