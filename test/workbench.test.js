import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { press } from './tui-input.js';
import { render } from 'ink-testing-library';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { Workbench } from '../src/tui/workbench.js';
import { setup, finish } from './helpers.js';
import { zipFixture } from './zip-fixture.js';
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(ui, text) {
  for (let i = 0; i < 100; i++) {
    if (ui.lastFrame()?.includes(text)) return;
    await pause(30);
  }
  assert.fail(`Missing ${text}: ${ui.lastFrame()}`);
}
async function newProject(ui, name) {
  await press(ui, 'n');
  await press(ui, name);
  await press(ui, '\r');
  await press(ui, '\r');
  await waitFor(ui, 'Add sources');
}
async function addPath(ui, file) {
  await press(ui, '\x1b[B');
  await press(ui, '\x1b[B');
  await press(ui, '\r');
  await press(ui, file);
  await press(ui, '\r');
  await waitFor(ui, 'source(s) imported');
}

test('TUI starts in project chooser, adds multiple sources and switches projects without losing saved analysis', async (t) => {
  const { engine, p, dir } = await setup(t);
  await finish(engine, p.id, { mode: 'full' });
  const existing = engine.get(p.id);
  const file = path.join(dir, 'design.md');
  await writeFile(file, 'Vault holds deposits.');
  const zipped = path.join(dir, 'repo.zip');
  await writeFile(
    zipped,
    zipFixture([{ path: 'repo/src/vault.sol', content: 'contract Vault {}' }]),
  );
  const ui = render(React.createElement(Workbench, { engine, pickerDirectory: dir }));
  t.after(() => ui.unmount());
  await waitFor(ui, 'Projects');
  assert.equal(engine.list().length, 1);
  assert.match(ui.lastFrame(), /New project/);
  assert.ok(!ui.lastFrame().includes('Markdown report'));
  await newProject(ui, 'Combined project');
  const created = engine.list().find((p) => p.name === 'Combined project');
  assert.equal(engine.get(created.id).sources.length, 0);
  await addPath(ui, file);
  assert.equal(engine.get(created.id).sources.length, 1);
  await press(ui, 'i');
  await addPath(ui, zipped);
  assert.equal(engine.get(created.id).sources.length, 2);
  await press(ui, 'o');
  await waitFor(ui, 'Projects');
  await press(ui, 'o');
  await waitFor(ui, 'Open project');
  await press(ui, '\x1b[B');
  await press(ui, '\r');
  await waitFor(ui, 'Scope & source inventory');
  assert.deepEqual(engine.get(p.id), existing);
  await press(ui, 'n');
  await press(ui, 'cancelled');
  await press(ui, '\x1b');
  assert.equal(engine.list().length, 2);
  await waitFor(ui, 'Scope & source inventory');
  for (const frame of ui.frames)
    assert.ok(
      frame.split('\n').length <= 23,
      'Project and import dialogs stay within the viewport',
    );
});
test('TUI file import dialog marks several files and cancellation has no source side effects', async (t) => {
  const { engine, p, dir } = await setup(t);
  const picker = path.join(dir, 'files');
  await mkdir(picker);
  await writeFile(path.join(picker, 'a.md'), 'Architecture');
  await writeFile(path.join(picker, 'b.md'), 'Specification');
  const ui = render(
    React.createElement(Workbench, { engine, projectId: p.id, pickerDirectory: picker }),
  );
  t.after(() => ui.unmount());
  await press(ui, 'i');
  await press(ui, '\x1b[B');
  await press(ui, '\r');
  await waitFor(ui, 'Import 0 selected');
  await press(ui, '\x1b[B');
  await press(ui, '\x1b[B');
  await press(ui, '\x1b[B');
  await press(ui, ' ');
  await press(ui, '\x1b[B');
  await press(ui, ' ');
  await waitFor(ui, 'Import 2 selected');
  await press(ui, '\x1b[H');
  await press(ui, '\r');
  await waitFor(ui, '2 source(s) imported');
  assert.equal(engine.get(p.id).sources.length, 3);
  await press(ui, 'i');
  await press(ui, '\x1b[B');
  await press(ui, '\r');
  await waitFor(ui, 'Import 0 selected');
  await press(ui, '\x1b');
  assert.equal(engine.get(p.id).sources.length, 3);
  await press(ui, 'b');
  await waitFor(ui, 'Manage sources');
  await press(ui, '\x1b[B');
  await press(ui, '\r');
  await waitFor(ui, 'Remove this source');
  await press(ui, '\x1b[B');
  await press(ui, '\r');
  await press(ui, 'REMOVE');
  await press(ui, '\r');
  await waitFor(ui, 'Manage sources');
  assert.equal(engine.get(p.id).sources.length, 2);
});
