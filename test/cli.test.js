import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { sourceInput } from '../src/source-input.js';

const exec = promisify(execFile);
test('CLI entrypoints provide version and help without starting a UI', async () => {
  const { stdout } = await exec(process.execPath, ['src/cli.js', '--version']);
  assert.equal(stdout.trim(), '2.0.0');
  const help = await exec(process.execPath, ['src/cli.js', '--help']);
  for (const text of [
    'o-----o',
    'TRACE',
    'aitm serve',
    'aitm configure',
    'project chooser',
    'path-or-url',
    '--full',
    'top 3 attack trees',
    'v view Markdown',
  ])
    assert.ok(help.stdout.includes(text));
  await assert.rejects(exec(process.execPath, ['src/cli.js']), (e) =>
    e.stderr.includes('interactive terminal'),
  );
  const manifest = JSON.parse(await readFile('package.json', 'utf8'));
  assert.equal(manifest.bin.aitm, 'src/cli.js');
});

test('source paths preserve spaces, expand home, and resolve relative to the launching directory', () => {
  assert.throws(() => sourceInput(undefined, '/work'), /Choose a source explicitly/);
  assert.deepEqual(sourceInput('.', '/work'), { kind: 'local', path: '/work' });
  assert.throws(() => sourceInput('""'), /Provide a file/);
  assert.deepEqual(sourceInput('"./design notes.pdf"', '/work'), {
    kind: 'local',
    path: '/work/design notes.pdf',
  });
  assert.deepEqual(sourceInput("'~/Documents/spec.md'"), {
    kind: 'local',
    path: path.join(os.homedir(), 'Documents/spec.md'),
  });
  assert.deepEqual(sourceInput('https://github.com/oak-security/TRACE'), {
    kind: 'git',
    url: 'https://github.com/oak-security/TRACE',
  });
  assert.deepEqual(sourceInput('https://example.org/whitepaper.pdf'), {
    kind: 'url',
    url: 'https://example.org/whitepaper.pdf',
  });
  assert.deepEqual(sourceInput('https://github.com/org/repo/blob/main/spec.md'), {
    kind: 'url',
    url: 'https://raw.githubusercontent.com/org/repo/main/spec.md',
  });
  assert.throws(() => sourceInput('http://example.org/spec.md'), /HTTPS/);
});

test('package exposes the headless reusable engine without starting a server or TUI', async () => {
  const { Engine, Providers, startServer, PHASES } = await import('@oak-security/aitm');
  assert.equal(typeof Engine.open, 'function');
  assert.equal(typeof Providers, 'function');
  assert.equal(typeof startServer, 'function');
  assert.equal(PHASES[0].id, 'scope');
  const { ApiClient } = await import('@oak-security/aitm/client');
  assert.equal(typeof ApiClient, 'function');
});

test('CLI accepts one source and rejects obsolete connection/input options', async () => {
  for (const args of [
    ['one', 'two'],
    ['--source', 'one'],
    ['--server', 'http://localhost:8790'],
  ])
    await assert.rejects(exec(process.execPath, ['src/cli.js', ...args]), (e) =>
      /Choose one source|Unknown option/.test(e.stderr),
    );
});
