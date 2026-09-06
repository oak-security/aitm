import { deflateRawSync, crc32 } from 'node:zlib';

export function zipFixture(entries) {
  const chunks = [],
    directory = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.path),
      content = Buffer.from(entry.content || ''),
      compressed = deflateRawSync(content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(entry.flags || 0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc32(content), 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.size ?? content.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50);
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(entry.flags || 0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc32(content), 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.size ?? content.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(((entry.mode ?? 0o100644) << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    chunks.push(local, name, compressed);
    directory.push(central, name);
    offset += local.length + name.length + compressed.length;
  }
  const body = Buffer.concat(chunks),
    index = Buffer.concat(directory),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(index.length, 12);
  end.writeUInt32LE(body.length, 16);
  return Buffer.concat([body, index, end]);
}
