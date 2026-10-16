# Quetzal-1 EPS + COMMS validation, V0.1

Research checked on **2026-09-08**, before constructing the benchmark fixture. This document includes evaluator information and **must not be ingested as Project Memory**.

Quetzal-1 provides a compact real engineering case with released hardware, firmware, telemetry and an EPS publication. UVG identifies it as a 1U satellite with 211 days of operations, deployed on 2020-04-28. It belongs to the UVG / UNOOSA / JAXA KiboCUBE context; it has no OBSAT requirements. See the [UVG mission page](https://www.uvg.edu.gt/cubesat/) and [official team profile](https://github.com/Quetzal-1-CubeSat-Team).

V0 isolates electrical reasoning: harvesting, battery, main bus, regulated rails, heater, OBC, communications, aggregate residual loads, power budget, energy balance and relevant EPS requirements. Approximately 10–20 meaningful entities are sufficient. Payload and ADCS are not expanded into engineering models; the small ADCS budget contribution can remain an explicitly attributed residual load.

**Review status: agent-curated; independent human engineering review pending.** Source inspection and automated checks are not human review. Results are provisional evidence about this implementation, not certification or a validated predictive benchmark.

The user approved the revised specification in [VALIDATED.md](VALIDATED.md). That document explicitly retains the independent-engineering-review condition. Approval is recorded as **approval of the V0.1 specification**, with its content hash; no reviewer identity, engineering background or completed engineering review is invented. Until independent review is complete, the evaluator directory is `evaluation_reference/`, not a reviewed truth release.

## Source inventory and redistribution

All repository links below are pinned. “MODEL CONTEXT” permits only selected design facts, not unrestricted retrieval of every linked page. “EVALUATION REFERENCE” means evaluator-only material. No third-party PDFs or source code were copied into this repository during research; temporary inspection copies were kept under `/tmp`.

| ID / title | Publisher or owner; date | Information and split | Repository storage decision |
| --- | --- | --- | --- |
| Q-UVG — [Cubesat / Quetzal-1](https://www.uvg.edu.gt/cubesat/) | Universidad del Valle de Guatemala; page undated, accessed 2026-09-08 | Mission identity: MODEL CONTEXT metadata. Operational duration and results: EVALUATION REFERENCE / research metadata | No explicit page redistribution license identified. Keep citation and mission facts; do not copy page or images. |
| Q-HW — [Quetzal-1 Hardware, EPS overview](https://github.com/Quetzal-1-CubeSat-Team/quetzal1-hardware/blob/d4d1b59de384701a016a6e17353aff3c8ba64853/EPS/README.md) | Quetzal-1 CubeSat Team / UVG; repository created 2022-07-31; pinned revision 2024-12-11 | MODEL CONTEXT: architecture, component families, board organization. Includes links to BOM, schematics and solar-panel files | Team-authored hardware is under [CC BY-SA 4.0, repository license](https://github.com/Quetzal-1-CubeSat-Team/quetzal1-hardware/blob/d4d1b59de384701a016a6e17353aff3c8ba64853/LICENSE.txt). Redistribution requires attribution, license and change notices; adapted licensed material retains the applicable ShareAlike conditions. V0 stores pointers and factual curation. |
| Q-SCH — [EPS schematic, PT-MIS-PCB-002_v1](https://github.com/Quetzal-1-CubeSat-Team/quetzal1-hardware/blob/d4d1b59de384701a016a6e17353aff3c8ba64853/EPS/output/eps/Schematic/PT-MIS-PCB-002_v1%20Schematic.pdf) | Same team; internal initial release 2019-06-12, export / diagram update 2022-10-16 | MODEL CONTEXT: sheets 04 harvesting, 05 storage, 06/07 regulation, 08 switching, 09 MCU. Sheet 11: historical metadata | Same hardware license, subject to rights in embedded third-party material. Preserve links; the PDF is not bundled. |
| Q-EPS-D — [Design and On-Orbit Performance of the Electrical Power System for the Quetzal-1 CubeSat](https://jossonline.com/storage/2023/05/Final-Aguilar-Nadalini-Design-and-On-Orbit-Performance-of-the-Electrical-Power-System-for-the-Quetzal-1-CubeSat.pdf) | Aguilar-Nadalini, Chung, Marsicovetere, Bagur, Medrano, Miranda, Ayerdi and Zea, UVG; Journal of Small Satellites 12(2), 1201–1229. Submitted 2021-10-30; accepted 2022-02-17; published **2023-05-31** | MODEL CONTEXT: selected design facts from §2, Table 2 and Appendix D only. This is a retrospective design description | Footer identifies A. Deepak Publishing, all rights reserved. Public readability does not authorize redistribution. Keep citation, locators and factual curation; do not bundle the paper, screenshots or reproduced tables. |
| Q-EPS-F — same EPS publication | Same publication and license | **EVALUATION REFERENCE only:** §3, particularly §3.5.1, pp. 1214–1215; Tables 3/4; conclusions / recommendations | Same restriction. Store concise observations and source locators separately from context. |
| Q-SW — [Quetzal-1 Flight Software, EPS](https://github.com/Quetzal-1-CubeSat-Team/quetzal1-flight-software/blob/dbfb67a2c8a7336f765e320d37a8a02e3ab4c212/EPS/README.md) | Quetzal-1 CubeSat Team; repository created 2021-05-02; pinned revision 2024-12-11 | Optional MODEL CONTEXT cross-check: OBC commands, sensor network and software current limits. Broad firmware ingestion is outside V0 | [License declaration](https://github.com/Quetzal-1-CubeSat-Team/quetzal1-flight-software/blob/dbfb67a2c8a7336f765e320d37a8a02e3ab4c212/README.md#license): team sketches / headers GPLv3; bundled libraries have distinct licenses, including one with no available license. No code is copied. Do not label the entire tree uniformly GPL or permissive. |
| Q-TLM — [Quetzal-1 Telemetry](https://github.com/Quetzal-1-CubeSat-Team/quetzal1-telemetry/tree/86b512f52cad6cba850f63cd46f4dbb03ded93c3/telemetry) | Quetzal-1 CubeSat Team / UVG; flight observations 2020, repository created 2022-10-23; pinned revision 2024-12-11 | EVALUATION REFERENCE corpus for later independent verification. `telemetry/telemetry.xlsx` and `telemetry/variable_description.xlsx`; not processed as time-series evidence in V0 research | [CC BY-SA 4.0](https://github.com/Quetzal-1-CubeSat-Team/quetzal1-telemetry/blob/86b512f52cad6cba850f63cd46f4dbb03ded93c3/LICENSE.txt). Reuse can follow those conditions; V0 links rather than bundles the 47 MB workbook. |

### V0.1 change: the application now stores the real documents

Since 8 September 2026 the validation project's Project Memory holds the **actual bytes** of Q-HW, Q-SCH, Q-SW, the official GomSpace NanoCom AX100 datasheet and the pinned EPS reference BOM, imported by `scripts/seed-quetzal-validation.mjs` from the publishers into the **private application database**. The repository still bundles no third-party PDF; it stores only `examples/quetzal1/source-manifest.mjs`, which records publisher, pinned revision, URL, MIME type, size, licence, role and hash. Attribution and licence notes travel with each stored artifact as a `provenance` record.

The split is unchanged and now enforced in code: the manifest marks Q-EPS-D `role: "evaluation_reference"`, and the importer refuses that role outright, with a test covering the refusal. Q-TLM is not in the manifest at all. Neither the paper nor telemetry reaches the extraction model.

Verified against the pinned BOM while selecting supporting datasheets: INA260 (U1/U9/U12), TPS2551 (six FPB placements), INA169 (U16/U18/U20/U22), TPS63070 (U11), ATmega328P (U23), plus SPV1040 chargers and an LTC4352 OR-controller. TPS63070 was confirmed present rather than assumed from secondary discussion. The BOM lists **BQ27441DRZR-G1A** at U6 where the flight software README names **BQ27741-G1**; both datasheets are available as `extended` sources and neither is silently preferred. See [the sources and seed guide](QUETZAL_VALIDATION_SOURCES.md).

License conditions are documented by [Creative Commons](https://creativecommons.org/licenses/by-sa/4.0/). Attribution should name **Quetzal-1 CubeSat Team and Universidad del Valle de Guatemala**, source URL, revision and changes. The architecture illustration `EPS/media/IMG_EPS_PAPER_001.png` also appears in the copyrighted paper; V0 uses an original graph representing facts and retains the reference instead of copying the illustration. Manufacturer documents linked by the team are discovery pointers, not independently validated V0 inputs. A future component replacement requires a dated, reviewed manufacturer specification.

## Historical cutoff and contamination limits

The V0.1 documentary cutoff is **2020-03-07T04:49:00Z**, approximately the launch time in the user-approved specification. UVG's local launch date is March 6 at 22:49 GMT−6; those times are consistent. The initial history search used the earlier start-of-day cutoff; the oldest public commits found were in 2021/2022, so neither cutoff establishes an available preflight snapshot. The repositories inspected each had one public `master` branch, no tags and no commits returned by the GitHub API query `commits?until=2020-03-07T00:00:00Z&per_page=1`.

| Repository | First public commit inspected | Pinned research revision |
| --- | --- | --- |
| Hardware | [58eb8ec, 2022-07-31](https://github.com/Quetzal-1-CubeSat-Team/quetzal1-hardware/commit/58eb8ec4a8f5ec68430b1425b2f8bc2fe9356323) | `d4d1b59de384701a016a6e17353aff3c8ba64853` |
| Flight software | [2d22327, 2021-05-02](https://github.com/Quetzal-1-CubeSat-Team/quetzal1-flight-software/commit/2d22327f6a4f5c74f0651e2ebc351a61d9ed4777) | `dbfb67a2c8a7336f765e320d37a8a02e3ab4c212` |
| Telemetry | [ac1f0d6, 2022-10-23](https://github.com/Quetzal-1-CubeSat-Team/quetzal1-telemetry/commit/ac1f0d63a6a15ca0cdcb6e5f8de556419c67336a) | `86b512f52cad6cba850f63cd46f4dbb03ded93c3` |

The schematic claims a June 2019 initial design, but its revision history records a block-diagram addition in October 2022. A date printed inside a later release does not establish public availability or byte-identical content before flight. No clean public preflight snapshot was established. V0 is consequently a **retrospective design-versus-observation comparison**, with both retrospective curation and possible model pretraining contamination disclosed. Do not claim a blind historical prediction.

The model receives only allowlisted design fact text and source metadata under `benchmark/quetzal1/context/`. Expected values, affected paths, flight observations and reviewer records belong under `benchmark/quetzal1/evaluation_reference/`. This document and reports are evaluator-only. Do not give Gemini the full EPS paper: printed p. 1208 contains both design Table 2 and the beginning of flight-results §3. Page-level separation alone leaks information. Context links must not trigger automatic fetching of the complete source.

## Design fact locators

The following are factual inputs, not expected impact answers. Units below are normalized; percentage duty cycles become fractions for arithmetic. The compact values are independently represented rather than a reproduction of the publisher's table.

| Design inputs | Source locator |
| --- | --- |
| RX 0.231 W; TX 2.640 W; nominal TX duty 3.60%; OBC 0.264 W continuously; EPS electronics 0.020 W continuously; heater 0.908 W at 0% or 33.33%; residual ADCS 0.066 W at 2.50%; allowance factor 1.1 | Q-EPS-D, §2.4 / Table 2, p. 1208 |
| Design generation 2.37 W sunlight, 1.58 W orbital average; battery 2 × 2,000 mAh parallel, 3.7 V nominal | Q-EPS-D, §§2.1.1, 2.2.1, 2.4, pp. 1204, 1208 |
| Main bus 3.2–4.2 V; rails 3.3 / 5 / 7.6 V; OBC and AX100 on 3.3 V | Q-EPS-D, §§2, 2.3.1, pp. 1202, 1206; Q-SCH sheets 02, 06, 08 |
| Heater on below 3°C, off above 5°C; controlled by OBC | Q-EPS-D, §2.2.2, p. 1205 |

Q-HW describes the harvesting / storage / distribution responsibilities and EPS ATmega328P. Q-SCH sheet 08 explicitly connects `3V3_EPS` through the heater switch and monitor to `3V3_HEATER`. These establish meaningful relationships without creating a node for every resistor. Q-SW's EPS README, “Data collection,” separately documents a 1 A COMMS software overcurrent threshold. This is a software threshold, not the hardware switch rating.

The selected formal UVG requirements are **MI-003**, recharge following umbra, and **MI-004**, meet demand throughout flight phases (Q-EPS-D, Table D1, p. 1228). Preserve those identifiers. A Norte orbital-balance calculation is a separate analysis criterion, not a replacement wording or proof of either requirement. Positive average margin does not establish adequate eclipse storage, charging time or peak capability.

## Independent expected calculations — evaluator only

Freeze the design assumptions for class B: payload inactive, heater duty `h = 0.3333`, generation `G = 1.58 W`. The EPS / ADCS residual is `0.020 + 0.066 × 0.025 = 0.02165 W`. Keep OBC and heater distinguishable in provenance even when summing loads.

```text
d = TX duty as a fraction; RX and TX partition operation
Pcomms(d) = 0.231 × (1 − d) + 2.640 × d
Pother(h) = 0.264 + 0.020 + 0.908 × h + 0.066 × 0.025
Ptotal(d,h) = 1.1 × [Pcomms(d) + Pother(h)]
M(d,h) = 1.58 − Ptotal(d,h)
```

The 10% allowance is an additive budget allowance, not an instruction to divide power by 0.9. Apply it once. The independent implementation in `evaluation_reference/reference-arithmetic.mjs` calculates expected values without importing production reasoning. Each run checks its results against the stored reference decimals.

| TX duty | COMMS raw W | Total budget W, heater 33.33% | Orbital margin W |
| --- | ---: | ---: | ---: |
| 3.6% | 0.317724 | 0.99661144 | +0.58338856 |
| 10% | 0.471900 | 1.16620504 | +0.41379496 |
| 25% | 0.833250 | 1.56369004 | +0.01630996 |
| 26% | 0.857340 | 1.59018904 | −0.01018904 |
| 100% | 2.640000 | 3.55111504 | −1.97111504 |

These are Norte's independent calculations from normalized inputs, not additional flight measurements. Class B raises budgeted COMMS demand by **0.1695936 W** and preserves positive average margin. A `critical` average-energy deficit at 10% would be a false positive under these assumptions. Recharging requirements still need phase-specific analysis. Continuous TX creates a numerical deficit; battery depletion and loss of OBC power are downstream risks, not exact predicted times or guaranteed observed resets.

The 25% and 26% cases bracket the simplified decision boundary: 25% remains positive; 26% fails the distinct Norte analysis criterion. Both preserve review of the wider mission requirements. B100 tests the same quantitative model at continuous TX. C1 separately compares the resulting causal coverage with historical observations; it does not require equality with flight wattage.

Treat printed rounding separately from arithmetic tolerance. The source table's TX allowance cell is inconsistent with its raw values; the budget should derive the allowance from raw power and duty rather than transcribe that cell. Do not round intermediate values to reproduce printed totals.

Duty changes do not increase TX peak current: `2.640 W / 3.3 V = 0.8 A`. Inferring a regulator overcurrent solely from higher duty is unsupported. Nominal battery energy `3.7 V × 4 Ah = 14.8 Wh` is a calculation, not usable energy or a known initial state of charge. Do not infer a precise time to depletion from it. Holding generation and heater duty fixed is a deliberate V0 simplification; neither charge-controller dynamics nor a thermal model is simulated.

## Historical observation holdout — evaluator only

Q-EPS-F §3.5.1, pp. 1214–1215 reports **24 continuous-TX failures**, **3.13 W demand**, **1.32 W generation**, **−1.81 W margin**, depletion around **6 hours**, and watchdog adjustment **24 → 2 hours**. Four depletion events caused external resets. The ultimate failure mechanism remained uncertain. These observations never enter context or a prediction prompt.

Class C1 supplies only the design architecture and condition “communications transmitter remains continuously active.” Score the predicted causal coverage of communications demand, total load, negative energy balance, battery discharge risk, OBC supply continuity and impacted requirements. The evaluator may compare these with flight observations after inference completes.

The design calculation is not expected to equal flight wattage: operating conditions and measured behavior differ. Do not calibrate design inputs with flight generation, heater behavior or failure durations and then call the output a historical holdout result. Do not require the engine to predict the unidentified initiating fault or assert a certain final battery failure.

## Reproduction and evaluation contract

The implementation separates [design context](../benchmark/quetzal1/context/design-context.mjs) from [evaluator expectations](../benchmark/quetzal1/evaluation_reference/expectations.json). The [runner](../scripts/benchmark-quetzal.mjs) invokes the generic production impact engine for B/C1 with structured design input, without a provider or network call. The [evaluator](../scripts/quetzal-evaluator.mjs) reads independently stored decimals and semantic expectations. It never imports them into a generation prompt.

```sh
npm run benchmark:quetzal
npm run benchmark:quetzal -- --prediction /path/to/extracted-system.json
# Include recorded provider settings and the original extraction manifest:
npm run benchmark:quetzal -- --prediction /path/to/extracted-system.json --prediction-metadata /path/to/extraction-metadata.json
# Reassess an already inspected output without replacing its historical score:
npm run benchmark:quetzal -- --prediction /path/to/old-system.json --diagnostic
# Optional report destination:
npm run benchmark:quetzal -- --output-dir /tmp/quetzal-reports
# Direct runner, equivalent to the package command:
node scripts/benchmark-quetzal.mjs
```

Use the supported Node version from the main README. `--prediction` accepts a saved engineering-system object or `{ "engineeringSystem": ... }` obtained independently from the context-only extraction service. The runner does not perform live extraction. Supplying the structured input as its own prediction would not measure extraction. By default, A0 is explicitly `not_run` and has no scores; B/C1 alone are executed.

Every run writes an individual `var/benchmarks/quetzal-<timestamp>-<uuid>.json` report (or the requested output directory), including context and expectation hashes, input documents and model, change, expected and predicted affected entities, calculations, sources, unsupported claims and failures. Reports include holdout evidence and must not become Project Memory. File mode is `0600`; reports are local artifacts under ignored `var/`. A failed case returns exit code 1. A successful B/C1 run does not imply that A0 was executed or that evaluation reference received human review.

`benchmark/quetzal1/reports/README.md` points to that private local storage. The default executes **B10, B25, B26, B100 and C1**. A0 requires a real saved prediction; A1, extraction from raw PDFs, CAD, BOMs and fragmented repositories, is future work. Deterministic C1 uses the structured input and must not be reported as an independently executed LLM prediction.

The manifest records benchmark/reference revision, Norte Git SHA and dirty state, schema version, impact-engine hash, prompt-source hash, evaluator/arithmetic hashes, context hash, provider/model identifier, generation settings and timestamp. Actual past request hashes/settings stay `null` unless supplied; a prompt-source hash is not a claim about an unrecorded past request. `--prediction-metadata` accepts the extraction runner's nested `manifest` and preserves it as `originalExtractionManifest`.

| Case | Evidence required | Report separately |
| --- | --- | --- |
| A0 — curated context transformation | Model built from curated source text; separately curated expected entities, values, units, relations, requirements and source locators | Entity / relation precision and recall, property / unit accuracy, requirement extraction accuracy, provenance coverage. An offline prebuilt fixture check is not an extraction measurement. |
| B — duty 3.6% → 10% | Production generic arithmetic and propagation; independent expected decimals above | Calculation error, dependency recall, requirement-impact recall, false criticals, source coverage. |
| C1 — historical causal reconstruction | Prediction using design inputs; withheld flight observation comparison | Required causal-path coverage, critical-impact precision, unsupported-claim rate, uncertainty handling. Do not score exact flight wattage or duration as required predictions. |

Use semantic entity/property matching with reviewed aliases, normalize units and preserve direction of relations. A graph's every reachable node is not automatically a valid impact. Check that each highlighted path is supported by an electrical dependency or bounded inference. For zero-denominator metrics, report `not applicable` with counts instead of a misleading perfect score. Report each failure rather than optimize one aggregate score.

The initial extraction evaluator uses frozen English aliases with generic English/Portuguese token normalization, kind checks, unit conversion, directed relations and requirement statement / trace checks. Its current evaluation-reference list covers the selected context plus Norte's authored method, not every valid representation of a CubeSat. Additional valid decomposition can lower strict precision and should be inspected rather than silently added to the evaluation-reference list. Unmatched units and missing values are failures, not zeros. The selected structured model includes only the 3.3 V supply used by its modeled loads; the other documented rails remain outside this operating-point graph.

Impact metrics expose their numerator and denominator: expected dependency and requirement coverage; expected criticals among emitted criticals; correct values among the three expected calculations; auditable claims among active impacts and calculations. Unsupported-claim checks detect unexpected criticals, wrong expected arithmetic, invalid paths/references, changed source fragments and certain withheld event-specific assertions. They are bounded automated checks, not a complete semantic fact checker. Empty critical sets produce `null` precision; unexpected or missing criticals also fail explicit case assertions.

[Benchmark tests](../server/quetzal-benchmark.test.mjs) include negative controls that corrupt an input fact, calculated result, critical status, source reference and source fragment. They also verify that artifact preparation and the actual generation prompt exclude holdout canaries/outcomes, and that runtime sources do not import evaluation reference. An evaluator unit-test double is clearly marked and is not reported as real extraction performance.

The V0.1 evaluator additionally tests the boundary cases, independent arithmetic, unit normalization, Portuguese terminology, prefixed requirement IDs, manifest unknowns, directed relation errors and hypotheses falsely marked as documented. A literal quote of a hypothesis can have complete provenance while still failing source-classification accuracy.

## Development freeze and observed limitations

`v0.1-development.1` was frozen at **2026-09-08T00:57:54.660975Z**, before the next extraction series. [freeze.json](../benchmark/quetzal1/evaluation_reference/freeze.json) records the context, reference, arithmetic, scoring and specification hashes. This is a development freeze, not an independently approved engineering release. Changes to aliases, expectations, tolerances or scoring require a new revision before subsequent model runs.

The earlier A evaluation used English-only name matching and exact requirement IDs. It incorrectly penalized Portuguese labels and IDs such as `req-mi-003`. Its original report remains untouched at `var/benchmarks/quetzal-1788828127859-034197bb-08dd-48d4-9050-cba776e31828.json`. V0.1 records this evaluator defect and provides general locale/prefix normalization. The old prediction was reassessed only as a diagnostic, not fresh benchmark performance, in `quetzal-1788829113825-d260d7af-e0be-4f6d-80b0-1231c59fce46.json`.

That diagnostic still fails for engineering reasons: the spacecraft root is absent; EPS is typed as a system; three battery properties are missing; five `derived_from` relations are reversed; a battery/controller relation changes meaning; three requirements miss the defined energy-balance trace. A conditional energy relationship is also incorrectly asserted as documented. All five requirement statements match after language normalization. Correcting the evaluator did not erase these failures.

The deterministic V0.1 run at `var/benchmarks/quetzal-1788829113681-07ecb83c-bcc2-4f9d-b2c2-34d6f2eaab48.json` passed its five executed cases; A0 remained unmeasured. These passes establish the implemented checks under frozen design assumptions, not complete spacecraft verification.

A separate contamination probe used `gemini-3.5-flash-lite`, temperature `0.1`, four neutral questions, no Project Memory and no retrieval. The recorded response matched **zero** selected withheld facts and disclaimed relevant recollection; elapsed time was approximately 15.35 s. Its private report is `var/benchmarks/quetzal-probe-1788828673251-f8473e04-bb2a-4c51-92a7-8b7cf120528e.json`. This single probe is metadata, not a score and not proof that pretraining contamination is absent.

The masked C2 test is implemented independently in `benchmark/structural/`, with neutral identities, two perturbed parameter sets and independent evaluator arithmetic. Four deterministic cases passed in `var/benchmarks/structural-1788829341514-257eec1e-786c-4798-a69f-71a342fc5982.json`. It invokes no provider and does not measure LLM generalization; masking itself does not prove absence of memorization. Reproduce these separate experiments with:

```sh
node scripts/benchmark-structural.mjs
node --env-file-if-exists=.env.local scripts/probe-quetzal-contamination.mjs
node --env-file-if-exists=.env.local scripts/extract-quetzal.mjs --runs 3 --language pt --output-dir var/benchmarks/new-series --evaluation-revision v0.1-development.1
```

Only the last two commands use the configured Gemini service. The extraction runner preserves each sanitized request, public response, validation result, metadata and accepted prediction; it never reads the evaluator references or silently retries a failed attempt. The evaluator is subsequently invoked with each saved prediction and corresponding metadata. Unaccepted attempts remain failures in the series denominator.

## Repeated extraction series

The first fresh frozen series, `var/benchmarks/quetzal-frozen-n3-20260908/`, attempted exactly three requests with `gemini-3.5-flash-lite` at temperature `0.1`. Its complete accounting is in `evaluation-summary.json` alongside the original extraction `manifest.json`.

| Attempt | Validation | A0 frozen-reference result | Time |
| --- | --- | --- | ---: |
| 1 | Accepted model: 18 entities, 22 relations, 5 requirements | Fail: properties 20/23, unit coverage 15/18, directed relations 19/20, requirements 4/5; entity matching/kinds 18/18 and provenance 69/69 | 19.039 s |
| 2 | Rejected with `SYSTEM_EVIDENCE_INVALID` | Failed before an accepted model; semantic metrics unavailable | 33.141 s |
| 3 | Provider request timed out / unavailable | Failed before an accepted model; semantic metrics unavailable | 55.006 s |

Acceptance was **1/3**; no attempt passed all A0 reference assertions. The single accepted model produced the expected 10% and 100% arithmetic in its separately recorded `impacts.json`. This does not establish repeatability across model runs: only one accepted output was scorable. The summary reports conditional means with sample variance `null` for that one output, alongside all attempted-run failures; unavailable results are not assigned perfect scores.

Qualitative inspection adds context to the frozen scores. The accepted model omitted battery cell-count/capacity and assigned 3.7 V to `minimum_voltage` instead of `nominal_voltage`. Its inferred battery-to-controller `powers` shortcut differs from the reference's `affects` relation and merits representation review; it is not automatically proof of a physically false relationship. The analysis criterion has the correct threshold and source but omits the explicit word “Norte” required by the frozen meaning check. Those scoring limitations are retained rather than changed after seeing this output.

Hierarchy is another known A0 limitation: the frozen relation metric excludes `contains` and does not score the union of `parentId` and containment links. Perfect entity/kind scores therefore do not prove correct hierarchy. Inspection found reversed containment in the accepted output. These qualitative findings must accompany the quantitative scores.

A provider-schema/validator mismatch was identified in the rejected second request: the requested evidence schema permitted an evidence kind that the service correctly refused. The second series, `var/benchmarks/quetzal-frozen-n3-schema2-20260908/`, used the corrected request schema under the unchanged frozen scoring reference. The service's evidence validation was not relaxed. Its original manifest records the request configuration and response-schema hash separately from the first series.

| Attempt | Outcome | A0 result | Time |
| --- | --- | --- | ---: |
| 1 | Provider HTTP 503 / `SYSTEM_AI_UNAVAILABLE` | No accepted model; semantic metrics unavailable | 36.101 s |
| 2 | Provider request timed out | No accepted model; semantic metrics unavailable | 55.006 s |
| 3 | Provider request timed out | No accepted model; semantic metrics unavailable | 55.002 s |

Both series are retained in `var/benchmarks/quetzal-frozen-series-evaluation-summary.json`: **six attempts, one historically accepted model, zero complete A0 passes**, one evidence-validation failure and four provider failures. The two request contracts differ, so this combined accounting is not an identically configured pooled experiment. No failed attempt is replaced by a successful retry, and missing semantic metrics remain unavailable.

After both series finished, the extraction service gained a guard that validates the union of parent IDs and containment links. Offline revalidation of the first series' historically accepted model then failed with `SYSTEM_HIERARCHY_INVALID`: its containment links and parent IDs form a cycle. This revalidation made no provider request and did not modify either original extraction manifest or the frozen scores. The result is retained in `run-1/final-contract-revalidation.json` and the combined summary's `finalContractRevalidation` field.

At that checkpoint, **zero live baselines had been confirmed under the complete validation contract**. The historical 1/6 acceptance figure describes the contracts executed at that time, not approval by the later hierarchy validator. Original reports remain unchanged.

## Subsequent extraction investigation — 8 September 2026

The [product and extraction audit](EXTRACTION_RELIABILITY_AUDIT.md) records the subsequent 50 exploratory physical requests across models, schema ablations, internal languages and staged alternatives. The [acceptance protocol](EXTRACTION_EXPERIMENT_PLAN.md) was registered before a separate fresh final series. No context, evaluator, expectations, tolerances, arithmetic or approved specification hash changed.

The final series in `var/benchmarks/diagnose-final-A2-20260908/` completed five of six provider requests. All five returned valid schema and acyclic hierarchy, but only **1/5 passed the full contract and 0/5 passed complete A0**. Overall usable baselines were 1/6. One HTTP 503 is a provider failure; the completed outputs' missing facts, incorrect relations, incomplete requirement links and evidence rejection are output-quality failures. The registered 80% contract/A0 targets were not reached.

Both real browser runs remain recorded. The first rejected all three outputs. The second rejected its first output, then verified a real accepted baseline, source excerpts, requirements, refresh and re-entry with no regeneration; perceived generation time for the successful interaction was 39.073 seconds. Its independently scored prediction still failed A0 (21/23 properties, 19/20 relations, 4/5 requirements and 1/2 source classifications). That post-hoc browser assessment is not pooled into the final acceptance series. Nine deterministic/structural cases and mocked-provider UI acceptance continue to pass independently.

The owner confirmed the current provider configuration is the only available one after Pro reported quota zero and larger Flash alternatives repeatedly failed. Extraction remains unresolved; independent engineering review, full A0 acceptance and A1 raw ingestion remain pending. Successful live UI behavior does not certify extraction accuracy.

Human review remains a required next validation step: an independent engineer should inspect the curated facts and expectations against the pinned sources, record corrections, source locators, reviewer identity and date, and approve an immutable evaluation-reference revision. Do not use the prediction endpoint to manufacture its own truth. Expert corrections should retain suggested and corrected values, supporting context and artifacts, project type and timestamp; this supports audit/export without automated training.

The technical benchmark precedes a student experiment. Only after credible engineering results should source-only and Norte-assisted tasks compare time, correct and missed impacts, false impacts, lookups and confidence. V1 adds real Payload / ADCS constraints; V2 broadens Quetzal; OreSat later tests reconstruction from fragmented sources. Those are roadmap items, not V0 implemented capabilities.
