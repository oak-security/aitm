import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { render } from 'ink-testing-library';
import { App } from '../src/tui/app.js';
import { LOGO, terminalText } from '../src/tui/logo.js';
import { ApiClient } from '../src/client.js';
import { setup, serve } from './helpers.js';

async function waitFor(check, hint) {
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  assert.fail(hint());
}
const press = async (ui, key) => {
  ui.stdin.write(key);
  await new Promise((r) => setTimeout(r, 80));
};

test('terminal client renders ASCII identity and navigates projects over the real API', async (t) => {
  const { engine, p } = await setup(t);
  const { url } = await serve(t, engine);
  const ui = render(React.createElement(App, { client: new ApiClient(url), pollMs: 100 }));
  t.after(() => ui.unmount());
  await waitFor(
    () => ui.lastFrame()?.includes(p.name),
    () => ui.lastFrame(),
  );
  assert.ok(ui.lastFrame().includes('AI Threat Modeller'));
  assert.ok(ui.lastFrame().includes('TRACE'));
  assert.ok(ui.lastFrame().includes('o-----o'));
  await press(ui, '\r');
  await waitFor(
    () => ui.lastFrame()?.includes('SOURCES'),
    () => ui.lastFrame(),
  );
  assert.ok(ui.lastFrame().includes('Architecture'));
  assert.ok(ui.lastFrame().includes('key configured'));
  await press(ui, '\u001b[B');
  await waitFor(
    () => ui.lastFrame()?.includes('No artifact yet'),
    () => ui.lastFrame(),
  );
  await press(ui, 'q');
  assert.equal(engine.list().length, 1);
});

test('TUI runs the engine, observes a review gate, records approval and starts a draft', async (t) => {
  const { engine, p } = await setup(t);
  const { url } = await serve(t, engine);
  const ui = render(
    React.createElement(App, { client: new ApiClient(url), initialProjectId: p.id, pollMs: 100 }),
  );
  t.after(() => ui.unmount());
  await waitFor(
    () => ui.lastFrame()?.includes('SOURCES'),
    () => ui.lastFrame(),
  );
  await press(ui, 'r');
  await waitFor(
    () => ui.lastFrame()?.includes('AWAITING_REVIEW'),
    () => ui.lastFrame(),
  );
  await press(ui, 'a');
  await press(ui, 'Reviewer');
  await press(ui, '\r');
  await press(ui, 'Sources checked');
  await press(ui, '\r');
  await waitFor(
    () => engine.get(p.id).artifacts.scope.status === 'approved',
    () => ui.lastFrame(),
  );
  await press(ui, 'f');
  await waitFor(
    () => engine.get(p.id).runs.at(-1)?.status === 'completed',
    () => ui.lastFrame(),
  );
  assert.equal(engine.get(p.id).artifacts.report.status, 'draft');
});

test('TUI creates projects, adds notes and edits via the API', async (t) => {
  const { engine } = await setup(t);
  const { url } = await serve(t, engine);
  const ui = render(
    React.createElement(App, {
      client: new ApiClient(url),
      pollMs: 100,
      editor: async (value) => ({ ...value, scope: 'Corrected scope through the editor.' }),
    }),
  );
  t.after(() => ui.unmount());
  await waitFor(
    () => ui.lastFrame()?.includes('Assessments'),
    () => ui.lastFrame(),
  );
  await press(ui, 'n');
  await press(ui, 'TUI created');
  await press(ui, '\r');
  await press(ui, 'Review custody architecture');
  await press(ui, '\r');
  await waitFor(
    () => engine.list().some((p) => p.name === 'TUI created'),
    () => ui.lastFrame(),
  );
  await waitFor(
    () => ui.lastFrame()?.includes('SOURCES'),
    () => ui.lastFrame(),
  );
  await press(ui, 't');
  await press(ui, 'Design notes');
  await press(ui, '\r');
  await press(ui, 'Vault holds deposits.');
  await press(ui, '\r');
  const p = engine.list().find((p) => p.name === 'TUI created');
  await waitFor(
    () => engine.get(p.id).sources.length === 1,
    () => ui.lastFrame(),
  );
  await press(ui, 'e');
  await waitFor(
    () => engine.get(p.id).scope.includes('Corrected scope'),
    () => ui.lastFrame(),
  );
});

test('ASCII logo is portable and source-supplied terminal escapes are stripped', () => {
  assert.match(LOGO, /^[\x20-\x7e\n]+$/);
  assert.equal(LOGO.split('\n').length, 5);
  assert.equal(terminalText('\u001b[2Jdanger\u0007'), '[2Jdanger');
});
