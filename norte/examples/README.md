# Validation examples

The primary application context is **Quetzal-1 EPS + COMMS**. Its source inventory, licenses, design/holdout separation and reproduction instructions are in [VALIDATION_QUETZAL1.md](../docs/VALIDATION_QUETZAL1.md).

## Full application

Start the API and client with `npm run dev` after configuring the server-side Gemini key. A fresh database contains the team and the project with an **empty memory**; import the real documents first:

```bash
NORTE_ALLOW_QUETZAL_SEED=1 node scripts/seed-quetzal-validation.mjs --file var/mission-dev-data.json
```

Then open Quetzal-1, select **Start conception**, inspect System, and use the normal Discovery interaction to express a TX duty change.

The application receives only the imported design documents. It does not receive the benchmark answers, flight observations or a pre-generated architecture. The full on-orbit paper is deliberately not attached because it contains holdout outcomes; `quetzal1/source-manifest.mjs` lists it as `evaluation_reference` so the importer refuses it.

## Browser-only preview

GitHub Pages cannot execute the private extraction service. For local interface development, an explicit preview loads the separately curated design model; this is **not an extraction prediction**.

```bash
VITE_DEMO_MODE=true npm run dev:web
```

Open `http://127.0.0.1:5173/norte/`. To replace old demo state with the new context, run this explicit, backed-up reset in the browser developer console:

```js
const demo = await import('/norte/src/lib/demoApi.ts');
demo.resetDemoValidationData('RESET_VALIDATION_DATA');
location.reload();
```

Then deliberately load the design preview:

```js
await (await import('/norte/src/lib/demoApi.ts'))
  .loadQuetzalValidationExample('LOAD_QUETZAL_VALIDATION');
location.reload();
```

Open the Quetzal project. The preview backs up the previous browser state, attaches only design context and opens System. It refuses other active projects and the full production client. These import paths are local Vite development commands, not deployed Pages URLs.

## Regression fixtures

`quetzal1/source-manifest.mjs` is the real-source inventory; see [the sources and seed guide](../docs/QUETZAL_VALIDATION_SOURCES.md). `engineering-validation.mjs`, `.json` and `.txt` describe the older, deliberately synthetic 15-entity rig used by engine/API regression tests. They test electrical compatibility, mass and autonomy rules independently of Quetzal. They are not seeded into the application and are not flight ground truth.

## Evaluation

```bash
npm run benchmark:quetzal
npm run benchmark:quetzal -- --prediction path/to/model.json
npm run benchmark:structural
npm run test:visual:quetzal
```

The deterministic benchmark and browser test isolate different uncertainties. Only a supplied provider prediction measures A0 (curated-context extraction). A1 raw-artifact extraction remains future work. The masked C2 uses a separate synthetic structure and perturbed values; it measures the generic deterministic engine, not foundation-model generalization. Reference answers remain provisional until independent engineering review under [V0.1](../docs/VALIDATED.md); browser fixture timings do not measure end-user learning or mission accuracy.
