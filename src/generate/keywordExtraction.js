const PHRASES = ["large language models", "machine learning", "react native", "natural language processing", "distributed systems", "computer vision", "prompt caching", "speculative decoding", "model serving", "security clearance", "work authorization"];
const TOKENS = ["c++", "c#", "node.js", "ci/cd", "tensorrt-llm", "react", "python", "javascript", "typescript", "java", "aws", "docker", "kubernetes", "sql", "redis", "fastapi", "pytorch", "cuda", "linux", "git"];
const STOP = new Set("a an and are as at be by for from in into is it of on or our that the their this to using we will with you your years year experience required preferred plus strong ability knowledge".split(" "));
const QUALIFICATION = /\b(required|requirement|must|minimum|degree|years?|citizenship|clearance|cpt|opt)\b/i;
const RESPONSIBILITY = /\b(build|develop|design|implement|maintain|deploy|collaborate|lead|optimize|analyze|support|create|deliver)\b/i;

function canonical(value) {
  return value.toLowerCase().replace(/node\s*\.\s*js/g, "node.js").replace(/tensor\s*rt\s*-?\s*llm/g, "tensorrt-llm").replace(/ci\s*\/\s*cd/g, "ci/cd").replace(/\s+/g, " ").trim();
}

export function extractJobKeywords(text) {
  const source = String(text || "");
  const lower = canonical(source);
  const found = new Map();
  const add = (term, category, sourceText = term) => {
    const normalized = canonical(term);
    if (!normalized || found.has(normalized)) return;
    found.set(normalized, { value: sourceText, normalized, category });
  };
  for (const phrase of PHRASES) if (lower.includes(phrase)) add(phrase, phrase.includes("clearance") || phrase.includes("authorization") ? "qualification" : "technical");
  for (const token of TOKENS) if (lower.includes(token)) add(token, "technical", token);
  for (const sentence of source.split(/(?<=[.!?])\s+|\n+/)) {
    const category = QUALIFICATION.test(sentence) ? "qualification" : RESPONSIBILITY.test(sentence) ? "responsibility" : "domain";
    const words = canonical(sentence).replace(/[^a-z0-9+#./-]+/g, " ").split(/\s+/);
    for (const word of words) if (word.length >= 4 && !STOP.has(word) && !found.has(word)) add(word, category, word);
  }
  return { version: 1, keywords: [...found.values()].sort((a, b) => a.normalized.localeCompare(b.normalized)) };
}
