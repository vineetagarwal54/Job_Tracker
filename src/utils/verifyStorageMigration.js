import { normalizeAppData, normalizeResumeOption } from "./storageHelpers.js";
import { resolveBaseResumeId } from "../generate/baseResumes.js";

const assert = (condition, message) => {
  if (!condition) throw new Error(`FAIL: ${message}`);
};

const expected = new Map([
  ["AI/ML", "AI / LLM"],
  ["Mobile", "Mobile / React Native"],
  ["Frontend", "Software Engineer / FullStack / Cloud"],
  ["General/Full-stack", "Software Engineer / FullStack / Cloud"],
  ["Academic", "Software Engineer / FullStack / Cloud"],
  ["Custom", "Software Engineer / FullStack / Cloud"],
  ["AI / LLM", "AI / LLM"],
  ["Mobile / React Native", "Mobile / React Native"],
  ["Software Engineer / FullStack / Cloud", "Software Engineer / FullStack / Cloud"],
  ["unknown-retired-choice", "Software Engineer / FullStack / Cloud"],
  [undefined, "Software Engineer / FullStack / Cloud"],
]);

for (const [input, output] of expected) {
  assert(normalizeResumeOption(input) === output, `${String(input)} migrates to ${output}`);
}

const normalized = normalizeAppData({ jobs: [...expected.keys()].map((resume, id) => ({ id, resume })) });
for (const [index, output] of [...expected.values()].entries()) {
  assert(normalized.jobs[index].resume === output, `saved job ${index} normalized`);
  assert(["ai", "mobile", "swe-cloud"].includes(resolveBaseResumeId(normalized.jobs[index].resume)), `saved job ${index} resolves to a canonical base`);
}

console.log(JSON.stringify({ legacyValues: expected.size, allCanonical: true, unknownFallsBackSafely: true }, null, 2));
