/**
 * Building a manifest, and the canonical form it is written in.
 *
 * SPEC.md §3 is the field list; this file is one implementation of it. `produced_at`
 * is set here and is the tool's own claim — SPEC.md §5 says what that is worth.
 */

import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { countCsv } from './csv.js';

export const FORMAT = 'copyhold/0.1';
export const TOOL = Object.freeze({ name: 'copyhold', version: '0.0.0' });

export const MANIFEST_NAME = 'manifest.json';
export const RECORDS_DIR = 'records';
export const DOCUMENTS_DIR = 'documents';
export const REPORT_NAME = 'report.md';

/** Paths that may sit in a package without being named by the manifest. SPEC §4.2. */
export const ALLOWED_UNLISTED = Object.freeze([MANIFEST_NAME, REPORT_NAME]);

/** Printed with every verdict. SPEC.md §5. */
export const CAVEATS = Object.freeze([
  'This package proves the bytes inside it are intact and accounted for.',
  'It does NOT prove the extraction was complete: if the source system omitted a record or a document, this package cannot know.',
  'It does NOT prove the records are correct. A number can be counted, hashed, and still be wrong.',
  'produced_at is the tool\u2019s own claim. Nothing here witnesses time.',
  'Version 0.1 has no signature: a package proves its contents, not its author.',
]);

/** @param {Uint8Array} bytes */
export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Every file under `root`, as sorted POSIX-style paths relative to `root`.
 * Directories are not returned: a package is files.
 *
 * @param {string} root
 * @returns {Promise<string[]>}
 */
export async function walk(root) {
  const out = [];
  async function visit(dir, prefix) {
    const entries = await readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) await visit(join(dir, entry.name), rel);
      else if (entry.isFile()) out.push(rel);
    }
  }
  await visit(root, '');
  return out;
}

/**
 * JSON with object keys in a stable order, so the manifest's own bytes are
 * reproducible. Array order is meaning and is preserved.
 */
export function canonicalJson(value) {
  return `${JSON.stringify(sortKeys(value), null, 2)}\n`;
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = sortKeys(value[key]);
    return out;
  }
  return value;
}

/**
 * @param {string} packageDir
 * @param {{source?: {system?: string, notes?: string}, inputs?: string[]}} [options]
 *   `inputs` are paths to the files the records were taken from. Their digests go into
 *   the manifest so a later `verify --sources` can check agreement with the original.
 */
export async function buildManifest(packageDir, { source = {}, inputs = [] } = {}) {
  const files = await walk(packageDir);

  const records = {};
  const documents = [];
  let recordRows = 0;

  for (const rel of files) {
    if (rel === MANIFEST_NAME || rel === REPORT_NAME) continue;

    const bytes = await readFile(join(packageDir, rel));

    if (rel.startsWith(`${RECORDS_DIR}/`) && rel.endsWith('.csv')) {
      const counted = countCsv(bytes);
      if (counted === null) {
        throw new Error(
          `${rel} is not valid UTF-8, so its record count cannot be stated. ` +
            'A count that cannot be stated is not a check.'
        );
      }
      records[rel] = {
        bytes: bytes.length,
        sha256: sha256(bytes),
        rows: counted.rows,
        columns: counted.columns,
      };
      recordRows += counted.rows;
    } else if (rel.startsWith(`${DOCUMENTS_DIR}/`)) {
      documents.push({
        path: rel,
        bytes: bytes.length,
        sha256: sha256(bytes),
        source_name: rel.slice(DOCUMENTS_DIR.length + 1),
      });
    } else {
      // Refused rather than silently ignored: a file the manifest cannot describe is a
      // file `verify` would have to call unaccounted for.
      throw new Error(
        `${rel} is neither under ${RECORDS_DIR}/ nor under ${DOCUMENTS_DIR}/, ` +
          'so the manifest has no way to describe it'
      );
    }
  }

  if (Object.keys(records).length === 0) {
    throw new Error(`a package needs at least one ${RECORDS_DIR}/*.csv`);
  }

  const hashedInputs = [];
  for (const path of inputs) {
    const bytes = await readFile(path);
    hashedInputs.push({ name: basename(path), bytes: bytes.length, sha256: sha256(bytes) });
  }

  return {
    format: FORMAT,
    tool: { ...TOOL },
    produced_at: new Date().toISOString(),
    source: {
      system: source.system ?? 'unknown',
      inputs: hashedInputs,
      notes: source.notes ?? '',
    },
    records,
    documents,
    totals: {
      records: Object.keys(records).length,
      record_rows: recordRows,
      documents: documents.length,
      document_bytes: documents.reduce((sum, d) => sum + d.bytes, 0),
    },
    caveats: [...CAVEATS],
  };
}
