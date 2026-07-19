import { escapeLatex, escapeLatexWithProtectedTerms } from "./latexEscape.js";
import { budgetSelection } from "./lineBudget.js";
import { validateSelection } from "./validateSelection.js";
import { validateRendererIdentity } from "./profileIdentity.js";

function latexLink(url) {
  const visible = url.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return `\\href{${escapeLatex(url)}}{${escapeLatex(visible)}}`;
}

function formatSkills(bank, skillGroupIds) {
  const groups = skillGroupIds.map((id) => bank.skillGroups.find((group) => group.id === id));
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

function formatEntry(item) {
  const { entry, bullets, section } = item;
  const title = section === "projects" && entry.link
    ? `${escapeLatex(entry.org)}: ${escapeLatex(entry.role)} ${latexLink(entry.link)}`
    : `${escapeLatex(entry.org)}${section === "projects" ? `: ${escapeLatex(entry.role)}` : ""}`;
  const heading = section === "experience"
    ? `  \\headingBf{${title}}{${escapeLatex(entry.dates)}}
  \\headingIt{${escapeLatex(entry.role)}}{}`
    : `  \\headingBf{${title}}{}`;
  const list = bullets.map((bullet) => `    \\item ${escapeLatexWithProtectedTerms(bullet.text)}`).join("\n");
  return `${heading}
  \\begin{resume_list}
${list}
  \\end{resume_list}`;
}

function finalSelectionFromBudget(selection, budget) {
  const next = {
    version: selection.version,
    variant: selection.variant,
    educationId: selection.educationId,
    skillGroupIds: selection.skillGroupIds,
    experience: [],
    projects: [],
  };
  for (const item of budget.included) {
    next[item.section].push({
      entryId: item.entry.id,
      bullets: item.bullets.map(({ bullet, text }) => text === bullet.text ? { id: bullet.id } : { id: bullet.id, rewrittenText: text }),
    });
  }
  return next;
}

export function safeResumeFileName(company, role) {
  const base = `${company || "resume"}-${role || "resume"}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "resume";
}

export function renderResume({ bank, selection, template, identity }) {
  const runtimeIdentity = validateRendererIdentity(identity);
  const initialSelection = validateSelection(bank, selection, { requireUniqueActionVerbs: false });
  const budget = budgetSelection(initialSelection);
  const finalSelection = finalSelectionFromBudget(selection, budget);
  validateSelection(bank, finalSelection, { requireUniqueActionVerbs: true });

  const preambleEnd = template.indexOf("\\begin{document}");
  if (preambleEnd === -1) throw new Error("Template is missing \\begin{document}.");
  const preamble = template.slice(0, preambleEnd + "\\begin{document}".length);
  const education = bank.education.find((item) => item.id === selection.educationId);
  const experience = budget.included.filter((item) => item.section === "experience").map(formatEntry).join("\n\n");
  const projects = budget.included.filter((item) => item.section === "projects").map(formatEntry).join("\n\n");
  const contactParts = [];
  if (runtimeIdentity.location) contactParts.push(escapeLatex(runtimeIdentity.location));
  if (runtimeIdentity.phone) contactParts.push(`\\href{tel:${runtimeIdentity.phone.replace(/\D/g, "")}}{${escapeLatex(runtimeIdentity.phone)}}`);
  contactParts.push(`\\href{mailto:${escapeLatex(runtimeIdentity.email)}}{${escapeLatex(runtimeIdentity.email)}}`);
  for (const key of ["linkedin", "github", "portfolio"]) {
    if (runtimeIdentity.links[key]) contactParts.push(latexLink(runtimeIdentity.links[key]));
  }

  const body = `

  \\documentTitle{${escapeLatex(runtimeIdentity.name)}}{
    ${contactParts.join(" |\n    ")}
  }

  \\tinysection{Summary}
  ${escapeLatexWithProtectedTerms(bank.summary.text)}

  \\section{Skills}

${formatSkills(bank, selection.skillGroupIds)}

  \\section{Experience}

${experience}

  \\section{Education}

  \\headingBf{${escapeLatex(education.school)}}{${escapeLatex(education.dates)}}
  \\headingIt{${escapeLatex(education.degree)}}{${escapeLatex(education.gpa)}}

  \\section{Projects}

${projects}

\\end{document}
`;

  return { tex: `${preamble}${body}`, budget, finalSelection };
}
