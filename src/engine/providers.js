import { jsonSchema, Schemas, DEFAULT_MODELS, MODEL_CATALOG, ProviderId } from './schema.js';
import { AppError, insist } from './errors.js';
import { credentialPatch } from './credentials.js';

// Claude's grammar supports fewer bounds than JSON Schema. Keep the original
// Zod validation in the engine and convey unsupported bounds in descriptions.
export function anthropicSchema(schema) {
  const result = jsonSchema(schema, { reused: 'ref', target: 'draft-2020-12' });
  const unsupported = new Set([
    'minimum',
    'maximum',
    'exclusiveMinimum',
    'exclusiveMaximum',
    'multipleOf',
    'minLength',
    'maxLength',
    'maxItems',
    'uniqueItems',
  ]);
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    const bounds = [];
    for (const key of Object.keys(node)) {
      if (unsupported.has(key) || (key === 'minItems' && node[key] > 1)) {
        bounds.push(`${key}: ${JSON.stringify(node[key])}`);
        delete node[key];
      }
    }
    if (bounds.length)
      node.description = [node.description, `Required constraints: ${bounds.join(', ')}.`]
        .filter(Boolean)
        .join(' ');
    if (node.$ref && Object.keys(node).some((key) => !['$ref', 'description'].includes(key))) {
      const base = node.$ref
        .split('/')
        .slice(1)
        .reduce((value, key) => value[key], result);
      const merged = { ...structuredClone(base), ...node };
      merged.description = [base.description, node.description].filter(Boolean).join(' ');
      delete merged.$ref;
      for (const key of Object.keys(node)) delete node[key];
      Object.assign(node, merged);
      visit(node);
      return;
    }
    for (const map of [node.properties, node.$defs, node.definitions])
      if (map) for (const child of Object.values(map)) visit(child);
    for (const child of [node.items, node.additionalProperties]) visit(child);
    for (const alternatives of [node.anyOf, node.allOf, node.oneOf])
      if (alternatives) for (const child of alternatives) visit(child);
  }
  visit(result);
  return result;
}

export async function* readSSE(body) {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of body) {
    buffer = (buffer + decoder.decode(chunk, { stream: true })).replace(/\r\n/g, '\n');
    insist(
      buffer.length < 8 * 1024 * 1024,
      'Provider event exceeded the size limit.',
      502,
      'provider_protocol',
    );
    let boundary;
    while ((boundary = buffer.indexOf('\n\n')) >= 0) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = frame
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trimStart())
        .join('\n');
      if (data && data !== '[DONE]') yield JSON.parse(data);
    }
  }
  insist(!buffer.trim(), 'Provider stream ended in a partial event.', 502, 'provider_protocol');
}

// Safety classifiers on these models can decline security analysis. With this
// opt-in, the API reruns a declined request on the model Anthropic recommends.
const ANTHROPIC_FALLBACK = /^claude-(?:opus-5|sonnet-5-5|fable-5|mythos-5)(?:-|$)/;
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

export class Providers {
  constructor({
    keys = {},
    keySources = {},
    keyFile = null,
    saveCredentials,
    anthropicWorkspaceId = '',
    fetchImpl = fetch,
  } = {}) {
    this.keys = { ...keys };
    this.keySources = { ...keySources };
    this.keyFile = keyFile;
    this.saveCredentials = saveCredentials;
    this.redactedKeys = new Set(Object.values(keys).filter(Boolean));
    insist(
      !anthropicWorkspaceId || /^wrkspc_[A-Za-z0-9]+$/.test(anthropicWorkspaceId),
      'ANTHROPIC_WORKSPACE_ID must be a wrkspc_ workspace ID.',
    );
    this.anthropicWorkspaceId = anthropicWorkspaceId;
    this.fetch = fetchImpl;
  }
  status() {
    return Object.fromEntries(
      Object.entries(DEFAULT_MODELS).map(([name, models]) => [
        name,
        {
          configured: Boolean(this.keys[name]),
          keySource: this.keySources[name] || (this.keys[name] ? 'session' : 'not configured'),
          ...models,
        },
      ]),
    );
  }
  redact(text) {
    let result = String(text);
    for (const key of this.redactedKeys) if (key) result = result.split(key).join('[REDACTED]');
    return result;
  }
  configure(input) {
    const patch = credentialPatch(input);
    if (!Object.keys(patch).length) return false;
    // Commit to disk before changing the active credentials. Never send them to project storage.
    try {
      this.saveCredentials?.(patch);
    } catch {
      throw new AppError(
        500,
        'credential_save_failed',
        'Could not save API keys. Check permissions on the AiTM configuration directory.',
      );
    }
    for (const provider of ['openai', 'anthropic'])
      if (patch[provider]) {
        this.keys[provider] = patch[provider];
        this.redactedKeys.add(patch[provider]);
        this.keySources[provider] = this.saveCredentials ? 'saved settings' : 'session';
      }
    if (patch.anthropicWorkspaceId !== undefined)
      this.anthropicWorkspaceId = patch.anthropicWorkspaceId;
    return true;
  }
  headers(provider) {
    return provider === 'openai'
      ? { authorization: `Bearer ${this.keys[provider]}` }
      : {
          'x-api-key': this.keys[provider],
          'anthropic-version': '2023-06-01',
          ...(this.anthropicWorkspaceId
            ? { 'anthropic-workspace-id': this.anthropicWorkspaceId }
            : {}),
        };
  }
  async models(provider, signal) {
    ProviderId.parse(provider);
    const defaults = MODEL_CATALOG[provider];
    const fallback = (notice) => ({
      source: 'defaults',
      models: defaults.map((id) => ({ id })),
      notice,
    });
    if (!this.keys[provider])
      return fallback('Add an API key in Settings to load account models. Showing defaults.');
    try {
      const requestSignal = AbortSignal.any([
        ...(signal ? [signal] : []),
        AbortSignal.timeout(10000),
      ]);
      const entries = [];
      let cursor = '';
      for (let page = 0; page < 10; page++) {
        const url = new URL(
          provider === 'openai'
            ? 'https://api.openai.com/v1/models'
            : 'https://api.anthropic.com/v1/models',
        );
        if (provider === 'anthropic') {
          url.searchParams.set('limit', '1000');
          if (cursor) url.searchParams.set('after_id', cursor);
        }
        const response = await this.fetch(url.toString(), {
          method: 'GET',
          headers: this.headers(provider),
          redirect: 'error',
          signal: requestSignal,
        });
        if (!response.ok) {
          await response.body?.cancel();
          return fallback(
            `Could not load account models (HTTP ${response.status}). Showing defaults; check the API key in Settings.`,
          );
        }
        const body = await response.json();
        insist(Array.isArray(body.data), 'Invalid model list.');
        entries.push(...body.data.slice(0, 10000));
        if (provider === 'openai' || !body.has_more) break;
        insist(
          typeof body.last_id === 'string' && body.last_id !== cursor && page < 9,
          'Invalid model pagination.',
        );
        cursor = body.last_id;
      }
      const models = [
        ...new Map(
          entries
            .filter((model) => {
              if (
                typeof model?.id !== 'string' ||
                !/^[\w.:-]{1,300}$/.test(model.id) ||
                this.redact(model.id) !== model.id
              )
                return false;
              if (provider === 'anthropic')
                return model.capabilities
                  ? model.capabilities.structured_outputs?.supported &&
                      model.capabilities.effort?.supported &&
                      (!model.max_tokens || model.max_tokens >= 64000)
                  : defaults.includes(model.id);
              // The pipeline uses reasoning effort and strict Responses output. Exclude specialist endpoints.
              return (
                /^gpt-[5-9](?:[.-]|$)/.test(model.id) &&
                !/(chat|audio|realtime|search|transcribe|tts|image|deep-research)/.test(model.id) &&
                !/(?:^|-)(?:pro|codex)(?:-|$)/.test(model.id)
              );
            })
            .map((model) => [model.id, { id: model.id }]),
        ).values(),
      ];
      models.sort((a, b) => {
        const rank = (id) => (defaults.includes(id) ? defaults.indexOf(id) : defaults.length);
        return rank(a.id) - rank(b.id) || a.id.localeCompare(b.id);
      });
      return models.length
        ? { source: 'account', models, notice: '' }
        : fallback(
            'No compatible models returned. Showing defaults; use the connection test to verify access.',
          );
    } catch (error) {
      if (signal?.aborted) throw error;
      return fallback(
        'Account model lookup is unavailable. Showing defaults; refresh the model list to retry.',
      );
    }
  }
  // The provider for a new project: the first one with a key, OpenAI when none has one.
  preferred() {
    return Object.keys(DEFAULT_MODELS).find((name) => this.keys[name]) || 'openai';
  }
  assertConfigured(provider) {
    const name = (id) => (id === 'openai' ? 'OpenAI' : 'Anthropic');
    const other = Object.keys(DEFAULT_MODELS).find((id) => id !== provider && this.keys[id]);
    insist(
      this.keys[provider],
      other
        ? `This project uses ${name(provider)}, which has no API key. ${name(other)} has a key: select ${name(other)} in the provider and model settings of the project and save, or add an ${name(provider)} key in Settings.`
        : `No ${name(provider)} API key is configured. Add one in Settings, or run aitm configure, then start the run again.`,
      422,
      'missing_key',
    );
  }
  async call({
    provider,
    model,
    phase,
    system,
    user,
    effort = 'medium',
    signal,
    onProgress = () => {},
    schema = Schemas[phase],
  }) {
    this.assertConfigured(provider);
    const openai = provider === 'openai';
    let fallbacks = !openai && ANTHROPIC_FALLBACK.test(model);
    const body = openai
      ? {
          model,
          instructions: system,
          input: user,
          stream: true,
          store: false,
          reasoning: { effort },
          max_output_tokens: 32000,
          text: {
            format: {
              type: 'json_schema',
              name: `aitm_${phase}`,
              strict: true,
              schema: jsonSchema(schema),
            },
          },
        }
      : {
          model,
          system,
          messages: [{ role: 'user', content: user }],
          stream: true,
          max_tokens: 64000,
          output_config: {
            effort,
            format: { type: 'json_schema', schema: anthropicSchema(schema) },
          },
        };
    let response;
    for (;;) {
      try {
        response = await this.fetch(
          openai ? 'https://api.openai.com/v1/responses' : 'https://api.anthropic.com/v1/messages',
          {
            method: 'POST',
            redirect: 'error',
            signal,
            headers: {
              'content-type': 'application/json',
              ...this.headers(provider),
              ...(fallbacks ? { 'anthropic-beta': FALLBACK_BETA } : {}),
            },
            body: JSON.stringify(fallbacks ? { ...body, fallbacks: 'default' } : body),
          },
        );
      } catch (error) {
        if (signal?.aborted) throw error;
        throw new AppError(
          502,
          'provider_network',
          `${provider} connection failed; check your network and retry.`,
        );
      }
      if (response.ok) break;
      // Recognize this actionable account-configuration error without reflecting
      // arbitrary provider bodies (which can contain source text or credentials).
      if (!openai && response.status === 400) {
        const detail = await response.json().catch(() => ({}));
        if (/anthropic-workspace-id/.test(String(detail.error?.message || '')))
          throw new AppError(
            422,
            'workspace_required',
            'Anthropic requires a workspace selection. Set ANTHROPIC_WORKSPACE_ID in your private configuration and restart the server.',
          );
        // An account or platform without the fallback beta rejects the field. Send the plain request.
        if (fallbacks) {
          fallbacks = false;
          continue;
        }
      }
      if (!response.bodyUsed) await response.body?.cancel();
      const reason =
        response.status === 401 || response.status === 403
          ? 'key or model access was rejected'
          : response.status === 429
            ? 'rate or billing limit reached'
            : `request failed (HTTP ${response.status})`;
      throw new AppError(502, 'provider_error', `${provider}: ${reason}. Model: ${model}.`);
    }
    let output = '',
      served = model,
      completed = false,
      stopped = false,
      inputTokens = 0,
      outputTokens = 0,
      lastProgress = 0;
    try {
      for await (const event of readSSE(response.body)) {
        signal?.throwIfAborted();
        if (['error', 'response.failed', 'response.incomplete'].includes(event.type))
          throw new AppError(
            502,
            'provider_incomplete',
            `${provider} did not complete the response. Check model access, limits or content restrictions.`,
          );
        if (event.type === 'response.refusal.delta' || event.type === 'response.refusal.done')
          throw new AppError(502, 'provider_refusal', `${provider} declined this analysis.`);
        if (event.type === 'response.output_text.delta') output += event.delta;
        if (event.type === 'response.completed') {
          insist(
            event.response.status === 'completed',
            'Provider response is incomplete.',
            502,
            'provider_incomplete',
          );
          completed = true;
          inputTokens = event.response.usage?.input_tokens || 0;
          outputTokens = event.response.usage?.output_tokens || 0;
        }
        if (event.type === 'message_start') {
          inputTokens = event.message?.usage?.input_tokens || 0;
          if (typeof event.message?.model === 'string') served = event.message.model;
        }
        if (event.type === 'content_block_start' && event.content_block?.type === 'fallback') {
          // A switch after partial output cannot give one valid JSON document.
          if (output)
            throw new AppError(
              502,
              'provider_incomplete',
              'Anthropic declined part-way and changed to its fallback model. Retry this phase.',
            );
          if (typeof event.content_block.to?.model === 'string')
            served = event.content_block.to.model;
        }
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta')
          output += event.delta.text;
        if (event.type === 'message_delta') {
          outputTokens = event.usage?.output_tokens || outputTokens;
          const reason = event.delta?.stop_reason;
          if (reason === 'refusal')
            throw new AppError(502, 'provider_refusal', 'Anthropic declined this analysis.');
          if (reason && reason !== 'end_turn')
            throw new AppError(
              502,
              'provider_incomplete',
              `Anthropic stopped before completion (${reason}).`,
            );
          if (reason === 'end_turn') stopped = true;
        }
        if (event.type === 'message_stop') completed = stopped;
        insist(
          output.length < 4 * 1024 * 1024,
          'Provider output exceeded the limit.',
          502,
          'provider_protocol',
        );
        if (Date.now() - lastProgress > 500) {
          onProgress({ characters: output.length, inputTokens, outputTokens });
          lastProgress = Date.now();
        }
      }
    } catch (error) {
      if (signal?.aborted || error instanceof AppError) throw error;
      throw new AppError(
        502,
        'provider_protocol',
        'Provider stream was interrupted or malformed. Retry this phase.',
      );
    }
    insist(
      completed && output.trim(),
      'Provider stream ended without a complete structured result.',
      502,
      'provider_incomplete',
    );
    try {
      return {
        data: JSON.parse(this.redact(output)),
        usage: { inputTokens, outputTokens },
        // The model that produced the result; it differs from the request after a fallback.
        model: /^[\w.:-]{1,300}$/.test(served) ? served : model,
        provider,
      };
    } catch {
      throw new AppError(
        502,
        'provider_json',
        'Provider returned invalid structured JSON. Retry this phase.',
      );
    }
  }
  async test(provider, model, signal) {
    const { z } = await import('zod');
    await this.call({
      provider,
      model,
      phase: 'connection',
      system: 'Reply with a JSON object containing ok: true.',
      user: 'Test connection.',
      effort: 'low',
      signal,
      schema: z.strictObject({ ok: z.boolean() }),
    });
    return { provider, model, verified: true };
  }
}
