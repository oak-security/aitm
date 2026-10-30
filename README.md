# AiTM — AI Threat Modeller

```text
    _    ___ _____ __  __
   / \  |_ _|_   _|  \/  |    o-----o
  / _ \  | |  | | | |\/| |    |\   /|
 / ___ \ | |  | | | |  | |    | o-o |
/_/   \_\___| |_| |_|  |_|    o-----o
```

A reusable engine for the [TRACE methodology](https://github.com/oak-security/TRACE/blob/main/METHODOLOGY.md), with terminal and web interfaces and a local API. By Oak Security.

AiTM runs in **one process**. The TUI calls the engine directly; the API exposes the
same engine to the browser workbench and integrations. The engine owns ingestion, saved assessments, AI calls,
the sequential pipeline, reviews and reports.

## Install and launch

Node.js 26.13.0+ (LTS), npm 12.2.1+ and Git are required. With nvm installed,
select the pinned runtime and install dependencies from this checkout:

```sh
nvm install
nvm use
npm install --global npm@12.2.1
npm ci
npm_config_prefix="$HOME/.local" npm link
aitm
```

Make sure `~/.local/bin` is on `PATH`. The command is lowercase: `aitm`.
`npm start` runs from the checkout.

Start with the project chooser, or provide an explicit shortcut:

```sh
aitm                                      # create or open a project
aitm --project PROJECT_ID                 # reopen a saved project
aitm ./my-repo                             # directory
aitm "./design notes.pdf"                  # one file
aitm https://github.com/organisation/repo   # public repository
aitm https://example.org/whitepaper.pdf     # direct document URL
aitm ./my-repo --full                      # immediately run the full pipeline
```

Starting without a source imports nothing. Create a named project, then add any
combination of public URLs, documents and repository ZIPs through **Add sources**.
Projects keep separate sources, settings, reviews and reports. **Open project**
lists saved assessments; switching projects leaves running jobs active.

The optional explicit path/URL shortcut names a new assessment from that source
or reopens the most recent saved project containing it. It uses the saved snapshot,
including reviews and completed steps. Press `u` to refresh local/URL sources, or
manage each source individually. Unchanged content preserves analysis; changes
invalidate dependent results. An import batch either succeeds in full or leaves
the project unchanged.

The local API is available at `http://127.0.0.1:8790` while AiTM is open. **`q` saves
and closes the TUI, engine and API.** An unfinished phase is cancelled; completed
steps remain saved for the next launch. Ctrl+C and SIGTERM also close gracefully.
There is no background daemon or separate attach/stop workflow.

```sh
aitm serve                                # engine + API without a TUI
aitm --port 8791 --data-dir /path/to/private-data
```

`aitm serve` runs in the foreground and can be supervised by a process manager.
The API is single-user and binds only to loopback. Only one process may own a data
directory. Existing v2 assessments remain compatible; API clients can still list,
import and manage saved assessments independently.

## Web workflow

```sh
aitm web                         # open the project chooser in your browser
aitm web ./my-repo                # open or reopen this source
aitm web ./whitepaper.pdf --full  # start the pipeline immediately
aitm web --no-open                # print the URL without opening a browser
```

The web workbench runs on the same loopback API, normally
`http://127.0.0.1:8790/`. It is also available while `aitm` or `aitm serve` is running.
There is no separate web service, frontend build or duplicate engine. Closing a
browser tab leaves jobs running; Ctrl+C in the owning terminal closes the engine.

The workbench follows the original application's black sidebar and light workspace,
BDO Grotesk typography, and gold/magenta accents:

1. **New project** creates a named assessment with an optional scope; **Open project**
   or the sidebar project list reopens saved work. In **Sources & Scope**, **Add sources**
   opens a file dialog for multiple documents or ZIP repositories, or accepts public
   URLs/local paths, one per line. Nothing is imported from an empty field. Add more
   sources at any time; **Replace source**, **Remove**, and **Refresh snapshot** act
   on the selected source. Browser uploads support 8 MiB per file and 11 MiB combined;
   use separate batches or an explicit local folder path for larger collections.
2. **Run full pipeline** stays in the top toolbar on every project view and autoruns
   all TRACE steps with top-three attack trees. The import dialog also offers
   **Run full pipeline after import**. **Overview** offers a separate run with
   explicit review gates. The persistent status bar shows the current step, waiting
   or receiving activity, elapsed time and output counts. **Run history** provides
   durable events. Batch counts remain visible while classifying/analysing source
   files, including while receiving output. Cancel, reload and resume preserve completed artifacts.
3. Navigate **Sources & Scope → TRACE Model → STRIDE → Attack Trees → Coordination
   → Report**. Browse complete source files with line numbers, inspect evidence
   links, filter ranked threats, and expand AND/OR attack paths. Common object and
   threat fields have form editors; **Edit draft** exposes the complete validated
   artifact as JSON. Changed upstream artifacts invalidate dependent analysis.
4. **Approve review** records approval with optional notes; no name is required. The engine enforces the same
   sequential gates as the terminal/API. Full runs leave outputs as drafts.
5. **Report** renders the complete Markdown with section links and a raw Markdown
   view. Downloads of Markdown, PDF and project JSON are explicit; PDF is never
   exported automatically. Reports identify AiTM as their generator and state that
   Oak Security did not author, review or endorse them. Downloads go to your
   browser's chosen download location. **Import project JSON** opens v2 project exports.
6. **Settings & models** provides masked OpenAI/Anthropic key replacement,
   provider/model dropdowns, connection tests, reasoning effort and optional phases.
   Credentials use the same private settings store as the TUI. A key replacement
   alone preserves analysis. Saving changed model/phase settings clears dependent
   results. Unsaved forms survive live updates; concurrent edits return a conflict.

Navigation stays outside the scrolling report. On small screens, the menu button
opens the sidebar. The UI uses same-origin HTTP/SSE and bundled assets only; source
and model text cannot execute HTML or load remote images in the report viewer.

## Provide API keys

In the TUI press **`s` — Settings → API keys**, then select **OpenAI** or
**Anthropic** with Up/Down and Enter. Paste a new key into the masked field to add
or replace it. Enter with an empty key keeps the existing value; Escape cancels.
Keys are saved privately to `~/.config/aitm/keys.json` (mode 0600) and become active
immediately. Updating a key does not clear assessment results or change the other
provider's key. The picker shows whether each provider is configured and where its
active key came from; it never displays the key itself.

Outside the TUI, `aitm configure` provides hidden prompts for both providers.
Leave either blank to keep its current key. Reopen an already-running application
after CLI changes, or use its Settings menu to update without restarting.

For this source checkout, the original private environment-file helper also works:

```sh
python3 scripts/configure-keys.py
```

Both prompts hide input. The script writes `.env.local` with mode 0600; Git ignores
it. These credential files are plaintext protected by OS
permissions, not encrypted vaults. Don't paste keys into chat, project notes or code.

AiTM loads keys in this order: saved `keys.json` settings, `OPENAI_API_KEY` /
`ANTHROPIC_API_KEY` environment variables, and `.env.local` in its working directory
(falling back to the installed package root). A saved replacement takes precedence
so an old environment value cannot silently override it. Restart after editing
environment files manually. Only configuration
status is returned to clients; key values do not appear in projects, reports or logs.

For an Anthropic key that spans workspaces, enter its optional `wrkspc_...` workspace
ID on the next Settings screen, or set `ANTHROPIC_WORKSPACE_ID` in the environment.
Workspace-bound keys do not need this setting. Clearing the saved workspace field
also overrides any environment workspace setting.

Both providers ship. Fast/deep defaults are `gpt-5.6-terra` / `gpt-5.6-sol` and
`claude-sonnet-5` / `claude-opus-5`. STRIDE and coordination use the deep slot;
other phases use the fast slot. Press **`p`** (or Settings → Provider & models) to
pick a provider, fast model and deep model from lists. Up/Down selects, Page Up/Down
scrolls longer lists, and Enter advances. Choices are saved together at the final
step; Escape cancels without changing the assessment. Lists load account models
through the provider's Models API; a failed lookup or missing key leaves defaults
available with an explanatory notice. Current saved model IDs remain selectable.
Changing models clears dependent analysis; selecting the same settings preserves it.
Press `e` on Scope for reasoning effort, optional phases and tree count. `V` tests the selected
provider with a small real request. Availability depends on your provider account.

## Terminal workflow

1. Launch `aitm` to create/open a project. Press **`n`** for New project, **`o`** for
   Projects, **`i`** to Add sources, or **`b`** to Manage sources. The import dialog
   accepts a public URL, an explicit file/folder path, or browsed files. In the file
   browser, Enter opens a folder/imports a file; Space marks multiple files, then
   select **Import N selected files**. Escape cancels. The Projects menu also supports
   rename, close, delete and importing a saved JSON project. `aitm <path-or-URL>`
   and `aitm --project ID` remain direct shortcuts.
2. Press **`f` — Run full pipeline** to generate TRACE, ranked STRIDE threats,
   attack trees for the **top three threats**, applicable coordination analysis,
   and the final report. Results remain drafts and the run does not pause for review.
   Fewer than three threats produce one tree per threat.
3. Use Up/Down to inspect each phase. For a run that pauses at human review gates,
   press `r`; `a` approves with optional notes, then `r` continues. `e` opens
   the selected artifact in `$VISUAL`, `$EDITOR`, or `vi`. On Scope it edits scope
   and settings.
4. Completed assessments open on the menu. Press **`v` — View Markdown** to open
   the complete report; Escape returns to the menu. Use `j`/`k` to scroll,
   Page Up/Down (or Space) to turn pages, `[`/`]` to jump sections, and Home/End to
   reach the beginning/end. Up/Down still selects TRACE phases. The reader includes
   the entire report, including sources, TRACE objects, threats, trees and reviews;
   tables wrap as labelled records.
   Viewing Markdown makes no AI calls and creates no export files.
5. Press `x` to explicitly export Markdown, PDF or portable JSON. PDF is never
   generated automatically. Choose the destination in the export form; the default
   is `aitm-<project-id>-<timestamp>.<extension>` in the directory where you launched AiTM.
   Exports refuse to overwrite
   an existing file. Press `q` to save and quit; reopen the project to continue.

The five-line ASCII logo stays visible on new, running and completed assessments,
including 80×24 terminals. Shorter terminals use a compact identity. Report controls
stay above the scrolling content, including when reopening a saved report.

The progress panel stays above the assessment: active phase, completed-phase bar,
elapsed run/phase time, provider/model, and live output counts. It distinguishes
waiting for a provider, receiving output, validating, and retrying. The bar counts
ready phases; it is not a time estimate. `l` opens durable event history; `c` cancels
the job and preserves completed artifacts. Source loading also shows an activity
indicator, including when files are supplied on the command line.
The artifact pane follows each new TRACE stage automatically. You can still inspect
earlier stages with Up/Down. If a step pauses, `f` continues from the saved progress;
`l` shows its technical details.

Full pipeline resumes saved analysis. It enables attack trees with a limit of three
and enables automatic coordination when it was off. If existing trees do not meet
the top-three requirement, it rebuilds trees and downstream results while retaining
the TRACE model and STRIDE analysis. All outputs remain **DRAFT** until reviewed.

| Key                       | Action                                                 |
| ------------------------- | ------------------------------------------------------ |
| Up / Down                 | Select TRACE phase                                     |
| `o` / `n`                 | Projects menu / new project                            |
| `i` / `b`                 | Add sources / manage individual sources                |
| `j` / `k`, Page Down / Up | Scroll artifact                                        |
| `f`                       | Run/resume full pipeline with top-three attack trees   |
| `r`                       | Run/resume with human review gates                     |
| `a` / `e`                 | Approve / edit selected artifact; Scope edits settings |
| `u`                       | Refresh the source snapshot                            |
| `s`                       | Settings, including adding/replacing API keys          |
| `p` / `V`                 | Provider/model lists / verify connection               |
| `v`                       | View the full Markdown report in the TUI               |
| `[` / `]`, Home / End     | Report section navigation / first and last page        |
| `x`                       | Export Markdown, PDF or JSON                           |
| `c`                       | Cancel run; keep completed phases                      |
| `l` / `?`                 | Run log / help                                         |
| Esc                       | Close form or return to artifact                       |
| `q`                       | Save and quit the whole application                    |

Advanced controls in `?`: `g` regenerates the selected phase; `F` restarts the full
pipeline after typing `RESTART`, clearing generated analysis and reviews.

## Reuse the engine

The package exposes the engine independently of either interface:

```js
import { Engine, Providers, startServer } from '@oak-security/aitm';

const engine = await Engine.open({
  dataDir: '/private/path/aitm',
  providers: new Providers({ keys: { openai: process.env.OPENAI_API_KEY } }),
});
const project = engine.create({ name: 'My system', scope: 'Assess release authority.' });
await engine.addSource(project.id, { kind: 'local', path: '/path/to/source' });
engine.events.on('change', (id) => {
  /* Read the updated project with engine.get(id). */
});
engine.run(project.id, { mode: 'full' });

// Optional HTTP interface to the same engine:
const api = await startServer(engine, { port: 8790 });
// On shutdown: await engine.close(); await api.close();
```

External HTTP consumers can import `ApiClient` from `@oak-security/aitm/client`.
The engine has no dependency on a running API or TUI. See [docs/api.md](docs/api.md).

## Inputs and limits

- Local folders/repositories and individual UTF-8 code, config, text, Markdown,
  HTML, CSV, JSON, YAML, and other readable text files.
- PDF and DOCX documents; scanned/image-only documents need OCR or a transcription.
- Public HTTPS repositories on GitHub, GitLab and Bitbucket. A shallow clone is
  pinned to a commit, snapshotted and deleted; no hooks or submodules are run.
  Use a local checkout for private repositories or other Git hosts.
- Public HTTPS code/text, HTML pages, PDF, DOCX and ZIP URLs (8 MiB, 30 seconds,
  three redirects). A page is preserved as HTML source; AiTM does not execute page
  scripts, crawl links or fetch embedded documents. Use a direct PDF/DOCX link to
  assess the document itself.
- Repository ZIPs from local files, browser uploads or public URLs. Archives have
  an 8 MiB compressed limit, 32 MiB expanded limit and at most 10,000 entries.
  Extraction rejects unsafe/ambiguous paths, encrypted entries and special files;
  skips symlinks, credentials and dependencies; and honors nested `.gitignore`.
  Temporary extraction files are removed. Nested archives are skipped.
- Inline text and file snapshots pushed over the API. A file snapshot may contain
  UTF-8 text or base64 PDF/DOCX/ZIP data; replacing it invalidates dependent analysis.

Folder ingestion honors nested `.gitignore` rules and skips dependencies, generated
folders, credential filenames, symlinks and unsupported binaries. Caps are 8 MiB per
file, 32 MiB / 1,000 files per source and 100 sources / 2,000 files per project.
Extracted text is bounded to 8 million characters (8 × 1024²) per file and
32 million (32 × 1024²) per source/project. Accepted files are stored in full;
oversized inputs produce an explicit error or a recorded folder-skip diagnostic,
never a truncated document. Scope shows import diagnostics, including unreadable
or skipped files. Inline API text is limited to 500,000 characters per request.

Classification quickly identifies a provisional profile from the inventory and scope.
TRACE model construction then reads **all accepted source text**, in sequential
batches of up to 180,000 numbered source characters. Later batches return new or
changed objects; the engine retains earlier findings and validates the merged model.
The model is saved only after every batch finishes. STRIDE, attack trees,
coordination and the report reason from the completed artifacts, without rereading
the repository at every step. Seven source batches therefore require 12 normal
provider calls for a full run with coordination, rather than 36.

Cross-phase references are constrained to existing model IDs. Citation mismatches
and unresolved optional links become explicit review notes without regenerating
whole responses. Broken required relationships still get one bounded repair.
Progress shows the current source batch during model construction. Complete source
delivery does not guarantee that an AI identifies every issue.

Older saved snapshots marked as truncated are refreshed from their original local
file or URL before a new run, and affected analysis is rebuilt. Old analysis made
from prompt excerpts is also rebuilt. Portable snapshots need their complete
originals supplied again if they were truncated. Until rebuilt, affected reports
show a brief incomplete-source notice. Routine import diagnostics are not repeated
in a generic report section; actual unresolved questions and unverified claims remain.

Snapshots have file IDs, hashes and line references. Model claims need matching
source quotes or explicit assumptions. The engine validates object references,
STRIDE coverage of assets/invariants/edges, tree connectivity and roadmap links.
If a generated quote occurs exactly once in its cited file, the engine can correct
mistaken line numbers and records the correction in generation metadata. It never
fuzzy-matches invented quotes; ambiguous references are not accepted as verified
evidence. A citation problem gets one automatic correction attempt. If it remains
unresolved, the claim is explicitly marked **Evidence review required** and the
sequential pipeline continues. Valid citations stay attached; rejected quotes are
retained only in diagnostic metadata. Review notes appear in the TUI and reports
and carry into downstream analysis as uncertainty. Citation retries cannot discard
an otherwise usable draft.
Coverage links are computed from the threats' object references. Missing coverage
is explicitly flagged for review, and corrections are retained in generation metadata.
These checks establish traceability; they cannot establish whether an AI judgement
is correct. Source text is treated as evidence, never instructions.

## API and storage

The [API guide](docs/api.md) includes examples. The running server exposes
`GET /v1/openapi.json` with request schemas and artifact schemas; progress is SSE
with replay through `Last-Event-ID` or `?after=`. Jobs are independent of client
connections. Restarting after a crash marks unfinished runs `interrupted`; resume
retries the unfinished phase using saved artifacts.

State defaults to `~/.local/share/aitm-v2` (`AITM_DATA_DIR` / `--data-dir` override).
Each project is an atomic JSON document with source snapshots, artifacts, jobs,
usage and review history. A process lock prevents multiple writers. The directory
uses mode 0700, project files 0600. v2 does not read or modify the old desktop store.
JSON imports create a new project ID, use portable snapshots and require fresh reviews.
The report's artifacts live inside `<project-id>.json`; Markdown is assembled from
them when viewed. There is no automatic `.md` or `.pdf` export. Press `?` in the TUI
to see the actual storage directory, or `x` to save a separate report to a chosen
path. PDFs cached by earlier versions under `reports/` remain untouched.

Reports carry no hard-coded personal author name and state prominently:
**Generated by AiTM using AI. This report was not authored, reviewed or endorsed
by Oak Security.** Explicit human review entries are still recorded when supplied.

```sh
curl -fsS 'http://127.0.0.1:8790/v1/projects/PROJECT_ID/report?format=markdown' -o report.md
curl -fsS 'http://127.0.0.1:8790/v1/projects/PROJECT_ID/report?format=pdf' -o report.pdf
curl -fsS http://127.0.0.1:8790/v1/projects/PROJECT_ID/export -o project.json
```

## Development and verification

```sh
npm run check
npm test
npx playwright install chromium
npm run test:web
npm run pack:check
npm run test:live
```

Automated tests cover engine sequencing and review gates, HTTP/SSE lifecycle,
provider wire formats and failure modes, ingestion guards, evidence validation,
persistence, exports, direct TUI actions, and shared state with real HTTP clients.
They use deterministic providers and do not spend API credit. Browser tests launch
Chromium against the real local API and cover the complete workflow, responsive
layout, safe rendering, credentials, exports and recovery. Screenshots are saved
under ignored `artifacts/qa/web/`.

`test:live` requires real keys, verifies both providers, then runs the full pipeline
for each and exports evidence to ignored `artifacts/live-*`. It fails rather than
substituting fixtures if a provider is unavailable. By default it uses the explicitly
synthetic [custody example](examples/custody-architecture.md). Override the source:

```sh
AITM_LIVE_SOURCE=/absolute/path/to/whitepaper.pdf npm run test:live
AITM_LIVE_PROVIDER=openai AITM_LIVE_SOURCE=https://github.com/org/repo npm run test:live
```

To resume a failed live check without repeating completed phases, set
`AITM_LIVE_DIR=artifacts/live-<timestamp>` along with `AITM_LIVE_PROVIDER` and rerun.
The saved source snapshots remain the evidence for that assessment.

See [SPEC.md](SPEC.md) for the engine contract and [original-spec.md](docs/original-spec.md)
for historical context. The former implementation is preserved in Git history;
the current web workbench uses the v2 engine and API.
