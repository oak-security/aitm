# Usage guide

This guide covers the terminal interface, the browser workbench, keys, storage
and reports. For installation, see the [README](../README.md).

## One process, two interfaces

| Command      | Starts                                 | Checkout equivalent |
| ------------ | -------------------------------------- | ------------------- |
| `aitm`       | Terminal UI, engine and API            | `npm start`         |
| `aitm web`   | Engine and API, then opens the browser | `npm run web`       |
| `aitm serve` | Foreground engine and API              | `npm run server`    |

All three modes serve the browser workbench. Run one instance per data directory;
open its URL to add a browser client. Pass checkout-script arguments after
`--`, for example `npm run web -- --no-open`.

Start with the project chooser, or give one explicit source:

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

## Access token

Each API request needs the private access token. The browser gets it from the
URL that AiTM prints, and then keeps it in an `HttpOnly`, `SameSite=Strict`
cookie. Scripts send it as a bearer token:

```sh
curl -fsS -H "Authorization: Bearer $(aitm token)" http://127.0.0.1:8790/v1/projects
```

The token is saved in `~/.config/aitm/token` with mode 600 (`XDG_CONFIG_HOME`
changes the base directory). It stays the same across restarts.
`aitm token --rotate` replaces it; restart running instances and open the new URL
in each browser. A browser that has no valid cookie gets a page with instructions
and no data. Only `GET /v1/health` and the static files of the workbench answer
without the token.

## Check the setup

`aitm doctor` reports the Node.js version, Git, the source of each provider key,
the key and token files, the data directory and its lock, and the port. It makes
no provider request unless you add `--live`, which sends one small request to each
configured provider. The exit status is 1 when a check fails.

## Web workflow

```sh
aitm web                         # open the project chooser in your browser
aitm web ./my-repo                # open or reopen this source
aitm web ./whitepaper.pdf --full  # start the pipeline immediately
aitm web --no-open                # print the URL without opening a browser
```

```sh
aitm web                         # open the project chooser in your browser
aitm web ./my-repo                # open or reopen this source
aitm web ./whitepaper.pdf --full  # start the pipeline immediately
aitm web --no-open                # print the URL without opening a browser
```

The web workbench runs on the same loopback API, normally on port 8790. AiTM
prints a URL that contains the private access token; open that URL the first time.
The browser then keeps the token in a cookie. The workbench is also available
while `aitm` or `aitm serve` is running: press `?` in the terminal interface to
show its URL.
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
4. **Approve review** records approval with optional notes; no name is required. The first
   review gate is the TRACE model. Scope and source classification need no approval. The engine enforces the same
   sequential gates as the terminal/API. Full runs leave outputs as drafts.
5. **Report** renders the complete Markdown with section links and a raw Markdown
   view. Downloads of Markdown, PDF and project JSON are explicit; PDF is never
   exported automatically. Reports identify AiTM as their generator and state that
   Oak Security did not author, review or endorse them. Downloads go to your
   browser's chosen download location. **Import project JSON** opens v2 project exports.
6. **Settings & models** provides masked OpenAI/Anthropic key replacement,
   provider/model dropdowns, connection tests, reasoning effort and optional phases.
   Settings is also in the sidebar when no project is open, and it is the first
   screen when no key is saved. Credentials use the same private settings store as the TUI. A key replacement
   alone preserves analysis. Saving changed model/phase settings clears dependent
   results. Unsaved forms survive live updates; concurrent edits return a conflict.

Navigation stays outside the scrolling report. On small screens, the menu button
opens the sidebar. The UI uses same-origin HTTP/SSE and bundled assets only; source
and model text cannot execute HTML or load remote images in the report viewer.

### Headless Linux over SSH

On the server, run `aitm web --no-open`. On your own computer, open a separate
terminal and forward the port (replace `USER@SERVER` with your SSH login):

```sh
ssh -N -L 8790:127.0.0.1:8790 USER@SERVER
```

Keep both sessions open and open the printed URL in your local browser.
No browser or display server is needed on the Linux host. Local source paths refer
to files on that host; browser uploads come from your own computer. Ctrl+C in the
server's AiTM terminal saves and stops the instance. Closing only the tunnel or
browser leaves the server process running while its terminal session remains open.

AiTM rejects a `Host` header that is not its own loopback address and port. To
forward to a different local port, start AiTM with
`--allowed-host 127.0.0.1:LOCALPORT` (repeat the option for more names) and use
that port in the URL. Only loopback names are accepted. Other users of the server
cannot use your instance, because they do not have the access token.

## Provide API keys

AiTM opens without a provider key. You can create projects, import sources, and
read or export existing results. When no key is saved, the terminal interface and
the browser workbench start on Settings; Escape continues without a key.
Starting analysis requires a key for the project's selected provider;
a missing key produces a configuration message before creating a run. With
`--full`, that error ends the launch. Use `aitm configure` first, or configure
credentials through Settings and then start the run.
A new project uses the first provider that has a key (OpenAI, then Anthropic).
Models belong to the project: if a project uses a provider that has no key, select
the other provider with `p` in the terminal, or in **Settings & models** in the
browser followed by **Save assessment settings**.

In the TUI press **`s`** for Settings, in the project chooser or inside a project.
Inside a project, choose **API keys**. Then select **OpenAI** or
**Anthropic** with Up/Down and Enter. Paste a new key into the masked field to add
or replace it. Enter with an empty key keeps the existing value; Escape cancels.
Keys are saved privately to `~/.config/aitm/keys.json` (mode 0600) and become active
immediately. `XDG_CONFIG_HOME` overrides the default `~/.config` base directory.
Updating a key does not clear assessment results or change the other
provider's key. The picker shows whether each provider is configured and where its
active key came from; it never displays the key itself.

Outside the TUI, `aitm configure` provides hidden prompts for both providers.
Leave either blank to keep its current key. Reopen an already-running application
after CLI changes, or use its Settings menu to update without restarting.

A private environment file also works. Copy `.env.example` to `.env.local` in the
directory where you start AiTM, add the keys, and run `chmod 600 .env.local`.
AiTM refuses a credential file that other users can read. These files are
plaintext protected by OS permissions, not encrypted vaults. Do not paste keys
into chat, project notes or code.

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

### Models

Defaults are `gpt-6.2-sol` (fast) and `gpt-6.2-astra` (deep) for OpenAI, and
`claude-sonnet-5-5` (fast) and `claude-opus-5-5` (deep) for Anthropic. STRIDE and
coordination use the deep slot; the other phases use the fast slot, which reads
all source text. Press **`p`** (or Settings → Provider & models) to
pick a provider, fast model and deep model from lists. Up/Down selects, Page Up/Down
scrolls longer lists, and Enter advances. Choices are saved together at the final
step; Escape cancels without changing the assessment. Lists load account models
through the provider's Models API. Without a key, or after a failed lookup, AiTM
offers its built-in catalog with a notice. Current saved model IDs remain selectable.
Changing models clears dependent analysis; selecting the same settings preserves it.
Press `e` on Scope for reasoning effort, optional phases and tree count. `V` tests the selected
provider with a small real request. Availability depends on your provider account.

Current Claude models have safety classifiers that can decline security analysis.
For Claude Opus 5 and 5.5, Claude Sonnet 5.5 and Claude Fable 5, AiTM opts in to
Anthropic's server-side fallback: a declined request runs again on the model that
Anthropic recommends, and the run log records the model that produced each result.

## Terminal workflow

1. Launch `aitm` to create/open a project. Press **`n`** for New project, **`o`** for
   Projects, **`s`** for Settings (API keys), **`i`** to Add sources, or **`b`** to Manage sources. The import dialog
   accepts a public URL, an explicit file/folder path, or browsed files. In the file
   browser, Enter opens a folder/imports a file; Space marks multiple files, then
   select **Import N selected files**. Escape cancels. The Projects menu also supports
   rename, close, delete and importing a saved JSON project. `aitm <path-or-URL>`
   and `aitm --project ID` remain direct shortcuts.
2. Press **`f`: Run full pipeline** to generate TRACE, ranked STRIDE threats,
   attack trees for the **top three threats**, applicable coordination analysis,
   and the final report. Results remain drafts and the run does not pause for review.
   Fewer than three threats produce one tree per threat.
3. Use Up/Down to inspect each phase. For a run that pauses at human review gates,
   press `r`; `a` approves with optional notes, then `r` continues. The first
   gate is the TRACE model; Scope and Ingest need no approval. `e` opens
   the selected artifact in `$VISUAL`, `$EDITOR`, or `vi`. On Scope it edits scope
   and settings.
4. Completed assessments open on the menu. Press **`v`: View Markdown** to open
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

## Storage

The [API guide](docs/api.md) includes examples. The running server exposes
`GET /v1/openapi.json` with request schemas and artifact schemas; progress is SSE
with replay through `Last-Event-ID` or `?after=`. Jobs are independent of client
connections. Restarting after a crash marks unfinished runs `interrupted`; resume
retries the unfinished phase using saved artifacts.

State defaults to `$XDG_DATA_HOME/aitm-v2`, or `~/.local/share/aitm-v2` when unset
(`AITM_DATA_DIR` / `--data-dir` override). `AITM_PORT` / `--port` overrides port 8790.
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
AUTH="Authorization: Bearer $(aitm token)"
curl -fsS -H "$AUTH" 'http://127.0.0.1:8790/v1/projects/PROJECT_ID/report?format=markdown' -o report.md
curl -fsS -H "$AUTH" 'http://127.0.0.1:8790/v1/projects/PROJECT_ID/report?format=pdf' -o report.pdf
curl -fsS -H "$AUTH" http://127.0.0.1:8790/v1/projects/PROJECT_ID/export -o project.json
```

## PDF reports

PDF exports use a dedicated A4 layout with embedded BDO Grotesk, readable body
text, page numbers, clickable contents and PDF bookmarks. They include:

- An executive summary, a 5×5 likelihood/impact matrix and STRIDE category charts.
- Ranked threat details, connected attack-tree diagrams and coordination analysis
  when those phases are enabled.
- A mitigation roadmap grouped into immediate, 30-, 60- and 90-day actions.
- The TRACE model, coverage, linked evidence quotes, source inventory and review record.

The evidence appendix preserves full cited quotes and source metadata; large
assessments can produce long reports. The portable JSON export contains the
complete source snapshots. PDF export uses saved artifacts and makes no AI calls.
Re-export an existing assessment to use the current layout; no analysis rerun is
needed. Draft status remains until every enabled review gate is approved.
