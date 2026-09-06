# AiTM v2 specification

This replaces the former desktop architecture. The current objective is a server
process that implements the original TRACE workflow, an API for independent clients,
and a terminal UI launched by `aitm`. Product name: AiTM, AI Threat Modeller.
The original specification is retained in docs/original-spec.md.

## Runtime boundary

One Node ESM package contains the engine, local HTTP API, HTTP client and Ink TUI.
The engine owns every mutation and phase transition. TUI code never accesses the
project store or provider credentials. `aitm` starts or attaches to a background
server; `aitm serve` runs it in the foreground. Client exit leaves jobs running.
Only loopback binding is supported; this is a local, single-user application.

## Inputs and provenance

A project combines scope, local folders/files, public Git repositories, inline text
and synced file snapshots. UTF-8 code/text, PDF and DOCX are ingested. A source stores
ID, kind, locator when local, label, collection time, commit when Git, SHA-256, file
IDs/hashes/extracted text/line counts and limitations. Temporary clones are removed.
Image-only PDFs need OCR before ingestion. Binary images/audio/video and ZIP archives
are not understood as text. These limitations are explicit, not empty successes.

Remote clients can push text or base64 document snapshots and replace them by source
ID. Explicit sync re-reads local inputs or re-clones the Git default branch. Changed
hashes clear generated artifacts and inventory approval. Unchanged sync preserves
analysis. This iteration has explicit synchronization, not a background file watcher.

## TRACE artifacts and execution

| Phase          | Artifact                                                                                             | Gate             | Optionality                               |
| -------------- | ---------------------------------------------------------------------------------------------------- | ---------------- | ----------------------------------------- |
| 0 scope        | Assessment boundary and source inventory                                                             | Human approval   | Required                                  |
| 1 ingest       | Source summary, domain/pillar classification, candidate objects, missing evidence                    | No separate gate | Required                                  |
| 2 model        | Threat actors, roles, protected assets, critical invariants, components, typed edges and questions   | Human approval   | Required                                  |
| 3 stride       | Ranked threats, six STRIDE categories, controls, confidence, coverage rationale                      | Human approval   | Required                                  |
| 4 trees        | Top-threat attack trees, AND/OR branches, assumptions, prerequisites, leaf mitigations and omissions | Human approval   | On by default                             |
| 5 coordination | Actor combinations, thresholds, incentives, shared dependencies, consequences and mitigations        | Human approval   | Auto from classification; on/off override |
| 6 report       | Executive summary, linked mitigation roadmap, residual risks, questions and next steps               | Human approval   | Required                                  |

Each phase produces schema-validated data. TRACE objects require exact evidence
quotes/line references or explicit inferred assumptions. Before validation,
generated line ranges may be relocated to a unique,
exact quote in the claimed file; corrections are recorded in generation metadata.
Invented or ambiguous evidence is rejected. Threats reference existing
objects; risk is likelihood (1–5) × impact (1–5). Every asset, invariant and edge has
a coverage row with linked threats or an explanation. Trees have one root, no cycles,
valid parent links, AND/OR operators and mitigated leaves. Top threats without a tree
have a documented reason. Roadmap entries link to model/threat/tree/coordination IDs.

The engine derives generated coverage links from the actual threat references,
records corrected mappings, and flags unaddressed objects as coverage gaps for
human review. This prevents a separate AI-generated index from claiming unsupported
coverage. Human-edited and imported artifacts still undergo full consistency validation.

Review mode pauses at every enabled gate. Human approval records reviewer, time and
notes. It requires upstream gates to be approved. Draft mode runs through gates while
leaving generated artifacts unapproved. Neither mode invents review history.

Runs are durable jobs with ordered replayable progress events, phase state, token
usage and terminal status. Source/config edits are rejected while a job is running.
Resume reuses saved artifacts and retries the unfinished phase. Restart clears
generated artifacts. Individual phases can be regenerated with prerequisite checks.
Cancelling aborts provider I/O and retains only completed artifacts. Interrupted jobs
are marked on server restart. A disconnected UI does not cancel work.

## Providers

OpenAI Responses uses streamed strict JSON-schema output and `store:false`.
Anthropic Messages uses streamed `output_config.format` structured JSON and preserves
its default reasoning behavior. Provider choice, fast/deep model IDs and effort are
per-project. STRIDE and coordination use the deep model; other calls use the fast
model. Refusals, output truncation, malformed streams, invalid schemas and network
errors must fail visibly. An invalid artifact gets one bounded correction attempt; usage includes the rejected call. Provider key tests are bounded small requests.

Keys come from environment, private `.env.local`, or `~/.config/aitm/keys.json` and
never appear in API state. Files use OS permissions; encryption is not claimed.
Multi-workspace Anthropic keys use the server's `ANTHROPIC_WORKSPACE_ID` setting.
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

The terminal offers project creation/selection, source intake/sync, provider settings,
artifact inspection/editing, review approvals, run/resume/restart, cancellation,
progress and Markdown/PDF/JSON exports. Scope and optional phases are editable in
settings. External editors are launched without a shell while Ink relinquishes the
terminal. The logo is ASCII and colors follow Oak branding. Narrow terminals use a
stacked layout; output scrolls inside the selected artifact.

Report assembly is deterministic from validated artifacts. Include scope, provenance,
TRACE model, ranked threats, coverage, enabled optional analyses, roadmap, unresolved
questions and review records. Never include disabled-phase content. The report is
marked draft until all enabled review gates are approved. PDF embeds Oak BDO Grotesk.
State that the report was prepared independently using Oak tooling and needs expert
judgement; it is not a code audit or a warranty.

## Acceptance evidence

Required: syntax/package checks; automated engine, API, provider-protocol, ingestion,
semantic-validation and interactive TUI tests; an actual terminal smoke test; PDF
rendering inspection; and full live pipelines using supplied OpenAI/Anthropic keys.
Use the previous Dividend repository/whitepaper if located. If unavailable, disclose
the alternative source. Live-provider success cannot be inferred from mocked tests.
