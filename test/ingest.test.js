import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import { ingest, sourceContext, safePath, LIMITS } from '../src/engine/ingest.js';
import { setup, finish } from './helpers.js';

test('folder ingestion honors nested ignores, drops secrets/dependencies/binaries and skips symlinks', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'aitm-ingest-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(path.join(dir, 'src'));
  await mkdir(path.join(dir, 'node_modules'));
  await Promise.all([
    writeFile(path.join(dir, 'README.md'), 'Architecture overview'),
    writeFile(path.join(dir, '.env.local'), 'OPENAI_API_KEY=secret'),
    writeFile(path.join(dir, '.gitignore'), '*.log\n'),
    writeFile(path.join(dir, 'src', '.gitignore'), 'ignored.js\n'),
    writeFile(path.join(dir, 'src', 'ignored.js'), 'ignore'),
    writeFile(path.join(dir, 'src', 'model.js'), 'const valid = true;'),
    writeFile(path.join(dir, 'node_modules', 'dependency.js'), 'skip'),
    writeFile(path.join(dir, 'trace.log'), 'skip'),
    writeFile(path.join(dir, 'data.bin'), Buffer.from([1, 0, 2])),
    symlink('/etc/passwd', path.join(dir, 'external.txt')),
  ]);
  const source = await ingest({ kind: 'local', path: dir });
  assert.ok(source.files.some((f) => f.path === 'src/model.js'));
  for (const forbidden of [
    '.env.local',
    'trace.log',
    'src/ignored.js',
    'external.txt',
    'data.bin',
    'node_modules/dependency.js',
  ])
    assert.ok(!source.files.some((f) => f.path === forbidden), forbidden);
  assert.ok(source.warnings.some((w) => w.includes('symlink')));
});

test('synced snapshots reject traversal, credentials, duplicate paths and oversized inputs', async () => {
  for (const bad of [
    '../secret',
    '/etc/passwd',
    'a\\b',
    'a/../b',
    'C:/file',
    '.env',
    '.ssh/id_rsa',
    'keys.json',
  ])
    assert.throws(() => safePath(bad));
  await assert.rejects(
    ingest({
      kind: 'files',
      label: 'Sync',
      files: [
        { path: 'a.txt', content: 'one' },
        { path: 'a.txt', content: 'two' },
      ],
    }),
    /Duplicate/,
  );
  await assert.rejects(
    ingest({
      kind: 'files',
      label: 'Sync',
      files: [{ path: 'a.txt', content: '***', encoding: 'base64' }],
    }),
    /base64/,
  );
  await assert.rejects(
    ingest({ kind: 'git', url: 'https://attacker.example/repo' }),
    /public HTTPS/,
  );
  await assert.rejects(
    ingest({ kind: 'git', url: 'https://token@github.com/org/repo' }),
    /public HTTPS/,
  );
  const source = await ingest({
    kind: 'text',
    label: 'Long source',
    text: 'x'.repeat(LIMITS.fileChars + 10),
  });
  assert.equal(source.files[0].text.length, LIMITS.fileChars);
  assert.ok(source.warnings.some((w) => w.includes('truncated')));
});

test('PDF documents are extracted into source text with provenance', async () => {
  const doc = new PDFDocument();
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve) => doc.on('end', resolve));
  doc.text('Vault holds deposits.');
  doc.end();
  await done;
  const source = await ingest({
    kind: 'files',
    label: 'Whitepaper',
    files: [
      {
        path: 'whitepaper.pdf',
        encoding: 'base64',
        content: Buffer.concat(chunks).toString('base64'),
      },
    ],
  });
  assert.ok(source.files[0].text.includes('Vault holds deposits.'));
  assert.equal(source.files[0].hash.length, 64);
  const context = sourceContext({ sources: [source] })[0];
  assert.equal(context.id, source.files[0].id);
  assert.equal(context.hash, source.files[0].hash);
  assert.equal(context.sourceId, source.id);
  assert.equal(context.sourceHash, source.hash);
});

test('DOCX extraction preserves text and rejects oversized archive declarations', async () => {
  const buffer = await readFile(new URL('./fixtures/architecture.docx', import.meta.url));
  const input = (content) => ({
    kind: 'files',
    label: 'Architecture',
    files: [{ path: 'architecture.docx', encoding: 'base64', content: content.toString('base64') }],
  });
  const source = await ingest(input(buffer));
  assert.ok(source.files[0].text.includes('Two signers must approve releases.'));
  const oversized = Buffer.from(buffer);
  const central = oversized.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  oversized.writeUInt32LE(50000000, central + 24);
  await assert.rejects(ingest(input(oversized)), /expands/);
});

test('Git ingestion walks canonical temporary paths, pins a commit and cleans up', async () => {
  let checkout;
  const source = await ingest(
    { kind: 'git', url: 'https://github.com/oak-security/TRACE' },
    {
      gitRunner: async (command, args, options) => {
        assert.equal(command, 'git');
        assert.equal(options.env.GIT_CONFIG_GLOBAL, '/dev/null');
        if (args.includes('clone')) {
          assert.ok(args.includes('--no-recurse-submodules'));
          assert.ok(args.includes('core.hooksPath=/dev/null'));
          assert.equal(args.at(-3), '--');
          checkout = args.at(-1);
          await mkdir(checkout);
          await writeFile(path.join(checkout, 'README.md'), 'Vault holds deposits.');
          return { stdout: '' };
        }
        return { stdout: 'a'.repeat(40) + '\n' };
      },
    },
  );
  assert.equal(source.commit, 'a'.repeat(40));
  assert.ok(source.files[0].text.includes('Vault holds deposits.'));
  await assert.rejects(access(checkout));
});

test('refreshing unchanged evidence preserves analysis, changed evidence invalidates it', async (t) => {
  const { engine, p, dir } = await setup(t);
  const file = path.join(dir, 'architecture.md');
  await writeFile(file, 'Vault holds deposits.');
  const added = await engine.addSource(p.id, { kind: 'local', path: file });
  const source = added.sources.at(-1);
  await finish(engine, p.id);
  await engine.syncSource(p.id, source.id);
  assert.ok(engine.get(p.id).artifacts.report);
  await writeFile(file, 'Vault holds deposits.\nNew authority path.');
  await engine.syncSource(p.id, source.id);
  assert.equal(engine.get(p.id).artifacts.report, undefined);
  assert.equal(engine.get(p.id).sources.at(-1).id, source.id);
});
