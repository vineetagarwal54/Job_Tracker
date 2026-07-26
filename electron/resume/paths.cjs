const fs = require("fs");
const path = require("path");

const SAFE_FILE = /^[a-z0-9]+(?:-[a-z0-9]+)*\.(?:tex|pdf)$/i;

function isWithinDirectory(candidate, directory) {
  const relative = path.relative(path.resolve(directory), path.resolve(candidate));
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function createResumePaths({ app, rootDir }) {
  const outputDir = app.isPackaged
    ? path.join(app.getPath("documents"), "JobTrack", "Resumes")
    : path.join(rootDir, "resume", "output");
  const templateDir = path.join(rootDir, "resume", "template");
  // Persistent tectonic package cache. In a packaged app this is the real OS
  // per-user userData directory (not a path next to the executable); the test
  // harness's fake app resolves userData to the repo root.
  const cacheDir = path.join(app.getPath("userData"), "tectonic-cache");
  const ensureOutputDir = () => { fs.mkdirSync(outputDir, { recursive: true }); return outputDir; };
  const resolveGeneratedFile = (fileName, extension) => {
    if (typeof fileName !== "string" || !SAFE_FILE.test(fileName) || (extension && path.extname(fileName).toLowerCase() !== extension)) {
      const error = new Error("The generated filename is invalid."); error.code = "INVALID_OUTPUT_PATH"; throw error;
    }
    const candidate = path.resolve(outputDir, fileName);
    if (!isWithinDirectory(candidate, outputDir)) { const error = new Error("The generated path is invalid."); error.code = "INVALID_OUTPUT_PATH"; throw error; }
    return candidate;
  };
  const template = (fileName) => path.join(templateDir, fileName);
  return { rootDir, outputDir, templateDir, cacheDir, ensureOutputDir, resolveGeneratedFile, template, displayPath: app.isPackaged ? "Documents\\JobTrack\\Resumes" : "resume\\output" };
}

module.exports = { SAFE_FILE, isWithinDirectory, createResumePaths };
