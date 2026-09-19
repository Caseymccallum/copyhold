/**
 * A minimal ZIP reader and writer.
 *
 * The reader exists because MyCase's Full Backup is a ZIP of CSVs, and this project has
 * no dependencies: `dependencies: {}` in package.json is the state of the file, so the
 * container is implemented here rather than imported. The writer exists for the test
 * fixture, so that the tests build a real archive rather than a stand-in for one.
 *
 * Both are deliberately narrow. The reader refuses what it does not implement — a
 * multi-disk archive, ZIP64, a compression method other than stored or deflate — and it
 * says which rule refused it, because a refusal with no reason is indistinguishable from
 * a bug. The writer emits stored entries unless asked to deflate, because a fixture does
 * not need compression and an unused code path is a liability rather than a feature.
 *
 * This is not the package container. SPEC.md §2 makes the package a directory; this is
 * the container the *source* arrives in.

 */

import { deflateRawSync, inflateRawSync } from 'node:zlib';

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = (c & 1) === 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

/** @param {Uint8Array} data */
export function crc32(data) {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

// ------------------------------------------------------------------ writer

/**
 * Build an archive. Stored entries unless `{ deflate: true }`, in which case each entry
 * is deflated and the CRC recorded is the CRC of the *uncompressed* bytes, which is what
 * the format states and what a reader will compute.
 *
 * @param {Array<{name: string, data: Uint8Array|Buffer}>} entries
 * @param {{deflate?: boolean}} [options]
 * @returns {Buffer}
 */
export function writeZip(entries, { deflate = false } = {}) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('writeZip needs at least one entry');
  }
  if (entries.length > 0xffff) {
    throw new Error('writeZip does not emit ZIP64: at most 65535 entries');
  }

  const parts = [];
  const directory = [];
  let offset = 0;

  for (const entry of entries) {
    if (typeof entry.name !== 'string' || entry.name === '') {
      throw new Error('writeZip: every entry needs a name');
    }
    const original = Buffer.from(entry.data);
    if (original.length > 0xffffffff) {
      throw new Error(`writeZip: ${entry.name} is larger than the format states`);
    }

    const name = Buffer.from(entry.name, 'utf8');
    const crc = crc32(original);
    const packed = deflate ? deflateRawSync(original) : original;
    const method = deflate ? 8 : 0;

    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);      // version needed to extract
    head.writeUInt16LE(0x0800, 6);  // bit 11 set: the name is UTF-8
    head.writeUInt16LE(method, 8);
    head.writeUInt16LE(0, 10);      // time
    head.writeUInt16LE(0, 12);      // date
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(packed.length, 18);
    head.writeUInt32LE(original.length, 22);
    head.writeUInt16LE(name.length, 26);
    head.writeUInt16LE(0, 28);      // extra length
    parts.push(head, name, packed);

    const entry_record = Buffer.alloc(46);
    entry_record.writeUInt32LE(0x02014b50, 0);
    entry_record.writeUInt16LE(20, 4);   // version made by
    entry_record.writeUInt16LE(20, 6);   // version needed
    entry_record.writeUInt16LE(0x0800, 8);
    entry_record.writeUInt16LE(method, 10);
    entry_record.writeUInt16LE(0, 12);
    entry_record.writeUInt16LE(0, 14);
    entry_record.writeUInt32LE(crc, 16);
    entry_record.writeUInt32LE(packed.length, 20);
    entry_record.writeUInt32LE(original.length, 24);
    entry_record.writeUInt16LE(name.length, 28);
    entry_record.writeUInt16LE(0, 30);   // extra
    entry_record.writeUInt16LE(0, 32);   // comment
    entry_record.writeUInt16LE(0, 34);   // disk number start
    entry_record.writeUInt16LE(0, 36);   // internal attributes
    entry_record.writeUInt32LE(0, 38);   // external attributes
    entry_record.writeUInt32LE(offset, 42);
    directory.push(entry_record, name);

    offset += 30 + name.length + packed.length;
  }

  const central = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);             // disk number
  end.writeUInt16LE(0, 6);             // disk with the central directory
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);            // comment length

  return Buffer.concat([...parts, central, end]);
}

// ------------------------------------------------------------------ reader

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

const nameDecoder = new TextDecoder('utf-8', { fatal: true });

/** @returns {string|null} null when the bytes are not valid UTF-8 */
function decodeName(bytes) {
  try {
    return nameDecoder.decode(bytes);
  } catch {
    return null;
  }
}

/**
 * The end-of-central-directory record is found by scanning backwards over at most
 * 65,535 bytes, because a comment may sit between it and the end of the file.
 *
 * @param {Buffer} buffer
 * @returns {number} the offset, or -1
 */
function findEndRecord(buffer) {
  const lowest = Math.max(0, buffer.length - 22 - 0xffff);
  for (let at = buffer.length - 22; at >= lowest; at -= 1) {
    if (buffer.readUInt32LE(at) === EOCD_SIGNATURE) return at;
  }
  return -1;
}

/**
 * @param {Buffer} buffer
 * @returns {{ok: true, entries: Array<object>} | {ok: false, code: string, reason: string, entries: null}}
 */
export function readZip(buffer) {
  const refuse = (code, reason) => ({ ok: false, code, reason, entries: null });

  if (buffer.length < 22) return refuse('NO_EOCD', 'the buffer is shorter than an empty archive');

  const endAt = findEndRecord(buffer);
  if (endAt === -1) return refuse('NO_EOCD', 'no end-of-central-directory record was found');

  const diskNumber = buffer.readUInt16LE(endAt + 4);
  const diskWithDirectory = buffer.readUInt16LE(endAt + 6);
  const entriesOnThisDisk = buffer.readUInt16LE(endAt + 8);
  const totalEntries = buffer.readUInt16LE(endAt + 10);
  const directorySize = buffer.readUInt32LE(endAt + 12);
  const directoryOffset = buffer.readUInt32LE(endAt + 16);

  if (diskNumber !== 0 || diskWithDirectory !== 0) {
    return refuse('MULTI_DISK', 'a multi-disk archive, which this reader does not implement');
  }
  if (entriesOnThisDisk !== totalEntries) {
    return refuse('MALFORMED', 'the two entry counts in the end record disagree');
  }
  if (totalEntries === 0) return refuse('EMPTY', 'the archive declares no entries');
  if (directoryOffset === 0xffffffff || directorySize === 0xffffffff) {
    return refuse('ZIP64', 'a ZIP64 end record, which this reader does not implement');
  }
  if (directoryOffset + directorySize > buffer.length) {
    return refuse('TRUNCATED', 'the central directory runs past the end of the buffer');
  }

  const entries = [];
  let at = directoryOffset;

  for (let index = 0; index < totalEntries; index += 1) {
    if (at + 46 > buffer.length) {
      return refuse('TRUNCATED', 'a central directory header runs past the end of the buffer');
    }
    if (buffer.readUInt32LE(at) !== CENTRAL_SIGNATURE) {
      return refuse('MALFORMED', 'a central directory header does not begin with its signature');
    }

    const flags = buffer.readUInt16LE(at + 8);
    const method = buffer.readUInt16LE(at + 10);
    const statedCrc = buffer.readUInt32LE(at + 16);
    const packedSize = buffer.readUInt32LE(at + 20);
    const statedSize = buffer.readUInt32LE(at + 24);
    const nameLength = buffer.readUInt16LE(at + 28);
    const extraLength = buffer.readUInt16LE(at + 30);
    const commentLength = buffer.readUInt16LE(at + 32);
    const diskStart = buffer.readUInt16LE(at + 34);
    const localOffset = buffer.readUInt32LE(at + 42);

    if (diskStart === 0xffff || localOffset === 0xffffffff || packedSize === 0xffffffff || statedSize === 0xffffffff) {
      return refuse('ZIP64', 'a ZIP64 field in an entry');
    }
    if (method !== 0 && method !== 8) {
      return refuse('METHOD', `compression method ${method} is neither stored nor deflate`);
    }

    const nameBytes = buffer.subarray(at + 46, at + 46 + nameLength);
    const name = decodeName(nameBytes);
    if (name === null) return refuse('NAME_DECODE', 'an entry name is not valid UTF-8');

    // The local header is read separately, and its name is compared with the central
    // directory's name. Both copies are well formed and one claim is false, which is a
    // different sentence from "these bytes are not a header".
    if (localOffset + 30 > buffer.length) {
      return refuse('TRUNCATED', 'a local header runs past the end of the buffer');
    }
    if (buffer.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) {
      return refuse('MALFORMED', 'a local header does not begin with its signature');
    }
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const localName = decodeName(buffer.subarray(localOffset + 30, localOffset + 30 + localNameLength));
    if (localName === null) return refuse('NAME_DECODE', 'a local entry name is not valid UTF-8');
    if (localName !== name) {
      return refuse('LOCAL_MISMATCH', 'the local header name differs from the central directory name');
    }

    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    if (dataStart + packedSize > buffer.length) {
      return refuse('TRUNCATED', 'entry data runs past the end of the buffer');
    }

    const packedBytes = buffer.subarray(dataStart, dataStart + packedSize);
    let data;
    if (method === 0) {
      data = Buffer.from(packedBytes);
    } else {
      try {
        data = inflateRawSync(packedBytes);
      } catch {
        return refuse('DEFLATE', 'a deflate stream could not be inflated');
      }
    }

    if (data.length !== statedSize) {
      return refuse('MALFORMED', 'the extracted size differs from the size the directory states');
    }
    if (crc32(data) !== statedCrc) {
      return refuse('CRC', 'the CRC of the extracted data differs from the CRC the directory states');
    }

    // A data descriptor (flag bit 3) puts the sizes after the data rather than in the
    // local header. The central directory's sizes were used, so nothing here depends on
    // that flag being clear.
    entries.push({
      name,
      method,
      size: statedSize,
      data,
      directory: name.endsWith('/'),
      hasDataDescriptor: (flags & 0x0008) !== 0,
    });

    at += 46 + nameLength + extraLength + commentLength;
  }

  return { ok: true, code: null, reason: null, entries };
}