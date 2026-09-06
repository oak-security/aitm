import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { startApplication, openAssessment } from '../src/application.js';
import { sourceInput } from '../src/source-input.js';
import { Engine } from '../src/engine/engine.js';
import { ApiClient } from '../src/client.js';
import { FakeProviders, finish } from './helpers.js';

async function workspace(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'aitm-application-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const source = path.join(dir, 'Vault architecture');
  await mkdir(source);
  await writeFile(path.join(source, 'spec.md'), 'Vault holds deposits.');
  return { dir, source, dataDir: path.join(dir, 'data') };
}

test('one application shares its engine with the API, closes cleanly, and reopens the same assessment', async (t) => {
  const { source, dataDir } = await workspace(t);
  const providers = new FakeProviders();
  const app = await startApplication({ dataDir, providers, port: 0 });
  t.after(() => app.close());
  const client = new ApiClient(app.url);
  assert.equal((await client.get('/v1/health')).pid, process.pid);
  const opened = await openAssessment(app.engine, sourceInput('.', source));
  assert.equal(opened.reused, false);
  assert.equal(opened.project.sources[0].locator, await realpath(source));
  assert.equal(opened.project.name, 'Vault architecture');
  const run = await finish(app.engine, opened.project.id, { mode: 'full' });
  assert.equal(run.status, 'completed');
  const saved = await client.get(client.projectPath(opened.project.id));
  assert.ok(saved.artifacts.report);
  await Promise.all([app.close(), app.close()]);
  await assert.rejects(client.get('/v1/health'), /Cannot reach/);

  const reopened = await startApplication({ dataDir, providers, port: 0 });
  t.after(() => reopened.close());
  const again = await openAssessment(reopened.engine, sourceInput(source + '/'));
  assert.equal(again.reused, true);
  assert.equal(again.project.id, saved.id);
  assert.deepEqual(again.project.artifacts, saved.artifacts);
  assert.equal(reopened.engine.list().length, 1);
  const calls = providers.calls.length;
  await finish(reopened.engine, saved.id, { mode: 'full' });
  assert.equal(
    providers.calls.length,
    calls,
    'reopening and resuming does not repeat completed AI calls',
  );
});

test('closing an active application cancels only unfinished work and resumes sequentially on reopen', async (t) => {
  const { source, dataDir } = await workspace(t);
  const providers = new FakeProviders();
  const app = await startApplication({ dataDir, providers, port: 0 });
  t.after(() => app.close());
  const { project } = await openAssessment(app.engine, sourceInput(source));
  await finish(app.engine, project.id, { mode: 'draft', phase: 'ingest' });
  const completed = app.engine.get(project.id).artifacts.ingest;
  providers.options.delay = 10000;
  const requested = new Promise((resolve) =>
    app.engine.events.on('change', (id) => {
      if (
        app.engine
          .get(id)
          .runs.at(-1)
          ?.events.some((e) => e.type === 'request' && e.phase === 'model')
      )
        resolve();
    }),
  );
  const run = app.engine.run(project.id, { mode: 'full' });
  await requested;
  await app.close();
  providers.options.delay = 0;
  const reopened = await startApplication({ dataDir, providers, port: 0 });
  t.after(() => reopened.close());
  const { project: saved } = await openAssessment(reopened.engine, sourceInput(source));
  assert.equal(saved.runs.find((r) => r.id === run.id).status, 'cancelled');
  assert.deepEqual(saved.artifacts.ingest, completed);
  assert.equal(saved.artifacts.model, undefined);
  assert.equal((await finish(reopened.engine, saved.id, { mode: 'full' })).status, 'completed');
  assert.equal(providers.calls.filter((p) => p === 'ingest').length, 1);
});

test('invalid intake leaves no empty assessment and API startup failure releases the engine lock', async (t) => {
  const { dir, dataDir } = await workspace(t);
  const app = await startApplication({ dataDir, providers: new FakeProviders(), port: 0 });
  t.after(() => app.close());
  const empty = path.join(dir, 'empty');
  await mkdir(empty);
  await assert.rejects(openAssessment(app.engine, sourceInput(empty)), /No readable/);
  await assert.rejects(
    openAssessment(app.engine, sourceInput(path.join(dir, 'missing'))),
    /ENOENT/,
  );
  assert.equal(app.engine.list().length, 0);
  const otherDir = path.join(dir, 'other');
  await assert.rejects(
    startApplication({ dataDir: otherDir, port: Number(new URL(app.url).port) }),
    /EADDRINUSE/,
  );
  const engine = await Engine.open({ dataDir: otherDir });
  await engine.close();
});
