/**
 * Conflict checking: the system NY Rule 1.10(e) obliges a firm to maintain.
 *
 * The rule says a firm must make *"a written record of its engagements, at or near
 * the time of each engagement"* and must *"implement and maintain a system by which
 * proposed engagements are checked against current and previous engagements"*, and
 * Rule 1.10(f) makes *"substantial failure to keep"* those records *"a violation"*.
 *
 * So this module does two things, and both are required:
 *
 * 1. **The check** — it searches proposed party names against every party name in
 *    the package's records, including closed matters and declined engagements. It
 *    produces **candidates, never a verdict** — the system surfaces matches and a
 *    lawyer decides.
 * 2. **The record** — it writes the check itself to a CSV, because a search that is
 *    not logged is indistinguishable from no search, and will be indistinguishable
 *    to a disciplinary panel too.
 *
 * The search is never auto-cleared. A tool that resolves a conflict has taken on a
 * duty it cannot discharge.
 */

import { extractEntity, normaliseName, soundex, editDistance } from './names.js';
import { csvRow, parseCsv } from './csv.js';

// ------------------------------------------------------------ index

/**
 * Build a conflict index from the package's contacts and matters records.
 *
 * @param {{contacts: {headers: string[], rows: Array<Array<string>>}|null,
 *          matters: {headers: string[], rows: Array<Array<string>>}|null,
 *          contactsMap: Record<string, number>|null,
 *          mattersMap: Record<string, number>|null}} sources
 */
export function buildConflictIndex({ contacts, matters, contactsMap, mattersMap }) {
  const index = [];

  if (matters && mattersMap) {
    const nameIdx = mattersMap.client;
    const refIdx = mattersMap.matter_number;
    if (nameIdx !== undefined) {
      for (const row of matters.rows) {
        const name = row[nameIdx] ?? '';
        if (name === '') continue;
        const e = extractEntity(name);
        index.push({
          name, normalised: normaliseName(name), phonetic: soundex(name),
          stem: e.stem, suffix: e.suffix,
          source: 'matter_client',
          ref: refIdx !== undefined ? (row[refIdx] ?? '') : '',
        });
      }
    }
  }

  if (contacts && contactsMap) {
    const nameIdx = contactsMap.name;
    if (nameIdx !== undefined) {
      for (const row of contacts.rows) {
        const name = row[nameIdx] ?? '';
        if (name === '') continue;
        const e = extractEntity(name);
        index.push({
          name, normalised: normaliseName(name), phonetic: soundex(name),
          stem: e.stem, suffix: e.suffix,
          source: 'contact', ref: '',
        });
      }
    }
  }

  return index;
}

// ------------------------------------------------------------ check

export function checkConflicts(index, proposedParties) {
  const results = [];
  for (const party of proposedParties) {
    const n = normaliseName(party);
    const e = extractEntity(party);
    const p = soundex(party);

    for (const entry of index) {
      let basis = null;
      if (entry.normalised === n && n !== '') basis = 'exact';
      else if (entry.stem === e.stem && e.stem !== '' && n !== '') basis = 'entity_exact';
      else if (n.length >= 3 && (entry.normalised.startsWith(n) || n.startsWith(entry.normalised))) basis = 'prefix';
      else if (entry.phonetic === p && p !== '' && n.length >= 3) basis = 'phonetic';
      else if (n.length >= 3 && editDistance(entry.normalised, n) <= 2) basis = 'edit_distance';
      if (basis !== null) {
        results.push({ proposed: party, matched: entry.name, basis, source: entry.source, ref: entry.ref });
      }
    }
  }
  return results;
}

// ------------------------------------------------------------ record

export function writeConflictCheckCsv(results, meta) {
  let csv = csvRow(['searched_at', 'searched_by', 'proposed', 'matched', 'basis', 'source', 'ref', 'resolution', 'resolved_by']);
  for (const r of results) {
    csv += csvRow([meta.searchedAt, meta.searchedBy, r.proposed, r.matched, r.basis, r.source, r.ref, meta.resolution, meta.resolvedBy]);
  }
  if (results.length === 0) {
    csv += csvRow([meta.searchedAt, meta.searchedBy, meta.parties.join('; '), '(no matches)', 'no_match', '', '', meta.resolution, meta.resolvedBy]);
  }
  return csv;
}

export function writeEngagementCsv(meta) {
  return csvRow(['recorded_at', 'parties', 'decision', 'decision_reason', 'matter_number', 'recorded_by'])
    + csvRow([meta.searchedAt, meta.parties.join('; '), meta.decision, meta.decisionReason, meta.matterNumber, meta.searchedBy]);
}