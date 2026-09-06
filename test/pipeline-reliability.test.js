import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, finish } from './helpers.js';
import { sourceBatches } from '../src/engine/ingest.js';
import { markdownReport } from '../src/engine/report.js';
import { jsonSchema } from '../src/engine/schema.js';

test('full pipeline resolves a classification invariant ID against the canonical model without regenerating STRIDE', async (t) => {
  const { engine, p, providers } = await setup(t);
  const call = providers.call.bind(providers);
  providers.call = async (input) => {
    const result = await call(input);
    if (input.phase === 'ingest')
      result.data.candidates.push({
        ...result.data.candidates[0],
        id: 'invariant-oracle-observation-integrity',
        name: 'Oracle observation integrity',
        description: 'Oracle observations must remain authentic.',
      });
    if (input.phase === 'model') {
      result.data.invariants[0].name = 'Oracle observation integrity';
      result.data.invariants[0].description = 'Oracle observations must remain authentic.';
    }
    if (input.phase === 'stride') {
      result.data.threats[0].invariantIds = ['invariant-oracle-observation-integrity'];
      result.data.coverage[1].objectId = 'invariant-oracle-observation-integrity';
    }
    return result;
  };
  const run = await finish(engine, p.id, { mode: 'full' });
  assert.equal(run.status, 'completed', run.error);
  assert.deepEqual(engine.get(p.id).artifacts.stride.data.threats[0].invariantIds, ['INV-1']);
  assert.equal(providers.calls.filter((phase) => phase === 'stride').length, 1);
});

test('an unresolved optional invariant link preserves the threat and records uncertainty without inventing a model object', async (t) => {
  const { engine, p, providers } = await setup(t);
  const call = providers.call.bind(providers);
  providers.call = async (input) => {
    const result = await call(input);
    if (input.phase === 'stride') {
      result.data.threats[0].invariantIds = ['invariant-oracle-observation-integrity'];
      result.data.coverage[1].objectId = 'invariant-oracle-observation-integrity';
    }
    return result;
  };
  const run = await finish(engine, p.id, { mode: 'full' });
  assert.equal(run.status, 'completed', run.error);
  const current = engine.get(p.id);
  const threat = current.artifacts.stride.data.threats[0];
  assert.deepEqual(threat.invariantIds, []);
  assert.deepEqual(threat.assetIds, ['ASSET-1']);
  assert.match(threat.assumption, /Reference review required/);
  assert.equal(threat.confidence, 'low');
  assert.deepEqual(
    current.artifacts.model.data.invariants.map((i) => i.id),
    ['INV-1'],
  );
  assert.equal(current.artifacts.stride.reviewNotes.length, 1);
  assert.ok(run.events.some((e) => e.type === 'reference_review'));
  assert.equal(providers.calls.filter((phase) => phase === 'stride').length, 1);
  assert.match(markdownReport(current), /Reference review required/);
  assert.equal(engine.import(engine.export(p.id)).artifacts.stride.reviewNotes.length, 1);
});

test('full TRACE reads every source batch once and constrains downstream references to the saved model', async (t) => {
  const { engine, p, providers } = await setup(t);
  const text =
    'Vault holds deposits.\n' + 'Documented release control.\n'.repeat(15000) + 'FINAL SOURCE RULE';
  await engine.addSource(
    p.id,
    { kind: 'text', label: 'Complete specification', text },
    p.sources[0].id,
  );
  const batches = sourceBatches(engine.get(p.id));
  const call = providers.call.bind(providers);
  let sourceCharacters = 0;
  const phases = [];
  providers.call = async (input) => {
    const context = JSON.parse(input.user);
    phases.push(input.phase);
    if (input.phase === 'model') {
      sourceCharacters += context.sources.reduce((n, f) => n + f.text.length, 0);
      assert.ok(context.sources.every((f) => typeof f.text === 'string'));
      const wire = jsonSchema(input.schema);
      for (const field of ['protectedAssets', 'invariants', 'components']) {
        assert.equal(input.schema.shape[field].safeParse([]).success, true);
        assert.ok(!wire.properties[field].minItems);
      }
    } else assert.ok(context.sources.every((f) => f.text === undefined));
    const result = await call(input);
    if (input.phase === 'ingest') {
      result.data.candidates = [];
      result.data.coordinatingActors = false;
    }
    if (input.phase === 'model' && context.batch.number > 1) {
      for (const field of ['threatActors', 'roles', 'protectedAssets', 'components', 'edges'])
        result.data[field] = [];
      assert.equal(input.schema.safeParse(result.data).success, true);
    }
    if (
      input.phase === 'model' &&
      context.sources.some((f) => f.text.includes('FINAL SOURCE RULE'))
    )
      result.data.invariants[0].description = 'FINAL SOURCE RULE was included.';
    if (input.phase === 'stride') {
      assert.deepEqual(Object.keys(context.artifacts), ['model']);
      const valid = { ...result.data, coverage: [] };
      assert.equal(input.schema.safeParse(valid).success, true);
      const invalid = structuredClone(valid);
      invalid.threats[0].invariantIds = ['classification-id-not-in-model'];
      assert.equal(input.schema.safeParse(invalid).success, false);
    }
    return result;
  };
  const run = await finish(engine, p.id, { mode: 'full' });
  assert.equal(run.status, 'completed', run.error);
  assert.deepEqual(phases, [
    'ingest',
    ...batches.map(() => 'model'),
    'stride',
    'trees',
    'coordination',
    'report',
  ]);
  assert.equal(
    sourceCharacters,
    batches.flat().reduce((n, f) => n + f.text.length, 0),
  );
  assert.match(
    engine.get(p.id).artifacts.model.data.invariants[0].description,
    /FINAL SOURCE RULE/,
  );
  assert.equal(engine.get(p.id).artifacts.model.generation.sourceCoverage.characters, text.length);
  assert.equal(engine.get(p.id).artifacts.stride.generation.sourceCoverage.fromArtifacts, true);
});
