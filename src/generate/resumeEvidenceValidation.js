import { technologiesIn, acronymsIn, compoundsIn } from "./protectedTerms.js";
import { canonicalBases } from "./baseResumes.js";

const FORBIDDEN = [/cuda\s+(?:kernel|kernels|authoring|optimization)/i, /(?:fused|fuse|fusion)\s+(?:rmsnorm|linear|cuda|kernel)/i, /gpu\s+kernel\s+optimization/i];
const NUMBER_PATTERN = /\b\d+(?:\.\d+)?(?:%|[A-Za-z]+)?\b/g;
const fail = (message) => { throw Object.assign(new Error(`Invalid final resume evidence: ${message}`), { code: "VALIDATION_FAILED" }); };
const numbers = (text) => new Set((String(text || "").match(NUMBER_PATTERN) || []).map((number) => number.toLowerCase()));

export function rewriteViolation(bullet, text) {
  for (const metric of bullet.lockedMetrics || []) if (!text.includes(metric)) return `removed locked metric '${metric}'`;
  if (!bullet.rewritable && text !== bullet.text) return "is not rewritable";
  const sourceNumbers = numbers(bullet.text);
  for (const number of numbers(text)) if (!sourceNumbers.has(number)) return `introduced number '${number}'`;
  for (const pattern of FORBIDDEN) if (pattern.test(text)) return "contains a forbidden CUDA-authoring claim";
  if (text !== bullet.text) {
    const sourceTech = technologiesIn(bullet.text);
    for (const tech of technologiesIn(text)) if (!sourceTech.has(tech)) return `introduced unsupported technology '${tech}'`;
    for (const acronym of acronymsIn(bullet.text)) if (!acronymsIn(text).includes(acronym)) return `dropped acronym '${acronym}'`;
    for (const compound of compoundsIn(bullet.text)) if (!compoundsIn(text).includes(compound)) return `dropped technical compound '${compound}'`;
  }
  return null;
}

function canonicalTextSet() {
  const result = new Map();
  for (const base of canonicalBases) for (const entry of [...base.experience, ...base.projects]) for (const bullet of entry.bullets) {
    if (!result.has(bullet.sourceBulletId)) result.set(bullet.sourceBulletId, new Set());
    result.get(bullet.sourceBulletId).add(bullet.text);
  }
  return result;
}

export function validateResumeEvidenceSelection(bank, selection) {
  if (!selection || selection.version !== 1 || !Array.isArray(selection.experience) || !Array.isArray(selection.projects)) fail("selection structure is invalid");
  const entries = new Map(); const bullets = new Map();
  for (const section of ["experience", "projects"]) for (const entry of bank[section] || []) {
    entries.set(entry.id, { entry, section });
    for (const bullet of entry.bullets || []) bullets.set(bullet.id, { bullet, entry, section });
  }
  const canonicalTexts = canonicalTextSet();
  const seen = new Set(); const rankedBullets = [];
  for (const section of ["experience", "projects"]) for (const selectedEntry of selection[section]) {
    const sourceEntry = entries.get(selectedEntry?.entryId);
    if (!sourceEntry || sourceEntry.section !== section || !Array.isArray(selectedEntry.bullets) || !selectedEntry.bullets.length) fail(`unknown or empty ${section} entry '${selectedEntry?.entryId}'`);
    for (const selected of selectedEntry.bullets) {
      const source = bullets.get(selected?.id);
      if (!source || source.entry.id !== selectedEntry.entryId || seen.has(selected.id)) fail(`unknown or duplicate bullet '${selected?.id}'`);
      seen.add(selected.id);
      const text = selected.rewrittenText ?? source.bullet.text;
      if (typeof text !== "string" || !text.trim()) fail(`bullet '${selected.id}' is empty`);
      if (!canonicalTexts.get(selected.id)?.has(text)) {
        const violation = rewriteViolation(source.bullet, text);
        if (violation) fail(`rewrite of '${selected.id}' ${violation}`);
      }
      rankedBullets.push({ section, entry: source.entry, bullet: source.bullet, text });
    }
  }
  return { ...selection, rankedBullets };
}
