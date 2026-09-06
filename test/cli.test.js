import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const exec = promisify(execFile);
test('CLI entrypoints provide version and help without starting a UI', async () => {
  const { stdout } = await exec(process.execPath, ['src/cli.js', '--version']);
  assert.equal(stdout.trim(), '2.0.0');
  const help = await exec(process.execPath, ['src/cli.js', '--help']);
  for (const text of ['o-----o', 'TRACE', 'aitm serve', 'aitm configure', 'aitm export'])
    assert.ok(help.stdout.includes(text));
  await assert.rejects(exec(process.execPath, ['src/cli.js']), (e) =>
    e.stderr.includes('interactive terminal'),
  );
  const manifest = JSON.parse(await readFile('package.json', 'utf8'));
  assert.equal(manifest.bin.aitm, 'src/cli.js');
});

test('TUI and API client have no engine, storage or provider dependencies', async () => {
  const files = (await readdir('src/tui'))
    .filter((f) => f.endsWith('.js'))
    .map((f) => path.join('src/tui', f));
  files.push('src/client.js');
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    assert.doesNotMatch(text, /from\s+['"][^'"]*(?:engine|config|providers|store)/, file);
    assert.doesNotMatch(
      text,
      /api\.openai\.com|api\.anthropic\.com|OPENAI_API_KEY|ANTHROPIC_API_KEY/,
      file,
    );
  }
});
