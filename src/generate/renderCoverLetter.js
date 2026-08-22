import { escapeLatex, escapeLatexWithProtectedTerms } from "./latexEscape.js";
import { validateRendererIdentity } from "./profileIdentity.js";
import { validateCoverLetter } from "./coverLetterValidation.js";

function link(url) {
  const visible = url.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return `\\href{${escapeLatex(url)}}{${escapeLatex(visible)}}`;
}

export function renderCoverLetter({ bank, content, identity, job, date = new Date(), validationOptions = {} }) {
  const safeIdentity = validateRendererIdentity(identity);
  const safeContent = validateCoverLetter(content, bank, validationOptions);
  const contacts = [safeIdentity.location, safeIdentity.phone, safeIdentity.email].filter(Boolean).map(escapeLatex);
  for (const key of ["linkedin", "github", "portfolio"]) if (safeIdentity.links[key]) contacts.push(link(safeIdentity.links[key]));
  const paragraphs = [safeContent.opening, ...safeContent.bodyParagraphs, safeContent.closing].map((text) => escapeLatexWithProtectedTerms(text)).join("\n\n");
  const formattedDate = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }).format(date);
  return `\\documentclass[letterpaper,10pt]{article}
\\usepackage[empty]{fullpage}
\\usepackage[hidelinks]{hyperref}
\\usepackage{XCharter}
\\usepackage{xcolor}
\\definecolor{accentTitle}{HTML}{0e6e55}
\\definecolor{accentLine}{HTML}{a16f0b}
\\addtolength{\\oddsidemargin}{-0.55in}
\\addtolength{\\textwidth}{1.1in}
\\addtolength{\\topmargin}{-0.65in}
\\addtolength{\\textheight}{1.3in}
\\pagestyle{empty}
\\hyphenpenalty=10000
\\exhyphenpenalty=10000
\\tolerance=2000
\\emergencystretch=2em
\\newcommand{\\documentTitle}[2]{\\begin{center}{\\Huge\\color{accentTitle} #1}\\vspace{6pt}{\\color{accentLine}\\hrule}\\vspace{4pt}\\footnotesize{#2}\\vspace{4pt}{\\color{accentLine}\\hrule}\\end{center}}
\\begin{document}
\\documentTitle{${escapeLatex(safeIdentity.name)}}{${contacts.join(" | ")}}

\\vspace{8pt}
${escapeLatex(formattedDate)}

\\vspace{8pt}
${escapeLatex(job.company)}\\\\
${escapeLatex(job.title)}

\\vspace{10pt}
Dear Hiring Team,

${paragraphs}

Sincerely,\\\\
${escapeLatex(safeIdentity.name)}
\\end{document}
`;
}

export function safeCoverLetterFileName(company, role) {
  const base = `${company || "company"}-${role || "role"}-cover-letter`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return base || "cover-letter";
}
