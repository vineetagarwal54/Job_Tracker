const path = require("path");
const { pathToFileURL } = require("url");

const root = path.resolve(__dirname, "..", "..");
const load = (name) => import(pathToFileURL(path.join(root, "src", "generate", `${name}.js`)).href);
const assert = (condition, message) => { if (!condition) throw new Error(`FAIL: ${message}`); };

async function main() {
  const [{ semanticGoldenFixtures, semanticGoldenChangeTypes }, { getCanonicalBaseResume }, evidenceModule, blockerModule] = await Promise.all([
    load("semanticGoldenFixtures"), load("baseResumes"), load("evidenceCatalog"), load("eligibilityBlockers"),
  ]);
  const bank = require("../../src/generate/content-bank.json");
  assert(semanticGoldenFixtures.length >= 12, "golden set has at least twelve semantic scenarios");
  for (const fixture of semanticGoldenFixtures) {
    const base = getCanonicalBaseResume(fixture.baseResumeId);
    const { catalog } = evidenceModule.buildVerifiedEvidenceCatalog(bank, base);
    const index = evidenceModule.indexVerifiedEvidenceCatalog(catalog);
    assert(fixture.id && fixture.job && fixture.expected, `${fixture.id}: fixture has required fields`);
    assert(fixture.expected.allowedChangeTypes.every((type) => semanticGoldenChangeTypes.includes(type)), `${fixture.id}: allowed change types are valid`);
    for (const requirement of fixture.expected.requirements) for (const id of requirement.validEvidenceIds) assert(index.has(id), `${fixture.id}: evidence '${id}' exists for authoritative base`);
    assert((fixture.expected.forbiddenClaims || []).every((claim) => typeof claim === "string"), `${fixture.id}: forbidden claims are declarative strings`);
    if (fixture.expected.blockers) assert(JSON.stringify(blockerModule.detectExplicitEligibilityBlockers(fixture.job)) === JSON.stringify(fixture.expected.blockers), `${fixture.id}: explicit blockers match`);
  }
  assert(blockerModule.detectExplicitEligibilityBlockers("We cannot provide employment sponsorship now or later.").length === 0, "generic sponsorship wording is not an eligibility blocker");
  console.log(JSON.stringify({ fixtures: semanticGoldenFixtures.map((item) => item.id), count: semanticGoldenFixtures.length, allPassed: true }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
