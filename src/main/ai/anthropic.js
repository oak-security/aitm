"use strict";

const { appError } = require("../util");
const { sseEvents } = require("./sse");

// Adapter for Anthropic's Messages API. Structured output is obtained by forcing a single
// tool call whose input_schema is our JSON schema; the streamed input_json_delta frames
// are accumulated into the final tool input. The key is supplied by the caller; never
// logged or persisted here.

const ENDPOINT = "https://api.anthropic.com/v1/messages";
const MAX_TOKENS = 32000;

const adapter = {
  id: "anthropic",
  label: "Anthropic",
  host: "api.anthropic.com",

  async structuredCall({ model, name, schema, system, user, key, signal, onDelta }) {
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
          tool_choice: { type: "tool", name }
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
    let truncated = false;
    try {
      for await (const ev of sseEvents(response)) {
        const j = ev.json;
        if (!j) continue;
        if (j.type === "content_block_delta" && j.delta && j.delta.type === "input_json_delta") {
          const part = j.delta.partial_json || "";
          json += part;
          if (onDelta && part) onDelta(part);
        } else if (j.type === "message_delta" && j.delta && j.delta.stop_reason === "max_tokens") {
          truncated = true;
        } else if (j.type === "error") {
          throw appError("provider_error", j.error?.message || "Provider stream error.");
        }
      }
    } catch (err) {
      if (err && err.code) throw err;
      if (err && err.name === "AbortError") throw appError("cancelled", "Request cancelled.");
      throw appError("network_error", `Stream interrupted: ${err.message}`);
    }

    if (!json.trim()) throw appError("non_json", "Provider returned an empty stream.");
    if (truncated) throw appError("truncated", "Output hit the model's max tokens before completing. Reduce the scope/sources and retry.");
    try {
      return JSON.parse(json);
    } catch (err) {
      throw appError("non_json", `Provider returned non-JSON output: ${err.message}. The response may have been cut off.`);
    }
  },

  async validateKey(key) {
    await this.structuredCall({
      model: "claude-haiku-4-5-20251001",
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
