import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { setup, finish, fixture } from './helpers.js';
import { validateArtifact, resolveEvidence } from '../src/engine/validate.js';
import { markdownReport, pdfReport } from '../src/engine/report.js';
import { Engine } from '../src/engine/engine.js';

test('provider selection resolves model defaults from that provider', async (t) => {
  const { engine } = await setup(t);
  const project = engine.create({ name: 'Anthropic defaults', config: { provider: 'anthropic' } });
  assert.equal(project.config.fastModel, 'claude-sonnet-5');
  assert.equal(project.config.deepModel, 'claude-opus-5');
  const changed = engine.update(project.id, {
    revision: project.revision,
    config: { provider: 'openai' },
  });
  assert.equal(changed.config.fastModel, 'gpt-5.6-terra');
  assert.equal(changed.config.deepModel, 'gpt-5.6-sol');
});

test('complete TRACE draft persists every phase, evidence, usage and a truthful report', async (t) => {
  const { engine, p, providers, dir } = await setup(t);
  const run = await finish(engine, p.id);
  assert.equal(run.status, 'completed', run.error);
  assert.deepEqual(providers.calls, [
    'ingest',
    'model',
    'stride',
    'trees',
    'coordination',
    'report',
  ]);
  const project = engine.get(p.id);
  assert.equal(
    Object.values(project.artifacts).every((a) => a.status === 'draft' && a.review === null),
    true,
  );
  assert.equal(run.usage.inputTokens, 120);
  const markdown = markdownReport(project);
  for (const text of [
    'DRAFT',
    'Protected assets',
    'Critical invariants',
    'Ranked STRIDE',
    'Attack trees',
    'Collusion & coordination',
    'Mitigation roadmap',
    'TH-1',
    '30 days',
  ])
    assert.ok(markdown.includes(text), text);
  const persisted = JSON.parse(await readFile(path.join(dir, `${p.id}.json`), 'utf8'));
  assert.equal(persisted.artifacts.report.data.roadmap[0].linkedIds[0], 'TH-1');
  project.scope += '\nCheck\ttab rendering.';
  const pdf = await pdfReport(project);
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: pdf });
  try {
    const text = (await parser.getText()).text;
    assert.match(text, /Check +tab rendering\./);
    for (const required of [
      'Architecture/notes.txt',
      'REC-1',
      'Security lead',
      '30 days',
      'Status: draft',
      'Name: Deposits',
    ])
      assert.ok(text.includes(required), `PDF must contain table content: ${required}`);
  } finally {
    await parser.destroy();
  }
});

test('review mode enforces every gate, resumes, and records explicit reviewers', async (t) => {
  const { engine, p, providers } = await setup(t);
  for (const phase of ['scope', 'model', 'stride', 'trees', 'coordination', 'report']) {
    const run = await finish(engine, p.id, { mode: 'review' });
    assert.equal(run.status, 'awaiting_review', run.error);
    assert.equal(run.phase, phase);
    const current = engine.get(p.id);
    engine.approve(p.id, phase, {
      revision: current.revision,
      reviewer: 'Test reviewer',
      notes: `Verified ${phase}`,
    });
  }
  assert.equal((await finish(engine, p.id, { mode: 'review' })).status, 'completed');
  assert.equal(providers.calls.length, 6, 'approved phases are reused');
  assert.ok(markdownReport(engine.get(p.id)).includes('**Reviewed**'));
});

test('invalidating a source or model removes dependent artifacts and approvals', async (t) => {
  const { engine, p } = await setup(t);
  await finish(engine, p.id);
  let current = engine.get(p.id),
    model = structuredClone(current.artifacts.model.data);
  model.overview = 'Corrected model overview';
  engine.editArtifact(p.id, 'model', { revision: current.revision, data: model });
  current = engine.get(p.id);
  assert.ok(current.artifacts.ingest);
  assert.equal(current.artifacts.stride, undefined);
  assert.equal(current.artifacts.report, undefined);
  await engine.addSource(
    p.id,
    { kind: 'text', label: 'Updated', text: 'Vault holds deposits.\nUpdated design.' },
    p.sources[0].id,
  );
  assert.deepEqual(Object.keys(engine.get(p.id).artifacts), ['scope']);
});

test('optional phases, individual step dependencies and optimistic edits', async (t) => {
  const { engine, p, providers } = await setup(t);
  assert.throws(() => engine.run(p.id, { phase: 'report', mode: 'draft' }), /Generate/);
  engine.update(p.id, {
    revision: p.revision,
    config: { ...p.config, trees: false, coordination: 'off' },
  });
  assert.throws(() => engine.update(p.id, { revision: p.revision, name: 'Stale' }), /changed/);
  assert.equal((await finish(engine, p.id)).status, 'completed');
  assert.deepEqual(providers.calls, ['ingest', 'model', 'stride', 'report']);
  const report = markdownReport(engine.get(p.id));
  assert.ok(!report.includes('## Attack trees'));
  assert.ok(!report.includes('## Collusion'));
});

test('cancellation retains completed artifacts and prevents concurrent mutations', async (t) => {
  const { engine, p } = await setup(t, { delay: 200 });
  const run = engine.run(p.id, { mode: 'draft' });
  assert.throws(() => engine.run(p.id), /progress/);
  assert.throws(() => engine.update(p.id, { revision: p.revision, name: 'Race' }), /progress/);
  const cancelled = await engine.cancel(p.id, run.id);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(engine.get(p.id).artifacts.report, undefined);
  assert.equal((await finish(engine, p.id)).status, 'completed');
});

test('malformed provider output is rejected without publishing an artifact', async (t) => {
  const { engine, p } = await setup(t, { malformed: 'model' });
  const run = await finish(engine, p.id);
  assert.equal(run.status, 'failed');
  assert.ok(run.error.includes('overview'));
  assert.ok(engine.get(p.id).artifacts.ingest);
  assert.equal(engine.get(p.id).artifacts.model, undefined);
});

test('one bounded repair can correct invalid output; usage includes the rejected attempt', async (t) => {
  const { engine, p, providers } = await setup(t, { malformedOnce: 'model' });
  const run = await finish(engine, p.id);
  assert.equal(run.status, 'completed', run.error);
  assert.equal(providers.calls.filter((p) => p === 'model').length, 2);
  assert.equal(run.usage.inputTokens, 140);
  assert.equal(engine.get(p.id).artifacts.model.generation.attempts, 2);
  assert.ok(run.events.some((e) => e.type === 'validation_retry'));
});

test('semantic validation rejects invented evidence, wrong links, incomplete coverage and cyclic trees', async (t) => {
  const { engine, p } = await setup(t);
  await finish(engine, p.id);
  const current = engine.get(p.id);
  let data = fixture('model', current);
  data.components[0].evidence = [{ ...data.components[0].evidence[0], quote: 'Invented quote' }];
  data.protectedAssets[0].evidence = [
    { ...data.protectedAssets[0].evidence[0], quote: 'Another invented quote' },
  ];
  assert.throws(
    () => validateArtifact('model', data, current),
    (error) => {
      assert.match(error.message, /2 evidence error/);
      assert.match(error.message, /model.components.0.evidence\[0\]/);
      assert.match(error.message, /model.protectedAssets.0.evidence\[0\]/);
      assert.match(error.message, /Cited text begins/);
      return true;
    },
  );
  data = fixture('stride', current);
  data.threats[0].assetIds = ['missing'];
  assert.throws(() => validateArtifact('stride', data, current), /Unknown asset/);
  data = fixture('stride', current);
  data.coverage.pop();
  assert.throws(() => validateArtifact('stride', data, current), /Missing coverage/);
  data = fixture('trees', current);
  data.trees[0].nodes[0].operator = 'LEAF';
  data.trees[0].nodes[0].mitigations = ['Separate custody'];
  data.trees[0].nodes[1].parentId = 'TREE-2';
  assert.throws(() => validateArtifact('trees', data, current), /cycle/);
  data = fixture('report', current);
  data.roadmap[0].linkedIds = ['UNKNOWN'];
  assert.throws(() => validateArtifact('report', data, current), /roadmap/);
});

test('unique exact quotes resolve mistaken lines without accepting invented or ambiguous evidence', async (t) => {
  const { engine, p, providers } = await setup(t);
  const call = providers.call.bind(providers);
  providers.call = async (input) => {
    const result = await call(input);
    if (input.phase === 'model')
      result.data.components[0].evidence = [
        { ...result.data.components[0].evidence[0], startLine: 99, endLine: 99 },
      ];
    return result;
  };
  const run = await finish(engine, p.id);
  assert.equal(run.status, 'completed', run.error);
  const project = engine.get(p.id);
  assert.equal(project.artifacts.model.data.components[0].evidence[0].startLine, 1);
  assert.deepEqual(project.artifacts.model.generation.evidenceCorrections[0].from, [99, 99]);
  assert.deepEqual(project.artifacts.model.generation.evidenceCorrections[0].to, [1, 1]);
  assert.equal(project.artifacts.model.generation.attempts, 1);
  for (const quote of ['Invented quote', 'deposits']) {
    const candidate = fixture('model', project);
    const ref = { ...candidate.components[0].evidence[0], quote, startLine: 99, endLine: 99 };
    candidate.components[0].evidence = [ref];
    const duplicateSource = structuredClone(project);
    duplicateSource.sources[0].files[0].text += '\nMore deposits here.';
    duplicateSource.sources[0].files[0].lines++;
    const resolved = resolveEvidence('model', candidate, duplicateSource);
    assert.equal(resolved.corrections.length, 0);
    assert.throws(() => validateArtifact('model', resolved.data, duplicateSource), /line range/);
  }
});

test('generated coverage derives from threat references and exposes unaddressed objects honestly', async (t) => {
  const { engine, p, providers } = await setup(t);
  const call = providers.call.bind(providers);
  providers.call = async (input) => {
    const result = await call(input);
    if (input.phase === 'model')
      result.data.protectedAssets.push({
        ...result.data.protectedAssets[0],
        id: 'ASSET-unaddressed',
        name: 'Unaddressed asset',
      });
    if (input.phase === 'stride') result.data.coverage[0].threatIds = ['invented-coverage-link'];
    return result;
  };
  const run = await finish(engine, p.id);
  assert.equal(run.status, 'completed', run.error);
  const project = engine.get(p.id),
    artifact = project.artifacts.stride;
  assert.ok(artifact.generation.coverageCorrections.length >= 2);
  assert.deepEqual(artifact.data.coverage[0].threatIds, ['TH-1']);
  const gap = artifact.data.coverage.find((row) => row.objectId === 'ASSET-unaddressed');
  assert.deepEqual(gap.threatIds, []);
  assert.match(gap.explanation, /coverage gap/);
  assert.ok(artifact.data.openQuestions.some((q) => q.includes('ASSET-unaddressed')));
  assert.match(markdownReport(project), /coverage gap/);
});

test('portable export/import validates artifacts and resets human approvals', async (t) => {
  const { engine, p } = await setup(t);
  await finish(engine, p.id);
  const imported = engine.import(engine.export(p.id));
  assert.notEqual(imported.id, p.id);
  assert.equal(imported.sources[0].kind, 'files');
  assert.equal(imported.artifacts.report.status, 'draft');
  assert.equal(imported.runs.length, 0);
  const bad = engine.export(p.id);
  bad.project.artifacts.report.data.roadmap[0].linkedIds = ['fake'];
  assert.throws(() => engine.import(bad), /roadmap/);
  assert.equal(engine.list().length, 2, 'invalid import must not create a project');
});

test('one writer owns the store and crashed jobs become interrupted', async (t) => {
  const { engine, p, dir, providers } = await setup(t);
  await assert.rejects(Engine.open({ dataDir: dir, providers }), /Another AiTM/);
  const current = engine.get(p.id);
  current.runs.push({ id: 'crash', status: 'running', phase: 'model', lastEventId: 0, events: [] });
  engine.save(current);
  await engine.store.release();
  engine.store.release = async () => {};
  const recovered = await Engine.open({ dataDir: dir, providers });
  assert.equal(recovered.get(p.id).runs[0].status, 'interrupted');
  await recovered.close();
});
