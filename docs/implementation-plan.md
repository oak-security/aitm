# AiTM v2 implementation and acceptance

The user requested a fresh implementation: a server process owns the TRACE engine,
with an API consumed by independent user interfaces. Iteration one ships the TUI,
launched by `aitm` (also `AITM`), with an ASCII logo. The former application remains
in Git history; `original-spec.md` preserves its product requirements.

## Architecture

- One ESM Node package; no Electron or browser workbench.
- `engine/`: project store, ingestion, structured provider adapters, phase registry,
  evidence validation, review decisions, job lifecycle and report assembly.
- `api/`: versioned HTTP resources, OpenAPI contract, durable progress over SSE.
- `client.js` and `tui/`: HTTP-only client; no project store or provider imports.
- `cli.js`: start/attach local server, terminal UI, configuration and exports.
- Private atomic local persistence; engine lock prevents two writers. Restart marks
  interrupted jobs honestly. Disconnecting a UI does not cancel server work.

## Acceptance checklist

- [x] Local repo/folder, standalone text/code, PDF, DOCX, HTTPS Git repository,
      inline notes and synced file snapshots; hashes, provenance and bounded ingestion.
- [x] Changing source snapshots/scope/model invalidates dependent artifacts.
- [x] Source inventory -> ingestion/classification -> TRACE -> STRIDE -> optional
      attack trees -> applicable coordination -> roadmap/report.
- [x] Evidence references, explicit assumptions, cross-object references, ranking,
      tree structure and roadmap links validated, not just JSON shape.
- [x] Review mode enforces source/model/threat/tree/coordination/report gates;
      draft mode bypasses gates without claiming human approval.
- [x] OpenAI Responses and Anthropic Messages stream structured results; configurable
      fast/deep model slots, cancellation, errors and incomplete-output detection.
- [x] Durable projects/runs/events, editing, approvals, import/export, Markdown/PDF.
- [x] Versioned API validates inputs, rejects hostile browser origins/hosts, exposes
      jobs, cancellation and replayable SSE; secrets never enter responses or exports.
- [x] `aitm` / `AITM`: server startup/attachment, logo, project selection/creation,
      scope/source forms, provider settings, progress, review/edit, cancel, sync/export.
- [x] Automated engine/API/provider/ingestion/TUI tests and real PTY exercise.
- [x] Live OpenAI and Anthropic pipelines with user keys on the existing Uniswap v4
      whitepaper; Dividend was not found in the available local material.
- [x] Updated specification, operating instructions, API docs, CI and package checks.

TRACE reference: https://github.com/oak-security/TRACE/blob/main/METHODOLOGY.md
Original author: Dr. Stefan Beyer, Oak Security; methodology licensed CC BY 4.0.

Provider implementation references verified 2026-09-06:
https://developers.openai.com/api/docs/guides/structured-outputs
https://developers.openai.com/api/docs/models/gpt-5.6-terra
https://developers.openai.com/api/docs/models/gpt-5.6-sol
https://platform.claude.com/docs/en/build-with-claude/structured-outputs
https://platform.claude.com/docs/en/models/overview

## Verification status (2026-09-06)

Acceptance is implemented and verified; see verification.md. Both real provider
pipelines completed, producing validated draft artifacts and Markdown/PDF/JSON
exports. All 58 pages of their final PDFs were visually inspected. The installed
TUI includes both completed examples. Provider credentials remain private and
outside version control.
