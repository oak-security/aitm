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

test("models: renderer, TUI and settings agree, and no superseded ids linger", () => {
  const read = (...p) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");
  const appJs = read("src", "renderer", "app.js");
  const tuiJs = read("tui", "src", "tui", "App.js");
  const settingsJs = read("src", "main", "settings.js");
  const sources = {
    renderer: appJs,
    tui: tuiJs,
    settings: settingsJs,
    "anthropic adapter": read("src", "main", "ai", "anthropic.js"),
    "openai adapter": read("src", "main", "ai", "openai-responses.js")
  };

  const SUPERSEDED = new Set([
    "claude-opus-4-8", "claude-opus-4-7", "claude-opus-4-6",
    "claude-sonnet-4-6", "claude-sonnet-4-5",
    "gpt-5", "gpt-5-mini", "gpt-5.5"
  ]);
  // Only quoted string literals count as model ids. Comments may name a retired model
  // as history, and the OpenAI adapter's effort gate is the bare regex /^gpt-5/.
  for (const [label, src] of Object.entries(sources)) {
    for (const [, id] of src.matchAll(/"((?:gpt|claude)-[^"]*)"/g)) {
      assert.ok(!SUPERSEDED.has(id), `${label} still uses the superseded id ${id}`);
      assert.ok(!/^claude-[a-z0-9-]*-\d{8}$/.test(id), `${label} uses the date-suffixed id ${id}`);
    }
  }

  // The frontends must not drift apart, which is how the TUI ended up a generation
  // ahead of the desktop app once already.
  const tuiDefaults = (provider) => {
    const m = tuiJs.match(new RegExp(`${provider}:\\s*\\{\\s*fast:\\s*"([^"]+)",\\s*deep:\\s*"([^"]+)"`));
    return { fast: m[1], deep: m[2] };
  };
  const rendererDefaults = (provider) => {
    const block = appJs.match(new RegExp(`${provider}:\\s*\\{[\\s\\S]*?defDeep:\\s*"[^"]+"`))[0];
    return { fast: block.match(/defFast:\s*"([^"]+)"/)[1], deep: block.match(/defDeep:\s*"([^"]+)"/)[1] };
  };
  for (const provider of ["openai", "anthropic"]) {
    assert.deepEqual(tuiDefaults(provider), rendererDefaults(provider), `${provider} defaults drifted`);
  }

  // settings.js seeds a fresh install, so it must match the renderer's default provider.
  const seeded = {
    fast: settingsJs.match(/modelFast:\s*"([^"]+)"/)[1],
    deep: settingsJs.match(/modelDeep:\s*"([^"]+)"/)[1]
  };
  const provider = settingsJs.match(/provider:\s*"([^"]+)"/)[1];
  assert.deepEqual(seeded, rendererDefaults(provider), "settings.js seeds a non-default model");
});
