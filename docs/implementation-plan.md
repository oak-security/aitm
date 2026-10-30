# AiTM v2 implementation and acceptance

Implementation status for v2, updated 2026-10-30. One process owns the reusable
TRACE engine, direct TUI and local HTTP API serving the browser workbench. Launch
with lowercase `aitm`, `aitm web`, or `aitm serve`; see [the README](../README.md)
for setup and SSH access. The former application remains in Git history;
[original-spec.md](original-spec.md) preserves its historical product requirements.

## Architecture

- One ESM Node package; no Electron or separate web service.
- `engine/`: project store, ingestion, structured provider adapters, phase registry,
  evidence validation, review decisions, job lifecycle and report assembly.
- `api/`: versioned HTTP resources, OpenAPI contract, durable progress over SSE.
- `tui/`: direct engine methods and change events. `client.js`: external API consumers.
- `web/`: static browser workbench over the same API; no duplicate domain runtime.
- `cli.js`: one engine/API lifetime with a TUI or browser launcher. Default project
  chooser; optional explicit source or `--project ID`. No implicit folder intake.
- Private atomic local persistence; engine lock prevents two writers. Restart marks
  interrupted jobs honestly. Quit saves completed work and cancels an unfinished phase.

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
- [x] `aitm`: project chooser and explicit-source shortcuts, logo, provider settings, progress,
      review/edit, cancel, sync/export, and graceful shutdown.
- [x] Automated engine/API/provider/ingestion/TUI tests and real PTY exercise.
- [x] Live OpenAI and Anthropic pipelines with user keys on the existing Uniswap v4
      whitepaper; later recovery also completed on the user’s 58-file Divigent repository.
- [x] Updated specification, operating instructions, API docs, CI and package checks.

TRACE reference: https://github.com/oak-security/TRACE/blob/main/METHODOLOGY.md
Original author: Dr. Stefan Beyer, Oak Security; methodology licensed CC BY 4.0.

Provider implementation references verified 2026-09-06:
https://developers.openai.com/api/docs/guides/structured-outputs
https://developers.openai.com/api/docs/models/gpt-5.6-terra
https://developers.openai.com/api/docs/models/gpt-5.6-sol
https://platform.claude.com/docs/en/build-with-claude/structured-outputs
https://platform.claude.com/docs/en/models/overview

## Browser iteration

- [x] Bounded TUI viewport on completed-report reopen and page navigation.
- [x] Main-branch visual style with project sidebar and all TRACE phase views.
- [x] Source paths/URLs/uploads, saved assessment reuse, scope and artifact editors.
- [x] Full pipeline, explicit review gates, live SSE, cancellation/resume and history.
- [x] Evidence viewer, ranked threat filters, AND/OR trees and coordination details.
- [x] Complete Markdown report preview/source and explicit Markdown/PDF/JSON exports.
- [x] Private key replacement, provider/model lists and optional phase configuration.
- [x] Revision conflicts retain user input; auxiliary settings actions preserve edits.
- [x] API/CLI/browser regressions, desktop/mobile screenshots, real PTY screen emulation
      and read-only viewing of the saved Divigent whitepaper report.

## Projects and multi-source iteration

- [x] Both launch commands start at a project chooser without importing cwd.
- [x] New/open/rename/delete projects; JSON import and saved-project CLI shortcut.
- [x] TUI file browser with multi-file selection, URL/path dialogs and source actions.
- [x] Web multi-file uploads, multiline URL/path imports and per-source management.
- [x] Atomic import batches; failed imports retain existing sources and reports.
- [x] Bounded repository ZIP extraction for files/uploads/URLs; normal ignore rules.
- [x] Single-page public HTML intake with no script execution or link crawling.
- [x] Full pipeline combines all project sources; switching projects keeps jobs active.

## Runtime and PDF updates (2026-10-30)

- [x] Node/npm requirements and pinned dependencies updated; runtime selected by `.nvmrc`.
- [x] Orca/container deployment tooling removed; local Node runtime documented.
- [x] Structured PDF layout with risk charts, attack-tree diagrams, roadmap,
      linked evidence, bookmarks and pagination checks.
- [x] MIT license with Oak Security copyright; bundled font license preserved separately.

## Historical verification (2026-09-06)

At that checkpoint, both real provider pipelines completed, producing validated
draft artifacts and Markdown/PDF/JSON exports. All 58 pages of those PDFs were
visually inspected. Those examples were local verification data, not bundled
projects. See [verification.md](verification.md) for dated results and limitations;
historical page counts and machine state do not describe the current installation.
