// System prompts are assembled from focused, composable prompt modules (task
// Part 3) so each model call receives only the rules it needs. See
// promptModules.cjs for the individual fragments.
const { ANALYSIS_SYSTEM, SELECTION_SYSTEM, SEMANTIC_OPTIMIZER_SYSTEM, COVER_LETTER_SYSTEM } = require("./promptModules.cjs");

module.exports = { ANALYSIS_SYSTEM, SELECTION_SYSTEM, SEMANTIC_OPTIMIZER_SYSTEM, COVER_LETTER_SYSTEM };
