import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { setup, serve, authed, TOKEN } from './helpers.js';
import { ApiClient } from '../src/client.js';

test('API exposes the same provider model catalog and credential status without exposing keys', async (t) => {
  const { engine, providers } = await setup(t);
  providers.fetch = async () =>
    Response.json({ data: [{ id: 'gpt-6.2-sol' }, { id: 'gpt-6.2-astra' }] });
  const { request } = await serve(t, engine);
  providers.configure({ openai: 'replacement-private-key' });
  const catalog = await request('GET', '/v1/providers/openai/models');
  assert.equal(catalog.status, 200);
  assert.equal(catalog.body.source, 'account');
  assert.equal(catalog.body.models.length, 2);
  const status = await request('GET', '/v1/providers');
  assert.equal(status.body.openai.configured, true);
  assert.doesNotMatch(JSON.stringify([status, catalog]), /replacement-private-key/);
});

test('HTTP lifecycle, OpenAPI, replayable SSE, editing and report export', async (t) => {
  const { engine, p } = await setup(t);
  const { url, request } = await serve(t, engine),
    base = `/v1/projects/${p.id}`;
  const contract = await request('GET', '/v1/openapi.json');
  assert.equal(contract.status, 200);
  assert.equal(contract.body.openapi, '3.1.0');
  assert.ok(contract.body.paths['/v1/projects/{projectId}/runs']);
  assert.ok(contract.body.components.schemas.model);
  const started = await request('POST', `${base}/runs`, { mode: 'draft' });
  assert.equal(started.status, 202);
  const client = new ApiClient(url, { token: TOKEN }),
    events = [];
  for await (const event of client.events(p.id, started.body.id)) events.push(event);
  assert.equal(events.at(-1).type, 'completed');
  assert.equal(new Set(events.map((e) => e.id)).size, events.length);
  const replay = [];
  for await (const event of client.events(p.id, started.body.id, { after: events.at(-2).id }))
    replay.push(event);
  assert.deepEqual(replay, [events.at(-1)]);
  const markdown = await authed(`${url}${base}/report`);
  assert.equal(markdown.status, 200);
  assert.ok((await markdown.text()).includes('Mitigation roadmap'));
  const pdf = await authed(`${url}${base}/report?format=pdf`);
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  assert.equal(
    Buffer.from(await pdf.arrayBuffer())
      .subarray(0, 5)
      .toString(),
    '%PDF-',
  );
  const exported = await request('GET', `${base}/export`),
    imported = await request('POST', '/v1/projects/import', exported.body);
  assert.equal(imported.status, 201);
  assert.notEqual(imported.body.id, p.id);
  const deleted = await request('DELETE', `/v1/projects/${imported.body.id}`);
  assert.equal(deleted.status, 200);
  assert.equal((await request('GET', `/v1/projects/${imported.body.id}`)).status, 404);
});

test('HTTP validation, browser boundaries and credential redaction', async (t) => {
  const { engine, p, providers } = await setup(t);
  const { url, request } = await serve(t, engine);
  assert.equal(
    (await request('POST', '/v1/projects', { name: 'x', secret: 'not allowed' })).status,
    422,
  );
  assert.equal((await request('POST', '/v1/projects', { name: '' })).status, 422);
  assert.equal((await request('GET', '/v1/projects/not-an-id')).status, 422);
  assert.equal(
    (await authed(`${url}/v1/projects`, { headers: { origin: 'https://attacker.example' } }))
      .status,
    403,
  );
  assert.equal(
    (await authed(`${url}/v1/projects`, { headers: { 'sec-fetch-site': 'cross-site' } })).status,
    403,
  );
  const wrongHost = await new Promise((resolve, reject) => {
    http
      .get(`${url}/v1/projects`, { headers: { host: 'attacker.example' } }, (res) => {
        res.resume();
        resolve(res.statusCode);
      })
      .on('error', reject);
  });
  assert.equal(wrongHost, 403);
  assert.equal((await authed(`${url}/v1/projects`, { method: 'POST', body: '{}' })).status, 415);
  assert.equal(
    (
      await authed(`${url}/v1/projects`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{',
      })
    ).status,
    400,
  );
  await engine.addSource(p.id, {
    kind: 'text',
    label: 'Accidental credential',
    text: `Secret: ${providers.keys.openai}`,
  });
  const content = JSON.stringify((await request('GET', `/v1/projects/${p.id}`)).body);
  for (const key of Object.values(providers.keys)) assert.ok(!content.includes(key));
  const status = JSON.stringify((await request('GET', '/v1/providers')).body);
  assert.ok(status.includes('configured'));
  assert.ok(!status.includes(providers.keys.openai));
});

test('disconnecting a progress client does not cancel the server job', async (t) => {
  const { engine, p } = await setup(t, { delay: 20 });
  const { url, request } = await serve(t, engine);
  const started = await request('POST', `/v1/projects/${p.id}/runs`, { mode: 'draft' });
  const controller = new AbortController();
  const client = new ApiClient(url, { token: TOKEN });
  for await (const event of client.events(p.id, started.body.id, { signal: controller.signal })) {
    controller.abort();
    break;
  }
  if (engine.active.has(p.id)) await engine.active.get(p.id).task;
  assert.equal(engine.getRun(p.id, started.body.id).status, 'completed');
});

test('API supports source snapshot synchronization and cancellation', async (t) => {
  const { engine, p } = await setup(t, { delay: 100 });
  const { request } = await serve(t, engine),
    base = `/v1/projects/${p.id}`;
  const synced = await request('PUT', `${base}/sources/${p.sources[0].id}`, {
    kind: 'files',
    label: 'Editor sync',
    files: [{ path: 'architecture.md', content: 'Vault holds deposits.\nChanged architecture.' }],
  });
  assert.equal(synced.status, 200);
  assert.equal(synced.body.sources.length, 1);
  const run = await request('POST', `${base}/runs`, { mode: 'draft' });
  assert.equal((await request('POST', `${base}/runs`, { mode: 'draft' })).status, 409);
  const cancelled = await request('POST', `${base}/runs/${run.body.id}/cancel`, {});
  assert.equal(cancelled.body.status, 'cancelled');
});

test('full pipeline remains available to independent API clients', async (t) => {
  const { engine, p } = await setup(t);
  const { request } = await serve(t, engine);
  const full = await request('POST', `/v1/projects/${p.id}/runs`, { mode: 'full' });
  assert.equal(full.status, 202);
  await engine.active.get(p.id)?.task;
  assert.equal(engine.getRun(p.id, full.body.id).status, 'completed');
  assert.equal(engine.get(p.id).artifacts.report.status, 'draft');
});
