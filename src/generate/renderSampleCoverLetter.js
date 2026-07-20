import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderCoverLetter, safeCoverLetterFileName } from "./renderCoverLetter.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const bank = JSON.parse(fs.readFileSync(path.join(here, "content-bank.json"), "utf8"));
const content = {
  version: 1,
  opening: "I am applying for the Example AI Engineer role because its focus on reliable model serving matches the systems work I want to continue. My background combines production software engineering with hands-on inference framework integration, benchmarking, and agent orchestration.",
  bodyParagraphs: [
    "At Runara.ai, I implemented speculative decoding across two GPUs in PyTorch and Hugging Face Transformers using probabilistic rejection sampling. I then diagnosed the gap between 92% isolated draft agreement and 29% in-loop acceptance by tracing KV cache and verification input handling. That work sharpened how I isolate numerical and systems behavior before drawing performance conclusions.",
    "I have also built production AI and backend systems around verified operational needs. At ServBeyond Solutions, I shipped a RAG assistant that cut 25 hours of manual lookup per week while reaching 95% answer accuracy across 100 users. Earlier backend work reduced API response time from 75 seconds to under 10 seconds and increased throughput 4x through SQL refactoring, indexing, and Redis caching.",
  ],
  closing: "I would bring careful performance analysis, direct implementation experience, and a strong bias toward validated results to the Example Robotics team. Thank you for considering my application for the role.",
};
const identity = { name: "Jordan Example", location: "Example City, MD", phone: "555-010-2040", email: "jordan@example.test", links: { linkedin: "https://example.test/jordan", github: "", portfolio: "" } };
const job = { company: "Example Robotics", title: "Example AI Engineer" };
const outputDir = path.join(root, "resume", "output");
const texFileName = `${safeCoverLetterFileName(job.company, job.title)}.tex`;
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, texFileName), renderCoverLetter({ bank, content, identity, job, date: new Date("2026-07-19T00:00:00Z") }), "utf8");
console.log(JSON.stringify({ texFileName, outputPath: path.join(outputDir, texFileName) }, null, 2));
