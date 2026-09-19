/**
 * The library surface, for a program that wants to verify a package without shelling out.
 *
 * The command line is the primary interface; this is the same code, so a difference
 * between them is a bug rather than two implementations disagreeing. The verifier is
 * the part worth embedding — a firm, an auditor or another tool can check a package
 * without trusting the tool that made it.
 */

export { countCsv, csvEscape, csvRow, decodeUtf8, parseCsv } from './src/csv.js';

export {
  ALLOWED_UNLISTED,
  CAVEATS,
  DOCUMENTS_DIR,
  FORMAT,
  MANIFEST_NAME,
  RECORDS_DIR,
  REPORT_NAME,
  TOOL,
  buildManifest,
  canonicalJson,
  sha256,
  walk,
} from './src/manifest.js';

export { crc32, readZip, writeZip } from './src/zip.js';

export { RESULT, STATUS, verifyPackage } from './src/verify.js';

export { SOURCE_NAME, convertMyCase } from './src/adapters/mycase.js';
