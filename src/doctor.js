import { accessSync, constants, existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import net from 'node:net';
import path from 'node:path';
import lockfile from 'proper-lockfile';
import { loadConfig } from './config.js';
import { readToken } from './token.js';
import { Providers } from './engine/providers.js';
import { DEFAULT_MODELS } from './engine/schema.js';
import { NODE_RANGE, VERSION } from './version.js';

const NAMES = { openai: 'OpenAI', anthropic: 'Anthropic' };

function portState(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', (error) => resolve(error.code === 'EADDRINUSE' ? 'busy' : error.code));
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve('free')));
  });
}

// Read-only checks of the local setup. Returns the number of failures.
export async function doctor({
  load = loadConfig,
  port,
  dataDir,
  live = false,
  write = console.log,
  fetchImpl = fetch,
} = {}) {
  let failures = 0;
  const ok = (text) => write(`ok    ${text}`);
  const warn = (text) => write(`warn  ${text}`);
  const fail = (text) => {
    failures++;
    write(`FAIL  ${text}`);
  };
  write(`AiTM ${VERSION} doctor`);

  const minimum = (/\d+(?:\.\d+){0,2}/.exec(NODE_RANGE)?.[0] || '0').split('.').map(Number);
  const node = process.versions.node;
  const current = node.split('.').map(Number);
  const index = [0, 1, 2].find((i) => current[i] !== (minimum[i] || 0));
  if (index === undefined || current[index] > (minimum[index] || 0))
    ok(`Node.js ${node} (requires ${NODE_RANGE})`);
  else fail(`Node.js ${node} is too old. Install Node.js ${NODE_RANGE}.`);

  try {
    const { stdout } = await promisify(execFile)('git', ['--version']);
    ok(stdout.trim());
  } catch {
    warn('Git is not on PATH. Repository URLs cannot be imported; local sources still work.');
  }

  let config;
  try {
    config = load();
  } catch (error) {
    fail(error.message);
  }
  if (config) {
    for (const [provider, name] of Object.entries(NAMES)) {
      const source = config.keySources[provider];
      if (config.keys[provider]) ok(`${name} key: ${source}`);
      else warn(`${name} key: not configured`);
    }
    if (!Object.values(config.keys).some(Boolean))
      warn('No provider key. Run aitm configure, or add a key in Settings, before a run.');
    ok(
      existsSync(config.keyFile)
        ? `Key file: ${config.keyFile} (owner-only)`
        : `Key file: ${config.keyFile} (not created yet)`,
    );
    try {
      ok(
        readToken(path.dirname(config.tokenFile))
          ? `API access token: ${config.tokenFile} (owner-only)`
          : `API access token: created on first start in ${config.tokenFile}`,
      );
    } catch (error) {
      fail(error.message);
    }

    const directory = path.resolve(dataDir || config.dataDir);
    if (!existsSync(directory)) ok(`Data directory: ${directory} (created on first start)`);
    else
      try {
        accessSync(directory, constants.R_OK | constants.W_OK);
        if (await lockfile.check(directory, { stale: 10000 }))
          warn(`Data directory: ${directory} is in use by a running AiTM instance.`);
        else ok(`Data directory: ${directory}`);
      } catch {
        fail(`Data directory: ${directory} is not readable and writable.`);
      }

    const selected = Number(port || config.port);
    const state = await portState(selected);
    if (state === 'free') ok(`Port ${selected} is free.`);
    else if (state === 'busy') {
      const health = await fetchImpl(`http://127.0.0.1:${selected}/v1/health`, {
        signal: AbortSignal.timeout(2000),
      })
        .then((response) => response.json())
        .catch(() => null);
      if (health?.service === 'aitm')
        warn(`Port ${selected}: AiTM ${health.version} runs here. Open its URL, or use --port.`);
      else fail(`Port ${selected} is in use by another program. Use --port NUMBER.`);
    } else fail(`Port ${selected} cannot be opened (${state}).`);

    if (live) {
      const providers = new Providers(config);
      for (const [provider, name] of Object.entries(NAMES)) {
        if (!config.keys[provider]) continue;
        const model = DEFAULT_MODELS[provider].fastModel;
        try {
          await providers.test(provider, model, AbortSignal.timeout(60000));
          ok(`${name} request with ${model} completed.`);
        } catch (error) {
          fail(`${name} request with ${model}: ${providers.redact(error.message)}`);
        }
      }
    } else if (Object.values(config.keys).some(Boolean))
      write('      Run aitm doctor --live to send one small request to each configured provider.');
  }
  write(failures ? `Result: ${failures} problem(s) to correct.` : 'Result: ready.');
  return failures;
}
