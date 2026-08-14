"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const fs = require("node:fs");

const anthropic = require(path.join(__dirname, "..", "src", "main", "ai", "anthropic.js"));

// Minimal Messages API stream stub: yields each frame as an SSE `data:` event and
// records the request body so we can assert on what was sent.
function stubFetch(frames) {
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return {
      ok: true,
      body: (async function* () {
        for (const f of frames) yield Buffer.from(`data: ${JSON.stringify(f)}\n\n`);
      })()
    };
  };
  return calls;
}

const toolInput = (obj) => ({
  type: "content_block_delta",
  delta: { type: "input_json_delta", partial_json: JSON.stringify(obj) }
});
const stop = (stop_reason) => ({ type: "message_delta", delta: { stop_reason } });

const CALL = {
  model: "claude-opus-5",
  name: "step",
  schema: { type: "object" },
  system: "s",
  user: "u",
  key: "sk-ant-test"
};

test("anthropic: returns the forced tool call's accumulated input", async () => {
  stubFetch([toolInput({ ok: true }), stop("tool_use")]);
  assert.deepEqual(await anthropic.structuredCall({ ...CALL }), { ok: true });
});

test("anthropic: a refusal is reported as such, not as a parse failure", async () => {
  // Claude 5 classifiers decline with HTTP 200 and no tool call, so the stream is empty.
  // Before this was handled it surfaced as "Provider returned an empty stream".
  stubFetch([stop("refusal")]);
  await assert.rejects(
    () => anthropic.structuredCall({ ...CALL }),
    (err) => {
      assert.equal(err.code, "refused");
      assert.match(err.message, /declined/i);
      return true;
    }
  );
});

test("anthropic: truncation is still distinguished from a refusal", async () => {
  stubFetch([toolInput({ partial: 1 }), stop("max_tokens")]);
  await assert.rejects(() => anthropic.structuredCall({ ...CALL }), (err) => err.code === "truncated");
});

test("anthropic: effort maps to output_config, and is omitted when unset", async () => {
  let calls = stubFetch([toolInput({ ok: true }), stop("tool_use")]);
  await anthropic.structuredCall({ ...CALL, effort: "low" });
  assert.deepEqual(calls[0].body.output_config, { effort: "low" });
  assert.equal(calls[0].body.tool_choice.type, "tool", "structured output stays forced");

  calls = stubFetch([toolInput({ ok: true }), stop("tool_use")]);
  await anthropic.structuredCall({ ...CALL });
  assert.equal("output_config" in calls[0].body, false);
});

test("anthropic: max_tokens leaves room for thinking, which stays enabled", async () => {
  const calls = stubFetch([toolInput({ ok: true }), stop("tool_use")]);
  await anthropic.structuredCall({ ...CALL });
  assert.ok(calls[0].body.max_tokens >= 64000, "thinking and tool input share this budget");
  // Disabling thinking on Opus 5 can make it emit a tool call as plain text, which
  // would break structured output outright. Never send thinking: disabled here.
  assert.equal("thinking" in calls[0].body, false);
});

test("models: renderer, TUI and adapter agree on current Anthropic ids", () => {
  const read = (...p) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");
  const appJs = read("src", "renderer", "app.js");
  const tuiJs = read("tui", "src", "tui", "App.js");
  const adapterJs = read("src", "main", "ai", "anthropic.js");

  const superseded = /claude-(opus-4-8|opus-4-7|opus-4-6|sonnet-4-6|sonnet-4-5)\b/;
  for (const [label, src] of [["renderer", appJs], ["tui", tuiJs], ["adapter", adapterJs]]) {
    assert.ok(!superseded.test(src), `${label} still offers a superseded Claude model`);
    assert.ok(!/claude-[a-z0-9-]*-\d{8}/.test(src), `${label} uses a date-suffixed model id`);
  }

  // The two frontends must not drift apart, which is how the TUI ended up a generation
  // ahead of the desktop app once already.
  const defFast = appJs.match(/defFast:\s*"(claude-[^"]+)"/)[1];
  const defDeep = appJs.match(/defDeep:\s*"(claude-[^"]+)"/)[1];
  const tui = tuiJs.match(/anthropic:\s*\{\s*fast:\s*"([^"]+)",\s*deep:\s*"([^"]+)"/);
  assert.equal(tui[1], defFast, "TUI fast model matches the renderer default");
  assert.equal(tui[2], defDeep, "TUI deep model matches the renderer default");
});
