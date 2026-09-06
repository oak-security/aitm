# AiTM engine API

Start `aitm serve` and connect to `http://127.0.0.1:8790`. The API is local and
single-user; no authentication or network binding beyond loopback is supported.
Independent clients should use this API instead of reading project files.

`GET /v1/openapi.json` is the generated contract. `GET /v1/meta` gives the TRACE
phase registry and artifact JSON schemas. Provider keys are configured on the server;
`GET /v1/providers` exposes only configuration booleans and default model IDs.

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
  -d '{"mode":"draft"}'
```

Starting a run returns HTTP 202 with a job ID. `mode: "review"` is the default;
it pauses at human review gates. `draft` bypasses gates without approving artifacts.
`resume: true` is the default; `resume: false` clears generated artifacts before
starting again. `phase: "stride"` (or another generated phase ID) regenerates only
that phase after checking prerequisites and clearing dependent artifacts.

```sh
curl -N http://127.0.0.1:8790/v1/projects/PROJECT_ID/runs/RUN_ID/events
curl -s http://127.0.0.1:8790/v1/projects/PROJECT_ID/runs/RUN_ID
```

SSE events have increasing integer IDs. Reconnect with `Last-Event-ID: 12` or
`?after=12` to replay later events. Event types include `running`, `progress`,
`artifact`, `validation_retry`, `skipped`, `awaiting_review`, `completed`, `failed`,
`cancelled`, and `interrupted`. Terminal events close the stream. The server keeps
working if a progress subscriber disconnects. Progress exposes character/token counts,
not raw provider text. Completed phase output is available in project state.

## Resources

| Method and path                                  | Behavior                                                  |
| ------------------------------------------------ | --------------------------------------------------------- |
| `GET /v1/health`                                 | Server identity, version, PID and storage directory       |
| `GET /v1/meta`                                   | Phase registry and artifact schemas                       |
| `GET /v1/providers`                              | Provider configuration status and model defaults          |
| `POST /v1/providers/:provider/test`              | Real connection test; body `{ "model": "..." }`           |
| `GET /v1/projects`                               | Project summaries                                         |
| `POST /v1/projects`                              | Create from name, scope and optional config               |
| `GET /v1/projects/:id`                           | Complete project state                                    |
| `PATCH /v1/projects/:id`                         | Edit name, scope or complete config; `revision` required  |
| `DELETE /v1/projects/:id`                        | Delete an idle project                                    |
| `GET /v1/projects/:id/phases`                    | Enabled phases, including classification-derived defaults |
| `POST /v1/projects/:id/sources`                  | Ingest a new source                                       |
| `PUT /v1/projects/:id/sources/:sourceId`         | Replace a source using the same input formats             |
| `POST /v1/projects/:id/sources/:sourceId/sync`   | Re-read a local source / refresh Git; body `{}`           |
| `DELETE /v1/projects/:id/sources/:sourceId`      | Remove source and invalidate analysis                     |
| `PUT /v1/projects/:id/artifacts/:phase`          | Validated edit: `{ "revision": 12, "data": {...} }`       |
| `POST /v1/projects/:id/artifacts/:phase/approve` | `{ "revision": 12, "reviewer": "Name", "notes": "..." }`  |
| `POST /v1/projects/:id/runs`                     | Start/resume a job                                        |
| `GET /v1/projects/:id/runs/:runId`               | Status, usage, errors and event history                   |
| `GET /v1/projects/:id/runs/:runId/events`        | SSE progress and replay                                   |
| `POST /v1/projects/:id/runs/:runId/cancel`       | Cancel provider I/O; body `{}`                            |
| `GET /v1/projects/:id/report?format=markdown`    | Full Markdown report                                      |
| `GET /v1/projects/:id/report?format=pdf`         | PDF report                                                |
| `GET /v1/projects/:id/export`                    | Portable JSON envelope                                    |
| `POST /v1/projects/import`                       | Validate/import that envelope as a new unreviewed project |

## Source formats

```json
{ "kind": "local", "path": "/absolute/path/to/repo-or-document", "label": "Optional label" }
```

```json
{ "kind": "git", "url": "https://github.com/organisation/repository" }
```

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
Text/file sources are refreshed by PUT; local/Git sources also support explicit sync.
Inputs are snapshotted atomically; a failed ingest leaves project evidence unchanged.

## Configuration and reviews

Project config has `provider`, `fastModel`, `deepModel`, `effort` (`low|medium|high`),
`trees` (boolean), `coordination` (`auto|on|off`) and `treeLimit` (1–10). Fetch a
project, modify its config, and PATCH it with the fetched revision. When switching
provider, select that provider's default models from `/v1/providers` or your own
model IDs. Changing config invalidates generated analysis.

Review phases use `scope`, `model`, `stride`, `trees`, `coordination`, `report`.
The `ingest` artifact is not a separate approval gate. Scope approval requires
nonempty scope and evidence. Upstream gates must be approved before a downstream
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
Persistent failure leaves the prior completed artifacts available for inspection.
