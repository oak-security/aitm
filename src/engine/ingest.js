import { createHash, randomUUID } from 'node:crypto';
import { promises as fs, constants } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ignore from 'ignore';
import { insist, parse } from './errors.js';
import { SourceInput } from './schema.js';
import { downloadDocument } from './download.js';
import { readZip } from './zip.js';

const exec = promisify(execFile);
const SKIP = new Set([
  '.git',
  'node_modules',
  'vendor',
  '.venv',
  'venv',
  'dist',
  'build',
  'coverage',
  '.next',
  '.aitm',
  '.ssh',
  '.aws',
  '.config',
]);
const SECRET =
  /^(\.env(?:\..*)?|.*\.(?:pem|key|p12|pfx)|(?:keys|credentials|secrets)(?:\..*)?|id_rsa|id_ed25519)$/i;
const BINARY =
  /\.(?:png|jpe?g|gif|webp|ico|woff2?|ttf|otf|zip|gz|tgz|tar|7z|exe|dll|so|dylib|mp[34]|mov|docm|xlsm|doc|xlsx?|pptx?)$/i;
export const LIMITS = Object.freeze({
  files: 1000,
  projectFiles: 2000,
  fileBytes: 8 * 1024 * 1024,
  totalBytes: 32 * 1024 * 1024,
  fileChars: 8 * 1024 * 1024,
  sourceChars: 32 * 1024 * 1024,
  projectChars: 32 * 1024 * 1024,
});
export const hash = (value) => createHash('sha256').update(value).digest('hex');

export function safePath(value) {
  insist(
    !value.includes('\\') &&
      !value.includes('\0') &&
      !value.includes(':') &&
      !path.posix.isAbsolute(value),
    'Use a relative file path.',
  );
  insist(
    value.split('/').every((p) => p && p !== '.' && p !== '..'),
    'File paths cannot contain empty segments, . or ...',
  );
  insist(
    !value.split('/').some((p) => SKIP.has(p) || SECRET.test(p)),
    'Credential and dependency paths cannot be ingested.',
  );
  return value;
}

function validateDocx(buffer) {
  // Read declared ZIP sizes before handing a document to the XML extractor.
  const eocd = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  insist(eocd >= 0 && eocd + 22 <= buffer.length, 'Invalid DOCX archive.');
  const count = buffer.readUInt16LE(eocd + 10);
  let cursor = buffer.readUInt32LE(eocd + 16),
    size = 0;
  insist(count <= 2000, 'DOCX has too many archive entries.');
  for (let i = 0; i < count; i++) {
    insist(
      cursor + 46 <= buffer.length && buffer.readUInt32LE(cursor) === 0x02014b50,
      'Invalid DOCX directory.',
    );
    size += buffer.readUInt32LE(cursor + 24);
    insist(size <= LIMITS.totalBytes, 'DOCX expands beyond the document size limit.');
    cursor +=
      46 +
      buffer.readUInt16LE(cursor + 28) +
      buffer.readUInt16LE(cursor + 30) +
      buffer.readUInt16LE(cursor + 32);
  }
}

export async function extract(name, buffer) {
  insist(buffer.length <= LIMITS.fileBytes, 'File exceeds the 8 MiB limit.');
  if (/\.pdf$/i.test(name)) {
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: buffer });
    try {
      return (await parser.getText()).text;
    } finally {
      await parser.destroy();
    }
  }
  if (/\.docx$/i.test(name)) {
    validateDocx(buffer);
    const mammoth = await import('mammoth');
    return (await mammoth.default.extractRawText({ buffer })).value;
  }
  insist(
    !BINARY.test(name) && !buffer.includes(0),
    'Unsupported binary; use text, source code, PDF or DOCX.',
  );
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw new Error('Text files must be UTF-8.');
  }
}

export async function ingest(raw, { signal, sourceId = randomUUID(), gitRunner = exec } = {}) {
  const input = parse(SourceInput, raw);
  const files = [],
    warnings = [];
  let totalBytes = 0,
    totalChars = 0,
    temp = null,
    commit = null,
    locator = null;
  const warn = (message) => {
    if (warnings.length < 100) warnings.push(message);
  };
  async function add(name, buffer) {
    signal?.throwIfAborted();
    safePath(name);
    totalBytes += buffer.length;
    insist(
      totalBytes <= LIMITS.totalBytes && files.length < LIMITS.files,
      'Source exceeds the 32 MiB / 1000 file limit. Narrow the selected folder.',
    );
    const original = (await extract(name, buffer)).replace(/\r\n?/g, '\n');
    if (!original.trim()) {
      warn(`${name}: no extractable text (scanned documents require OCR).`);
      return;
    }
    insist(
      original.length <= LIMITS.fileChars,
      `${name}: extracted text exceeds 8 MiB. Split this document into smaller files.`,
    );
    insist(
      totalChars + original.length <= LIMITS.sourceChars,
      'Extracted source text exceeds 32 MiB. Narrow the selected source.',
    );
    const text = original;
    totalChars += text.length;
    if (text)
      files.push({
        id: `file-${hash(sourceId + ':' + name).slice(0, 20)}`,
        path: name,
        hash: hash(buffer),
        bytes: buffer.length,
        text,
        lines: text.split('\n').length,
      });
  }
  async function archive(buffer, prefix = '') {
    insist(buffer.length <= LIMITS.fileBytes, 'ZIP exceeds the 8 MiB upload limit.');
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aitm-zip-'));
    try {
      await readZip(buffer, {
        signal,
        limits: LIMITS,
        warn,
        accept: (name) =>
          !name
            .split('/')
            .some((part) => SKIP.has(part) || SECRET.test(part) || part === '__MACOSX') &&
          !BINARY.test(name),
        onFile: async (name, content) => {
          const file = path.join(directory, prefix, name);
          await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
          await fs.writeFile(file, content, { flag: 'wx', mode: 0o600 });
        },
      });
      await walk(await fs.realpath(directory));
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  }
  async function walk(root, relative = '', rules = []) {
    signal?.throwIfAborted();
    const dir = path.join(root, relative);
    try {
      const p = path.join(dir, '.gitignore');
      const stat = await fs.lstat(p);
      if (stat.isFile() && stat.size < 100000)
        rules = [...rules, { base: relative, match: ignore().add(await fs.readFile(p, 'utf8')) }];
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const entries = (await fs.readdir(dir, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    // Read architecture evidence first; every accepted file is preserved in full.
    entries.sort(
      (a, b) =>
        Number(/readme|spec|architect|whitepaper/i.test(b.name)) -
        Number(/readme|spec|architect|whitepaper/i.test(a.name)),
    );
    for (const entry of entries) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (SKIP.has(entry.name) || SECRET.test(entry.name)) continue;
      if (entry.isSymbolicLink()) {
        warn(`${name}: symlink skipped.`);
        continue;
      }
      let ignored = false;
      for (const rule of rules) {
        const candidate =
          name.slice(rule.base ? rule.base.length + 1 : 0) + (entry.isDirectory() ? '/' : '');
        const result = rule.match.test(candidate);
        if (result.ignored) ignored = true;
        else if (result.unignored) ignored = false;
      }
      if (ignored) continue;
      if (entry.isDirectory()) {
        await walk(root, name, rules);
        continue;
      }
      if (!entry.isFile() || BINARY.test(entry.name)) continue;
      const absolute = path.join(root, name);
      const handle = await fs.open(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
      try {
        const stat = await handle.stat();
        const real = await fs.realpath(absolute);
        insist(real.startsWith(root + path.sep), 'Source changed outside the selected root.');
        if (stat.size > LIMITS.fileBytes) {
          warn(`${name}: file exceeds 8 MiB; skipped.`);
          continue;
        }
        const buffer = await handle.readFile();
        if (buffer.includes(0) && !/\.(pdf|docx)$/i.test(name)) continue;
        try {
          await add(name, buffer);
        } catch (error) {
          if (error.status) throw error;
          warn(`${name}: text extraction failed.`);
        }
      } finally {
        await handle.close();
      }
    }
  }
  try {
    if (input.kind === 'text') await add('notes.txt', Buffer.from(input.text));
    if (input.kind === 'files') {
      const paths = new Set();
      for (const file of input.files) {
        insist(!paths.has(file.path), 'Duplicate synced file path.');
        paths.add(file.path);
        if (file.encoding === 'base64')
          insist(
            /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.content),
            'Invalid base64 content.',
          );
        safePath(file.path);
        const buffer = Buffer.from(file.content, file.encoding);
        if (/\.zip$/i.test(file.path))
          await archive(buffer, input.files.length > 1 ? file.path.replace(/\.zip$/i, '') : '');
        else await add(file.path, buffer);
      }
    }
    if (input.kind === 'local') {
      const selected = path.resolve(input.path);
      insist(
        !(await fs.lstat(selected)).isSymbolicLink(),
        'Select a real file or directory, not a symlink.',
      );
      locator = await fs.realpath(selected);
      const stat = await fs.stat(locator);
      insist(
        !locator.split(path.sep).some((p) => SECRET.test(p) || SKIP.has(p)),
        'Credential and dependency paths cannot be ingested.',
      );
      if (stat.isDirectory()) await walk(locator);
      else {
        insist(stat.isFile(), 'Select a regular file.');
        insist(stat.size <= LIMITS.fileBytes, 'File exceeds 8 MiB.');
        const buffer = await fs.readFile(locator);
        if (/\.zip$/i.test(locator)) await archive(buffer);
        else await add(path.basename(locator), buffer);
      }
    }
    if (input.kind === 'url') {
      const document = await downloadDocument(input.url, { signal, maxBytes: LIMITS.fileBytes });
      locator = new URL(input.url).toString();
      if (/\.zip$/i.test(document.name)) await archive(document.buffer);
      else await add(document.name, document.buffer);
      if (document.url !== locator) warn(`Document retrieved from ${document.url}`);
    }
    if (input.kind === 'git') {
      const url = new URL(input.url);
      insist(
        url.protocol === 'https:' &&
          !url.username &&
          !url.password &&
          !url.search &&
          !url.hash &&
          !url.port &&
          ['github.com', 'gitlab.com', 'bitbucket.org'].includes(url.hostname),
        'Use a public HTTPS repository on GitHub, GitLab or Bitbucket; use a local checkout for other hosts.',
      );
      insist(/^\/[\w.-]+\/[\w./-]+$/.test(url.pathname), 'Invalid repository path.');
      locator = url.toString();
      temp = await fs.mkdtemp(path.join(os.tmpdir(), 'aitm-ingest-'));
      const checkout = path.join(temp, 'repo');
      const env = {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_LFS_SKIP_SMUDGE: '1',
      };
      await gitRunner(
        'git',
        [
          '-c',
          'protocol.file.allow=never',
          '-c',
          'protocol.ext.allow=never',
          '-c',
          'core.hooksPath=/dev/null',
          'clone',
          '--depth',
          '1',
          '--single-branch',
          '--no-recurse-submodules',
          '--',
          locator,
          checkout,
        ],
        { signal, env, timeout: 60000, maxBuffer: 1024 * 1024 },
      );
      commit = (
        await gitRunner('git', ['-C', checkout, 'rev-parse', 'HEAD'], { signal, env })
      ).stdout.trim();
      await walk(await fs.realpath(checkout));
    }
    insist(
      files.length > 0,
      'No readable source content found. Select text/code, PDF, DOCX, a repository ZIP or a folder containing them.',
    );
    const sourceHash = hash(JSON.stringify(files.map((f) => [f.path, f.hash])));
    return {
      id: sourceId,
      kind: input.kind,
      label: input.label || path.basename(locator || 'Source'),
      locator,
      commit,
      hash: sourceHash,
      collectedAt: new Date().toISOString(),
      files,
      warnings,
    };
  } finally {
    if (temp) await fs.rm(temp, { recursive: true, force: true });
  }
}

// Compatibility with saved assessments produced before complete-source batching.
export function needsFullSourceRun(project) {
  if (project.sources.some((s) => s.warnings.some((w) => w.includes('excerpt truncated'))))
    return true;
  const ingest = project.artifacts.ingest;
  if (
    !ingest ||
    ingest.generation?.sourceCoverage?.complete ||
    ingest.generation?.sourceCoverage?.fromInventory
  )
    return false;
  const files = project.sources.flatMap((s) => s.files);
  const oldWeight = (file) =>
    /\.(md|txt|pdf|docx)$/i.test(file.path) || /readme|spec|architect|whitepaper/i.test(file.path)
      ? 32
      : 1;
  const totalWeight = files.reduce((n, file) => n + oldWeight(file), 0);
  return files.some(
    (file) => file.text.length > Math.max(1, Math.floor((180000 * oldWeight(file)) / totalWeight)),
  );
}

export function sourceContext(project) {
  return project.sources.flatMap((source) =>
    source.files.map((file) => ({
      id: file.id,
      source: source.label,
      sourceId: source.id,
      sourceHash: source.hash,
      path: file.path,
      hash: file.hash,
      text: file.text
        .split('\n')
        .map((line, i) => `${i + 1}: ${line}`)
        .join('\n'),
      excerptOnly: source.warnings.some((w) => w.startsWith(`${file.path}: excerpt truncated`)),
    })),
  );
}

// Split provider requests, never the stored evidence. Every line/character is sent,
// with original line numbers even when one unusually long line needs several parts.
export function sourceBatches(project, limit = 180000) {
  insist(Number.isSafeInteger(limit) && limit >= 30, 'Invalid source batch size.');
  const parts = [];
  for (const file of sourceContext(project)) {
    const chunks = [];
    let chunk = '';
    for (const numbered of file.text.split('\n')) {
      const colon = numbered.indexOf(': ');
      const prefix = numbered.slice(0, colon + 2);
      let line = numbered.slice(colon + 2);
      do {
        const available = limit - prefix.length - 1;
        const piece = prefix + line.slice(0, available);
        if (chunk && chunk.length + piece.length + 1 > limit) {
          chunks.push(chunk);
          chunk = '';
        }
        chunk += (chunk ? '\n' : '') + piece;
        line = line.slice(available);
      } while (line.length);
    }
    if (chunk) chunks.push(chunk);
    chunks.forEach((text, index) =>
      parts.push({ ...file, text, part: index + 1, parts: chunks.length }),
    );
  }
  const batches = [];
  let batch = [],
    size = 0;
  for (const part of parts) {
    if (batch.length && size + part.text.length > limit) {
      batches.push(batch);
      batch = [];
      size = 0;
    }
    batch.push(part);
    size += part.text.length;
  }
  if (batch.length) batches.push(batch);
  return batches;
}
