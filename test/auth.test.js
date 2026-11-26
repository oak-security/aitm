import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setup, serve, TOKEN, bearer } from './helpers.js';
import { startServer } from '../src/api/server.js';
import { ApiClient } from '../src/client.js';
import { loadToken, readToken } from '../src/token.js';

test('every API route needs the access token; only health and static assets are open', async (t) => {
  const { engine, p, dir } = await setup(t);
  const { url } = await serve(t, engine);
  const json = { 'content-type': 'application/json' };
  const secret = path.join(dir, 'private-notes.md');
  await writeFile(secret, 'Private design note.');
  for (const [method, route, body] of [
    ['GET', '/v1/projects'],
    ['GET', `/v1/projects/${p.id}`],
    ['GET', `/v1/projects/${p.id}/export`],
    ['GET', '/v1/providers'],
    ['GET', '/v1/instance'],
    ['GET', '/v1/events'],
    ['GET', '/v1/openapi.json'],
    ['GET', '/v1/no-such-route'],
    ['POST', `/v1/projects/${p.id}/sources`, { kind: 'local', path: secret }],
    ['PUT', '/v1/providers/openai/credentials', { apiKey: 'attacker-key' }],
    ['POST', `/v1/projects/${p.id}/runs`, { mode: 'full' }],
  ]) {
    for (const headers of [{}, { authorization: 'Bearer wrong-token' }, { cookie: 'x=1' }]) {
      const response = await fetch(url + route, {
        method,
        headers: { ...json, ...headers },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      assert.equal(response.status, 401, `${method} ${route}`);
      assert.equal(response.headers.get('www-authenticate'), 'Bearer');
      assert.equal((await response.json()).error.code, 'unauthorized');
    }
  }
  assert.equal(engine.get(p.id).sources.length, 1);
  assert.equal(engine.get(p.id).runs.length, 0);
  assert.notEqual(engine.providers.keys.openai, 'attacker-key');
  const health = await (await fetch(`${url}/v1/health`)).json();
  assert.deepEqual(Object.keys(health).sort(), ['apiVersion', 'service', 'version']);
  assert.equal((await fetch(`${url}/ui/app.js`)).status, 200);
  assert.equal((await fetch(`${url}/v1/projects`, { headers: bearer })).status, 200);
  const instance = await (await fetch(`${url}/v1/instance`, { headers: bearer })).json();
  assert.equal(instance.dataDir, engine.store.directory);
  const contract = await (await fetch(`${url}/v1/openapi.json`, { headers: bearer })).json();
  assert.deepEqual(contract.paths['/v1/health'].get.security, []);
  assert.equal(contract.components.securitySchemes.accessToken.scheme, 'bearer');
});

test('the launch URL exchanges the token for a strict HttpOnly cookie; other visits get instructions', async (t) => {
  const { engine } = await setup(t);
  const { url, webUrl } = await serve(t, engine);
  const port = new URL(url).port;
  const anonymous = await fetch(url);
  assert.equal(anonymous.status, 401);
  assert.match(await anonymous.text(), /access link/);
  assert.match(anonymous.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal((await fetch(`${url}/?token=wrong`, { redirect: 'manual' })).status, 401);
  assert.equal(webUrl('#/settings'), `${url}/?token=${TOKEN}#/settings`);
  const exchange = await fetch(webUrl(), { redirect: 'manual' });
  assert.equal(exchange.status, 303);
  assert.equal(exchange.headers.get('location'), '/');
  const cookie = exchange.headers.get('set-cookie');
  assert.match(cookie, new RegExp(`^aitm_token_${port}=${TOKEN}; `));
  for (const attribute of ['HttpOnly', 'SameSite=Strict', 'Path=/'])
    assert.ok(cookie.includes(attribute), attribute);
  const headers = { cookie: cookie.split(';')[0] };
  assert.equal((await fetch(url, { headers })).status, 200);
  assert.equal((await fetch(`${url}/v1/projects`, { headers })).status, 200);
  // A cookie does not weaken the cross-site checks.
  assert.equal(
    (await fetch(`${url}/v1/projects`, { headers: { ...headers, origin: 'https://evil.invalid' } }))
      .status,
    403,
  );
  assert.equal(
    (await fetch(webUrl(), { redirect: 'manual', headers: { 'sec-fetch-site': 'cross-site' } }))
      .status,
    403,
  );
});

test('allowed hosts admit only an explicit loopback forward; a default server gets a random token', async (t) => {
  const { engine } = await setup(t);
  const { url } = await serve(t, engine, { allowedHosts: ['127.0.0.1:9000'] });
  const status = (host) =>
    new Promise((resolve, reject) => {
      http
        .get(`${url}/v1/projects`, { headers: { host, ...bearer } }, (res) => {
          res.resume();
          resolve(res.statusCode);
        })
        .on('error', reject);
    });
  assert.equal(await status('127.0.0.1:9000'), 200);
  assert.equal(await status('127.0.0.1:9001'), 403);
  for (const host of ['attacker.example:80', '10.0.0.5:9000', 'localhost'])
    await assert.rejects(startServer(engine, { port: 0, allowedHosts: [host] }), /loopback/);
  await assert.rejects(startServer(engine, { port: 0, token: 'short' }), /token is invalid/);
  const other = await startServer(engine, { port: 0 });
  t.after(() => other.close());
  assert.match(other.token, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(other.token, TOKEN);
  assert.equal((await fetch(`${other.url}/v1/projects`, { headers: bearer })).status, 401);
  assert.equal(
    (await new ApiClient(other.url, { token: other.token }).get('/v1/projects')).length,
    1,
  );
});

test('the token file is private, persistent and never follows a symlink', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'aitm-token-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const home = path.join(directory, 'config');
  assert.equal(readToken(home), '');
  const token = loadToken(home);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(loadToken(home), token);
  assert.equal(readToken(home), token);
  assert.equal((await stat(path.join(home, 'token'))).mode & 0o777, 0o600);
  assert.equal((await stat(home)).mode & 0o777, 0o700);
  const rotated = loadToken(home, { rotate: true });
  assert.notEqual(rotated, token);
  assert.equal((await readFile(path.join(home, 'token'), 'utf8')).trim(), rotated);
  const linked = path.join(directory, 'linked');
  await loadToken(linked);
  const target = path.join(directory, 'target');
  await writeFile(target, 'untouched', { mode: 0o600 });
  await rm(path.join(linked, 'token'));
  await symlink(target, path.join(linked, 'token'));
  assert.throws(() => loadToken(linked), /regular file/);
  assert.throws(() => loadToken(linked, { rotate: true }), /regular file/);
  assert.equal(await readFile(target, 'utf8'), 'untouched');
});
