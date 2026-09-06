import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { downloadDocument, publicAddress } from '../src/engine/download.js';

function responses(...items) {
  const seen = [];
  return {
    seen,
    request(url, options, callback) {
      seen.push({ url: url.toString(), options });
      const { status = 200, headers = {}, chunks = ['Vault holds deposits.'] } = items.shift();
      const response = Readable.from(chunks.map((chunk) => Buffer.from(chunk)));
      response.statusCode = status;
      response.headers = headers;
      callback(response);
      return new EventEmitter();
    },
  };
}

test('HTTPS intake follows bounded redirects and extracts a document name from its media type', async () => {
  const transport = responses(
    { status: 302, headers: { location: '/download' } },
    { headers: { 'content-type': 'application/pdf' } },
  );
  const document = await downloadDocument('https://example.org/whitepaper', transport);
  assert.equal(document.name, 'download.pdf');
  assert.equal(document.url, 'https://example.org/download');
  assert.equal(document.buffer.toString(), 'Vault holds deposits.');
  assert.equal(typeof transport.seen[0].options.lookup, 'function');
});

test('HTTPS intake rejects oversized streams, HTTP errors and compressed responses', async () => {
  for (const [response, error] of [
    [{ headers: { 'content-length': '9000000' } }, /8 MiB/],
    [{ chunks: ['1234', '5678'] }, /8 MiB/],
    [{ status: 404 }, /HTTP 404/],
    [{ headers: { 'content-encoding': 'gzip' } }, /uncompressed/],
  ])
    await assert.rejects(
      downloadDocument('https://example.org/spec.md', { ...responses(response), maxBytes: 6 }),
      error,
    );
  const redirect = { status: 302, headers: { location: '/again' } };
  await assert.rejects(
    downloadDocument(
      'https://example.org/spec.md',
      responses(redirect, redirect, redirect, redirect),
    ),
    /too many redirects/,
  );
  await assert.rejects(
    downloadDocument('https://example.org/spec.md', { signal: AbortSignal.abort() }),
    /abort/i,
  );
});

test('document URLs cannot reach private networks, even via redirects or IPv6 mapped addresses', async () => {
  for (const address of [
    '127.0.0.1',
    '10.2.3.4',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '::1',
    '::ffff:127.0.0.1',
    'fc00::1',
    'fe80::1',
    '2001:db8::1',
    '2002:7f00:1::',
  ])
    assert.equal(publicAddress(address), false, address);
  assert.equal(publicAddress('8.8.8.8'), true);
  assert.equal(publicAddress('2606:4700:4700::1111'), true);
  for (const url of [
    'https://127.0.0.1/spec',
    'https://[::1]/spec',
    'http://example.org/spec',
    'https://user:password@example.org/spec',
    'https://example.org:9443/spec',
  ])
    await assert.rejects(downloadDocument(url), /public HTTPS|public internet/);
  await assert.rejects(
    downloadDocument(
      'https://example.org/spec',
      responses({ status: 302, headers: { location: 'https://127.0.0.1/private' } }),
    ),
    /public internet/,
  );
  const transport = responses({});
  await downloadDocument('https://example.org/spec', transport);
  await assert.rejects(
    new Promise((resolve, reject) =>
      transport.seen[0].options.lookup('localhost', { all: true }, (error, addresses) =>
        error ? reject(error) : resolve(addresses),
      ),
    ),
    /public internet/,
  );
});

test('public pages and ZIP URLs preserve their bytes without following embedded links', async () => {
  for (const [type, extension] of [
    ['text/html', '.html'],
    ['application/zip', '.zip'],
  ]) {
    const transport = responses({
      headers: { 'content-type': type },
      chunks: ['<a href="/extra">Source text</a>'],
    });
    const result = await downloadDocument('https://example.org/source', transport);
    assert.equal(result.name, 'source' + extension);
    assert.equal(transport.seen.length, 1);
    assert.equal(result.buffer.toString(), '<a href="/extra">Source text</a>');
  }
});
