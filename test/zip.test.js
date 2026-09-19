import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readZip, writeZip } from '../src/zip.js';

const findEocdOffset = (buffer) => {
  for (let at = buffer.length - 22; at >= 0; at -= 1) {
    if (buffer.readUInt32LE(at) === 0x06054b50) return at;
  }
  return -1;
};

test('a stored archive round trips, and records the method', () => {
  const zip = writeZip([
    { name: 'records/matters.csv', data: 'a,b\n1,2\n' },
    { name: 'records/contacts.csv', data: 'name\nAna\n' },
  ]);
  const read = readZip(zip);

  assert.equal(read.ok, true);
  assert.equal(read.entries.length, 2);
  assert.equal(read.entries[0].name, 'records/matters.csv');
  assert.equal(read.entries[0].data.toString('utf8'), 'a,b\n1,2\n');
  assert.equal(read.entries[0].method, 0);
  assert.equal(read.entries[0].size, 8);
  assert.equal(read.entries[0].directory, false);
  assert.equal(read.entries[1].name, 'records/contacts.csv');
});

test('a deflated archive round trips, and records the method', () => {
  const text = 'hello world, this line repeats. '.repeat(40);
  const zip = writeZip([{ name: 'long.csv', data: text }], { deflate: true });
  const read = readZip(zip);

  assert.equal(read.ok, true);
  assert.equal(read.entries[0].method, 8);
  assert.equal(read.entries[0].data.toString('utf8'), text);
  assert.equal(read.entries[0].size, text.length);
  // The archive is genuinely smaller than the data, which is the point of asking.
  assert.ok(zip.length < text.length);
});

test('an entry with no bytes round trips', () => {
  const zip = writeZip([{ name: 'empty.csv', data: '' }]);
  const read = readZip(zip);

  assert.equal(read.ok, true);
  assert.equal(read.entries[0].size, 0);
  assert.equal(read.entries[0].data.length, 0);
});

test('a name that is not ASCII round trips', () => {
  const zip = writeZip([{ name: 'records/café.csv', data: 'a\n' }]);
  const read = readZip(zip);

  assert.equal(read.ok, true);
  assert.equal(read.entries[0].name, 'records/café.csv');
});

test('a directory entry is marked as one', () => {
  const zip = writeZip([{ name: 'records/', data: '' }]);
  const read = readZip(zip);

  assert.equal(read.entries[0].directory, true);
});

test('a data descriptor does not break the read, and is reported', () => {
  const zip = writeZip([{ name: 'a.csv', data: 'x\n' }]);
  const eocd = findEocdOffset(zip);
  const directoryOffset = zip.readUInt32LE(eocd + 16);
  const localOffset = zip.readUInt32LE(directoryOffset + 42);

  zip.writeUInt16LE(zip.readUInt16LE(directoryOffset + 8) | 0x0008, directoryOffset + 8);
  zip.writeUInt16LE(zip.readUInt16LE(localOffset + 6) | 0x0008, localOffset + 6);

  const read = readZip(zip);

  assert.equal(read.ok, true);
  assert.equal(read.entries[0].hasDataDescriptor, true);
  assert.equal(read.entries[0].data.toString('utf8'), 'x\n');
});

test('a buffer with no end record is refused, with the reason named', () => {
  const zip = writeZip([{ name: 'a.csv', data: 'x\n' }]);
  const read = readZip(zip.subarray(0, zip.length - 30));

  assert.equal(read.ok, false);
  assert.equal(read.code, 'NO_EOCD');
  assert.equal(read.entries, null);
});

test('two entry counts that disagree are refused as malformed', () => {
  const zip = writeZip([{ name: 'a.csv', data: 'x\n' }]);
  const eocd = findEocdOffset(zip);
  zip.writeUInt16LE(9, eocd + 8);

  const read = readZip(zip);

  assert.equal(read.code, 'MALFORMED');
});

test('a ZIP64 offset is refused, not guessed at', () => {
  const zip = writeZip([{ name: 'a.csv', data: 'x\n' }]);
  const eocd = findEocdOffset(zip);
  zip.writeUInt32LE(0xffffffff, eocd + 16);

  const read = readZip(zip);

  assert.equal(read.code, 'ZIP64');
});

test('a compression method this reader does not implement is refused', () => {
  const zip = writeZip([{ name: 'a.csv', data: 'x\n' }]);
  const eocd = findEocdOffset(zip);
  const directoryOffset = zip.readUInt32LE(eocd + 16);
  const localOffset = zip.readUInt32LE(directoryOffset + 42);
  zip.writeUInt16LE(12, directoryOffset + 10);
  zip.writeUInt16LE(12, localOffset + 8);

  const read = readZip(zip);

  assert.equal(read.code, 'METHOD');
});

test('data that does not match its CRC is refused', () => {
  const zip = writeZip([{ name: 'a.csv', data: 'a fairly long line of csv data\n' }]);
  const nameLength = zip.readUInt16LE(26);
  zip[30 + nameLength] ^= 0x01;

  const read = readZip(zip);

  assert.equal(read.code, 'CRC');
});

test('a local name that differs from the central name is refused as a mismatch', () => {
  const zip = writeZip([{ name: 'a.csv', data: 'x\n' }]);
  zip.writeUInt8(0x62, 30); // 'a' becomes 'b', in the local header only

  const read = readZip(zip);

  assert.equal(read.code, 'LOCAL_MISMATCH');
});

test('a multi-disk archive is refused', () => {
  const zip = writeZip([{ name: 'a.csv', data: 'x\n' }]);
  const eocd = findEocdOffset(zip);
  zip.writeUInt16LE(1, eocd + 4);

  const read = readZip(zip);

  assert.equal(read.code, 'MULTI_DISK');
});

test('a buffer shorter than an empty archive is refused', () => {
  const read = readZip(Buffer.from('PK'));

  assert.equal(read.code, 'NO_EOCD');
});

test('writeZip refuses an empty entry list rather than emitting an unusable archive', () => {
  assert.throws(() => writeZip([]), /at least one entry/);
});

test('writeZip refuses an entry with no name', () => {
  assert.throws(() => writeZip([{ data: 'x' }]), /needs a name/);
});