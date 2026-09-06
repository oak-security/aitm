#!/usr/bin/env node
import { parseArgs } from 'node:util';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadConfig, configureKeys } from './config.js';
import { Providers } from './engine/providers.js';
import { startApplication, openAssessment } from './application.js';
import { LOGO, TAGLINE, terminalText } from './tui/logo.js';
import { sourceInput } from './source-input.js';

const HELP = `${LOGO}\n${TAGLINE}

Usage: aitm [path-or-url] [options]   Open the project chooser; a source argument is optional
       aitm web [path-or-url]        Open the web project chooser
       aitm serve                   Run just the engine and local API
       aitm configure               Enter OpenAI and Anthropic keys privately

Options:
  --project ID    Open a saved project by ID
  --full          Start/resume the full pipeline with top 3 attack trees
  --no-open       With web, print the URL without opening a browser
  --port NUMBER   Local API port (default 8790)
  --data-dir DIR  Private storage (default ~/.local/share/aitm-v2)
  --help, -h      Show this help
  --version       Show the version

Examples: aitm
          aitm ./my-repo
          aitm "./design notes.pdf" --full
          aitm https://github.com/organisation/repository
          aitm https://example.org/whitepaper.pdf

Starting without a source opens the project chooser; the current folder is never
imported automatically. Create/open projects and add several public URLs,
code/doc files or ZIP repositories through the import dialogs. An explicit source
argument opens an assessment containing that source; --project opens one by ID.
The engine, TUI and API run together. q saves and quits; unfinished work is
cancelled and completed steps are retained. No background server is left running.
Inside the TUI: o projects, n new project, i add sources, b manage sources,
s settings/API keys, p provider/model lists, f full pipeline,
v view Markdown, x export, ? help.
AI runs send source content to your selected provider. Results remain drafts
until reviewed. Use aitm serve for an API that runs without the TUI.
`;

async function withActivity(label, action) {
  let frame = 0;
  const draw = () =>
    process.stdout.write(`\r\u001b[2K${['|', '/', '-', '\\'][frame++ % 4]} ${terminalText(label)}`);
  draw();
  const timer = setInterval(draw, 150);
  try {
    return await action();
  } finally {
    clearInterval(timer);
    process.stdout.write('\r\u001b[2K');
  }
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean' },
      port: { type: 'string' },
      'data-dir': { type: 'string' },
      full: { type: 'boolean' },
      project: { type: 'string' },
      'no-open': { type: 'boolean' },
    },
  });
  if (values.help) return console.log(HELP);
  if (values.version) return console.log('2.0.0');
  const web = positionals[0] === 'web';
  if (positionals.length > (web ? 2 : 1))
    throw new Error(
      'Choose one source argument: aitm [path-or-url]. Add more sources through the import dialogs.',
    );
  const command = positionals[0];
  if (command === 'configure') return configureKeys();
  const headless = command === 'serve';
  const explicitSource = web ? positionals[1] : headless ? undefined : command;
  if (values.project && (explicitSource || headless))
    throw new Error('Use --project with the TUI or web, without a source argument.');
  if (values.full && !explicitSource && !values.project)
    throw new Error(
      'Choose a saved project with --project or provide an explicit source before using --full.',
    );
  if (values['no-open'] && !web) throw new Error('--no-open is only for aitm web.');
  if (headless && values.full)
    throw new Error('Use aitm <source> --full, or start a run through the API.');
  if (!headless && !web && (!process.stdin.isTTY || !process.stdout.isTTY))
    throw new Error('The TUI needs an interactive terminal. Use aitm serve for the headless API.');
  const config = loadConfig();
  const port = Number(values.port || config.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('Port must be between 1 and 65535.');
  const app = await startApplication({
    dataDir: path.resolve(values['data-dir'] || config.dataDir),
    providers: new Providers(config),
    port,
  });
  let ui,
    stopping = false;
  let resolveSignal;
  const signalReceived = new Promise((resolve) => {
    resolveSignal = resolve;
  });
  const stop = () => {
    stopping = true;
    ui?.unmount();
    resolveSignal();
    // Abort intake/provider I/O as soon as the signal arrives.
    app.close().catch(() => {});
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    if (headless) {
      console.log(
        `AiTM engine and API: ${app.url}\nData: ${app.engine.store.directory}\nCtrl+C to save and quit.`,
      );
      await signalReceived;
      return;
    }
    let project,
      reused = false;
    if (values.project) project = app.engine.get(values.project);
    else if (explicitSource)
      ({ project, reused } = await withActivity('Opening selected source', () =>
        openAssessment(app.engine, sourceInput(explicitSource)),
      ));
    if (stopping) return;
    if (values.full) app.engine.run(project.id, { mode: 'full' });
    if (web) {
      const url = project ? `${app.url}/#/projects/${project.id}/overview` : `${app.url}/`;
      console.log(
        `AiTM web workbench: ${url}\nData: ${app.engine.store.directory}\nCtrl+C to save and quit.`,
      );
      if (!values['no-open']) {
        const [program, args] =
          process.platform === 'darwin'
            ? ['open', [url]]
            : process.platform === 'win32'
              ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
              : ['xdg-open', [url]];
        try {
          await promisify(execFile)(program, args);
        } catch {
          console.log('Open the workbench URL above in your browser.');
        }
      }
      await signalReceived;
      return;
    }
    const [{ default: React }, { render }, { Workbench }] = await Promise.all([
      import('react'),
      import('ink'),
      import('./tui/workbench.js'),
    ]);
    if (stopping) return;
    ui = render(
      React.createElement(Workbench, {
        engine: app.engine,
        projectId: project?.id,
        apiUrl: app.url,
        initialNotice: project?.artifacts.report
          ? 'Report ready. v View Markdown · x Export · ? Help.'
          : reused
            ? 'Saved assessment reopened. f Continue TRACE · u Refresh source snapshot.'
            : 'Source loaded. f Run full pipeline · e Edit scope · ? Help.',
      }),
      { alternateScreen: true },
    );
    await Promise.race([ui.waitUntilExit(), signalReceived]);
  } catch (error) {
    if (!stopping) throw error;
  } finally {
    await app.close();
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
  console.log('AiTM saved and closed. Open the same source to continue.');
}

main().catch((error) => {
  console.error(`AiTM: ${terminalText(error.message)}`);
  process.exitCode = 1;
});
