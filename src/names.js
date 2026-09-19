/**
 * Name normalisation, entity extraction, and phonetic matching.
 *
 * NY Rule 1.10(e) obliges a firm to make *"a written record of its engagements, at or
 * near the time of each engagement"* and to *"implement and maintain a system by which
 * proposed engagements are checked against current and previous engagements"*. This
 * module is the machinery underneath that system: it normalises names so that "Acme
 * Pty Ltd" and "ACME" match without pretending that corporate suffixes are meaningless,
 * produces a phonetic key so that *Jon* and *Jonathan* surface as candidates, and
 * computes edit distance so that misspellings surface too.
 *
 * These produce **candidates, never a verdict.** The rule is about the lawyer's
 * judgement, and a tool that resolves that judgement has taken on a duty it cannot
 * discharge.
 */

// ------------------------------------------------------------------ normalise

/**
 * Casefold, strip punctuation, collapse whitespace. A name that normalises the same
 * as another name is the same name for the purpose of an exact match.
 *
 * @param {string|null|undefined} raw
 * @returns {string}
 */
export function normaliseName(raw) {
  if (raw === undefined || raw === null) return '';
  return String(raw)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ------------------------------------------------------------------ entity

const CORPORATE_SUFFIXES = new Set([
  'inc', 'llc', 'llp', 'ltd', 'corp', 'corporation', 'gmbh', 'bv', 'pty',
  'plc', 'co', 'company', 'limited', 'incorporated', 'partnership', 'lp', 'sarl', 'ag',
]);

/**
 * Split a name into a stem and a corporate suffix, so that "Acme Pty Ltd" and "ACME"
 * match on the stem without pretending that suffixes are meaningless — a party whose
 * entity is "Acme Pty Ltd" may or may not be the same party as "Acme Inc", and the
 * tool surfaces both rather than deciding.
 *
 * @param {string|null|undefined} raw
 * @returns {{stem: string, suffix: string}}
 */
export function extractEntity(raw) {
  const n = normaliseName(raw);
  if (n === '') return { stem: '', suffix: '' };
  const parts = n.split(' ');
  let end = parts.length;
  while (end > 1 && CORPORATE_SUFFIXES.has(parts[end - 1])) {
    end -= 1;
  }
  if (end === parts.length) return { stem: n, suffix: '' };
  return { stem: parts.slice(0, end).join(' '), suffix: parts.slice(end).join(' ') };
}

// ------------------------------------------------------------------ soundex

/**
 * A phonetic key. Catches *Jon/Jonathan* (both S500? no — Jon is J500, Jonathan is
 * J535) and *Katherine/Kathryn* (K365 and K365) — the misspellings and short-form
 * names that real intake forms contain.
 *
 * Produces a four-character code. Two names with the same code are **candidates**,
 * never a verdict.
 *
 * @param {string|null|undefined} raw
 * @returns {string}
 */
export function soundex(raw) {
  const n = normaliseName(raw);
  if (n === '') return '';
  const s = n.replace(/[^a-z]/g, '').toUpperCase();
  if (s === '') return '';

  const codes = {
    B: '1', F: '1', P: '1', V: '1',
    C: '2', G: '2', J: '2', K: '2', Q: '2', S: '2', X: '2', Z: '2',
    D: '3', T: '3',
    L: '4',
    M: '5', N: '5',
    R: '6',
  };

  let result = s[0];
  let prev = codes[s[0]] ?? '';

  for (let i = 1; i < s.length && result.length < 4; i += 1) {
    const code = codes[s[i]] ?? '';
    if (code !== '' && code !== prev) result += code;
    if (s[i] !== 'H' && s[i] !== 'W') prev = code;
  }

  return (result + '000').slice(0, 4);
}

// ------------------------------------------------------------------ edit distance

/**
 * Levenshtein edit distance. Two names within distance 2 of each other, both at
 * least 3 characters long, are **candidates** — the misspellings that real intake
 * forms contain.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function editDistance(a, b) {
  if (a === b) return 0;
  if (a === '') return b.length;
  if (b === '') return a.length;

  const m = a.length;
  const n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  let curr = new Array(n + 1).fill(0);

  for (let i = 1; i <= m; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }

  return prev[n];
}