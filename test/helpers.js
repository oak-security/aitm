import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Engine } from '../src/engine/engine.js';
import { Providers } from '../src/engine/providers.js';
import { startServer } from '../src/api/server.js';

export function fixture(phase, p) {
  const fact = {
    evidence: [
      {
        fileId: p.sources[0].files[0].id,
        startLine: 1,
        endLine: 1,
        quote: 'Vault holds deposits.',
      },
    ],
    assumption: '',
  };
  const item = (id, name) => ({ id, name, description: name, ...fact });
  if (phase === 'ingest')
    return {
      summary: 'Vault system with a signer committee.',
      profile: 'DeFi custody',
      pillars: ['protocols', 'systems', 'organisations'],
      coordinatingActors: true,
      rationale: 'Committee controls releases.',
      candidates: [item('CAND-1', 'Vault')],
      missingEvidence: ['Signer independence is not documented.'],
    };
  if (phase === 'model')
    return {
      overview: 'A vault releases deposits with signer approval.',
      threatActors: [item('ACT-1', 'Compromised signer')],
      roles: [item('ROLE-1', 'Committee')],
      protectedAssets: [item('ASSET-1', 'Deposits')],
      invariants: [item('INV-1', 'Authorized releases only')],
      components: [item('COMP-1', 'Vault')],
      edges: [
        {
          ...item('EDGE-1', 'Release authority'),
          from: 'ROLE-1',
          to: 'COMP-1',
          kind: 'authority',
          boundary: 'Signer to vault',
        },
      ],
      openQuestions: ['Is signer infrastructure independent?'],
    };
  if (phase === 'stride')
    return {
      threats: [
        {
          id: 'TH-1',
          title: 'Unauthorized release',
          category: 'Elevation of privilege',
          scenario: 'Compromised signers authorize a release.',
          targetIds: ['COMP-1', 'EDGE-1'],
          actorIds: ['ACT-1'],
          assetIds: ['ASSET-1'],
          invariantIds: ['INV-1'],
          likelihood: 3,
          impact: 5,
          rationale: 'Deposits can be lost.',
          feasibility: 'Requires quorum access.',
          incentives: 'Value extraction.',
          blastRadius: 'All deposits.',
          timeSensitivity: 'Before launch.',
          confidence: 'medium',
          existingControls: ['Quorum signatures'],
          mitigations: ['Independent signer custody'],
          ...fact,
        },
      ],
      coverage: ['ASSET-1', 'INV-1', 'EDGE-1'].map((objectId) => ({
        objectId,
        threatIds: ['TH-1'],
        explanation: 'Release path considered.',
      })),
      openQuestions: [],
    };
  if (phase === 'trees')
    return {
      trees: [
        {
          threatId: 'TH-1',
          goal: 'Release deposits without authorization',
          nodes: [
            {
              id: 'TREE-1',
              parentId: null,
              label: 'Compromise quorum',
              operator: 'OR',
              prerequisites: ['Signer access'],
              speculative: false,
              mitigations: [],
              ...fact,
            },
            {
              id: 'TREE-2',
              parentId: 'TREE-1',
              label: 'Compromise shared custody',
              operator: 'LEAF',
              prerequisites: ['Shared infrastructure'],
              speculative: true,
              mitigations: ['Separate custody'],
              evidence: [],
              assumption: 'Shared custody is not yet confirmed.',
            },
          ],
        },
      ],
      omitted: [],
    };
  if (phase === 'coordination')
    return {
      scenarios: [
        {
          id: 'CO-1',
          title: 'Committee collusion',
          actorIds: ['ACT-1', 'ROLE-1'],
          assetIds: ['ASSET-1'],
          threshold: 'Quorum',
          incentive: 'Deposit theft',
          sharedDependencies: ['Custody infrastructure'],
          consequence: 'Loss of deposits',
          mitigations: ['Independent signers'],
          ...fact,
        },
      ],
      assumptions: ['Signer independence unknown.'],
      openQuestions: [],
    };
  if (phase === 'report')
    return {
      executiveSummary: 'Review signer independence before launch.',
      roadmap: [
        {
          id: 'REC-1',
          action: 'Separate signer infrastructure.',
          priority: '30 days',
          owner: 'Security lead',
          linkedIds: ['TH-1', 'ASSET-1'],
          verification: 'Test independent compromise boundaries.',
        },
      ],
      residualRisks: ['Signer compromise remains possible.'],
      openQuestions: ['Who operates each signer?'],
      nextSteps: ['Review source inventory and deployment controls.'],
    };
  throw new Error(`Unexpected phase ${phase}`);
}

export class FakeProviders extends Providers {
  constructor(options = {}) {
    super({
      keys: { openai: 'test-openai-private-value', anthropic: 'test-anthropic-private-value' },
    });
    this.calls = [];
    this.options = options;
  }
  async call(input) {
    this.calls.push(input.phase);
    if (this.options.delay)
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, this.options.delay);
        input.signal.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            reject(new Error('Aborted'));
          },
          { once: true },
        );
      });
    input.signal?.throwIfAborted();
    input.onProgress?.({ characters: 100, inputTokens: 20, outputTokens: 30 });
    const data = JSON.parse(input.user);
    const p = { sources: [{ files: data.sources.map((s) => ({ id: s.id })) }] };
    return {
      data:
        this.options.malformed === input.phase ||
        (this.options.malformedOnce === input.phase &&
          this.calls.filter((p) => p === input.phase).length === 1)
          ? {}
          : fixture(input.phase, p),
      usage: { inputTokens: 20, outputTokens: 30 },
      provider: input.provider,
      model: input.model,
    };
  }
}

export async function setup(t, options = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'aitm-test-'));
  const providers = new FakeProviders(options);
  const engine = await Engine.open({ dataDir: dir, providers });
  t.after(async () => {
    await engine.close();
    await rm(dir, { recursive: true, force: true });
  });
  let p = engine.create({
    name: 'Vault assessment',
    scope: 'Assess vault and signer release authority.',
  });
  p = await engine.addSource(p.id, {
    kind: 'text',
    label: 'Architecture',
    text: 'Vault holds deposits.\nA committee authorizes releases.',
  });
  return { engine, p, providers, dir };
}

export async function finish(engine, id, input = { mode: 'draft' }) {
  const run = engine.run(id, input);
  await engine.active.get(id).task;
  return engine.getRun(id, run.id);
}

export async function serve(t, engine) {
  const server = await startServer(engine, { port: 0 });
  t.after(() => server.close());
  const request = async (method, route, body) => {
    const response = await fetch(server.url + route, {
      method,
      ...(body === undefined
        ? {}
        : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
  };
  return { ...server, request };
}
