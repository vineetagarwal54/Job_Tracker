import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderResume, safeResumeFileName } from "./renderResume.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const bank = JSON.parse(fs.readFileSync(path.join(here, "content-bank.json"), "utf8"));
const selection = JSON.parse(fs.readFileSync(path.join(here, "sample-ai-selection.json"), "utf8"));
const template = fs.readFileSync(path.join(root, "resume", "template", "main.tex"), "utf8");
const outputDir = path.join(root, "resume", "output");
const outputPath = path.join(outputDir, `${safeResumeFileName("sample", "ai-resume")}.tex`);

fs.mkdirSync(outputDir, { recursive: true });
const result = renderResume({ bank, selection, template });
fs.writeFileSync(outputPath, result.tex, "utf8");
console.log(JSON.stringify({
  outputPath,
  includedBulletIds: result.budget.included.flatMap((entry) => entry.bullets.map((bullet) => bullet.bullet.id)),
  excluded: result.budget.excluded,
  usedLines: result.budget.usedLines,
  availableLines: result.budget.availableLines,
}, null, 2));
