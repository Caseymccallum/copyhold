/**
 * Trust ledger reconciliation.
 *
 * SPEC.md §7.3 defines the invariants; this module enforces the first one and
 * computes the input to the second.
 *
 * **Invariant 1: no client ledger may go negative.** A disbursement that would
 * overdraw a client's ledger is not a warning. It is a state the reconciliation
 * reports, because TrustBooks markets "protection against overdrawing a client's
 * balance" as a headline feature, which tells you how often it happens.
 *
 * **Invariant 2 (partial here): the tie-out.** The sum of all client ledgers must
 * equal the trust account's total. The bank statement side is not available to the
 * adapter — the firm supplies it — so this module computes the book side and the
 * per-matter side, and the caller checks them against whatever the source states.
 *
 * **The sign convention is not guessed.** A vendor's trust export may use "Deposit"
 * and "Disbursement", or "Credit" and "Debit", or signed amounts, or parenthesised
 * negatives. This module takes the label lists as input and matches them
 * case-insensitively, so a real export corrects the convention without a rewrite.
 */

import { csvRow } from './csv.js';

/**
 * Parse an amount that may carry a currency symbol, thousands separators, or be
 * parenthesised to mean negative. Returns null when the value cannot be parsed,
 * rather than zero, because a zero that hides an unparseable amount is worse than
 * an error that names it.
 *
 * @param {string|null|undefined} value
 * @returns {number|null}
 */
export function parseAmount(value) {
  if (value === undefined || value === null || value === '') return null;
  const cleaned = String(value).replace(/[$\s,]/g, '').trim();
  if (cleaned === '') return null;
  const negative = cleaned.startsWith('(') && cleaned.endsWith(')');
  const stripped = negative ? cleaned.slice(1, -1) : cleaned;
  const n = parseFloat(stripped);
  if (Number.isNaN(n)) return null;
  return negative ? -Math.abs(n) : n;
}

function matchesLabel(value, labels) {
  if (value === undefined || value === null || value === '') return false;
  const n = String(value).toLowerCase().replace(/[\s_-]+/g, ' ').trim();
  return labels.some((l) => l.toLowerCase().replace(/[\s_-]+/g, ' ').trim() === n);
}

/**
 * @param {Array<Array<string>>} rows — data rows (no header)
 * @param {{matterIdx: number, amountIdx: number, directionIdx: number|null,
 *          depositLabels?: string[], disbursementLabels?: string[]}} options
 */
export function reconcileTrust(rows, {
  matterIdx,
  amountIdx,
  directionIdx = null,
  depositLabels = [],
  disbursementLabels = [],
} = {}) {
  const depLabels = depositLabels.length > 0 ? depositLabels
    : ['deposit', 'receipt', 'credit', 'received'];
  const disLabels = disbursementLabels.length > 0 ? disbursementLabels
    : ['disbursement', 'payment', 'debit', 'paid', 'check', 'withdrawal'];

  const perMatterMap = new Map();
  let totalReceipts = 0;
  let totalDisbursements = 0;
  let unparsedAmounts = 0;
  let unmatchedDirections = 0;

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const matter = (matterIdx !== undefined && matterIdx !== null)
      ? (row[matterIdx] || '(no matter)') : '(no matter)';
    const amount = parseAmount(amountIdx !== undefined ? row[amountIdx] : '');

    if (amount === null) { unparsedAmounts += 1; continue; }

    let signed = 0;
    if (directionIdx !== undefined && directionIdx !== null) {
      const direction = row[directionIdx] ?? '';
      if (matchesLabel(direction, depLabels)) signed = Math.abs(amount);
      else if (matchesLabel(direction, disLabels)) signed = -Math.abs(amount);
      else { unmatchedDirections += 1; continue; }
    } else {
      signed = amount;
    }

    if (!perMatterMap.has(matter)) {
      perMatterMap.set(matter, { matter, receipts: 0, disbursements: 0, balance: 0, hasNegative: false, negativeAt: null });
    }
    const ledger = perMatterMap.get(matter);

    if (signed >= 0) {
      ledger.receipts += signed;
      totalReceipts += signed;
    } else {
      ledger.disbursements += Math.abs(signed);
      totalDisbursements += Math.abs(signed);
    }
    ledger.balance += signed;

    if (ledger.balance < 0 && !ledger.hasNegative) {
      ledger.hasNegative = true;
      ledger.negativeAt = i;
    }
  }

  const perMatter = [...perMatterMap.values()].sort((a, b) => a.matter.localeCompare(b.matter));
  const hasNegative = perMatter.some((m) => m.hasNegative);

  return {
    perMatter,
    hasNegative,
    totalReceipts,
    totalDisbursements,
    netBalance: totalReceipts - totalDisbursements,
    unparsedAmounts,
    unmatchedDirections,
  };
}

export function writeTrustReconciliationCsv(perMatter) {
  let csv = 'matter,receipts,disbursements,balance,overdrawn,negative_at\r\n';
  for (const m of perMatter) {
    csv += csvRow([
      m.matter,
      m.receipts.toFixed(2),
      m.disbursements.toFixed(2),
      m.balance.toFixed(2),
      m.hasNegative ? 'YES' : 'no',
      m.negativeAt !== null ? String(m.negativeAt) : '',
    ]);
  }
  return csv;
}