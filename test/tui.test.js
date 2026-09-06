import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { render } from 'ink-testing-library';
import { App } from '../src/tui/app.js';
import { reportLines } from '../src/tui/report-reader.js';
import { markdownReport } from '../src/engine/report.js';
import { LOGO, terminalText } from '../src/tui/logo.js';
import { ApiClient } from '../src/client.js';
import { setup, serve, finish } from './helpers.js';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { saveKeys, loadConfig } from '../src/config.js';

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

test('settings masks and replaces a key immediately, persists privately and leaves assessment data untouched', async (t) => {
  const { engine, p, providers, dir } = await setup(t);
  const options = { directory: path.join(dir, 'config'), cwd: dir, packageRoot: dir, env: {} };
  saveKeys({ anthropic: 'keep-anthropic' }, options);
  providers.saveCredentials = (patch) => saveKeys(patch, options);
  providers.keyFile = path.join(options.directory, 'keys.json');
  const before = engine.get(p.id);
  const ui = render(React.createElement(App, { engine, projectId: p.id }));
  t.after(() => ui.unmount());
  await press(ui, 's');
  assert.match(ui.lastFrame(), /API keys · add or replace/);
  await press(ui, '\r');
  assert.match(ui.lastFrame(), /OpenAI/);
  assert.match(ui.lastFrame(), /Anthropic/);
  await press(ui, '\r');
  await press(ui, 'new-private-key');
  assert.match(ui.lastFrame(), /\*{10}/);
  assert.ok(ui.frames.every((frame) => !frame.includes('new-private-key')));
  await press(ui, '\r');
  assert.match(ui.lastFrame(), /active now/);
  assert.equal(providers.keys.openai, 'new-private-key');
  assert.deepEqual(loadConfig(options).keys, {
    openai: 'new-private-key',
    anthropic: 'keep-anthropic',
  });
  assert.deepEqual(engine.get(p.id), before);
  for (const key of ['\r', '\u001b']) {
    await press(ui, 's');
    await press(ui, '\r');
    await press(ui, '\r');
    if (key === '\u001b') await press(ui, 'cancelled-private-key');
    await press(ui, key);
    assert.equal(providers.keys.openai, 'new-private-key');
    assert.ok(ui.frames.every((frame) => !frame.includes('cancelled-private-key')));
  }
});

test('provider and model lists save both choices atomically; cancellation preserves existing analysis', async (t) => {
  const { engine, p, providers } = await setup(t);
  await finish(engine, p.id, { mode: 'full' });
  providers.fetch = async () =>
    Response.json({ data: [{ id: 'claude-sonnet-5' }, { id: 'claude-opus-5' }] });
  const before = engine.get(p.id);
  const ui = render(React.createElement(App, { engine, projectId: p.id }));
  t.after(() => ui.unmount());
  await press(ui, 'p');
  assert.match(ui.lastFrame(), /Provider & models/);
  await press(ui, '\u001b[B');
  await press(ui, '\r');
  assert.match(ui.lastFrame(), /Fast model · 2\/3/);
  assert.match(ui.lastFrame(), /claude-sonnet-5/);
  assert.match(ui.lastFrame(), /claude-opus-5/);
  assert.deepEqual(engine.get(p.id), before);
  await press(ui, '\u001b');
  assert.deepEqual(engine.get(p.id), before);
  await press(ui, 'p');
  await press(ui, '\u001b[B');
  await press(ui, '\r');
  await press(ui, '\u001b[B');
  await press(ui, '\r');
  assert.match(ui.lastFrame(), /Deep model · 3\/3/);
  await press(ui, '\u001b[A');
  await press(ui, '\r');
  const after = engine.get(p.id);
  assert.equal(after.config.provider, 'anthropic');
  assert.equal(after.config.fastModel, 'claude-opus-5');
  assert.equal(after.config.deepModel, 'claude-sonnet-5');
  assert.equal(after.artifacts.report, undefined);
  assert.equal(after.runs.length, before.runs.length);
});

test('selecting the current provider and models again preserves the report', async (t) => {
  const { engine, p, providers } = await setup(t);
  await finish(engine, p.id, { mode: 'full' });
  providers.fetch = async () =>
    Response.json({ data: [{ id: 'gpt-5.6-terra' }, { id: 'gpt-5.6-sol' }] });
  const before = engine.get(p.id).artifacts;
  const ui = render(React.createElement(App, { engine, projectId: p.id }));
  t.after(() => ui.unmount());
  await press(ui, 'v');
  await waitFor(
    () => ui.lastFrame()?.includes('Markdown report'),
    () => ui.lastFrame(),
  );
  await press(ui, 'p');
  await press(ui, '\r');
  await press(ui, '\r');
  await press(ui, '\r');
  assert.match(ui.lastFrame(), /models saved/);
  assert.deepEqual(engine.get(p.id).artifacts, before);
});

test('TUI opens its assessment directly without an HTTP server or source forms', async (t) => {
  const { engine, p } = await setup(t);
  const ui = render(React.createElement(App, { engine, projectId: p.id }));
  t.after(() => ui.unmount());
  await waitFor(
    () => ui.lastFrame()?.includes(p.name),
    () => ui.lastFrame(),
  );
  assert.ok(ui.lastFrame().includes('TRACE'));
  for (const line of LOGO.split('\n')) assert.ok(ui.lastFrame().includes(line));
  await waitFor(
    () => ui.lastFrame()?.includes('SOURCES'),
    () => ui.lastFrame(),
  );
  assert.ok(ui.lastFrame().includes('Architecture'));
  assert.ok(ui.lastFrame().includes('key configured'));
  assert.doesNotMatch(ui.lastFrame(), /Select source|New assessment|Add notes|Connecting/);
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
  const ui = render(React.createElement(App, { engine, projectId: p.id, apiUrl: url }));
  t.after(() => ui.unmount());
  await waitFor(
    () => ui.lastFrame()?.includes('SOURCES'),
    () => ui.lastFrame(),
  );
  await press(ui, 'r');
  await waitFor(
    () => ui.lastFrame()?.includes('Review required:'),
    () => ui.lastFrame(),
  );
  await press(ui, 'a');
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
  assert.equal(engine.get(p.id).runs.at(-1).mode, 'full');
});

test('API edits update the same in-process TUI, and TUI edits reach API readers', async (t) => {
  const { engine, p } = await setup(t);
  const { url } = await serve(t, engine);
  const client = new ApiClient(url);
  const ui = render(
    React.createElement(App, {
      engine,
      projectId: p.id,
      apiUrl: url,
      editor: async (value) => ({ ...value, scope: 'Corrected scope through the editor.' }),
    }),
  );
  t.after(() => ui.unmount());
  await waitFor(
    () => ui.lastFrame()?.includes('SOURCES'),
    () => ui.lastFrame(),
  );
  await client.request('PATCH', client.projectPath(p.id), {
    revision: p.revision,
    name: 'Changed through API',
  });
  await waitFor(
    () => ui.lastFrame()?.includes('Changed through API'),
    () => ui.lastFrame(),
  );
  await press(ui, 'e');
  await waitFor(
    () => ui.lastFrame()?.includes('Corrected scope'),
    () => ui.lastFrame(),
  );
  assert.equal(
    (await client.get(client.projectPath(p.id))).scope,
    'Corrected scope through the editor.',
  );
  ui.unmount();
  assert.equal(engine.events.listenerCount('change'), 0);
});

test('TUI exports reports directly and source refresh preserves unchanged analysis', async (t) => {
  const { engine, p, dir } = await setup(t);
  const file = path.join(dir, 'architecture.md');
  await writeFile(file, 'Vault holds deposits.');
  engine.removeSource(p.id, p.sources[0].id);
  await engine.addSource(p.id, { kind: 'local', path: file });
  await finish(engine, p.id, { mode: 'full' });
  const before = engine.get(p.id).artifacts;
  const ui = render(React.createElement(App, { engine, projectId: p.id, exportDir: dir }));
  t.after(() => ui.unmount());
  await waitFor(
    () => ui.lastFrame()?.includes('Run complete'),
    () => ui.lastFrame(),
  );
  await press(ui, 'u');
  await waitFor(
    () => ui.lastFrame()?.includes('Sources refreshed'),
    () => ui.lastFrame(),
  );
  assert.deepEqual(engine.get(p.id).artifacts, before);
  await press(ui, 'x');
  await press(ui, '\r');
  await press(ui, '\r');
  await waitFor(
    () => ui.lastFrame()?.includes('Exported to'),
    () => ui.lastFrame(),
  );
  const exported = (await readdir(dir)).find((f) => f.startsWith('aitm-') && f.endsWith('.md'));
  assert.match(await readFile(path.join(dir, exported), 'utf8'), /Unauthorized release/);
});

test('TUI shows waiting progress and elapsed time before provider output, then supports cancellation', async (t) => {
  const { engine, p } = await setup(t, { delay: 10000 });
  const { url } = await serve(t, engine);
  const ui = render(React.createElement(App, { engine, projectId: p.id, apiUrl: url }));
  t.after(() => ui.unmount());
  await waitFor(
    () => ui.lastFrame()?.includes('Run full pipeline'),
    () => ui.lastFrame(),
  );
  await press(ui, 'f');
  await waitFor(
    () => ui.lastFrame()?.includes('Waiting for provider response'),
    () => ui.lastFrame(),
  );
  assert.match(ui.lastFrame(), /Phase 2\/6: Ingest & classify/);
  assert.match(ui.lastFrame(), /gpt-5.6-terra/);
  assert.match(ui.lastFrame(), /1\/6 phases ready/);
  for (const line of LOGO.split('\n')) assert.ok(ui.lastFrame().includes(line));
  await waitFor(
    () => ui.lastFrame()?.includes('1s elapsed'),
    () => ui.lastFrame(),
  );
  await press(ui, 'c');
  await waitFor(
    () => ui.lastFrame()?.includes('CANCELLED'),
    () => ui.lastFrame(),
  );
  assert.equal(engine.get(p.id).runs.at(-1).status, 'cancelled');
});

test('TUI follows sequential TRACE stages and shows citation review notes without a failure banner', async (t) => {
  const { engine, p, providers } = await setup(t, { delay: 350 });
  const call = providers.call.bind(providers);
  providers.call = async (input) => {
    const result = await call(input);
    if (input.phase === 'model')
      result.data.edges[0].evidence = [
        { ...result.data.edges[0].evidence[0], quote: 'Unmatched citation.' },
      ];
    return result;
  };
  const { url } = await serve(t, engine);
  const ui = render(React.createElement(App, { engine, projectId: p.id, apiUrl: url }));
  t.after(() => ui.unmount());
  await waitFor(
    () => ui.lastFrame()?.includes('SOURCES'),
    () => ui.lastFrame(),
  );
  await press(ui, 'f');
  for (const phase of [
    'Construct TRACE model',
    'STRIDE & ranking',
    'Attack trees',
    'Roadmap & report',
  ])
    await waitFor(
      () => new RegExp(`${phase}\\s+1/`).test(ui.lastFrame()),
      () => ui.lastFrame(),
    );
  await waitFor(
    () => ui.lastFrame()?.includes('Run complete'),
    () => ui.lastFrame(),
  );
  assert.match(ui.lastFrame(), /1 source review note/);
  assert.doesNotMatch(ui.lastFrame(), /FAILED|evidence\[0\]/);
  assert.equal(engine.get(p.id).runs.at(-1).status, 'completed');
  await press(ui, '\u001b[A');
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.match(
    ui.lastFrame(),
    /Collusion & coordination\s+1\//,
    'manual navigation is not reset by engine updates',
  );
});

test('TUI shows a resumable TRACE step and keeps technical validation details in the log', async (t) => {
  const { engine, p } = await setup(t, { malformed: 'model' });
  const { url } = await serve(t, engine);
  const ui = render(React.createElement(App, { engine, projectId: p.id, apiUrl: url }));
  t.after(() => ui.unmount());
  await waitFor(
    () => ui.lastFrame()?.includes('SOURCES'),
    () => ui.lastFrame(),
  );
  await press(ui, 'f');
  await waitFor(
    () =>
      ui.lastFrame()?.includes('TRACE paused at Construct TRACE model') &&
      ui.lastFrame()?.includes('Earlier steps are saved'),
    () => ui.lastFrame(),
  );
  assert.match(ui.lastFrame(), /Earlier steps are saved/);
  assert.doesNotMatch(ui.lastFrame(), /overview:|FAILED:/);
  await press(ui, 'l');
  assert.match(ui.lastFrame(), /overview:/);
});

test('ASCII logo is portable and source-supplied terminal escapes are stripped', () => {
  assert.match(LOGO, /^[\x20-\x7e\n]+$/);
  assert.equal(LOGO.split('\n').length, 5);
  assert.equal(terminalText('\u001b[2Jdanger\u0007'), '[2Jdanger');
});

test('completed and imported assessments view the full report on request with a visible logo at 80x24', async (t) => {
  const { engine, p, providers } = await setup(t);
  await finish(engine, p.id, { mode: 'full' });
  const imported = engine.import(engine.export(p.id));
  assert.equal(imported.runs.length, 0);
  const calls = providers.calls.length;
  const ui = render(React.createElement(App, { engine, projectId: imported.id }));
  t.after(() => ui.unmount());
  Object.defineProperty(ui.stdout, 'columns', { value: 80, configurable: true });
  ui.stdout.rows = 24;
  ui.stdout.emit('resize');
  await press(ui, 'v');
  await waitFor(
    () => ui.lastFrame()?.includes('Markdown report'),
    () => ui.lastFrame(),
  );
  for (const line of LOGO.split('\n')) assert.ok(ui.lastFrame().includes(line));
  assert.match(ui.lastFrame(), /v View Markdown\s+x Export/);
  assert.match(ui.lastFrame(), /DRAFT/);
  assert.match(ui.lastFrame(), /not authored, reviewed or endorsed\s+by Oak Security/);
  assert.ok(ui.lastFrame().split('\n').length <= 24, 'the logo and report fit the terminal');
  await press(ui, ']');
  assert.match(ui.lastFrame(), /Executive summary/);
  await press(ui, ']');
  assert.match(ui.lastFrame(), /Scope/);
  await press(ui, '[');
  assert.match(ui.lastFrame(), /Executive summary/);
  await press(ui, '\u001b[F');
  assert.match(ui.lastFrame(), /endorsed the assessment/);
  await press(ui, '\u001b[H');
  assert.match(ui.lastFrame(), /TRACE threat model/);
  await press(ui, '\u001b[A');
  assert.doesNotMatch(ui.lastFrame(), /Markdown report/);
  await press(ui, 'v');
  assert.match(ui.lastFrame(), /Markdown report/);
  assert.equal(providers.calls.length, calls, 'viewing a saved report makes no AI calls');
});

test('reopening a completed assessment never emits a frame taller than the terminal', async (t) => {
  const { engine, p } = await setup(t);
  await finish(engine, p.id, { mode: 'full' });
  for (const [columns, rows] of [
    [80, 24],
    [100, 30],
    [120, 36],
    [60, 20],
    [80, 16],
  ]) {
    const ui = render(React.createElement(App, { engine, projectId: p.id }));
    Object.defineProperty(ui.stdout, 'columns', { value: columns, configurable: true });
    ui.stdout.rows = rows;
    const before = ui.frames.length;
    ui.stdout.emit('resize');
    await press(ui, 'v');
    await waitFor(
      () => ui.lastFrame()?.includes('Markdown report'),
      () => ui.lastFrame(),
    );
    await press(ui, '\u001b[F');
    for (const frame of ui.frames.slice(before)) {
      assert.ok(
        frame.split('\n').length <= rows - 1,
        `${columns}x${rows}: ${frame.split('\n').length} rows scroll the menu off screen`,
      );
      assert.ok(frame.includes('f Run full pipeline'), 'menu stays in every report frame');
    }
    ui.unmount();
  }
});

test('the report reader includes the entire export, with readable tables and unverified claims', async (t) => {
  const { engine, p } = await setup(t);
  await finish(engine, p.id, { mode: 'full' });
  const project = engine.get(p.id);
  project.artifacts.model.reviewNotes = [
    {
      claim: 'Vault',
      note: 'Evidence review required: check custody.',
      path: 'model.components.0',
    },
  ];
  const lines = reportLines(markdownReport(project), 76);
  const text = lines.map((l) => l.text).join('\n');
  for (const heading of [
    'Source inventory',
    'Evidence files',
    'Evidence review required',
    'Threat actors',
    'Roles',
    'Protected assets',
    'Critical invariants',
    'Edges & trust boundaries',
    'Ranked STRIDE threats',
    'Attack trees',
    'Collusion & coordination',
    'Mitigation roadmap',
    'Review record',
    'Notice',
  ])
    assert.match(text, new RegExp(heading));
  assert.match(text, /Threat: Unauthorized release/);
  assert.match(text, /Evidence review required: check custody/);
  assert.ok(lines.every((line) => line.text.length <= 76));
  assert.doesNotMatch(text, /^\| .*\|$/m, 'tables must not require horizontal scrolling');
  assert.match(
    reportLines('| Name | Detail |\n| --- | --- |\n| A \\| B | first<br>second |', 76)
      .map((l) => l.text)
      .join('\n'),
    /Name: A \| B\nDetail: first\nsecond/,
  );
});

test('viewing Markdown never exports PDF; PDF is an explicit export choice', async (t) => {
  const { engine, p, dir, providers } = await setup(t);
  await finish(engine, p.id, { mode: 'full' });
  const files = await readdir(dir);
  const calls = providers.calls.length;
  const ui = render(React.createElement(App, { engine, projectId: p.id, exportDir: dir }));
  t.after(() => ui.unmount());
  await press(ui, 'v');
  await waitFor(
    () => ui.lastFrame()?.includes('Markdown report'),
    () => ui.lastFrame(),
  );
  await press(ui, 'v');
  await press(ui, 'o');
  assert.deepEqual(await readdir(dir), files);
  assert.equal(providers.calls.length, calls);
  assert.doesNotMatch(ui.lastFrame(), /Open PDF|Beyer|Dr\. Stefan|Source limitations/);
  await press(ui, '?');
  assert.match(ui.lastFrame(), /Saved assessments:/);
  assert.match(ui.lastFrame(), /Markdown is assembled from the saved assessment/);
  await press(ui, 'v');
  await press(ui, 'x');
  for (const char of 'markdown') await press(ui, '\x7f');
  await press(ui, 'pdf');
  await press(ui, '\r');
  await press(ui, '\r');
  await waitFor(
    () => ui.lastFrame()?.includes('Exported to'),
    () => ui.lastFrame(),
  );
  const pdf = (await readdir(dir)).find((file) => file.endsWith('.pdf'));
  assert.equal((await readFile(path.join(dir, pdf))).subarray(0, 5).toString(), '%PDF-');
});

test('viewing before report generation gives a clear next step without starting a run', async (t) => {
  const { engine, p, providers } = await setup(t);
  const ui = render(React.createElement(App, { engine, projectId: p.id }));
  t.after(() => ui.unmount());
  await waitFor(
    () => ui.lastFrame()?.includes('SOURCES'),
    () => ui.lastFrame(),
  );
  await press(ui, 'v');
  assert.match(ui.lastFrame(), /report is not ready yet/);
  await press(ui, 'o');
  assert.match(ui.lastFrame(), /report is not ready yet/);
  assert.equal(providers.calls.length, 0);
  assert.equal(engine.get(p.id).runs.length, 0);
});
