# @oak-security/aitm-engine

The UI-independent AiTM engine. It owns projects, settings, ingestion, provider calls,
TRACE phase sequencing, and report generation behind `createEngine(...)`.

Callers provide two platform adapters: a data directory and key store. Event delivery is
an optional callback. This package never loads Electron and has no UI dependencies.
