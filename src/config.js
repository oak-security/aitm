import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { credentialPatch } from './engine/credentials.js';
import { configDir, readPrivate, writePrivate, loadToken, tokenFile } from './token.js';

export { configDir };
export const defaultDataDir = () =>
  path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'aitm-v2');
const privateFile = readPrivate;

function storedKeys(directory) {
  const stored = privateFile(path.join(directory, 'keys.json'));
  try {
    return stored ? credentialPatch(JSON.parse(stored)) : {};
  } catch {
    throw new Error(
      'The saved credential file is invalid. Check keys.json in the AiTM configuration directory.',
    );
  }
}

export function saveKeys(patch, { directory = configDir() } = {}) {
  const changes = credentialPatch(patch);
  if (!Object.keys(changes).length) return;
  const next = { ...storedKeys(directory), ...changes };
  writePrivate(directory, 'keys.json', JSON.stringify(next));
}

export function loadConfig({
  env = process.env,
  cwd = process.cwd(),
  directory = configDir(),
  packageRoot = fileURLToPath(new URL('..', import.meta.url)),
} = {}) {
  const file = [path.resolve(cwd, '.env.local'), path.join(packageRoot, '.env.local')].find((p) =>
    existsSync(p),
  );
  const local = file ? parseEnv(privateFile(file)) : {};
  const stored = storedKeys(directory);
  const combined = { ...local, ...env };
  const names = { openai: 'OPENAI_API_KEY', anthropic: 'ANTHROPIC_API_KEY' };
  const keys = Object.fromEntries(
    Object.entries(names).map(([provider, variable]) => [
      provider,
      stored[provider] || env[variable] || local[variable] || '',
    ]),
  );
  return {
    keys,
    keySources: Object.fromEntries(
      Object.entries(names).map(([provider, variable]) => [
        provider,
        stored[provider]
          ? 'saved settings'
          : env[variable]
            ? 'environment'
            : local[variable]
              ? '.env.local'
              : 'not configured',
      ]),
    ),
    keyFile: path.join(directory, 'keys.json'),
    tokenFile: tokenFile(directory),
    apiToken: (options) => loadToken(directory, options),
    saveCredentials: (patch) => saveKeys(patch, { directory }),
    anthropicWorkspaceId: stored.anthropicWorkspaceId ?? combined.ANTHROPIC_WORKSPACE_ID ?? '',
    dataDir: path.resolve(combined.AITM_DATA_DIR || defaultDataDir()),
    port: Number(combined.AITM_PORT || 8790),
  };
}

export async function configureKeys() {
  if (!process.stdin.isTTY) throw new Error('Run aitm configure in an interactive terminal.');
  const sink = new Writable({
    write(chunk, encoding, callback) {
      callback();
    },
  });
  const input = createInterface({ input: process.stdin, output: sink, terminal: true });
  const keys = {};
  try {
    for (const [provider, name] of [
      ['openai', 'OpenAI'],
      ['anthropic', 'Anthropic'],
    ]) {
      process.stdout.write(`${name} API key (hidden; Enter keeps existing): `);
      const key = (await input.question('')).trim();
      process.stdout.write('\n');
      if (key) Object.assign(keys, credentialPatch({ [provider]: key }));
    }
  } finally {
    input.close();
  }
  saveKeys(keys);
  console.log(
    Object.keys(keys).length
      ? 'Keys saved privately. Saved settings take precedence over environment variables and .env.local. Reopen a running AiTM session to load CLI changes, or use s Settings to update immediately.'
      : 'No keys changed.',
  );
}
