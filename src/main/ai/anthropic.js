"use strict";

const { appError } = require("../util");
const { sseEvents } = require("./sse");

// Adapter for Anthropic's Messages API. Structured output is obtained by forcing a single
// tool call whose input_schema is our JSON schema; the streamed input_json_delta frames
// are accumulated into the final tool input. The key is supplied by the caller; never
// logged or persisted here.

const ENDPOINT = "https://api.anthropic.com/v1/messages";
// Claude 5 models think by default, and max_tokens caps thinking plus the tool input
// together, so this has to cover both or long STRIDE runs stop mid-JSON. Streaming is
// required at this size (we always stream). Do not "fix" truncation by disabling
// thinking: with thinking off, Claude Opus 5 sometimes writes a tool call as plain text
// instead of emitting a tool_use block, which breaks structured output outright.
const MAX_TOKENS = 64000;

const adapter = {
  id: "anthropic",
  label: "Anthropic",
  host: "api.anthropic.com",

  async structuredCall({ model, name, schema, system, user, key, signal, onDelta, effort }) {
    if (!key) throw appError("key_missing", "No API key configured. Add your provider API key in Settings.");
    let response;
    try {
      response = await fetch(ENDPOINT, {
        method: "POST",
        signal,
        headers: {
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model,
          max_tokens: MAX_TOKENS,
          stream: true,
          system,
          messages: [{ role: "user", content: user }],
          tools: [{ name, description: "Return the structured result for this step.", input_schema: schema }],
          // Forced tool choice alongside default (thinking-enabled) sampling is fine on
          // the first-party API; only Bedrock requires thinking off to force a tool.
          tool_choice: { type: "tool", name },
          // Same knob as the OpenAI adapter's reasoning.effort: caps how long the model
          // deliberates on cheap steps. GA on Claude 4.6+, ignored by older models.
          ...(effort ? { output_config: { effort } } : {})
        })
      });
    } catch (err) {
      if (err && err.code) throw err;
      if (err && err.name === "AbortError") throw appError("cancelled", "Request cancelled.");
      throw appError("network_error", `Could not reach the AI provider: ${err.message}`);
    }
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      const msg = data.error?.message || `Provider request failed with status ${response.status}.`;
      throw appError(response.status === 401 ? "key_invalid" : "provider_error", msg);
    }

    let json = "";
    let stopReason = "";
    try {
      for await (const ev of sseEvents(response)) {
        const j = ev.json;
        if (!j) continue;
        if (j.type === "content_block_delta" && j.delta && j.delta.type === "input_json_delta") {
          const part = j.delta.partial_json || "";
          json += part;
          if (onDelta && part) onDelta(part);
        } else if (j.type === "message_delta" && j.delta && j.delta.stop_reason) {
          stopReason = j.delta.stop_reason;
        } else if (j.type === "error") {
          throw appError("provider_error", j.error?.message || "Provider stream error.");
        }
      }
    } catch (err) {
      if (err && err.code) throw err;
      if (err && err.name === "AbortError") throw appError("cancelled", "Request cancelled.");
      throw appError("network_error", `Stream interrupted: ${err.message}`);
    }

    // Claude 5 safety classifiers can decline a request: HTTP 200, no tool call, and an
    // empty stream. Threat-modeling prompts sit close enough to the cyber policy to trip
    // this occasionally, so name it rather than reporting a bogus parse failure.
    if (stopReason === "refusal") {
      throw appError(
        "refused",
        "The model declined this request (safety classifier). Narrow the sources or scope for this phase, or switch to a different model in Settings."
      );
    }
    if (!json.trim()) throw appError("non_json", "Provider returned an empty stream.");
    if (stopReason === "max_tokens") throw appError("truncated", "Output hit the model's max tokens before completing. Reduce the scope/sources and retry.");
    try {
      return JSON.parse(json);
    } catch (err) {
      throw appError("non_json", `Provider returned non-JSON output: ${err.message}. The response may have been cut off.`);
    }
  },

  async validateKey(key) {
    await this.structuredCall({
      model: "claude-haiku-4-5",
      name: "ping",
      schema: { type: "object", additionalProperties: false, required: ["ok"], properties: { ok: { type: "boolean" } } },
      system: "Call the ping tool with ok set to true.",
      user: "ping",
      key
    });
    return true;
  }
};

module.exports = adapter;
