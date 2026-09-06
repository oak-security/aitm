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
