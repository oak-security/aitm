#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  openSync,
  closeSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  unlinkSync,
} from 'node:fs';
import path from 'node:path';
import { ApiClient } from './client.js';
import { loadConfig, configureKeys, defaultDataDir } from './config.js';
import { LOGO, TAGLINE } from './tui/logo.js';

const HELP = `${LOGO}\n${TAGLINE}

Usage: aitm [source ...] [options]       Open the TUI (starts a local server if needed)
       aitm serve [--port 8790]         Run the engine and API in the foreground
       aitm stop [--data-dir DIR]       Stop the local background server
       aitm configure                  Enter OpenAI and Anthropic keys privately
       aitm status [--server URL]       Show server and provider configuration
       aitm export PROJECT --format markdown|pdf|json [--output FILE]

Options:
  --server URL     Attach to an existing loopback API; do not start another
  --data-dir DIR   Private engine storage (default ~/.local/share/aitm-v2)
  --port NUMBER    Local API port (default 8790)
  --name NAME      Name for an assessment created from command-line sources
  --scope TEXT     Assessment boundaries for command-line sources
  --help, -h       Show this help
  --version        Show the version

Sources: local folders, code/text/PDF/DOCX files, public HTTPS Git repositories.
Inside the TUI: r review run, f full draft, a approve, e edit, s source,
t notes, u sync, p provider, v verify key, c cancel, x export, q quit.
The server continues work when the TUI closes. AI calls send source excerpts
to the selected provider. Draft mode does not mark results as human-reviewed.
`;

function portNumber(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 65535)
    throw new Error('Port must be between 1 and 65535.');
  return n;
}
const recordPath = (dir) => path.join(dir, 'server.json');

async function foreground(options) {
  const config = loadConfig(),
    dataDir = path.resolve(options['data-dir'] || config.dataDir),
    port = portNumber(options.port || config.port);
  const { Engine } = await import('./engine/engine.js');
  const { Providers } = await import('./engine/providers.js');
  const { startServer } = await import('./api/server.js');
  const engine = await Engine.open({ dataDir, providers: new Providers(config) });
  let api;
  try {
    api = await startServer(engine, { port });
  } catch (error) {
    await engine.close();
    throw error;
  }
  writeFileSync(
    recordPath(dataDir),
    JSON.stringify({
      pid: process.pid,
      url: api.url,
      dataDir,
      startedAt: new Date().toISOString(),
    }),
    { mode: 0o600 },
  );
  console.log(
    `AiTM engine listening at ${api.url}\nData: ${dataDir}\nAPI contract: ${api.url}/v1/openapi.json`,
  );
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await engine.close();
    await api.close();
    try {
      if (JSON.parse(readFileSync(recordPath(dataDir), 'utf8')).pid === process.pid)
        unlinkSync(recordPath(dataDir));
    } catch {}
    process.exitCode = 0;
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

async function connect(options, { autoStart = false } = {}) {
  const port = portNumber(options.port || process.env.AITM_PORT || 8790);
  const dataDir = path.resolve(
    options['data-dir'] || process.env.AITM_DATA_DIR || defaultDataDir(),
  );
  let saved;
  try {
    saved = JSON.parse(readFileSync(recordPath(dataDir), 'utf8'));
  } catch {}
  const url =
    options.server ||
    (options.port ? `http://127.0.0.1:${port}` : saved?.url || `http://127.0.0.1:${port}`);
  const client = new ApiClient(url);
  const health = async () => {
    const result = await client.get('/v1/health', { signal: AbortSignal.timeout(2000) });
    if (result.service !== 'aitm' || result.apiVersion !== 1 || result.version !== '2.0.0')
      throw new Error('The target is not a compatible AiTM v2 server.');
    if (!options.server && options['data-dir'] && result.dataDir !== dataDir)
      throw new Error(
        'This port belongs to an AiTM server using a different data directory. Choose another --port, or explicitly attach with --server.',
      );
    return client;
  };
  try {
    return await health();
  } catch (error) {
    if (!autoStart || options.server || !error.message.includes('Cannot reach')) throw error;
  }
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const log = path.join(dataDir, 'server.log');
  const fd = openSync(log, 'a', 0o600);
  const child = spawn(
    process.execPath,
    [fileURLToPath(import.meta.url), 'serve', '--port', String(port), '--data-dir', dataDir],
    { detached: true, stdio: ['ignore', fd, fd], cwd: process.cwd(), env: process.env },
  );
  closeSync(fd);
  child.unref();
  let childError;
  child.once('error', (error) => {
    childError = error;
  });
  for (let attempt = 0; attempt < 50; attempt++) {
    if (childError || child.exitCode !== null)
      throw new Error(`Could not start the server. Details: ${log}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
    try {
      return await health();
    } catch {}
  }
  throw new Error(`Server startup did not complete. Details: ${log}`);
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean' },
      server: { type: 'string' },
      port: { type: 'string' },
      'data-dir': { type: 'string' },
      name: { type: 'string' },
      scope: { type: 'string' },
      format: { type: 'string' },
      output: { type: 'string' },
    },
  });
  if (values.help) {
    console.log(HELP);
    return;
  }
  if (values.version) {
    console.log('2.0.0');
    return;
  }
  const mode = positionals[0];
  if (mode === 'configure') {
    await configureKeys();
    return;
  }
  if (mode === 'serve') {
    await foreground(values);
    return;
  }
  if (mode === 'stop') {
    const dir = path.resolve(values['data-dir'] || process.env.AITM_DATA_DIR || defaultDataDir());
    if (!existsSync(recordPath(dir)))
      throw new Error('No server record found for this data directory.');
    const record = JSON.parse(readFileSync(recordPath(dir), 'utf8'));
    // Require a live API and an AiTM process command to avoid signalling a reused PID.
    const health = await new ApiClient(record.url).get('/v1/health', {
      signal: AbortSignal.timeout(2000),
    });
    if (health.pid !== record.pid || health.dataDir !== dir)
      throw new Error('The server record no longer matches the running process.');
    const { execFileSync } = await import('node:child_process');
    const args = execFileSync('ps', ['-p', String(record.pid), '-o', 'command='], {
      encoding: 'utf8',
    });
    if (!args.includes(fileURLToPath(import.meta.url)) || !args.includes('serve'))
      throw new Error('Server PID does not belong to this AiTM installation.');
    process.kill(record.pid, 'SIGTERM');
    console.log('Server shutdown requested. Active runs will be cancelled and saved.');
    return;
  }
  if (mode === 'status') {
    const client = await connect(values);
    console.log(
      JSON.stringify(
        {
          url: client.url,
          ...(await client.get('/v1/health')),
          providers: await client.get('/v1/providers'),
        },
        null,
        2,
      ),
    );
    return;
  }
  if (mode === 'export') {
    const id = positionals[1];
    if (!id)
      throw new Error('Usage: aitm export PROJECT_ID --format markdown|pdf|json --output FILE');
    const format = values.format || 'markdown';
    if (!['markdown', 'pdf', 'json'].includes(format))
      throw new Error('Choose markdown, pdf or json.');
    const client = await connect(values),
      base = client.projectPath(id);
    const data =
      format === 'json'
        ? JSON.stringify(await client.get(`${base}/export`), null, 2)
        : await client.get(`${base}/report?format=${format}`, {
            format: format === 'pdf' ? 'buffer' : 'text',
          });
    if (values.output) {
      writeFileSync(path.resolve(values.output), data, { flag: 'wx', mode: 0o600 });
      console.log(`Exported to ${path.resolve(values.output)}`);
    } else if (format === 'pdf' && process.stdout.isTTY)
      throw new Error('Use --output FILE for a PDF, or redirect stdout.');
    else process.stdout.write(data);
    return;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new Error(
      'The TUI needs an interactive terminal. Run aitm in a terminal, or use aitm serve for the API. See --help.',
    );
  const client = await connect(values, { autoStart: true });
  const sources = mode === 'tui' ? positionals.slice(1) : positionals;
  let initialProjectId = null;
  if (sources.length) {
    const project = await client.post('/v1/projects', {
      name: values.name || 'New assessment',
      scope:
        values.scope ||
        'Assess the supplied system. Review scope, exclusions and assumptions before running.',
    });
    initialProjectId = project.id;
    for (const source of sources)
      await client.post(
        `${client.projectPath(project.id)}/sources`,
        source.startsWith('https://')
          ? { kind: 'git', url: source }
          : { kind: 'local', path: path.resolve(source) },
      );
  }
  const [{ default: React }, { render }, { App }] = await Promise.all([
    import('react'),
    import('ink'),
    import('./tui/app.js'),
  ]);
  const ui = render(React.createElement(App, { client, initialProjectId }), {
    alternateScreen: true,
  });
  await ui.waitUntilExit();
  console.log(`AiTM server remains available at ${client.url}. Use aitm stop to shut it down.`);
}

main().catch((error) => {
  console.error(`AiTM: ${error.message}`);
  process.exitCode = 1;
});
