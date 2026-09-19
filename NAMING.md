# The name

**Settled 19 September 2026.** The tool is **Copyhold**.

It was called *Vouch* for one day before that, provisionally. The first name is recorded below
with the reason it failed, for the reason the author's other projects record their names: a name
that was arrived at by accident — or abandoned after a check — should be visible as one.

## Why *Copyhold*

Copyhold was a form of land tenure in English law. The tenant held land **by virtue of a copy of
the entry on the manor's court roll**; the roll itself stayed with the lord's steward. What the
tenant had was a *copy of* the record, never the record.

That is both what this tool does and, more usefully, the limit of what it can honestly claim:

- **The firm holds by copy.** It receives copies of records it is obliged to keep. It does not
  receive, and cannot receive, the vendor's underlying data store.
- **The original stays with the keeper.** The vendor remains custodian of its own roll. This tool
  does not pretend that a copy is the record.
- **A copy is proved by matching it to the original.** Copyhold title was established by
  producing the copy and matching it against the roll. This tool establishes its package the same
  way — hashes that match what was extracted — and it names the one thing it cannot match:
  whatever the source chose not to hand over.

The word carries the honesty the project needs. It promises no completeness. *A copy, held* is a
smaller and truer claim than *everything, migrated* — the same distinction `SPEC.md` §5 draws
about `produced_at`, and the same one the verifier refuses to blur.

It joins two plain words, which is the shape the author's names take: *Tickmark*, *QuickSign*,
*Plain Books*, *Option-Rank*.

**The baggage, stated.** Copyhold was a lesser tenure, and *copyholder* connoted a smallholder.
Some lawyers will read the word as archaic. Neither is fatal — the mechanism is exact, and the
mechanism is the point — but neither is nothing, and a name that looks free of cost usually has
one that nobody has said out loud.

## The availability check

Run 19 September 2026. A name is only a name if it can be installed and addressed, so this was
checked against registries rather than judged on feel.

| Target | Result |
| --- | --- |
| npm `copyhold` | **free** — registry returned 404 |
| npm `copyhold-cli` | **free** |
| npm `copyheld` | **free** |
| GitHub org/user `copyhold` | **taken** — a user since 2008-12-22 with 71 public repositories, unrelated to this project. `copyholdhq` is free |
| `copyhold.dev` | **unregistered** |
| `copyhold.io` | **unregistered** |
| `copyhold.org` | **unregistered** |
| `copyhold.net` | **unregistered** |
| `copyhold.legal` | **unregistered** |
| `copyhold.com` | registered 1999-07-13; serves a "Portfolio Of Domains" parking page. Not a product. Not acquirable cheaply, and not required |
| `copyhold.app` | registered 2026-08-18, expiring 2027-08-18 on a one-year term, with no content. Almost certainly speculative |
| USPTO mark in software classes | none found |
| Companies named *Copyhold* (UK) | several, in construction and consulting. Not software, so not a software-mark conflict |

**Verdict: usable.** The install path is clear, which is the test that matters — it is the one
that sank the earlier name.

Two caveats kept deliberately, because a cleared list is not a cleared name:

1. **The `.com` is gone and the `.app` was registered one month ago.** The second is a mild
   warning: speculative registrations in this vocabulary are live, and somebody is watching it.
   Claim `.dev` or `.io` before publishing anything.
2. **A registry lookup and a DNS check are not a trademark clearance.** They establish that
   nothing obvious is in the way, in one country, on one day. If this ships commercially under its
   own name, a proper search in the relevant classes is still owed — the same caveat the author's
   earlier naming notes carry, restated here rather than dropped once answered.

## Names considered and rejected

### Round two — checked against registries, not against taste

Nine candidates were searched for actual conflicts. **All nine were taken.** The pattern is the
finding: legal technology and document verification have consumed this vocabulary, and a search
engine is the wrong instrument for a saturated metaphor.

| Name | Why not |
| --- | --- |
| **Tally** | Tally Solutions — major accounting and business-management software. Disqualifying in an adjacent domain |
| **Manifest** | `manifest` is taken on npm, plus manifest.build and manifestx.dev. The install path is blocked |
| **Vouch** | The first, provisional name. vouch.io, vouch.us, and `getvouch.io` — *identity verification*, uncomfortably adjacent to the job |
| **Witness** | WitnessAI, Magnet Witness in forensics, and registered marks |
| **Muniment** | muniment.ai, an AI-governance workspace, plus an unrelated Rust crate |
| **TrueCopy** | Truecopy Credentials Pvt Ltd — e-signature, credential verification, contract lifecycle management |
| **Waybill** | waybill.com.au and Waybiller — freight software |
| **FairCopy** | An open-source scholarly text editor with its own organisation |
| **Apostille** | A 2026 filing for *Apostille Connect*, for **electronic document authentication services** — the same metaphor, the same decade, the same job |

*Apostille* is the one worth remembering. It was not rejected on taste but because somebody filed
on it for this exact category within the last year. That is a fact about the market, and not only
about a name.

### Round one — rejected on meaning, before any checks

| Name | Why not |
| --- | --- |
| **Egress** | Right meaning — the act of going out — but an established security-software vendor uses it. Rejected on that collision rather than kept as a standby: *Vouch* did fail a search, and this was not revisited, because a name already in use in security software faces the same objection |
| **Attest** | Close second. Means to certify, and is the right register. Rejected because it collides with attestation frameworks and sounds like a standards body rather than a tool a two-person firm runs |
| **Exodus** | The migration meaning is consumer software, not professional records, and it has been used for several projects |
| **Portage** | A good metaphor — carrying things between waterways — but it is a package manager, and the collision is confusing to exactly the audience who would find this repository |
| **Extract** | Generic, and describes a step rather than a purpose. Nothing to like |
| **Ledger** | Too narrow: this tool is not only about money, and the trust ledger is one of six record types it carries |
| **Deed** | A legal instrument, so the register is right, but it names a specific kind of document rather than the act of checking one |
| **Abstract** | In law, an abstract of title *summarises* records. This carries all of them and loses none, so the word says the opposite |
| **Warrant** | Two clashing senses — a legal instrument and a police power — and both are wrong here |
| **Departure** | Accurate and dull, and it sounds like a failure rather than a move |
| **Ferry** | Too cute for a tool a firm's insurance renewal depends on |

## What the name must not imply

It must not promise completeness. The one thing this tool cannot prove is that the
extraction was complete — the source system may have withheld something and no package built
from it can know. **A name that sounded like a guarantee of completeness would be a lie told
by the front door**, which is why nothing here is called *Complete*, *Total* or *Whole*.

*Copyhold* passes that test, and was chosen partly because it does: a copy is what the firm gets,
and **holding a copy is not holding everything**. The name states the guarantee this project can
actually keep.