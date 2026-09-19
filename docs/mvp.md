# The first version

Written so that this document is never mistaken for a description of the software: what is
built is stated in the past tense, and what is not is named.

## Where the build is

**Built and tested — 25 tests, all passing.**

| | |
| --- | --- |
| `SPEC.md` | the package format `copyhold/0.1`: the container, the manifest fields, the CSV counting rules, and the check list |
| `copyhold pack` | writes a manifest over a directory of records and documents. Refuses a file it has no way to describe, and refuses a package with no records |
| `copyhold verify` | 14 checks in three levels, returning **VERIFIED / INCOMPLETE / BROKEN**, each check naming what disagreed with what rather than only that something did |
| The caveats | the five limits are printed with every verdict, not left in a README |
| Exit codes | 0 VERIFIED, 1 INCOMPLETE, 2 BROKEN, 64 usage |
| `--json` | the same verdict as data, for a program |

**Not built, and named rather than implied: any source adapter.** Nothing here can read a
Clio, MyCase, PracticePanther or Smokeball export. That is milestone 1, and it is the whole of
milestone 1.

## The wedge

Four findings carry this project, and all four are the vendors' own words:

- **MyCase's own help centre** states that its Full Backup *"does not include documents and
  invoices"* — the client file, and one backup per day.
- **Smokeball's own migration FAQ** states it does **not** bring over paid invoices, billed
  time history, general ledger items or **full trust transaction history** — and that a firm
  must stop working at cutover.
- **Clio's terms** delete all content **90 days** after cancellation, and its contract promises
  "open formats" while naming none.
- **LawLink**, the closest open-source competitor, records as **locked decision #8** that a
  data migration tool is *"not in V1; evaluate in V1.5"*.

Every vendor exports metadata generously and the client file grudgingly. Nobody sells the
exit, and nobody hands over something a stranger can check. **This program does the second
half of that, and it is deliberately the half that needs no vendor's permission.**

## The stack, and why

Node ≥20.12, and **zero runtime dependencies** — `dependencies: {}` in `package.json` is not an
aspiration, it is the state of the file.

That matters more here than in most projects. This tool's job is to be *trusted about bytes*
by a firm that has just decided not to trust a vendor. A dependency tree is a list of things
that firm would have to trust instead, and cannot check. The repository runs the files that
are in it — no build step, no transpiler, no bundler — so what is read is what runs.

`node:test` for the same reason. The verifier's checks *are* the product, so the tests holding
them are not optional infrastructure.

## The data model

The manifest is the data model. There is no database, and this program will not get one: it
transforms a directory into a claim about that directory, and a claim is a file.

| Entity | Where it lives | What it is |
| --- | --- | --- |
| **package** | the directory | `records/`, `documents/`, `manifest.json` |
| **source** | `manifest.source` | the system the data came from, and the digest of every input file |
| **record** | `manifest.records` | one CSV: its size, digest, data-row count and column count |
| **document** | `manifest.documents` | one client file: its size, digest and original name |
| **totals** | `manifest.totals` | the counts restated, so a careless producer is caught by its own arithmetic |
| **caveat** | `manifest.caveats` | the limits, carried inside the artifact rather than in documentation about it |
| **check** | computed | one rule, its result, and the reason it reached it |
| **verdict** | computed | `VERIFIED`, `INCOMPLETE` or `BROKEN` |

**Deliberately absent: any notion of a matter, a contact, a time entry or a trust
transaction.** This program has no opinion about what the records *mean*. It counts them,
hashes them and carries them. Interpretation is the importer's problem, and the importer is a
different program with a database — which is why this one can stay small enough to finish.

### The one design decision worth arguing about

`L1.PACKAGE.UNLISTED` is `BROKEN`, not a warning. A digest list proves the files you were told
about are unchanged; it says nothing about the file nobody mentioned. If a package may carry
an unaccounted-for file and still be called verified, then the tool has the same failure mode
as the vendors it exists to criticise — it reports success over an incomplete picture.

## Milestone 1 — the first source adapter

**Which source, and why.** **MyCase first.** Not because it is the largest — Clio is — but
because its export is the one documented in the most detail *by the vendor itself*: a ZIP of 16
named CSVs, with the document and invoice exclusion stated in writing. That gives an adapter
something to test against without guessing, and it gives the disposition report its most honest
possible case: **the vendor lists documents it does not include**, so "listed but not present"
is guaranteed to occur and must be surfaced rather than smoothed over.

**What the adapter will do.** Read the Full Backup ZIP plus a folder of manually downloaded
documents, and emit:

- `records/*.csv` — one canonical file per entity the source provides, in the source's own
  values, with columns renamed to the canonical names and **unknown columns preserved**
- `documents/**` — the files, with the source's folder structure where there was one
- `report.md` — the human account
- `manifest.json` — written by `copyhold pack`, unchanged

**How it will be judged.** Against a fixture export whose contents are known:

1. Every row in every source CSV lands in exactly one of three states: imported, skipped with
   a reason, or needs a decision. **Rows in equals rows out, by count.**
2. Every document named in the source's `Documents` CSV that has no matching file becomes a
   *needs a decision* row. On a real MyCase export this will be **most** of them.
3. Every document that *is* present is hashed, and the hash is recorded.
4. `copyhold verify` on the result returns VERIFIED, and `copyhold verify --sources` returns VERIFIED
   with the source ZIP present.
5. The report is a rendering of the same data the manifest was built from, so it cannot
   disagree with it.

**What it will not do.** Judge whether the data is right, or rename or "fix" a value it does
not recognise. An unrecognised column is preserved, never dropped; an unrecognised value is
reported, never corrected. That rule was arrived at independently by LawLink's own import
design — degrade the value to free text, import the row, flag it, and audit the count of
degradations, rather than failing the row.

## Deliberately not building

Stated here rather than discovered later.

- **No importer.** Loading records into a practice management system is a different program,
  with a database, a transaction model and a trust ledger. Conflating the two is exactly how
  the exit ramp becomes a two-year project.
- **No network, ever.** Nothing to configure and nothing to phone home to.
- **No signature yet.** A package proves its contents, not its author. Signing is a v0.2
  question and a format change, not a verb.
- **No archive container.** A directory, per SPEC §2.
- **No AI, and no reading of documents.** Documents are hashed and carried.
- **No validation of the trust ledger's arithmetic.** This tool carries trust rows and counts
  them. Whether a client ledger reconciles is the importer's problem, and pretending otherwise
  here would be the most dangerous overreach available in this domain.
- **No OCR.** A scanned PDF is a file to carry, not a record set to read.

## Definition of done for milestone 1

- a fixture MyCase export packs and verifies, and the tests prove it byte for byte
- the disposition report accounts for every row, and the counts are **asserted in a test**
  rather than read off a screen
- a listed-but-absent document appears as *needs a decision*, never as a failure and never as
  silence
- `README.md` describes what exists and nothing that does not

## What would make this not worth building

Written before the code, so that a later decision is a reading rather than a feeling.

1. **A firm cannot get its documents out at all.** If the documents are not downloadable, a
   package can only carry what it was given, and this becomes a checksum list for metadata — a
   much smaller product, and probably not one worth the name.
2. **The trust ledger cannot be obtained with per-client detail.** The compliance half of the
   wedge is then undeliverable for that source, and the honest response is to say so on the
   first screen rather than to import a summary and call it a ledger.
3. **Firms say the export is easy and they trust it.** Then there is no customer, and the
   blueprint's §3.5 said to stop.
4. **A vendor ships a verified export of its own.** The wedge narrows to the vendors that have
   not — which is most of them. A narrowing, not a stop.
5. **Nobody will run a Node script.** Then the distribution story is wrong rather than the
   tool, and the answer is a hosted conversion service instead of a local program.
