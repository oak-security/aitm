# Verification record — 2026-09-06

The fresh engine, API and TUI are implemented and verified, including real OpenAI
and Anthropic pipelines on the existing Uniswap v4 whitepaper. Both completed
assessments are available in the installed TUI. All generated analysis remains
draft and requires human review.

## Automated checks

`npm run check`, `npm test`, `npm run pack:check` and `git diff --check` passed.
The final suite passed 34/34 tests with no skips or failures. It covers:

- Complete TRACE draft runs and all sequential human review gates.
- Optional phases, independent phase prerequisites, retries and token accounting.
- Invalid evidence, reference errors, coverage omissions, cyclic trees and roadmap links.
- Exact quote lookup repairs only unambiguous line numbers and records corrections.
- Coverage is computed from threat references; unaddressed objects are flagged for review.
- Edits, source synchronization, stale revisions and analysis invalidation.
- Cancellation, concurrent mutation protection, persistence and restart recovery.
- HTTP project/source/job/report lifecycle, input validation and browser boundaries.
- SSE replay and a disconnected client while the server continues its job.
- OpenAI/Anthropic streaming wire formats, fragmentation, refusal and truncation.
- Anthropic workspace headers, actionable configuration errors and compact schemas.
- Private credentials excluded from project responses and exports.
- Folder traversal, nested gitignore, symlinks, credential paths and source caps.
- PDF/DOCX extraction and oversized DOCX archive declarations.
- Git clone options, canonical temporary paths, commit provenance and cleanup.
- Portable JSON import/export and lossless PDF table content.
- TUI rendering, project/source creation, review/run/edit actions against the HTTP API.
- CLI help/version, ASCII portability and client/engine separation.

## Actual runtime checks

Installed the local CLI in `~/.local/bin`. Both `aitm --version` and `AITM --version`
returned `2.0.0` on this case-insensitive macOS filesystem. In an actual PTY, `aitm`
started a background server, rendered its gold ASCII logo and terminal UI, and created
an assessment through the API. Quitting restored the original terminal and left the
server reachable. `aitm status` and `aitm stop` worked against that instance.

The npm tarball also installed into a clean isolated prefix. Its CLI reported 2.0.0;
its server started and served the OpenAPI contract. Project creation through that
installed API returned HTTP 201 and correctly resolved Anthropic model defaults.
Both smoke-test servers were shut down after verification.

PDF output was rendered with Poppler and all four final pages were visually checked.
The synthetic QA report includes source hashes, TRACE objects, threat details,
attack trees, coordination, roadmap and review state in bundled BDO Grotesk. A PDF
row omission found during inspection was fixed and covered by text extraction tests.
QA files are in ignored `artifacts/qa/`; they are verification examples, not assessments.

Real source ingestion succeeded for:

- `https://github.com/oak-security/TRACE`, commit
  `9e90395eaf4eadf537a067aa14f5540568d27885`: 13 readable files, 82,314 extracted characters.
- The existing Uniswap v4 whitepaper at
  `/Users/stefanbeyer/Downloads/whitepaper-v4.pdf`: 17,272 extracted characters, no warnings.

No temporary Git checkout remained after ingestion. The first real Git test exposed
macOS's aliased temporary-directory path; canonicalizing the checkout fixed it.

## Live verification

Both keys were supplied privately. The initial OpenAI run on the Uniswap whitepaper
was rejected for mismatched evidence quotes; no invalid artifact was published.
That test exposed insufficient correction feedback. Evidence validation now reports
individual claim paths and cited text together, and prompts request short, exact
single-line quotes. The regression suite verifies that several invalid claims are
identified together without weakening quote matching.

Subsequent live testing added unique exact-quote lookup for incorrect line numbers,
explicit parent-source/file identity mapping, support for Anthropic multi-workspace
keys, and reusable schema definitions to fit Anthropic's compiled-grammar limit.
Unsupported Anthropic schema bounds remain enforced by the engine's original Zod
schemas. These fixes have behavioral regression coverage. Terminal inspection also
improved word wrapping for readable artifact text.

The Anthropic run also exposed that asking the model to maintain coverage links
independently could yield an inconsistent index. The engine now computes that index
from threat references, records mapping corrections, and flags uncovered objects
explicitly. A regression test checks both incorrect links and an unaddressed asset.

OpenAI completed on the real Uniswap v4 whitepaper using `gpt-5.6-terra` and
`gpt-5.6-sol`: ingestion, TRACE model, STRIDE, two attack trees and final report.
Coordination was automatically skipped by this run's classification. Usage for the
successful run was 78,682 input and 26,190 output tokens, including its bounded
ingestion correction. Its 23-page PDF was rendered and every page visually checked;
all sections, evidence, mitigation roadmap and draft review status are present.
Artifacts: `artifacts/live-2026-09-06T14-28-58-769Z/`.

Anthropic completed all seven phases on the same whitepaper using `claude-sonnet-5`
and `claude-opus-5`, including coordination. The assessment was resumed after schema
and validation fixes, preserving completed phases. Cumulative usage across its five
runs was 351,651 input and 108,307 output tokens, including completed rejected
attempts. This is recorded project usage, not total account billing; connection
tests and earlier separate diagnostic projects are excluded.
Artifacts: `artifacts/live-2026-09-06T14-31-39-199Z/`.

| Result                 | OpenAI                    | Anthropic         |
| ---------------------- | ------------------------- | ----------------- |
| Ranked threats         | 12                        | 15                |
| Attack trees           | 2                         | 2                 |
| Coordination scenarios | Skipped by classification | 8                 |
| Roadmap items          | 11                        | 11                |
| PDF pages              | 23                        | 35                |
| Artifact validation    | Passed                    | Passed            |
| Review state           | Draft, unreviewed         | Draft, unreviewed |

Both exports retain the same source snapshot hash:
`1beec84a1d0fe82ee168f113a83d0ff0be2943dad1cf5af1a735e7ee213bab23`.
Every page of both final PDFs was rendered and visually inspected. The inspection
fixed tab characters rendering as missing glyphs and an orphaned section heading.
Rendering expands tabs into spaces without changing stored evidence quotes. PDF
text extraction has regression coverage. JSON exports were checked for the configured
secret values; neither contained them. These checks validate execution, structure
and presentation, not the substantive correctness of model-generated threats.

The real OpenAI assessment was opened while running through an actual `AITM` PTY;
navigation and streamed progress worked, and quitting did not stop the job. Its
completed JSON was then imported through the normal TUI into the default v2 store,
where it is named “Uniswap v4 — OpenAI live verification”. The Anthropic export was
imported through the public API as “Uniswap v4 — Anthropic live verification”.
The default API server is available on `127.0.0.1:8790`; both provider keys are
configured privately. A clean tarball installation also passed a real Anthropic
connection test through its own API server.

The setup command is `python3 scripts/configure-keys.py` (hidden prompts, ignored
`.env.local`, mode 0600). `npm run test:live` uses the real adapters through the
public API and saves separate provider reports and usage/provenance in
`artifacts/live-*`. Missing credentials fail explicitly, without fixture substitution.

Dividend was not found in the saved AiTM projects, current repository or searched local
filenames. The previous saved projects are Uniswap v4 and MorseGuard. The available
Uniswap whitepaper was therefore used for both representative live pipelines.

CI is configured for Node 22 on macOS and Linux. It has not been run remotely in this
session. This session's executed checks are on macOS; no Windows verification is claimed.
