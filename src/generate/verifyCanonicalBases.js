import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { canonicalBases, RESUME_OPTIONS, resolveBaseResumeId } from "./baseResumes.js";
import { renderCanonicalBase, validateCanonicalBase } from "./renderResume.js";
import { bankIdentityToIdentity } from "./profileIdentity.js";

const require = createRequire(import.meta.url);
const { verifyPdfAtsIntegrity } = require("../../electron/resume/pdfVerify.cjs");
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const bank = JSON.parse(fs.readFileSync(path.join(here, "content-bank.json"), "utf8"));
const template = fs.readFileSync(path.join(root, "resume", "template", "main.tex"), "utf8");
const identity = bankIdentityToIdentity(bank);
const output = path.join(root, "resume", "output", "canonical-bases");
fs.mkdirSync(output, { recursive: true });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(RESUME_OPTIONS.length === 3, "Exactly three resume choices must be exposed.");
for (const base of canonicalBases) {
  assert(resolveBaseResumeId(base.option) === base.id, `${base.id}: option mapping is incorrect.`);
  validateCanonicalBase(bank, base);
  const sourceBytes = fs.readFileSync(path.join(root, base.sourcePdf)).toString("latin1");
  const sourcePageCount = sourceBytes.match(/\/Type\s*\/Page(?!s)\b/g)?.length || 0;
  assert(sourcePageCount === 1, `${base.id}: authoritative source is not one page.`);

  const rendered = renderCanonicalBase({ bank, base, template, identity });
  const texPath = path.join(output, `${base.id}-base.tex`);
  fs.writeFileSync(texPath, rendered.tex, "utf8");
  execFileSync("tectonic", [texPath, "--outdir", output], { cwd: output, windowsHide: true, timeout: 120000, stdio: "pipe" });
  const pdfPath = path.join(output, `${base.id}-base.pdf`);
  const requiredTerms = [
    ...base.experience.map((entry) => bank.experience.find((item) => item.id === entry.entryId).org),
    ...base.projects.map((entry) => entry.title || bank.projects.find((item) => item.id === entry.entryId).org),
  ];
  const check = verifyPdfAtsIntegrity(pdfPath, { expectedName: identity.name, requiredTerms });
  assert(check.pageCount === 1, `${base.id}: rendered PDF has ${check.pageCount} pages.`);
  assert(check.splitTerms.length === 0, `${base.id}: expected entries missing: ${check.splitTerms.join(", ")}`);
  assert(check.textLength >= Math.floor(base.sourceNormalizedTextLength * 0.9), `${base.id}: rendered text is materially shorter (${check.textLength} vs source ${base.sourceNormalizedTextLength}).`);
  const expectedBullets = base.experience.reduce((sum, entry) => sum + entry.bullets.length, 0) + base.projects.reduce((sum, entry) => sum + entry.bullets.length, 0);
  console.log(JSON.stringify({ id: base.id, pageCount: check.pageCount, experienceCount: base.experience.length, projectCount: base.projects.length, bulletCount: expectedBullets, renderedTextLength: check.textLength, sourceTextLength: base.sourceNormalizedTextLength, lengthRatio: Number((check.textLength / base.sourceNormalizedTextLength).toFixed(3)) }));
}
