import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { setup, serve, finish } from './helpers.js';
import { ingest } from '../src/engine/ingest.js';
import { zipFixture } from './zip-fixture.js';

const snapshot = (name, content) => ({
  kind: 'files',
  label: name,
  files: [{ path: name, content: content.toString('base64'), encoding: 'base64' }],
});
const repo = () =>
  zipFixture([
    {
      path: 'repo-main/README.md',
      content: 'Vault holds deposits.\nAll source content stays intact.',
    },
    { path: 'repo-main/src/vault.sol', content: 'contract Vault {}' },
    { path: 'repo-main/.gitignore', content: 'generated/\n' },
    { path: 'repo-main/generated/ignored.txt', content: 'Do not include' },
    { path: 'repo-main/.env', content: 'PRIVATE=value' },
    { path: 'repo-main/node_modules/dependency.js', content: 'ignored' },
    { path: 'repo-main/linked.txt', content: '../../elsewhere', mode: 0o120777 },
  ]);
test('ZIP sources preserve repository content and honor ignores without extracting symlinks or credentials', async (t) => {
  const { dir } = await setup(t);
  const before = (await readdir(os.tmpdir())).filter((n) => n.startsWith('aitm-zip-')).sort();
  const source = await ingest(snapshot('repository.zip', repo()));
  assert.ok(source.files.some((f) => f.path === 'repo-main/src/vault.sol'));
  assert.ok(source.files.some((f) => f.text.endsWith('All source content stays intact.')));
  assert.ok(source.warnings.some((w) => w.includes('symlink skipped')));
  assert.ok(!source.files.some((f) => /generated|node_modules|\.env|linked/.test(f.path)));
  const file = path.join(dir, 'repository.zip');
  await writeFile(file, repo());
  const local = await ingest({ kind: 'local', path: file });
  assert.deepEqual(
    local.files.map((f) => [f.path, f.text]),
    source.files.map((f) => [f.path, f.text]),
  );
  assert.deepEqual(
    (await readdir(os.tmpdir())).filter((n) => n.startsWith('aitm-zip-')).sort(),
    before,
  );
});
test('ZIP imports reject traversal, ambiguous paths, encrypted entries and expansion bombs atomically', async (t) => {
  const { engine, p } = await setup(t);
  await finish(engine, p.id, { mode: 'full' });
  const before = engine.get(p.id);
  const bad = [
    [{ path: '../escape.txt', content: 'bad' }],
    [{ path: '/absolute.txt', content: 'bad' }],
    [{ path: 'a\\b.txt', content: 'bad' }],
    [
      { path: 'A.txt', content: 'a' },
      { path: 'a.txt', content: 'b' },
    ],
    [{ path: 'encrypted.txt', content: 'a', flags: 1 }],
    [{ path: 'bomb.txt', content: 'a', size: 33 * 1024 * 1024 }],
    [{ path: 'mismatch.txt', content: 'expanded content', size: 1 }],
    [{ path: 'device', mode: 0o020600 }],
  ];
  for (const entries of bad) {
    await assert.rejects(
      engine.addSources(p.id, [
        { kind: 'text', label: 'Would be added', text: 'extra' },
        snapshot('bad.zip', zipFixture(entries)),
      ]),
    );
    assert.deepEqual(engine.get(p.id), before);
    assert.equal(engine.active.size, 0);
  }
  await assert.rejects(ingest(snapshot('broken.zip', Buffer.from('not a zip'))), /ZIP/);
});
test('batch imports add documents and ZIPs to one project, preserve other projects and allow targeted replacement', async (t) => {
  const { engine, p } = await setup(t),
    { request } = await serve(t, engine);
  const second = engine.create({ name: 'Separate project', scope: 'Separate scope' });
  const docx = await readFile(new URL('./fixtures/architecture.docx', import.meta.url));
  const response = await request('POST', `/v1/projects/${p.id}/sources/import`, {
    sources: [snapshot('design.docx', docx), snapshot('repo.zip', repo())],
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.sources.length, 3);
  assert.equal(response.body.sources[0].id, p.sources[0].id);
  assert.equal(engine.get(second.id).sources.length, 0);
  const firstTwo = response.body.sources.slice(0, 2);
  const replace = await request(
    'PUT',
    `/v1/projects/${p.id}/sources/${response.body.sources[2].id}`,
    { kind: 'text', label: 'Revised repo', text: 'New code source' },
  );
  assert.equal(replace.status, 200);
  assert.deepEqual(replace.body.sources.slice(0, 2), firstTwo);
  const portable = engine.import(engine.export(p.id));
  assert.equal(portable.sources.length, 3);
  assert.notEqual(portable.id, p.id);
  const run = await finish(engine, p.id, { mode: 'full' });
  assert.equal(run.status, 'completed');
  assert.equal(
    engine.get(p.id).artifacts.model.generation.sourceCoverage.files,
    engine.get(p.id).sources.flatMap((s) => s.files).length,
  );
});
test('empty source input never reads the server working directory', async (t) => {
  const { engine, p } = await setup(t),
    { request } = await serve(t, engine);
  const before = engine.get(p.id);
  for (const body of [{}, { source: '' }, { source: ' ' }])
    assert.equal((await request('POST', '/v1/projects/open', body)).status, 422);
  for (const sources of [[], [''], [' ']])
    assert.equal(
      (await request('POST', `/v1/projects/${p.id}/sources/import`, { sources })).status,
      422,
    );
  assert.deepEqual(engine.get(p.id), before);
  assert.equal(engine.list().length, 1);
});
