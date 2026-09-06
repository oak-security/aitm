import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import path from 'node:path';
import { insist } from './errors.js';

const privateIPv4 = new BlockList();
for (const [network, bits] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
])
  privateIPv4.addSubnet(network, bits);
const globalIPv6 = new BlockList();
globalIPv6.addSubnet('2000::', 3, 'ipv6');
const reservedIPv6 = new BlockList();
for (const [network, bits] of [
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['3fff::', 20],
])
  reservedIPv6.addSubnet(network, bits, 'ipv6');

export function publicAddress(address) {
  return isIP(address) === 4
    ? !privateIPv4.check(address)
    : isIP(address) === 6 &&
        globalIPv6.check(address, 'ipv6') &&
        !reservedIPv6.check(address, 'ipv6');
}

function documentURL(value) {
  const url = new URL(value);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  insist(
    url.protocol === 'https:' && !url.username && !url.password && !url.port,
    'Use a public HTTPS document URL without credentials or a custom port.',
  );
  insist(!isIP(host) || publicAddress(host), 'Document URLs must use a public internet address.');
  url.hash = '';
  return url;
}

// Resolve only public addresses and pass those exact addresses to the TLS socket.
// Every redirect uses this same lookup, so it cannot redirect to a local service.
function publicLookup(hostname, options, callback) {
  lookup(hostname, { all: true, family: options.family || 0 })
    .then((addresses) => {
      insist(
        addresses.length && addresses.every(({ address }) => publicAddress(address)),
        'Document URLs must resolve to public internet addresses.',
      );
      if (options.all) callback(null, addresses);
      else callback(null, addresses[0].address, addresses[0].family);
    })
    .catch(callback);
}

export async function downloadDocument(
  value,
  { signal, maxBytes = 8 * 1024 * 1024, request = https.get } = {},
) {
  const deadline = AbortSignal.any([AbortSignal.timeout(30000), ...(signal ? [signal] : [])]);
  let url = documentURL(value);
  for (let redirects = 0; redirects <= 3; redirects++) {
    deadline.throwIfAborted();
    const response = await new Promise((resolve, reject) => {
      const req = request(
        url,
        {
          lookup: publicLookup,
          signal: deadline,
          headers: { 'user-agent': 'AiTM/2.0', 'accept-encoding': 'identity' },
        },
        resolve,
      );
      req.on('error', reject);
    });
    try {
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        insist(redirects < 3 && response.headers.location, 'Document URL has too many redirects.');
        url = documentURL(new URL(response.headers.location, url));
        continue;
      }
      insist(
        response.statusCode === 200,
        `Document download returned HTTP ${response.statusCode}.`,
      );
      insist(
        !response.headers['content-encoding'] ||
          response.headers['content-encoding'] === 'identity',
        'Use an uncompressed document URL.',
      );
      insist(
        Number(response.headers['content-length'] || 0) <= maxBytes,
        'Document exceeds the 8 MiB limit.',
      );
      const type = (response.headers['content-type'] || '').split(';')[0].trim();
      let name = path.posix.basename(decodeURIComponent(url.pathname)) || 'document.txt';
      const extension = {
        'application/pdf': '.pdf',
        'text/html': '.html',
        'application/xhtml+xml': '.html',
        'application/zip': '.zip',
        'application/x-zip-compressed': '.zip',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
      }[type];
      if (extension && !name.toLowerCase().endsWith(extension)) name += extension;
      const chunks = [];
      let size = 0;
      for await (const chunk of response) {
        deadline.throwIfAborted();
        size += chunk.length;
        insist(size <= maxBytes, 'Document exceeds the 8 MiB limit.');
        chunks.push(chunk);
      }
      return { name, buffer: Buffer.concat(chunks), url: url.toString() };
    } finally {
      response.destroy();
    }
  }
}
