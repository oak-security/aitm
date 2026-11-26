# Changelog

## Unreleased

### Changed

- **Breaking for API clients:** the scope and source inventory step is no longer
  a review gate. A review run now goes through ingestion and stops first at the
  TRACE model. An approval request for `scope` or `ingest` returns HTTP 409 with
  code `no_review_gate`. A report no longer needs a scope approval to show as
  reviewed.

### Fixed

- The final message of a run now says what the run did. A single-step run (for
  example ingestion) showed "Pipeline complete. Your report is ready." in the
  browser. It now names the step, and a pause names the step to review.

- A new project now uses a provider that has a key. Before this change, each new
  project used OpenAI, and a run failed with `missing_key` when only an Anthropic
  key was configured.
- The `missing_key` message now names the provider that has a key and the
  setting to change. It no longer refers to a terminal shortcut in the browser.
- The browser Settings page no longer shows a model form that cannot be saved
  when no assessment is open. With an assessment open, it shows a warning while
  the selected provider is not saved.

## 2.1.0 (not released)

### Security

- **Breaking for API clients:** each API request now needs a private access
  token. Before this change, any process or user on the host could call the
  loopback API, import local paths, export their content, replace provider keys
  and start paid runs. Send `Authorization: Bearer "$(aitm token)"`. `ApiClient`
  reads the token file by default. Browsers sign in through the URL that AiTM
  prints.
- `GET /v1/health` no longer returns the PID or file paths. The new
  authenticated `GET /v1/instance` returns them.

### Added

- `aitm doctor [--live]` checks Node.js, Git, keys, storage and the port.
- `aitm token [--rotate]` prints or replaces the access token.
- `--allowed-host HOST:PORT` accepts an SSH forward to a different local port.
- Settings is available in the terminal project chooser (`s`). Before, it was
  available only inside a project.
- With no provider key, the terminal interface and the browser workbench start
  on Settings.
- `aitm serve` and `aitm web` print the source of each provider key.
- Requests to current Claude models opt in to Anthropic's server-side refusal
  fallback, so a classifier decline does not stop a run. The run metadata
  records the model that produced each result.
- `AITM_BROWSER_CHANNEL=chrome` runs the browser tests in an installed Chrome.

### Changed

- Minimum Node.js is 22.12 (was 26.13). The npm version requirement is removed.
- Default models: OpenAI `gpt-6.2-sol` (fast) and `gpt-6.2-astra` (deep);
  Anthropic `claude-sonnet-5-5` (fast) and `claude-opus-5-5` (deep). Saved
  projects keep the models they have.
- Without an account model list, AiTM offers a catalog of four current models
  for each provider. The OpenAI filter no longer lists the retired `o3` and
  `o4` families.
- The CLI and API read the version from `package.json`.
- The README is short. The details moved to `docs/usage.md` and
  `docs/inputs-and-limits.md`.

### Removed

- `scripts/configure-keys.py`. Use `aitm configure`.
- `AGENT.md`, `docs/verification.md` and `docs/implementation-plan.md`.
  `CONTRIBUTING.md` replaces them.

### Fixed

- The browser test suite no longer hangs when the browser is not installed.

## 2.0.0 (2026-10-30)

AiTM v2 replaced the desktop application with a local Node.js TRACE engine that
has a terminal interface, a browser workbench and an HTTP/SSE API in one process.
