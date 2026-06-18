"use strict";

const { appError } = require("../util");

// Adapter for OpenAI's /v1/responses endpoint with strict JSON-schema structured output.
// The key is supplied by the caller (read from the keystore in the main process); it is
// never logged or persisted here.

const ENDPOINT = "https://api.openai.com/v1/responses";

const adapter = {
  id: "openai",
  label: "OpenAI",
  host: "api.openai.com",

  async structuredCall({ model, name, schema, system, user, key }) {
    if (!key) {
      throw appError("key_missing", "No API key configured. Add your provider API key in Settings.");
    }
    let response;
    try {
      response = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model,
          input: [
            { role: "system", content: [{ type: "input_text", text: system }] },
            { role: "user", content: [{ type: "input_text", text: user }] }
          ],
          text: { format: { type: "json_schema", name, strict: true, schema } }
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
    const text = extractOutputText(data);
    try {
      return JSON.parse(text);
    } catch (err) {
      throw appError("non_json", `Provider returned non-JSON output: ${err.message}`);
    }
  },

  // Lightweight validation: a tiny structured call confirms the key works.
  async validateKey(key) {
    await this.structuredCall({
      model: "gpt-5-mini",
      name: "ping",
      schema: { type: "object", additionalProperties: false, required: ["ok"], properties: { ok: { type: "boolean" } } },
      system: "Reply with {\"ok\": true}.",
      user: "ping",
      key
    });
    return true;
  }
};

function extractOutputText(data) {
  if (typeof data.output_text === "string") return data.output_text;
  const parts = [];
  for (const out of data.output || []) {
    for (const content of out.content || []) {
      if (content.type === "output_text" && typeof content.text === "string") parts.push(content.text);
    }
  }
  return parts.join("\n").trim();
}

module.exports = adapter;
