import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { sourceInput } from '../src/source-input.js';

const exec = promisify(execFile);
test('CLI entrypoints provide version and help without starting a UI', async () => {
  const manifest = JSON.parse(await readFile('package.json', 'utf8'));
  const { stdout } = await exec(process.execPath, ['src/cli.js', '--version']);
  assert.equal(stdout.trim(), manifest.version);
  const help = await exec(process.execPath, ['src/cli.js', '--help']);
  for (const text of [
    'o-----o',
    'TRACE',
    'aitm serve',
    'aitm configure',
    'aitm doctor',
    'aitm token',
    '--allowed-host',
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

test('aitm token prints one persistent private token and replaces it only on request', async (t) => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'aitm-token-cli-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const run = (...args) =>
    exec(process.execPath, ['src/cli.js', ...args], {
      env: { ...process.env, XDG_CONFIG_HOME: home },
    });
  const first = (await run('token')).stdout.trim();
  assert.match(first, /^[A-Za-z0-9_-]{43}$/);
  assert.equal((await run('token')).stdout.trim(), first);
  assert.equal((await stat(path.join(home, 'aitm', 'token'))).mode & 0o777, 0o600);
  const rotated = (await run('token', '--rotate')).stdout.trim();
  assert.notEqual(rotated, first);
  assert.equal((await run('token')).stdout.trim(), rotated);
  await assert.rejects(run('serve', '--rotate'), (e) => e.stderr.includes('only for aitm token'));
});

test('aitm doctor reports the local setup and fails on an unusable configuration', async (t) => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'aitm-doctor-cli-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const { doctor } = await import('../src/doctor.js');
  const { loadConfig } = await import('../src/config.js');
  const options = { directory: path.join(home, 'config'), cwd: home, packageRoot: home };
  const lines = [];
  const failures = await doctor({
    load: () => loadConfig({ ...options, env: { OPENAI_API_KEY: 'doctor-private-key' } }),
    port: 0,
    dataDir: path.join(home, 'data'),
    write: (line) => lines.push(line),
  });
  const report = lines.join('\n');
  assert.equal(failures, 0, report);
  for (const text of ['Node.js', 'OpenAI key: environment', 'Anthropic key: not configured'])
    assert.ok(report.includes(text), report);
  assert.ok(report.includes('Result: ready.'));
  assert.ok(!report.includes('doctor-private-key'));
  const broken = [];
  assert.equal(
    await doctor({
      load: () => {
        throw new Error('Credential file must be owner-readable only: chmod 600 keys.json');
      },
      write: (line) => broken.push(line),
    }),
    1,
  );
  assert.ok(broken.join('\n').includes('FAIL  Credential file'));
});
