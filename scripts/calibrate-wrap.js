// THROWAWAY calibration script. Not committed, not part of the app build.
//
// Generates synthetic Experience-section bullets at controlled rendered
// character lengths (two glyph-width variants each), compiles them into the
// real resume/template/main.tex geometry via tectonic, then measures actual
// rendered line counts per bullet (via the same x0-clustering method used in
// the Task A budget script) to find the true 1->2 and 2->3 wrap thresholds.
//
// Usage: node scripts/calibrate-wrap.js

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..");
const MAIN_TEX = path.join(REPO_ROOT, "resume", "template", "main.tex");

const TECTONIC = "C:\\Users\\Vineet Agarwal\\AppData\\Local\\Programs\\tectonic\\tectonic.exe";
const PYTHON = "C:\\Python311\\python.exe";
const WORKDIR = "C:\\Users\\VINEET~1\\AppData\\Local\\Temp\\claude\\D--Projects-JobTrack\\28ca12da-0360-460c-bf6b-9b249061fcbf\\scratchpad";

const CHARS_PER_LINE = 119;
const LENGTHS = [100, 110, 115, 118, 119, 120, 125, 130, 140, 225, 232, 236, 238, 240, 245, 250];

// -------------------------------------------------------------- word banks --
// Real resume/tech vocabulary, biased toward the requested glyph classes.
// Not lorem ipsum: every word here is drawn from the actual resume/skills
// vocabulary used elsewhere in this project (main.tex, content-bank context).
const WIDE_WORDS = [
  "Migrated", "Managed", "Monitored", "Maximized", "Modernized", "Windows",
  "WebRTC", "MongoDB", "Kubernetes", "TensorRT", "Amazon", "Network",
  "Nationwide", "Warehouse", "Mainframe", "Multi-Agent", "Workflow",
  "Massive", "Redis", "DynamoDB", "CloudFormation", "PostgreSQL", "40%",
  "95%", "100%", "GPU", "RAM", "WWW", "NVMe", "Docker",
];

const NARROW_WORDS = [
  "implemented", "infrastructure", "latency", "inference", "optimization",
  "initialization", "distributed", "iterative", "filtering", "throttling",
  "artificial", "intelligence", "fulfillment", "trafficking", "interfacing",
  "utilities", "linter", "illustrate", "filter", "refactor", "first",
  "still", "skill", "drill", "fill", "till", "thrill", "tilt", "flirt",
  "frailty",
];

// ------------------------------------------------------------- generator ---
// Cycles the word bank, then slices to EXACTLY targetLen rendered chars
// (a trailing period replaces the final char so the count is exact).
function buildText(words, targetLen) {
  let out = "";
  let i = 0;
  while (out.length < targetLen) {
    out += (out.length === 0 ? "" : " ") + words[i % words.length];
    i++;
  }
  out = out.slice(0, targetLen - 1) + ".";
  out = out.charAt(0).toUpperCase() + out.slice(1);
  if (out.length !== targetLen) {
    throw new Error(`buildText length mismatch: wanted ${targetLen}, got ${out.length}`);
  }
  return out;
}

// LaTeX-escape for the SOURCE only. Char counts always refer to the
// pre-escape rendered string, matching how Task A counted real bullets.
function escapeLatex(s) {
  return s.replace(/[%&$#_{}~^\\]/g, (ch) => {
    switch (ch) {
      case "%": return "\\%";
      case "&": return "\\&";
      case "$": return "\\$";
      case "#": return "\\#";
      case "_": return "\\_";
      case "{": return "\\{";
      case "}": return "\\}";
      case "~": return "\\textasciitilde{}";
      case "^": return "\\textasciicircum{}";
      case "\\": return "\\textbackslash{}";
      default: return ch;
    }
  });
}

const cases = [];
for (const len of LENGTHS) {
  cases.push({ label: `L${len}W`, variant: "WIDE", len, text: buildText(WIDE_WORDS, len) });
  cases.push({ label: `L${len}N`, variant: "NARROW", len, text: buildText(NARROW_WORDS, len) });
}

// ---------------------------------------------------- splice into main.tex --
const origTex = fs.readFileSync(MAIN_TEX, "utf8");
const startMarker = "\\section{Experience}";
const endMarker = "\\section{Education}";
const startIdx = origTex.indexOf(startMarker) + startMarker.length;
const endIdx = origTex.indexOf(endMarker);
if (startIdx < 0 || endIdx < 0) {
  throw new Error("Could not find Experience/Education section markers in main.tex");
}

const entryTex = cases
  .map((c) => [
    `  \\headingBf{${c.label}}{}`,
    `  \\headingIt{calib}{}`,
    `  \\begin{resume_list}`,
    `    \\item ${escapeLatex(c.text)}`,
    `  \\end{resume_list}`,
    "",
  ].join("\n"))
  .join("\n");

const testTex = origTex.slice(0, startIdx) + "\n\n" + entryTex + "\n" + origTex.slice(endIdx);

const testTexPath = path.join(WORKDIR, "calibrate-wrap.tex");
fs.writeFileSync(testTexPath, testTex, "utf8");
console.log(`Wrote ${cases.length} synthetic bullets to ${testTexPath}`);

// -------------------------------------------------------------- compile ----
console.log("Compiling with tectonic...");
execFileSync(TECTONIC, [testTexPath, "--outdir", WORKDIR], { stdio: "inherit" });

const testPdfPath = path.join(WORKDIR, "calibrate-wrap.pdf");

// ------------------------------------------------- measure via pdfplumber --
// Same x0-clustering approach as Task A's budget script (heading x0 <
// bullet-marker x0 < continuation x0), generalized across ALL pages since
// 32 synthetic entries span several pages.
const pyScript = `
import json
import pdfplumber

PDF_PATH = ${JSON.stringify(testPdfPath)}
BULLET_GLYPH = "\\u2022"

pdf = pdfplumber.open(PDF_PATH)

def group_lines(chars, tol=0.7):
    lines = []
    for c in sorted(chars, key=lambda c: (c["top"], c["x0"])):
        for line in lines:
            if abs(line["top"] - c["top"]) <= tol:
                line["chars"].append(c)
                break
        else:
            lines.append({"top": c["top"], "chars": [c]})
    for line in lines:
        line["chars"].sort(key=lambda c: c["x0"])
        line["top"] = sum(cc["top"] for cc in line["chars"]) / len(line["chars"])
        line["x0"] = line["chars"][0]["x0"]
        text = ""
        prev_x1 = None
        for c in line["chars"]:
            if prev_x1 is not None and c["x0"] - prev_x1 > 1.2:
                text += " "
            text += c["text"]
            prev_x1 = c["x1"]
        line["text"] = text
    lines.sort(key=lambda l: l["top"])
    return lines

all_lines = []
for page_idx, page in enumerate(pdf.pages):
    for l in group_lines(page.chars):
        all_lines.append({"page": page_idx, "top": l["top"], "x0": l["x0"], "text": l["text"]})
all_lines.sort(key=lambda l: (l["page"], l["top"]))

def find_exact(text, after=0):
    for i in range(after, len(all_lines)):
        if all_lines[i]["text"].strip() == text:
            return i
    return None

start_i = find_exact("Experience")
end_i = find_exact("Education", after=start_i + 1)
if start_i is None or end_i is None:
    raise SystemExit(f"markers not found: start={start_i} end={end_i}")

band = all_lines[start_i + 1:end_i]

x0_vals = sorted(set(round(l["x0"], 1) for l in band))
heading_x0 = x0_vals[0]

attr = []
for l in band:
    x0 = round(l["x0"], 1)
    if x0 == heading_x0:
        kind = "heading"
    elif l["text"].strip().startswith(BULLET_GLYPH):
        kind = "bullet_start"
    else:
        kind = "bullet_cont"
    attr.append({"kind": kind, "text": l["text"]})

results = []
i = 0
while i < len(attr):
    label = None
    while i < len(attr) and attr[i]["kind"] == "heading":
        if label is None:
            label = attr[i]["text"].strip()
        i += 1
    if label is None:
        break
    if attr[i]["kind"] != "bullet_start":
        raise SystemExit(f"expected bullet_start after {label!r}, got {attr[i]!r}")
    lines = 1
    i += 1
    while i < len(attr) and attr[i]["kind"] == "bullet_cont":
        lines += 1
        i += 1
    results.append({"label": label, "actual_lines": lines})

print(json.dumps(results))
`;

const pyScriptPath = path.join(WORKDIR, "measure_calibration.py");
fs.writeFileSync(pyScriptPath, pyScript, "utf8");

console.log("Measuring rendered line counts...");
const stdout = execFileSync(PYTHON, [pyScriptPath], { encoding: "utf8" });
const jsonLine = stdout.trim().split("\n").pop();
const results = JSON.parse(jsonLine);

const actualByLabel = new Map(results.map((r) => [r.label, r.actual_lines]));

const rows = cases.map((c) => {
  const actual = actualByLabel.get(c.label);
  const predicted = Math.ceil(c.len / CHARS_PER_LINE);
  return { ...c, actual, predicted, match: actual === predicted };
});

if (rows.some((r) => r.actual === undefined)) {
  console.error("Missing measurements for:", rows.filter((r) => r.actual === undefined).map((r) => r.label));
  process.exit(1);
}

// ------------------------------------------------------------- reporting --
console.log("\n=== PER-BULLET RESULTS ===");
console.log(`${"label".padEnd(8)} ${"variant".padEnd(8)} ${"len".padStart(5)} ${"ceil(len/119)".padStart(14)} ${"actual".padStart(7)} ${"match".padStart(6)}`);
for (const r of rows) {
  console.log(
    `${r.label.padEnd(8)} ${r.variant.padEnd(8)} ${String(r.len).padStart(5)} ` +
    `${String(r.predicted).padStart(14)} ${String(r.actual).padStart(7)} ${(r.match ? "OK" : "DIFF").padStart(6)}`
  );
}

function thresholds(variant) {
  const sorted = rows.filter((r) => r.variant === variant).sort((a, b) => a.len - b.len);
  const firstGroup = sorted.filter((r) => r.len <= 140);
  const secondGroup = sorted.filter((r) => r.len >= 225);

  const lastOneLine = [...firstGroup].reverse().find((r) => r.actual === 1);
  const firstTwoLine = firstGroup.find((r) => r.actual >= 2);
  const lastTwoLine = [...secondGroup].reverse().find((r) => r.actual === 2);
  const firstThreeLine = secondGroup.find((r) => r.actual >= 3);

  return { lastOneLine, firstTwoLine, lastTwoLine, firstThreeLine };
}

console.log("\n=== THRESHOLDS ===");
const results_by_variant = {};
for (const variant of ["WIDE", "NARROW"]) {
  const t = thresholds(variant);
  results_by_variant[variant] = t;
  console.log(`\n${variant}:`);
  console.log(`  1->2 wrap: last 1-line at ${t.lastOneLine ? t.lastOneLine.len : "none tested"} chars, ` +
    `first 2-line at ${t.firstTwoLine ? t.firstTwoLine.len : "not reached in tested range"} chars`);
  console.log(`  2->3 wrap: last 2-line at ${t.lastTwoLine ? t.lastTwoLine.len : "none tested"} chars, ` +
    `first 3-line at ${t.firstThreeLine ? t.firstThreeLine.len : "not reached in tested range"} chars`);
}

const firstTwoLens = ["WIDE", "NARROW"]
  .map((v) => results_by_variant[v].firstTwoLine)
  .filter(Boolean)
  .map((r) => r.len);
const firstThreeLens = ["WIDE", "NARROW"]
  .map((v) => results_by_variant[v].firstThreeLine)
  .filter(Boolean)
  .map((r) => r.len);

console.log("\n=== SAFE CONSTANT ===");
if (firstTwoLens.length > 0) {
  const lowest12 = Math.min(...firstTwoLens);
  console.log(`Lowest observed 1->2 wrap threshold across both variants: ${lowest12} chars`);
  console.log(`SAFE constant (largest length guaranteed to stay 1 line in both variants): ${lowest12 - 1} chars`);
} else {
  console.log("No 1->2 transition observed in tested range for either variant.");
}
if (firstThreeLens.length > 0) {
  const lowest23 = Math.min(...firstThreeLens);
  console.log(`Lowest observed 2->3 wrap threshold across both variants: ${lowest23} chars`);
}

console.log(`\nCurrent constant in use: ${CHARS_PER_LINE} chars/line`);
console.log(`Test artifacts left in: ${WORKDIR}`);
