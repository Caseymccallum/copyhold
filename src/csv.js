/**
 * Counting fields and records in CSV, by the rules SPEC.md §4.1 states.
 *
 * Deliberately not a general CSV parser. This counts, and the count is a *claim the
 * package makes about itself* — so it is computed here, in the open, rather than by
 * someone else's implementation, which would be a claim this project could not
 * defend.
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
 * @param {Uint8Array} bytes
 * @returns {{columns: number, rows: number}|null} null when the bytes are not UTF-8
 */
export function countCsv(bytes) {
  const raw = decodeUtf8(bytes);
  if (raw === null) return null;

  // A byte-order mark is a writing-tool artefact, not a field. Excel writes one, and
  // counting it as part of the first header name would make `columns` depend on which
  // program saved the file.
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;

  const records = [];
  let fields = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  const endField = () => {
    fields.push(field);
    field = '';
  };
  const endRecord = () => {
    endField();
    records.push(fields);
    fields = [];
  };

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"' && field === '') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      endField();
      i += 1;
      continue;
    }
    if (ch === '\r') {
      // Only CRLF ends a record. A lone CR is data — treating it as a separator would
      // split a file the producer wrote as one line.
      if (text[i + 1] === '\n') {
        endRecord();
        i += 2;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '\n') {
      endRecord();
      i += 1;
      continue;
    }

    field += ch;
    i += 1;
  }

  // A final record with no trailing newline.
  if (field !== '' || fields.length > 0) endRecord();

  // A completely empty line is not a data row. A producer that ends its file with a blank
  // line has not added a record, and a count that said otherwise would report BROKEN for a
  // file that is exactly as it was written. A line of separators (",,") is NOT blank: those
  // are fields the producer wrote.
  const isBlank = (record) => record.length === 1 && record[0] === '';
  const rows = records.filter((record) => !isBlank(record));

  if (rows.length === 0) return { columns: 0, rows: 0 };

  return {
    columns: rows[0].length,
    rows: rows.length - 1, // the header is not a data row
  };
}
