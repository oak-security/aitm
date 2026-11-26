import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { Providers, readSSE, anthropicSchema } from '../src/engine/providers.js';
import { Schemas } from '../src/engine/schema.js';

const schema = z.strictObject({ ok: z.boolean() });
function response(events, chunkSize = 7) {
  const encoded = new TextEncoder().encode(
    events.map((event) => `data: ${JSON.stringify(event)}\r\n\r\n`).join(''),
  );
  return new Response(
    new ReadableStream({
      start(controller) {
        for (let i = 0; i < encoded.length; i += chunkSize)
          controller.enqueue(encoded.slice(i, i + chunkSize));
        controller.close();
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  );
}
const request = {
  phase: 'connection',
  model: 'test-model',
  system: 'Test',
  user: 'Test',
  schema,
  signal: new AbortController().signal,
};

test('model discovery authenticates, filters specialist models, paginates Claude, and falls back safely', async () => {
  const requests = [];
  const providers = new Providers({
    keys: { openai: 'private-openai', anthropic: 'private-anthropic' },
    anthropicWorkspaceId: 'wrkspc_test',
    fetchImpl: async (url, options) => {
      requests.push({ url, ...options });
      if (url.includes('openai.com'))
        return Response.json({
          data: [
            { id: 'gpt-6.2-astra' },
            { id: 'gpt-6.2-sol' },
            { id: 'gpt-6.2-sol' },
            { id: 'gpt-6-astra' },
            { id: 'gpt-5-chat-latest' },
            { id: 'gpt-5.4-pro' },
            { id: 'gpt-5-codex' },
            { id: 'text-embedding-3-large' },
            { id: 'o3' },
            { id: 'gpt-live-1.1' },
            { id: 'gpt-oss-120b' },
            { id: 'gpt-realtime-2.1' },
            { id: 'gpt-5-private-openai' },
          ],
        });
      if (!url.includes('after_id'))
        return Response.json({
          data: [{ id: 'claude-sonnet-5-5' }],
          has_more: true,
          last_id: 'claude-sonnet-5-5',
        });
      return Response.json({
        data: [{ id: 'claude-opus-5-5' }, { id: 'claude-legacy' }],
        has_more: false,
      });
    },
  });
  const openai = await providers.models('openai');
  assert.deepEqual(
    openai.models.map((m) => m.id),
    ['gpt-6.2-sol', 'gpt-6.2-astra', 'gpt-6-astra'],
  );
  assert.equal(requests[0].headers.authorization, 'Bearer private-openai');
  assert.equal(requests[0].redirect, 'error');
  const claude = await providers.models('anthropic');
  assert.equal(claude.models.length, 2);
  assert.equal(requests[1].headers['anthropic-workspace-id'], 'wrkspc_test');
  assert.ok(requests[2].url.includes('after_id=claude-sonnet-5-5'));
  providers.fetch = async () => new Response('private-openai', { status: 401 });
  const fallback = await providers.models('openai');
  assert.equal(fallback.source, 'defaults');
  assert.match(fallback.notice, /401/);
  assert.ok(!JSON.stringify(fallback).includes('private-openai'));
  const empty = new Providers({
    fetchImpl: () => {
      throw new Error('must not fetch without keys');
    },
  });
  assert.equal((await empty.models('openai')).source, 'defaults');
});

test('credential replacement changes subsequent requests and redacts current and retired keys', async () => {
  const headers = [];
  const providers = new Providers({
    keys: { openai: 'first-key', anthropic: 'other-key' },
    fetchImpl: async (_, options) => {
      headers.push(options.headers.authorization);
      return response([
        { type: 'response.output_text.delta', delta: '{"ok":true}' },
        { type: 'response.completed', response: { status: 'completed' } },
      ]);
    },
  });
  await providers.call({ ...request, provider: 'openai' });
  providers.configure({ openai: 'replacement-key' });
  await providers.call({ ...request, provider: 'openai' });
  assert.deepEqual(headers, ['Bearer first-key', 'Bearer replacement-key']);
  assert.equal(providers.keys.anthropic, 'other-key');
  assert.equal(
    providers.redact('first-key replacement-key other-key'),
    '[REDACTED] [REDACTED] [REDACTED]',
  );
  assert.doesNotMatch(JSON.stringify(providers.status()), /first-key|replacement-key|other-key/);
});

test('OpenAI sends strict Responses schema, no storage, and parses fragmented UTF-8 SSE', async () => {
  let captured;
  const providers = new Providers({
    keys: { openai: 'private-openai' },
    fetchImpl: async (url, options) => {
      captured = { url, ...options, body: JSON.parse(options.body) };
      return response(
        [
          { type: 'response.output_text.delta', delta: '{"ok":' },
          { type: 'response.output_text.delta', delta: 'true}' },
          {
            type: 'response.completed',
            response: { status: 'completed', usage: { input_tokens: 10, output_tokens: 5 } },
          },
        ],
        1,
      );
    },
  });
  const result = await providers.call({ ...request, provider: 'openai' });
  assert.deepEqual(result.data, { ok: true });
  assert.equal(result.usage.outputTokens, 5);
  assert.equal(captured.url, 'https://api.openai.com/v1/responses');
  assert.equal(captured.redirect, 'error');
  assert.equal(captured.body.store, false);
  assert.equal(captured.body.text.format.strict, true);
  assert.equal(captured.headers.authorization, 'Bearer private-openai');
  const decoded = [];
  for await (const event of readSSE(response([{ value: 'café ✓' }], 1).body)) decoded.push(event);
  assert.deepEqual(decoded, [{ value: 'café ✓' }]);
});

test('Anthropic uses Messages structured output, preserves thinking, and requires end_turn', async () => {
  let captured;
  const providers = new Providers({
    keys: { anthropic: 'private-anthropic' },
    anthropicWorkspaceId: 'wrkspc_test',
    fetchImpl: async (url, options) => {
      captured = { url, ...options, body: JSON.parse(options.body) };
      return response([
        { type: 'message_start', message: { usage: { input_tokens: 11 } } },
        { type: 'content_block_delta', delta: { type: 'text_delta', text: '{"ok":true}' } },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 9 } },
        { type: 'message_stop' },
      ]);
    },
  });
  const result = await providers.call({ ...request, provider: 'anthropic' });
  assert.deepEqual(result.data, { ok: true });
  assert.equal(result.usage.inputTokens, 11);
  assert.equal(captured.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(captured.body.output_config.format.type, 'json_schema');
  assert.equal(captured.body.max_tokens, 64000);
  assert.equal(captured.body.thinking, undefined);
  assert.equal(captured.headers['anthropic-workspace-id'], 'wrkspc_test');
});

test('Anthropic schemas retain shape and communicate unsupported bounds for local validation', () => {
  const original = z.strictObject({
    minimum: z.string().min(3).max(8),
    scores: z.array(z.number().min(1).max(5)).min(2).max(10),
  });
  const wire = anthropicSchema(original);
  assert.equal(wire.additionalProperties, false);
  assert.equal(wire.properties.minimum.minLength, undefined);
  assert.match(wire.properties.minimum.description, /minLength: 3/);
  assert.equal(wire.properties.scores.minItems, undefined);
  const number = wire.$defs[wire.properties.scores.items.$ref.split('/').at(-1)];
  assert.equal(number.maximum, undefined);
  assert.match(number.description, /maximum: 5/);
  assert.equal(original.safeParse({ minimum: 'a', scores: [8] }).success, false);
  const model = anthropicSchema(Schemas.model);
  assert.ok(model.properties.threatActors.items.$ref);
  assert.equal(model.properties.threatActors.items.$ref, model.properties.roles.items.$ref);
  assert.ok(!JSON.stringify(model).includes('"allOf"'));
  function checkReferences(node) {
    if (!node || typeof node !== 'object') return;
    if (node.$ref)
      assert.ok(
        Object.keys(node).every((key) => ['$ref', 'description'].includes(key)),
        'Anthropic rejects constraints beside $ref',
      );
    for (const child of Object.values(node)) checkReferences(child);
  }
  for (const schema of Object.values(Schemas)) checkReferences(anthropicSchema(schema));
});

test('unscoped Anthropic keys receive actionable workspace errors without reflecting private bodies', async () => {
  const adapter = new Providers({
    keys: { anthropic: 'private-key' },
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          error: {
            message: 'private-key requires anthropic-workspace-id',
          },
        }),
        { status: 400 },
      ),
  });
  await assert.rejects(adapter.call({ ...request, provider: 'anthropic' }), (error) => {
    assert.equal(error.code, 'workspace_required');
    assert.match(error.message, /ANTHROPIC_WORKSPACE_ID/);
    assert.ok(!error.message.includes('private-key'));
    return true;
  });
});

test('provider refusals, truncation, abrupt streams and HTTP errors are never published as results', async () => {
  for (const [provider, events, pattern] of [
    ['openai', [{ type: 'response.refusal.delta', delta: 'no' }], /declined/],
    ['openai', [{ type: 'response.incomplete' }], /complete/],
    ['openai', [{ type: 'response.output_text.delta', delta: '{"ok":true}' }], /complete/],
    ['anthropic', [{ type: 'message_delta', delta: { stop_reason: 'refusal' } }], /declined/],
    ['anthropic', [{ type: 'message_delta', delta: { stop_reason: 'max_tokens' } }], /completion/],
    [
      'anthropic',
      [
        { type: 'content_block_delta', delta: { type: 'text_delta', text: '{}' } },
        { type: 'message_stop' },
      ],
      /complete/,
    ],
  ]) {
    const adapter = new Providers({
      keys: { [provider]: 'secret' },
      fetchImpl: async () => response(events),
    });
    await assert.rejects(adapter.call({ ...request, provider }), pattern);
  }
  const rejected = new Providers({
    keys: { openai: 'secret' },
    fetchImpl: async () => new Response('reflect secret here', { status: 401 }),
  });
  await assert.rejects(
    rejected.call({ ...request, provider: 'openai' }),
    (error) => !error.message.includes('secret') && error.message.includes('rejected'),
  );
  const truncated = new Providers({
    keys: { openai: 'secret' },
    fetchImpl: async () => new Response('data: {"type":"'),
  });
  await assert.rejects(truncated.call({ ...request, provider: 'openai' }), /partial event/);
});

test('current Claude models opt in to the refusal fallback and report the model that served', async () => {
  const sent = [];
  const stream = (model, events) =>
    response([
      { type: 'message_start', message: { model, usage: { input_tokens: 5 } } },
      ...events,
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 3 } },
      { type: 'message_stop' },
    ]);
  const text = (value) => ({
    type: 'content_block_delta',
    delta: { type: 'text_delta', text: value },
  });
  const fallback = {
    type: 'content_block_start',
    content_block: {
      type: 'fallback',
      from: { model: 'claude-opus-5-5' },
      to: { model: 'claude-opus-4-8' },
    },
  };
  let reply = () => stream('claude-opus-5-5', [text('{"ok":true}')]);
  const providers = new Providers({
    keys: { anthropic: 'private-anthropic' },
    fetchImpl: async (_, options) => {
      sent.push({ headers: options.headers, body: JSON.parse(options.body) });
      return reply(sent.at(-1));
    },
  });
  const call = (model) => providers.call({ ...request, provider: 'anthropic', model });
  assert.equal((await call('claude-opus-5-5')).model, 'claude-opus-5-5');
  assert.equal(sent[0].headers['anthropic-beta'], 'server-side-fallback-2026-07-01');
  assert.equal(sent[0].body.fallbacks, 'default');
  for (const model of ['claude-sonnet-5-5', 'claude-fable-5-2', 'claude-opus-5']) {
    await call(model);
    assert.equal(sent.at(-1).body.fallbacks, 'default', model);
  }
  // No server-side fallback exists for these models.
  for (const model of ['claude-haiku-5-5', 'claude-sonnet-5', 'claude-opus-4-8']) {
    await call(model);
    assert.equal(sent.at(-1).body.fallbacks, undefined, model);
    assert.equal(sent.at(-1).headers['anthropic-beta'], undefined, model);
  }
  // A decline before output is served by the fallback model in the same stream.
  reply = () => stream('claude-opus-4-8', [fallback, text('{"ok":true}')]);
  const served = await call('claude-opus-5-5');
  assert.deepEqual(served.data, { ok: true });
  assert.equal(served.model, 'claude-opus-4-8');
  // A switch after partial output must never be parsed as one document.
  reply = () => stream('claude-opus-5-5', [text('{"ok":'), fallback, text('{"ok":true}')]);
  await assert.rejects(call('claude-opus-5-5'), { code: 'provider_incomplete' });
  // An account that rejects the beta field gets the plain request once.
  sent.length = 0;
  reply = (last) =>
    last.body.fallbacks
      ? Response.json(
          { error: { message: 'fallbacks: Extra inputs are not permitted' } },
          { status: 400 },
        )
      : stream('claude-opus-5-5', [text('{"ok":true}')]);
  assert.deepEqual((await call('claude-opus-5-5')).data, { ok: true });
  assert.equal(sent.length, 2);
  assert.equal(sent[1].body.fallbacks, undefined);
  assert.equal(sent[1].headers['anthropic-beta'], undefined);
  reply = () => Response.json({ error: { message: 'bad request' } }, { status: 400 });
  await assert.rejects(call('claude-opus-5-5'), { code: 'provider_error' });
});
