"use strict";

const { appError } = require("../util");

// Adapter for Anthropic's Messages API. Structured output is obtained by forcing a
// single tool call whose input_schema is our JSON schema, then reading tool_use.input.
// The key is supplied by the caller; never logged or persisted here.

const ENDPOINT = "https://api.anthropic.com/v1/messages";
const MAX_TOKENS = 16000;

const adapter = {
  id: "anthropic",
  label: "Anthropic",
  host: "api.anthropic.com",

  async structuredCall({ model, name, schema, system, user, key }) {
    if (!key) throw appError("key_missing", "No API key configured. Add your provider API key in Settings.");
    let response;
    try {
      response = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model,
          max_tokens: MAX_TOKENS,
          system,
          messages: [{ role: "user", content: user }],
          tools: [{ name, description: "Return the structured result for this step.", input_schema: schema }],
          tool_choice: { type: "tool", name }
        })
      });
    } catch (err) {
      throw appError("network_error", `Could not reach the AI provider: ${err.message}`);
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const msg = data.error?.message || `Provider request failed with status ${response.status}.`;
      const code = response.status === 401 ? "key_invalid" : "provider_error";
      throw appError(code, msg);
    }
    const block = (data.content || []).find((c) => c.type === "tool_use" && c.name === name)
      || (data.content || []).find((c) => c.type === "tool_use");
    if (!block || !block.input || typeof block.input !== "object") {
      throw appError("non_json", "Provider did not return structured tool output.");
    }
    return block.input;
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
