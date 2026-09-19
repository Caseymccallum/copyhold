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
    + '1001,2026-01-20,2500.00,Deposit,Retainer received\n'
    + '1001,2026-02-01,500.00,Disbursement,Filing fee paid\n';
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
  assert.equal(imported.length, 9);

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

test('the trust ledger reconciles, and the reconciliation CSV exists', async (t) => {
  const { root, backupPath, documentsDir, packageDir } = await makeFixture();
  t.after(() => rm(root, { recursive: true, force: true }));

  await convertMyCase({ backupPath, documentsDir, packageDir });

  const reconCsv = await readFile(join(packageDir, 'records', 'trust_reconciliation.csv'), 'utf8');
  const lines = reconCsv.split('\r\n').filter((l) => l !== '');
  assert.equal(lines.length, 2); // header + 1 matter
  assert.ok(lines[1].includes('1001'), 'matter 1001 must be in the reconciliation');
  assert.ok(lines[1].includes('2000.00'), 'balance should be 2500 - 500 = 2000');
  assert.ok(lines[1].includes('no'), 'a positive ledger is not overdrawn');
});

test('a trust ledger that goes negative is flagged as needs_decision', async (t) => {
  const { root, backupPath, documentsDir, packageDir } = await makeFixture();
  t.after(() => rm(root, { recursive: true, force: true }));

  // Overwrite the backup with one that overdraws matter 1001
  const overdrawn = writeZip([
    { name: 'Cases.csv', data: 'Case Number,Case Name,Status\n1001,Smith v Jones,Open\n' },
    { name: 'Trust Activity.csv', data: 'Case Number,Date,Amount,Type\n1001,2026-01-20,500.00,Deposit\n1001,2026-01-25,1000.00,Disbursement\n' },
  ]);
  await writeFile(backupPath, overdrawn);

  const { dispositions } = await convertMyCase({ backupPath, documentsDir, packageDir });
  const negative = dispositions.filter((d) => d.reason === 'NEGATIVE_LEDGER');
  assert.equal(negative.length, 1);
  assert.equal(negative[0].state, 'needs_decision');
  assert.ok(negative[0].detail.includes('1001'));
  assert.ok(negative[0].detail.includes('negative'));
});

test('the converted package works with verify --sources', async (t) => {
  const { root, backupPath, documentsDir, packageDir } = await makeFixture();
  t.after(() => rm(root, { recursive: true, force: true }));

  await convertMyCase({ backupPath, documentsDir, packageDir });
  const manifest = await buildManifest(packageDir, {
    source: { system: 'mycase' }, inputs: [backupPath],
  });
  await writeFile(join(packageDir, MANIFEST_NAME), canonicalJson(manifest), 'utf8');

  const { status } = await verifyPackage(packageDir, { sourcesDir: root });
  assert.equal(status, STATUS.VERIFIED);
});

// ---- Scale ----

const mulberry32 = (seed) => () => {
  let t = (seed += 0x6d2b79f5);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const FIRST = ['Ana', 'Ben', 'Carlos', 'Dana', 'Elena', 'Frank', 'Grace', 'Hector', 'Iris', 'James', 'Katherine', 'Liam', 'Maria', 'Noah', 'Olivia'];
const LAST = ['Silva', 'Okafor', 'Martinez', 'Chen', 'Nguyen', 'Patel', 'Garcia', 'Kim', 'Vasquez'];
const COMPANIES = ['Acme Corp', 'Global Industries LLC', 'Pacific Trading Ltd', 'Meridian Group Inc', 'Sterling Partners'];
const TYPES = ['Personal Injury', 'Family Law', 'Criminal Defense', 'Estate Planning', 'Contract Law'];

test('a 50-matter export converts, reconciles, and verifies', async (t) => {
  const rng = mulberry32(42);
  const root = await mkdtemp(join(tmpdir(), 'copyhold-scale-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];

  const caseRows = [];
  for (let i = 1; i <= 50; i++) {
    const num = String(1000 + i);
    const client = rng() < 0.3 ? pick(COMPANIES) : `${pick(FIRST)} ${pick(LAST)}`;
    caseRows.push(`${num},${client},${rng() < 0.8 ? 'Open' : 'Closed'},2026-01-15,${pick(TYPES)}`);
  }
  const contactRows = [];
  for (let i = 0; i < 50; i++) {
    const name = rng() < 0.3 ? pick(COMPANIES) : `${pick(FIRST)} ${pick(LAST)}`;
    contactRows.push(`${name},${name.toLowerCase().replace(/[^a-z]/g, '.')}@example.com,555-${1000 + i}`);
  }
  const docRows = [];
  const docMatterFor = {};
  for (let i = 1; i <= 60; i++) {
    const num = String(1000 + Math.ceil(i / 2));
    docMatterFor[i] = num;
    docRows.push(`${num},doc_${i}.pdf,2026-03-15`);
  }
  for (let i = 61; i <= 100; i++) {
    docRows.push(`${1000 + 1 + Math.floor(rng() * 50)},absent_${i}.pdf,2026-04-15`);
  }
  const trustRows = [];
  for (let i = 0; i < 30; i++) {
    const num = 1000 + 1 + Math.floor(rng() * 10);
    const type = rng() < 0.6 ? 'Deposit' : 'Disbursement';
    const amount = type === 'Deposit' ? `$${500 + Math.floor(rng() * 2000)}.00` : `$${100 + Math.floor(rng() * 800)}.00`;
    trustRows.push(`${num},2026-06-15,${amount},${type}`);
  }
  trustRows.push('1001,2026-06-01,$50000.00,Disbursement');

  const backupPath = join(root, 'backup.zip');
  await writeFile(backupPath, writeZip([
    { name: 'Cases.csv', data: `Case Number,Client,Status,Date Opened,Case Type\r\n${caseRows.join('\r\n')}\r\n` },
    { name: 'Clients.csv', data: `Name,Email,Phone\r\n${contactRows.join('\r\n')}\r\n` },
    { name: 'Documents.csv', data: `Case Number,Name,Date Created\r\n${docRows.join('\r\n')}\r\n` },
    { name: 'Trust Activity.csv', data: `Case Number,Date,Amount,Type\r\n${trustRows.join('\r\n')}\r\n` },
  ]));

  const documentsDir = join(root, 'docs');
  for (let i = 1; i <= 60; i++) {
    const dir = join(documentsDir, docMatterFor[i]);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `doc_${i}.pdf`), `content ${i}`);
  }

  const packageDir = join(root, 'package');
  const { dispositions, documentCount } = await convertMyCase({ backupPath, documentsDir, packageDir });
  const manifest = await buildManifest(packageDir, { source: { system: 'mycase' }, inputs: [backupPath] });
  await writeFile(join(packageDir, MANIFEST_NAME), canonicalJson(manifest), 'utf8');
  const { status } = await verifyPackage(packageDir, { sourcesDir: root });
  assert.equal(status, STATUS.VERIFIED);

  const imported = dispositions.filter((d) => d.kind === 'record_row' && d.state === 'imported');
  assert.equal(imported.length, 50 + 50 + 100 + 31);
  assert.equal(documentCount, 60);
  assert.equal(dispositions.filter((d) => d.reason === 'LISTED_NOT_PRESENT').length, 40);
  assert.ok(dispositions.filter((d) => d.reason === 'NEGATIVE_LEDGER').length > 0);
  assert.ok(dispositions.filter((d) => d.reason === 'PRESERVED').length > 0);
});