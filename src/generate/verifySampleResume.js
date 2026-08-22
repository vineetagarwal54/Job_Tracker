import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { escapeLatex } from "./latexEscape.js";
import { renderResume } from "./renderResume.js";
import { validateContentBank } from "./validateContentBank.js";
import { validateSelection } from "./validateSelection.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const bank = JSON.parse(fs.readFileSync(path.join(here, "content-bank.json"), "utf8"));
const selection = JSON.parse(fs.readFileSync(path.join(here, "sample-ai-selection.json"), "utf8"));
const template = fs.readFileSync(path.join(root, "resume", "template", "main.tex"), "utf8");
const bankResult = validateContentBank(bank);
if (!bankResult.valid) throw new Error(bankResult.errors.join("\n"));

const escapeProbe = "R&D 50% #tag_name {x} ~ ^ \\";
const escapedProbe = escapeLatex(escapeProbe);
for (const expected of ["\\&", "\\%", "\\#", "\\_", "\\{", "\\}", "\\textasciitilde{}", "\\textasciicircum{}", "\\textbackslash{}"]) {
  if (!escapedProbe.includes(expected)) throw new Error(`LaTex escaping missed '${expected}'`);
}

const identity = { name: "Jordan Example", location: "Example City, MD", phone: "555-010-2040", email: "jordan@example.test", links: { linkedin: "", github: "https://example.test/code", portfolio: "" } };
const rendered = renderResume({ bank, selection, template, identity });
try {
  renderResume({ bank, selection, template });
  throw new Error("Renderer accepted missing runtime identity");
} catch (error) {
  if (error.message === "Renderer accepted missing runtime identity") throw error;
}
if (rendered.tex.includes(" |\n    \n") || rendered.tex.includes(" |\n  }")) throw new Error("Optional identity fields rendered an empty separator");
const included = rendered.budget.included.flatMap((entry) => entry.bullets);
const verbs = new Set();
for (const item of included) {
  const verb = item.text.match(/^([A-Za-z]+)/)?.[1]?.toLowerCase();
  if (!verb || verbs.has(verb)) throw new Error(`Duplicate or missing action verb '${verb || "unknown"}'`);
  verbs.add(verb);
  for (const metric of item.bullet.lockedMetrics) {
    if (!rendered.tex.includes(escapeLatex(metric))) throw new Error(`Missing locked metric '${metric}' in rendered TeX`);
  }
}

function expectInvalid(candidate, label) {
  try {
    validateSelection(bank, candidate);
  } catch {
    return;
  }
  throw new Error(`Selection validation accepted ${label}`);
}

expectInvalid({ ...selection, extraSection: [] }, "an unknown section");
expectInvalid({
  ...selection,
  experience: [
    { entryId: "servbeyond-enterprise-ai-platform-intern", bullets: [{ id: "servbeyond-rag-assistant", rewrittenText: "Built a RAG assistant for 999 users." }] },
  ],
}, "a rewrite with an invented number");

console.log(JSON.stringify({
  contentBankValid: true,
  latexEscapingValid: true,
  lockedMetricsPreserved: true,
  duplicateActionVerbs: false,
  selectionGuardsValid: true,
  runtimeIdentityRequired: true,
  optionalIdentityFieldsClean: true,
  includedBulletIds: included.map((item) => item.bullet.id),
  excluded: rendered.budget.excluded,
}, null, 2));
