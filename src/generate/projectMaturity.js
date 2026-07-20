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
  "reporesearchai-multi-agent-code-analysis": "flagship",
  "aws-video-analytics-streaming-platform": "flagship",
  locra: "flagship",
  "terrapin-events": "solid",
  "jobtrack-ai-application-tracker": "solid",
  "care-bridge-ai": "solid",
  collabdraw: "solid",
  meetspace: "solid",
  "activity-logger": "solid",
  "plywood-studio-ai-chatbot": "solid",
  "google-adk-experiments": "exploratory",
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
