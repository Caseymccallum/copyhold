import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliseName, extractEntity, soundex, editDistance } from '../src/names.js';
import { buildConflictIndex, checkConflicts, writeConflictCheckCsv, writeEngagementCsv } from '../src/conflicts.js';

test('normaliseName casefolds, strips punctuation and collapses whitespace', () => {
  assert.equal(normaliseName('  Acme  Corp.  '), 'acme corp');
  assert.equal(normaliseName('SMITH & JONES LLP'), 'smith jones llp');
  assert.equal(normaliseName(null), '');
});

test('extractEntity separates the stem from a corporate suffix', () => {
  assert.deepEqual(extractEntity('Acme Pty Ltd'), { stem: 'acme', suffix: 'pty ltd' });
  assert.deepEqual(extractEntity('Smith & Jones LLP'), { stem: 'smith jones', suffix: 'llp' });
  assert.deepEqual(extractEntity('Ana Silva'), { stem: 'ana silva', suffix: '' });
});

test('soundex produces known codes', () => {
  assert.equal(soundex('Smith'), 'S530');
  assert.equal(soundex('Jones'), 'J520');
  assert.equal(soundex('Katherine'), soundex('Kathryn'));
  assert.equal(soundex('Jon'), 'J500');
  assert.equal(soundex('John'), 'J500');
});

test('editDistance computes Levenshtein distance', () => {
  assert.equal(editDistance('kitten', 'sitting'), 3);
  assert.equal(editDistance('abc', 'abc'), 0);
  assert.equal(editDistance('', 'abc'), 3);
});

test('buildConflictIndex extracts names from matters and contacts', () => {
  const matters = { headers: ['Case Number', 'Client', 'Status'], rows: [['1001', 'Ana Silva', 'Open'], ['1002', 'Acme Pty Ltd', 'Closed']] };
  const contacts = { headers: ['Name', 'Email'], rows: [['Ben Okafor', 'ben@example.com']] };
  const index = buildConflictIndex({ contacts, matters, contactsMap: { name: 0 }, mattersMap: { matter_number: 0, client: 1 } });
  assert.equal(index.length, 3);
  assert.ok(index.some((e) => e.name === 'Ana Silva' && e.source === 'matter_client'));
  assert.ok(index.some((e) => e.name === 'Acme Pty Ltd' && e.ref === '1002'));
  assert.ok(index.some((e) => e.name === 'Ben Okafor' && e.source === 'contact'));
});

test('an exact match is found', () => {
  const index = [{ name: 'Ana Silva', normalised: 'ana silva', phonetic: 'A514', stem: 'ana silva', suffix: '', source: 'contact', ref: '' }];
  const results = checkConflicts(index, ['Ana Silva']);
  assert.equal(results.length, 1);
  assert.equal(results[0].basis, 'exact');
});

test('a corporate stem match is found across different suffixes', () => {
  const index = [{ name: 'Acme Pty Ltd', normalised: 'acme pty ltd', phonetic: 'A200', stem: 'acme', suffix: 'ltd', source: 'matter_client', ref: '1001' }];
  const results = checkConflicts(index, ['ACME Inc']);
  assert.equal(results.length, 1);
  assert.equal(results[0].basis, 'entity_exact');
});

test('a phonetic match catches Katherine and Kathryn', () => {
  assert.equal(soundex('Katherine'), soundex('Kathryn'));
  const index = [{ name: 'Kathryn Jones', normalised: 'kathryn jones', phonetic: soundex('Kathryn Jones'), stem: 'kathryn jones', suffix: '', source: 'contact', ref: '' }];
  const results = checkConflicts(index, ['Katherine Jones']);
  assert.ok(results.length > 0, 'phonetic match should find Katherine Jones when Kathryn Jones is in the index');
});

test('a name that matches nothing returns no candidates', () => {
  const index = [{ name: 'Ana Silva', normalised: 'ana silva', phonetic: 'A514', stem: 'ana silva', suffix: '', source: 'contact', ref: '' }];
  const results = checkConflicts(index, ['Zephyr Industries']);
  assert.equal(results.length, 0);
});

test('a system that auto-clears a conflict is not this system', () => {
  const index = [{ name: 'Ana Silva', normalised: 'ana silva', phonetic: 'A514', stem: 'ana silva', suffix: '', source: 'contact', ref: '' }];
  const results = checkConflicts(index, ['Ana Silva']);
  assert.ok(results.length > 0, 'a conflict was found — the tool surfaces it, and a human resolves it');
});

test('the conflict check CSV records the search, even with no matches', () => {
  const meta = { searchedAt: '2026-09-19T12:00:00Z', searchedBy: 'casey@example.com', parties: ['Zephyr Industries'], resolution: 'no_conflict', resolvedBy: 'casey@example.com' };
  const csv = writeConflictCheckCsv([], meta);
  assert.ok(csv.includes('(no matches)'), 'a search with no results must still be recorded');
  assert.ok(csv.includes('no_conflict'), 'the resolution must be recorded');
});

test('the engagement CSV records the decision', () => {
  const meta = { searchedAt: '2026-09-19T12:00:00Z', searchedBy: 'casey@example.com', parties: ['Ana Silva'], decision: 'accepted', decisionReason: 'no conflict found', matterNumber: '1003' };
  const csv = writeEngagementCsv(meta);
  assert.ok(csv.includes('accepted'));
  assert.ok(csv.includes('1003'));
  assert.ok(csv.includes('Ana Silva'));
});