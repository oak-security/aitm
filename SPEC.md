# AiTM v2 specification

This replaces the former desktop architecture. AiTM (AI Threat Modeller) is a
reusable engine implementing the original TRACE workflow. `aitm` runs the engine,
terminal UI and local API in a single process. `aitm web` starts the same engine/API
and opens its browser workbench. The original specification is
retained in docs/original-spec.md.

## Runtime boundary

One Node ESM package contains the headless engine, HTTP API, Ink TUI and static browser workbench. The TUI
calls the engine directly and subscribes to its change events. The API exposes the
same instance to external clients; no HTTP handshake or polling is needed by the
TUI. The package root exports Engine, Providers, phases, reports and startServer.
The engine owns all mutations, persistence and phase transitions. Interfaces never
write project storage or expose credentials.

The CLI owns the lifetime of all three components. Quit, Ctrl+C and SIGTERM cancel
unfinished work, save completed artifacts and close the engine and API. Opening
the same source resumes its saved assessment. No detached child, PID file, server
attachment or stop command. `aitm serve` provides a foreground API without the TUI.
The API serves the web UI at `/`; `aitm web [source]` opens the browser and
`--no-open` prints its URL. Browser disconnects do not cancel engine jobs.
Only loopback binding is supported; this is a local, single-user application.

## Inputs and provenance

Both interfaces open a project chooser by default, with no implicit source intake.
Create/open named projects and import multiple sources: public HTTPS URLs, document
files or repository ZIPs. Each project owns its sources, settings, runs and reports.
Import dialogs support file selection and explicit URLs/paths; empty input never
selects the current directory. Renaming, closing, deleting and JSON import are supported.
Switching projects leaves engine jobs active. A failed batch import preserves the
entire prior project. Replacing one source preserves its ID and position and all others.
An optional explicit CLI path/URL opens the most recent project containing that
source without re-ingestion or AI calls, or creates a named assessment with default
scope. `--project ID` opens saved work directly.
The reusable engine and API also accept inline text, combined sources and synced
file snapshots for integrations. UTF-8 code/text, PDF and DOCX are ingested. A source stores
ID, kind, locator when local, label, collection time, commit when Git, SHA-256, file
IDs/hashes/extracted text/line counts and limitations. Temporary clones are removed.
Image-only PDFs need OCR before ingestion. Binary images/audio/video are not
understood as text. These limitations are explicit, not empty successes.
ZIP extraction is sequential and bounded to 8 MiB compressed, 32 MiB expanded and
10,000 entries; accepted files follow the normal text limits and ignore rules.
Reject unsafe/ambiguous paths, encrypted entries and special devices. Skip symlinks
and nested archives; remove temporary extraction files even on failure/cancellation.
Accepted extracted text is preserved in full, never sliced to fit a prompt. Reject
oversized direct documents explicitly; show skipped folder files in Scope diagnostics.
Classification is a quick inventory/scope pass, without candidate extraction. TRACE
model construction reads all accepted text in sequential source batches, carrying
its accumulated draft and stable object IDs forward. Ask for new or changed objects
only, and retain unchanged objects in the engine. Publish the validated model only
after all batches finish. STRIDE, trees, coordination and report synthesis use
completed artifacts, without rereading source batches. Record the input basis and
full source coverage in generation metadata.
The engine merges omitted earlier keyed objects into each new draft before
validation. Keep updated fields from the new batch, retain absent earlier items
(including nested tree nodes), and record retained paths. Omission alone must not
cause a provider retry or failure. Schema, evidence, references and structure
remain validated on the complete merged result.

Document downloads use public HTTPS addresses, checked at DNS resolution and on
every redirect. Downloads are bounded to 8 MiB, 30 seconds and three redirects.
HTML pages are stored in full as inert source. No page scripts, embedded-resource
fetching or web crawling; a PDF behind a page requires its direct download URL.

Remote clients can push text or base64 document snapshots and replace them by source
ID. Explicit sync re-reads local inputs or re-clones the Git default branch. Changed
hashes or extracted text clear generated artifacts and inventory approval. Unchanged sync preserves
analysis. This iteration has explicit synchronization, not a background file watcher.
Legacy truncated snapshots are automatically re-read from their original locator
before running; portable truncated snapshots require replacement with the complete
original. Rebuild analysis affected by either stored truncation or old prompt excerpts.
Single-phase reruns of these assessments require a complete pipeline run first.

## TRACE artifacts and execution

| Phase          | Artifact                                                                                             | Gate             | Optionality                              |
| -------------- | ---------------------------------------------------------------------------------------------------- | ---------------- | ---------------------------------------- |
| 0 scope        | Assessment boundary and source inventory                                                             | Human approval   | Required                                 |
| 1 ingest       | Provisional inventory/scope summary and domain/pillar classification                                 | No separate gate | Required                                 |
| 2 model        | Threat actors, roles, protected assets, critical invariants, components, typed edges and questions   | Human approval   | Required                                 |
| 3 stride       | Ranked threats, six STRIDE categories, controls, confidence, coverage rationale                      | Human approval   | Required                                 |
| 4 trees        | Top-threat attack trees, AND/OR branches, assumptions, prerequisites, leaf mitigations and omissions | Human approval   | On by default                            |
| 5 coordination | Actor combinations, thresholds, incentives, shared dependencies, consequences and mitigations        | Human approval   | Auto from profile/model; on/off override |
| 6 report       | Executive summary, linked mitigation roadmap, residual risks, questions and next steps               | Human approval   | Required                                 |

Each phase produces schema-validated data. TRACE objects require exact evidence
quotes/line references or explicit inferred assumptions. Before validation,
generated line ranges may be relocated to a unique,
exact quote in the claimed file; corrections are recorded in generation metadata.
Unmatched evidence is removed from verified citations and its claim is retained
as an explicit unverified assumption with a review note, without another provider
call. Rejected citations are retained in diagnostic metadata. Generation schemas
constrain downstream references to canonical model IDs. Unambiguous identity/name
matches can repair references locally; unresolved optional links are removed from
the link arrays and explicitly recorded for review without discarding the claim.
Required broken relationships and malformed structure get one bounded repair.
Threats reference existing objects; risk is likelihood (1–5) × impact (1–5). Every asset, invariant and edge has
a coverage row with linked threats or an explanation. Trees have one root, no cycles,
valid parent links, AND/OR operators and mitigated leaves. Top threats without a tree
have a documented reason in configurable draft/review runs. Full pipeline mode
requires trees for each of the top three threats, or all threats if fewer than three
exist; omissions cannot replace them. Ranking uses likelihood × impact, then ID
for ties. Roadmap entries link to model/threat/tree/coordination IDs.

The engine derives generated coverage links from the actual threat references,
records corrected mappings, and flags unaddressed objects as coverage gaps for
human review. This prevents a separate AI-generated index from claiming unsupported
coverage. Human-edited and imported artifacts still undergo full consistency validation.

Review mode pauses at every enabled gate. Human approval records time, optional reviewer and
notes. It requires upstream gates to be approved. Draft mode runs through gates while
leaving generated artifacts unapproved. Full mode also bypasses review pauses,
enables trees with a limit of three and automatic coordination when it was off.
It reuses existing model/STRIDE analysis and regenerates incompatible trees and
downstream artifacts. No mode invents review history.

Runs are durable jobs with ordered replayable progress events, phase state, token
usage and terminal status. Source/config edits are rejected while a job is running.
Resume reuses saved artifacts and retries the unfinished phase. Restart clears
generated artifacts. Individual phases can be regenerated with prerequisite checks.
Cancelling aborts provider I/O and retains only completed artifacts. Interrupted jobs
are marked on server restart. A disconnected UI does not cancel work.
Before every provider call, a durable request event identifies the model, attempt
and current/total source batches.
Events distinguish waiting, streaming, validation, retry, artifact publication and
reuse. Run and phase start times support elapsed indicators before the first token.

## Providers

OpenAI Responses uses streamed strict JSON-schema output and `store:false`.
Anthropic Messages uses streamed `output_config.format` structured JSON and preserves
its default reasoning behavior. Provider choice, fast/deep model IDs and effort are
per-project. STRIDE and coordination use the deep model; other calls use the fast
model. Refusals, output truncation, malformed streams, invalid schemas and network
errors must be visible. An invalid artifact gets one bounded correction attempt;
usage includes completed rejected calls. Citation problems become review notes.
Without a structurally valid draft, an unsuccessful step remains resumable with
its earlier artifacts preserved. Provider key tests are bounded small requests.

Keys come from saved `~/.config/aitm/keys.json` settings, then environment, then
private `.env.local`, in that precedence order. They never appear in API state.
TUI Settings can add or replace each key with masked input. Blank preserves the
existing key and Escape cancels. Save atomically with mode 0600 before updating the
active provider; failed writes preserve the old credentials. Replacements apply to
subsequent requests without a restart and do not invalidate artifacts. Keep both
old and current credentials redacted for in-flight responses. Files use OS
permissions; encryption is not claimed. CLI `aitm configure` uses the same store.
Multi-workspace Anthropic keys use a saved workspace ID or the process's
`ANTHROPIC_WORKSPACE_ID` setting. A saved empty value clears the environment default.
Startup, source import and existing report exports work without a provider key;
starting analysis without the selected provider's key fails before a run is created.
Anthropic schemas convey unsupported bounds in descriptions; the engine still
enforces the original complete schemas locally.
No source material leaves the device until a user starts an AI run.

## Persistence and API

Private data directory, atomic JSON project documents, one process lock. Project
updates carry a revision; conflicting edits return 409. Exports contain evidence,
artifacts and review/job history without credentials. Imports validate source and
artifact structure, create a new project ID and require fresh reviews. Local source
paths become portable snapshots on import. Existing v1 data is left untouched.

HTTP resources are versioned under `/v1`; `/v1/openapi.json` provides schemas and
`/v1/meta` the phase registry. Jobs return immediately with HTTP 202. SSE supports
replay with Last-Event-ID or after. Errors have a stable code and safe message.
Validate body sizes, path IDs, Host, Origin and browser fetch metadata.

## Terminal and reports

The terminal starts at Projects. `n` creates a project; `o` opens the Projects menu;
`i` adds sources; `b` manages individual sources. Import uses URL/path entry or a
file browser with Enter navigation and Space multi-file selection. Escape cancels
without importing anything. Project dialogs offer open, rename, close, delete and
JSON import. Explicit source/ID launch arguments open that assessment directly.
Within an assessment it offers full-pipeline run, phase inspection, review/edit,
provider settings, cancellation, source refresh and Markdown/PDF/JSON export.
`s` opens Settings for API keys and model configuration. `p` opens a provider list,
then fast and deep model lists, using account discovery with offline defaults.
The engine owns model discovery; the API exposes the same catalog. Save provider
and both models atomically only after the final choice. Escape at any step leaves
the saved configuration and analysis unchanged. Support paging for long lists.
Scope and optional phases are editable in settings. External editors are launched
without a shell while Ink relinquishes the terminal. The complete five-line ASCII logo remains visible during and after runs, including
80×24 terminals. Its metadata sits beside it to preserve reading space. Narrow terminals use a stacked layout; short terminals use a compact identity.
The frame reserves a cursor row and bounds report/body height so reopening or
paging a completed report cannot scroll the controls out of the viewport.

The full-pipeline action is prominent. Progress comes directly from engine events,
with a spinner, phase count, elapsed times, provider/model, activity and output
counts. The progress bar counts ready phases, not an estimated time percentage.
The CLI also accepts `--full` to start/resume immediately after opening its source.

The artifact pane follows each new TRACE stage automatically while still allowing
manual inspection. Recoverable citation issues appear as source-review notes. If a
step cannot complete, show its name and Continue/Details actions; raw validator
paths belong in the run log, not the main status banner.

The report phase offers the full assembled document in a reader spanning the
terminal width. Reports open only on explicit `v`; opening a completed or imported
project keeps the phase menu. Escape closes the reader and returns to the menu.
Support line/page scrolling, section navigation and first/last page.
Preserve draft labels, evidence, assumptions and review notes. Render tables as
labelled records so wide columns cannot hide report content. Up/Down still selects
TRACE phases. Label `v` explicitly as View Markdown. Viewing creates no files and
never calls an AI provider. PDF is generated only by an explicit export choice.
`x` offers Markdown, PDF and JSON with a destination path. Help shows the actual
data directory; reports are assembled on demand from persisted project artifacts.
Provider connection testing uses `V`.

Report assembly is deterministic from validated artifacts. Include scope, provenance,
TRACE model, ranked threats, coverage, enabled optional analyses, roadmap, unresolved
questions and review records. Never include disabled-phase content. The report is
marked draft until all enabled review gates are approved. PDF embeds BDO Grotesk
under its separate SIL Open Font License. Render structured artifacts directly in
an A4 layout with readable text, page numbers, clickable contents and bookmarks.
Include likelihood/impact and STRIDE charts, ranked threats, connected attack-tree
diagrams, a time-grouped mitigation roadmap, and linked evidence/source appendices.
Preserve full cited quotes and source metadata with pagination that avoids clipping;
full source snapshots remain available through JSON export. Re-exporting existing
artifacts applies the current layout without provider calls or state changes.
Do not hard-code a personal author name. State prominently: Generated by AiTM using
AI. This report was not authored, reviewed or endorsed by Oak Security. It needs
expert judgement and is not a code audit or a warranty. Retain explicit human review
records. Omit a generic Source limitations section; show routine import diagnostics
in Scope and preserve meaningful unresolved questions and unverified claims in the
report. Legacy analyses using incomplete text need a brief notice until rebuilt.

## Browser workbench

Use the original main-branch workbench's visual language: black project/phase
sidebar, light paper workspace, bundled BDO Grotesk and gold/magenta accents. The
browser is a same-origin client of the existing versioned API. No Electron runtime,
second engine, frontend daemon, CDN dependencies or separate provider adapters.

The opening screen lists projects with New project and Open project actions.
Add sources offers multi-file document/ZIP uploads or one explicit URL/path per
line. No current-folder default. Each source can be replaced, refreshed or removed
individually. Portable JSON imports create new projects requiring fresh review.
Keep Run full pipeline in the persistent toolbar on every project view. It autoruns
all phases with top-three attack trees and no approval pauses. The import dialog
offers an explicit Run full pipeline after import checkbox. Display classification
separately from file import, retain batch/model progress through streaming updates,
and show time since the last update. Overlapping live refreshes must always finish
rendering a new route, even if the project revision did not change.
Overview presents full-pipeline and review-gated runs. All TRACE phases are
inspectable, with evidence links into complete numbered source files, ranked threat
filters, hierarchical AND/OR trees and coordination details. Scope and common
artifact fields have form editors; complete artifacts have validated JSON editing.
Approvals record a timestamp and optional notes; no reviewer name is required.
Optional named reviews from API clients remain supported. Respect engine prerequisites.

Persistent navigation/status must remain outside the scrolling content. Support
small screens, keyboard controls, labelled forms and modal dialogs. Display live
job activity, phase, elapsed time and output counts over SSE; reconnect and reload
must restore the current run. Global events notify changes made through other
interfaces. Do not replace unsaved form input during live updates. Use captured
project revisions when submitting edits; expose conflicts without losing text.

Provide masked key entry, provider/model dropdowns using the engine catalog,
connection testing and project model/phase settings. Never return key values or
persist them in browser storage. Saving credentials must not erase pending model
selections or invalidate analysis. Markdown reports are complete and readable, with
section navigation and an exact source view. HTML/images/links in source/model
text remain inert. All downloads are explicit; report reading never generates PDF.
Static assets have an explicit allowlist and CSP and use existing Host/Origin/fetch
metadata restrictions. Browser tests use synthetic sources and deterministic
providers with the real engine/API; live-provider verification remains separate.

## Acceptance evidence

Required: syntax/package checks; automated engine, API, provider-protocol, ingestion,
semantic-validation, interactive TUI and browser end-to-end tests; an actual terminal smoke test; PDF
rendering inspection; and full live pipelines using supplied OpenAI/Anthropic keys.
Use the previous Dividend repository/whitepaper if located. If unavailable, disclose
the alternative source. Live-provider success cannot be inferred from mocked tests.
