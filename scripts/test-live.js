import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { loadConfig } from '../src/config.js';
import { Engine } from '../src/engine/engine.js';
import { Providers } from '../src/engine/providers.js';
import { DEFAULT_MODELS } from '../src/engine/schema.js';
import { startServer } from '../src/api/server.js';
import { ApiClient } from '../src/client.js';

// This intentionally exercises the public API and real provider adapters. It never
// substitutes mock results when credentials are missing or a provider declines.
async function main() {
  const config = loadConfig();
  const selected = process.env.AITM_LIVE_PROVIDER
    ? [process.env.AITM_LIVE_PROVIDER]
    : ['openai', 'anthropic'];
  if (selected.some((p) => !DEFAULT_MODELS[p]))
    throw new Error('AITM_LIVE_PROVIDER must be openai or anthropic.');
  if (selected.some((p) => !config.keys[p]))
    throw new Error(
      'Live test requires both provider keys (or select one with AITM_LIVE_PROVIDER). Run aitm configure first.',
    );
  const directory = process.env.AITM_LIVE_DIR
    ? path.resolve(process.env.AITM_LIVE_DIR)
    : path.resolve('artifacts', `live-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const providers = new Providers(config);
  const engine = await Engine.open({ dataDir: path.join(directory, 'data'), providers });
  const server = await startServer(engine, { port: 0 });
  const client = new ApiClient(server.url);
  const source = process.env.AITM_LIVE_SOURCE || path.resolve('examples/custody-architecture.md');
  const results = [];
  console.log(`Live verification state: ${directory}`);
  try {
    for (const provider of selected) {
      console.log(`Testing ${provider} with ${source}`);
      await client.post(`/v1/providers/${provider}/test`, {
        model: DEFAULT_MODELS[provider].fastModel,
      });
      const existing = await client.get('/v1/projects');
      const matches = [];
      for (const candidate of existing) {
        const saved = await client.get(client.projectPath(candidate.id));
        if (saved.config.provider === provider) matches.push(saved);
      }
      if (matches.length > 1) throw new Error(`Multiple ${provider} projects in live directory.`);
      const project =
        matches[0] ||
        (await client.post('/v1/projects', {
          name: `Live verification — ${provider}`,
          scope:
            'Model the supplied architecture at design level. Consider its TRACE actors, roles, protected assets, invariants and edges; record missing evidence explicitly. Include coordination when relevant.',
          config: { provider, ...DEFAULT_MODELS[provider], treeLimit: 2 },
        }));
      const base = client.projectPath(project.id);
      if (!matches.length)
        await client.post(
          `${base}/sources`,
          /^https:\/\//.test(source)
            ? { kind: 'git', url: source }
            : { kind: 'local', path: path.resolve(source) },
        );
      const run = await client.post(`${base}/runs`, { mode: 'draft' });
      for await (const event of client.events(project.id, run.id))
        if (event.type !== 'progress')
          console.log(
            `${provider}: ${event.type}${event.phase ? ` / ${event.phase}` : ''} — ${event.message}`,
          );
      const finished = await client.get(`${base}/runs/${run.id}`);
      if (finished.status !== 'completed')
        throw new Error(
          `${provider} pipeline ${finished.status}: ${finished.error || finished.phase}`,
        );
      const document = await client.get(`${base}/export`);
      await writeFile(path.join(directory, `${provider}.json`), JSON.stringify(document, null, 2), {
        mode: 0o600,
      });
      await writeFile(
        path.join(directory, `${provider}.md`),
        await client.get(`${base}/report`, { format: 'text' }),
        { mode: 0o600 },
      );
      await writeFile(
        path.join(directory, `${provider}.pdf`),
        await client.get(`${base}/report?format=pdf`, { format: 'buffer' }),
        { mode: 0o600 },
      );
      const record = {
        provider,
        status: finished.status,
        usage: document.project.runs.reduce(
          (total, r) => ({
            inputTokens: total.inputTokens + r.usage.inputTokens,
            outputTokens: total.outputTokens + r.usage.outputTokens,
          }),
          { inputTokens: 0, outputTokens: 0 },
        ),
        runs: document.project.runs.length,
        projectId: project.id,
        phases: Object.keys(document.project.artifacts),
        sources: document.project.sources.map(({ label, locator, hash, commit }) => ({
          label,
          locator,
          hash,
          commit,
        })),
      };
      results.push(record);
      console.log(JSON.stringify(record));
    }
    await writeFile(
      path.join(directory, 'verification.json'),
      JSON.stringify({ at: new Date().toISOString(), requestedSource: source, results }, null, 2),
      { mode: 0o600 },
    );
    console.log(`Live verification artifacts: ${directory}`);
  } finally {
    await engine.close();
    await server.close();
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
