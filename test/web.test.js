import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { setup, serve } from './helpers.js';
import { saveKeys } from '../src/config.js';
import { markdown } from '../src/web/markdown.js';

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
test('web assets are explicit, same-origin only and ship an inert Markdown renderer', async (t) => {
  const { engine } = await setup(t),
    { url } = await serve(t, engine);
  for (const resource of [
    '/',
    '/ui/app.js',
    '/ui/styles.css',
    '/ui/views.js',
    '/ui/html.js',
    '/ui/markdown.js',
    '/ui/assets/aitm-mark.svg',
    '/ui/assets/oak-white.svg',
    '/ui/assets/BDOGrotesk-Regular.woff2',
    '/ui/assets/BDOGrotesk-Medium.woff2',
    '/ui/assets/BDOGrotesk-Bold.woff2',
  ]) {
    const response = await fetch(url + resource);
    assert.equal(response.status, 200, resource);
    assert.match(response.headers.get('content-security-policy'), /script-src 'self'/);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.ok((await response.arrayBuffer()).byteLength > 0);
  }
  assert.equal((await fetch(url, { method: 'HEAD' })).status, 200);
  for (const resource of [
    '/.env.local',
    '/ui/../config.js',
    '/src/config.js',
    '/ui/assets/../../../../.env.local',
    '/ui/%2e%2e%2fconfig.js',
  ])
    assert.equal((await fetch(url + resource)).status, 404);
  assert.equal((await fetch(url, { headers: { origin: 'https://evil.invalid' } })).status, 403);
  assert.equal((await fetch(url, { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
  const rendered = markdown(
    '# Report\n\n<img src=x onerror=alert(1)>\n\n**Claim** [click](javascript:alert(1))\n\n| A | B |\n| --- | --- |\n| Value \\| escaped | **Bold**<br>next |\n\n```\n<script>alert(1)</script>\n```',
  );
  assert.ok(!/<(?:img|script|a\s)/.test(rendered.html));
  assert.match(rendered.html, /&lt;img/);
  assert.match(rendered.html, /Value \| escaped/);
  assert.match(rendered.html, /<strong>Bold<\/strong><br>next/);
  assert.equal(rendered.headings[0].id, 'section-0');
});

test('web API opens and reuses one source, accepts uploads and replaces the primary snapshot', async (t) => {
  const { engine, dir } = await setup(t),
    { request } = await serve(t, engine);
  const file = path.join(dir, 'input.md');
  await writeFile(file, 'Complete local source.');
  const first = await request('POST', '/v1/projects/open', { source: file });
  assert.equal(first.status, 200);
  assert.equal(first.body.reused, false);
  const second = await request('POST', '/v1/projects/open', { source: file });
  assert.equal(second.body.reused, true);
  assert.equal(second.body.project.id, first.body.project.id);
  const upload = {
    kind: 'files',
    label: 'Uploaded source',
    files: [{ path: 'design.md', content: 'Complete uploaded document.' }],
  };
  const uploaded = await request('POST', '/v1/projects/open', { source: upload });
  assert.equal(uploaded.status, 200);
  assert.equal(uploaded.body.project.sources[0].files[0].text, 'Complete uploaded document.');
  const separate = await request('POST', '/v1/projects/open', { source: upload });
  assert.notEqual(separate.body.project.id, uploaded.body.project.id);
  const replacement = await request('PUT', `/v1/projects/${uploaded.body.project.id}/source`, {
    source: file,
  });
  assert.equal(replacement.status, 200);
  assert.equal(replacement.body.sources[0].kind, 'local');
  assert.equal(
    (await request('POST', '/v1/projects/open', { source: 'http://example.invalid' })).status,
    422,
  );
  assert.equal(
    (
      await request('POST', '/v1/projects/open', {
        source: { kind: 'files', label: 'bad', files: [{ path: '../../outside', content: 'x' }] },
      })
    ).status,
    422,
  );
});

test('web credentials are saved privately, reject cross-origin writes and never enter state or responses', async (t) => {
  const { engine, p, providers, dir } = await setup(t),
    { request, url } = await serve(t, engine);
  const directory = path.join(dir, 'config');
  providers.saveCredentials = (patch) => saveKeys(patch, { directory });
  providers.keyFile = path.join(directory, 'keys.json');
  const response = await request('PUT', '/v1/providers/openai/credentials', {
    apiKey: 'new-web-private-key',
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.openai.keySource, 'saved settings');
  assert.equal(JSON.parse(await readFile(providers.keyFile, 'utf8')).openai, 'new-web-private-key');
  assert.equal((await stat(providers.keyFile)).mode & 0o777, 0o600);
  assert.equal(engine.get(p.id).revision, p.revision);
  assert.ok(!JSON.stringify(response).includes('new-web-private-key'));
  assert.ok(!JSON.stringify(engine.get(p.id)).includes('new-web-private-key'));
  for (const apiKey of ['', 'bad key', '\n'])
    assert.equal(
      (await request('PUT', '/v1/providers/openai/credentials', { apiKey })).status,
      422,
    );
  assert.equal(providers.keys.openai, 'new-web-private-key');
  assert.equal(
    (await request('PUT', '/v1/providers/openai/credentials', { workspaceId: 'wrkspc_test' }))
      .status,
    422,
  );
  const denied = await fetch(url + '/v1/providers/openai/credentials', {
    method: 'PUT',
    headers: { origin: 'https://evil.invalid', 'content-type': 'application/json' },
    body: JSON.stringify({ apiKey: 'evil' }),
  });
  assert.equal(denied.status, 403);
  assert.equal(providers.keys.openai, 'new-web-private-key');
  providers.saveCredentials = () => {
    throw new Error('do not expose storage errors');
  };
  const failed = await request('PUT', '/v1/providers/openai/credentials', {
    apiKey: 'failed-new-key',
  });
  assert.equal(failed.status, 500);
  assert.equal(providers.keys.openai, 'new-web-private-key');
  assert.ok(!JSON.stringify(failed).includes('failed-new-key'));
});

test('global browser events announce changes and release subscriptions on disconnect', async (t) => {
  const { engine, p } = await setup(t),
    { url } = await serve(t, engine);
  const baseline = engine.events.listenerCount('change');
  const controller = new AbortController();
  const response = await fetch(url + '/v1/events', { signal: controller.signal });
  assert.equal(response.headers.get('content-type'), 'text/event-stream');
  const reader = response.body.getReader();
  assert.match(new TextDecoder().decode((await reader.read()).value), /"projectId":null/);
  assert.equal(engine.events.listenerCount('change'), baseline + 1);
  engine.update(p.id, { revision: p.revision, name: 'Browser update' });
  const event = new TextDecoder().decode((await reader.read()).value);
  assert.ok(event.includes(p.id));
  controller.abort();
  for (let i = 0; i < 50 && engine.events.listenerCount('change') !== baseline; i++)
    await pause(10);
  assert.equal(engine.events.listenerCount('change'), baseline);
});

test(
  'aitm web starts with no automatic source, opens explicit sources or saved projects and shuts down cleanly',
  { timeout: 20000 },
  async (t) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'aitm-web-cli-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const source = path.join(directory, 'source.md');
    await writeFile(source, 'Synthetic source for CLI testing.');
    const socket = net.createServer();
    await new Promise((resolve) => socket.listen(0, '127.0.0.1', resolve));
    const port = socket.address().port;
    await new Promise((resolve) => socket.close(resolve));
    const dataDir = path.join(directory, 'data');
    let firstId;
    for (let i = 0; i < 4; i++) {
      const selection = i === 0 ? [] : i === 3 ? ['--project', firstId] : [source];
      const child = spawn(
        process.execPath,
        [
          path.resolve('src/cli.js'),
          'web',
          ...selection,
          '--no-open',
          '--port',
          String(port),
          '--data-dir',
          dataDir,
        ],
        { cwd: directory, stdio: ['ignore', 'pipe', 'pipe'] },
      );
      let output = '';
      child.stdout.on('data', (s) => {
        output += s;
      });
      child.stderr.on('data', (s) => {
        output += s;
      });
      t.after(() => {
        if (child.exitCode === null) child.kill('SIGTERM');
      });
      for (let n = 0; n < 100 && !output.includes('web workbench:'); n++) await pause(50);
      assert.ok(output.includes('web workbench:'), output);
      const health = await (await fetch(`http://127.0.0.1:${port}/v1/health`)).json();
      assert.equal(health.pid, child.pid);
      assert.equal((await fetch(`http://127.0.0.1:${port}/`)).status, 200);
      const projects = await (await fetch(`http://127.0.0.1:${port}/v1/projects`)).json();
      assert.equal(projects.length, i === 0 ? 0 : 1);
      if (i > 0) {
        if (firstId) assert.equal(projects[0].id, firstId);
        else firstId = projects[0].id;
        assert.ok(output.includes(`/#/projects/${firstId}/overview`), output);
      }
      const exited = new Promise((resolve) => child.once('exit', (code) => resolve(code)));
      child.kill('SIGTERM');
      assert.equal(await exited, 0);
    }
  },
);
