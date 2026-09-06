import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { render } from 'ink-testing-library';
import { setup, finish, serve } from './helpers.js';
import { App } from '../src/tui/app.js';
import { topbar, progress } from '../src/web/views.js';

test('later classification batches keep earlier candidates without failing or retrying omissions', async (t) => {
  const { engine, p, providers } = await setup(t);
  await engine.addSource(
    p.id,
    {
      kind: 'text',
      label: 'Whole document',
      text: 'Vault holds deposits.\n' + 'Release rules.\n'.repeat(18000),
    },
    p.sources[0].id,
  );
  const original = providers.call.bind(providers);
  providers.call = async (input) => {
    const context = JSON.parse(input.user);
    const result = await original(input);
    if (context.previousDraft) result.data = structuredClone(context.previousDraft);
    if (input.phase === 'ingest' && context.batch.number > 1) result.data.candidates = [];
    if (input.phase === 'model' && context.batch.number > 1) {
      result.data.roles = [];
      result.data.components[0].description = 'Updated vault description.';
    }
    if (input.phase === 'trees' && context.batch.number > 1) result.data.trees[0].nodes.pop();
    return result;
  };
  const run = await finish(engine, p.id, { mode: 'full' });
  assert.equal(run.status, 'completed', run.error);
  assert.equal(engine.get(p.id).artifacts.ingest.data.candidates[0].id, 'CAND-1');
  assert.ok(!run.events.some((e) => e.type === 'validation_retry'));
  const artifacts = engine.get(p.id).artifacts;
  assert.equal(artifacts.model.data.roles[0].id, 'ROLE-1');
  assert.equal(artifacts.model.data.components[0].description, 'Updated vault description.');
  assert.equal(artifacts.trees.data.trees[0].nodes.length, 2);
});

test('approval accepts no reviewer name and still enforces revision and review gates', async (t) => {
  const { engine, p } = await setup(t),
    { request } = await serve(t, engine);
  const result = await request('POST', `/v1/projects/${p.id}/artifacts/scope/approve`, {
    revision: p.revision,
  });
  assert.equal(result.status, 200);
  assert.equal(engine.get(p.id).artifacts.scope.status, 'approved');
  assert.ok(!engine.get(p.id).artifacts.scope.review.reviewer);
  assert.equal(
    (
      await request('POST', `/v1/projects/${p.id}/artifacts/scope/approve`, {
        revision: p.revision,
      })
    ).status,
    409,
  );
});

test('web exposes full pipeline outside Overview and preserves source batch progress during streaming', async (t) => {
  const { engine, p } = await setup(t);
  const s = {
    project: engine.get(p.id),
    phases: [{ id: 'scope' }, { id: 'ingest' }],
    view: 'scope',
  };
  assert.match(topbar(s), /data-action="run-full"/);
  s.project.runs = [
    {
      id: 'run',
      phase: 'ingest',
      status: 'running',
      startedAt: new Date().toISOString(),
      usage: { inputTokens: 0, outputTokens: 0 },
      events: [
        {
          type: 'request',
          phase: 'ingest',
          batch: 3,
          batches: 7,
          provider: 'openai',
          model: 'test-model',
          at: new Date().toISOString(),
        },
        {
          type: 'progress',
          phase: 'ingest',
          characters: 5529,
          message: 'Receiving classification',
          at: new Date().toISOString(),
        },
      ],
    },
  ];
  assert.match(progress(s), /3\/7/);
  assert.match(progress(s), /test-model/);
});

test('reopening completed TUI assessment leaves the menu visible and report opt-in', async (t) => {
  const { engine, p } = await setup(t);
  await finish(engine, p.id, { mode: 'full' });
  const ui = render(React.createElement(App, { engine, projectId: p.id }));
  t.after(() => ui.unmount());
  await new Promise((r) => setTimeout(r, 100));
  assert.match(ui.lastFrame(), /Scope & source inventory/);
  assert.doesNotMatch(ui.lastFrame(), /Markdown report ·/);
  ui.stdin.write('v');
  await new Promise((r) => setTimeout(r, 100));
  assert.match(ui.lastFrame(), /Markdown report ·/);
  assert.match(ui.lastFrame(), /f Run full pipeline/);
});
