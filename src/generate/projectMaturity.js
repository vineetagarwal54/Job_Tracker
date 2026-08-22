// Project maturity classification (task Phase 7).
//
// Flagship  - substantial, multi-angle or quantified, interview-defensible.
// Solid     - concrete implementation with meaningful technical depth.
// Exploratory - experiments / spikes. Must not be selected when stronger
//               relevant projects are available (e.g. the Google ADK repo).
//
// Locra is mandatory and always kept regardless of classification.

import { isMandatoryEntry } from "./mandatoryContent.js";

const MATURITY = Object.freeze({
  "repo-research-ai": "flagship",
  "serverless-video-analytics": "flagship",
  locra: "flagship",
  "terrapin-events": "solid",
  "jobtrack-ai-application-tracker": "solid",
  "care-bridge-ai": "solid",
  collabdraw: "solid",
  meetspace: "solid",
  "activity-logger": "solid",
  "plywood-studio-ai-chatbot": "solid",
  "google-adk": "exploratory",
});

export function classifyProject(entryId) {
  return MATURITY[entryId] || "solid";
}

export function isExploratoryProject(entryId) {
  return classifyProject(entryId) === "exploratory";
}

// Removes exploratory optional projects from a selection when at least one
// stronger (non-exploratory) project remains. Mandatory projects are never
// touched. Returns a new selection; does not mutate input.
export function filterExploratoryProjects(selection) {
  const projects = selection.projects || [];
  const hasStronger = projects.some(
    (entry) => isMandatoryEntry(entry.entryId) || !isExploratoryProject(entry.entryId)
  );
  if (!hasStronger) return selection;
  const filtered = projects.filter(
    (entry) => isMandatoryEntry(entry.entryId) || !isExploratoryProject(entry.entryId)
  );
  return { ...selection, projects: filtered };
}

// Limits the resume to exactly two project entries: the mandatory one (Locra)
// plus the single highest JD-ranked other project. All other projects are
// dropped so experience dominates the page. `rankScores` is a bulletId -> score
// map (from computeAllRankScores); a project's rank is the best score across its
// bank bullets. Returns a new selection; does not mutate input. With no other
// project it is a no-op.
export function limitToTwoProjects(bank, selection, rankScores = null) {
  const projects = selection.projects || [];
  const mandatory = projects.filter((entry) => isMandatoryEntry(entry.entryId));
  const others = projects.filter((entry) => !isMandatoryEntry(entry.entryId));
  if (others.length <= 1) return selection;

  const scores = rankScores instanceof Map ? rankScores : new Map();
  const scoreOf = (entry) => {
    const bankEntry = (bank.projects || []).find((project) => project.id === entry.entryId);
    const ids = (bankEntry?.bullets || []).map((bullet) => bullet.id);
    let best = -Infinity;
    for (const id of ids) if (scores.has(id) && scores.get(id) > best) best = scores.get(id);
    return best;
  };
  const ranked = others
    .map((entry, index) => ({ entry, index, score: scoreOf(entry) }))
    .sort((a, b) => (b.score - a.score) || (a.index - b.index));
  return { ...selection, projects: [...mandatory, ranked[0].entry] };
}
