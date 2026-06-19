"use strict";

const { appError } = require("../util");
const { sseEvents } = require("./sse");

// Adapter for OpenAI's /v1/responses endpoint with strict JSON-schema structured output,
// consumed as a stream so long generations don't stall. Text deltas are accumulated into
// the final JSON and forwarded to onDelta for the live console. The key is supplied by
// the caller; never logged or persisted here.

const ENDPOINT = "https://api.openai.com/v1/responses";

const adapter = {
  id: "openai",
  label: "OpenAI",
  host: "api.openai.com",

  async structuredCall({ model, name, schema, system, user, key, signal, onDelta }) {
    if (!key) {
      throw appError("key_missing", "No API key configured. Add your provider API key in Settings.");
    }
    let response;
    try {
      response = await fetch(ENDPOINT, {
        method: "POST",
        signal,
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          stream: true,
          input: [
            { role: "system", content: [{ type: "input_text", text: system }] },
            { role: "user", content: [{ type: "input_text", text: user }] }
          ],
          text: { format: { type: "json_schema", name, strict: true, schema } }
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

    let text = "";
    let completedText = "";
    let incomplete = "";
    try {
      for await (const ev of sseEvents(response)) {
        const j = ev.json;
        if (!j || typeof j.type !== "string") continue;
        const t = j.type;
        if (t === "response.output_text.delta" && typeof j.delta === "string") {
          text += j.delta;
          if (onDelta) onDelta(j.delta);
        } else if (t === "response.completed" && j.response) {
          // Authoritative full output; covers cases where we matched no deltas.
          completedText = extractText(j.response);
        } else if (t === "response.failed") {
          throw appError("provider_error", j.response?.error?.message || "Provider reported the response failed.");
        } else if (t === "response.incomplete") {
          incomplete = j.response?.incomplete_details?.reason || "incomplete";
        } else if (t === "error" || t === "response.error") {
          throw appError("provider_error", j.error?.message || j.message || "Provider stream error.");
        }
      }
    } catch (err) {
      if (err && err.code) throw err;
      if (err && err.name === "AbortError") throw appError("cancelled", "Request cancelled.");
      throw appError("network_error", `Stream interrupted: ${err.message}`);
    }

    const out = (text.trim() ? text : completedText).trim();
    if (!out) {
      throw appError("non_json", incomplete
        ? `Provider returned no output (response ${incomplete}). Try again or reduce the scope/sources.`
        : "Provider returned an empty stream.");
    }
    try {
      return JSON.parse(out);
    } catch (err) {
      throw appError("non_json", `Provider returned non-JSON output: ${err.message}`);
    }
  },

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

// Pull the output text out of a completed /v1/responses object.
function extractText(resp) {
  if (typeof resp.output_text === "string" && resp.output_text) return resp.output_text;
  let out = "";
  for (const item of resp.output || []) {
    for (const c of item.content || []) {
      if (c.type === "output_text" && typeof c.text === "string") out += c.text;
    }
  }
  return out;
}

module.exports = adapter;
