# Extraction reliability investigation — 8 September 2026

## PRE-EXTRACTION-FIX CHECKPOINT

| Item | Recorded result |
| --- | --- |
| Branch | `main` |
| Commit | `6dd86398d63db3cd12a9d1e02b5097d670fe854a` |
| Push | Pushed to `origin/main`; `git ls-remote` matched the complete SHA; working tree clean |
| CI | [Quality](https://github.com/Raiagues/norte/actions/runs/34176635614), [Security / CodeQL](https://github.com/Raiagues/norte/actions/runs/34176635597), [Pages](https://github.com/Raiagues/norte/actions/runs/34176635611): success |
| Quality | TypeScript, ESLint, 87 frontend tests, 11 backend test files and production build passed |
| Security | Secret scan passed; dependency audit: zero vulnerabilities |
| Deterministic benchmark | Quetzal B10/B25/B26/B100/C1: 5/5 passed; A0 intentionally not run without a prediction |
| Structural benchmark | C2: 4/4 passed |
| Browser | Both `test:visual` and `test:visual:quetzal` passed; real UI/API, explicitly mocked provider |
| Private material | `.env`, `.env.local`, databases, backups and `var/` reports excluded; staged path inspection and secret scan passed |

This checkpoint was committed, pushed and checked **before** this audit and before any new prompt, schema, validator or benchmark changes. No Render operation was performed. Pushing main may activate existing deployment configuration; the owner controls Render deployment.

## Product audit before extraction changes

Sources reviewed: the four earlier product requests, the current ordered request, the user-approved `VALIDATED.md`, `PRODUCT_RESEARCH_ENGINEERING_REASONING.md`, `UX_RESEARCH.md`, `VALIDATION_QUETZAL1.md`, README, architecture, recent commits, production code and benchmark implementations. Later product decisions supersede the original generation button, permanent drawer and formal hypothesis form. “Verified” below describes the evidence available, not a usability study or a certified engineering review.

| Requirement | Implemented? | Verified how? | Remaining issue / scope |
| --- | --- | --- | --- |
| Only project selectable in sidebar; team belongs to project; no global default team | Yes | `MissionSidebar`, App bindings; navigation unit tests; browser switches between two projects with different teams | Legacy preference is only removed during explicit reset; no active selector uses it |
| Phase progress belongs to project | Yes | `projectStore` normalization and `completeConception`; server merge preserves unlocked progress | Full released-baseline version management is outside current implementation |
| Memory return, refresh and project switching preserve Conception access | Yes | Browser checks Memory → reload → Conception and two-project switch; migration unit tests | Tests use an isolated store |
| New Project visible, disabled for pointer/keyboard, no creation UI route | Yes, UI | Native disabled controls in Home and empty state; route allowlist in App; browser/native semantics | Authenticated POST project API still exists for persistence/import and tests; this is **not** a server-side creation ban |
| Create Team disabled; no alternative hidden creation button | Yes, UI | Native disabled Teams heading; all `setDialog` paths inspected (edit/member/artifact only) | Authenticated team-creation API remains available; invitation and existing-team editing remain supported |
| No Generate architecture action; Start conception generates automatically | Yes | App initialization + server route; browser asserts one generation | Real provider reliability is unresolved at checkpoint |
| Coherent loading, recoverable failure, persisted baseline | Yes | Indeterminate accessible activity UI; server atomic persist and memory-conflict tests; browser first failure/retry | No precise progress percentage; fixture browser latency is not provider latency |
| Re-entry does not regenerate or replace corrections | Yes | Client and server return existing baseline; browser request count and persistence checks | Changed memory marks revision rather than regenerating |
| No hidden fixture fallback; demo explicitly selected | Yes | Production service rejection paths; guarded demo helper; browser failed first extraction leaves no baseline | Demo and regression fixture results are never counted as live A0 |
| System first after Memory, remembered later workspace | Yes | `lastConceptionWorkspace`, automatic navigation, research rationale; browser checks | Decision informed by research, not comparative human testing |
| Discovery free brainstorming without organizer, clusters, semantic groups, generic suggestions, rewrite, maturity or AI moving cards | Yes | `BrainstormLab` active actions and organizer call sites inspected; browser card/history flow | Older organizer implementation may remain isolated; not an active Discovery feature |
| Contextual engineering hypothesis with few actions, consequences on canvas, no chat | Yes, bounded recognizer | Browser numeric duty/current/mass scenarios; shared impact engine | Ambiguous targets and component replacements need compact clarification; arbitrary natural language is not comprehensively supported |
| Visual proximity never treated as physical evidence | Yes | Engine follows typed, identified baseline relations only | Inferred links remain review, not measured physical facts |
| Macro architecture first; explicit drill-down and breadcrumb; graph not exhaustive | Yes | `SystemWorkspace` and graph projection; browser macro/drill-down checks | Very large real extracted graphs have not been stress-tested with engineers |
| Requirements separate from ordinary nodes; compact filters; selection highlights traces | Yes | Requirements overlay, trace projection; browser filter/edit/highlight checks | Extraction trace completeness remains an A0 issue |
| Selection does not open permanent drawer; explicit accessible details; graph dominant | Yes | Info affordance/dialog; keyboard open/close/focus; browser desktop/mobile | Nonfatal main bundle size warning remains |
| Facts have citations; calculations expose inputs/rule; inferences visibly classified | Yes, contract enforced | Source dialogs, evidence validator, deterministic reasoning records and tests | PDF citations cannot be text-verified and are downgraded; DOCX/XLSX not parsed; external links are metadata only |
| Why/path/requirement provenance auditable without chain-of-thought | Yes | Relation IDs, evidence locators, structured calculation records; provider private thoughts excluded | Missing source data stays review; it cannot establish an engineering claim |
| Show existing work instead of configuring AI | Yes | Linked Memory artifacts resolved server-side; no AI setup fields; Start needs project/team, not role assignment | Unsupported document formats require a supported export |
| Generate first; preserve engineer corrections as structured exportable data | Yes | `engineeringCorrections`, revision/transaction/source snapshots; unit and browser tests | Bounded history (1,000 records); no training pipeline or tamper-proof append-only server audit |
| Intelligence visual and every autonomous conclusion observable | Yes, within rules | Temporary scenario graph, typed paths, calculation and missing-data evidence | Bounded rule engine, not a general simulator or certification system |
| Fast hypothesis → impact | Yes, measured only in automation | Quetzal browser: 1 action from saved recognized card; 2 from typed content; 0 AI configuration; 133.4 ms local impact in checkpoint run | Initialization 1,564.6 ms used mocked provider; no student/engineer time-to-value study |
| README English, real state, official app vs frontend demo, generic local instructions, actual badges | Yes | Text/link/path review; supplied Render URL documented; workflow names match repo | Production release version was not re-deployed during this audit |
| Metrics and Quetzal claims bounded by evidence | Yes | README/validation docs distinguish deterministic, fixture, live failures and planned human metrics | Independent engineering review pending; A1 raw ingestion unmeasured; retrospective curation/pretraining contamination limits remain |
| Clean validation environment, obsolete local demos removed appropriately, Quetzal not OBSAT | Yes, local | Guarded seed/reset implementation and local persisted state: one neutral team, one Quetzal project, two source documents, no generated baseline | No production database inspection/reset authorized or performed |
| Reset explicit, backup first, no automatic destructive production behavior | Yes | Reset guards and tests; production/remote database refusal; startup preserves records | Existing production records intentionally untouched |
| Frozen evaluator and model/evaluation separation | Yes | Freeze hashes, source allowlist, runner import boundaries, holdout canary; deterministic and masked tests | Full A0 strict completeness has not passed; an earlier schema-accepted result fails final hierarchy contract |

### Audit conclusion and extraction handoff

The requested interaction model exists and its principal routes were exercised. The unresolved delivery risk is automatic extraction: six earlier physical requests produced two complete outputs, one HTTP 503 and three local timeouts. One output violated the evidence contract; the other was numerically useful but incomplete and fails the final hierarchy validator. Thus there is **no final-contract-approved live baseline** in that series. This is distinct from the nine passing deterministic/structural cases and passing mocked-provider UI tests.

The UI disables creation, while authenticated creation APIs remain. This distinction is recorded explicitly rather than presenting a disabled button as an authorization restriction. The request concerns visible controls and alternate UI routes; existing authenticated persistence endpoints were not removed.

The pre-extraction audit is complete. The next phase measures provider behavior, schema complexity and model output separately, preserving the frozen evaluator and private prior reports.

## Extraction investigation and decision

**Outcome: the extraction acceptance target was not reached.** Implementation defects were fixed, alternative architectures were executed, and the real browser workflow produced a persisted baseline. This does not establish repeatable, complete engineering extraction. The owner confirmed that the current provider configuration is the only available one after being informed of the quota and model failures. No billing, secrets, Render configuration or production data were changed.

### Provider diagnosis and observability

The previous local deadline was 55 seconds. Exploration used one observable physical attempt with a 90-second deadline. Across **42 exploratory extraction/control invocations and 50 physical requests**, there were 22 HTTP 200 responses, 18 HTTP 503 responses, three HTTP 429 responses with explicit zero quota, two HTTP 404 responses, one HTTP 500 response and four client timeouts. One HTTP 200 was a tiny control truncated by its deliberately small 64-token budget; it is not a valid JSON or engineering extraction success. Different prompts, models and partial scopes must not be pooled into one accuracy score.

A 503 is a provider availability failure; a client abort supplies no model output to judge. The repeated 429 on `gemini-3.1-pro-preview` explicitly reported request/input-token quota limits of zero. The authenticated model listing advertised `gemini-2.5-flash`, but generation at the tested endpoint returned 404 twice. Model listing therefore did not establish usable access. Large Flash alternatives failed even with longer deadlines, smaller controls and an explicit low-thinking experiment. These are concrete access/availability limits, not evidence that those models cannot reason correctly.

The final requests contained 20,207 serialized characters (approximately 5,052 tokens by the clearly labeled characters/4 heuristic), including a 3,452-character response schema. `contextChars=16,619` measures the serialized contents, including instructions, rather than artifact text alone. Actual successful provider usage reported 3,575 prompt tokens and 7,131–8,186 output tokens; response envelopes were 28,228–31,690 bytes. Every completed final response ended with `STOP`, below the 16,000 output-token budget. Thus truncation does not explain their omitted facts. The original monolithic request was 20,954 characters with a 4,261-character schema; the final schema is 19.0% smaller and total request 3.6% smaller. The compact experimental request fell to 13,284 characters with a 3,005-character schema and still failed. Size reduction alone did not solve semantics or availability.

Safe headers, time to headers, complete latency, response size, usage, finish reason and local abort status are retained per physical attempt. Final responses supplied `server-timing`, but no `Retry-After` or remaining-quota headers. Server timing and time to headers are not token-level time-to-first-token measurements. This non-streaming client cannot tell whether Gemini continued computing after a local abort; bounded retries can duplicate provider computation and cost. No cancellation guarantee is claimed.

Production now uses at most **two physical requests**, 90 seconds each, within a **185-second total budget**, with bounded exponential backoff and jitter. It respects `Retry-After` and stops if the indicated delay cannot fit. Transient transport/408/429/500/502/503/504 failures are eligible; permanent errors, explicit zero quota and JSON/semantic failures are not silently retried. Diagnostic and benchmark attempts use one physical request per stage so failures remain visible. The policy follows [Gemini troubleshooting](https://ai.google.dev/gemini-api/docs/troubleshooting), [API errors](https://ai.google.dev/gemini-api/docs/api-errors) and [project/model rate limits](https://ai.google.dev/gemini-api/docs/rate-limits); the numeric retry bounds are Norte's conservative implementation choice.

### Models and controlled alternatives

The initial A comparison interleaved two attempts per model with identical design context, schema, temperature 0.1 and output budget 16,000. Subsequent rows are explicitly different experimental conditions. The final default remains `gemini-3.5-flash-lite`; the measurements do not justify claiming a more accurate available replacement.

| Model | Observed quality / availability | Observed latency | Published capability / cost context |
| --- | --- | --- | --- |
| `gemini-3.5-flash-lite` | Initial A: 1/2 completed, 1/1 contract, 0/1 complete A0; final A2 below | Initial completed request 21.377 s; final completed mean 17.341 s | Structured output; 1,048,576 input / 65,536 output context limits; positioned for simpler high-volume processing; standard text input/output $0.30/$2.50 per million tokens |
| `gemini-3.8-flash` | Initial A: 0/2 completed (503); tiny control timed out; quality unmeasured | Initial failures 32.901/26.631 s; control timeout 20.007 s | Structured output; same published input/output limits; positioned for complex workflows; standard input/output $0.75/$3.75 per million through 2026-12-31 |
| `gemini-3.1-flash-lite` | C: one complete pipeline, contract failure; ledger: 0/2 contract; typed ledger: 0/1 among completed | C physical-request mean 8.72 s; ledger 28.43 s; prompts differ | Lower published standard text input/output price: $0.25/$1.50 per million; no demonstrated accuracy advantage here |
| `gemini-3.5-flash`, `gemini-3.6-flash` | No complete full extraction in A alternatives; low-thinking 3.5 also failed. Tiny 3.5 control responded but was truncated | A failure means 49.26 s / 1.73 s respectively | Larger-model quality cannot be inferred from unavailable responses |
| `gemini-3.1-pro-preview`, `gemini-2.5-flash` | Pro quota zero; 2.5 endpoint unavailable in this configuration | Rejections approximately 0.28–0.60 s | Not usable candidates with the current access; no quality comparison possible |

Capabilities are from the official [3.5 Lite](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite) and [3.8 Flash](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash) references. Prices are published standard paid-tier rates, not this account's bill or an assertion of paid-tier access; checked 8 September 2026 in [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing). Quota, failed requests and multiple stages prevent treating the cheapest per-token model as the cheapest usable baseline. Provider schema decoding is not a guarantee of factual or graph correctness, as reflected in [structured-output guidance](https://ai.google.dev/gemini-api/docs/structured-output).

| Experiment | Completed physical requests | Complete extractions / attempted | Contract / completed | Finding |
| --- | --- | --- | --- | --- |
| A original, 3.5 Lite | 1/2 | 1/2 | 1/1 | A0 fails: 17/18 entities, 20/23 properties, 11/20 relations, 1/2 source classifications |
| A original, 3.8 Flash | 0/2 | 0/2 | unavailable | Both 503 |
| Compact, 3.5 Lite | 1/2 | 1/2 | 0/1 | Smaller schema retained formula/relationship and evidence defects |
| B hierarchy → properties → relations → requirements, 3.5 Lite | 6/7 | 1/2 | 0/1 | One failed relation stage; completed pipeline introduced dangling entity/evidence references |
| C normalized facts → assembly, 3.5 Lite | 1/3 | 0/2 | unavailable | One facts stage failed; another extracted 22 facts but assembly returned 500 |
| C, 3.1 Lite | 3/4 | 1/2 | 0/1 | Complete pipeline lost required formula inputs, properties and links |
| Literal source ledger + derived calculation edges, 3.1 Lite | 2/2 | 2/2 | 0/2 | Code fixed edge direction, but generated formula identifiers/inputs remained invalid |
| Typed formula ledger, 3.1 Lite / 3.5 Lite | 1/2 / 0/2 | 1/2 / 0/2 | 0/1 / unavailable | Typed enum removed one failure mode; completed output instead failed evidence validation |
| Internal Portuguese compact, 3.5 Lite | 2/2 | 2/2 | 0/2 | Same facts, UI labels held English; neither passed formula contract/A0 |
| Reduced A, explicit low thinking, 3.5 Lite / 3.5 Flash | 1/2 / 0/2 | 1/2 / 0/2 | 1/1 / unavailable | Lite accepted output still failed A0; no evidence to change thinking default |

The English compact control completed 1/2 and passed 0/1 contracts; Portuguese completed 2/2 and passed 0/2. These tiny samples with different service availability cannot establish a language advantage. Detailed relation/property scores remain in each run and the comparison report. Low temperature stayed at 0.1 throughout full extraction experiments. Seed is supported by [GenerationConfig](https://ai.google.dev/api/generate-content#v1beta.GenerationConfig), but was deliberately unset to measure repeated stochastic output rather than repeat one sampled answer. Actual settings and request hashes are retained; seed would not imply guaranteed reproducibility.

Six cumulative compact ablations each used one 3.5 Lite attempt: hierarchy (503, 55.663 s), +properties (schema pass, 5.734 s), +relations (schema pass, 54.251 s), +evidence (client timeout, 90.006 s), +requirements (schema pass, 25.376 s), +traceability (503, 35.725 s). Successful partial JSON is not complete engineering accuracy. The sample does not isolate evidence/schema complexity as the cause of provider overload; hierarchy alone also failed. No partial run counts toward acceptance.

### Output causes, fixes and final architecture

| Failure category | Evidence / interpretation | Implemented response / residual limit |
| --- | --- | --- |
| `provider_error`, `provider_timeout` | HTTP failures or local abort; no output available to score | Bounded production retry, longer measured deadline, safe physical-request telemetry; quota zero cannot be repaired in the repository |
| `schema_rejection` | Invalid JSON or structural references; B stages produced handles not present in earlier stages | Shared contract enums, deterministic metadata hydration, stage outputs retained; full runtime validation still mandatory |
| `hierarchy_failure` | Earlier accepted graph had conflicting parent/contains cycles | New extraction has only `parentId`; generated contains is rejected; legacy hierarchy union still checked. Final 5/5 acyclic |
| `relation_direction_failure`, `relation_semantic_failure` | Reversed, absent or incompatible formula inputs and incorrect typed links | Prompt defines result `derived_from` input; ledger experiment derives direction in code. The first category also covers other formula-input failures, not exclusively literal edge reversal |
| `missing_required_fact` | Battery quantities are present in allowed source text but absent in outputs; final responses are not truncated | Generic quantitative-preservation rule; no battery-specific expected answer injected. Final property completeness remains 20–21/23 |
| `requirement_trace_failure` | Correct-looking statements do not ensure required entity/calculation links | Separate requirement stage was tested; it invented unresolved handles. Final requirement extraction/linking remains imperfect |
| `unsupported_evidence`, `semantic_validation_failure` | Quote/numeric/source mismatch, invalid formula representation or incomplete classifications | One shared extraction enum source plus compatibility tests; literal and numerical source verification. Invalid claims are rejected before persistence |

The selected production architecture is a **reduced monolithic extraction followed by deterministic hydration and full validation**. It asks only for entities, relations, requirements and evidence. Code owns root metadata, duplicated requirement state, calculated results, unit normalization, graph paths and verdicts. Entity handles remain for cross-references. Hierarchy has one representation; existing typed physical/functional relations remain because the reasoner needs their distinct meanings. Broad `affects` or visual co-occurrence cannot substitute for a formula input or a power connection.

Source IDs, literal excerpts and actual locators remain attached to claims; uncertain links stay inferred. Experimental stages retain source fragments, stage names, settings and intermediate outputs. The fact-first stage verifies literal quotes, not the entire semantic truth of every normalized statement. A deterministic source-fragment ledger and typed formula variant were implemented to test a stronger separation, but neither yielded an accepted complete baseline. Promoting either would add requests and failure points without observed benefit. This decision preserves a working, reviewable path while leaving extraction reliability explicitly unresolved; it is not a claim that one-shot generation is intrinsically superior.

No dependency path, expected Quetzal requirement link, flight result or evaluator-only number was added to the prompt. Context, expected values, aliases, arithmetic, evaluator code and `VALIDATED.md` match all six frozen hashes. Development iteration can still adapt to a public benchmark; unchanged hashes and canary checks do not establish absence of pretraining contamination or independent validation.

### Fresh final acceptance series

Production extraction sources were fixed at commit `1b2409b` before this series; subsequent edits only improve UI error feedback, reports and documentation. `var/benchmarks/diagnose-final-A2-20260908/manifest.json` records exact settings/source hashes and the preregistered thresholds. Five completed extractions were reached after six attempts; no completed failure was replaced or omitted.

| Attempt | Provider / elapsed | Schema | Full contract | Complete A0 | Principal output issue |
| --- | --- | --- | --- | --- | --- |
| 1 | 200 / 20.299 s | pass | fail | fail | Formula inputs, missing facts and links |
| 2 | 503 / 73.185 s | not run | not run | not run | Provider availability |
| 3 | 200 / 16.512 s | pass | fail | fail | Unsupported evidence, missing facts and links |
| 4 | 200 / 18.942 s | pass | pass | fail | Incomplete properties, relations and requirement traces |
| 5 | 200 / 14.902 s | pass | fail | fail | Formula inputs and missing facts/relations |
| 6 | 200 / 16.052 s | pass | fail | fail | Formula inputs, missing facts and links |

Provider completion: **5/6 (83.3%)**. JSON/schema among completed: **5/5**. Full contract: **1/5 (20%)**. Complete A0: **0/5**. Overall usable baselines: **1/6 (16.7%)**. Mean elapsed time: **26.649 s across all attempts**, **17.341 s among completed responses**. Hierarchy checks passed 5/5 and leakage guards passed for every request. The no-unsupported-documented-evidence target failed; rejected output did not persist. Both 80% quality targets failed. Detailed raw-output A0 diagnostics are not accepted model predictions.

The provider limitation is concrete: Pro access reports quota zero, other larger tested models repeatedly fail before usable extraction, and the owner has confirmed no alternative configuration is available. The Lite output defects remain a separate unresolved quality limitation; provider errors do not excuse or explain those semantic failures. Reasonable schema, language, thinking, model and staged alternatives were tested. Further access changes require an external change; this delivery does not declare extraction solved.

## Final product re-audit and verification

All product rows above were revisited after the extraction changes. `test:visual` passed on desktop/mobile and verifies project/team restrictions, per-project progression, failure recovery, explicit semantic-error feedback, System first, source/detail dialogs, requirement overlay, corrections, Discovery hypotheses and causal impact. `test:visual:quetzal` passed initialization, saved/typed hypothesis interaction, impact and persistence checks with an explicitly mocked provider: 4.021 s initialization and 96.184 ms local impact, one action from a saved recognized card or two from typed content, zero AI setup fields. These are automation measurements, not engineer usability results or live provider latency.

The separate **real provider/browser** test used authenticated React/API flow and a temporary isolated database populated with two source documents and no baseline or model fixture. Both runs are preserved:

- `browser-live-1788833571118`: three complete provider outputs, all rejected for formula-contract defects; Memory preserved, no fixture fallback, no accepted baseline. The run failed overall.
- `browser-live-1788833864187`: first output rejected; explicit retry produced an accepted baseline with 18 entities, 20 relations and five requirements. Visible loading, macro graph, explicit source/detail interaction, requirements, refresh and Memory → Conception re-entry all passed, with zero regeneration requests and zero JavaScript errors. Successful interaction latency was **39.073 s**.

Across the two browser runs, four of five physical outputs were rejected. A passing recovery flow therefore does not establish extraction reliability. The accepted browser prediction separately failed A0: 18/18 entities, 21/23 properties, 16/18 units, 19/20 relations, 4/5 requirements, 67/67 provenance coverage and 1/2 source classifications. This post-hoc evaluation is retained outside the final acceptance series. General hypothesis accuracy from that live prediction is not certified by deterministic tests on curated input.

The live failure revealed generic English error feedback for formula/hierarchy errors. The UI now maps those codes to localized messages, and browser regression verifies semantic rejection creates no baseline and displays the Portuguese calculation-dependency message before explicit retry. Original live reports remain unchanged; the improved report parser records string API error codes correctly on future runs.

| Final gate | Result |
| --- | --- |
| `npm run quality` | Passed: typecheck, ESLint, 87 frontend tests, 98 backend tests, production build; nonfatal bundle-size warning remains |
| `npm run security:secrets`, `npm run security:audit` | Passed; zero dependency vulnerabilities |
| `npm run benchmark:quetzal` | 5/5 deterministic cases passed; default A0 correctly not run |
| `npm run benchmark:structural` | 4/4 structural cases passed |
| Browser regression / Quetzal browser | Both passed with explicitly mocked provider |
| Real browser acceptance | One failed run and one passed recovery run, both retained as described above |
| Fresh live extraction acceptance | **Failed**: contract 1/5, complete A0 0/5 among completed |
| Frozen reference | Six file hashes unchanged; no evaluator accommodation |
| Independent engineering review | Pending; owner-approved specification is not an independently reviewed engineering result |

Private evidence index: `var/benchmarks/extraction-comparison-final-20260908.md` provides the full cross-run table and per-attempt missing facts, relationship errors, requirement errors, evidence errors, sizes and timings; its JSON companion retains structured data. All original run directories, including failed exploratory, final and browser attempts, remain ignored by Git. Regenerate a comparison into a **new** filename with `scripts/summarize-extraction.mjs`; it performs no provider calls and does not rewrite past results.

The final delivery preserves disabled creation controls, free Discovery, System-first macro architecture, auditable sources and corrections. Remaining limits are extraction accuracy/availability, supported document ingestion, bounded engineering rules and correction history, unmeasured human time-to-value, retrospective benchmark contamination and pending independent review. Final push/CI identifiers are reported with the delivery commit; Render deployment remains with the owner.

## Real Project Memory documents — 8 September 2026

The validation project now holds the actual Quetzal-1 engineering documents
(`docs/QUETZAL_VALIDATION_SOURCES.md`). The earlier blocker — the server rejecting
conception with *"Connect a readable text or PDF artifact to project memory"* —
is resolved: it was caused by memory that contained curated text or link-only
artifacts, and `metadata_only` artifacts can no longer be mistaken for readable
sources because the interface now shows the server's own verdict on every card.

### Request size against `gemini-3.5-flash-lite`

Three runs per set, one physical request each, sources measured after parsing:

| sources | request | latency | provider outcome |
| --- | --- | --- | --- |
| 3.42 MB — hardware README, schematic, flight-software README, AX100 | 4.57 MB | 15 s / 33 s / 18 s | 3/3 HTTP 200 |
| 3.43 MB — the above plus the reference BOM (**default core set**) | 4.58 MB | 6 s / 7 s / 4 s | 3/3 HTTP 200 |
| 6.26 MB — plus INA260 and TPS2551 datasheets | 8.35 MB | 83 s / 122 s / 57 s | 3/3 HTTP 200, two above the 90 s attempt timeout |

The 8.35 MB request is answerable but not within the extraction timeout, and one
earlier attempt at that size returned HTTP 503. The provider limits were **not**
raised; the two TI datasheets were moved to `--tier extended` instead. PDFs are
billed as image tokens: the 4.58 MB core request is only ~31.8 k prompt tokens.

Transient HTTP 503s were observed at 4.58 MB during one browser run (two
consecutive attempts) and cleared on retry, so provider availability — not
payload size — dominates that failure mode at the default set.

### Contract validity on real documents: 1/6

Six consecutive live extractions over the seeded core set, contract validation
applied to each completed output:

| runs | outcome |
| --- | --- |
| 1/6 | accepted |
| 5/6 | `SYSTEM_RESPONSE_INVALID` |

**Every one of the five rejections has the same single defect**: the model places
an **artifactId** in `requirement.sourceRefs` where an evidence id is required —
`sourceRefs: ["quetzal-src-quetzal-eps-hardware-readme"]`. Entity and property
`evidenceRefs`, relation endpoints and evidence records were valid in all six
runs (`badEntityRefs` and `badRelationEnds` were empty every time). Entity counts
ranged 4–9, relations 1, requirements 1–3, evidence 2–8.

This is a single, precisely located contract defect, and it is the first thing
the resumed extraction-contract work should address. It is not a Project Memory
or ingestion problem: the same requests carry correct document content and
produce correct entity-level citations.

### Accepted browser run

`var/benchmarks/acceptance-quetzal-*` (run of 8 September 2026) records the full
passing flow over the seeded database: five real documents all readable, Project
Memory rendering them as usable, Start conception → live provider → validated,
persisted system, System workspace rendering the graph, and Memory → Conception
re-entry reopening the saved model with **zero** regeneration requests. It needed
two attempts because the first was lost to provider 503s. The accepted model held
5 entities, 1 relation, 1 requirement and 6 evidence records, every record citing
a seeded artifact:

- `EPS → powers → COMMS` cites the Quetzal-1 EPS hardware README.
- `NanoCom AX100 · tx_power = 30 dBm` cites the GomSpace AX100 datasheet.
- `ATMEGA328P · nominal_voltage = 3.3 V` cites the hardware README at L57.

Extracted breadth is thin. A what-if on `tx_power` (30 → 33 dBm) therefore marks
AX100 changed and everything else unaffected: the documents produced no power
budget, duty cycle or energy balance, so the engine has nothing to propagate. No
benchmark value was injected to make the scenario look richer. Extraction breadth
and the contract defect above are the open items.

Run `npm run test:acceptance:quetzal` to reproduce; it uses the live provider and
a copy of the seeded store, and never writes to local data.

## Contract reliability fixed — 9 September 2026

Contract validity on the real Quetzal-1 documents went from **1/6 to 8/8** over
three measured live series. Three defects were found and fixed; none of them was
a weakening of what the validator checks.

### 1. The provider was asked the wrong question

The persistence model calls a requirement's citations `sourceRefs` while every
other object uses `evidenceRefs`. The extraction schema exposed that name to the
provider, which read "source" as "source document" and answered with an
`artifactId`. That single defect caused **5 of 6** rejections.

The extraction contract now names the field `evidenceRefs` everywhere, and
`restoreRequirementSourceRefs` maps it back to the stored name during hydration.
The persisted schema is unchanged, so saved models still validate. The prompt
also states plainly that an `evidenceRefs` entry is an evidence record's id and
never an `artifactId`.

Result: `SYSTEM_RESPONSE_INVALID` disappeared entirely from the next series.

### 2. Quotations were checked against markup, not against the document

With reference integrity fixed, the remaining rejections were quotations. Two
real examples, both faithful and both rejected:

| the model quoted | the file holds |
| --- | --- |
| `Thus, a microcontroller (Vendor, Cat. No. PART) was implemented` | `...a microcontroller ([Vendor, Cat. No. PART](https://vendor.example/part)) was implemented` |
| `1X [Vendor, Cat. No. PART] - Single-Cell Li-Ion Battery Fuel Gauge` | `1X [Vendor, Cat. No. PART](https://vendor.example/part) - Single-Cell...` |

The sources are Markdown and the model quotes the **rendered** document. The
verifier compared raw bytes, so link targets, `<sup>` tags, HTML entities,
emphasis markers and line wrapping all produced false rejections.

`readableProjection` now projects both the source and the excerpt onto the text a
reader sees, carrying an offset map so the line locator still points at the real
source line. **Only markup is removed** — link targets, HTML tags, entities,
emphasis, backticks, brackets, and whitespace runs collapse to one space. No
word, number or punctuation mark is ever dropped, and the same projection is
applied to both sides, so a paraphrase, a removed word, a changed part number, an
inverted meaning or spliced sentences still fail. Those cases are covered by
tests.

### 3. The remaining failure was the guardrail working

The last recurring rejection was `nominal_voltage=3.3 V` attached to an evidence
record whose excerpt reads *"Quetzal-1 carried an Electrical Power System tasked
with:"* — a sentence containing no voltage. That is the validator correctly
refusing an unsupported number, and it was **not** relaxed.

Two changes reduce how often it happens and make it recoverable:

- the prompt now states the rule the validator actually enforces — a documented
  numeric property must cite an excerpt whose text literally contains that number
  with that unit, or the property must be omitted;
- `generate` makes one bounded second attempt when the model breaks its own
  contract (`SYSTEM_RESPONSE_INVALID`, `SYSTEM_EVIDENCE_INVALID`,
  `SYSTEM_HIERARCHY_INVALID`, `SYSTEM_FORMULA_INVALID`). The follow-up states
  only which rule the previous answer violated; it never supplies engineering
  content or a desired answer. Every physical request still reaches `onAttempt`,
  so nothing is hidden from diagnostics, and `maxContractAttempts: 1` disables it
  for the deterministic benchmark, which continues to score a single answer.

A provider fault is never retried this way — that stays with the transport policy.

### Measured series

| series | change under test | contract validity |
| --- | --- | --- |
| 8 Sep | baseline | 1/6 |
| 9 Sep | evidence field renamed | 6/8 (the other two were HTTP 429 quota, not contract failures) |
| 9 Sep | plus readable quotation and bounded retry | **8/8**, seven on the first attempt |

Errors are also now specific. `describeEngineeringSystemViolation` names the
object and field that failed — *"requirement REQ-1 cites doc in sourceRefs, which
is not an evidence id"* — instead of "invalid fields or references", and the
numeric check names the property and value it could not verify.

Extracted breadth is still thin and variable: 4 to 6 entities, 1 relation and 1
to 2 requirements per run. Coverage, not contract conformance, is the open item.
