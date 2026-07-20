const path = require("path");
const { execFileSync } = require("child_process");
const { countPages } = require("./anthropic/orchestrator.cjs");

const root = path.resolve(__dirname, "..");
const output = path.join(root, "resume", "output");
const files = ["sample-ai-resume", "example-robotics-example-ai-engineer-cover-letter"];
for (const base of files) execFileSync("tectonic", [path.join(output, `${base}.tex`), "--outdir", output], { cwd: output, windowsHide: true, stdio: "ignore" });
const pages = Object.fromEntries(files.map(base => [base, countPages(path.join(output, `${base}.pdf`))]));
for (const [file, pageCount] of Object.entries(pages)) if (pageCount !== 1) throw new Error(`${file}.pdf has ${pageCount} pages.`);
console.log(JSON.stringify({ tectonicCompilation: true, pages }, null, 2));
