// User-facing document filenames (task Phase 10).
//
//   Vineet_Agarwal_Resume_CompanyName.pdf
//   Vineet_Agarwal_CoverLetter_CompanyName.pdf
//
// Company names are cleaned of punctuation and compacted. The role is included
// only when asked (to disambiguate multiple applications to one company).
// Collisions get _v2, _v3 ... . User-facing names never expose epoch
// timestamps (internal history files may still be timestamped separately).

const LEGAL_SUFFIXES = /\b(inc|llc|l\.l\.c|ltd|limited|corp|corporation|gmbh|plc|pvt|private)\b/gi;

export function compactName(value, fallback) {
  const cleaned = String(value || "")
    .replace(LEGAL_SUFFIXES, " ")
    .replace(/&/g, " and ")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");
  return cleaned || fallback;
}

// Builds a clean, collision-free user-facing file name.
//   kind: "resume" | "coverLetter"
//   existingNames: iterable of names already present in the target folder.
export function userFacingFileName({
  personName = "Vineet Agarwal",
  kind = "resume",
  company,
  role,
  includeRole = false,
  extension = "pdf",
  existingNames = [],
} = {}) {
  // Person name keeps a readable First_Last shape rather than being compacted.
  const person =
    String(personName || "")
      .trim()
      .split(/\s+/)
      .map((word) => word.replace(/[^A-Za-z0-9]/g, ""))
      .filter(Boolean)
      .join("_") || "Candidate";
  const label = kind === "coverLetter" ? "CoverLetter" : "Resume";
  const companyPart = compactName(company, "Company");
  const rolePart = includeRole ? compactName(role, "") : "";
  const parts = [person, label, companyPart, rolePart].filter(Boolean);
  const base = parts.join("_");
  const taken = new Set(Array.from(existingNames));
  let candidate = `${base}.${extension}`;
  let version = 2;
  while (taken.has(candidate)) {
    candidate = `${base}_v${version}.${extension}`;
    version += 1;
  }
  return candidate;
}
