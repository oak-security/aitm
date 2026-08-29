# aitm-tui

Terminal frontend for AiTM (AI Threat Modeller). Runs the same TRACE pipeline as the
desktop app — same core code, prompts, schemas, and project store — from a keyboard-driven
TUI. Projects created here appear in the desktop app and vice versa.

## Install / run

```sh
cd tui && npm install         # once; root `npm install` must also have been run
cd .. && npm link             # optional: install the unified `aitm` command
npm run tui -- [source ...]   # or: aitm tui [source ...]
```

Sources (any mix; no arguments = current directory, recursively):

```sh
aitm tui                                   # cwd
aitm tui ./docs/architecture.md spec.pdf   # explicit files
aitm tui /path/to/project                  # a directory
aitm tui https://github.com/owner/repo     # shallow clone, ingested, clone removed
```

## Flow

1. **Setup** (first run or `--configure`): pick provider (OpenAI/Anthropic), enter the
   API key, confirm fast/deep model ids. Keys come from `OPENAI_API_KEY` /
   `ANTHROPIC_API_KEY` when set; otherwise they are stored in
   `~/.config/aitm-tui/keys.json` (mode 600). The desktop app's OS-keychain vault is not
   shared — it is Electron-only.
2. **Scope hint**: a free-text description that reduces the files in scope, e.g.
   "only the docs directory" or "contracts and the whitepaper". The fast model maps the
   hint to sub-paths, each ingested as its own source. Empty = everything.
3. **Ingest**: directory digests (skips `.git`, `node_modules`, binaries; honors
   `.gitignore`; size caps), document text extraction for `.md/.txt/.docx/.pdf`.
4. **Run**: full pipeline (classify → TRACE model → STRIDE → attack trees for the top-3
   threats → coordination if relevant → report) or phase by phase with a review gate and
   regenerate option after each phase. Attack-tree threats are picked interactively in
   phase-by-phase mode.
5. **Report**: scrollable viewer; `m` exports Markdown, `p` exports the Oak-branded PDF
   to the current directory.

Everything is persisted to the shared AiTM project store after each step, so quitting
mid-run loses nothing; open the project in the desktop app to edit tables and re-run
phases there.

Data locations: projects/settings in the AiTM user-data dir (`~/.config/AiTM` on Linux,
`~/Library/Application Support/AiTM` on macOS, `%APPDATA%\AiTM` on Windows; override
with `AITM_DATA_DIR`). TUI keys in `~/.config/aitm-tui/` (override with
`AITM_TUI_CONFIG_DIR`).
