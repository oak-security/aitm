import { fromBufferPromise } from 'yauzl';
import { addAbortSignal } from 'node:stream';
import { insist, AppError } from './errors.js';

// Sequential, bounded archive reads. No archive path or symlink is ever executed.
export async function readZip(buffer, { signal, accept, onFile, warn, limits }) {
  let archive;
  try {
    signal?.throwIfAborted();
    archive = await fromBufferPromise(buffer, { strictFileNames: true, validateEntrySizes: true });
    insist(archive.entryCount <= 10000, 'ZIP has too many entries (maximum 10,000).');
    let expanded = 0;
    const seen = new Set();
    for await (const entry of archive.eachEntry()) {
      signal?.throwIfAborted();
      const name = entry.fileName.replace(/\/$/, '');
      insist(
        name.length > 0 &&
          name.length <= 500 &&
          !/[\\:\x00-\x1f\x7f]/.test(name) &&
          name.split('/').every((part) => part && part !== '.' && part !== '..'),
        'ZIP contains an unsafe file path.',
      );
      const key = name.normalize('NFC').toLowerCase();
      insist(!seen.has(key), 'ZIP contains duplicate or ambiguous file paths.');
      seen.add(key);
      expanded += entry.uncompressedSize;
      insist(
        Number.isSafeInteger(expanded) && expanded <= limits.totalBytes,
        'ZIP expands beyond the 32 MiB limit.',
      );
      insist(!(entry.generalPurposeBitFlag & 1), 'Encrypted ZIP files are not supported.');
      const kind = (entry.externalFileAttributes >>> 16) & 0xf000;
      if (kind === 0xa000) {
        warn(`${name}: symlink skipped.`);
        continue;
      }
      insist(
        !kind || kind === 0x8000 || kind === 0x4000,
        'ZIP contains a special device or unsupported file type.',
      );
      if (entry.fileName.endsWith('/') || kind === 0x4000 || !accept(name)) continue;
      insist(entry.uncompressedSize <= limits.fileBytes, `${name}: ZIP entry exceeds 8 MiB.`);
      const stream = await archive.openReadStreamPromise(entry);
      if (signal) addAbortSignal(signal, stream);
      const chunks = [];
      let size = 0;
      for await (const chunk of stream) {
        size += chunk.length;
        insist(
          size <= limits.fileBytes && size <= entry.uncompressedSize,
          'ZIP entry expands beyond its declared size.',
        );
        chunks.push(chunk);
      }
      insist(size === entry.uncompressedSize, 'ZIP entry size does not match its directory.');
      await onFile(name, Buffer.concat(chunks));
    }
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof AppError) throw error;
    throw new AppError(
      422,
      'invalid_archive',
      'Could not read this ZIP. Use a valid, unencrypted repository ZIP with safe relative paths.',
    );
  } finally {
    archive?.close();
  }
}
