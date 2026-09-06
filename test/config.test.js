import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, stat, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, saveKeys } from '../src/config.js';
import { Providers } from '../src/engine/providers.js';

async function settings(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'aitm-keys-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, cwd: directory, packageRoot: directory, env: {} };
}

test('saved replacements take precedence, persist across restarts and preserve the other provider', async (t) => {
  const options = await settings(t);
  await writeFile(
    path.join(options.cwd, '.env.local'),
    'OPENAI_API_KEY=local-openai\nANTHROPIC_API_KEY=local-anthropic\nANTHROPIC_WORKSPACE_ID=wrkspc_old',
    { mode: 0o600 },
  );
  options.env = { OPENAI_API_KEY: 'environment-openai' };
  assert.equal(loadConfig(options).keys.openai, 'environment-openai');
  assert.equal(loadConfig(options).keySources.anthropic, '.env.local');
  saveKeys({ anthropic: 'saved-anthropic' }, options);
  const providers = new Providers(loadConfig(options));
  providers.configure({ openai: 'replacement-openai' });
  assert.equal(providers.headers('openai').authorization, 'Bearer replacement-openai');
  const reloaded = loadConfig(options);
  assert.deepEqual(reloaded.keys, { openai: 'replacement-openai', anthropic: 'saved-anthropic' });
  assert.equal(reloaded.keySources.openai, 'saved settings');
  assert.equal(reloaded.anthropicWorkspaceId, 'wrkspc_old');
  saveKeys({ anthropicWorkspaceId: '' }, options);
  assert.equal(loadConfig(options).anthropicWorkspaceId, '');
  const file = path.join(options.directory, 'keys.json');
  const before = await readFile(file, 'utf8');
  saveKeys({}, options);
  assert.equal(await readFile(file, 'utf8'), before);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.equal((await stat(options.directory)).mode & 0o777, 0o700);
});

test('invalid key updates and failed writes preserve existing credentials without reflecting secrets', async (t) => {
  const options = await settings(t);
  saveKeys({ openai: 'original-openai' }, options);
  assert.throws(
    () => saveKeys({ openai: 'private key\ninvalid' }, options),
    (error) => !error.message.includes('private key'),
  );
  assert.equal(loadConfig(options).keys.openai, 'original-openai');
  const providers = new Providers({
    keys: { openai: 'old-key' },
    saveCredentials: () => {
      throw new Error('new-private-key');
    },
  });
  assert.throws(
    () => providers.configure({ openai: 'new-private-key' }),
    (error) =>
      error.code === 'credential_save_failed' && !error.message.includes('new-private-key'),
  );
  assert.equal(providers.keys.openai, 'old-key');
  assert.throws(() => saveKeys({ anthropicWorkspaceId: 'bad-workspace' }, options), /workspace ID/);
});

test('credential writes refuse a symlink target without modifying its destination', async (t) => {
  const options = await settings(t);
  const target = path.join(options.directory, 'target.json');
  await writeFile(target, '{"openai":"untouched"}', { mode: 0o600 });
  await symlink(target, path.join(options.directory, 'keys.json'));
  assert.throws(() => saveKeys({ openai: 'replacement' }, options), /regular file/);
  assert.equal(JSON.parse(await readFile(target, 'utf8')).openai, 'untouched');
});
