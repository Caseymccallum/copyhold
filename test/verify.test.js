import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MANIFEST_NAME, buildManifest, canonicalJson } from '../src/manifest.js';
import { RESULT, STATUS, verifyPackage } from '../src/verify.js';

const MATTERS_CSV = 'number,title,client\n1001,Smith,Acme Ltd\n1002,Jones,Beta Inc\n';

/**
 * A package with two record files, one document, and one original source file whose
 * digest the manifest records.
 */
async function makePackage() {
  const root = await mkdtemp(join(tmpdir(), 'copyhold-'));
  const pkg = join(root, 'package');
  const src = join(root, 'source');

  await mkdir(join(pkg, 'records'), { recursive: true });
  await mkdir(join(pkg, 'documents'), { recursive: true });
  await mkdir(src, { recursive: true });

  await writeFile(join(pkg, 'records', 'matters.csv'), MATTERS_CSV, 'utf8');
  await writeFile(join(pkg, 'records', 'contacts.csv'), 'name,email\nAcme Ltd,a@example.com\n', 'utf8');
  await writeFile(join(pkg, 'documents', 'statement.txt'), 'a statement', 'utf8');
  await writeFile(join(src, 'matters_export.csv'), 'Number,Title\n1001,Smith\n1002,Jones\n', 'utf8');

  const manifest = await buildManifest(pkg, {
    source: { system: 'mycase' },
    inputs: [join(src, 'matters_export.csv')],
  });
  await writeFile(join(pkg, MANIFEST_NAME), canonicalJson(manifest), 'utf8');

  return { root, pkg, src };
}

async function readManifest(pkg) {
  return JSON.parse(await readFile(join(pkg, MANIFEST_NAME), 'utf8'));
}

async function writeManifest(pkg, manifest) {
  await writeFile(join(pkg, MANIFEST_NAME), canonicalJson(manifest), 'utf8');
}

const find = (checks, id) => checks.find((c) => c.id === id);

test('a package built by pack verifies, and says which check it did not run', async (t) => {
  const { root, pkg } = await makePackage();
  t.after(() => rm(root, { recursive: true, force: true }));

  const { status, checks } = await verifyPackage(pkg);

  assert.equal(status, STATUS.VERIFIED);
  assert.equal(find(checks, 'L1.PACKAGE.UNLISTED').result, RESULT.PASS);
  assert.equal(find(checks, 'L1.FILE.SHA256').result, RESULT.PASS);
  assert.equal(find(checks, 'L1.RECORD.ROWS').result, RESULT.PASS);
  assert.equal(find(checks, 'L2.TOTALS.RECORDS').result, RESULT.PASS);
  assert.equal(find(checks, 'L2.TOTALS.DOCUMENTS').result, RESULT.PASS);

  // The check that did not run is named, and does not turn a sound package into a failed one.
  const source = find(checks, 'L2.SOURCE.SHA256');
  assert.equal(source.result, RESULT.SKIPPED);
  assert.match(source.reason, /was NOT checked/);
});

test('supplying the original export turns the skipped check into a passing one', async (t) => {
  const { root, pkg, src } = await makePackage();
  t.after(() => rm(root, { recursive: true, force: true }));

  const { status, checks } = await verifyPackage(pkg, { sourcesDir: src });

  assert.equal(status, STATUS.VERIFIED);
  assert.equal(find(checks, 'L2.SOURCE.SHA256').result, RESULT.PASS);
});

test('an original export that differs from the digest recorded is a failure', async (t) => {
  const { root, pkg, src } = await makePackage();
  t.after(() => rm(root, { recursive: true, force: true }));

  await writeFile(join(src, 'matters_export.csv'), 'Number,Title\n1001,SMITH\n1002,Jones\n', 'utf8');

  const { status, checks } = await verifyPackage(pkg, { sourcesDir: src });

  assert.equal(status, STATUS.BROKEN);
  const check = find(checks, 'L2.SOURCE.SHA256');
  assert.equal(check.result, RESULT.FAIL);
  assert.equal(check.detail.mismatches[0].why, 'sha256');
});

test('a record whose bytes were altered is caught, and the reason names the file', async (t) => {
  const { root, pkg } = await makePackage();
  t.after(() => rm(root, { recursive: true, force: true }));

  await writeFile(join(pkg, 'records', 'matters.csv'), MATTERS_CSV.replace('Smith', 'SMITH'), 'utf8');

  const { status, checks } = await verifyPackage(pkg);
  const check = find(checks, 'L1.FILE.SHA256');

  assert.equal(status, STATUS.BROKEN);
  assert.equal(check.result, RESULT.FAIL);
  assert.equal(check.detail.mismatches[0].path, 'records/matters.csv');
});

test('an extra file that the manifest does not name is a failure, not a warning', async (t) => {
  const { root, pkg } = await makePackage();
  t.after(() => rm(root, { recursive: true, force: true }));

  // The failure this format exists to detect: something arrived that nobody mentioned.
  await writeFile(join(pkg, 'documents', 'late_arrival.txt'), 'nobody said this was here', 'utf8');

  const { status, checks } = await verifyPackage(pkg);
  const check = find(checks, 'L1.PACKAGE.UNLISTED');

  assert.equal(status, STATUS.BROKEN);
  assert.equal(check.result, RESULT.FAIL);
  assert.deepEqual(check.detail.paths, ['documents/late_arrival.txt']);
});

test('a manifest whose own totals disagree with its own entries is caught', async (t) => {
  const { root, pkg } = await makePackage();
  t.after(() => rm(root, { recursive: true, force: true }));

  const manifest = await readManifest(pkg);
  manifest.totals.record_rows += 1; // one row claimed that is not there
  await writeManifest(pkg, manifest);

  const { status, checks } = await verifyPackage(pkg);
  const check = find(checks, 'L2.TOTALS.RECORDS');

  assert.equal(status, STATUS.BROKEN);
  assert.equal(check.result, RESULT.FAIL);
  assert.equal(check.detail.counted.record_rows, 3);
});

test('a format version this verifier does not implement is INCOMPLETE, and stops at level 0', async (t) => {
  const { root, pkg } = await makePackage();
  t.after(() => rm(root, { recursive: true, force: true }));

  const manifest = await readManifest(pkg);
  manifest.format = 'copyhold/9.9';
  await writeManifest(pkg, manifest);

  const { status, checks } = await verifyPackage(pkg);

  assert.equal(status, STATUS.INCOMPLETE);
  assert.equal(find(checks, 'L0.MANIFEST.FORMAT').result, RESULT.UNSUPPORTED);
  // Nothing below level 0 runs: there is no container this reader understands.
  assert.equal(find(checks, 'L1.FILE.SHA256'), undefined);
});

test('a package with no manifest is BROKEN, and says which check failed', async (t) => {
  const { root, pkg } = await makePackage();
  t.after(() => rm(root, { recursive: true, force: true }));

  await rm(join(pkg, MANIFEST_NAME));

  const { status, checks } = await verifyPackage(pkg);

  assert.equal(status, STATUS.BROKEN);
  assert.equal(find(checks, 'L0.MANIFEST.READABLE').result, RESULT.FAIL);
});

test('a manifest missing a required field is BROKEN rather than trusted', async (t) => {
  const { root, pkg } = await makePackage();
  t.after(() => rm(root, { recursive: true, force: true }));

  const manifest = await readManifest(pkg);
  delete manifest.totals;
  await writeManifest(pkg, manifest);

  const { status, checks } = await verifyPackage(pkg);

  assert.equal(status, STATUS.BROKEN);
  assert.equal(find(checks, 'L0.MANIFEST.FIELDS').result, RESULT.FAIL);
  assert.ok(find(checks, 'L0.MANIFEST.FIELDS').detail.problems.includes('totals must be an object'));
});

test('a missing document is named, and the package is BROKEN', async (t) => {
  const { root, pkg } = await makePackage();
  t.after(() => rm(root, { recursive: true, force: true }));

  await rm(join(pkg, 'documents', 'statement.txt'));

  const { status, checks } = await verifyPackage(pkg);
  const check = find(checks, 'L1.FILE.PRESENT');

  assert.equal(status, STATUS.BROKEN);
  assert.equal(check.result, RESULT.FAIL);
  assert.deepEqual(check.detail.paths, ['documents/statement.txt']);
});

test('pack refuses a file it has no way to describe', async (t) => {
  const { root, pkg } = await makePackage();
  t.after(() => rm(root, { recursive: true, force: true }));

  await writeFile(join(pkg, 'stray.txt'), 'where does this go', 'utf8');

  await assert.rejects(
    () => buildManifest(pkg, { source: { system: 'mycase' } }),
    /neither under records\/ nor under documents\//,
  );
});

test('pack refuses a package with no records at all', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'copyhold-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  const pkg = join(root, 'empty');
  await mkdir(join(pkg, 'documents'), { recursive: true });
  await writeFile(join(pkg, 'documents', 'only_a_document.txt'), 'no records here', 'utf8');

  await assert.rejects(
    () => buildManifest(pkg, { source: { system: 'mycase' } }),
    /at least one records\/\*\.csv/,
  );
});
