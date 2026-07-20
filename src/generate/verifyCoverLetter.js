import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateCoverLetter } from "./coverLetterValidation.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const bank = JSON.parse(fs.readFileSync(path.join(here, "content-bank.json"), "utf8"));
const texPath = path.join(root, "resume", "output", "example-robotics-example-ai-engineer-cover-letter.tex");
const pdfPath = texPath.replace(/\.tex$/, ".pdf");
if (!fs.existsSync(texPath)) throw new Error("Run renderSampleCoverLetter.js first.");
const tex = fs.readFileSync(texPath, "utf8");
if (!tex.includes("Jordan Example") || tex.includes("Vineet Agarwal")) throw new Error("Sample identity is not clearly fake.");
if (tex.includes("\\documentclass") && /opening|bodyParagraphs|closing/.test(tex)) throw new Error("Raw model structure leaked into LaTeX.");
const sample = { version: 1, opening: "A ".repeat(40), bodyParagraphs: ["B ".repeat(40), "C ".repeat(40)], closing: "D ".repeat(40), claimEvidence: [{ sentence: "Sample factual draft", evidenceIds: ["sample-evidence"] }] };
validateCoverLetter(sample, bank);
try { validateCoverLetter({ ...sample, opening: "Built 999 systems. " + "A ".repeat(40) }, bank); throw new Error("Invented number accepted"); } catch (error) { if (error.message === "Invented number accepted") throw error; }
try { validateCoverLetter({ ...sample, opening: "\\section{Unsafe} " + "A ".repeat(40) }, bank); throw new Error("Raw LaTeX accepted"); } catch (error) { if (error.message === "Raw LaTeX accepted") throw error; }
try { validateCoverLetter({ ...sample, extra: "unsafe" }, bank); throw new Error("Unknown field accepted"); } catch (error) { if (error.message === "Unknown field accepted") throw error; }
console.log(JSON.stringify({ structuredValidation: true, inventedNumbersRejected: true, rawLatexRejected: true, fakeIdentity: true, texPath, pdfExists: fs.existsSync(pdfPath) }, null, 2));
