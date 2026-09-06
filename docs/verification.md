# Verification record — 2026-09-06

The fresh engine, API and TUI are implemented and verified, including real OpenAI
and Anthropic pipelines on the existing Uniswap v4 whitepaper. Both completed
assessments are available in the installed TUI. All generated analysis remains
draft and requires human review.

## Automated checks

`npm run check`, `npm test`, `npm run pack:check` and `git diff --check` passed.
The current suite passed 48/48 tests with no skips or failures. It covers:

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
- Full-pipeline top-three ranking, omission rejection, bounded repair and phase reuse.
- Source browser pagination, file/directory selection, pasted paths and rapid navigation.
- Visible waiting/elapsed progress before provider output and TUI cancellation.
- Recoverable citation mismatches, malformed/unavailable repairs and explicit review notes.
- Sequential stage following, resumable status messages and detailed diagnostic logs.

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

## Feedback iteration: full pipeline, sources and progress

The TUI now exposes `f Run full pipeline (top 3 attack trees)` above the assessment.
`mode: "full"` runs through review gates without approving artifacts and enforces
exactly the three highest-ranked threat IDs, or all threats when fewer exist.
Regression tests start with unsorted threats and disabled optional phases, reject
an omitted top threat, repair it, and confirm that saved model/STRIDE artifacts are
reused. Persistent omissions fail without publishing incomplete trees or a report.

The actual `AITM` command was exercised in an 80×24 PTY with repeated `--source` /
`-s` arguments for Markdown and DOCX files. Source loading showed activity indicators
before opening the TUI. The API source browser was visually checked in the terminal.
Tests exercise file and whole-directory selection, paths containing spaces, pasted
quoted paths, pagination, and rapid arrow/Enter input.

A real OpenAI full run resumed the saved Uniswap v4 assessment. It reused scope,
ingestion, model and STRIDE, generated trees for `TH-001`, `TH-002` and `TH-003`
(exactly the top three), and regenerated the report. The run completed with 69,044
input and 9,205 output tokens, including one report validation correction. No human
reviews were invented. Evidence: `artifacts/live-feedback-2026-09-06T15-26-46.018Z/`.

While that provider run was active, the actual TUI displayed the phase number/title,
ready-phase bar, run/phase elapsed time, provider/model, streaming character count,
last update age and cancellation/log controls. Closing the TUI left the run active.
The final checks are `npm run check`, `npm test`, `npm run pack:check`, and
`git diff --check`. Anthropic's unchanged adapter was covered by automated wire-format
tests; this feedback iteration's additional live run used OpenAI.

## Citation recovery and sequential TRACE

The reported failure came from treating an unmatched citation like a structurally
unusable model: after a second response still contained a bad quote, the job failed
and discarded its otherwise usable draft. A minimal regression reproduced one
`model.edges.0.evidence[0]` mismatch with an unchanged source snapshot. The command
`node --test --test-name-pattern='persistent citation mismatch' test/engine.test.js`
failed before the fix and passes after it. Correct citations and wrong line numbers
with unique exact quotes already passed, isolating the fatal mismatch handling.

Generation now retries citations once, then removes unmatched citations from valid
evidence and retains the claim as an explicit unverified assumption. Review notes
appear in artifacts, downstream context and reports. Rejected quotes remain in
diagnostic metadata. A malformed or unavailable repair retains a previously validated
draft; cancellation still prevents publication. Structural errors cannot publish
broken TRACE references. Review mode still pauses at its normal sequential gates.

The TUI follows each new phase automatically and allows manual inspection between
transitions. An unsuccessful step shows Continue/Details actions instead of raw
validator paths. The detailed error remains available in the run log and API.

All 48 tests pass, including persistent mismatches, partial evidence, missing
support, portable import, failed repairs, cancellation and stage navigation.
A four-page synthetic PDF with two review notes was rendered and every page checked:
the review summary is visible, valid citations remain, and unverified assumptions
are printed even when a claim also has a valid citation.

The user's original failed `test` assessment contains the 58-file
`divigent-protocol` snapshot. Recovery was started through the actual TUI, preserving
its saved scope and ingestion. All seven phases completed in about five and a half minutes,
including 15 STRIDE threats, trees for `TH-01`, `TH-02` and `TH-03`, coordination and
the final report. The source snapshot stayed unchanged and every artifact passed
validation. This run's citations matched successfully; persistent-citation fallback
is verified separately by the deterministic regressions above. All artifacts remain
draft. Run usage was 355,366 input and 29,479 output tokens. Saved recovery evidence
is in `artifacts/recovery-divigent/`, including the original failure, completed
project, Markdown report and verification record. The updated local server remains
running; a fresh `AITM` session loads the new sequential UI.

## Single-process simplification

This iteration supersedes the earlier background-server/TUI lifecycle described
above. `aitm` now opens one process containing the reusable engine, direct Ink TUI
and local API. The TUI uses engine methods and change events. Detached startup,
server records, HTTP attachment/polling, project creation screens, source forms
and file browsing have been removed. The package exports the headless engine for
reuse, and `aitm serve` remains available for API-only operation.

Intake is one optional path or HTTPS URL, defaulting to the current directory.
Repeated launches reopen the most recent single-source assessment and its saved
snapshot. Explicit refresh preserves unchanged results and invalidates changed
evidence. Repository URLs and direct code/text/PDF/DOCX URLs are supported;
document fetching validates public DNS/redirect addresses and limits size/time.

All 55 automated tests pass. New checks cover shared direct/API state, engine reuse
without an HTTP server, close/reopen and sequential resume, lock cleanup on startup
failure, failed intake cleanup, URL download limits/private-address rejection, and
TUI editing/export/progress without polling. Existing TRACE ordering, review gates,
top-three trees, citation recovery, ingestion, provider protocols and reports still
pass. Syntax/format, package dry-run and whitespace checks also pass.

The installed `AITM` command was exercised in real PTYs at 100x30 and 80x24:
current-directory intake, a file path with spaces, reopening, q, Ctrl+C and headless
SIGTERM shutdown. The API PID matched the CLI PID, no child daemon existed, and
both the API port and data lock were released on exit. The large ASCII logo appears
on the initial spacious screen; the compact identity leaves room in small terminals
and while a pipeline runs. Phase navigation and progress use matching step numbers.
An initial smoke harness stalled because it stopped draining the PTY while making
HTTP requests; keeping the PTY reader active resolved this without a product change.

The existing Divigent project `b4cefa31-e099-47f4-aaec-0ee541b540ec` reopened directly
from `https://github.com/Divigent/divigent-protocol`, preserving its 58-file snapshot
and all seven artifacts. Pressing f completed run
`1aadd945-b5fe-4baa-b70b-12977c8b9615`, reusing every stage and the top-three trees
TH-01/TH-02/TH-03 with zero provider requests or tokens. This checks resumption of
the earlier real-provider result; it is not a new live AI generation test. A direct
HTTPS URL loaded TRACE's 19,673-byte METHODOLOGY.md as one document in the actual
TUI, without starting an AI run. Quit closed both tested applications. The former
idle background server was retired; all user assessments remain saved.

Evidence is under `artifacts/qa/simplification/`: PID/source/shutdown records, PTY
transcripts, Divigent resume metadata and document URL intake metadata.

## Report visibility and persistent ASCII logo

The report phase previously displayed only the provider's final summary/roadmap
artifact. It now displays the same complete assembled report as Markdown/PDF
exports, including provenance, TRACE objects, ranked threats, trees, coordination,
roadmap and review records. Completed and imported assessments open the report
reader automatically. `v` returns to it, `j`/`k` and Page Up/Down scroll, `[`/`]`
jump sections, and Home/End reach both ends. Tables become wrapped labelled records.
`o` writes one private cached PDF per assessment and opens the OS document viewer;
a missing viewer preserves the PDF and leaves the terminal reader usable. Provider
connection testing is now `V`. Viewing makes no provider requests.

The five-line logo remains visible before, during and after runs, including 80x24
terminals. Metadata sits beside it. The completed-report layout omits redundant
progress and secondary actions to make room for actual report text.

All 59 automated tests pass, including report content/section navigation, the last
page, 80x24 layout, imported reports without runs, logo persistence, zero AI calls
when viewing, private PDF permissions and missing-viewer fallback. Syntax/format,
package dry-run and whitespace checks pass. The installed AITM was exercised in a
real 80x24 PTY on the saved Divigent assessment: all five logo lines, the complete
report, opening/last pages and section navigation were checked. The actual PDF
opener succeeded. The generated PDF contains 42 A4 pages; its first page was rendered
and visually inspected, with readable text and no clipping. PDF layout/generation
itself was unchanged by this iteration. Quit shut down the engine and API normally.

The Divigent report has 2,950 wrapped terminal lines and 20 major sections. Its
private PDF is `~/.local/share/aitm-v2/reports/aitm-b4cefa31-e099-47f4-aaec-0ee541b540ec.pdf`.
Verification metadata, the final terminal page, PDF preview and check logs are in
`artifacts/qa/report-viewer/`. No new AI generation was needed.

## Markdown viewing, attribution and complete-source processing

This iteration supersedes the cached-PDF opener above. `v` is labelled View Markdown
and reads the full assembled report in the TUI without writing files or making AI
requests. `o` and its PDF opener have been removed. PDF is only generated by an
explicit export choice (`x`, format `pdf`) or a requested PDF API response. Help
starts with the assessment storage directory. Report artifacts remain in the
project JSON document; Markdown is assembled when viewed and exports go to the
chosen path. Historical cached PDFs are left untouched.

The hard-coded personal author attribution was removed from both prompts and
report assembly. Markdown and PDF state: Generated by AiTM using AI. This report
was not authored, reviewed or endorsed by Oak Security. PDF author metadata names
AiTM. The generic Source limitations section was removed; Scope retains import
diagnostics, and reports retain substantive unresolved questions and evidence
review notes. An affected legacy analysis still shows a brief incomplete-source
notice until rebuilt.

The actual DOCX whitepaper has 34,840 extracted characters. The old ingestion code
saved only 30,000; a separate weighted prompt budget could also omit stored text.
Accepted files now retain their complete extracted text. Each analysis phase reads
all source batches in order, carries the accumulated draft forward and validates
that earlier objects/findings are retained. Nothing is published until the entire
phase finishes. Report synthesis uses the completed artifacts. A source batch is
bounded to 180,000 numbered characters, not a cutoff on the whole document.
Coverage metadata records delivery to the provider, not an assurance of exhaustive
AI understanding. Input caps and unreadable-file diagnostics remain explicit.

Legacy truncated snapshots refresh from their original locator before running.
Changed extracted text invalidates old analysis even if the original file hash is
unchanged. Saved analysis made from old prompt excerpts is rebuilt too. A portable
truncated snapshot requires the complete original to be supplied again. A single
phase cannot bypass this recovery and use stale prerequisites.

All 65 automated tests pass. New regressions cover full whitepaper retention,
multi-batch delivery including the final rule, preserved line numbers, accumulated
drafts, retrying a dropped earlier finding, cancellation before final publication,
legacy extraction/prompt-cutoff recovery, attribution, and viewing without PDF
exports. Focused CLI/TUI follow-up checks also pass after the final help changes.
An explicit four-page synthetic PDF export was rendered and every page inspected:
the disclaimer is readable, tables and review records are intact, and text is not
clipped. No PDF was automatically generated for the live whitepaper assessment.

Evidence for this iteration is under `artifacts/qa/full-source/`.

The real OpenAI pipeline completed for the standalone Divigent whitepaper in
assessment `a85298ef-0214-4b2b-b084-733066b7cfd0`, run
`6c6b0c37-dc6c-4036-b57a-048a40a6fb27`. Stored extracted text exactly matches the
original's 34,840 characters / 1,157 lines; all five analysis phases record complete
source delivery. All seven artifacts are present, with 12 STRIDE threats and trees
for top-ranked `TH-001`, `TH-003` and `TH-006`. The run used 229,267 input and 46,512
output tokens. Fifteen claims remain explicitly marked for source review; citation
recovery did not stop the pipeline. The results remain drafts. This is a new OpenAI
live test; Anthropic was not rerun for this iteration.

The installed `AITM` command reopened that saved whitepaper report in a real 80x24
PTY. The full five-line logo, View Markdown action, draft label and disclaimer fit
on the first page. Section navigation, last page, Help's storage directory and
returning to Markdown all worked. Viewing created no runs and changed no artifacts
or cached PDFs. The report contains 2,522 wrapped terminal lines. API and CLI PIDs
matched; quitting exited cleanly and released both the API port and storage lock.
Syntax/format, package dry-run, installed tarball help and whitespace checks pass.
The separate older repository assessment remains saved; its brief incomplete-source
notice will clear when its full pipeline is rerun.

## API key settings and provider/model lists

`s` opens Settings with API key replacement and provider/model configuration.
Credential fields are masked and never prefilled with secret values. Each provider
can be updated independently; blank preserves its key and Escape cancels. Anthropic
has an optional workspace field. Keys are written atomically to private `keys.json`
before changing the active provider. Failed writes preserve the old active key;
retired keys remain redacted for in-flight responses. Saved settings take precedence
over environment and `.env.local` values. `aitm configure` uses the same writer,
with hidden prompts and blank-to-keep behavior. Project state and API responses
contain no credentials. Key changes do not invalidate analysis.

`p` opens provider, fast model and deep model lists. Up/Down, Page Up/Down and
Home/End navigate; Enter advances and the last choice saves the selection together.
Cancellation preserves configuration and generated artifacts. Selecting the same
settings again preserves the report: configuration comparison now uses field
values, avoiding false changes caused by JSON key ordering.

Model discovery uses the provider's account catalog with a ten-second timeout and
offline defaults on failure. Claude pagination and advertised structured-output,
effort and output-limit capabilities are checked; OpenAI general reasoning families
are filtered locally because its listing has no full capability metadata. Specialist
and Pro variants are excluded from new OpenAI catalog choices. Saved model IDs stay
selectable. The same catalog is exposed by `/v1/providers/:provider/models`.
Protocol references: [OpenAI model listing](https://developers.openai.com/api/reference/resources/models/methods/list)
and [Claude model listing](https://platform.claude.com/docs/en/api/typescript/models/list).

All 74 automated tests pass, including key persistence/precedence, permissions,
failed writes, symlink refusal, current/retired-key redaction, immediate request-header
replacement, model filtering/pagination/fallback, API status, masked TUI entry,
atomic selection, cancellation and preserving a report on unchanged selection.
Syntax/format, package dry-run and whitespace checks pass.

The installed AITM was exercised in a real 80x24 PTY with an isolated configuration
directory and synthetic credentials. `aitm configure` kept prompts hidden and
preserved the other provider; Settings masked and saved a replacement with mode 0600. Provider/model lists and paging fit the screen with the ASCII logo visible.
The API reflected the new credential source without revealing values. Quit exited
cleanly. These replacement tests did not change the user's real credentials.

Live read-only catalog lookups succeeded for both existing provider accounts:
28 OpenAI and 9 Anthropic choices after filtering. Small structured connection
requests succeeded with `gpt-5.6-terra` and `claude-sonnet-5`; no assessment sources
were uploaded. This verifies catalog/authentication behavior, not full pipelines
for every listed model. Evidence is under `artifacts/qa/settings/`.

## v2 browser workbench and bounded terminal reports

The current browser workbench uses the main-branch application's black sidebar,
light workspace, BDO Grotesk and gold/magenta accents with the v2 engine/API.
`aitm web [source]` launches the same single engine and opens its browser URL;
`--no-open` prints the link. The normal TUI and `serve` modes also serve the UI.
There is no separate web daemon or provider implementation.

The full workflow includes source paths/URLs and document uploads, saved-project
reuse, inventory/evidence inspection, scope and artifact edits, explicit review
gates, full runs with three attack trees, coordination, run history and complete
Markdown reports. Provider/model lists and masked key replacement share the engine's
configuration. Report/Markdown/PDF/project exports and imports are explicit.
Browser disconnect/reload keeps runs intact while the owning engine stays open.

Five Chromium end-to-end suites exercise the real engine/API with synthetic
sources and deterministic providers: full run and reload, all artifact views,
source markup isolation, risk filters, AND/OR trees, exact report text, explicit
Markdown/PDF/JSON downloads and import, mobile navigation, sequential review gates,
validation failures, object editing, stale revisions without lost input, masked
credentials and no-op settings, cancellation/resume/recovery, path reuse,
replacement/refresh/deletion, and preservation of pending model settings during
key saves, model discovery and connection checks. These are browser/transport
checks, not new live-provider pipeline runs. Screenshots were visually inspected.

Additional API tests cover static asset allowlisting and CSP, hostile origins,
private key replacement/permissions/write failure, source open/reuse/uploads,
primary source replacement, global SSE cleanup and CLI web lifecycle/reopening.
The browser tests are in CI on Linux and macOS alongside the existing checks.

The TUI previously let its content determine the overall terminal frame height.
It now reserves a cursor row, bounds the body, keeps controls from shrinking and
selects a saved report from the first frame. A regression checks 80x24, 100x30,
120x36, 60x20 and 80x16. Actual installed-AITM PTYs with a terminal screen emulator
verified opening, Page Down, End and Home at 80x24, 120x36, 60x20 and 80x16: the
menu remained above the report throughout, the normal-size logo stayed visible,
and each process exited cleanly. Short screens use a compact identity.

A read-only copy of the existing Divigent whitepaper assessment
`a85298ef-0214-4b2b-b084-733066b7cfd0` was opened in Chromium. The complete 127,280
character Markdown report matches the API exactly and displays all 20 sections,
12 threats and three trees. Its source retains all 34,840 characters. Desktop and
mobile report layouts were checked with no browser errors. The original project's
SHA-256 remained unchanged; no provider requests or PDF exports were needed.
Evidence, screenshots, logs and terminal transcripts are in `artifacts/qa/web/`.

Final checks: all 80 Node tests and five Chromium suites pass, as do syntax/format,
package dry-run and whitespace checks. The 47-file package was also installed into
an isolated directory with production dependencies only; its `web --no-open`
command started successfully and served the packaged HTML, modules, CSS and font.

## Project chooser and multi-source imports

This iteration supersedes the earlier current-directory and single-source UI flow.
`aitm` and `aitm web` now open Projects without ingesting anything. Both interfaces
create/open named projects, import several sources and manage individual snapshots.
Explicit launch paths/URLs remain shortcuts; `--project ID` opens saved work.
Existing reports and projects stay compatible. Source replacement preserves order
and IDs; switching projects leaves the active engine job running.

Repository ZIPs work through local files, browser uploads and public URLs. Imports
validate archive paths, entry kinds, encryption and declared/actual expanded sizes;
skip symlinks, credentials, dependencies and nested archives; honor nested ignore
rules; and remove temporary files. Public HTML URLs are retained as source without
executing scripts or fetching linked content. A multi-source batch commits once;
an invalid ZIP after a valid document leaves the prior project and report intact.

All **87 Node tests** and **six Chromium suites** pass. New coverage includes ZIP
traversal, absolute/backslash/duplicate paths, encrypted/special entries, expansion
bombs and size mismatch; local/upload parity; ignored files and temp cleanup;
DOCX/ZIP batch intake, source replacement and project isolation; required explicit
API sources; CLI empty startup even when cwd contains documents; `--project`
reopening; TUI creation/opening, cancelled dialogs and multi-file selection.

The new browser suite creates independent projects, uploads DOCX and ZIP together,
imports a page and repository ZIP from two URLs, runs all sources through TRACE
with three attack trees, changes projects during the run, rejects a bad batch
without modifying its completed report, replaces/removes one source, and renames
the project. Its public URL transport and AI providers are deterministic test
doubles; source extraction, engine, storage, API and browser flows are real.
No new paid provider calls or real user source uploads were made in this iteration.

Installed `AITM` was exercised in real PTYs at **80×24, 120×36, 60×20 and 80×16**:
empty startup, New project, file browsing with two marked files (Markdown and ZIP),
import, second-project creation, saved-project switching and clean quit. The
selection count remains visible when the file list scrolls. Controls remain in the
viewport, with the full logo at normal heights and compact identity on short screens.
Project chooser/import/source inventory screenshots were visually inspected.

Syntax/format, whitespace and package dry-run checks pass. The 50-file production
package was installed separately with production dependencies only; its API
successfully imported text and ZIP into one project and served the packaged HTML,
JavaScript, CSS and font. Evidence is under `artifacts/qa/projects/`, including
test logs, screenshots, PTY screen captures and package smoke results.

## Lowercase CLI, explicit report viewing and resilient classification

The installed command entry was actually named `AITM` on the case-insensitive
macOS filesystem. It was renamed to `aitm` without changing the package target;
the directory entry and `aitm --version` were verified. The package already exposes
only the lowercase bin name.

Read-only inspection of the running Divigent assessment showed 101 imported files
and seven classification batches. It had failed on batch three after a provider
retry because a previously found candidate was omitted from the next draft.
A synthetic regression reproduced the same `Retain previousDraft.candidates`
failure. The engine now retains absent earlier keyed findings, merges explicit
updates and validates the combined result. Nested tree nodes and cross-referenced
roles are covered too. Omission no longer triggers a retry; invalid structure
still fails validation. All accepted source content continues to be processed.

The web toolbar exposes full-pipeline autorun on every project view, including
Sources & Scope, and an import checkbox can start it immediately after a successful
import. Streaming progress retains batch counts and provider/model context and
distinguishes classification from source loading. A separate browser regression
reproduced a race that left Opening assessment on screen when live refresh
overtook navigation without changing the revision; rendering now completes.

Approval works without a reviewer identity in the engine, API, TUI and browser.
Optional notes, timestamps, revision checks and review prerequisites remain.
Existing named reviews remain supported. A synthetic PDF review record without
names was rendered and visually checked, along with desktop/mobile web controls.

The TUI now opens completed projects on the phase menu. `v` explicitly opens the
report and Escape returns to the menu. Real lowercase-`aitm` PTYs at 80×24, 120×36,
60×20 and 80×16 viewed a copy of the saved Divigent whitepaper report, paged to its
end and back, and returned to the menu. Controls remained visible throughout.
The original saved project's SHA-256 remained unchanged.

All 91 Node tests and eight Chromium suites pass, including the new regressions
and an end-to-end multi-batch autorun/unnamed-approval flow. Syntax/format, package
dry-run and whitespace checks pass. These tests use deterministic providers;
no new paid AI calls were made, and the existing user's failed run was not restarted.
Evidence is under `artifacts/qa/feedback/`.

On 2026-09-06, the user's subsequent live `test` project completed classification
with OpenAI `gpt-5.6-terra` at 21:27 UTC. All seven batches covered the 101 imported
files (952,819 characters), producing 46 candidates. Earlier omitted findings were
retained; five claims with unresolved citations were saved as unverified assumptions
without aborting the run. This verifies classification with a real provider, not
the remaining pipeline phases. The existing user-started run was monitored through
the API without restarting it or initiating additional provider requests. Its final
status and generation metadata are in `artifacts/qa/classification-live/status.json`.
