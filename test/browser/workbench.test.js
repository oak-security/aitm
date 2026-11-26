import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import https from 'node:https';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { chromium } from 'playwright';
import { browserServer } from './server.js';
import { zipFixture } from '../zip-fixture.js';

const output = 'artifacts/qa/web';
// AITM_BROWSER_CHANNEL=chrome runs the suite in an installed Google Chrome.
const channel = process.env.AITM_BROWSER_CHANNEL;
async function setup(t) {
  const server = await browserServer();
  let browser;
  const errors = [],
    remote = [];
  // Registered before the launch: a missing browser must fail the test, not hang it.
  t.after(async () => {
    await browser?.close();
    await server.close();
    assert.deepEqual(errors, []);
    assert.deepEqual(remote, []);
  });
  browser = await chromium.launch(channel ? { channel } : {});
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => {
    if (!r.url().startsWith(server.url)) remote.push(r.url());
  });
  await mkdir(output, { recursive: true });
  // Sign in as the CLI does: the launch URL sets the access cookie.
  await page.goto(server.webUrl());
  await page.getByRole('button', { name: 'New project', exact: true }).first().waitFor();
  return { ...server, page, context, bearer: { authorization: `Bearer ${server.token}` } };
}
async function open(page, url) {
  await page.goto(url);
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  await page.getByLabel('Project name', { exact: true }).fill('Vault architecture.md');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await closed(page);
  await page.getByRole('button', { name: '+ Add sources', exact: true }).click();
  await page.getByLabel('Choose source files').setInputFiles({
    name: 'Vault architecture.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(
      'Vault holds deposits.\nA committee authorizes releases.\n<img src="https://example.invalid/tracking" onerror="window.pwned=true">',
    ),
  });
  await closed(page);
  await page
    .locator('#sidebar')
    .getByRole('link', { name: /Overview/ })
    .click();
  await page.locator('[data-action="run-full"]').waitFor();
  return new URL(page.url()).hash.split('/')[2];
}
async function visit(page, url, id, view, heading) {
  await page.goto(`${url}/#/projects/${id}/${view}`);
  await page.getByRole('heading', { name: heading, exact: true }).first().waitFor();
}
async function status(page, value) {
  await page.waitForFunction(
    (text) => document.querySelector('#activity')?.textContent.includes(text),
    value,
    { timeout: 20000 },
  );
}
async function closed(page) {
  await page.locator('#dialog').waitFor({ state: 'hidden' });
}
async function approve(page, index = 0) {
  await page.getByRole('button', { name: 'Approve review', exact: true }).nth(index).click();
  await page.locator('dialog').getByRole('button', { name: 'Approve review', exact: true }).click();
  await closed(page);
}

test(
  'navigation finishes when a live refresh overtakes its first request',
  { timeout: 10000 },
  async (t) => {
    const { page, url, engine } = await setup(t);
    const id = engine.create({ name: 'Navigation race', scope: 'Synthetic project' }).id;
    await visit(page, url, id, 'overview', 'Navigation race');
    // Let the initial SSE connection refresh settle before controlling the next two requests.
    await new Promise((resolve) => setTimeout(resolve, 300));
    let first = true;
    await page.route(`**/v1/projects/${id}`, async (route) => {
      if (first) {
        first = false;
        // Start another refresh without changing the project revision.
        setTimeout(() => engine.events.emit('change', null), 20);
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      await route.continue();
    });
    await page
      .locator('#sidebar')
      .getByRole('link', { name: /Sources & Scope/ })
      .click();
    await page
      .getByRole('heading', { name: 'Sources & Scope', exact: true })
      .waitFor({ timeout: 2500 });
  },
);

test(
  'browser autoruns after import, shows batch progress and approves without identity fields',
  { timeout: 60000 },
  async (t) => {
    const { page, url, engine, providers } = await setup(t);
    const id = await open(page, url);
    const call = providers.call.bind(providers);
    providers.options.delay = 250;
    providers.call = async (input) => {
      const result = await call(input);
      const context = JSON.parse(input.user);
      if (context.previousDraft) result.data = structuredClone(context.previousDraft);
      return result;
    };
    await visit(page, url, id, 'scope', 'Sources & Scope');
    assert.equal(
      await page
        .locator('#topbar')
        .getByRole('button', { name: 'Run full pipeline', exact: true })
        .isVisible(),
      true,
    );
    await page.getByRole('button', { name: '+ Add sources', exact: true }).click();
    await page.getByLabel('Run full pipeline after import').check();
    await page.getByLabel('Choose source files').setInputFiles({
      name: 'Full specifications.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from('Vault holds deposits.\n' + 'Release rules.\n'.repeat(18000)),
    });
    await closed(page);
    await page.waitForFunction(() =>
      /Batch 2\/[2-9]/.test(document.querySelector('#activity').textContent),
    );
    await page.screenshot({ path: 'artifacts/qa/feedback/classification-progress.png' });
    assert.equal(await page.locator('#topbar [data-action="run-full"]').isDisabled(), true);
    await status(page, 'Completed');
    assert.equal(engine.get(id).runs.length, 1);
    assert.equal(engine.get(id).runs[0].mode, 'full');
    assert.equal(engine.get(id).artifacts.trees.data.trees.length, 3);
    assert.match(
      await page.locator('#toast').textContent(),
      /Pipeline complete\. The report is ready\./,
    );
    await visit(page, url, id, 'model', 'Construct TRACE Model');
    await page.getByRole('button', { name: 'Approve review', exact: true }).first().click();
    assert.equal(await page.locator('dialog input').count(), 0);
    await page
      .locator('dialog')
      .getByRole('button', { name: 'Approve review', exact: true })
      .click();
    await closed(page);
    assert.equal(engine.get(id).artifacts.model.status, 'approved');
    assert.equal(engine.get(id).artifacts.model.review.reviewer, '');
    await page.setViewportSize({ width: 390, height: 844 });
    const button = page.locator('#topbar [data-action="run-full"]');
    const box = await button.boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= 390 && box.y >= 0 && box.y < 80);
    await page.screenshot({ path: 'artifacts/qa/feedback/mobile-full-pipeline.png' });
  },
);

test(
  'browser manages independent projects with document, ZIP and public URL sources',
  { timeout: 60000 },
  async (t) => {
    const { page, url, engine } = await setup(t);
    const output = 'artifacts/qa/projects';
    await mkdir(output, { recursive: true });
    const repo = zipFixture([
      { path: 'vault-main/README.md', content: 'Vault holds deposits.' },
      { path: 'vault-main/src/vault.sol', content: 'contract Vault {}' },
      { path: 'vault-main/.env', content: 'IGNORED=secret' },
    ]);
    const requests = [];
    t.mock.method(https, 'get', (source, _options, callback) => {
      requests.push(source.href);
      const zipped = source.pathname === '/repository';
      const response = Readable.from([
        zipped
          ? repo
          : Buffer.from('<h1>Vault holds deposits.</h1><a href="/ignored">Other page</a>'),
      ]);
      response.statusCode = 200;
      response.headers = { 'content-type': zipped ? 'application/zip' : 'text/html' };
      callback(response);
      return new EventEmitter();
    });
    await page.goto(url);
    await page.getByRole('heading', { name: 'Projects', exact: true }).waitFor();
    assert.equal(engine.list().length, 0);
    await page.getByRole('button', { name: 'New project', exact: true }).click();
    await page.getByLabel('Project name', { exact: true }).fill('Combined vault assessment');
    await page.getByRole('button', { name: 'Create project', exact: true }).click();
    await closed(page);
    const alpha = engine.list()[0].id;
    assert.equal(engine.get(alpha).sources.length, 0);
    await page.getByRole('button', { name: '+ Add sources', exact: true }).click();
    assert.equal(await page.getByLabel('Public URLs or local paths').inputValue(), '');
    await page.screenshot({ path: `${output}/import-dialog.png` });
    await page.getByLabel('Choose source files').setInputFiles([
      {
        name: 'Architecture.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        buffer: await readFile(new URL('../fixtures/architecture.docx', import.meta.url)),
      },
      { name: 'Vault repository.zip', mimeType: 'application/zip', buffer: repo },
    ]);
    await closed(page);
    assert.equal(engine.get(alpha).sources.length, 2);
    assert.ok(engine.get(alpha).sources[1].files.some((f) => f.path.endsWith('vault.sol')));
    assert.ok(!engine.get(alpha).sources[1].files.some((f) => f.path.endsWith('.env')));
    await page.getByRole('button', { name: '+ Add sources', exact: true }).click();
    await page
      .getByLabel('Public URLs or local paths')
      .fill('https://sources.example/whitepaper\nhttps://sources.example/repository');
    await page.getByRole('button', { name: 'Import sources', exact: true }).click();
    await closed(page);
    const sources = engine.get(alpha).sources;
    assert.equal(sources.length, 4);
    assert.deepEqual(requests, [
      'https://sources.example/whitepaper',
      'https://sources.example/repository',
    ]);
    assert.match(sources[2].files[0].text, /Other page/);
    await page.screenshot({ path: `${output}/source-inventory.png` });
    await visit(page, url, alpha, 'overview', 'Combined vault assessment');
    await page.getByRole('button', { name: 'Run full pipeline', exact: true }).click();
    await page.locator('#activity .spinner').waitFor();
    // Switching projects must not cancel the active engine job.
    await page.getByRole('button', { name: '+ New project', exact: true }).click();
    await page.getByLabel('Project name', { exact: true }).fill('Separate assessment');
    await page.getByRole('button', { name: 'Create project', exact: true }).click();
    await closed(page);
    const beta = engine.list().find((p) => p.id !== alpha).id;
    assert.equal(engine.get(beta).sources.length, 0);
    await page.getByRole('button', { name: 'Open project', exact: true }).click();
    await page
      .locator('dialog')
      .getByRole('button', { name: /Combined vault assessment/ })
      .click();
    await closed(page);
    await status(page, 'Completed');
    const assessed = engine.get(alpha);
    assert.equal(assessed.runs.length, 1);
    assert.equal(assessed.artifacts.trees.data.trees.length, 3);
    assert.equal(
      assessed.artifacts.model.generation.sourceCoverage.files,
      sources.flatMap((s) => s.files).length,
    );
    const before = engine.get(alpha);
    await visit(page, url, alpha, 'scope', 'Sources & Scope');
    await page.getByRole('button', { name: '+ Add sources', exact: true }).click();
    await page.getByLabel('Choose source files').setInputFiles([
      { name: 'valid.md', mimeType: 'text/plain', buffer: Buffer.from('Additional evidence') },
      { name: 'broken.zip', mimeType: 'application/zip', buffer: Buffer.from('not a ZIP') },
    ]);
    await page.waitForFunction(() =>
      document.querySelector('#dialog-error')?.textContent.includes('ZIP'),
    );
    assert.deepEqual(engine.get(alpha), before);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('button', { name: 'Replace source', exact: true }).first().click();
    await page.getByLabel('Choose source files').setInputFiles({
      name: 'Revised architecture.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from('Vault holds deposits. Updated architecture.'),
    });
    await closed(page);
    const replaced = engine.get(alpha);
    assert.equal(replaced.sources.length, 4);
    assert.deepEqual(replaced.sources.slice(1), sources.slice(1));
    assert.equal(replaced.artifacts.report, undefined);
    await page.getByRole('button', { name: 'Remove', exact: true }).last().click();
    await page
      .locator('dialog')
      .getByRole('button', { name: 'Remove source', exact: true })
      .click();
    await closed(page);
    assert.equal(engine.get(alpha).sources.length, 3);
    assert.equal(engine.get(beta).sources.length, 0);
    await page.getByLabel('Assessment name', { exact: true }).fill('Vault · reviewed scope');
    await page.getByRole('button', { name: 'Save scope', exact: true }).click();
    await page.waitForFunction(() =>
      document.querySelector('.breadcrumb').textContent.includes('Vault · reviewed scope'),
    );
    await page.goto(url);
    await page.getByRole('heading', { name: 'Projects', exact: true }).waitFor();
    await page.screenshot({ path: `${output}/project-chooser.png` });
    assert.equal(engine.list().length, 2);
  },
);

test(
  'browser runs the full v2 pipeline, inspects every artifact, reads and exports the report',
  { timeout: 60000 },
  async (t) => {
    const { page, url, engine, dir, server, bearer } = await setup(t);
    const pdfRequests = [];
    server.on('request', (r) => {
      if (r.url.includes('format=pdf')) pdfRequests.push(r.url);
    });
    const id = await open(page, url);
    await page.getByRole('button', { name: 'Run full pipeline', exact: true }).click();
    await page.locator('#activity .spinner').waitFor();
    await page.reload(); // Reattach to a running job, without launching another.
    await status(page, 'Completed');
    const p = engine.get(id);
    assert.equal(p.runs.length, 1);
    assert.equal(p.runs[0].status, 'completed');
    assert.equal(p.artifacts.trees.data.trees.length, 3);
    assert.ok(Object.values(p.artifacts).every((a) => a.status === 'draft'));
    await page.screenshot({ path: `${output}/overview.png` });
    await page
      .locator('#sidebar')
      .getByRole('link', { name: /Sources & Scope/ })
      .click();
    await page.getByRole('heading', { name: 'Sources & Scope', exact: true }).waitFor();
    await page.getByText('Browse 1 evidence file(s)', { exact: true }).click();
    await page.getByRole('button', { name: /Vault architecture.md.*lines/ }).click();
    assert.match(await page.locator('.source-code').innerText(), /window.pwned=true/);
    assert.equal(await page.evaluate(() => window.pwned), undefined);
    await page.getByRole('button', { name: 'Close dialog' }).click();
    await visit(page, url, id, 'model', 'Construct TRACE Model');
    assert.equal(await page.locator('.object-card').count(), 6);
    await page.screenshot({ path: `${output}/trace-model.png` });
    await visit(page, url, id, 'stride', 'STRIDE Identification & Ranking');
    assert.equal(await page.locator('.threat-card').count(), 3);
    await page.getByLabel('Find a threat', { exact: true }).fill('signer availability');
    assert.equal(await page.locator('.threat-card:visible').count(), 1);
    await page.getByLabel('Find a threat', { exact: true }).fill('');
    await page.getByLabel('STRIDE category').selectOption('Denial of service');
    assert.equal(await page.locator('.threat-card:visible').count(), 1);
    await page.getByLabel('STRIDE category').selectOption('All categories');
    await page.screenshot({ path: `${output}/stride.png` });
    await visit(page, url, id, 'trees', 'Build Attack Trees');
    assert.equal(await page.locator('.tree').count(), 3);
    assert.equal(await page.locator('.tree-node').count(), 6);
    await page.screenshot({ path: `${output}/attack-trees.png` });
    await visit(page, url, id, 'coordination', 'Collusion & Coordination');
    await page.getByRole('heading', { name: 'Committee collusion' }).waitFor();
    await visit(page, url, id, 'report', 'Roadmap & Report');
    await page.locator('.report-paper').waitFor();
    assert.match(
      await page.locator('.report-paper').innerText(),
      /not authored, reviewed or endorsed by Oak Security/,
    );
    const report = await (
      await fetch(`${url}/v1/projects/${id}/report`, { headers: bearer })
    ).text();
    await page.getByRole('button', { name: 'Markdown source', exact: true }).click();
    assert.equal(await page.locator('.raw-report').textContent(), report);
    await page.getByRole('button', { name: 'Read report', exact: true }).click();
    const lastSection = await page.locator('[data-section]').last().getAttribute('data-section');
    await page.locator('[data-section]').last().click();
    const sectionBox = await page.locator(`#${lastSection}`).boundingBox();
    assert.ok(
      sectionBox.y >= 71 && sectionBox.y < 955,
      'Section links jump to the requested heading',
    );
    const box = await page.locator('#sidebar').boundingBox();
    assert.equal(box.y, 0);
    assert.equal(await page.locator('#topbar').isVisible(), true);
    await page.locator('#workspace').evaluate((el) => {
      el.scrollTop = 0;
    });
    await page.screenshot({ path: `${output}/report.png` });
    assert.deepEqual(pdfRequests, []);
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Download Markdown' }).click();
    const download = await downloadPromise;
    assert.equal(await readFile(await download.path(), 'utf8'), report);
    const pdfPromise = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Download PDF' }).click();
    const pdf = await pdfPromise;
    assert.equal((await readFile(await pdf.path())).subarray(0, 4).toString(), '%PDF');
    assert.equal(pdfRequests.length, 1);
    const exportPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export project', exact: true }).click();
    const exported = await exportPromise;
    const snapshot = await readFile(await exported.path(), 'utf8');
    assert.equal(JSON.parse(snapshot).format, 'aitm-project');
    const importFile = path.join(dir, 'snapshot.json');
    await writeFile(importFile, snapshot);
    await page.getByRole('button', { name: 'Import project JSON', exact: true }).click();
    await page.getByLabel('Choose project JSON').setInputFiles(importFile);
    await page.waitForFunction((old) => !location.hash.includes(old), id);
    await page.getByRole('button', { name: 'Run full pipeline', exact: true }).waitFor();
    assert.equal(engine.list().length, 2);
    // Reopen a completed report directly and verify navigation is still visible.
    await visit(page, url, id, 'report', 'Roadmap & Report');
    await page.locator('.report-paper').waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    await page.getByRole('button', { name: 'Toggle navigation' }).click();
    await page
      .locator('#sidebar')
      .getByRole('link', { name: /STRIDE/ })
      .click();
    await page.getByRole('heading', { name: 'STRIDE Identification & Ranking' }).waitFor();
    assert.equal(await page.locator('#sidebar').isVisible(), false);
    await page.screenshot({ path: `${output}/mobile.png` });
  },
);

test(
  'browser review gates, validation errors, artifact edits and revision conflicts preserve work',
  { timeout: 60000 },
  async (t) => {
    const { page, url, engine } = await setup(t);
    const id = await open(page, url);
    // Scope and source inventory need no approval: the first gate is the TRACE model.
    await visit(page, url, id, 'scope', 'Sources & Scope');
    assert.equal(
      await page.getByRole('button', { name: 'Approve review', exact: true }).count(),
      0,
    );
    await visit(page, url, id, 'overview', 'Vault architecture.md');
    await page.getByRole('button', { name: 'Run with review gates' }).click();
    await status(page, 'Awaiting review');
    assert.equal(engine.get(id).runs.at(-1).phase, 'model');
    assert.match(
      await page.locator('#toast').textContent(),
      /Construct TRACE model is ready\. Review and approve it to continue\./,
    );
    await visit(page, url, id, 'stride', 'STRIDE Identification & Ranking');
    await page.getByRole('button', { name: 'Generate step' }).click();
    await page.waitForFunction(() =>
      document.querySelector('#error').textContent.includes('Review Construct TRACE model first'),
    );
    await visit(page, url, id, 'model', 'Construct TRACE Model');
    await page.getByRole('button', { name: 'Edit details', exact: true }).first().click();
    await page
      .getByLabel('Description', { exact: true })
      .fill('A compromised signer with release authority.');
    await page.getByRole('button', { name: 'Save draft', exact: true }).click();
    await closed(page);
    assert.equal(
      engine.get(id).artifacts.model.data.threatActors[0].description,
      'A compromised signer with release authority.',
    );
    await page.getByRole('button', { name: 'Edit draft', exact: true }).click();
    await page.getByLabel('Artifact JSON').fill('{');
    await page.getByRole('button', { name: 'Save draft', exact: true }).click();
    await page.waitForFunction(() =>
      document.querySelector('#dialog-error').textContent.includes('not valid'),
    );
    assert.equal(await page.getByLabel('Artifact JSON').inputValue(), '{');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await approve(page);
    await visit(page, url, id, 'scope', 'Sources & Scope');
    await page.getByLabel('Scope and boundaries').fill('Unsaved scope change');
    const current = engine.get(id);
    engine.update(id, { revision: current.revision, name: 'Updated in another interface' });
    await page.waitForFunction(() =>
      document.querySelector('.breadcrumb').textContent.includes('Updated in another interface'),
    );
    assert.equal(
      await page.getByLabel('Scope and boundaries').inputValue(),
      'Unsaved scope change',
    );
    await page.getByRole('button', { name: 'Save scope', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('#error').hidden);
    assert.match(await page.locator('#error').textContent(), /changed|revision|Reload/i);
    assert.equal(
      await page.getByLabel('Scope and boundaries').inputValue(),
      'Unsaved scope change',
    );
    await page
      .locator('#sidebar')
      .getByRole('link', { name: /Overview/ })
      .click();
    await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
    await closed(page);
    await page
      .getByRole('heading', { name: 'Updated in another interface', exact: true })
      .waitFor();
  },
);

test(
  'browser settings mask replacement keys, use provider model lists and preserve reports on no-op saves',
  { timeout: 60000 },
  async (t) => {
    const { page, url, engine, providers, bearer } = await setup(t);
    const id = await open(page, url);
    await page.getByRole('button', { name: 'Run full pipeline', exact: true }).click();
    await status(page, 'Completed');
    await visit(page, url, id, 'settings', 'Settings & Models');
    await page.waitForFunction(
      () => document.querySelector('[name="fastModel"]').options.length === 3,
    );
    assert.equal(
      await page.getByLabel('AI provider', { exact: true }).evaluate((el) => el.tagName),
      'SELECT',
    );
    assert.equal(await page.getByLabel('New API key').getAttribute('type'), 'password');
    const original = engine.get(id).artifacts.report.generatedAt;
    await page.getByLabel('New API key').fill('browser-replacement-private-key');
    await page.getByRole('button', { name: 'Save key', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[name="apiKey"]').value === '');
    assert.equal(providers.keys.openai, 'browser-replacement-private-key');
    assert.ok(!JSON.stringify(engine.get(id)).includes('browser-replacement-private-key'));
    assert.ok(
      !(await page.locator('body').innerText()).includes('browser-replacement-private-key'),
    );
    assert.ok(
      !(await (await fetch(`${url}/v1/providers`, { headers: bearer })).text()).includes(
        'browser-replacement-private-key',
      ),
    );
    await page.getByRole('button', { name: 'Save assessment settings', exact: true }).click();
    await page.waitForFunction(() =>
      document.querySelector('#toast').textContent.includes('Assessment settings saved'),
    );
    assert.equal(engine.get(id).artifacts.report.generatedAt, original);
    await page.getByRole('button', { name: 'Test connection', exact: true }).click();
    await page.waitForFunction(() =>
      document.querySelector('#toast').textContent.includes('verified'),
    );
    await page.getByLabel('AI provider', { exact: true }).selectOption('anthropic');
    await page.waitForFunction(
      () =>
        document.querySelector('[name="fastModel"]').options.length === 3 &&
        document.querySelector('[name="fastModel"]').value.startsWith('claude'),
    );
    await page.getByLabel('Fast model', { exact: true }).selectOption('claude-test');
    await page.getByLabel('Reasoning effort').selectOption('high');
    await page.screenshot({ path: `${output}/settings.png` });
    await page.getByRole('button', { name: 'Save assessment settings', exact: true }).click();
    await page.waitForFunction(
      () =>
        document.querySelector('#activity').textContent.includes('0/7') ||
        document.querySelector('#toast').textContent.includes('Assessment settings saved'),
    );
    await page.waitForFunction(() =>
      document.querySelector('.key-status').textContent.includes('anthropic'),
    );
    const config = engine.get(id).config;
    assert.equal(config.provider, 'anthropic');
    assert.equal(config.fastModel, 'claude-test');
    assert.equal(config.effort, 'high');
    assert.equal(engine.get(id).artifacts.report, undefined);
  },
);

test(
  'browser cancels, resumes, handles failed jobs and reopens a project without duplicate assessments',
  { timeout: 60000 },
  async (t) => {
    const { page, url, engine, providers, dir } = await setup(t);
    providers.options.delay = 600;
    const source = path.join(dir, 'local-source.md');
    await writeFile(source, 'Vault holds deposits.\nA committee authorizes releases.');
    await page.goto(url);
    await page.getByRole('button', { name: 'New project', exact: true }).click();
    await page.getByLabel('Project name', { exact: true }).fill('local-source.md');
    await page.getByRole('button', { name: 'Create project', exact: true }).click();
    await closed(page);
    await page.getByRole('button', { name: '+ Add sources', exact: true }).click();
    await page.getByLabel('Public URLs or local paths').fill(source);
    await page.getByRole('button', { name: 'Import sources', exact: true }).click();
    await closed(page);
    await page
      .locator('#sidebar')
      .getByRole('link', { name: /Overview/ })
      .click();
    await page.locator('[data-action="run-full"]').waitFor();
    const id = engine.list()[0].id;
    await page.getByRole('button', { name: 'Run full pipeline', exact: true }).click();
    await page.locator('#activity .spinner').waitFor();
    await page.locator('#activity').getByRole('button', { name: 'Cancel', exact: true }).click();
    await status(page, 'Cancelled');
    assert.equal(engine.get(id).artifacts.report, undefined);
    providers.options.delay = 40;
    providers.options.malformed = 'model';
    await page.getByRole('button', { name: 'Run full pipeline', exact: true }).click();
    await status(page, 'Failed');
    await visit(page, url, id, 'log', 'Run History');
    assert.match(await page.locator('.event-log').first().innerText(), /Failed/);
    providers.options.malformed = undefined;
    await visit(page, url, id, 'overview', 'local-source.md');
    await page.getByRole('button', { name: 'Run full pipeline', exact: true }).click();
    await status(page, 'Completed');
    await page.getByRole('button', { name: 'Open project', exact: true }).click();
    await page
      .locator('dialog')
      .getByRole('button', { name: /local-source.md/ })
      .click();
    await closed(page);
    assert.equal(engine.list().length, 1);
    assert.equal(engine.get(id).runs.length, 3);
    await visit(page, url, id, 'scope', 'Sources & Scope');
    await page.getByRole('button', { name: 'Replace source', exact: true }).click();
    await page.getByLabel('Public URLs or local paths').fill(source);
    await page
      .locator('dialog')
      .getByRole('button', { name: 'Replace source', exact: true })
      .click();
    await closed(page);
    await page.getByRole('button', { name: 'Refresh snapshot' }).click();
    await page.locator('dialog').getByRole('button', { name: 'Refresh snapshot' }).click();
    await closed(page);
    await visit(page, url, id, 'overview', 'local-source.md');
    await page.getByText('Assessment actions', { exact: true }).click();
    await page.getByRole('button', { name: 'Delete assessment', exact: true }).click();
    await page
      .locator('dialog')
      .getByRole('button', { name: 'Delete assessment', exact: true })
      .click();
    await closed(page);
    await page.getByRole('heading', { name: 'Projects', exact: true }).waitFor();
    assert.equal(engine.list().length, 0);
  },
);

test(
  'model discovery, key saves and connection checks keep pending model preferences',
  { timeout: 30000 },
  async (t) => {
    const { page, url, engine } = await setup(t);
    const id = await open(page, url);
    await visit(page, url, id, 'settings', 'Settings & Models');
    await page.waitForFunction(
      () => document.querySelector('[name="fastModel"]').options.length === 3,
    );
    await page.getByLabel('Fast model', { exact: true }).selectOption('gpt-5-test');
    await page.getByLabel('Reasoning effort').selectOption('high');
    await page.getByRole('button', { name: 'Refresh list', exact: true }).click();
    await page.waitForFunction(
      () => !document.querySelector('#activity').textContent.includes('Loading account'),
    );
    assert.equal(await page.getByLabel('Fast model', { exact: true }).inputValue(), 'gpt-5-test');
    await page.getByRole('button', { name: 'Test connection', exact: true }).click();
    await page.waitForFunction(() =>
      document.querySelector('#toast').textContent.includes('verified'),
    );
    assert.equal(await page.getByLabel('Reasoning effort').inputValue(), 'high');
    await page.getByLabel('New API key').fill('pending-preferences-key');
    await page.getByRole('button', { name: 'Save key', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[name="apiKey"]').value === '');
    assert.equal(await page.getByLabel('Fast model', { exact: true }).inputValue(), 'gpt-5-test');
    assert.equal(await page.getByLabel('Reasoning effort').inputValue(), 'high');
    assert.notEqual(engine.get(id).config.fastModel, 'gpt-5-test');
    await page.getByRole('button', { name: 'Save assessment settings', exact: true }).click();
    await page.waitForFunction(() =>
      document.querySelector('#toast').textContent.includes('Assessment settings saved'),
    );
    assert.equal(engine.get(id).config.fastModel, 'gpt-5-test');
  },
);

test(
  'a browser without the access link gets instructions; the launch URL signs in and leaves no token in the address',
  { timeout: 30000 },
  async (t) => {
    const { context, url, webUrl, engine } = await setup(t);
    const stranger = await (await context.browser().newContext()).newPage();
    const denied = await stranger.goto(url);
    assert.equal(denied.status(), 401);
    await stranger.getByRole('heading', { name: 'AiTM needs its access link' }).waitFor();
    assert.equal(
      await stranger.evaluate(() => fetch('/v1/projects').then((response) => response.status)),
      401,
    );
    const id = engine.create({ name: 'Linked project' }).id;
    await stranger.goto(webUrl(`#/projects/${id}/overview`));
    await stranger.getByRole('heading', { name: 'Linked project' }).first().waitFor();
    assert.equal(stranger.url(), `${url}/#/projects/${id}/overview`);
    assert.equal(await stranger.evaluate(() => document.cookie), '');
  },
);
