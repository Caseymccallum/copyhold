/**
 * The verifier.
 *
 * SPEC.md §4 is the rule list; this file is one implementation of it. Everything here is
 * written so that a failure names what disagreed with what — a verdict that says only
 * "BROKEN" is indistinguishable from a bug in the verifier.
 */

import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { countCsv, decodeUtf8 } from './csv.js';
import { ALLOWED_UNLISTED, FORMAT, MANIFEST_NAME, RECORDS_DIR, sha256, walk } from './manifest.js';

/** A record path begins with this. Files here are counted; files elsewhere are documents. */
const RECORDS_PREFIX = `${RECORDS_DIR}/`;

export const STATUS = Object.freeze({
  VERIFIED: 'VERIFIED',
  INCOMPLETE: 'INCOMPLETE',
  BROKEN: 'BROKEN',
});

export const RESULT = Object.freeze({
  PASS: 'PASS',
  FAIL: 'FAIL',
  SKIPPED: 'SKIPPED',
  UNSUPPORTED: 'UNSUPPORTED',
});

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isDigits = (v) => typeof v === 'number' && Number.isFinite(v);

function requiredFieldsProblem(m) {
  const problems = [];
  const need = (ok, what) => {
    if (!ok) problems.push(what);
  };

  need(typeof m.format === 'string', 'format must be a string');
  need(isPlainObject(m.tool), 'tool must be an object');
  if (isPlainObject(m.tool)) {
    need(typeof m.tool.name === 'string', 'tool.name must be a string');
    need(typeof m.tool.version === 'string', 'tool.version must be a string');
  }
  need(typeof m.produced_at === 'string', 'produced_at must be a string');
  need(isPlainObject(m.source), 'source must be an object');
  if (isPlainObject(m.source)) {
    need(typeof m.source.system === 'string', 'source.system must be a string');
    need(Array.isArray(m.source.inputs), 'source.inputs must be an array');
    need(typeof m.source.notes === 'string', 'source.notes must be a string');
  }
  need(isPlainObject(m.records), 'records must be an object');
  need(Array.isArray(m.documents), 'documents must be an array');
  need(isPlainObject(m.totals), 'totals must be an object');
  if (isPlainObject(m.totals)) {
    for (const key of ['records', 'record_rows', 'documents', 'document_bytes']) {
      need(isDigits(m.totals[key]), `totals.${key} must be a number`);
    }
  }
  need(
    Array.isArray(m.caveats) && m.caveats.every((c) => typeof c === 'string'),
    'caveats must be an array of strings',
  );

  return problems;
}

/**
 * @param {string} packageDir
 * @param {{sourcesDir?: string|null}} [options]
 * @returns {Promise<{status: string, checks: Array<object>, manifest: object|null}>}
 */
export async function verifyPackage(packageDir, { sourcesDir = null } = {}) {
  const checks = [];
  const add = (id, level, result, reason, detail = null) => {
    checks.push({ id, level, result, reason, detail });
  };

  // ---- Level 0: can the package be read at all -------------------------------

  const manifestPath = join(packageDir, MANIFEST_NAME);
  let manifestBytes;
  try {
    const info = await stat(manifestPath);
    if (!info.isFile()) throw new Error('not a file');
    manifestBytes = await readFile(manifestPath);
    add('L0.MANIFEST.READABLE', 0, RESULT.PASS, `${MANIFEST_NAME} is present`);
  } catch (error) {
    add('L0.MANIFEST.READABLE', 0, RESULT.FAIL, `no readable ${MANIFEST_NAME}`, {
      cause: String(error.message ?? error),
    });
    return { status: STATUS.BROKEN, checks, manifest: null };
  }

  const decoded = decodeUtf8(manifestBytes);
  let manifest = null;
  if (decoded === null) {
    add('L0.MANIFEST.PARSE', 0, RESULT.FAIL, `${MANIFEST_NAME} is not valid UTF-8`);
  } else {
    try {
      const parsed = JSON.parse(decoded);
      if (!isPlainObject(parsed)) {
        add('L0.MANIFEST.PARSE', 0, RESULT.FAIL, `${MANIFEST_NAME} is not a JSON object`);
      } else {
        manifest = parsed;
        add('L0.MANIFEST.PARSE', 0, RESULT.PASS, 'parsed as a JSON object');
      }
    } catch (error) {
      add('L0.MANIFEST.PARSE', 0, RESULT.FAIL, `${MANIFEST_NAME} is not valid JSON`, {
        cause: String(error.message),
      });
    }
  }

  if (manifest === null) {
    return { status: STATUS.BROKEN, checks, manifest: null };
  }

  if (manifest.format === FORMAT) {
    add('L0.MANIFEST.FORMAT', 0, RESULT.PASS, `format is ${FORMAT}`);
  } else {
    add(
      'L0.MANIFEST.FORMAT',
      0,
      RESULT.UNSUPPORTED,
      `format is ${JSON.stringify(manifest.format)}, which this verifier does not implement`,
    );
    return { status: STATUS.INCOMPLETE, checks, manifest };
  }

  const fieldProblems = requiredFieldsProblem(manifest);
  if (fieldProblems.length === 0) {
    add('L0.MANIFEST.FIELDS', 0, RESULT.PASS, 'every required field is present and typed');
  } else {
    add('L0.MANIFEST.FIELDS', 0, RESULT.FAIL, 'required fields are missing or wrong', {
      problems: fieldProblems,
    });
  }

  const files = await walk(packageDir);
  const undecodable = files.filter((f) => f.includes('\uFFFD'));
  if (undecodable.length === 0) {
    add('L0.NAME.DECODE', 0, RESULT.PASS, 'every path is valid UTF-8');
  } else {
    add('L0.NAME.DECODE', 0, RESULT.FAIL, 'a path could not be decoded', { paths: undecodable });
  }

  if (fieldProblems.length > 0) {
    // Nothing below can be trusted when the manifest's own shape is wrong.
    return { status: STATUS.BROKEN, checks, manifest };
  }

  // ---- Level 1: does the package hold together -------------------------------

  const recordPaths = Object.keys(manifest.records);
  const documentPaths = manifest.documents.map((d) => d.path);
  const listed = new Set([...recordPaths, ...documentPaths, MANIFEST_NAME]);

  const unlisted = files.filter((f) => !listed.has(f) && !ALLOWED_UNLISTED.includes(f));
  if (unlisted.length === 0) {
    add('L1.PACKAGE.UNLISTED', 1, RESULT.PASS, 'every file in the package is named by the manifest');
  } else {
    // The check that makes this format worth having: a digest list says nothing about
    // the file nobody mentioned.
    add(
      'L1.PACKAGE.UNLISTED',
      1,
      RESULT.FAIL,
      `${unlisted.length} file(s) in the package are not accounted for by the manifest`,
      { paths: unlisted },
    );
  }

  const present = new Set(files);
  const missing = [...recordPaths, ...documentPaths].filter((p) => !present.has(p));
  if (missing.length === 0) {
    add('L1.FILE.PRESENT', 1, RESULT.PASS, 'every path the manifest names exists');
  } else {
    add('L1.FILE.PRESENT', 1, RESULT.FAIL, `${missing.length} path(s) the manifest names do not exist`, {
      paths: missing,
    });
  }

  const sizeMismatches = [];
  const digestMismatches = [];
  for (const rel of [...recordPaths, ...documentPaths]) {
    if (!present.has(rel)) continue;
    const bytes = await readFile(join(packageDir, rel));
    const stated = rel.startsWith(`${RECORDS_PREFIX}`)
      ? manifest.records[rel]
      : manifest.documents.find((d) => d.path === rel);

    if (bytes.length !== stated.bytes) {
      sizeMismatches.push({ path: rel, stated: stated.bytes, stored: bytes.length });
    }
    const digest = sha256(bytes);
    if (digest !== stated.sha256) {
      digestMismatches.push({ path: rel, stated: stated.sha256, stored: digest });
    }
  }

  add(
    'L1.FILE.SIZE',
    1,
    sizeMismatches.length === 0 ? RESULT.PASS : RESULT.FAIL,
    sizeMismatches.length === 0
      ? 'every stored size matches the size stated'
      : 'a stored size differs from the size stated',
    sizeMismatches.length === 0 ? null : { mismatches: sizeMismatches },
  );

  add(
    'L1.FILE.SHA256',
    1,
    digestMismatches.length === 0 ? RESULT.PASS : RESULT.FAIL,
    digestMismatches.length === 0
      ? 'every stored digest matches the digest stated'
      : 'a stored digest differs from the digest stated',
    digestMismatches.length === 0 ? null : { mismatches: digestMismatches },
  );

  const rowMismatches = [];
  const columnMismatches = [];
  for (const rel of recordPaths) {
    if (!present.has(rel)) continue;
    const counted = countCsv(await readFile(join(packageDir, rel)));
    if (counted === null) {
      rowMismatches.push({ path: rel, stated: manifest.records[rel].rows, counted: null, why: 'not UTF-8' });
      continue;
    }
    if (counted.rows !== manifest.records[rel].rows) {
      rowMismatches.push({ path: rel, stated: manifest.records[rel].rows, counted: counted.rows });
    }
    if (counted.columns !== manifest.records[rel].columns) {
      columnMismatches.push({ path: rel, stated: manifest.records[rel].columns, counted: counted.columns });
    }
  }

  add(
    'L1.RECORD.ROWS',
    1,
    rowMismatches.length === 0 ? RESULT.PASS : RESULT.FAIL,
    rowMismatches.length === 0
      ? 'every record holds the number of data rows stated'
      : 'a record holds a different number of data rows',
    rowMismatches.length === 0 ? null : { mismatches: rowMismatches },
  );

  add(
    'L1.RECORD.COLUMNS',
    1,
    columnMismatches.length === 0 ? RESULT.PASS : RESULT.FAIL,
    columnMismatches.length === 0
      ? 'every record holds the number of columns stated'
      : 'a record holds a different number of columns',
    columnMismatches.length === 0 ? null : { mismatches: columnMismatches },
  );

  // ---- Level 2: does the package agree with its sources ----------------------

  const statedRecordCount = Object.keys(manifest.records).length;
  const statedRowCount = Object.values(manifest.records).reduce((sum, r) => sum + r.rows, 0);
  const recordTotalsAgree =
    manifest.totals.records === statedRecordCount && manifest.totals.record_rows === statedRowCount;
  add(
    'L2.TOTALS.RECORDS',
    2,
    recordTotalsAgree ? RESULT.PASS : RESULT.FAIL,
    recordTotalsAgree
      ? 'the records totals agree with the manifest\u2019s own entries'
      : 'the records totals disagree with the manifest\u2019s own entries',
    recordTotalsAgree
      ? null
      : {
          stated: { records: manifest.totals.records, record_rows: manifest.totals.record_rows },
          counted: { records: statedRecordCount, record_rows: statedRowCount },
        },
  );

  const statedDocCount = manifest.documents.length;
  const statedDocBytes = manifest.documents.reduce((sum, d) => sum + d.bytes, 0);
  const docTotalsAgree =
    manifest.totals.documents === statedDocCount && manifest.totals.document_bytes === statedDocBytes;
  add(
    'L2.TOTALS.DOCUMENTS',
    2,
    docTotalsAgree ? RESULT.PASS : RESULT.FAIL,
    docTotalsAgree
      ? 'the document totals agree with the manifest\u2019s own entries'
      : 'the document totals disagree with the manifest\u2019s own entries',
    docTotalsAgree
      ? null
      : {
          stated: { documents: manifest.totals.documents, document_bytes: manifest.totals.document_bytes },
          counted: { documents: statedDocCount, document_bytes: statedDocBytes },
        },
  );

  if (sourcesDir === null) {
    // A check that did not run is named, not hidden. It does not change the status: the
    // package is intact whether or not anyone brought the original export along.
    add(
      'L2.SOURCE.SHA256',
      2,
      RESULT.SKIPPED,
      'the original export was not supplied, so agreement with it was NOT checked (run: verify <package> --sources <dir>)',
    );
  } else {
    const inputMismatches = [];
    const inputs = Array.isArray(manifest.source.inputs) ? manifest.source.inputs : [];
    for (const input of inputs) {
      try {
        const bytes = await readFile(join(sourcesDir, input.name));
        if (bytes.length !== input.bytes) {
          inputMismatches.push({ name: input.name, why: 'size', stated: input.bytes, found: bytes.length });
          continue;
        }
        const digest = sha256(bytes);
        if (digest !== input.sha256) {
          inputMismatches.push({ name: input.name, why: 'sha256', stated: input.sha256, found: digest });
        }
      } catch {
        inputMismatches.push({ name: input.name, why: 'absent from the sources directory' });
      }
    }
    add(
      'L2.SOURCE.SHA256',
      2,
      inputMismatches.length === 0 ? RESULT.PASS : RESULT.FAIL,
      inputMismatches.length === 0
        ? 'every supplied source file matches the digest recorded for it'
        : 'a supplied source file does not match the digest recorded for it',
      inputMismatches.length === 0 ? null : { mismatches: inputMismatches },
    );
  }

  // ---- The verdict -----------------------------------------------------------

  let status = STATUS.VERIFIED;
  if (checks.some((c) => c.result === RESULT.FAIL)) status = STATUS.BROKEN;
  else if (checks.some((c) => c.result === RESULT.UNSUPPORTED)) status = STATUS.INCOMPLETE;

  return { status, checks, manifest };
}
