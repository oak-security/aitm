import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setup, finish } from './helpers.js';
import { sourceBatches } from '../src/engine/ingest.js';
import { markdownReport } from '../src/engine/report.js';

const longDocument =
  'Vault holds deposits.\n' +
  'Security requirements apply to every release.\n'.repeat(5000) +
  'FINAL RULE: never release funds without a quorum.';

test('large documents are analysed sequentially in full, with accumulated drafts and no partial publication', async (t) => {
  const { engine, p, providers } = await setup(t);
  await engine.addSource(
    p.id,
    { kind: 'text', label: 'Whole whitepaper', text: longDocument },
    p.sources[0].id,
  );
  const batches = sourceBatches(engine.get(p.id));
  assert.ok(batches.length > 1);
  const seen = [];
  const call = providers.call.bind(providers);
  providers.call = async (input) => {
    const context = JSON.parse(input.user);
    seen.push({
      phase: input.phase,
      batch: context.batch.number,
      text: context.sources.map((f) => f.text).join('\n'),
    });
    if (input.phase !== 'report') {
      assert.equal(
        engine.get(p.id).artifacts[input.phase],
        undefined,
        'a phase is published only after its last batch',
      );
      assert.equal(Boolean(context.previousDraft), context.batch.number > 1);
    } else
      assert.ok(
        context.sources.every((f) => f.text === undefined),
        'report synthesis uses completed artifacts',
      );
    const result = await call(input);
    if (context.previousDraft) result.data = structuredClone(context.previousDraft);
    if (input.phase === 'model' && context.sources.some((f) => f.text?.includes('FINAL RULE')))
      result.data.invariants[0].description = 'Never release funds without a quorum.';
    return result;
  };
  const run = await finish(engine, p.id, { mode: 'full' });
  assert.equal(run.status, 'completed', run.error);
  const phases = ['ingest', 'model', 'stride', 'trees', 'coordination'];
  assert.deepEqual(
    seen.map((call) => call.phase),
    [...phases.flatMap((phase) => batches.map(() => phase)), 'report'],
  );
  for (const phase of phases) {
    const coverage = engine.get(p.id).artifacts[phase].generation.sourceCoverage;
    assert.deepEqual(coverage, {
      complete: true,
      files: 1,
      characters: longDocument.length,
      batches: batches.length,
    });
    assert.ok(
      seen
        .filter((c) => c.phase === phase)
        .at(-1)
        .text.includes('FINAL RULE'),
    );
  }
  assert.match(engine.get(p.id).artifacts.model.data.invariants[0].description, /quorum/);
  assert.ok(run.events.some((e) => e.type === 'request' && e.batch === 2));
});

test('cancelling a later source batch leaves earlier phases saved and never publishes partial analysis', async (t) => {
  const { engine, p, providers } = await setup(t);
  await engine.addSource(
    p.id,
    { kind: 'text', label: 'Whole whitepaper', text: longDocument },
    p.sources[0].id,
  );
  const call = providers.call.bind(providers);
  let reached;
  const second = new Promise((resolve) => {
    reached = resolve;
  });
  providers.call = async (input) => {
    const context = JSON.parse(input.user);
    if (input.phase === 'model' && context.batch.number === 2) {
      reached();
      await new Promise((resolve, reject) =>
        input.signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true }),
      );
    }
    return call(input);
  };
  const run = engine.run(p.id, { mode: 'full' });
  await second;
  await engine.cancel(p.id, run.id);
  assert.equal(engine.getRun(p.id, run.id).status, 'cancelled');
  assert.ok(engine.get(p.id).artifacts.ingest);
  assert.equal(engine.get(p.id).artifacts.model, undefined);
});

test('legacy truncated snapshots are refreshed and invalidate old analysis even when the file hash is unchanged', async (t) => {
  const { engine, p, dir, providers } = await setup(t);
  const file = path.join(dir, 'whitepaper.md');
  const complete = 'Vault holds deposits.\n' + 'a'.repeat(34840) + '\nFINAL RULE';
  await writeFile(file, complete);
  await engine.addSource(p.id, { kind: 'local', path: file }, p.sources[0].id);
  await finish(engine, p.id, { mode: 'full' });
  const old = engine.get(p.id);
  const originalHash = old.sources[0].hash;
  old.sources[0].files[0].text = complete.slice(0, 30000);
  old.sources[0].files[0].lines = old.sources[0].files[0].text.split('\n').length;
  old.sources[0].warnings = ['whitepaper.md: excerpt truncated (30000/34872 characters).'];
  engine.save(old);
  assert.match(markdownReport(engine.get(p.id)), /saved analysis used incomplete source text/);
  assert.throws(
    () => engine.run(p.id, { mode: 'draft', phase: 'model' }),
    /Run the full pipeline.*rebuild prerequisites/,
  );
  const calls = providers.calls.length;
  const run = await finish(engine, p.id, { mode: 'full' });
  assert.equal(run.status, 'completed', run.error);
  const refreshed = engine.get(p.id);
  assert.equal(refreshed.sources[0].hash, originalHash);
  assert.equal(refreshed.sources[0].files[0].text, complete);
  assert.equal(providers.calls.length - calls, 6, 'all dependent phases were regenerated');
  assert.ok(run.events.some((e) => e.type === 'source_refresh'));
  const report = markdownReport(refreshed);
  assert.doesNotMatch(report, /Source limitations|incomplete source text|Stefan Beyer|Dr\. Stefan/);
  assert.match(report, /Generated by AiTM using AI/);
  assert.match(report, /not authored, reviewed or endorsed by Oak Security/);
});

test('old analyses made from prompt excerpts are rebuilt even when stored files were complete', async (t) => {
  const { engine, p, providers } = await setup(t);
  await engine.addSource(p.id, {
    kind: 'files',
    label: 'Implementation',
    files: [{ path: 'vault.sol', content: '// Authorization checks\n'.repeat(1200) }],
  });
  await finish(engine, p.id, { mode: 'full' });
  const old = engine.get(p.id);
  for (const artifact of Object.values(old.artifacts)) delete artifact.generation;
  engine.save(old);
  assert.match(markdownReport(old), /saved analysis used incomplete source text/);
  const calls = providers.calls.length;
  const run = await finish(engine, p.id, { mode: 'full' });
  assert.equal(run.status, 'completed', run.error);
  assert.equal(providers.calls.length - calls, 6);
  assert.doesNotMatch(markdownReport(engine.get(p.id)), /incomplete source text/);
});

test('a later batch retains earlier findings without a provider retry', async (t) => {
  const { engine, p, providers } = await setup(t);
  await engine.addSource(
    p.id,
    { kind: 'text', label: 'Whitepaper', text: longDocument },
    p.sources[0].id,
  );
  const call = providers.call.bind(providers);
  let retry = false;
  providers.call = async (input) => {
    const context = JSON.parse(input.user);
    const result = await call(input);
    if (input.phase === 'ingest' && context.batch.number === 2) {
      if (!context.correction) result.data.candidates = [];
      else {
        assert.match(context.correction.validationError, /Retain previousDraft.candidates CAND-1/);
        assert.equal(context.previousDraft.candidates[0].id, 'CAND-1');
        retry = true;
      }
    }
    return result;
  };
  const run = await finish(engine, p.id, { mode: 'full' });
  assert.equal(run.status, 'completed', run.error);
  assert.equal(retry, false);
  assert.ok(
    engine
      .get(p.id)
      .artifacts.ingest.generation.retainedFindings.includes('previousDraft.candidates.CAND-1'),
  );
  assert.equal(engine.get(p.id).artifacts.ingest.data.candidates[0].id, 'CAND-1');
});
