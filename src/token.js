import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';

// Node built-ins only: the API client imports this module without the engine.
export const configDir = () =>
  path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'aitm');

export function readPrivate(file) {
  if (!existsSync(file)) return null;
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new Error('Credential configuration must be a regular file.');
  if (process.platform !== 'win32' && stat.mode & 0o077)
    throw new Error(`Credential file must be owner-readable only: chmod 600 ${file}`);
  return readFileSync(file, 'utf8');
}

export function writePrivate(directory, name, content) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const temporary = path.join(directory, `${name}-${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, content, { flag: 'wx', mode: 0o600 });
    renameSync(temporary, path.join(directory, name));
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
export const newToken = () => randomBytes(32).toString('base64url');
export const tokenFile = (directory = configDir()) => path.join(directory, 'token');

// The saved API access token, or '' when none exists. Never creates one.
export function readToken(directory = configDir()) {
  const saved = readPrivate(tokenFile(directory))?.trim() || '';
  return TOKEN_PATTERN.test(saved) ? saved : '';
}

// One persistent token per user, so browser sessions and scripts survive a restart.
export function loadToken(directory = configDir(), { rotate = false } = {}) {
  const saved = rotate ? '' : readToken(directory);
  if (saved) return saved;
  readPrivate(tokenFile(directory)); // refuse to replace a symlink or shared file
  const token = newToken();
  writePrivate(directory, 'token', `${token}\n`);
  return token;
}
