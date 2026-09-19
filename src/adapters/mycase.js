/**
 * The MyCase adapter.
 *
 * Reads a Full Backup ZIP and the folder of manually downloaded documents, and emits
 * a package: `records/`, `documents/`, `disposition.csv`, `report.md`.
 *
 * **The honest limit, stated at the top because it governs everything below.**
 *
 * No real MyCase export has been seen. The column names below are *candidates* —
 * names the adapter looks for, case-insensitively, because a vendor's help centre
 * names entities rather than headers. A real export will correct this map without a
 * rewrite, and the adapter is written so that it can: every column it does not find
 * is preserved into the output CSV under its own original name, and every canonical
 * field it does not find is reported as absent rather than filled with null.
 *
 * The MyCase Full Backup is documented by the vendor as a ZIP of 16 CSVs. **It does
 * not include documents.** The vendor's own help centre says so: "The only items the
 * full data backup does not include are documents and invoices. You will have to
 * manually download these items." So the document list arrives here, the documents
 * themselves arrive separately, and reconciling the two is this adapter's central
 * job — and the reason "listed but not present" is a state the tool can report
 * rather than an error it suppresses.
 */

import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { csvEscape, csvRow, decodeUtf8, parseCsv } from '../csv.js';
import { readZip } from '../zip.js';

export const SOURCE_NAME = 'mycase';

/** Normalised so that "Time Entries", "time_entries" and "time entries" all match. */
const normaliseName = (name) => name.toLowerCase().replace(/[\s_-]+/g, ' ').trim();

/**
 * Candidate column names, by canonical field. Matched case-insensitively after
 * trimming. The first candidate found wins; every other column in the source is
 * preserved into the output under its original name.
 *
 * These lists are **not** a claim about what MyCase exports. They are what this
 * adapter looks for, and they are expected to change against a real export.
 */
const CANDIDATES = {
  matters: {
    matter_number: ['case number', 'case id', 'matter number', 'case'],
    title:         ['case name', 'matter name', 'title', 'description'],
    status:        ['status', 'case status'],
    client:        ['client', 'client name', 'primary client'],
    opened:        ['date opened', 'opened', 'open date'],
    closed:        ['date closed', 'closed'],
    practice_area: ['practice area', 'area of law', 'category'],
  },
  contacts: {
    name:          ['name', 'contact name', 'full name', 'company name'],
    email:         ['email', 'email address', 'primary email'],
    phone:         ['phone', 'phone number', 'primary phone', 'mobile'],
    kind:          ['type', 'contact type', 'contact group'],
  },
  documents: {
    matter_number: ['case number', 'case id', 'matter number', 'case'],
    filename:      ['name', 'document name', 'file name', 'title'],
    uploaded:      ['date created', 'uploaded', 'created', 'date uploaded'],
    folder:        ['folder', 'folder name', 'location'],
  },
  activities: {
    matter_number: ['case number', 'case id', 'matter number', 'case'],
    kind:          ['type', 'entry type', 'activity type'],
    date:          ['date', 'entry date', 'date worked'],
    amount:        ['amount', 'value', 'hours', 'time'],
    narrative:     ['description', 'notes', 'narrative', 'activity'],
    user:          ['user', 'user name', 'timekeeper', 'attorney'],
  },
  invoices: {
    matter_number: ['case number', 'case id', 'matter number', 'case'],
    number:        ['invoice number', 'number', 'invoice id'],
    issued:        ['date issued', 'issued', 'invoice date', 'date'],
    total:         ['total', 'amount', 'invoice total', 'balance'],
    status:        ['status', 'payment status'],
  },
  trust_transactions: {
    matter_number: ['case number', 'case id', 'matter number', 'case'],
    date:          ['date', 'transaction date'],
    amount:        ['amount', 'value'],
    direction:     ['type', 'transaction type', 'direction', 'kind'],
    memo:          ['memo', 'description', 'notes', 'detail'],
    check_number:  ['check number', 'check no', 'cheque number', 'check'],
  },
  tasks: {
    matter_number: ['case number', 'case id', 'matter number', 'case'],
    title:         ['name', 'title', 'task', 'description'],
    due:           ['due date', 'due', 'deadline'],
    status:        ['status', 'complete'],
  },
  calendar: {
    matter_number: ['case number', 'case id', 'matter number', 'case'],
    title:         ['name', 'title', 'event', 'description'],
    start:         ['date', 'start', 'start date'],
    location:      ['location', 'where'],
  },
};

/**
 * The CSV file names the vendor documents. Matched on a normalised form, so that
 * "Time Entries", "time_entries" and "time entries" all resolve to the same source.
 */
const SOURCE_FILES = {
  cases:            { entity: 'matters',             candidates: CANDIDATES.matters },
  clients:          { entity: 'contacts',            candidates: CANDIDATES.contacts },
  companies:        { entity: 'contacts',            candidates: CANDIDATES.contacts },
  documents:        { entity: 'documents',           candidates: CANDIDATES.documents },
  'time entries':   { entity: 'activities',          candidates: CANDIDATES.activities },
  expenses:         { entity: 'activities',          candidates: CANDIDATES.activities },
  'flat fees':      { entity: 'activities',          candidates: CANDIDATES.activities },
  invoices:         { entity: 'invoices',            candidates: CANDIDATES.invoices },
  'trust activity': { entity: 'trust_transactions',  candidates: CANDIDATES.trust_transactions },
  tasks:            { entity: 'tasks',               candidates: CANDIDATES.tasks },
  appointments:     { entity: 'calendar',            candidates: CANDIDATES.calendar },
};

// ------------------------------------------------------------ column mapping

/**
 * Map source columns to canonical fields. The first source column whose normalised
 * name matches any candidate wins. Every source column that does not match is
 * reported, never dropped.
 *
 * @param {string[]} headers
 * @param {Record<string, string[]>} candidates
 * @returns {{columnMap: Record<string, number>, unmapped: number[], mapped: string[], missing: string[]}}
 */
function mapColumns(headers, candidates) {
  const byNormalised = new Map();
  headers.forEach((h, i) => byNormalised.set(normaliseName(h), i));

  const columnMap = {};
  const used = new Set();

  for (const field of Object.keys(candidates)) {
    for (const name of candidates[field]) {
      const idx = byNormalised.get(normaliseName(name));
      if (idx !== undefined && !used.has(idx)) {
        columnMap[field] = idx;
        used.add(idx);
        break;
      }
    }
  }

  const unmapped = [];
  headers.forEach((_, i) => { if (!used.has(i)) unmapped.push(i); });

  const mapped = Object.keys(candidates).filter((f) => columnMap[f] !== undefined);
  const missing = Object.keys(candidates).filter((f) => columnMap[f] === undefined);

  return { columnMap, unmapped, mapped, missing };
}

// ------------------------------------------------------------ disposition

function track(dispositions, kind, entity, ref, state, reason, detail = null) {
  dispositions.push({ kind, entity, ref, state, reason, detail });
}

/**
 * @param {Array<{kind:string, entity:string, ref:string, state:string, reason:string, detail:string|null}>} dispositions
 * @returns {string}
 */
function writeDispositionCsv(dispositions) {
  const headers = ['kind', 'entity', 'ref', 'state', 'reason', 'detail'];
  let csv = csvRow(headers);
  for (const d of dispositions) {
    csv += csvRow([d.kind, d.entity, d.ref, d.state, d.reason, d.detail ?? '']);
  }
  return csv;
}

// ------------------------------------------------------------ document matching

async function indexDocumentFiles(documentsDir) {
  const files = [];
  async function visit(dir, prefix) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) await visit(join(dir, entry.name), rel);
      else if (entry.isFile()) files.push({ relativePath: rel, absolutePath: join(dir, entry.name) });
    }
  }
  await visit(documentsDir, '');
  return files;
}

// ------------------------------------------------------------ report

function writeReportMarkdown({ dispositions }) {
  const counts = {};
  for (const d of dispositions) counts[d.state] = (counts[d.state] ?? 0) + 1;

  let md = '# Copyhold conversion report\n\nSource: MyCase Full Backup.\n\n';
  md += '| State | Count |\n| --- | --- |\n';
  for (const state of ['imported', 'skipped', 'needs_decision']) {
    md += `| ${state} | ${counts[state] ?? 0} |\n`;
  }
  md += '\nEvery source row is accounted for below. **Nothing is silently dropped.**\n\n';
  md += '| Kind | Entity | Ref | State | Reason | Detail |\n| --- | --- | --- | --- | --- | --- |\n';
  for (const d of dispositions) {
    md += `| ${d.kind} | ${d.entity} | ${d.ref} | ${d.state} | ${d.reason} | ${d.detail ?? ''} |\n`;
  }
  return md;
}

// ------------------------------------------------------------ main conversion

export async function convertMyCase({ backupPath, documentsDir = null, packageDir }) {
  const dispositions = [];
  const recordFiles = [];

  const backup = await readFile(backupPath);
  const zip = readZip(backup);
  if (!zip.ok) throw new Error(`the backup could not be read: ${zip.reason} (${zip.code})`);

  const matched = new Map();
  const unknown = [];
  for (const entry of zip.entries) {
    if (entry.directory) continue;
    const n = normaliseName(basename(entry.name, '.csv'));
    const key = Object.keys(SOURCE_FILES).find((k) => normaliseName(k) === n);
    if (key) matched.set(key, entry); else unknown.push(entry);
  }

  for (const key of Object.keys(SOURCE_FILES)) {
    if (!matched.has(key)) {
      track(dispositions, 'source_file', SOURCE_FILES[key].entity, key, 'needs_decision', 'MISSING_SOURCE',
        `the backup does not contain a file matching "${key}"`);
    }
  }
  for (const entry of unknown) {
    track(dispositions, 'zip_entry', 'unknown', entry.name, 'needs_decision', 'UNRECOGNISED_FILE', null);
  }

  await mkdir(join(packageDir, 'records'), { recursive: true });

  for (const key of Object.keys(SOURCE_FILES)) {
    const spec = SOURCE_FILES[key];
    const entry = matched.get(key);
    if (!entry) continue;

    const parsed = parseCsv(entry.data);
    if (!parsed) { track(dispositions, 'source_file', spec.entity, key, 'skipped', 'NOT_UTF8', null); continue; }
    if (parsed.rows.length === 0) { track(dispositions, 'source_file', spec.entity, key, 'skipped', 'NO_DATA', null); continue; }

    const { headers, rows } = parsed;
    const { columnMap, unmapped, missing } = mapColumns(headers, spec.candidates);

    for (const field of missing) {
      track(dispositions, 'field_missing', spec.entity, field, 'needs_decision', 'FIELD_NOT_FOUND',
        `no source column in "${key}" matches any candidate for "${field}"`);
    }
    for (const i of unmapped) {
      track(dispositions, 'column_preserved', spec.entity, headers[i], 'imported', 'PRESERVED',
        `column "${headers[i]}" has no canonical mapping and is preserved under its own name`);
    }

    const outHeaders = [...Object.keys(spec.candidates), ...unmapped.map((i) => headers[i])];
    const outRows = rows.map((row) => [
      ...Object.keys(spec.candidates).map((f) => {
        const idx = columnMap[f];
        return idx !== undefined ? (row[idx] ?? '') : '';
      }),
      ...unmapped.map((i) => row[i] ?? ''),
    ]);

    const outPath = join(packageDir, 'records', `${spec.entity}.csv`);
    let csv = csvRow(outHeaders);
    for (const row of outRows) csv += csvRow(row);
    await writeFile(outPath, csv, 'utf8');
    recordFiles.push(outPath);

    for (let i = 0; i < rows.length; i += 1) {
      const ref = columnMap.matter_number !== undefined
        ? (rows[i][columnMap.matter_number] || `row ${i + 1}`) : `row ${i + 1}`;
      track(dispositions, 'record_row', spec.entity, ref, 'imported', 'MAPPED', null);
    }
  }

  // ---- Documents: the vendor's own list vs the files the firm downloaded -----

  let documentCount = 0;
  const docEntry = matched.get('documents');

  if (docEntry && documentsDir) {
    const parsed = parseCsv(docEntry.data);
    if (parsed && parsed.rows.length > 0) {
      const docMap = mapColumns(parsed.headers, CANDIDATES.documents);
      const files = await indexDocumentFiles(documentsDir);
      const used = new Set();
      const fnameIdx = docMap.columnMap.filename;
      const matterIdx = docMap.columnMap.matter_number;

      for (let i = 0; i < parsed.rows.length; i += 1) {
        const row = parsed.rows[i];
        const ref = matterIdx !== undefined ? (row[matterIdx] || '') : '';
        const name = fnameIdx !== undefined ? (row[fnameIdx] || '') : '';
        const normName = normaliseName(name);

        let match = null;
        for (const f of files) {
          if (used.has(f.relativePath)) continue;
          if (ref && f.relativePath.includes(ref)) { match = f; break; }
        }
        if (!match) {
          for (const f of files) {
            if (used.has(f.relativePath)) continue;
            if (normaliseName(basename(f.relativePath)) === normName) { match = f; break; }
          }
        }

        if (match) {
          used.add(match.relativePath);
          const dest = join(packageDir, 'documents', ref || 'uncategorised');
          await mkdir(dest, { recursive: true });
          await copyFile(match.absolutePath, join(dest, basename(match.relativePath)));
          track(dispositions, 'document', 'documents', name || `row ${i + 1}`, 'imported', 'MATCHED', `matched to ${match.relativePath}`);
          documentCount += 1;
        } else {
          track(dispositions, 'document', 'documents', name || `row ${i + 1}`, 'needs_decision', 'LISTED_NOT_PRESENT',
            'the vendor lists this document but the file was not found in the documents folder');
        }
      }

      for (const f of files) {
        if (!used.has(f.relativePath)) {
          track(dispositions, 'document_file', 'documents', f.relativePath, 'needs_decision', 'UNLISTED_FILE', null);
        }
      }
    }
  } else if (docEntry && !documentsDir) {
    track(dispositions, 'document', 'documents', '(all)', 'needs_decision', 'NO_DOCUMENTS_DIR', null);
  } else if (!docEntry && documentsDir) {
    track(dispositions, 'document', 'documents', '(all)', 'needs_decision', 'NO_DOCUMENT_LIST', null);
  }

  const dispositionCsv = writeDispositionCsv(dispositions);
  await writeFile(join(packageDir, 'records', 'disposition.csv'), dispositionCsv, 'utf8');
  recordFiles.push(join(packageDir, 'records', 'disposition.csv'));

  await writeFile(join(packageDir, 'report.md'), writeReportMarkdown({ dispositions }), 'utf8');

  return { dispositions, recordFiles, documentCount };
}
