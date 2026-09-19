/**
 * CSV: counting, parsing, and writing, by the rules SPEC.md §4.1 states.
 *
 * The counting is a *claim the package makes about itself* — so it is computed here,
 * in the open, rather than by someone else's implementation. The parser exists because
 * the adapter needs the records, not just the count, and a second parser would be two
 * implementations disagreeing about what a record is.
 */

const decoder = new TextDecoder('utf-8', { fatal: true });

/**
 * @param {Uint8Array} bytes
 * @returns {string|null} null when the bytes are not valid UTF-8
 */
export function decodeUtf8(bytes) {
  try {
    return decoder.decode(bytes);
  } catch {
    return null;
  }
}

/**
 * The parser, shared by every function in this file. Returns the raw records,
 * including blank lines — the caller decides what to do with those.
 *
 * @param {string} text — the CSV text, with any BOM already stripped
 * @returns {Array<Array<string>>}
 */
function parseRecords(text) {
  const records = [];
  let fields = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  const endField = () => { fields.push(field); field = ''; };
  const endRecord = () => { endField(); records.push(fields); fields = []; };

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i += 1; continue;
      }
      field += ch; i += 1; continue;
    }

    if (ch === '"' && field === '') { inQuotes = true; i += 1; continue; }
    if (ch === ',') { endField(); i += 1; continue; }
    if (ch === '\r') {
      if (text[i + 1] === '\n') { endRecord(); i += 2; continue; }
      field += ch; i += 1; continue;
    }
    if (ch === '\n') { endRecord(); i += 1; continue; }

    field += ch; i += 1;
  }

  if (field !== '' || fields.length > 0) endRecord();

  return records;
}

/** @param {Uint8Array} bytes @returns {string|null} the CSV text, BOM stripped */
function readCsvText(bytes) {
  const raw = decodeUtf8(bytes);
  if (raw === null) return null;
  return raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
}

/**
 * @param {Uint8Array} bytes
 * @returns {{columns: number, rows: number}|null} null when the bytes are not UTF-8
 */
export function countCsv(bytes) {
  const text = readCsvText(bytes);
  if (text === null) return null;

  const records = parseRecords(text).filter((r) => !(r.length === 1 && r[0] === ''));
  if (records.length === 0) return { columns: 0, rows: 0 };

  return { columns: records[0].length, rows: records.length - 1 };
}

/**
 * Parse a CSV into its header and data rows. Blank lines are dropped, and the first
 * non-blank record is the header.
 *
 * @param {Uint8Array} bytes
 * @returns {{headers: string[], rows: Array<Array<string>>}|null} null when not UTF-8
 */
export function parseCsv(bytes) {
  const text = readCsvText(bytes);
  if (text === null) return null;

  const records = parseRecords(text).filter((r) => !(r.length === 1 && r[0] === ''));
  if (records.length === 0) return { headers: [], rows: [] };

  return { headers: records[0], rows: records.slice(1) };
}

/** Escape a single value for CSV output, by RFC 4180. */
export function csvEscape(value) {
  const s = String(value ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Join an array of values into one CSV line, with a trailing CRLF. */
export function csvRow(values) {
  return `${values.map(csvEscape).join(',')}\r\n`;
}
