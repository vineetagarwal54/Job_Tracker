import { escapeLatex, escapeLatexWithProtectedTerms } from "./latexEscape.js";
import { validateRendererIdentity } from "./profileIdentity.js";

function latexLink(url) {
  const visible = url.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return `\\href{${escapeLatex(url)}}{${escapeLatex(visible)}}`;
}

function formatSkills(renderedGroups) {
  const groups = renderedGroups;
  const midpoint = Math.ceil(groups.length / 2);
  const column = (items) => items.map((group) =>
    `  \\textbf{${escapeLatex(group.label)}}\\enspace ${escapeLatexWithProtectedTerms(group.items.join(", "))} \\\\[\\skillRowSep]`
  ).join("\n");
  return `\\noindent
\\begin{minipage}[t]{0.48\\textwidth}
  \\vspace{0pt}
${column(groups.slice(0, midpoint))}
\\end{minipage}\\hfill
\\begin{minipage}[t]{0.48\\textwidth}
  \\vspace{0pt}
${column(groups.slice(midpoint))}
\\end{minipage}`;
}

function indexCanonicalBank(bank) {
  return {
    experience: new Map(bank.experience.map((entry) => [entry.id, entry])),
    projects: new Map(bank.projects.map((entry) => [entry.id, entry])),
    education: new Map(bank.education.map((entry) => [entry.id, entry])),
    bullets: new Map([...bank.experience, ...bank.projects].flatMap((entry) => entry.bullets.map((bullet) => [bullet.id, bullet]))),
  };
}

export function validateCanonicalBase(bank, base) {
  if (!base?.id || !base.summary || !Array.isArray(base.skills) || !base.skills.length) throw new Error("Canonical base is incomplete.");
  const index = indexCanonicalBank(bank);
  for (const section of ["experience", "projects"]) {
    if (!Array.isArray(base[section]) || !base[section].length) throw new Error(`${base.id}: ${section} is empty.`);
    for (const selected of base[section]) {
      if (!index[section].has(selected.entryId)) throw new Error(`${base.id}: unknown ${section} entry '${selected.entryId}'.`);
      if (!selected.bullets?.length) throw new Error(`${base.id}: '${selected.entryId}' has no bullets.`);
      for (const bullet of selected.bullets) {
        if (!index.bullets.has(bullet.sourceBulletId)) throw new Error(`${base.id}: unknown source bullet '${bullet.sourceBulletId}'.`);
        if (!String(bullet.text || "").trim()) throw new Error(`${base.id}: canonical bullet text is empty.`);
      }
    }
  }
  if (!index.education.has(base.education?.educationId)) throw new Error(`${base.id}: unknown education entry.`);
  return base;
}

function formatCanonicalEntry(index, selected, section) {
  const source = index[section].get(selected.entryId);
  const org = selected.title || source.org;
  const role = selected.role !== undefined ? selected.role : source.role;
  const dates = selected.dates || "";
  const title = section === "projects" && source.link
    ? `${escapeLatex(org)}${role ? `: ${escapeLatex(role)}` : ""} ${latexLink(source.link)}`
    : escapeLatex(org);
  const heading = section === "experience"
    ? `  \\headingBf{${title}}{${escapeLatex(dates)}}\n  \\headingIt{${escapeLatex(role)}}{${escapeLatex(selected.location || "")}}`
    : `  \\headingBf{${title}}{${escapeLatex(dates)}}`;
  const bullets = selected.bullets.map((bullet) => `    \\item ${escapeLatexWithProtectedTerms(bullet.text)}`).join("\n");
  return `${heading}\n  \\begin{resume_list}\n${bullets}\n  \\end{resume_list}`;
}

// Canonical bases bypass selection ranking and line-budget trimming. Their PDFs
// are the approved one-page documents, so every represented byte of content is
// rendered in source order. This path is deliberately separate from tailoring.
export function renderCanonicalBase({ bank, base, template, identity }) {
  validateCanonicalBase(bank, base);
  const runtimeIdentity = validateRendererIdentity(identity);
  const index = indexCanonicalBank(bank);
  const preambleEnd = template.indexOf("\\begin{document}");
  if (preambleEnd === -1) throw new Error("Template is missing \\begin{document}.");
  const preamble = template.slice(0, preambleEnd + "\\begin{document}".length);
  const educationSource = index.education.get(base.education.educationId);
  const contactParts = [];
  if (runtimeIdentity.phone) contactParts.push(`\\href{tel:${runtimeIdentity.phone.replace(/\D/g, "")}}{${escapeLatex(runtimeIdentity.phone)}}`);
  contactParts.push(`\\href{mailto:${escapeLatex(runtimeIdentity.email)}}{${escapeLatex(runtimeIdentity.email)}}`);
  for (const key of ["linkedin", "github", "portfolio"]) if (runtimeIdentity.links[key]) contactParts.push(latexLink(runtimeIdentity.links[key]));
  const experience = base.experience.map((entry) => formatCanonicalEntry(index, entry, "experience")).join("\n\n");
  const projects = base.projects.map((entry) => formatCanonicalEntry(index, entry, "projects")).join("\n\n");
  const educationNotes = (base.education.notes || []).length
    ? `\n  \\begin{resume_list}\n${base.education.notes.map((note) => `    \\item ${escapeLatexWithProtectedTerms(note)}`).join("\n")}\n  \\end{resume_list}`
    : "";
  const body = `\n\n  % Canonical-base spacing uses only the template's consolidated dials.\n  \\setlength{\\sectionBefore}{5pt}\n  \\setlength{\\sectionAfter}{4pt}\n  \\setlength{\\listTopSep}{0pt}\n  \\setlength{\\listBottomTrim}{-4pt}\n  \\setlength{\\headerRuleGap}{4pt}\n  \\renewcommand{\\skillRowSep}{0pt}\n\n  \\documentTitle{${escapeLatex(runtimeIdentity.name)}}{\n    ${contactParts.join(" |\n    ")}\n  }\n\n  \\tinysection{Summary}\n  ${escapeLatexWithProtectedTerms(base.summary)}\n\n  \\section{Skills}\n\n${formatSkills(base.skills)}\n\n  \\section{Experience}\n\n${experience}\n\n  \\section{Education}\n\n  \\headingBf{${escapeLatex(educationSource.school)}}{${escapeLatex(base.education.dates || "")}}\n  \\headingIt{${escapeLatex(base.education.degree || educationSource.degree)}}{${escapeLatex(base.education.gpa || "")}}${educationNotes}\n\n  \\section{Projects}\n\n${projects}\n\n\\end{document}\n`;
  return { tex: `${preamble}${body}`, baseResumeId: base.id };
}

export function safeResumeFileName(company, role) {
  const base = `${company || "resume"}-${role || "resume"}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "resume";
}
