import { textContainsTerm, canonicalizeTerm, ALIASES, tokenize } from "./protectedTerms.js";

// Multi-word phrases worth surfacing as keywords. Matched as exact phrases.
const PHRASES = [
  "large language models", "machine learning", "react native",
  "natural language processing", "distributed systems", "computer vision",
  "prompt caching", "speculative decoding", "model serving",
  "security clearance", "work authorization", "vision-language model",
];
// Single technical tokens. Matched on token boundaries so "java" never matches
// inside "javascript" and "c++" / "c#" / "node.js" / "ci/cd" survive.
const TOKENS = [
  "c++", "c#", "node.js", "ci/cd", "tensorrt-llm", "react", "python",
  "javascript", "typescript", "java", "go", "aws", "docker", "kubernetes",
  "sql", "redis", "postgresql", "mongodb", "fastapi", "pytorch", "tensorflow",
  "cuda", "linux", "git", "graphql", "webrtc", "websocket", "llm", "rag",
];
const STOP = new Set(
  "a an and are as at be by for from in into is it of on or our that the their this to using we will with you your years year experience required preferred plus strong ability knowledge".split(
    " "
  )
);
const QUALIFICATION = /\b(required|requirement|must|minimum|degree|years?|citizenship|clearance|cpt|opt)\b/i;
const RESPONSIBILITY = /\b(build|develop|design|implement|maintain|deploy|collaborate|lead|optimize|analyze|support|create|deliver)\b/i;

export function extractJobKeywords(text) {
  const source = String(text || "");
  const found = new Map();
  const add = (term, category, sourceText = term) => {
    const normalized = canonicalizeTerm(term);
    if (!normalized || found.has(normalized)) return;
    found.set(normalized, { value: sourceText, normalized, category });
  };

  for (const phrase of PHRASES) {
    if (textContainsTerm(source, phrase)) {
      add(phrase, phrase.includes("clearance") || phrase.includes("authorization") ? "qualification" : "technical");
    }
  }
  for (const token of TOKENS) {
    if (textContainsTerm(source, token)) add(token, "technical", token);
  }
  // Alias-driven detection (Node/Node.js, Postgres/PostgreSQL, K8s/Kubernetes,
  // RAG, LLM, CI/CD, TensorRT-LLM). textContainsTerm already matches any form.
  for (const canonical of Object.keys(ALIASES)) {
    if (textContainsTerm(source, canonical)) add(canonical, "technical", canonical);
  }

  for (const sentence of source.split(/(?<=[.!?])\s+|\n+/)) {
    const category = QUALIFICATION.test(sentence)
      ? "qualification"
      : RESPONSIBILITY.test(sentence)
        ? "responsibility"
        : "domain";
    const words = tokenize(sentence);
    for (const word of words) {
      if (word.length >= 4 && !STOP.has(word) && !found.has(canonicalizeTerm(word))) {
        add(word, category, word);
      }
    }
  }
  return {
    version: 1,
    keywords: [...found.values()].sort((a, b) => a.normalized.localeCompare(b.normalized)),
  };
}
