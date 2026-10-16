# Norte

Norte is an AI-assisted engineering workspace for understanding dependencies inside complex physical systems and exploring the impact of design changes.

[![CI / Quality](https://github.com/Raiagues/norte/actions/workflows/ci.yml/badge.svg)](https://github.com/Raiagues/norte/actions/workflows/ci.yml)
[![Security](https://github.com/Raiagues/norte/actions/workflows/security.yml/badge.svg)](https://github.com/Raiagues/norte/actions/workflows/security.yml)
[![Frontend demo deployment](https://github.com/Raiagues/norte/actions/workflows/pages.yml/badge.svg)](https://github.com/Raiagues/norte/actions/workflows/pages.yml)

## Run locally

You need Linux or macOS with `git` and `curl`. [Docker](https://docs.docker.com/engine/install/) is recommended so the database runs in PostgreSQL, as in production. The scripts install everything else.

```bash
git clone https://github.com/Raiagues/norte.git
cd norte
./setup   # once: Node.js, npm packages, .env, PostgreSQL and the Quetzal-1 documents
./start   # database, API and web client in the background; prints the addresses
./stop    # stops everything; data is kept for the next ./start
```

After cloning, `./start` alone is enough: it runs `./setup` first when needed.

| Command | What it does |
| --- | --- |
| `./setup` | Installs Node.js 24.20 with [nvm](https://github.com/nvm-sh/nvm) when Node.js is missing or older, runs `npm ci`, creates `.env` from `.env.example` and asks for `GEMINI_API_KEY` (Enter skips). Creates the PostgreSQL 17 container `norte-postgres` on `127.0.0.1:55432` (or the next free port) and writes its `DATABASE_URL` to `.env`. Creates the schema and imports the [official Quetzal-1 documents](#validation) while the validation project is empty. Running it again skips what is already in place; `./setup --skip-seed` skips the document download. |
| `./start` | Starts the database, API and web client, waits until they answer and prints their addresses. The browser opens on the web client. |
| `./stop` | Stops the API, the web client and the PostgreSQL container. Data stays in the Docker volume `norte-postgres-data`. |

| Service | Default URL |
| --- | --- |
| Web | `http://127.0.0.1:5173/norte/` |
| API | `http://127.0.0.1:8787/api` |
| Swagger | `http://127.0.0.1:8787/docs` |
| Health | `http://127.0.0.1:8787/api/health` |

The first account registered on the login page becomes the owner/admin; *Explore with a test account* opens a disposable sandbox without registering. Logs are in `var/log/norte.log`.

- **AI features:** without `GEMINI_API_KEY` the app runs, but document extraction and Discovery interpretation stay off. Add the key to `.env` and run `./stop && ./start`.
- **Without Docker:** `./setup` stores data in `var/mission-dev-data.json` instead. Install Docker and run `./setup` again to switch to PostgreSQL.
- **Your own database:** when `DATABASE_URL` in `.env` already points to another PostgreSQL (Neon, for example), the scripts use it and leave Docker alone.
- **Start over with an empty database:** `./stop && docker rm norte-postgres && docker volume rm norte-postgres-data && ./setup`.

To run the npm commands yourself instead, see [manual setup](#manual-setup).

## Official app

**[Official app](https://norte-missao.onrender.com/)** — the full application on Render with Neon PostgreSQL. The application page and [`/api/health`](https://norte-missao.onrender.com/api/health) were verified; the health endpoint reports PostgreSQL storage.

**Test account** — the login page offers *Explore with a test account* when `NORTE_DEMO_ACCOUNT=1` (default outside production). Each click opens a disposable sandbox: a fictitious team of seven, three organized projects and **Horizonte-1**, an invented 2U Earth-observation CubeSat whose engineering system (EPS, COMMS, OBC, ADCS, structure, thermal, payload, orbit) cites two shipped design documents. Its Discovery board carries hypotheses already interpreted — for example replacing the camera with a heavier hyperspectral imager — so the impact chain (mass budget, 5 V rail, energy balance, batteries and panels, centre of mass and pointing, orbital lifetime, thermal, data link) shows without an AI request. Sandboxes are isolated from real accounts, cannot send invitations or mail, and are deleted after 24 hours or beyond 20 concurrent sandboxes.

**[Frontend demo](https://raiagues.github.io/norte/)** — a separate GitHub Pages build with browser storage. It cannot run the private server-side document extraction service or share a production database.

## What Norte does

Project Memory connects a project's documents, files, links and team context. System presents an engineering baseline with typed entities, properties, dependencies and requirements. Discovery BETA is a space for testing hypotheses against that baseline.

The core interaction is a proposed change followed by its consequences: an altered component, the dependencies that need review, a compatible interface, or a concrete limit violation. Sources and calculation inputs stay accessible beside the engineering model.

![Quetzal-1 communications activity propagates through the power budget and energy balance.](docs/images/engineering-impact.png)

*Design-context scenario: communications activity changes average demand. Source facts, calculations and unresolved mission requirements remain distinct; the baseline is preserved.*

## Current product state

| State | Scope |
| --- | --- |
| Implemented | Project Memory, account and team context, project persistence, System and Discovery canvas navigation. |
| Beta | Automatic engineering-model extraction, System navigation, requirement traceability, auditable expert corrections, text-driven Discovery scenarios and a bounded deterministic impact engine. Extraction quality depends on the linked evidence. |
| Planned | Raw-artifact extraction benchmark, broader engineering rules, controlled promotion of scenarios to the baseline and independent engineering/student validation. |

New project and team creation are available. Projects select a type and start with a small, editable set of sectors; folders and sector permissions organize Project Memory. See [organization, presence, PDFs and migration](docs/PROJECT_ORGANIZATION.md). A fresh database contains one neutral team and the **Quetzal-1** project with an empty memory and no reference competition; its real documents are imported by an explicit command. Its architecture is generated when conception starts. Generation failures never substitute a prebuilt model.

Norte is not a general physics simulator. An inferred dependency is a hypothesis for review. A deterministic result is limited to its inputs, units and explicit rule.

## Core workflow

1. Open the validation project and attach relevant sources in **Project Memory**.
2. Select **Start conception**. Norte reads the linked memory, builds and persists the initial engineering model, then opens **System**. Failed extraction can be retried after correcting the memory.
3. Inspect the macro architecture, focus a subsystem and open object information intentionally. Requirements are a separate layer linked to the architecture.
4. Propose a component, parameter or requirement change. Inspect the affected path, source facts and calculations. Corrections preserve the original suggestion, revised object, supporting evidence and context in exportable records.
5. Use **Test ideas BETA** to write hypotheses. Saving an idea asks the configured AI to interpret it against the saved architecture. The card shows the interpretation or a short clarification question; **Test idea** opens the temporary scenario.

## Architecture

- **Client:** React, TypeScript and Vite; Dagre for graph layout. Browser storage provides a local fallback.
- **Engineering model:** typed entities, properties with units, explicit relations, requirements, evidence and scenario records inside the project document.
- **Reasoning:** deterministic comparisons and graph traversal in ordinary code; Gemini handles conservative document extraction and assisted interpretation through the API.
- **API:** Fastify with schema validation, cookie sessions, CSRF protection, authorization and Swagger.
- **Storage:** atomic JSON locally; the same versioned state in transactional PostgreSQL when `DATABASE_URL` is configured.
- **Delivery:** GitHub Actions quality/security checks; GitHub Pages frontend demo; Render production service and Neon persistence.

See [architecture](docs/architecture.md), [product research and UX decisions](docs/PRODUCT_RESEARCH_ENGINEERING_REASONING.md) and [deployment](docs/deployment.md).

## Manual setup

[`./setup`, `./start` and `./stop`](#run-locally) wrap these steps. To run them yourself, use **Node.js 24.20.0 or newer**, as declared in `.node-version` and `package.json`. Older runtimes crash on the `argon2` native binding before the API can start:

```bash
nvm install "$(cat .node-version)"
npm ci
cp .env.example .env
# Set GEMINI_API_KEY in .env to enable server-side extraction.
npm run dev
```

Every entry point loads `.env` and `.env.local`, so `npm start` and `npm run dev:api` see the same configuration as `npm run dev`; hosted environments keep the variables their platform injects. The launcher starts the client and API in the foreground and prints their addresses. It chooses the next available port when a preferred port is occupied.

Without `DATABASE_URL`, the API uses `var/mission-dev-data.json`. The API creates its PostgreSQL table or JSON file on first start; `node scripts/setup-database.mjs` does the same without starting the server and imports the Quetzal-1 documents into an empty validation project. Keep the local data file and backups private.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `GEMINI_API_KEY` | Required for the private Gemini extraction/assistance service; never a `VITE_` variable. |
| `GEMINI_MODEL` | Gemini model; the current default is in `.env.example`. |
| `DATABASE_URL` | Optional PostgreSQL connection string; omit for local JSON storage. |
| `NORTE_API_HOST`, `NORTE_API_PORT` | API bind address and preferred local port. |
| `NORTE_WEB_PORT` | Preferred web port used by the development launcher. |
| `NORTE_ALLOWED_ORIGINS` | Comma-separated allowed browser origins. |
| `NODE_ENV` | Set `production` for the hosted API. |
| `PORT` | Hosted service port, supplied by Render. |
| `VITE_BASE_PATH` | Web base path: `/norte/` by default, `/` for Render. |
| `VITE_DEMO_MODE` | Enables the browser-only demo build when `true`. |
| `VITE_API_PROXY_TARGET` | Optional development proxy destination. |

The API reads its process environment. `npm run dev` loads local environment files for both processes. When starting the API separately, export the variables or run `node --env-file=.env server/index.mjs`.

## Development commands

```bash
npm run dev              # Client and API, loading local environment files
npm run dev:web          # Vite only
npm run dev:api          # API only
npm run typecheck
npm run lint
npm test                 # Vitest and Node API/engine tests
npm run test:api
npm run test:visual:organization # Teams, creation, folders, documents and PDF downloads
npm run test:visual      # Isolated browser/API acceptance test (Chromium required)
npm run test:visual:quetzal # Fixture memory and hypothesis-to-impact interaction check
npm run test:acceptance:quetzal # LIVE browser run over the seeded real Quetzal documents
npm run diagnose:project-memory # Why a project's memory is or is not readable
npm run seed:quetzal -- --dry-run # Plan the real-source import without writing
npm run benchmark:quetzal # Deterministic cases; extraction is evaluated separately
npm run benchmark:structural # Masked synthetic C2, with perturbed engineering values
npm run build
npm start                # API; also serves dist/ in production
```

## Testing and quality

```bash
npm run quality
npm run security:secrets
npm run security:audit
```

The browser acceptance test uses a temporary database and a mocked external extraction provider. Set `NORTE_CHROME` to your Chromium/Chrome executable if it is not detected by the default path. It does not change the local application database.

The quality gate runs TypeScript, ESLint, tests and the production build. CI additionally scans tracked files for secrets and audits dependencies. Security workflows run CodeQL and dependency review. The badges above report the real workflow status; no coverage percentage is claimed.

## Deployment

Render builds `dist/` and serves it alongside `/api` from one HTTPS origin. Configure its server-side `DATABASE_URL` and `GEMINI_API_KEY`. The blueprint declares deployment after checks and uses `/api/health`; the current service is deployed manually from the Render dashboard. GitHub Pages builds a distinct frontend demonstration and receives no API credentials. See [deployment instructions](docs/deployment.md).

## Validation

The validation project is **Quetzal-1**, owned by **Norte Validation Team**, built from **real engineering documents** published by the Quetzal-1 CubeSat Team (UVG) and by the manufacturers of parts the mission flew. Its engineering model is generated by extracting those documents in the ordinary product flow; this repository describes none of that architecture. The project is an independent engineering project with no reference program: Quetzal-1 has no OBSAT association.

A fresh database contains the team and the project with an **empty memory** — the application invents no documents at startup. The real sources are imported by an explicit, guarded command. `./setup` runs it once while the project's memory is still empty and never re-imports over existing documents:

```bash
NORTE_ALLOW_QUETZAL_SEED=1 \
  node scripts/seed-quetzal-validation.mjs --file var/mission-dev-data.json

NODE_ENV=production NORTE_ALLOW_QUETZAL_SEED=1 \
  node scripts/seed-quetzal-validation.mjs --database
```

`examples/quetzal1/source-manifest.mjs` records only **where** each document lives — publisher, pinned revision, URL, MIME type, licence, role and hash — never what it says. The importer refuses `evaluation_reference` sources, so the evaluator's holdout material can never reach Project Memory. Manufacturer PDFs are retrieved from their publishers into the private application database and are not committed here. See [sources, seed command, limits and licences](docs/QUETZAL_VALIDATION_SOURCES.md).

To see why conception is blocked for any project:

```bash
npm run diagnose:project-memory
```

It prints each artifact's source, MIME type, size, parse status and whether it is sent to the model. A stored link is `metadata_only`: **its contents were never fetched**, so it cannot support extraction.

Fixtures in `benchmark/quetzal1/context/` remain the deterministic benchmark input, and are used by tests and offline interface development only. They are never a fallback for the production conception flow; `server/document-driven-extraction.test.mjs` enforces that by proving generation fails without document content, and by scanning production code for Quetzal part numbers, design values and project-name branches.

`benchmark/quetzal1/context/` is the model input. `evaluation_reference/` contains evaluator-only expectations and historical observations; it is never imported by the extraction service or client. Default evaluation runs deterministic cases using clean structured input, including the 25%/26% power-balance boundary. **A0** measures curated context → engineering model; raw-artifact extraction (**A1**) remains future work. To assess a separately generated extraction:

```bash
npm run benchmark:quetzal -- --prediction path/to/prediction.json
```

Reports under `var/benchmarks/` keep run manifests, per-case calculations, expected and predicted impacts, evidence and unsupported claims. A0 is reported as **not run** unless a prediction is supplied. A failed provider output remains a failed run; the curated model never substitutes for it.

Live checks use the server's configured provider and send only the allowed design context (extraction) or neutral questions without Project Memory (contamination probe):

```bash
node --env-file=.env.local scripts/extract-quetzal.mjs --runs 3 --evaluation-revision v0.1-development.1
node --env-file=.env.local scripts/probe-quetzal-contamination.mjs
npm run diagnose:extraction -- --strategy A --models gemini-3.5-flash-lite --runs 10 --acceptance true --output-dir var/benchmarks/new-acceptance-series
npm run test:visual:live
```

Use the environment file where your server credentials are configured. The fixed contamination probe is metadata, not a benchmark score. C2 uses a separately authored neutral architecture and perturbed values; its deterministic result does not measure foundation-model generalization.

The user-approved [V0.1 validation specification](docs/VALIDATED.md) retains a separate requirement for independent engineering review, which remains pending. No public preflight snapshot was established, and model pretraining contamination cannot be ruled out. C1 is **historical causal reconstruction**, not an unseen-failure prediction. These are development results until review. See [sources, licenses, cases, metrics and reproduction](docs/VALIDATION_QUETZAL1.md).

Contract validity on the real Quetzal-1 documents is **8/8** after fixing three defects in the extraction contract on 9 September 2026: a requirement citation field the provider read as "source document", quotation checks that compared Markdown markup instead of the document as rendered, and a missing bounded retry when the model breaks its own contract. Errors now name the object and field that failed. See the [reliability audit](docs/EXTRACTION_RELIABILITY_AUDIT.md).

The earlier development checks passed nine deterministic cases. After 50 exploratory provider requests, the separate final live series completed 5 of 6 requests: **1/5 completed outputs passed the contract; 0/5 passed complete A0**. This fails the preregistered 80% targets. A real browser run verified generation, persistence, sources, requirements and re-entry after an explicit retry, but four of five outputs across both live browser runs were rejected. Extraction reliability remains unresolved with the available provider configuration. See the [product audit, experiments and limitations](docs/EXTRACTION_RELIABILITY_AUDIT.md) and [frozen acceptance protocol](docs/EXTRACTION_EXPERIMENT_PLAN.md).

Diagnostics retain every physical request and separate transport completion, JSON/schema validity, contract validity and A0. To compare retained runs without sending new requests, use `node scripts/summarize-extraction.mjs RUN_DIRECTORY [RUN_DIRECTORY ...] --output var/benchmarks/new-comparison.md`. Use a new output path; private reports and model responses stay ignored by Git. Live commands consume the configured provider quota; fixture browser tests are separate commands.

To deliberately replace development/test projects, teams and associated workspaces, stop the API first and run:

```bash
NODE_ENV=development NORTE_ALLOW_DESTRUCTIVE_RESET=1 \
  node scripts/reset-validation-data.mjs --file var/mission-dev-data.json
```

The utility writes a private backup before replacement, preserves accounts and sessions, clears removed projects' Discovery state, and prints the verified counts. Restart the API afterward. The utility does not load `.env` implicitly or delete data on app startup.

For an explicitly local development/test PostgreSQL database:

```bash
NODE_ENV=test NORTE_ALLOW_DESTRUCTIVE_RESET=1 \
  node --env-file=.env.test scripts/reset-validation-data.mjs --database
```

This requires a loopback host and a database name containing a separate `dev`, `development` or `test` segment. Remote databases, production mode and Render environments are refused. The PostgreSQL reset takes a backup and updates the state in a transaction.

The browser demo exposes `resetDemoValidationData('RESET_VALIDATION_DATA')` from `src/lib/demoApi.ts` for an explicit validation reset. It backs up prior browser state and preserves the account profile. It is never called automatically. The [frontend validation guide](examples/README.md) also describes an explicit curated design preview for this browser-only environment; that preview is not an AI extraction result.

**Current technical measurements:** per-case dependency recall, critical-impact precision, calculation accuracy, unsupported-claim rate, traceability coverage and requirement-impact recall. Browser checks also record interaction count and local fixture timings. **Planned human evaluation:** task completion time, missed/false impacts, source lookups and decision confidence with documents versus Norte. Browser timings are not student study results.

## System and Discovery navigation

System expands and collapses children directly on the map. Selecting a card highlights its branch and direct technical interfaces while dimming unrelated elements. The hierarchy toggle sits beside the explorer. Neighboring interfaces use side ports; containment remains a separate dashed connection. Drag cards or use Alt + arrow keys; positions persist without changing engineering facts. Fit and reset remain available. System no longer exposes Requirements, Review documents, What if, Element relationships or hierarchy search.

Discovery keeps the canvas focused on text. Saving a new or edited idea triggers AI interpretation; **Test idea** uses the proposed change without opening a target/property form. Ambiguous ideas receive one short question on the card and can be edited in place. Connection, duplication and deletion appear when an idea is selected. AI interpretation needs the connected environment and configured Gemini credentials. Conception contains only System and Discovery.

Project Memory has one uppercase title and a unified artifact grid with at most four columns. Existing team references retain their ownership and unlink behavior; project files retain their edit/delete behavior.

**Open conception** sits at the top right of Project Memory; the project name is edited below the title. Conception shows the current project name and provides **Edit memory** and **Next phase** in the same action area. Next phase opens an explicitly labeled preliminary-design preview and keeps that phase accessible after reload. Detailed design, integration/verification and operations remain future phases.

[Additional Quetzal-1 sources](docs/QUETZAL1_ADDITIONAL_SUBSYSTEMS.md) cover ADCS, antenna deployment and the mission overview. Four attributed artifacts and real source-verified Gemini extractions are added once to the existing real-source Quetzal project on server startup. This expands the map while archiving the previous architecture and preserving technical values and OBSAT selection. Other projects are unaffected. This specific extension does not reintroduce general document re-interpretation; coverage and limits are recorded alongside the extraction files.

See [the interaction validation record](docs/SYSTEM_WORKSPACE_INTERACTIONS.md) for tested behavior and the remaining live-provider check.

## Security

Gemini credentials stay on the server. Artifact content is untrusted data, rendered as text, and cannot supply model instructions. External links are not fetched arbitrarily. Unsupported file formats must remain explicitly unparsed; missing evidence cannot justify an invented critical conflict.

The current hosted storage design represents a shared organization. Independent organizations need stronger tenant isolation before sharing one deployment. See [security policy](SECURITY.md).

## Repository structure

```text
src/pages/       Project Memory, conception and team screens
src/components/  Shared controls and engineering visualizations
src/lib/         Project model, reasoning, persistence and API clients
server/          Fastify API, AI services and data stores
scripts/         Development, security, validation and visual checks
tests/           Client/model tests
examples/        Explicit engineering examples and fixtures
benchmark/       Quetzal design context and separate evaluator-only expectations
docs/            Architecture, research and deployment notes
.github/         Quality, security and deployment workflows
```

A colaboração por convites, os organogramas e a cópia local com três projetos estão documentados em [Equipes e colaboração](docs/TEAM_COLLABORATION.md). Para abrir a cópia preparada: `npm run dev:team-preview`. Emails reais exigem as variáveis SMTP de `.env.example`.
