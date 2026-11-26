# AiTM: AI Threat Modeller

```text
    _    ___ _____ __  __
   / \  |_ _|_   _|  \/  |    o-----o
  / _ \  | |  | | | |\/| |    |\   /|
 / ___ \ | |  | | | |  | |    | o-o |
/_/   \_\___| |_| |_|  |_|    o-----o
```

A reusable engine for the [TRACE methodology](https://github.com/oak-security/TRACE/blob/main/METHODOLOGY.md),
with a terminal interface, a browser workbench and a local API.

AiTM was developed by Dr. Stefan Beyer as a reference implementation for
AI-assisted tooling that supports his TRACE threat hunting methodology.

Give AiTM a repository, a folder or design documents. It builds a TRACE model,
ranks STRIDE threats, draws attack trees for the top threats, analyses collusion,
and assembles a report with a mitigation roadmap. Each claim links to a source
quote. Each output is a draft until a person reviews it.

## Install

AiTM needs [Node.js](https://nodejs.org) 22.12 or later. Git is needed only to
import repository URLs.

```sh
git clone https://github.com/oak-security/aitm.git
cd aitm
npm ci
npm link
aitm doctor
```

`npm link` puts the `aitm` command on your `PATH` and points it at this checkout.
`aitm doctor` checks Node.js, Git, keys, storage and the port, and tells you what
to correct. To run without a link, use `npm start` in the checkout. If `npm link`
needs root on your system, run `npm_config_prefix="$HOME/.local" npm link` and
put `~/.local/bin` on your `PATH`.

To install a release tarball instead of a checkout:

```sh
npm install --global ./oak-security-aitm-2.2.0.tgz
```

## First run

```sh
aitm configure     # enter an OpenAI or Anthropic key (hidden input)
aitm               # terminal interface
aitm web           # browser workbench
```

You can skip `aitm configure`. When no key is saved, each interface starts on
its Settings screen, where you can add one. You can create projects, import
sources and read saved reports without a key. A run needs the key of the
provider that the project uses.

Then:

1. Create a project and give it a name. A scope is optional.
2. Add sources: a local folder or file, a public repository URL, a document URL,
   or a repository ZIP.
3. Start **Run full pipeline** (`f` in the terminal).
4. Read the report (`v`), then export Markdown, PDF or JSON (`x`).

Shortcuts for a single source:

```sh
aitm ./my-repo                             # open or reopen a folder
aitm "./design notes.pdf" --full            # import and run immediately
aitm web https://github.com/org/repository  # public repository, in the browser
aitm --project PROJECT_ID                  # reopen a saved project
```

AI runs send source content to the provider you select. Nothing leaves your
computer before you start a run.

## Commands

| Command                 | Purpose                                                    |
| ----------------------- | ---------------------------------------------------------- |
| `aitm [source]`         | Terminal interface, with the engine and API                |
| `aitm web [source]`     | Engine and API, then opens the browser workbench           |
| `aitm serve`            | Engine and API in the foreground, for scripts              |
| `aitm configure`        | Save provider keys with hidden prompts                     |
| `aitm doctor [--live]`  | Check the setup. `--live` sends one small provider request |
| `aitm token [--rotate]` | Print, or replace, the private API access token            |

Options: `--full`, `--project ID`, `--port NUMBER`, `--data-dir DIR`, `--no-open`,
`--allowed-host HOST:PORT`. Run `aitm --help` for details.

One process runs the engine, the API and the interface. `q` or Ctrl+C saves and
closes all of them. Completed steps stay saved; an unfinished step is cancelled
and resumes on the next run. There is no background daemon.

## Keys and models

`aitm configure` and the Settings screens save keys to `~/.config/aitm/keys.json`
with mode 600. Environment variables (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`) and
a private `.env.local` also work; a saved key takes precedence. `aitm doctor`
shows which source is active.

| Provider  | Fast model (intake, model, trees, report) | Deep model (STRIDE, coordination) |
| --------- | ----------------------------------------- | --------------------------------- |
| OpenAI    | `gpt-6.2-sol`                             | `gpt-6.2-astra`                   |
| Anthropic | `claude-sonnet-5-5`                       | `claude-opus-5-5`                 |

Each project can select other models from your account's model list (`p` in the
terminal, **Settings & models** in the browser).

## Access token

The API accepts only loopback connections, and each request must carry a private
access token. Without the token, another user or process on the same host could
read your files through source import.

- `aitm web` opens a URL that contains the token. The browser then keeps it in a
  cookie, so a bookmark to `http://127.0.0.1:8790/` continues to work.
- Scripts send `Authorization: Bearer "$(aitm token)"`.
- The token is saved in `~/.config/aitm/token` (mode 600) and stays the same
  across restarts. `aitm token --rotate` replaces it.

## Headless server over SSH

On the server:

```sh
aitm web --no-open
```

On your computer, forward the port, then open the URL that the server printed:

```sh
ssh -N -L 8790:127.0.0.1:8790 USER@SERVER
```

If you forward to a different local port, tell AiTM to accept it:

```sh
aitm web --no-open --allowed-host 127.0.0.1:9000   # server
ssh -N -L 9000:127.0.0.1:8790 USER@SERVER          # your computer
```

Then replace `8790` with `9000` in the printed URL.

## Documentation

- [Usage guide](docs/usage.md): terminal and browser workflows, keys, storage, reports.
- [Inputs and limits](docs/inputs-and-limits.md): accepted sources, size caps, evidence checks.
- [API guide](docs/api.md): HTTP and SSE resources, with examples.
- [Specification](SPEC.md): the engine contract.
- [Security policy](SECURITY.md) and [changelog](CHANGELOG.md).
- [Contributing](CONTRIBUTING.md): development setup, tests and invariants.

## Use the engine in your code

```js
import { Engine, Providers, startServer } from '@oak-security/aitm';

const engine = await Engine.open({
  dataDir: '/private/path/aitm',
  providers: new Providers({ keys: { anthropic: process.env.ANTHROPIC_API_KEY } }),
});
const project = engine.create({ name: 'My system', config: { provider: 'anthropic' } });
await engine.addSource(project.id, { kind: 'local', path: '/path/to/source' });
engine.run(project.id, { mode: 'full' });

// Optional HTTP interface to the same engine. It returns its access token.
const api = await startServer(engine, { port: 8790 });
console.log(api.webUrl());
// On shutdown: await engine.close(); await api.close();
```

HTTP clients can import `ApiClient` from `@oak-security/aitm/client`.

## License

[MIT](LICENSE). Copyright (c) 2026 Oak Security.

Bundled BDO Grotesk fonts retain their [SIL Open Font License 1.1](src/assets/OFL.txt)
and [font attribution](src/assets/README.md). Dependencies retain their licenses.
The TRACE methodology is by Dr. Stefan Beyer at Oak Security and has its own
[CC BY 4.0 license](https://github.com/oak-security/TRACE/blob/main/LICENSE.md).

Reports state that they were generated by AiTM using AI and that Oak Security
did not author, review or endorse them.
