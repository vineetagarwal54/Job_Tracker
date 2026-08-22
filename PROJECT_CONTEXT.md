# JobTrack document-generation architecture

Status: production candidate as of August 22, 2026.

## Product boundary

JobTrack is a local-first Electron and React application. Job records and generated files remain local. Document generation sends the saved job description and bounded verified evidence to Anthropic through the Electron main process. React never receives filesystem or API-key access.

The application offers exactly three resume choices:

- AI / LLM -> `ai`
- Mobile / React Native -> `mobile`
- Software Engineer / FullStack / Cloud -> `swe-cloud`

Legacy saved values normalize to one of these choices. Unknown retired values safely use `swe-cloud`.

## Resume architecture

The source of every resume is one of the authoritative PDFs in `resume/base/`. Their deterministic structured counterparts live in `src/generate/canonical-base-resumes.json` and reference verified entries in `src/generate/content-bank.json`.

The selected job option is authoritative. JD classification cannot choose or override the base.

The active pipeline is:

1. Extract JD terms deterministically.
2. Analyze the JD once with Haiku. If analysis fails or is malformed, use deterministic fallback analysis.
3. Score the selected canonical base against the JD and rank only supported, minimum-benefit changes.
4. Ask Sonnet for a bounded tailoring diff. The response references approved base/content-bank IDs and never contains LaTeX or a full resume.
5. Validate and apply the diff to a copy of the base. Invalid changes are rejected individually. A failed or malformed writing response returns the unchanged base.
6. Render deterministic LaTeX and compile with Tectonic.
7. If tailoring overflows, revert accepted changes from lowest relevance value until the document is one page. Original base content is never trimmed. If the base itself is not one page, generation fails explicitly.
8. Verify the final PDF text layer, protected structure, density, and coverage against the selection that actually shipped.

Resume tailoring permits at most three bullet modifications, one project swap, four skill edits, and one summary change. These are maximums, not targets. Every accepted change must have verified evidence, a concrete JD reason, and positive deterministic relevance value. Metrics cannot be invented, weakened, or removed.

The retired full-resume assembly, generic line-budget fitting, mandatory injection, sparse filling, and variant-override paths are not part of runtime generation.

## Cover-letter architecture

Cover letters use the final post-backoff resume selection, its existing job analysis, and verified content-bank evidence. A normal combined generation does not repeat JD analysis.

The active flow makes one streamed Sonnet writing call, validates every substantive claim against cited final-resume evidence, renders deterministic LaTeX, compiles, and verifies a one-page ATS-readable PDF. Unsupported claims, changed metrics, or company statements absent from the JD cause a conservative verified fallback. Model failure also uses that fallback without a second model call.

Cover-letter-only generation reuses final resume evidence and derives deterministic analysis from its new JD, avoiding both stale analysis and an extra API call. A readable local PDF uses the same safe path. The removed humanizer pass has no active IPC, prompt, schema, or runtime code.

## Runtime ownership

- `electron/anthropic/`: main-process API orchestration, schemas, prompt modules, fallbacks, and usage accounting.
- `electron/resume/`: generated-path validation, Tectonic compilation, and PDF text extraction.
- `src/generate/`: deterministic canonical bases, content-bank validation, relevance planning, diff application, rendering, page-fit backoff, evidence checks, and verification scripts.
- `resume/base/`: authoritative canonical PDFs.
- `resume/template/`: deterministic resume and cover-letter LaTeX templates.
- `resume/output/`: generated development artifacts, gitignored.

The model never emits document structure or LaTeX. JavaScript owns every byte of each rendered `.tex` document.

## Failure guarantees

- Analysis failure -> deterministic analysis and the selected base remains authoritative.
- Resume model failure, malformed JSON, or unsupported proposal -> unchanged canonical base or rejection of the invalid change.
- Tailoring overflow -> relevance-ordered backoff, with unchanged base as the worst case.
- Base-validation or PDF compilation failure -> explicit failure; no trimming or silent partial document.
- Cover-letter failure or unsupported prose -> conservative verified fallback; fabrication is never shipped.
- ATS extraction findings remain visible warnings when a valid PDF exists.

## Verification commands

```bash
npm run verify:canonical-bases
npm run verify:tailoring-diff
npm run verify:relevance
npm run verify:page-fit
npm run verify:cover-letter
npm run verify:production-regression
npm run verify:ai-resume
npm run build
```

`verify:production-regression` compiles resumes and cover letters for AI/LLM, GenAI/RAG, backend, cloud/platform, full-stack, mobile, ambiguous SWE, unsupported-technology, and already-matched JDs. Tectonic is required for production verification.
