import assert from "node:assert/strict";
import test from "node:test";
import { createCubesatReferenceModel, cubesatMemoryText } from "../examples/cubesat-reference.mjs";
import { validateEngineeringSystem } from "../shared/engineering-schema.mjs";
import { analyzeImpact } from "../shared/impact-engine.mjs";

const model = createCubesatReferenceModel();
const change = (targetEntityId, key, value, unit) => ({
  id: `change-${key}`, targetEntityId, kind: "parameter",
  oldValues: model.entities.find((item) => item.id === targetEntityId).properties.filter((item) => item.key === key),
  newValues: [{ key, name: key, value, unit, source: "user", evidenceRefs: [] }],
  description: `${targetEntityId} ${key} ${value} ${unit}`, createdAt: "2026-01-01T00:00:00.000Z"
});
const status = (analysis, id) => analysis.impacts.find((impact) => impact.entityId === id)?.status;
const explanation = (analysis, id) => analysis.impacts.find((impact) => impact.entityId === id)?.shortExplanation ?? "";

test("the reference architecture satisfies the engineering schema", () => {
  assert.equal(validateEngineeringSystem(model), true);
});

test("every documented quantity is backed by an excerpt in the memory text", () => {
  for (const entity of model.entities) for (const property of entity.properties) {
    for (const ref of property.evidenceRefs) assert.ok(model.evidence.some((item) => item.id === ref), `${entity.id}.${property.key} cites ${ref}`);
  }
  for (const item of model.evidence) assert.ok(cubesatMemoryText.includes(item.excerpt), item.id);
});

test("the baseline violates nothing, so a failure is caused by the hypothesis", () => {
  const analysis = analyzeImpact(model, change("obc", "mass", 70, "g"), "pt");
  assert.deepEqual(analysis.impacts.filter((impact) => impact.status === "critical"), []);
});

test("a heavier camera breaks the payload mass allocation and reaches structure, attitude and thermal", () => {
  const analysis = analyzeImpact(model, change("camera", "mass", 1, "kg"), "pt");
  assert.equal(status(analysis, "payload-mass"), "valid");
  assert.match(explanation(analysis, "payload-mass"), /1000 g \+ 180 g \+ 60 g = 1240 g/u);
  assert.equal(status(analysis, "REQ-M02"), "critical");
  assert.match(explanation(analysis, "REQ-M02"), /1240 g > 700 g/u);
  for (const id of ["chassis", "wheel", "radiator", "eps"]) assert.ok(analysis.impacts.some((impact) => impact.entityId === id && impact.status !== "unaffected"), id);
});

test("a thicker optics barrel breaks the stack height requirement", () => {
  const analysis = analyzeImpact(model, change("optics", "thickness", 76, "mm"), "pt");
  assert.match(explanation(analysis, "stack-height"), /22 mm \+ 76 mm \+ 8 mm = 106 mm/u);
  assert.equal(status(analysis, "REQ-S01"), "critical");
  assert.match(explanation(analysis, "REQ-S01"), /106 mm > 90 mm/u);
});

test("a hungrier camera breaks the power margin and the eclipse autonomy together", () => {
  const analysis = analyzeImpact(model, change("camera", "operating_power", 9, "W"), "pt");
  assert.match(explanation(analysis, "power-budget"), /= 13.812 W/u);
  assert.equal(status(analysis, "REQ-P01"), "critical");
  assert.equal(status(analysis, "REQ-P02"), "critical");
});

test("the reference is never presented as a real mission", () => {
  assert.match(cubesatMemoryText, /Synthetic teaching fixture; not a real mission/u);
  assert.equal(model.name, "Reference 3U CubeSat");
});

test("the attachable memory file is exactly the text the module documents", async () => {
  const { readFile } = await import("node:fs/promises");
  const file = await readFile(new URL("../examples/cubesat-reference.txt", import.meta.url), "utf8");
  assert.equal(file.trimEnd(), cubesatMemoryText);
});
