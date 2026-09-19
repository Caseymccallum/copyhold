# copyhold/0.1

The version string is `copyhold/0.1`. It appears in exactly one place — the manifest's `format`
field — and a verifier that reads it and does not implement it says so, rather than applying
the rules of a version it never read.

## 1. What a copyhold package is for

A package carries the records taken out of a practice management system, the client files
those records refer to, and the claims the extracting tool makes about them — in a form a
stranger can check without trusting the tool, the vendor, or a clock.

Three claims an artifact makes when it verifies:

1. **these are the bytes of these records;**
2. **these are the bytes of these documents;**
3. **nothing in this package is unaccounted for.**

The third is the reason the format exists. The author's `.charter` format makes a third claim
of its own — that a history is continuous with its document. Here the third claim is
different, because the problem is different: not *"was this rewritten"* but **"did they hand
over everything, and can I tell"**. A checksum list answers claim 1. Only claim 3 answers the
question a firm actually has when it is leaving a vendor.

## 2. The package

A package is a **directory**. It holds:

| Entry | Required | Contents |
| --- | --- | --- |
| `manifest.json` | yes | one JSON object: the claims this package makes about itself |
| `records/**.csv` | yes, at least one file | the records, one CSV per entity type |
| `documents/**` | no | the client files: original bytes, folder structure preserved |
| `report.md` | no | a human-readable account for a person to read |

**Why a directory and not an archive.** Every operating system already opens a folder, so a
reader who does not trust this tool can look inside a package with no library, no unzip and
nothing installed. That is the same reasoning that put ZIP under `.charter`, carried one step
further.

The cost is real and is recorded rather than hidden: **a directory is harder to send a stranger
as one object.** A single-file container is a plausible later addition, and adding one would
not change this format's meaning — a container is not a package, the way a verb is not a file.
It is not here because it is not needed to answer claim 3.

Paths are UTF-8. A path that does not read as UTF-8 is refused (`L0.NAME.DECODE`), because a
reader that cannot read a name cannot say which file it read.

## 3. `manifest.json`

One JSON object. Every field is required.

| Field | Type | What it states |
| --- | --- | --- |
| `format` | string | `"copyhold/0.1"` |
| `tool` | object | `{ name, version }` — what wrote it |
| `produced_at` | string | ISO-8601 UTC. **The tool's own claim, witnessed by nothing** |
| `source` | object | `{ system, inputs: [{ name, bytes, sha256 }], notes }` — where the data came from, and the digest of every input file |
| `records` | object | keyed by relative path: `{ bytes, sha256, rows, columns }` |
| `documents` | array | `[{ path, bytes, sha256, source_name }]` |
| `totals` | object | `{ records, record_rows, documents, document_bytes }` |
| `caveats` | array of strings | printed with every verdict, never buried |

**Counting rules, because a count that is ambiguous is not a check.**

- `rows` counts **data rows, excluding the header**. An empty file has `rows: 0`.
- `columns` is the number of fields in the header row. A file with no header has `columns: 0`.
- Both are computed by the rules in §4.1, **not by counting newlines**, because a quoted field
  may contain a newline and one record may therefore be one line or many.
- `sha256` is lowercase hexadecimal, over the file's bytes **as stored in the package**.
- `totals` restates what other fields already say, on purpose. It is the field a careless
  producer is most likely to get wrong, and `L2.TOTALS.*` exists to catch exactly that.

## 4. What a verifier must do

A verifier returns one **status** and a list of **checks**.

| Status | Meaning |
| --- | --- |
| `VERIFIED` | every check that ran passed |
| `INCOMPLETE` | nothing failed, but something could not be established |
| `BROKEN` | something the package claims about itself is false |

`INCOMPLETE` is not a softer `BROKEN`. An unimplemented version, or an absent source file, is
unproven — not refuted — and the two must never be reported as the same thing.

### 4.1 The CSV counting rules

A field is either **unquoted** — everything up to the next comma or line feed — or **quoted**,
beginning with `"`, in which case `""` is a literal quote and the field ends at the next single
`"`. A record ends at a line feed outside a quoted field. A `\r` before a line feed is
ignored; **a lone `\r` is not a separator**, because treating it as one would split a file the
producer wrote as a single line.

Two further rules, both of which exist to stop a *correct* file being reported broken:

- A single leading **byte-order mark** (`U+FEFF`) is not part of the first header name. Excel
  writes one, and counting it would make `columns` depend on which program saved the file.
- **A completely empty line is not a data row.** A producer that ends its file with a blank
  line has not added a record. A line of separators (`,,`) *is* counted: those are fields the
  producer wrote.

A verifier that counts differently from the producer is not a verifier; it is a second
opinion. This section exists so that there is one rule rather than two.

### 4.2 The checks

**Level 0 — can the package be read at all.**

| Check | Reports |
| --- | --- |
| `L0.MANIFEST.READABLE` | `manifest.json` is present and is a file. If not, no other check runs |
| `L0.MANIFEST.PARSE` | it is valid UTF-8 and parses to a JSON **object**. If not, no other check runs |
| `L0.MANIFEST.FORMAT` | `format` names a version this verifier implements; an unknown version is `UNSUPPORTED`, never a failure |
| `L0.MANIFEST.FIELDS` | every required field is present, with the type §3 gives it |
| `L0.NAME.DECODE` | every path found in the package is valid UTF-8 |

**Level 1 — does the package hold together.**

| Check | Reports |
| --- | --- |
| `L1.PACKAGE.UNLISTED` | a file exists in the package that the manifest does not name. **This is `BROKEN`, not a warning** |
| `L1.FILE.PRESENT` | a path the manifest names does not exist |
| `L1.FILE.SIZE` | the stored size differs from the size stated |
| `L1.FILE.SHA256` | the stored digest differs from the digest stated |
| `L1.RECORD.ROWS` | a record's data-row count differs from the count stated |
| `L1.RECORD.COLUMNS` | a record's header field count differs from the count stated |

`L1.PACKAGE.UNLISTED` is the check that makes this format worth having. A digest list proves
the files you were told about are unchanged; it says nothing about the file nobody mentioned.
**A package carrying an unaccounted-for file is not a partial success.** It is the exact
failure the format exists to detect.

**Level 2 — does the package agree with its sources.**

| Check | Reports |
| --- | --- |
| `L2.TOTALS.RECORDS` | `totals.records` or `totals.record_rows` disagrees with the manifest's own entries |
| `L2.TOTALS.DOCUMENTS` | `totals.documents` or `totals.document_bytes` disagrees with the manifest's own entries |
| `L2.SOURCE.SHA256` | a source file was supplied, and its digest differs from the digest recorded for it |

`L2.SOURCE.SHA256` runs **only** when the original source files are handed to the verifier. Not
running it is `INCOMPLETE`, not a pass. That distinction is the reason the statuses exist.

## 5. What the format cannot prove

Print these with every verdict. They are the specification of what jobs this artifact can be
hired for, and taking them seriously is what separates a claim from a slogan.

1. **That the extraction was complete.** If the source system omitted a record or a document,
   no package built from it will know, and no verifier can tell. **This is the limit that
   matters most**, and it is why the next piece of work is source adapters rather than deeper
   checking.
2. **That the records are correct.** A number can be counted, hashed, and still be wrong.
3. **When anything happened.** `produced_at` is the producer's claim; nothing here witnesses
   time.
4. **Who produced it.** Version 0.1 has no signature. A package proves its contents, not its
   author.
5. **That the operator was acting in good faith.** The guarantee runs from a package to its
   contents. It does not run from a vendor to a package.

## 6. Versioning

`copyhold/0.1` changes when the container or the meaning of a manifest field changes — **not** when
a verb is added. A verb is not a file.

## 7. Licence

**This specification is licensed CC BY 4.0**, so that another tool may implement the format —
including a commercial one — without taking the code. The reference implementation in this
repository is AGPL-3.0-or-later.

That split is deliberate and is the same one the author's `.charter` format uses. A format
that only its author can implement is not a format; it is a file extension. **The verifier is
the opposite case**: it is AGPL with the code, because running a program yourself carries no
obligation under that licence, so a firm, an auditor or a competing vendor can all check a
package without asking anyone's permission — which is the entire point.

