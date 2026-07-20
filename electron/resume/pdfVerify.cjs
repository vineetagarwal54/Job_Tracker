const fs = require("fs");
const zlib = require("zlib");

// Inflate every stream object in the PDF into one latin1 blob. Content streams,
// ToUnicode CMaps and object streams are all Flate-encoded here.
function inflateAllStreams(bytes) {
  const chunks = [];
  let cursor = 0;
  while ((cursor = bytes.indexOf(Buffer.from("stream"), cursor)) !== -1) {
    let start = cursor + 6;
    if (bytes[start] === 13) start++;
    if (bytes[start] === 10) start++;
    const end = bytes.indexOf(Buffer.from("endstream"), start);
    if (end === -1) break;
    let compressedEnd = end;
    while (compressedEnd > start && (bytes[compressedEnd - 1] === 10 || bytes[compressedEnd - 1] === 13)) compressedEnd--;
    try {
      chunks.push(zlib.inflateSync(bytes.subarray(start, compressedEnd)).toString("latin1"));
    } catch {
      chunks.push(bytes.subarray(start, compressedEnd).toString("latin1"));
    }
    cursor = end + 9;
  }
  return chunks.join("\n");
}

function pageCountFrom(blob) {
  return blob.match(/\/Type\s*\/Page(?!s)\b/g)?.length || null;
}

// Build a glyph-id -> unicode map from the embedded ToUnicode CMaps, then decode
// every hex-shown string. This mirrors how a real ATS extracts text from an
// XeTeX/OpenType PDF (glyphs are shown by id, mapped back through ToUnicode).
function decodeText(blob) {
  const map = new Map();
  for (const block of blob.match(/beginbfchar([\s\S]*?)endbfchar/g) || []) {
    for (const m of block.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) {
      map.set(m[1].toLowerCase(), String.fromCharCode(parseInt(m[2].slice(0, 4), 16)));
    }
  }
  for (const block of blob.match(/beginbfrange([\s\S]*?)endbfrange/g) || []) {
    for (const m of block.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) {
      const a = parseInt(m[1], 16);
      const b = parseInt(m[2], 16);
      const d = parseInt(m[3], 16);
      for (let i = 0; a + i <= b; i++) {
        map.set((a + i).toString(16).padStart(m[1].length, "0"), String.fromCharCode(d + i));
      }
    }
  }
  let out = "";
  for (const m of blob.matchAll(/<([0-9a-fA-F]+)>/g)) {
    const hex = m[1].toLowerCase();
    for (let i = 0; i + 4 <= hex.length; i += 4) out += map.get(hex.slice(i, i + 4)) || "";
  }
  return out;
}

function textOperatorCount(blob) {
  return (blob.match(/\bTJ\b/g) || []).length + (blob.match(/\bTj\b/g) || []).length;
}

// Task Phase 9: after generating a PDF confirm it carries a real, extractable
// text layer (not image-only or vector-only), is exactly one page, and actually
// contains the candidate name and the major section headings.
function verifyPdfAtsIntegrity(pdfPath, options = {}) {
  const errors = [];
  if (!fs.existsSync(pdfPath)) return { valid: false, errors: ["PDF file does not exist."], pageCount: null };
  const bytes = fs.readFileSync(pdfPath);
  const blob = inflateAllStreams(bytes);
  const pageCount = pageCountFrom(blob);
  const operators = textOperatorCount(blob);
  const decoded = decodeText(blob);
  const normalized = decoded.toLowerCase().replace(/\s+/g, "");

  if (pageCount !== 1) errors.push(`page count is ${pageCount ?? "unknown"}, expected exactly one`);
  if (operators === 0) errors.push("no text-showing operators found (image-only or vector-only)");
  if (normalized.length === 0) errors.push("no extractable text layer");

  if (options.expectedName) {
    const wanted = options.expectedName.toLowerCase().replace(/\s+/g, "");
    if (wanted && !normalized.includes(wanted)) errors.push(`candidate name '${options.expectedName}' not found in text layer`);
  }
  const headings = options.headings || ["Summary", "Skills", "Experience", "Education", "Projects"];
  for (const heading of headings) {
    if (!normalized.includes(heading.toLowerCase())) errors.push(`section heading '${heading}' not found in text layer`);
  }

  // Task Part 4: confirm specific technical terms survived intact in the
  // extracted text (no hyphenation split). Whitespace is stripped so a phrase
  // like "React Native" matches, while a hyphenation break ("Kuber-netes")
  // would not.
  const splitTerms = [];
  for (const term of options.requiredTerms || []) {
    const wanted = String(term).toLowerCase().replace(/\s+/g, "");
    if (wanted && !normalized.includes(wanted)) splitTerms.push(term);
  }
  if (splitTerms.length) errors.push(`technical terms missing or split in text layer: ${splitTerms.join(", ")}`);

  return { valid: errors.length === 0, errors, pageCount, textOperatorCount: operators, textLength: normalized.length, splitTerms };
}

module.exports = { verifyPdfAtsIntegrity, inflateAllStreams, decodeText, pageCountFrom };
