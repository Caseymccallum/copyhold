# Copyhold

**Get a law firm's records out of its practice management software, and prove what came
out.**

Nowhere yet: **milestone 0.** The package format and its verifier exist, and are tested.
There is **no source adapter yet**, so nothing here can read a Clio or MyCase export. That
is the next piece of work, and `docs/mvp.md` says exactly what it is.

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

## What works today

```
node cli/copyhold.js pack   <package-dir> --source mycase
node cli/copyhold.js verify <package-dir>
node cli/copyhold.js verify <package-dir> --sources <original-export-dir>
```

`pack` walks a directory, hashes every file, counts every record, and writes a
`manifest.json` that states what the package contains. `verify` checks a package against its
own manifest and returns **VERIFIED**, **INCOMPLETE** or **BROKEN** with the specific reason.

There is no installation story yet and no registry package. It runs from a clone.

## What it will not do

Stated here rather than discovered later. Each is a deliberate cut from this milestone:

- **no source adapters.** Nothing reads a vendor export yet. Milestone 1.
- **no importer.** This tool gets data *out*. Loading it into a practice management system is
  a different program with a database, and it is not this one.
- **no network.** It never contacts anything. There is nothing to configure and nothing to
  phone home to.
- **no signature yet.** A package therefore proves what it contains and not who made it.
- **no archive container.** A package is a directory, not a `.zip`. Deliberate: every
  operating system already opens a folder, so a reader who does not trust this tool can look
  inside it with no library at all. A single-file container is a later decision, recorded in
  `SPEC.md` §2.
- **no AI, and no reading of documents.** Documents are hashed and carried, never interpreted.

## The honest limits

Worth being precise, because the value of this tool is the precision of its claim:

- **A package proves the bytes inside it are intact and accounted for. It does not prove the
  extraction was complete.** If the source system omitted a document, the package will not
  know, and neither will `verify`. This is the single most important sentence in this file,
  and it is why milestone 1 is about *sources* rather than about more checking.
- **`produced_at` is the tool's own claim.** Nothing here witnesses time.
- **Counting rows is not validating them.** A record can be counted, hashed and still be
  wrong. `verify` says the bytes are the bytes; it does not say the data is correct.
- **A package the operator builds can be built deceptively.** The guarantee runs from a
  package to its contents, not from a vendor to a package.

`verify` prints these caveats with every verdict, rather than leaving them in a README that
nobody reads. That is lifted from the author's earlier project, where printing the limits
beside the answer is what makes the answer worth anything.

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
