#!/usr/bin/env node
/**
 * The command line.
 *
 * Exit codes, so that a script can act on the outcome rather than parse prose:
 *   0  VERIFIED     everything that could be checked passed
 *   1  INCOMPLETE   nothing failed, but something could not be established
 *   2  BROKEN       something the package claims about itself is false
 *  64  usage        the command was not understood
 */

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CAVEATS, MANIFEST_NAME, buildManifest, canonicalJson } from '../src/manifest.js';
import { RESULT, STATUS, verifyPackage } from '../src/verify.js';

const EXIT = { VERIFIED: 0, INCOMPLETE: 1, BROKEN: 2, USAGE: 64 };

const HELP = `copyhold — get a law firm's records out of its practice management software,
and prove what came out.

  copyhold pack   <package-dir> [--source <system>] [--input <file>]...
      Write ${MANIFEST_NAME} for a package directory. The directory must hold
      records/*.csv and may hold documents/**.

  copyhold verify <package-dir> [--sources <dir>] [--json]
      Check a package against its own manifest. With --sources, also check that the
      original export files are the ones the manifest recorded.

  copyhold help

Exit codes: 0 VERIFIED, 1 INCOMPLETE, 2 BROKEN, 64 usage.
`;

function takeFlags(argv) {
  const positional = [];
  const flags = { source: 'unknown', inputs: [], sources: null, json: false };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--source') {
      flags.source = argv[i + 1];
      i += 1;
    } else if (arg === '--input') {
      flags.inputs.push(argv[i + 1]);
      i += 1;
    } else if (arg === '--sources') {
      flags.sources = argv[i + 1];
      i += 1;
    } else if (arg === '--json') {
      flags.json = true;
    } else if (arg === '--help' || arg === '-h') {
      flags.help = true;
    } else {
      positional.push(arg);
    }
  }

  return { positional, flags };
}

function reportCaveats() {
  process.stdout.write('\nWhat this does not prove:\n');
  for (const caveat of CAVEATS) process.stdout.write(`  - ${caveat}\n`);
}

async function pack(positional, flags) {
  const packageDir = positional[0];
  if (packageDir === undefined) {
    process.stderr.write('pack needs a package directory\n');
    return EXIT.USAGE;
  }
  if (flags.inputs.some((p) => p === undefined)) {
    process.stderr.write('--input needs a file\n');
    return EXIT.USAGE;
  }

  let manifest;
  try {
    manifest = await buildManifest(packageDir, {
      source: { system: flags.source },
      inputs: flags.inputs,
    });
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return EXIT.USAGE;
  }

  await writeFile(join(packageDir, MANIFEST_NAME), canonicalJson(manifest), 'utf8');

  const { records, record_rows: rows, documents, document_bytes: bytes } = manifest.totals;
  process.stdout.write(
    `packed ${records} record file(s), ${rows} data row(s), ${documents} document(s), ${bytes} document byte(s)\n`,
  );
  process.stdout.write(`wrote ${MANIFEST_NAME}\n`);
  process.stdout.write(
    '\nA manifest states what the package contains. It does not prove the extraction was complete.\n',
  );
  return EXIT.VERIFIED;
}

async function verify(positional, flags) {
  const packageDir = positional[0];
  if (packageDir === undefined) {
    process.stderr.write('verify needs a package directory\n');
    return EXIT.USAGE;
  }

  const { status, checks } = await verifyPackage(packageDir, { sourcesDir: flags.sources });

  if (flags.json) {
    process.stdout.write(`${JSON.stringify({ status, checks }, null, 2)}\n`);
    return EXIT[status];
  }

  for (const check of checks) {
    process.stdout.write(`${check.result.padEnd(12)} ${check.id.padEnd(24)} ${check.reason}\n`);
    if (check.detail !== null && check.result === RESULT.FAIL) {
      process.stdout.write(`             ${JSON.stringify(check.detail)}\n`);
    }
  }

  process.stdout.write(`\n${status}\n`);
  reportCaveats();
  return EXIT[status];
}

async function main() {
  const [verb, ...rest] = process.argv.slice(2);
  const { positional, flags } = takeFlags(rest);

  if (verb === undefined || verb === 'help' || flags.help === true) {
    process.stdout.write(HELP);
    return EXIT.USAGE;
  }
  if (verb === 'pack') return pack(positional, flags);
  if (verb === 'verify') return verify(positional, flags);

  process.stderr.write(`unknown verb: ${verb}\n\n${HELP}`);
  return EXIT.USAGE;
}

// `process.exitCode` rather than `process.exit`, so stdout is flushed before the
// process ends — a verdict lost to a pipe buffer is the worst failure this tool has.
process.exitCode = await main();

export { main };
