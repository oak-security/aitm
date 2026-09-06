import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Engine } from '../../src/engine/engine.js';
import { startServer } from '../../src/api/server.js';
import { FakeProviders } from '../helpers.js';

export class BrowserProviders extends FakeProviders {
  constructor(options = {}) {
    super({ delay: 120, ...options });
  }
  async models(provider) {
    return {
      source: 'account',
      notice: '',
      models: [
        ...new Set([
          this.status()[provider].fastModel,
          this.status()[provider].deepModel,
          provider === 'openai' ? 'gpt-5-test' : 'claude-test',
        ]),
      ].map((id) => ({ id })),
    };
  }
  async test(provider, model) {
    return { provider, model, configured: true };
  }
  async call(input) {
    const result = await super.call(input);
    if (input.phase === 'stride') {
      const base = result.data.threats[0];
      result.data.threats = [
        base,
        {
          ...structuredClone(base),
          id: 'TH-2',
          title: 'Compromised release process',
          likelihood: 2,
        },
        {
          ...structuredClone(base),
          id: 'TH-3',
          title: 'Loss of signer availability',
          category: 'Denial of service',
          likelihood: 1,
        },
      ];
    }
    if (input.phase === 'trees') {
      const base = result.data.trees[0];
      result.data.trees = [1, 2, 3].map((n) => ({
        ...structuredClone(base),
        threatId: `TH-${n}`,
        nodes: base.nodes.map((node) => ({
          ...structuredClone(node),
          id: `${node.id}-${n}`,
          parentId: node.parentId ? `${node.parentId}-${n}` : null,
        })),
      }));
    }
    return result;
  }
}
export async function browserServer() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'aitm-browser-'));
  const providers = new BrowserProviders();
  const engine = await Engine.open({ dataDir: dir, providers });
  const api = await startServer(engine, { port: 0 });
  return {
    ...api,
    engine,
    providers,
    dir,
    async close() {
      await engine.close();
      await api.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
if (process.argv.includes('--manual')) {
  const server = await browserServer();
  console.log(server.url);
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, async () => {
      await server.close();
      process.exit(0);
    });
}
