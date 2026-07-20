import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const VARIANT_IDS = ["ai-llm", "cloud-backend", "fullstack", "mobile", "academic"];
const REQUIRED_TOP_LEVEL_FIELDS = [
  "meta", "identity", "summary", "education", "skillGroups", "experience", "projects", "doNotClaim",
];
const FORBIDDEN_CLAIM_PATTERNS = [
  /cuda\s+(?:kernel|kernels|authoring|optimization)/i,
  /(?:fused|fuse|fusion)\s+(?:rmsnorm|linear|cuda|kernel)/i,
  /gpu\s+kernel\s+optimization/i,
  /rmsnorm.*kernel/i,
];

function assert(condition, message, errors) {
  if (!condition) errors.push(message);
}

function validateVariants(variants, context, errors) {
  assert(Array.isArray(variants) && variants.length > 0, `${context}: variants must be a non-empty array`, errors);
  for (const variant of variants || []) {
    assert(VARIANT_IDS.includes(variant), `${context}: invalid variant '${variant}'`, errors);
  }
}

function validateEntries(entries, kind, ids, errors) {
  assert(Array.isArray(entries), `${kind} must be an array`, errors);
  for (const entry of entries || []) {
    const context = `${kind}:${entry?.id || "<missing id>"}`;
    assert(entry && typeof entry === "object", `${context}: entry must be an object`, errors);
    for (const field of ["id", "org", "role", "dates", "variants", "bullets"]) {
      assert(Object.hasOwn(entry || {}, field), `${context}: missing '${field}'`, errors);
    }
    assert(typeof entry?.id === "string" && entry.id.length > 0, `${context}: id must be a non-empty string`, errors);
    assert(!ids.has(entry?.id), `duplicate id '${entry?.id}'`, errors);
    ids.add(entry?.id);
    validateVariants(entry?.variants, context, errors);
    for (const bullet of entry?.bullets || []) {
      const bulletContext = `${context}:${bullet?.id || "<missing id>"}`;
      for (const field of ["id", "text", "chars", "skills", "variants", "lockedMetrics", "priority", "rewritable"]) {
        assert(Object.hasOwn(bullet || {}, field), `${bulletContext}: missing '${field}'`, errors);
      }
      assert(typeof bullet?.id === "string" && bullet.id.length > 0, `${bulletContext}: id must be a non-empty string`, errors);
      assert(!ids.has(bullet?.id), `duplicate id '${bullet?.id}'`, errors);
      ids.add(bullet?.id);
      assert(typeof bullet?.text === "string" && bullet.text.length > 0, `${bulletContext}: text must be a non-empty string`, errors);
      assert(bullet?.chars === bullet?.text?.length, `${bulletContext}: chars must equal exact text length ${bullet?.text?.length}`, errors);
      assert(Array.isArray(bullet?.skills) && bullet.skills.every((skill) => skill === skill.toLowerCase()), `${bulletContext}: skills must be normalized lowercase strings`, errors);
      validateVariants(bullet?.variants, bulletContext, errors);
      assert(Array.isArray(bullet?.lockedMetrics), `${bulletContext}: lockedMetrics must be an array`, errors);
      for (const metric of bullet?.lockedMetrics || []) {
        assert(bullet.text.includes(metric), `${bulletContext}: locked metric '${metric}' is absent from text`, errors);
      }
      assert(Number.isInteger(bullet?.priority) && bullet.priority > 0, `${bulletContext}: priority must be a positive integer`, errors);
      assert(typeof bullet?.rewritable === "boolean", `${bulletContext}: rewritable must be boolean`, errors);
      for (const pattern of FORBIDDEN_CLAIM_PATTERNS) {
        assert(!pattern.test(bullet?.text || ""), `${bulletContext}: contains a forbidden CUDA-authoring claim`, errors);
      }
    }
  }
}

export function validateContentBank(bank) {
  const errors = [];
  assert(bank && typeof bank === "object", "content bank must be an object", errors);
  for (const field of REQUIRED_TOP_LEVEL_FIELDS) {
    assert(Object.hasOwn(bank || {}, field), `missing top-level '${field}'`, errors);
  }
  assert(bank?.meta?.version === 1, "meta.version must be 1", errors);
  for (const field of ["name", "location", "phone", "email", "links"]) {
    assert(Object.hasOwn(bank?.identity || {}, field), `identity: missing '${field}'`, errors);
  }
  assert(typeof bank?.identity?.name === "string" && bank.identity.name.trim(), "identity.name must be a non-empty string", errors);
  assert(typeof bank?.identity?.email === "string" && bank.identity.email.trim(), "identity.email must be a non-empty string", errors);
  for (const field of ["location", "phone"]) assert(typeof bank?.identity?.[field] === "string", `identity.${field} must be a string`, errors);
  for (const field of ["linkedin", "github", "portfolio"]) {
    assert(typeof bank?.identity?.links?.[field] === "string", `identity.links.${field} must be a string`, errors);
  }
  assert(typeof bank?.summary?.text === "string" && bank.summary.text.length > 0, "summary.text must be a non-empty string", errors);
  validateVariants(bank?.summary?.variants, "summary", errors);
  const ids = new Set();
  for (const education of bank?.education || []) {
    assert(typeof education?.id === "string" && education.id.length > 0, "education: id must be a non-empty string", errors);
    assert(!ids.has(education?.id), `duplicate id '${education?.id}'`, errors);
    ids.add(education?.id);
  }
  for (const group of bank?.skillGroups || []) {
    assert(typeof group?.id === "string" && group.id.length > 0, "skillGroups: id must be a non-empty string", errors);
    assert(!ids.has(group?.id), `duplicate id '${group?.id}'`, errors);
    ids.add(group?.id);
    validateVariants(group?.variants, `skillGroups:${group?.id}`, errors);
  }
  validateEntries(bank?.experience, "experience", ids, errors);
  validateEntries(bank?.projects, "projects", ids, errors);
  assert(Array.isArray(bank?.doNotClaim) && bank.doNotClaim.length > 0, "doNotClaim must be a non-empty array", errors);
  for (const requiredClaim of ["CUDA kernel authoring", "low-level kernel fusion", "GPU kernel optimization"]) {
    assert(bank?.doNotClaim?.includes(requiredClaim), `doNotClaim must include '${requiredClaim}'`, errors);
  }
  return { valid: errors.length === 0, errors };
}

function runCli() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const bankPath = process.argv[2] || path.join(here, "content-bank.json");
  let bank;
  try {
    bank = JSON.parse(fs.readFileSync(bankPath, "utf8"));
  } catch (error) {
    console.error(`Invalid JSON: ${error.message}`);
    process.exitCode = 1;
    return;
  }
  const result = validateContentBank(bank);
  if (!result.valid) {
    console.error(result.errors.join("\n"));
    process.exitCode = 1;
    return;
  }
  const experienceBullets = bank.experience.reduce((total, entry) => total + entry.bullets.length, 0);
  const projectBullets = bank.projects.reduce((total, entry) => total + entry.bullets.length, 0);
  console.log(`Content bank valid: ${experienceBullets} experience bullets, ${projectBullets} project bullets.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runCli();
