import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MANIFEST_NAME, buildManifest, canonicalJson } from '../src/manifest.js';
import { STATUS, verifyPackage } from '../src/verify.js';
import { writeZip } from '../src/zip.js';
import { convertMyCase } from '../src/adapters/mycase.js';

function buildFixtureZip() {
  const cases = 'Case Number,Case Name,Status,Date Opened,Case Type\n'
    + '1001,Smith v Jones,Open,2026-01-15,Personal Injury\n'
    + '1002,Estate of Brown,Open,2026-02-20,Probate\n';
  const clients = 'Name,Email,Phone,Type\n'
    + 'Ana Silva,ana@example.com,555-0101,Client\n'
    + 'Ben Okafor,ben@example.com,555-0102,Client\n';
  const documents = 'Case Number,Name,Date Created,Folder\n'
    + '1001,engagement_letter.pdf,2026-01-15,Correspondence\n'
    + '1001,medical_records.pdf,2026-01-20,Evidence\n'
    + '1002,will_original.pdf,2026-02-20,Originals\n';
  const trust = 'Case Number,Date,Amount,Type,Memo\n'
    + '1001,2026-01-20,2500.00,Deposit,Retainer received\n';
  const unknown = 'SomeColumn,Another\nvalue1,value2\n';

  return writeZip([
    { name: 'Cases.csv', data: cases },
    { name: 'Clients.csv', data: clients },
    { name: 'Documents.csv', data: documents },
    { name: 'Trust Activity.csv', data: trust },
    { name: 'Something Unexpected.csv', data: unknown },
  ]);
}

async function makeFixture() {
  const root = await mkdtemp(join(tmpdir(), 'copyhold-convert-'));
  const backupPath = join(root, 'backup.zip');
  await writeFile(backupPath, buildFixtureZip());
  const documentsDir = join(root, 'downloaded');
  await mkdir(join(documentsDir, '1001'), { recursive: true });
  await mkdir(join(documentsDir, '1002'), { recursive: true });
  await writeFile(join(documentsDir, '1001', 'engagement_letter.pdf'), 'ENGAGEMENT LETTER');
  await writeFile(join(documentsDir, '1002', 'will_original.pdf'), 'WILL CONTENT');
  const packageDir = join(root, 'package');
  return { root, backupPath, documentsDir, packageDir };
}

test('the adapter converts a backup and verifies the result', async (t) => {
  const { root, backupPath, documentsDir, packageDir } = await makeFixture();
  t.after(() => rm(root, { recursive: true, force: true }));

  const { dispositions, documentCount } = await convertMyCase({ backupPath, documentsDir, packageDir });
  const manifest = await buildManifest(packageDir, { source: { system: 'mycase' } });
  await writeFile(join(packageDir, MANIFEST_NAME), canonicalJson(manifest), 'utf8');
  const { status } = await verifyPackage(packageDir);
  assert.equal(status, STATUS.VERIFIED);
});

test('rows in equals rows out: every source row is accounted for', async (t) => {
  const { root, backupPath, documentsDir, packageDir } = await makeFixture();
  t.after(() => rm(root, { recursive: true, force: true }));

  const { dispositions, documentCount } = await convertMyCase({ backupPath, documentsDir, packageDir });

  // 2 cases + 2 clients + 3 document rows + 1 trust row = 8 record rows
  const imported = dispositions.filter((d) => d.kind === 'record_row' && d.state === 'imported');
  assert.equal(imported.length, 8);

  // 3 documents listed, 2 matched, 1 listed-but-absent
  const docRows = dispositions.filter((d) => d.kind === 'document');
  assert.equal(docRows.filter((d) => d.reason === 'MATCHED').length, 2);
  assert.equal(docRows.filter((d) => d.reason === 'LISTED_NOT_PRESENT').length, 1);
  assert.equal(documentCount, 2);
});

test('a listed-but-absent document is needs_decision, not silence', async (t) => {
  const { root, backupPath, documentsDir, packageDir } = await makeFixture();
  t.after(() => rm(root, { recursive: true, force: true }));

  const { dispositions } = await convertMyCase({ backupPath, documentsDir, packageDir });

  // medical_records.pdf is listed but not in the documents folder
  const absent = dispositions.find((d) => d.reason === 'LISTED_NOT_PRESENT');
  assert.ok(absent, 'a listed-but-absent document must be tracked');
  assert.equal(absent.state, 'needs_decision');
});

test('unrecognised columns are preserved under their own name', async (t) => {
  const { root, backupPath, documentsDir, packageDir } = await makeFixture();
  t.after(() => rm(root, { recursive: true, force: true }));

  await convertMyCase({ backupPath, documentsDir, packageDir });

  const mattersCsv = await readFile(join(packageDir, 'records', 'matters.csv'), 'utf8');
  assert.ok(mattersCsv.includes('Case Type'), 'an unmapped source column must be preserved');
});

test('a missing source file is needs_decision, not silence', async (t) => {
  const { root, backupPath, documentsDir, packageDir } = await makeFixture();
  t.after(() => rm(root, { recursive: true, force: true }));

  const { dispositions } = await convertMyCase({ backupPath, documentsDir, packageDir });
  const missing = dispositions.filter((d) => d.kind === 'source_file' && d.reason === 'MISSING_SOURCE');
  assert.ok(missing.length > 0, 'at least one source file must be reported as missing');
  assert.ok(missing.every((d) => d.state === 'needs_decision'));
});

test('an unrecognised ZIP entry is tracked, not silently dropped', async (t) => {
  const { root, backupPath, documentsDir, packageDir } = await makeFixture();
  t.after(() => rm(root, { recursive: true, force: true }));

  const { dispositions } = await convertMyCase({ backupPath, documentsDir, packageDir });
  const unexpected = dispositions.filter((d) => d.reason === 'UNRECOGNISED_FILE');
  assert.ok(unexpected.length > 0, 'the unknown CSV must be tracked');
});