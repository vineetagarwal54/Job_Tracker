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

async function compileGeneratedTex(paths, fileName) {
  let texPath;
  try { texPath = paths.resolveGeneratedFile(fileName, ".tex"); } catch (error) { return { ok: false, error: { code: error.code, message: error.message } }; }
  if (!fs.existsSync(texPath)) return { ok: false, error: { code: "INVALID_OUTPUT_PATH", message: "The generated TeX file does not exist." } };
  paths.ensureOutputDir();
  const result = await runTectonic([texPath, "--outdir", paths.outputDir], { cwd: paths.outputDir });
  if (result.error?.code === "ENOENT") return { ok: false, error: { code: "TECTONIC_NOT_FOUND", message: "Tectonic was not found on PATH." } };
  if (result.error) return { ok: false, error: { code: "COMPILATION_FAILED", message: "Tectonic could not compile the document." } };
  const pdfFileName = fileName.replace(/\.tex$/i, ".pdf");
  const pdfPath = paths.resolveGeneratedFile(pdfFileName, ".pdf");
  if (!fs.existsSync(pdfPath)) return { ok: false, error: { code: "COMPILATION_FAILED", message: "Tectonic did not create the expected PDF." } };
  return { ok: true, texFileName: fileName, pdfFileName };
}

module.exports = { checkTectonic, compileGeneratedTex };
