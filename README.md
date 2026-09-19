# Copyhold

**Get a law firm's records out of its practice management software, and prove what came
out.**

Early, and the first adapter works: a MyCase Full Backup can be converted into a package
that a stranger can check. The package carries the records, the documents that were
downloaded, a reconciliation of the trust ledger, and a report that names every row
accounted for — imported, skipped with a reason, or needing a human decision.

## The claim

A firm leaving Clio, MyCase, PracticePanther or Smokeball should be able to do three things
it currently cannot:

1. **Get everything out** — matters, contacts, documents, time, invoices and the trust
   ledger — without a consultant and without a week of clicking.
2. **See what actually arrived**, item by item: what came across, what did not, and what
   needs a human decision. Not a progress bar. A list.
3. **Hand a stranger a folder they can check** — without trusting this tool, the vendor, or
   a clock.

The third is the reason this project exists. Every practice-management vendor will export
*something*. Nobody will hand you something you can verify, and nobody will tell you what is
missing from it.

## Getting your data out of MyCase

MyCase produces a **Full Backup**: a ZIP of 16 CSV files covering matters, contacts,
documents (as a list), time entries, expenses, invoices, trust activity, tasks, calendar
events, messages, and more. To get one:

1. Log in to MyCase.
2. Go to **Settings → Import/Export**.
3. Choose **Full Backup** → format **CSV**.
4. Choose **all cases** (not just the ones you are linked to).
5. Wait for the notification email, then download the ZIP.

**The backup does not include documents.** MyCase's own help centre says: *"The only items
the full data backup does not include are documents and invoices. You will have to manually
download these items."* So you also need to download the documents you want to keep, into a
folder. This tool reconciles the list against the folder and tells you what matched, what
did not, and what is on your disk that the list does not claim.

## Using the tool

```bash
git clone https://github.com/Caseymccallum/copyhold.git
cd copyhold

# Convert a MyCase backup into a package — packs and verifies in one command
node cli/copyhold.js convert --source mycase <backup.zip> --documents <docs-folder> <package-dir>

# Or separately:
node cli/copyhold.js pack   <package-dir> --source mycase
node cli/copyhold.js verify <package-dir>
node cli/copyhold.js verify <package-dir> --sources <original-export-dir>

# Check proposed parties for conflicts
node cli/copyhold.js check-conflicts <package-dir> --party "Acme Corp" --party "John Smith"
```

`convert` reads the backup, maps columns to canonical names, writes `records/`, copies
matched documents to `documents/`, reconciles the trust ledger, writes `disposition.csv`
and `report.md`, then packs and verifies — all in one command.

`verify` checks a package against its own manifest and returns **VERIFIED**, **INCOMPLETE**
or **BROKEN** with the specific reason. With `--sources`, it also checks that the original
export files match the digests recorded in the manifest.

`check-conflicts` reads the package's contacts and matters, builds an index of every party
name, and checks proposed parties against it. It produces **candidates, never a verdict** —
the tool surfaces matches and a lawyer decides. Every check is recorded, including checks
that find nothing.

There is no registry package. It runs from a clone, with Node ≥ 20.12.

## What the output looks like

A package is a directory:

```
package/
  manifest.json          the claims: every file hashed and counted
  report.md              the conversion report, for a human to read
  records/
    matters.csv
    contacts.csv
    documents.csv        the vendor's list, as imported
    trust_transactions.csv
    trust_reconciliation.csv   per-matter balances
    disposition.csv      every row accounted for
    conflict_checks.csv  the conflict search record
    engagements.csv      the engagement record
  documents/
    1001/
      engagement_letter.pdf
    1002/
      will_original.pdf
```

The report names every row in three states: **imported**, **skipped** with a reason, or
**needs a decision**. A document the vendor lists but the firm did not download is
*needs a decision* — which is the case MyCase guarantees will happen, because the backup
does not include documents.

## What it will not do

- **no importer.** This tool gets data *out*. Loading it into a practice management system
  is a different program with a database, and it is not this one.
- **no network.** It never contacts anything. Nothing to configure, nothing to phone home to.
- **no signature yet.** A package proves what it contains and not who made it.
- **no archive container.** A package is a directory, not a `.zip`.
- **no AI, and no reading of documents.** Documents are hashed and carried, never interpreted.
- **no Clio adapter yet.** MyCase is the first source. Clio's export is fragmented across
  four mechanisms and needs its own adapter.

## The honest limits

- **A package proves the bytes inside it are intact and accounted for. It does not prove
  the extraction was complete.** If the source system omitted a document, the package will
  not know, and neither will `verify`. This is the single most important sentence in this
  file.
- **`produced_at` is the tool's own claim.** Nothing here witnesses time.
- **Counting rows is not validating them.** A record can be counted, hashed and still be
  wrong. `verify` says the bytes are the bytes; it does not say the data is correct.
- **The column names in the adapter are candidates, not claims.** No real MyCase export
  has been seen. A real export will correct the map without a rewrite.
- **A package the operator builds can be built deceptively.** The guarantee runs from a
  package to its contents, not from a vendor to a package.

`verify` prints these caveats with every verdict, rather than leaving them in a README that
nobody reads.

## Tests

```
node --test
```

## Licence

AGPL-3.0-or-later for the code. The package format in `SPEC.md` is CC BY 4.0, so that
another tool may implement it without taking the code — the same split the author's `.charter`
format uses, and for the same reason.

**No competitor's source code, UI, copy or visual design is used anywhere in this project.**
Everything it knows about vendor exports comes from those vendors' own public documentation.
