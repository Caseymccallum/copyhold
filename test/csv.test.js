import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countCsv, decodeUtf8 } from '../src/csv.js';

const bytes = (text) => new TextEncoder().encode(text);

test('counts a simple record set, header excluded', () => {
  assert.deepEqual(countCsv(bytes('a,b\n1,2\n3,4\n')), { columns: 2, rows: 2 });
});

test('a file with no trailing newline still counts its last record', () => {
  assert.deepEqual(countCsv(bytes('a,b\n1,2')), { columns: 2, rows: 1 });
});

test('CRLF ends a record and is not counted as data', () => {
  assert.deepEqual(countCsv(bytes('a,b\r\n1,2\r\n')), { columns: 2, rows: 1 });
});

test('a lone CR is data, not a record separator', () => {
  // One record, one data row. A counter that treated \r as a separator would say two.
  assert.deepEqual(countCsv(bytes('a,b\nx\ry,2\n')), { columns: 2, rows: 1 });
});

test('a quoted field may contain a newline without ending the record', () => {
  assert.deepEqual(countCsv(bytes('a,b\n"x\ny",2\n')), { columns: 2, rows: 1 });
});

test('a doubled quote inside a quoted field is one field', () => {
  assert.deepEqual(countCsv(bytes('a,b\n"q""q",2\n')), { columns: 2, rows: 1 });
});

test('a quoted header field may contain a comma', () => {
  assert.deepEqual(countCsv(bytes('a,"b,c",d\n1,2,3\n')), { columns: 3, rows: 1 });
});

test('a leading byte-order mark is not part of the first header name', () => {
  assert.deepEqual(countCsv(bytes('\uFEFFa,b\n1,2\n')), { columns: 2, rows: 1 });
});

test('a trailing blank line is not a data row', () => {
  assert.deepEqual(countCsv(bytes('a,b\n1,2\n\n')), { columns: 2, rows: 1 });
});

test('a line of separators is a data row — those are fields the producer wrote', () => {
  assert.deepEqual(countCsv(bytes('a,b,c\n,,\n')), { columns: 3, rows: 1 });
});

test('an empty file has no columns and no rows', () => {
  assert.deepEqual(countCsv(bytes('')), { columns: 0, rows: 0 });
});

test('a header and nothing else has columns and no data rows', () => {
  assert.deepEqual(countCsv(bytes('a,b\n')), { columns: 2, rows: 0 });
});

test('bytes that are not UTF-8 are refused rather than counted', () => {
  assert.equal(decodeUtf8(Uint8Array.from([0xff, 0xfe, 0x41])), null);
  assert.equal(countCsv(Uint8Array.from([0xff, 0xfe, 0x41])), null);
});
