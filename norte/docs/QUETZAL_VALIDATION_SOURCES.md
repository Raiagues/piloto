# Quetzal-1 validation sources and the seed importer

The validation project **Quetzal-1** is built from real engineering
documents published by the Quetzal-1 CubeSat Team (Universidad del Valle de
Guatemala) and by the manufacturers of parts the mission actually flew. Its
engineering system is produced by extracting those documents. Nothing in this
repository describes the resulting architecture.

## The rule

```text
REAL DOCUMENTS → Gemini extraction → engineering facts → engineering system → system graph
```

- The application seeds **no** documents at startup. A fresh database contains
  the team and the project with an empty memory.
- `benchmark/quetzal1/context/` fixtures exist for the deterministic benchmark,
  regression tests and offline interface development. They are **never** a
  fallback for the product's conception flow.
- If extraction fails, it fails visibly. `server/document-driven-extraction.test.mjs`
  proves that removing document content makes generation fail rather than
  producing a Quetzal system from project metadata, and scans production code
  for hardcoded Quetzal part numbers, design values and project-name branches.
- The extraction model receives only what Norte imported. No web retrieval or
  search grounding is enabled on the provider request.

## Source manifest

`examples/quetzal1/source-manifest.mjs` records **where** each document lives:
publisher, repository, pinned revision, path, URL, expected MIME type, expected
size, licence, role and an integrity hash. It contains no engineering values.

| field | meaning |
| --- | --- |
| `role` | `project_context`, `supporting_datasheet` or `evaluation_reference` |
| `tier` | `core` (imported by default), `extended` (`--tier extended`), `excluded` (verified but deliberately not imported) |
| `priority` | P0/P1/P2 from the validation plan |
| `sha256` | pinned and enforced; a mismatch aborts the import |
| `knownSha256` | informational for publisher-hosted files, which may be re-issued; a change is reported, not fatal |
| `contextPolicy` | why the source is or is not eligible for Project Memory |

The importer refuses `evaluation_reference` outright. The JoSS 12(2) EPS paper is
listed with that role precisely so the exclusion is explicit and testable: its
on-orbit performance sections are the evaluator's holdout answers.

### Imported by default (`--tier core`)

| source | publisher | pinned revision | bytes |
| --- | --- | --- | --- |
| Quetzal-1 EPS Hardware Overview (`EPS/README.md`) | Quetzal-1 CubeSat Team / UVG | `d4d1b59` | 4,950 |
| Quetzal-1 EPS Schematic (`PT-MIS-PCB-002_v1 Schematic.pdf`) | Quetzal-1 CubeSat Team / UVG | `d4d1b59` | 2,600,375 |
| Quetzal-1 EPS Flight Software (`EPS/README.md`) | Quetzal-1 CubeSat Team / UVG | `dbfb67a` | 15,077 |
| NanoCom AX100 Datasheet | GomSpace A/S | DS 1013823 3.7 | 803,501 |
| Quetzal-1 EPS Bill of Materials (reference BOM) | Quetzal-1 CubeSat Team / UVG | `d4d1b59` | 72,776 |

Total: 3,496,679 bytes, giving a ~4.7 MB provider request.

### Available with `--tier extended`

INA260, TPS2551, INA169, TPS63070, TMP100, BQ27441-G1 and BQ27741-G1 datasheets,
all from `ti.com`. Every one of these parts was verified against the pinned BOM
or the flight software README before being added — INA260 as U1/U9/U12, TPS2551
as the Fault Protection Board switch (six placements), INA169 as U16/U18/U20/U22,
TPS63070 as U11, TMP100 from the flight software README.

They are not in the default set for a measured reason, not a guess: see
**Request size** below. `--tier extended` imports 10.8 MB of sources, which fits
the 12 MB parse budget but produces a request the provider cannot answer inside
the extraction timeout.

### Verified and deliberately excluded

- **ATmega328P** (Microchip, `DS40002061B`): resolves, but is 33.3 MB — far
  above the 4 MB per-file processing limit — and its register-level content adds
  nothing to an EPS + COMMS power architecture.
- **AZUR SPACE 3G30A**: the exact URL linked from the pinned Quetzal hardware
  README now returns 404, and a current revision cannot be shown to match the
  cells used during Quetzal development. Solar cell details stay with the
  Quetzal documentation for V0.
- **JoSS 12(2) EPS paper**: evaluator-only, see above.

### A documented discrepancy

The pinned EPS BOM populates **BQ27441DRZR-G1A** at U6; the flight software
README names **BQ27741-G1**. Both datasheets are in the manifest as `extended`
sources and neither is silently chosen. This is a fact about the sources, not
something Norte resolves on the team's behalf.

## Running the importer

```bash
# Local development store
NORTE_ALLOW_QUETZAL_SEED=1 \
  node scripts/seed-quetzal-validation.mjs --file var/mission-dev-data.json

# Hosted database (Render + Neon)
NODE_ENV=production NORTE_ALLOW_QUETZAL_SEED=1 \
  node scripts/seed-quetzal-validation.mjs --database

# Inspect the plan without writing anything
NORTE_ALLOW_QUETZAL_SEED=1 node scripts/seed-quetzal-validation.mjs --dry-run
```

Flags: `--tier core|extended`, `--dry-run`, `--json`, `--remove-other-projects`.

`--remove-other-projects` also deletes every other project, with its
project-scoped artifacts and Discovery state — the way to clear a leftover
demonstration project such as `Projeto Teste` from a deployed database. Accounts,
members and sessions are always preserved, and every removal is listed in the
audit. Run `--dry-run` first.

The command refuses to run without `NORTE_ALLOW_QUETZAL_SEED=1`. It is never
invoked by application startup. It writes a private backup of the previous state
first, then, in one transaction:

1. finds or creates `Quetzal-1` and attaches the validation team;
2. clears `programId`, `modalityId` and `categoryId`, marking the project an
   independent engineering project — Quetzal-1 has no OBSAT association;
3. removes every artifact this project previously carried that the manifest does
   not supply, from the store, the team library and every project's link lists;
4. downloads and verifies each source, then stores its **actual bytes**;
5. increments `memoryRevision`, clears `engineeringSystem` and
   `systemGeneratedFromRevision`, and resets the phase so conception must run again;
6. preserves users, sessions, members and every unrelated project;
7. prints a full before/after audit.

It is idempotent: artifact ids are derived from the source id, an unchanged file
is reused in place, and `memoryRevision` only advances when something really
changed.

## Retrieval security

`server/source-import.mjs` is reachable only from the seed command; it is not an
HTTP endpoint and must never become one.

- HTTPS only; credentials in the URL are refused.
- Hosts must be on `ALLOWED_SOURCE_HOSTS` (`raw.githubusercontent.com`,
  `gomspace.com`, `www.ti.com`).
- Redirects are followed manually, at most three hops, each re-validated.
- Resolved addresses are rejected when loopback, private, link-local,
  carrier-grade NAT, unique-local or IPv4-mapped equivalents.
- Status, `content-type`, declared and actual size, file signature (`%PDF-`,
  `PK`) and SHA-256 are all checked before any byte is stored.

## What Norte can read

`server/artifact-content.mjs` is the single classifier. Both the extraction
pipeline and the artifacts API use it, so the interface never promises memory the
server will reject.

| status | meaning |
| --- | --- |
| `parsed` | UTF-8 text, CSV, JSON, Markdown or an XLSX workbook; its text is sent to the model |
| `pdf` | a valid PDF; supplied inline to the model |
| `not_parsed` | stored but unsupported, malformed, or over a limit |
| `metadata_only` | a link. **Its contents were never fetched.** |

Storing `https://github.com/…` or `https://ti.com/…` in an artifact is not enough
for conception: the model never receives that document. This was the original
reason the validation project could not enter Conception.

XLSX is read by `server/xlsx-text.mjs`, a small dependency-free reader that
inflates only the entries it needs, evaluates no formulas, follows no external
references and enforces hard limits on entries, sheets, rows, columns and total
inflated size. No spreadsheet package was added.

## Limits

```text
4 MB   per file        (server/artifact-content.mjs, server/app.mjs)
12 MB  total parsed artifact content per extraction request
120k   characters of extracted text per artifact
```

### Request size

Inline PDFs dominate the provider request. Measured against
`gemini-3.5-flash-lite`:

| sources | request | provider latency (3 runs) |
| --- | --- | --- |
| 3.42 MB (hardware README, schematic, flight software README, AX100) | 4.57 MB | 15 s / 33 s / 18 s |
| 3.43 MB (the above plus the BOM) — **the default core set** | 4.58 MB | 6 s / 7 s / 4 s |
| 6.26 MB (plus INA260 and TPS2551) | 8.35 MB | 83 s / 122 s / 57 s |

The 8.35 MB request completes, but two of three runs exceeded the 90 s
per-attempt extraction timeout, and one earlier run was rejected with HTTP 503.
The per-file and total limits above were **not** raised to accommodate it; the
seeded working set was kept small instead.

Measure `sourceBytes` before adding a source. `npm run diagnose:project-memory`
prints every artifact's size and parse status.

## Diagnosing a blocked conception

### False memory conflict on PostgreSQL (8 September 2026)

A reported Render failure returned HTTP 409, `PROJECT_MEMORY_CHANGED`, after
`POST /api/system-ai/generate`. The concurrency guard compared `JSON.stringify`
results before extraction and inside the persistence transaction. PostgreSQL
[`jsonb` does not preserve object key order](https://www.postgresql.org/docs/current/datatype-json.html),
so identical saved values could appear changed after the transaction read.
The guard now compares values deeply, including the revision, project name,
context, setup and linked artifacts. It still rejects actual content changes.
A regression reproduced the 409 with reordered keys and unchanged values before
the fix; it now persists successfully, while a real document-edit test still
returns 409 and stores no generated baseline. This reproduction models JSONB's
key-order change; it does not inspect the production database.

Project Memory also distinguishes loading, failed loading and ready states.
Failed loading offers an explicit retry and never enables conception using an
incomplete refresh. Older overlapping requests cannot overwrite a newer load.
The client retries a GET/HEAD once for transient 502/503/504 responses (including
HTML gateway pages), honors short `Retry-After` delays, and never automatically
replays writes or generation. Server error `code` takes precedence over generic
Fastify `error` labels, preserving the specific conflict message.

Verification: quality, secret scan, dependency audit, the five deterministic and
four structural cases passed. Browser regression exercised persistent HTML 503
responses, a manual reload followed by automatic recovery, disabled readiness
while loading/failed, and re-entry without generation. A fresh real-Gemini browser
run on a copy of the five imported sources also passed after the server fix:
three parsed text/spreadsheet sources, two PDFs, no metadata-only sources;
one physical HTTP 200 response in 8.369 seconds, a persisted model with four
entities, one relation, one requirement and three source-backed evidence records.
The model is sparse; successful loading/persistence is not complete extraction
or A0 validation. The full private record is retained in
`var/benchmarks/acceptance-quetzal-1788878973965/`. Earlier runs remain preserved,
including a test that inspected the empty board before its loading completed;
the acceptance runner now waits for the actual memory load. The production
database was not changed during this repair, and Render deployment remains a
separate owner-controlled step.

### Inspecting stored documents

```bash
npm run diagnose:project-memory
npm run diagnose:project-memory -- --project <id> --json
```

For each artifact it prints the source, MIME type, size, parse status, the reason
when it is not readable, how much content was produced, and whether it is sent to
the model. It exits non-zero when memory is not ready. This is a development
command, not a user dashboard.

## Licences

Quetzal-1's own hardware and flight software material is CC BY-SA 4.0; the
manifest preserves attribution and the licence note, and every stored artifact
keeps a `provenance` record with publisher, URL, revision, retrieval time,
SHA-256, size and licence.

Manufacturer PDFs are **not** committed to this repository. They are retrieved
from the publisher by the seed command into the private application database.
The repository stores the manifest and attribution only.
