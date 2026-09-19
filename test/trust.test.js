import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAmount, reconcileTrust, writeTrustReconciliationCsv } from '../src/trust.js';
import { csvRow } from '../src/csv.js';

test('parseAmount handles currency symbols, commas and parentheses', () => {
  assert.equal(parseAmount('2500.00'), 2500.00);
  assert.equal(parseAmount('$2,500.00'), 2500.00);
  assert.equal(parseAmount('(500.00)'), -500.00);
  assert.equal(parseAmount('($1,200.50)'), -1200.50);
  assert.equal(parseAmount(''), null);
  assert.equal(parseAmount('abc'), null);
  assert.equal(parseAmount(null), null);
  assert.equal(parseAmount(undefined), null);
});

test('a simple positive ledger reconciles', () => {
  const rows = [
    ['1001', '2026-01-05', '2500.00', 'Deposit'],
    ['1001', '2026-01-10', '500.00', 'Disbursement'],
  ];
  const r = reconcileTrust(rows, { matterIdx: 0, amountIdx: 2, directionIdx: 3 });
  assert.equal(r.hasNegative, false);
  assert.equal(r.perMatter.length, 1);
  assert.equal(r.perMatter[0].matter, '1001');
  assert.equal(r.perMatter[0].receipts, 2500);
  assert.equal(r.perMatter[0].disbursements, 500);
  assert.equal(r.perMatter[0].balance, 2000);
  assert.equal(r.netBalance, 2000);
});

test('a negative running balance is flagged, not passed', () => {
  const rows = [
    ['1001', '2026-01-05', '500.00', 'Deposit'],
    ['1001', '2026-01-10', '1000.00', 'Disbursement'],
  ];
  const r = reconcileTrust(rows, { matterIdx: 0, amountIdx: 2, directionIdx: 3 });
  assert.equal(r.hasNegative, true);
  assert.equal(r.perMatter[0].hasNegative, true);
  assert.equal(r.perMatter[0].balance, -500);
  assert.equal(r.perMatter[0].negativeAt, 1);
});

test('multiple matters are tracked separately', () => {
  const rows = [
    ['1001', '2026-01-05', '1000.00', 'Deposit'],
    ['1002', '2026-01-06', '2000.00', 'Deposit'],
    ['1001', '2026-01-10', '300.00', 'Disbursement'],
    ['1002', '2026-01-15', '100.00', 'Disbursement'],
  ];
  const r = reconcileTrust(rows, { matterIdx: 0, amountIdx: 2, directionIdx: 3 });
  assert.equal(r.perMatter.length, 2);
  assert.equal(r.perMatter[0].matter, '1001');
  assert.equal(r.perMatter[0].balance, 700);
  assert.equal(r.perMatter[1].matter, '1002');
  assert.equal(r.perMatter[1].balance, 1900);
  assert.equal(r.hasNegative, false);
  assert.equal(r.netBalance, 2600);
});

test('one negative among positives is flagged without affecting the others', () => {
  const rows = [
    ['1001', '2026-01-05', '1000.00', 'Deposit'],
    ['1002', '2026-01-06', '200.00', 'Deposit'],
    ['1002', '2026-01-10', '500.00', 'Disbursement'],
  ];
  const r = reconcileTrust(rows, { matterIdx: 0, amountIdx: 2, directionIdx: 3 });
  assert.equal(r.hasNegative, true);
  assert.equal(r.perMatter[0].hasNegative, false);
  assert.equal(r.perMatter[1].hasNegative, true);
  assert.equal(r.perMatter[0].balance, 1000);
  assert.equal(r.perMatter[1].balance, -300);
});

test('without a direction column, signed amounts determine the direction', () => {
  const rows = [
    ['1001', '2500.00'],
    ['1001', '(500.00)'],
  ];
  const r = reconcileTrust(rows, { matterIdx: 0, amountIdx: 1, directionIdx: null });
  assert.equal(r.hasNegative, false);
  assert.equal(r.perMatter[0].balance, 2000);
  assert.equal(r.totalReceipts, 2500);
  assert.equal(r.totalDisbursements, 500);
});

test('an amount that cannot be parsed is counted, not silently zeroed', () => {
  const rows = [
    ['1001', '2026-01-05', '1000.00', 'Deposit'],
    ['1001', '2026-01-10', 'N/A', 'Disbursement'],
  ];
  const r = reconcileTrust(rows, { matterIdx: 0, amountIdx: 2, directionIdx: 3 });
  assert.equal(r.unparsedAmounts, 1);
  assert.equal(r.perMatter[0].balance, 1000);
});

test('a direction label that matches nothing is counted, not silently zeroed', () => {
  const rows = [
    ['1001', '2026-01-05', '1000.00', 'Deposit'],
    ['1001', '2026-01-10', '300.00', 'Refund'],
  ];
  const r = reconcileTrust(rows, { matterIdx: 0, amountIdx: 2, directionIdx: 3 });
  assert.equal(r.unmatchedDirections, 1);
  assert.equal(r.perMatter[0].balance, 1000);
});

test('the reconciliation CSV has a header and one row per matter', () => {
  const rows = [
    ['1001', '2026-01-05', '1000.00', 'Deposit'],
    ['1002', '2026-01-06', '500.00', 'Deposit'],
  ];
  const r = reconcileTrust(rows, { matterIdx: 0, amountIdx: 2, directionIdx: 3 });
  const csv = writeTrustReconciliationCsv(r.perMatter);
  const lines = csv.split('\r\n').filter((l) => l !== '');
  assert.equal(lines.length, 3); // header + 2 matters
  assert.ok(lines[0].startsWith('matter,'));
  assert.ok(lines[1].includes('1001'));
  assert.ok(lines[2].includes('1002'));
});

test('an empty trust ledger reconciles to zero', () => {
  const r = reconcileTrust([], { matterIdx: 0, amountIdx: 2, directionIdx: 3 });
  assert.equal(r.hasNegative, false);
  assert.equal(r.perMatter.length, 0);
  assert.equal(r.netBalance, 0);
});

test('a row with no matter number goes to (no matter), not dropped', () => {
  const rows = [
    ['', '2026-01-05', '500.00', 'Deposit'],
  ];
  const r = reconcileTrust(rows, { matterIdx: 0, amountIdx: 2, directionIdx: 3 });
  assert.equal(r.perMatter.length, 1);
  assert.equal(r.perMatter[0].matter, '(no matter)');
  assert.equal(r.perMatter[0].balance, 500);
});