import {
  existsSync,
  lstatSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
  renameSync,
  chmodSync,
} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';

export const configDir = () =>
  path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'aitm');
export const defaultDataDir = () =>
  path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'aitm-v2');

function privateFile(file) {
  if (!existsSync(file)) return null;
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new Error('Credential configuration must be a regular file.');
  if (process.platform !== 'win32' && stat.mode & 0o077)
    throw new Error(`Credential file must be owner-readable only: chmod 600 ${file}`);
  return readFileSync(file, 'utf8');
}

export function loadConfig() {
  const packageRoot = fileURLToPath(new URL('..', import.meta.url));
  const file = [path.resolve('.env.local'), path.join(packageRoot, '.env.local')].find((p) =>
    existsSync(p),
  );
  const local = file ? parseEnv(privateFile(file)) : {};
  const stored = privateFile(path.join(configDir(), 'keys.json'));
  let keys = {};
  try {
    if (stored) keys = JSON.parse(stored);
  } catch {
    throw new Error('The saved credential file is invalid JSON. Run aitm configure to replace it.');
  }
  const env = { ...local, ...process.env };
  return {
    keys: {
      openai: env.OPENAI_API_KEY || keys.openai || '',
      anthropic: env.ANTHROPIC_API_KEY || keys.anthropic || '',
    },
    anthropicWorkspaceId: env.ANTHROPIC_WORKSPACE_ID || '',
    dataDir: path.resolve(env.AITM_DATA_DIR || defaultDataDir()),
    port: Number(env.AITM_PORT || 8790),
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
      process.stdout.write(`${name} API key (hidden): `);
      const key = (await input.question('')).trim();
      process.stdout.write('\n');
      if (!key || /\s/.test(key))
        throw new Error(`${name} key cannot be empty or contain whitespace.`);
      keys[provider] = key;
    }
  } finally {
    input.close();
  }
  const dir = configDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const temporary = path.join(dir, `keys-${process.pid}.tmp`);
  writeFileSync(temporary, JSON.stringify(keys), { flag: 'wx', mode: 0o600 });
  renameSync(temporary, path.join(dir, 'keys.json'));
  console.log(
    'Keys saved privately. Restart the server to load them. Environment variables and .env.local take precedence.',
  );
}
