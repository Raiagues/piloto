# Quetzal-1 EPS + COMMS validation, V0.1

Research checked on **2026-09-08** before freezing the first benchmark revision.

This document contains evaluator-only information and **must never be ingested as Project Memory or sent to the reasoning model during benchmark execution**.

Quetzal-1 provides a compact real engineering case with released hardware, firmware, telemetry and a detailed retrospective EPS publication. Universidad del Valle de Guatemala identifies it as a 1U CubeSat that completed 211 days of operations. It belongs to the UVG / UNOOSA / JAXA KiboCUBE context and has no relationship to OBSAT requirements.

V0 intentionally isolates electrical reasoning around:

* energy harvesting
* battery storage
* main power bus
* regulated rails
* battery heater
* OBC electrical demand
* communications electrical demand
* residual system loads
* power budget
* orbital-average energy balance
* selected EPS requirements

Approximately 10–20 meaningful engineering entities are sufficient for V0.

Payload and ADCS are not expanded into full engineering models. Their relevant electrical contributions may remain explicitly attributed residual loads when supported by the source material.

**Review status: agent-curated; independent human engineering review pending.**

Source inspection, automated consistency checks and model evaluation are not substitutes for independent engineering review.

Until that review is completed, benchmark answers should be called **evaluation references**, not certified ground truth.

---

## 1. Benchmark objective

V0 is designed to answer one narrow question:

> Given correct engineering facts about a real physical system, can Norte represent the relevant dependencies and reason correctly about the consequences of a proposed change?

V0 is **not** intended to prove that Norte can already:

* ingest arbitrary engineering repositories reliably
* understand arbitrary PDFs, CAD or spreadsheets
* simulate the complete Quetzal-1 spacecraft
* predict every physical effect
* perform validated spacecraft power analysis
* replace engineering verification
* independently predict an unseen historical failure

The benchmark deliberately isolates reasoning from document-ingestion complexity.

The intended progression is:

```text
V0
clean engineering facts → physical reasoning

↓

V1
cross-subsystem reasoning

↓

V2
raw and fragmented engineering artifacts → structured system

↓

V3
larger architecture and requirements traceability

↓

V4
human engineering usefulness
```

A failed experiment should make it possible to determine what failed.

---

# 2. Source inventory and redistribution

All repository links used as benchmark sources should remain pinned to a specific revision.

Two source roles are used:

`MODEL CONTEXT`

Information that Norte is allowed to receive during benchmark inference.

`EVALUATION REFERENCE`

Information available only to the evaluator after inference has completed.

A source being publicly accessible does not automatically mean its entire contents may be redistributed.

No third-party publication should be copied into the repository unless its license explicitly permits that use.

## Q-UVG — Quetzal-1 mission page

Publisher:

Universidad del Valle de Guatemala.

Source:

https://www.uvg.edu.gt/cubesat/

Use:

Mission identity and general design-program metadata may be used as MODEL CONTEXT.

Operational results and post-flight mission outcomes should remain EVALUATION REFERENCE when used to assess causal reconstruction.

The page reports that Quetzal-1 launched aboard the SpaceX CRS-20 mission on **2020-03-06 at 22:49 GMT−6**, corresponding to approximately **2020-03-07T04:49:00Z**.

The page also reports more than 80,000 telemetry packets over 211 days of operation.

Redistribution:

No explicit page redistribution license was identified.

Store citations and factual curation only.

Do not copy page images or complete page contents into the repository.

---

## Q-HW — Quetzal-1 Hardware / EPS

Repository:

https://github.com/Quetzal-1-CubeSat-Team/quetzal1-hardware

Pinned revision:

`d4d1b59de384701a016a6e17353aff3c8ba64853`

Use:

MODEL CONTEXT.

Relevant information includes:

* EPS architecture
* subsystem organization
* component families
* electrical schematics
* board organization
* BOM references
* solar-panel design files

License:

At the pinned benchmark revision, the team-authored hardware repository contains a CC BY-SA 4.0 license.

Preserve attribution to:

**Quetzal-1 CubeSat Team and Universidad del Valle de Guatemala**

and retain source URL, revision and modification information where adapted material is stored.

V0 should prefer pointers and independently structured engineering facts over reproducing repository diagrams.

---

## Q-SCH — EPS schematic PT-MIS-PCB-002_v1

Source:

https://github.com/Quetzal-1-CubeSat-Team/quetzal1-hardware/blob/d4d1b59de384701a016a6e17353aff3c8ba64853/EPS/output/eps/Schematic/PT-MIS-PCB-002_v1%20Schematic.pdf

Use:

MODEL CONTEXT.

Relevant sheets include approximately:

* energy harvesting
* energy storage
* regulation
* switching
* EPS microcontroller

Important historical caveat:

The schematic revision table contains a **2019-06-12** internal revision date.

This must **not** be interpreted as evidence that the current public PDF existed before flight.

The public Git history shows that the hardware repository began in 2022 and that revision-history information for 2019 was added retrospectively during an October 2022 schematic update.

The PDF was also regenerated after post-flight material, including a block diagram associated with the later EPS publication, was added.

Therefore:

> The schematic contains historical design information, but no byte-identical public pre-flight snapshot of the current file has been established.

Do not describe it simply as a publicly available 2019 artifact.

---

## Q-EPS-D — EPS design publication

Title:

**Design and On-Orbit Performance of the Electrical Power System for the Quetzal-1 CubeSat**

Authors:

Aguilar-Nadalini et al.

Journal:

Journal of Small Satellites, Vol. 12 No. 2, pp. 1201–1229.

Publication date:

2023-05-31.

Source:

https://jossonline.com/storage/2023/05/Final-Aguilar-Nadalini-Design-and-On-Orbit-Performance-of-the-Electrical-Power-System-for-the-Quetzal-1-CubeSat.pdf

MODEL CONTEXT may use only explicitly allowlisted design information from:

* Section 2
* selected design values from Table 2
* selected requirements from Appendix D

The paper is a **retrospective design description published after the mission**.

It must not be described as a pre-flight public document.

Copyright:

The publication identifies A. Deepak Publishing and states that all rights are reserved.

Public readability does not imply redistribution rights.

Do not bundle:

* the complete PDF
* screenshots
* reproduced tables
* publication figures

Store:

* citation
* page / section locators
* independently normalized factual values
* short necessary excerpts where legally appropriate

---

## Q-EPS-F — EPS flight-results material

Same publication as Q-EPS-D.

Use:

**EVALUATION REFERENCE ONLY.**

Relevant material includes:

* Section 3
* Section 3.5.1
* on-orbit power tables
* conclusions
* documented failure behavior

This material must never enter the model context for a historical causal-reconstruction benchmark.

Do not give Gemini the complete EPS publication during benchmark inference.

This is particularly important because design information and flight-result information occur in the same publication.

Page-level filtering alone is not necessarily sufficient to prevent leakage.

---

## Q-SW — Quetzal-1 Flight Software / EPS

Repository:

https://github.com/Quetzal-1-CubeSat-Team/quetzal1-flight-software

Pinned revision:

`dbfb67a2c8a7336f765e320d37a8a02e3ab4c212`

Use:

Optional MODEL CONTEXT cross-check.

Useful information includes:

* OBC / EPS communication
* EPS monitoring architecture
* FPB protection behavior
* sensor network
* current limits implemented in software

A particularly useful distinction for the benchmark is:

```text
COMMS software overcurrent threshold
≈ 1 A
```

This is a software protection threshold.

It is not automatically equivalent to:

* regulator current capability
* FPB hardware current limit
* transceiver TX current

These concepts must remain distinct.

### License note

License status should always be described relative to the pinned benchmark revision.

The repository's original public commit in 2021 contained an MIT license.

At the pinned benchmark revision, the repository root license is GPLv3, while bundled third-party libraries may use other licenses.

Do not describe the entire historical repository tree as having one uniform license.

No source code needs to be copied into the Norte benchmark.

---

## Q-TLM — Quetzal-1 Telemetry

Repository:

https://github.com/Quetzal-1-CubeSat-Team/quetzal1-telemetry

Pinned revision:

`86b512f52cad6cba850f63cd46f4dbb03ded93c3`

Relevant files include:

```text
telemetry/telemetry.xlsx
telemetry/variable_description.xlsx
```

The telemetry workbook is approximately 47 MB.

Use:

EVALUATION REFERENCE.

Telemetry should later provide an independent second layer of verification beyond the retrospective paper.

V0.1 does not yet claim that the raw telemetry time series has been independently analyzed.

License:

CC BY-SA 4.0 at the pinned revision.

Do not bundle the large workbook unless there is a clear need and licensing / attribution handling is correct.

---

# 3. Historical cutoff and contamination limits

The historical cutoff used for provenance analysis is:

```text
2020-03-07T04:49:00Z
```

This corresponds approximately to the Quetzal-1 launch time reported by UVG:

```text
2020-03-06
22:49
GMT−6
```

The exact cutoff is primarily documentary because no clean public pre-flight snapshot was established for the main Quetzal engineering repositories.

Public repository history inspected:

```text
Hardware
first public commit:
2022-07-31

Flight software
first public commit:
2021-05-02

Telemetry
first public commit:
2022-10-23
```

Therefore V0 must **not** be described as a blind historical prediction using a public pre-flight corpus.

The correct description is:

> retrospective engineering reasoning and historical causal reconstruction using carefully separated design context and post-flight evaluation references.

---

# 4. Two different contamination risks

Two different forms of leakage must be handled separately.

## Runtime leakage

Runtime leakage occurs if evaluator-only information accidentally enters the prompt.

Examples:

* flight outcomes
* expected affected paths
* benchmark expected values
* evaluator commentary
* post-flight telemetry
* the benchmark document itself

Runtime leakage must be prevented technically.

## Pretraining contamination

Quetzal-1 information has been public for years.

A current foundation model may already have encountered:

* the EPS paper
* GitHub repositories
* descriptions of the TX hang anomaly
* Quetzal-specific component names

This cannot be eliminated simply by hiding flight results from the current prompt.

Therefore Quetzal historical reconstruction is evidence of engineering reasoning consistency, but it is **not by itself evidence that the model independently predicted a previously unseen event**.

The benchmark report must disclose this limitation.

---

# 5. Benchmark storage layout

Until independent engineering review is complete, use:

```text
benchmark/
  quetzal1/
    context/
    evaluation_reference/
    reports/
```

Do not call the evaluator directory `ground_truth` yet.

After independent review, an immutable reviewed revision may be frozen, for example:

```text
benchmark/
  quetzal1/
    ground_truth/
      v1/
```

The reviewed version should include:

* reviewer
* review date
* benchmark revision
* corrections
* source locators
* approval state

---

# 6. Context isolation

The inference model may receive only explicitly allowlisted data from:

```text
benchmark/quetzal1/context/
```

It must not receive:

```text
evaluation_reference/
reports/
this document
historical observations
expected calculations
expected affected paths
reviewer notes
```

Context URLs must **not** trigger automatic external retrieval during benchmark execution.

No browsing or unrestricted web fetching should be enabled during benchmark inference.

The test should evaluate the provided engineering context, not internet search ability.

---

# 7. Leakage canary

Add a unique random canary string to evaluator-only data.

Example concept:

```text
NORTE_EVAL_CANARY_<random-value>
```

The string must never exist inside model context.

Automated benchmark tests should assert that:

* the serialized model input does not contain the canary
* the Project Memory representation does not contain it
* no evaluator file has been accidentally loaded into inference context

This provides a simple defense against accidental benchmark leakage.

---

# 8. Design fact locators

The following values are engineering inputs.

They are not expected impact answers.

Normalize units before arithmetic.

Duty-cycle percentages must become fractions internally.

## Communications loads

```text
AX100 RX power
0.231 W

AX100 TX power
2.640 W

Nominal TX duty
3.60%
```

Source:

Q-EPS-D, Section 2.4 / Table 2.

---

## OBC

```text
OBC power
0.264 W

Duty
100%
```

---

## EPS electronics

```text
EPS electronics
0.020 W

Duty
100%
```

---

## Battery heater

```text
Heater power
0.908 W

Design duty considered in Table 2
0% or approximately 33.33%
```

---

## Residual ADCS contribution

```text
ADCS electronics
0.066 W

Duty
2.50%
```

In V0 the ADCS architecture is not expanded.

This contribution may remain an explicitly attributed residual load.

---

## Budget allowance

```text
Allowance factor
1.1
```

Treat this as a 10% budget allowance applied once.

Do not divide by 0.9.

Do not apply the allowance multiple times.

---

## Energy generation

```text
Estimated sunlight generation
2.37 W

Design orbital-average generation
1.58 W
```

The 1.58 W design estimate represents the simplified average-generation assumption used in Class B.

It is not a constant measured on-orbit generation value.

---

## Battery

```text
2 × Li-ion cells

3.7 V nominal per parallel pack

2000 mAh each

parallel configuration

nominal combined capacity
4000 mAh
```

The calculation:

```text
3.7 V × 4 Ah = 14.8 Wh
```

is only nominal stored energy.

It does not establish:

* usable energy
* initial state of charge
* discharge efficiency
* exact depletion time

Do not use it to predict precise battery-depletion duration.

---

## Electrical buses

```text
Main bus
3.2–4.2 V

Regulated rails
3.3 V
5 V
7.6 V
```

OBC and AX100 operate on the 3.3 V rail according to the selected design sources.

---

## Battery heater logic

```text
heater ON
battery temperature < 3°C

heater OFF
battery temperature > 5°C
```

The heater is commanded through the OBC in the documented design.

---

# 9. Protection limits must remain distinct

Do not collapse multiple current constraints into one value.

Relevant concepts include:

```text
AX100 TX operating current

COMMS software overcurrent threshold

FPB hardware protection limit

3.3 V regulator capability

battery maximum discharge capability
```

They represent different engineering constraints.

For example, the flight software documents an approximately:

```text
1 A COMMS software overcurrent threshold
```

That is not automatically the same as the hardware switch limit.

Reasoning must preserve the distinction.

---

# 10. Selected formal requirements

Use the original UVG requirement identifiers.

## MI-003

The energy harvesting system must provide power surplus to the batteries to allow them to recharge after operations in umbra.

## MI-004

The batteries, along with the energy harvesting system, must be able to meet the satellite's power demand during each phase of flight.

Do not rewrite these requirements into simpler statements and then claim that the rewritten condition proves compliance.

For example:

```text
average orbital generation > average orbital consumption
```

does not by itself prove MI-003.

It also does not fully prove MI-004.

It provides relevant analysis evidence.

The requirement status should therefore distinguish:

```text
PASS
FAIL
AFFECTED
REVIEW
INSUFFICIENT EVIDENCE
```

where appropriate.

A positive orbital-average margin may support the requirement without establishing full verification.

---

# 11. Evaluation-reference calculations

The calculations below are evaluator-only.

They must not enter inference context.

For the Class B base assumptions:

```text
payload inactive

heater duty h = 0.3333

generation G = 1.58 W
```

Residual EPS + ADCS load:

```text
0.020 + 0.066 × 0.025

= 0.02165 W
```

Keep EPS and ADCS as separate provenance inputs even when their values are mathematically aggregated.

Define:

```text
d = TX duty as a fraction

Pcomms(d)
= 0.231 × (1 − d)
+ 2.640 × d
```

Other loads:

```text
Pother(h)
= 0.264
+ 0.020
+ 0.908 × h
+ 0.066 × 0.025
```

Budgeted total:

```text
Ptotal(d,h)
= 1.1 × [Pcomms(d) + Pother(h)]
```

Orbital-average margin:

```text
M(d,h)
= 1.58 − Ptotal(d,h)
```

Do not round intermediate values.

Expected calculations must be independently implemented in evaluator code.

Do not import production reasoning functions to create the expected answer.

---

# 12. Class B baseline calculations

With:

```text
h = 0.3333
```

the expected values are:

| TX duty | COMMS raw W | Total budget W | Orbital margin W |
| ------- | ----------: | -------------: | ---------------: |
| 3.6%    |    0.317724 |     0.99661144 |      +0.58338856 |
| 10%     |    0.471900 |     1.16620504 |      +0.41379496 |
| 100%    |    2.640000 |     3.55111504 |      −1.97111504 |

Changing TX duty:

```text
3.6% → 10%
```

raises budgeted demand by:

```text
0.1695936 W
```

but leaves the simplified orbital-average power balance positive.

Therefore:

> A `critical` average-energy deficit at 10% TX duty is a false positive under these frozen assumptions.

The system may still correctly mark requirements or battery behavior for review because:

* phase-specific behavior is not modeled
* eclipse energy is not modeled
* charging dynamics are not modeled
* peak conditions are not fully analyzed

---

# 13. Duty-cycle change must not create a fake peak-current conflict

Increasing TX duty cycle means the transmitter spends more time in its TX operating state.

It does not automatically increase TX peak current.

Using the design values:

```text
2.640 W / 3.3 V
≈ 0.8 A
```

The same TX state occurs for longer.

Therefore a scenario such as:

```text
TX duty
3.6% → 10%
```

must not automatically produce:

```text
regulator overcurrent
```

solely because duty cycle increased.

If Norte does so without another supporting constraint, score it as unsupported reasoning.

---

# 14. Decision-boundary cases

Add explicit cases around the simplified power-balance boundary.

Under the frozen Class B assumptions, orbital-average break-even occurs at approximately:

```text
TX duty
25.615493%
```

approximately:

```text
25.62%
```

Useful benchmark cases:

## B-boundary-1

```text
TX duty
25.0%
```

Expected:

```text
COMMS raw
0.83325 W

Total budget
1.56369004 W

Margin
+0.01630996 W
```

Result:

```text
average balance remains positive
```

Do not classify the average-energy balance as critical.

---

## B-boundary-2

```text
TX duty
26.0%
```

Expected:

```text
COMMS raw
0.85734 W

Total budget
1.59018904 W

Margin
−0.01018904 W
```

Result:

```text
average balance becomes negative
```

A critical or failing power-balance status is justified under the frozen assumptions.

These boundary cases are important because they distinguish actual quantitative reasoning from simplistic heuristics such as:

```text
more TX = critical
```

---

# 15. Historical causal-reconstruction reference

The historical TX-hang event remains evaluator-only.

The retrospective EPS publication reports:

```text
24 recorded continuous-TX failures

AX100 continuous-TX current
≈ 775.76 mA

AX100 continuous-TX power
≈ 2.56 W

total satellite demand
≈ 3.13 W

solar generation
≈ 1.32 W

power margin
≈ −1.81 W

battery depletion in severe cases
approximately 6 hours

watchdog cycle
24 h → 2 h
```

Five of the 24 events discharged the battery by more than 80%.

Four caused external resets.

The fourth of those resets was deliberately induced by temporarily restoring the 24-hour watchdog period and waiting for a TX-hang-induced depletion so that an external reset could recover the spacecraft from an I²C bus hang.

The 24th TX-hang event occurred in a more complicated spacecraft state involving a second I²C bus hang, payload remaining powered and prolonged lack of heater operation.

After this event the spacecraft did not communicate again.

The authors state that the causes of the TX-hang failures themselves remained undetermined.

They also hypothesize that battery degradation associated with freezing, together with the unusually high current draw of the final TX-hang event, contributed to the spacecraft end of life.

Therefore the benchmark must not treat the initiating TX-hang mechanism or final battery-failure mechanism as fully known causal ground truth.

---

# 16. Class C1 — real historical causal reconstruction

Input to Norte:

* allowlisted design architecture
* allowlisted design properties
* relevant requirements
* condition:

```text
communications transmitter remains continuously active
```

Do not provide:

* 3.13 W observed total
* 1.32 W observed generation
* −1.81 W observed margin
* six-hour depletion
* reset observations
* number of historical failures
* final mission outcome

Expected reasoning should cover concepts such as:

```text
continuous TX
    ↓
communications energy demand increases
    ↓
total electrical demand increases
    ↓
energy balance may become negative
    ↓
battery discharge risk increases
    ↓
continuity of OBC / system power becomes at risk
    ↓
relevant EPS requirements are affected
```

The model is not required to reproduce exact on-orbit wattage.

The design model and flight environment are different.

Do not calibrate design inputs using observed flight outcomes and then describe the result as an independent reconstruction.

Do not require Norte to identify the unknown initiating fault.

Do not require it to predict an exact six-hour depletion duration.

Do not require it to state that a reset will certainly occur.

---

# 17. Historical benchmark claim

Class C1 should be described publicly as:

> historical causal reconstruction

not:

> historical prediction

The correct claim is approximately:

> Given a curated representation of the Quetzal-1 design and a continuous-transmission condition, Norte's predicted dependency path can be compared against effects documented during the real mission.

This is useful evidence.

It is not equivalent to demonstrating that the underlying foundation model had never encountered the historical result.

---

# 18. Pretraining-contamination probe

Before interpreting C1 results, run a fixed contamination probe against the same foundation model without Quetzal Project Memory.

For example, ask several neutral factual questions about:

```text
Quetzal-1 EPS

AX100 failures

on-orbit communications anomalies

battery depletion behavior
```

Record whether the model already recalls specific evaluator-only facts.

Examples of high contamination signals:

```text
24 TX hangs

3.13 W

−1.81 W

six-hour depletion

watchdog 24 h → 2 h
```

Do not use this probe as part of the benchmark score.

Use it as metadata describing how interpretable the historical reconstruction result is.

Store:

```text
model
date
prompt
response
known evaluator facts recalled
```

---

# 19. Class C2 — masked structural causal test

Create a second test that removes Quetzal-specific identity cues.

Do not simply rename one string.

Create a structurally equivalent synthetic engineering case based on the same class of physical reasoning.

For example:

```text
Quetzal-1
→ System K

AX100
→ Transceiver C4

specific component names
→ neutral component identities
```

Perturb engineering values while keeping them physically consistent.

Expected values must be independently recalculated.

The model should receive:

* system structure
* engineering relationships
* numeric properties
* requirements
* hypothetical failure condition

It should not receive:

* Quetzal identity
* historical mission name
* real component model names
* original historical numbers
* known historical outcome

This test helps distinguish:

```text
recognition / memorization
```

from:

```text
generalization of the engineering dependency pattern
```

Do not claim that masking completely eliminates pretraining contamination.

It simply reduces direct mission recognition.

---

# 20. Class A0 — curated context → engineering model

Rename the current extraction benchmark.

Do not call it raw document extraction.

V0 gives Norte curated engineering source text and normalized source metadata.

Therefore the correct test is:

> Can Norte transform a curated engineering context pack into a faithful structured system model?

Measure:

* entity precision
* entity recall
* property accuracy
* unit accuracy
* relation precision
* relation recall
* requirement extraction accuracy
* provenance coverage

Expected entities and relations must be manually curated independently from the production prediction endpoint.

---

# 21. Class A1 — raw artifact → engineering model

A1 is future work.

A1 will test the actual ingestion problem using less curated inputs such as:

* PDFs
* schematics
* BOMs
* repository files
* spreadsheets
* manufacturer datasheets

Do not mix A1 results with A0.

This separation matters.

If A1 fails while A0 succeeds, document ingestion is likely the limiting factor.

If A0 itself fails, the problem is system representation or reasoning.

---

# 22. Class B — deterministic counterfactual reasoning

Class B tests controlled engineering changes whose results can be independently calculated.

Core cases include:

```text
3.6% → 10% TX duty

3.6% → 25% TX duty

3.6% → 26% TX duty

3.6% → 100% TX duty
```

The production engine should:

1. identify affected dependencies
2. propagate the change
3. perform generic calculations
4. classify consequences
5. show provenance

The evaluator independently computes expected numeric results.

Useful metrics include:

* calculation error
* dependency recall
* requirement-impact recall
* false-critical count
* unsupported-claim rate
* evidence coverage

---

# 23. Requirement evaluation must remain calibrated

Requirements should not be reduced to binary PASS / FAIL whenever the benchmark analyzes only part of their meaning.

For example:

```text
MI-004
```

requires demand to be met during every flight phase.

A simplified orbital-average calculation cannot prove this completely.

A useful Norte result for the 10% TX case may therefore be:

```text
MI-004

AFFECTED / REVIEW

Average orbital power remains positive.

This calculation does not verify
all flight phases or peak conditions.
```

This behavior should score better than an unjustified `PASS`.

Calibrated uncertainty is part of engineering reasoning quality.

---

# 24. Impact-path scoring

Do not score every graph-reachable node as a valid impact.

A valid highlighted path must be supported by:

* explicit engineering relation
* deterministic dependency
* bounded, labeled AI inference

Preserve relation direction.

Examples:

```text
load
→ contributes_to
→ power budget
```

is not equivalent to arbitrary reverse causation.

Use semantic aliases where necessary for evaluation, but freeze those aliases before examining model outputs.

Do not modify aliases afterward simply to improve benchmark score.

---

# 25. Unsupported claims

Track unsupported conclusions explicitly.

Examples include:

* claiming an overcurrent without a relevant current limit
* claiming a thermal failure without a thermal model
* claiming an exact depletion time from nominal battery capacity
* claiming a requirement passes when only partial evidence exists
* inventing a relationship not supported by the system model or clearly marked inference

Prefer:

```text
REVIEW

INSUFFICIENT EVIDENCE

UNKNOWN
```

to fabricated certainty.

---

# 26. Evaluation metrics

Report metrics per case.

Do not optimize one aggregate score.

Recommended initial metrics:

```text
entity precision

entity recall

relation precision

relation recall

property / unit accuracy

dependency recall

critical-impact precision

requirement-impact recall

calculation error

unsupported-claim rate

traceability coverage

uncertainty handling
```

For zero-denominator metrics, report:

```text
not applicable
```

with raw counts.

Do not report a misleading perfect score.

---

# 27. Benchmark runner

Use a simple reproducible entry point.

For example:

```bash
npm run benchmark:quetzal
```

The runner should preserve per case:

```text
benchmark revision

input context

scenario / change

expected entities

predicted entities

expected impacts

predicted impacts

expected calculations

predicted calculations

numeric error

evidence references

unsupported claims

requirement effects

status classifications
```

Do not output only:

```text
PASS
```

or one overall score.

Failures must remain inspectable.

---

# 28. Run manifest

Every benchmark execution should record a manifest.

At minimum:

```text
benchmark name

benchmark revision

Norte git SHA

engineering model schema version

impact-engine version

prompt version

prompt hash if practical

model provider

exact model identifier

generation parameters

temperature

top_p where applicable

timestamp

context hash

evaluation-reference revision
```

If randomness exists, record all controllable parameters.

If the provider exposes no deterministic seed, note that explicitly.

---

# 29. Repeated model runs

LLM-assisted reasoning may be nondeterministic.

For AI-dependent benchmark cases, consider multiple runs.

For example:

```text
n = 3
```

or another small fixed number.

Report:

* per-run output
* mean metric when meaningful
* variance / consistency
* whether critical conclusions changed between runs

Deterministic calculations should not vary.

If the numeric engine produces different answers between identical executions, treat that as a software defect.

---

# 30. Independent evaluator implementation

Expected numeric values must not be generated by the same production function being tested.

For example, do not do:

```text
production impact engine
→ calculate expected result
→ compare production impact engine
```

Implement evaluator arithmetic independently.

Keep it small and auditable.

This prevents a shared implementation bug from creating a false passing benchmark.

---

# 31. Freeze the evaluator before looking at final scores

Before reporting benchmark performance publicly:

1. freeze benchmark inputs
2. freeze expected values
3. freeze aliases
4. freeze scoring rules
5. freeze tolerances
6. freeze benchmark revision

Do not repeatedly modify expected answers after observing model outputs unless a documented review finds an actual benchmark error.

Any correction should create a new benchmark revision.

---

# 32. Human engineering review

Independent engineering review remains required.

A reviewer should inspect:

* curated design facts
* units
* requirement wording
* expected calculations
* expected dependency paths
* source locators
* classification rules
* acceptable uncertainty

Record:

```text
reviewer identity

engineering background

review date

benchmark revision

corrections

comments

approval status
```

After approval, freeze an immutable evaluator revision.

Do not ask the same prediction endpoint to manufacture the truth against which it is evaluated.

---

# 33. Telemetry verification

The retrospective EPS publication is sufficient for V0.1 historical reference.

However, a stronger future benchmark should independently inspect the released telemetry dataset.

Objectives may include validating:

* battery depletion events
* power trends
* thermal changes
* recovery behavior
* relevant temporal signatures

Do not claim the telemetry independently validates the benchmark until that analysis has actually been performed.

---

# 34. Student experiment comes after technical validation

Technical validation asks:

> Is Norte's reasoning correct?

Human validation asks:

> Does that reasoning help someone perform engineering work better?

Do not mix them.

Only after the technical benchmark is credible should students receive controlled engineering tasks.

Possible experimental comparison:

```text
Group A
source documents only

Group B
same source documents + Norte
```

Measure:

* time to complete analysis
* correct impacts identified
* important impacts missed
* false impacts
* source lookups
* decision confidence
* ability to explain why an impact exists

Student satisfaction alone is not sufficient evidence.

---

# 35. V1

After V0 is stable, expand Quetzal into a small cross-domain benchmark.

Possible scope:

* payload
* ADCS
* payload actuator
* electrical constraints
* torque relationships
* mass effects
* attitude implications

Use real source-supported values.

If testing a component replacement, use a real candidate component with a reviewed manufacturer datasheet.

Do not invent convenient specifications.

---

# 36. V2

After cross-domain reasoning works, increase ingestion difficulty.

Quetzal may be expanded to additional artifacts.

OreSat is a strong later benchmark because engineering information is spread across multiple open repositories and subsystems.

That makes it useful for testing:

> Can Norte reconstruct one engineering system from fragmented technical sources?

Do not introduce this complexity before V0 reasoning is understood.

---

# 37. FireSat

FireSat remains useful later.

Treat it as a systems-engineering / MBSE benchmark rather than real-flight validation.

It can be valuable for:

* requirements traceability
* functional architecture
* system relationships
* trade studies
* larger model navigation
* MBSE-style reasoning

It should not replace Quetzal as the first physical-reasoning benchmark simply because FireSat contains more structured information.

Complexity is not the same as validation quality.

---

# 38. Product integration

The benchmark must exist underneath the normal Norte experience.

Do not expose benchmark machinery in the ordinary UI.

The intended product experience remains:

```text
Project Memory
      ↓
Start conception
      ↓
Norte builds the system automatically
      ↓
System
      ↓
engineering hypothesis
      ↓
visible impact path
      ↓
facts / calculations / inference
      ↓
sources
      ↓
engineer correction
```

The user should not configure the benchmark.

The user should experience Norte as an engineering workspace.

---

# 39. Product principles

The benchmark should reinforce the product principles.

## Do not configure the AI. Show it the work.

Engineering context enters.

The system appears.

A change is proposed.

Its consequences appear.

---

## Generate first, let the engineer correct.

Norte generates a first representation.

Expert corrections must be preserved.

They are valuable data.

---

## Make intelligence visual.

Prefer:

```text
nodes

edges

impact paths

status

calculations

source indicators
```

over long generated responses.

---

## Every conclusion needs observability.

The user should be able to determine whether a conclusion came from:

```text
FACT

CALCULATION

AI INFERENCE
```

---

## Optimize for time-to-value.

The product should reach this moment quickly:

> Norte noticed a consequence I needed to consider.

---

# 40. Final interpretation rules

A successful Quetzal V0.1 result may support a claim such as:

> Norte can reconstruct a structured engineering model from curated design evidence and reason about controlled electrical changes with traceable calculations and dependency paths.

A successful historical Class C1 result may support:

> Norte produced a causal impact path consistent with effects documented during a real CubeSat mission.

It must not automatically be presented as:

> Norte predicted an unseen real spacecraft failure.

That stronger claim would require substantially stronger controls against historical and model-training contamination.

---

# 41. V0.1 acceptance condition

Quetzal V0.1 is ready to freeze only when:

* context and evaluator information are physically separated
* evaluator-only material never enters model prompts
* the leakage canary test passes
* Class A0 is clearly distinguished from raw document ingestion
* deterministic calculations are independently reproduced
* 10% TX does not generate a false average-energy deficit
* 25% and 26% boundary cases fall on the correct side of the power-balance boundary
* duty-cycle changes do not create unsupported peak-current conflicts
* requirement statuses remain calibrated
* historical Class C1 is labeled causal reconstruction, not blind prediction
* contamination-probe results are recorded
* the masked C2 case exists
* source provenance is preserved
* unsupported claims are measured
* benchmark metadata is recorded for every run
* an independent engineer reviews the evaluation reference before public performance claims are made

Until then, results are development evidence rather than a validated engineering benchmark.
