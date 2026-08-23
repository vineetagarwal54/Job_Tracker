import { extractJobKeywords } from "./keywordExtraction.js";
import { canonicalizeTerm, textContainsTerm, technologiesIn } from "./protectedTerms.js";
import { validateResumeEvidenceSelection } from "./resumeEvidenceValidation.js";
import { inventorySkills, isHandsOnSkill } from "./skillInventory.js";

const NUMBER_PATTERN = /\b\d+(?:\.\d+)?(?:%|[A-Za-z]+)?\b/g;
const STOP = new Set("a an and are as at be by for from has have in into is it of on or that the their this to was were will with my i our role position work worked working experience using through across".split(" "));
const ACTION = /\b(?:built|created|delivered|designed|developed|diagnosed|drove|implemented|improved|increased|integrated|launched|led|managed|optimized|reduced|shipped|streamlined|supported|automated|engineered|achieved)\b/i;
const ACTION_GLOBAL = /\b(?:built|created|delivered|designed|developed|diagnosed|drove|implemented|improved|increased|integrated|launched|led|managed|optimized|reduced|shipped|streamlined|supported|automated|engineered|achieved)\b/gi;

const unique = (values) => [...new Set(values.filter(Boolean))];
const words = (text) => unique(String(text || "").toLowerCase().match(/[a-z][a-z0-9+#./-]{2,}/g) || []).filter((word) => !STOP.has(word));
const numbers = (text) => (String(text || "").match(NUMBER_PATTERN) || []).map((value) => value.toLowerCase());

function relevantTerms(job, analysis) {
  const extraction = extractJobKeywords(job.description);
  return unique([
    ...(analysis?.mustHaveKeywords || []).map(canonicalizeTerm),
    ...(analysis?.niceToHaveKeywords || []).map(canonicalizeTerm),
    ...(extraction.keywords || []).filter((item) => item.category === "technical").map((item) => item.normalized),
  ]);
}

function evidenceScore(item, terms, analysis) {
  const must = new Set((analysis?.mustHaveKeywords || []).map(canonicalizeTerm));
  let score = numbers(item.text).length * 5;
  for (const term of terms) if (textContainsTerm(item.text, term)) score += must.has(term) ? 15 : 6;
  if (item.section === "experience") score += 3;
  return score;
}

function localEvidence(resumeText) {
  const chunks = String(resumeText || "").split(/\r?\n|(?<=[.!?])\s+/).map((text) => text.trim()).filter((text) => text.length >= 35);
  return chunks.slice(0, 40).map((text, index) => ({ id: `local-resume-${index + 1}`, text, organization: "Local resume", role: "", section: "resume" }));
}

export function buildCoverLetterEvidence({ bank, job, analysis, selection = null, resumeText = "" }) {
  let evidence;
  if (resumeText) evidence = localEvidence(resumeText);
  else {
    const verified = validateResumeEvidenceSelection(bank, selection);
    evidence = verified.rankedBullets.map((item) => ({ id: item.bullet.id, text: item.text, organization: item.entry.org, role: item.entry.role, section: item.section }));
  }
  const terms = relevantTerms(job, analysis);
  const ranked = evidence.map((item) => ({ ...item, relevanceScore: evidenceScore(item, terms, analysis) })).sort((left, right) => right.relevanceScore - left.relevanceScore || numbers(right.text).length - numbers(left.text).length || left.id.localeCompare(right.id));
  const strongest = ranked.slice(0, Math.min(3, ranked.length));
  const renderedSkills = selection?.renderedSkills || [];
  const resumeSkills = unique(renderedSkills.flatMap((group) => group.items || []).filter((item) => isHandsOnSkill(bank, item)));
  return { evidence: strongest, allEvidence: ranked, resumeSkills, relevantTerms: terms };
}

export function validateEvidenceClaims(content, evidenceBundle, { job, bank }) {
  const evidence = new Map(evidenceBundle.allEvidence.map((item) => [item.id, item.text]));
  const paragraphs = [content.opening, ...(content.bodyParagraphs || []), content.closing];
  const text = paragraphs.join(" ");
  const claims = new Map((content.claimEvidence || []).map((claim) => [claim.sentence.trim(), claim.evidenceIds]));
  for (const claim of content.claimEvidence || []) {
    if (!text.includes(claim.sentence)) throw Object.assign(new Error("Cover-letter claimEvidence sentence is not present verbatim in the letter."), { code: "VALIDATION_FAILED" });
    const sourceTexts = claim.evidenceIds.map((id) => evidence.get(id)).filter(Boolean);
    if (sourceTexts.length !== claim.evidenceIds.length) throw Object.assign(new Error("Cover letter cited evidence outside the final resume."), { code: "VALIDATION_FAILED" });
    const source = sourceTexts.join(" ");
    const knowledgeClaim = inventorySkills(bank).find((skill) => !isHandsOnSkill(bank, skill.name) && textContainsTerm(claim.sentence, skill.name));
    if (knowledgeClaim) throw Object.assign(new Error(`Cover-letter claim used knowledge-only skill '${knowledgeClaim.name}' as accomplishment evidence.`), { code: "VALIDATION_FAILED" });
    for (const number of numbers(claim.sentence)) if (!numbers(source).includes(number)) throw Object.assign(new Error(`Cover-letter claim moved or invented metric '${number}'.`), { code: "VALIDATION_FAILED" });
    for (const technology of technologiesIn(claim.sentence)) if (!textContainsTerm(source, technology)) throw Object.assign(new Error(`Cover-letter claim introduced unsupported technology '${technology}'.`), { code: "VALIDATION_FAILED" });
    for (const action of claim.sentence.match(ACTION_GLOBAL) || []) if (!new RegExp(`\\b${action}\\b`, "i").test(source)) throw Object.assign(new Error(`Cover-letter claim introduced unsupported ownership or action '${action}'.`), { code: "VALIDATION_FAILED" });
    const claimWords = words(claim.sentence).filter((word) => ![...words(job.title), ...words(job.company)].includes(word));
    const sourceWords = new Set(words(source));
    const supported = claimWords.filter((word) => sourceWords.has(word)).length;
    if (claimWords.length >= 4 && supported / claimWords.length < 0.35) throw Object.assign(new Error("Cover-letter claim is not sufficiently traceable to its cited resume evidence."), { code: "VALIDATION_FAILED" });
  }
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    const substantive = /\bI\b|\bmy\s+(?:experience|work|background|skills?|projects?)\b/i.test(sentence) && (ACTION.test(sentence) || numbers(sentence).length || technologiesIn(sentence).size || /\b(?:have experience|bring|offer|skilled|proficient)\b/i.test(sentence));
    if (substantive && ![...claims.keys()].some((claim) => claim.includes(sentence.trim()))) throw Object.assign(new Error("Every substantive candidate claim must appear in claimEvidence."), { code: "VALIDATION_FAILED" });
  }
  const company = String(job.company || "").trim();
  if (company) for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    if (!sentence.toLowerCase().includes(company.toLowerCase())) continue;
    const boilerplate = new Set(["apply", "applying", "application", "role", "position", ...words(job.title), ...words(company)]);
    const unsupported = words(sentence).filter((word) => !words(job.description).includes(word) && !boilerplate.has(word));
    if (unsupported.length > 2) throw Object.assign(new Error("Cover letter introduced a company-specific statement not supported by the JD."), { code: "VALIDATION_FAILED" });
  }
  const allowedNumbers = new Set([...evidenceBundle.allEvidence.flatMap((item) => numbers(item.text)), ...numbers(job.description), ...numbers(job.title)]);
  for (const number of numbers(text)) if (!allowedNumbers.has(number)) throw Object.assign(new Error(`Cover letter introduced unverified number '${number}'.`), { code: "VALIDATION_FAILED" });
  return content;
}

function ensureSentence(text) { const clean = String(text || "").trim(); return /[.!?]$/.test(clean) ? clean : `${clean}.`; }
function wordCount(content) { return [content.opening, ...content.bodyParagraphs, content.closing].join(" ").split(/\s+/).filter(Boolean).length; }

export function buildConservativeCoverLetter({ job, evidenceBundle }) {
  const evidence = evidenceBundle.evidence.slice(0, 3);
  if (!evidence.length) throw Object.assign(new Error("No readable resume evidence is available for a cover letter."), { code: "VALIDATION_FAILED" });
  const terms = evidenceBundle.relevantTerms.filter((term) => textContainsTerm(job.description, term)).slice(0, 4);
  const focus = terms.length ? terms.join(", ") : "the responsibilities described in the posting";
  const first = evidence[0]; const second = evidence[1] || evidence[0];
  const opening = `This application concerns the ${job.title} role at ${job.company}. The posting emphasizes ${focus}. The verified work in the final resume offers direct examples relevant to those requirements.`;
  const firstClaim = ensureSentence(first.text);
  const secondClaim = ensureSentence(second.text);
  const bodyParagraphs = [
    `${firstClaim} This example provides concrete implementation and outcome evidence for evaluating my background against the responsibilities in the posting, without extending the verified scope of the work.`,
    `${secondClaim} Together, these verified examples show the closest overlap between my final resume and the technical work described in the posting, while keeping the evidence focused on demonstrated results.`,
  ];
  let closing = `A conversation would provide an opportunity to discuss these examples and the requirements of the ${job.title} role. Thank you for reviewing this application.`;
  let content = { version: 1, opening, bodyParagraphs, closing, claimEvidence: [
    { sentence: firstClaim, evidenceIds: [first.id] },
    { sentence: secondClaim, evidenceIds: [second.id] },
  ] };
  if (wordCount(content) < 180) closing = `${closing} The examples above are drawn directly from my resume and are intended to keep this application focused on demonstrated work.`;
  if (wordCount({ ...content, closing }) < 180) closing = `${closing} I would be glad to explain the implementation details and outcomes in a conversation.`;
  if (wordCount({ ...content, closing }) < 180) closing = `${closing} This letter intentionally avoids assumptions beyond the supplied posting and verified resume evidence.`;
  if (wordCount({ ...content, closing }) < 180) closing = `${closing} I appreciate your time and consideration.`;
  if (wordCount({ ...content, closing }) < 180) closing = `${closing} A discussion would allow me to provide additional context for the cited work.`;
  content = { ...content, closing };
  return content;
}
