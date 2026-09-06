# AiTM engine API

Start `aitm [source]`, `aitm web [source]` or `aitm serve` and connect to `http://127.0.0.1:8790`. The API is local and
single-user; no authentication or network binding beyond loopback is supported.
The normal TUI calls the same engine directly. Independent clients should use this
API instead of reading project files. Closing AiTM also closes its API; `aitm serve`
runs the engine and API without a TUI.

`GET /v1/openapi.json` is the generated contract. `GET /v1/meta` gives the TRACE
phase registry, default scope and artifact JSON schemas. Provider keys are configured in the owning process;
`GET /v1/providers` exposes only configuration booleans and default model IDs.
It also includes `keySource` (saved settings, environment, `.env.local` or session),
never the key value. TUI Settings (`s`) and browser Settings save replacements privately and updates the
shared provider immediately. Credentials are not project settings and are not
accepted through project PATCH/import operations. `aitm configure` uses the same
private store; saved keys take precedence over environment values on startup.

`GET /v1/providers/:provider/models` returns `{ source, models: [{ id }], notice }`.
It queries the provider account with a bounded timeout and filters for the pipeline's
reasoning/structured-output workflow. `source: "defaults"` and a notice indicate
missing credentials, lookup failure or no matching models; `source: "account"`
indicates a successful catalog lookup. OpenAI's listing does not provide full
capability metadata, so its model families are filtered locally. A listed model
is not a guarantee of account generation access; the existing connection test
checks the selected model with a small structured request.

## Start a project and run

All request bodies use `Content-Type: application/json`.

```sh
curl -s http://127.0.0.1:8790/v1/projects \
  -H 'Content-Type: application/json' \
  -d '{"name":"Custody review","scope":"Assess signer and release authority"}'
```

The result is a project document with `id`, `revision`, `config`, `sources`,
`artifacts`, `runs` and `audit`. Use its `id` as `PROJECT_ID` below.

```sh
curl -s http://127.0.0.1:8790/v1/projects/PROJECT_ID/sources \
  -H 'Content-Type: application/json' \
  -d '{"kind":"text","label":"Architecture","text":"The vault holds deposits. Two of three signers authorize releases."}'

curl -s http://127.0.0.1:8790/v1/projects/PROJECT_ID/runs \
  -H 'Content-Type: application/json' \
  -d '{"mode":"full"}'
```

Starting a run returns HTTP 202 with a job ID. `mode: "review"` is the default;
it pauses at human review gates. `draft` bypasses gates without approving artifacts.
`full` runs the complete pipeline without review pauses, enables trees with
`treeLimit: 3`, and changes coordination from `off` to `auto` when needed. Trees are
required for every one of the top three STRIDE threats (risk = likelihood × impact;
ties sort by ID), or all threats if fewer than three exist. Omission notes cannot
replace these trees. Saved model/STRIDE artifacts are reused; incompatible trees
and dependent artifacts are regenerated. All generated outputs remain drafts.
`resume: true` is the default; `resume: false` clears generated artifacts before
starting again. `phase: "stride"` (or another generated phase ID) regenerates only
that phase after checking prerequisites and clearing dependent artifacts. `full`
cannot be combined with a single `phase`.

```sh
curl -N http://127.0.0.1:8790/v1/projects/PROJECT_ID/runs/RUN_ID/events
curl -s http://127.0.0.1:8790/v1/projects/PROJECT_ID/runs/RUN_ID
```

SSE events have increasing integer IDs. Reconnect with `Last-Event-ID: 12` or
`?after=12` to replay later events. Event types include `running`, `request`, `progress`,
`validating`, `batch_complete`, `artifact`, `validation_retry`, `repair_fallback` (legacy), `evidence_review`, `reference_review`, `reused`, `skipped`, `awaiting_review`, `completed`, `failed`,
`cancelled`, and `interrupted`. Terminal events close the stream. The server keeps
working if a progress subscriber disconnects. Progress exposes character/token counts,
not raw provider text. Completed phase output is available in project state.
`request` is emitted before waiting for the provider and includes `provider`, `model`
and `attempt` (1 or 2 within each batch), plus `batch` and `batches` (current/total).
`progress` and `validating` also carry the batch and model fields, so streaming
updates retain progress context. `batch_complete` records each completed source
batch and the number of earlier findings retained automatically.
`validating` precedes evidence/reference checks; `reused`
identifies a saved phase. Jobs expose `startedAt` and `phaseStartedAt` so clients can
show elapsed time even before the first streamed output arrives.
`evidence_review` means unresolved citation claims were saved as unverified
assumptions without another provider call; the job continues. `reference_review`
marks unresolved optional model links; claims retain valid links and explicit
uncertainty. `repair_fallback` is retained in historical runs from the former
citation-retry workflow. Artifacts expose a
derived `reviewNotes` array (`path`, `claim`, `note`). Rejected citations are kept in
`generation.evidenceWarnings`, rather than in the artifact's valid evidence fields.
`source_refresh` reports recovery of legacy truncated snapshots or rebuilding
analysis previously made from prompt excerpts. Original local/Git/URL sources are
re-read when required; portable incomplete snapshots need replacement via PUT.
A single-phase run requiring this migration returns 409 `source_refresh_required`
with instructions to run the full pipeline.

Classification uses the source inventory and scope. The model phase reads every
accepted source character across sequential batches. Later batches receive the
accumulated draft and return new or updated objects; the engine retains unchanged
keyed findings. `generation.retainedFindings` records retained paths. No partial
model is published. STRIDE, trees, coordination and report consume completed
artifacts without repeated raw-source passes. Generation metadata records
`sourceCoverage: { complete, files, characters, batches }` for model construction,
`{ fromInventory: true }` for classification and `{ fromArtifacts: true }` downstream.
Coverage records delivery, not an assurance of exhaustive AI understanding.

Generated downstream reference fields are restricted to canonical model IDs by the
provider schema. Local, unambiguous identity repairs are recorded in
`generation.referenceCorrections`; unresolved optional links are recorded in
`generation.referenceWarnings` and removed from valid link arrays with explicit
review notes. No missing model objects are invented. Structurally invalid required
relationships still trigger a single bounded repair before a failed phase.

## Resources

| Method and path                                  | Behavior                                                          |
| ------------------------------------------------ | ----------------------------------------------------------------- |
| `GET /v1/health`                                 | Server identity, version, PID and storage directory               |
| `GET /v1/meta`                                   | Phase registry and artifact schemas                               |
| `GET /v1/providers`                              | Provider configuration status and model defaults                  |
| `GET /v1/providers/:provider/models`             | Account model choices, or defaults with a notice                  |
| `POST /v1/providers/:provider/test`              | Real connection test; body `{ "model": "..." }`                   |
| `GET /v1/projects`                               | Project summaries                                                 |
| `POST /v1/projects`                              | Create from name, scope and optional config                       |
| `GET /v1/projects/:id`                           | Complete project state                                            |
| `PATCH /v1/projects/:id`                         | Edit name, scope or complete config; `revision` required          |
| `DELETE /v1/projects/:id`                        | Delete an idle project                                            |
| `GET /v1/projects/:id/phases`                    | Enabled phases, including classification-derived defaults         |
| `POST /v1/projects/:id/sources`                  | Ingest a new source                                               |
| `POST /v1/projects/:id/sources/import`           | Atomically add a batch of explicit sources                        |
| `PUT /v1/projects/:id/sources/:sourceId`         | Replace a source using the same input formats                     |
| `POST /v1/projects/:id/sources/:sourceId/sync`   | Re-read a local, Git or URL source; body `{}`                     |
| `DELETE /v1/projects/:id/sources/:sourceId`      | Remove source and invalidate analysis                             |
| `PUT /v1/projects/:id/artifacts/:phase`          | Validated edit: `{ "revision": 12, "data": {...} }`               |
| `POST /v1/projects/:id/artifacts/:phase/approve` | `{ "revision": 12, "notes": "..." }`; reviewer and notes optional |
| `POST /v1/projects/:id/runs`                     | Start/resume a job                                                |
| `GET /v1/projects/:id/runs/:runId`               | Status, usage, errors and event history                           |
| `GET /v1/projects/:id/runs/:runId/events`        | SSE progress and replay                                           |
| `POST /v1/projects/:id/runs/:runId/cancel`       | Cancel provider I/O; body `{}`                                    |
| `GET /v1/projects/:id/report?format=markdown`    | Full Markdown report                                              |
| `GET /v1/projects/:id/report?format=pdf`         | PDF report                                                        |
| `GET /v1/projects/:id/export`                    | Portable JSON envelope                                            |
| `POST /v1/projects/import`                       | Validate/import that envelope as a new unreviewed project         |

## Source formats

```json
{ "kind": "local", "path": "/absolute/path/to/repo-or-document", "label": "Optional label" }
```

```json
{ "kind": "git", "url": "https://github.com/organisation/repository" }
```

```json
{ "kind": "url", "url": "https://example.org/whitepaper.pdf" }
```

Public URLs support code/text, HTML pages, PDF, DOCX and repository ZIPs. Downloads allow public HTTPS
addresses only, including DNS results and redirect targets, and are bounded to
8 MiB, 30 seconds and three redirects. HTML is preserved as source without running
scripts, crawling links or fetching embedded resources. Use the direct document
link to assess a PDF/DOCX linked from a page.

```json
{ "kind": "text", "label": "Workshop notes", "text": "..." }
```

```json
{
  "kind": "files",
  "label": "Editor sync",
  "files": [
    { "path": "src/vault.sol", "content": "...", "encoding": "utf8" },
    { "path": "design.pdf", "content": "BASE64_CONTENT", "encoding": "base64" }
  ]
}
```

For editor integration, create a `files` source once and `PUT` the current file set
to that source ID when it changes. Each PUT replaces the whole source snapshot.
Paths must be relative and cannot traverse directories or name credential files.
Text/file sources are refreshed by PUT; local/Git/URL sources also support explicit sync.
Inputs are snapshotted atomically; a failed ingest leaves project evidence unchanged.
To add several sources to an existing project, use
`POST /v1/projects/:id/sources/import` with `{ "sources": [...] }`. Each item is an
explicit path/HTTPS URL string or one of the SourceInput objects above. The batch
is limited to 100 sources and saves once after every import succeeds. Any error or
cancellation leaves all existing sources and analysis unchanged. Empty strings and
empty batches are rejected; no route implicitly reads the current directory.
`PUT /v1/projects/:id/sources/:sourceId` also accepts `{ "source": "/path/or/url" }`
and preserves the replaced source's position and ID.

Local `.zip` paths, ZIP URLs and base64 `.zip` file entries expand into evidence
files. Archives are limited to 8 MiB compressed, 32 MiB expanded and 10,000 entries.
Unsafe/ambiguous paths, encrypted entries and special devices fail the import;
symlinks, dependencies, credentials and nested archives are skipped. Nested ignore
rules apply. Temporary extraction files are removed after success or failure.

Accepted files retain their complete extracted text. Size caps reject inputs or
record skipped folder files instead of saving truncated excerpts. Inline `text`
inputs accept up to 500,000 characters; use local documents or file snapshots for
larger inputs within the file limits.

## Report storage and viewing

Project documents are stored as `<project-id>.json` in the configured data directory
(default `~/.local/share/aitm-v2`, exposed by `/v1/health`). They contain all report
artifacts; Markdown is assembled on demand by the report endpoint and TUI's `v`
reader. Viewing never writes PDF or Markdown files. The PDF endpoint generates a
response only when requested; the TUI's `x` export requires an explicit format and
destination. Reports identify AiTM as the generating tool and disclaim Oak Security
authorship, review and endorsement, with no hard-coded personal author name.

## Configuration and reviews

Project config has `provider`, `fastModel`, `deepModel`, `effort` (`low|medium|high`),
`trees` (boolean), `coordination` (`auto|on|off`) and `treeLimit` (1–10). Fetch a
project, modify its config, and PATCH it with the fetched revision. When switching
provider, select that provider's default models from `/v1/providers` or your own
model IDs. Changing config invalidates generated analysis.

Review phases use `scope`, `model`, `stride`, `trees`, `coordination`, `report`.
The `ingest` artifact is not a separate approval gate. Scope approval requires
nonempty scope and evidence. Reviewer identity is optional (omitted/empty names
are accepted); approvals still record a timestamp. Upstream gates must be approved before a downstream
approval. Editing generated JSON resets that artifact's review and deletes later
artifacts. A report remains marked draft until every enabled gate is approved.

## Errors and limits

Errors are `{ "error": { "code": "revision_conflict", "message": "..." } }`.
HTTP 400 means malformed JSON, 403 disallowed browser origin/host, 404 unknown
resource, 409 busy project / revision conflict / missing review, 413 oversized body,
415 wrong media type and 422 invalid input. Provider failures after a job starts
appear in the job's status/error, not in the already-returned 202 response.

Request bodies are capped at 16 MiB. Ingestion has additional file/content caps
documented in README.md. Calls never execute source files. Repository intake is
restricted to public HTTPS GitHub, GitLab and Bitbucket URLs. API state is private
to the local operator; it contains assessment evidence and should be handled as such.

Provider output receives schema and semantic validation before publication. An
invalid artifact gets one bounded correction attempt; usage includes both calls.
Persistent citation mismatches become explicit unverified assumptions and review
notes without stopping the sequential pipeline. The original citation is not
treated as evidence. Imports/edits still validate supplied evidence strictly, and
review notes are derived again from retained assumptions on import. Structural
errors still require a coherent draft before dependent phases can run. Earlier
completed artifacts remain available if no valid draft can be produced.

## Browser workbench

`GET /` serves the bundled web UI; its modules, CSS, fonts and marks live under
`/ui/`. Only explicitly registered assets are public. Static responses have CSP,
`nosniff` and frame restrictions and pass the same Host/Origin/fetch-metadata checks
as API requests. The engine remains loopback-only and single-user.

`aitm web` starts the engine/API and opens the Projects screen without importing
anything. An explicit `[source]` opens or reuses that source at the project's
Overview. `--project ID` opens an existing project without ingestion.
`--no-open` prints the link without starting a browser. `aitm serve` and the normal
TUI also serve the workbench. All clients use the same engine instance.

Additional resources used by the workbench:

| Method and path                           | Behavior                                                                                                                                                                                                                                                                                 |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /v1/health`                          | Also returns `cwd` and the private credential `keyFile` path (never its contents)                                                                                                                                                                                                        |
| `POST /v1/projects/open`                  | Body `{ "source": "/path/or/https-url" }` or `{ "source": <SourceInput> }`; source is required. Returns `{ project, reused }`. Local/Git/URL sources reopen the most recent project containing that source; uploads create a new assessment. Failed ingestion removes its empty project. |
| `PUT /v1/projects/:id/source`             | Body `{ "source": "/path/or/https-url" }`; replaces the primary source using CLI normalization. Multiple-source imports must remove extra snapshots before using this shortcut.                                                                                                          |
| `PUT /v1/providers/:provider/credentials` | Body with `apiKey` and/or Anthropic `workspaceId`; saves through the owning provider's credential writer before changing active credentials, and returns provider status only. Empty keys are rejected; omit a key to keep it. Empty workspace ID explicitly clears it.                  |
| `GET /v1/events`                          | Global SSE stream of `{ projectId }`; `null` signals connection/provider changes. Refetch current state on connection/reconnection. Disconnect releases the listener. Use the existing per-run event stream for detailed progress/replay.                                                |

Do not place credentials in a URL, project document or browser storage. The normal
CLI wires the credential writer to private mode-600 `keys.json`; programmatic
hosts without a writer keep replacements only in their provider session.
Configuration status indicates which source is active. Key changes do not mutate
assessment artifacts. Global change events contain only project IDs.

Closing a tab does not cancel a job. The UI reattaches to a running job after reload
and refetches saved state at artifact boundaries and terminal events. Source and
model text are escaped before rendering; report HTML/images and external links
remain inert text. Markdown/PDF export uses the existing report endpoint only
when explicitly selected, with browser download destinations.
