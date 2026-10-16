import assert from "node:assert/strict";
import test from "node:test";
import { analyzeImpact, normalizeQuantity } from "../shared/impact-engine.mjs";

const property = (key, value, unit, evidence = "facts") => ({ key, name: key, value, ...(unit ? { unit } : {}), source: "documented", evidenceRefs: [evidence] });
const entity = (id, kind, properties) => ({ id, name: id, kind, description: "", properties, source: "documented", evidenceRefs: ["facts"], confidence: 1 });
const relation = (id, from, to, kind = "derived_from") => ({ id, from, to, kind, label: kind, source: "documented", evidenceRefs: ["method"], confidence: 1 });
const formula = (value) => property("formula", value, undefined, "method");
function powerModel() {
  return {
    schemaVersion: 1, id: "synthetic-power-test", name: "Synthetic operating-mode test", generatedAt: "2026-01-01T00:00:00Z", generatedFromRevision: 0,
    entities: [
      entity("emitter", "component", [property("tx_power", 4, "W"), property("rx_power", 0.5, "W"), property("tx_duty_cycle", 20, "%")]),
      entity("mean-load", "calculation", [formula("duty_cycle_power")]),
      entity("fixed-load", "component", [property("operating_power", 0.75, "W")]),
      entity("budget", "calculation", [formula("sum_power"), property("power_margin_multiplier", 1.2, "1")]),
      entity("generator", "component", [property("generated_power", 3.2, "W")]),
      entity("balance", "performance", [formula("energy_balance"), property("analysis_duration", 2, "h")]),
      entity("storage", "component", [property("available_energy", 10, "Wh")]),
      entity("controller", "component", [])
    ],
    relations: [relation("mode-average", "mean-load", "emitter"), relation("load-budget", "mean-load", "budget", "contributes_to"), relation("fixed-budget", "fixed-load", "budget", "contributes_to"), relation("generation-balance", "balance", "generator"), relation("load-balance", "balance", "budget"), relation("balance-storage", "balance", "storage", "affects"), relation("storage-controller", "storage", "controller", "powers")],
    requirements: [
      { id: "analysis-criterion", title: "Nonnegative average balance", statement: "Analysis criterion: nonnegative mean power margin.", subsystemTags: [], reviewTags: [], status: "unreviewed", sourceRefs: ["criterion"], relatedEntityIds: ["balance"], relatedRelationIds: [], properties: [property("minimum_power_margin", 0, "W", "criterion")] },
      { id: "phase-requirement", title: "Meet demand in every operating phase", statement: "Storage and generation must meet every operating phase's demand.", subsystemTags: [], reviewTags: [], status: "unreviewed", sourceRefs: ["criterion"], relatedEntityIds: ["balance", "storage"], relatedRelationIds: [], properties: [] }
    ],
    evidence: [
      { id: "facts", artifactId: "synthetic-context", artifactLabel: "Synthetic mode data", excerpt: "Emitter TX 4 W; RX 0.5 W; TX duty 20%. Fixed load 0.75 W; average generation 3.2 W; design multiplier 1.2; interval 2 h; storage 10 Wh.", kind: "fact" },
      { id: "method", artifactId: "synthetic-context", artifactLabel: "Explicit analysis method", excerpt: "Modes are exclusive TX/RX. The budget sums average loads with the stated design multiplier. Generation and load use the same averaging interval; their difference affects storage and dependent operation.", kind: "fact" },
      { id: "criterion", artifactId: "synthetic-context", artifactLabel: "Explicit analysis criterion", excerpt: "Minimum mean power margin: 0 W. This necessary condition does not verify phase-specific operation.", kind: "user" }
    ],
    artifactSources: [{ artifactId: "synthetic-context", artifactLabel: "Synthetic mode data", status: "parsed" }]
  };
}
const change = (value, unit = "%") => ({ id: "mode-change", targetEntityId: "emitter", kind: "parameter", oldValues: [property("tx_duty_cycle", 20, "%")], newValues: [property("tx_duty_cycle", value, unit)], description: "Change operating duty", createdAt: "2026-01-01T00:00:00Z" });
const impact = (result, id) => result.impacts.find((item) => item.entityId === id);
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} differs from ${expected}`);

test("generic duty, design margin and energy balance recalculate with auditable inputs", () => {
  const model = powerModel();
  const before = JSON.stringify(model);
  const result = analyzeImpact(model, change(50));
  assert.equal(impact(result, "mean-load").calculation.result, 2.25);
  close(impact(result, "budget").calculation.result, 3.6);
  close(impact(result, "balance").calculation.result, -0.4);
  close(result.calculations.find((item) => item.ruleId === "energy_over_interval").result, -0.8);
  assert.equal(impact(result, "analysis-criterion").status, "critical");
  assert.equal(impact(result, "analysis-criterion").calculation.expression, "-0.4 W < 0 W");
  assert.equal(JSON.stringify(model), before);
  for (const calculation of result.calculations) {
    assert.ok(calculation.inputs.every((input) => input.evidenceRefs.length > 0 && input.evidenceRefs.every((ref) => result.evidence.some((item) => item.id === ref))));
    assert.ok(calculation.ruleId);
  }
});
test("increased duty with a positive balance passes only its explicit average criterion", () => {
  const result = analyzeImpact(powerModel(), change(25));
  assert.equal(impact(result, "mean-load").calculation.result, 1.375);
  assert.equal(impact(result, "budget").calculation.result, 2.55);
  close(impact(result, "balance").calculation.result, 0.65);
  assert.equal(impact(result, "analysis-criterion").status, "valid");
  assert.equal(impact(result, "phase-requirement").status, "review");
  assert.equal(result.metrics.critical, 0);
});
test("deficit reaches storage and operation as review without claiming a reset or depletion time", () => {
  const result = analyzeImpact(powerModel(), change(100));
  assert.equal(impact(result, "mean-load").calculation.result, 4);
  for (const id of ["storage", "controller"]) {
    const item = impact(result, id);
    assert.equal(item.status, "review");
    assert.equal(item.reasonCode, "energy_deficit_dependency");
    assert.ok(item.path.includes("balance"));
    assert.ok(item.traversedRelationIds.includes("balance-storage"));
    assert.match(item.shortExplanation, /timing is unknown/u);
  }
  assert.equal(result.calculations.some((item) => /depletion|reset|failure_time/u.test(item.ruleId)), false);
  assert.equal(impact(result, "phase-requirement").status, "review");
});
test("percent and dimensionless fractions give equivalent duty calculations", () => {
  assert.equal(impact(analyzeImpact(powerModel(), change(50)), "mean-load").calculation.result, impact(analyzeImpact(powerModel(), change(0.5, "1")), "mean-load").calculation.result);
  assert.deepEqual(normalizeQuantity(3600, "J"), { value: 1, dimension: "energy", unit: "Wh" });
  assert.equal(normalizeQuantity(101, "%"), null);
});
test("missing, unproven or invalid mode inputs remain review instead of producing fabricated deficits", () => {
  for (const mutate of [
    (model) => { model.entities[0].properties = model.entities[0].properties.filter((item) => item.key !== "rx_power"); },
    (model) => { model.entities[0].properties[0].evidenceRefs = []; },
    (model) => { model.entities[1].properties[0].source = "inferred"; },
    (model) => { model.entities[3].properties[1].evidenceRefs = []; }
  ]) {
    const model = powerModel(); mutate(model);
    const result = analyzeImpact(model, change(100));
    assert.equal(impact(result, "balance").status, "review");
    assert.equal(result.metrics.critical, 0);
  }
  for (const request of [change(150), change(1.1, "1"), change(50, "unknown")]) assert.equal(impact(analyzeImpact(powerModel(), request), "mean-load").status, "review");
});
test("power generation accepts documented available_power while rejecting instantaneous peak aliases", () => {
  const model = powerModel();
  model.entities.find((item) => item.id === "generator").properties[0].key = "available_power";
  close(impact(analyzeImpact(model, change(50)), "balance").calculation.result, -0.4);
  model.entities.find((item) => item.id === "generator").properties[0].key = "peak_power";
  assert.equal(impact(analyzeImpact(model, change(50)), "balance").status, "review");
});
test("active-mode contribution uses only explicitly declared operating power and duty", () => {
  const model = powerModel();
  model.entities[0].properties = [property("operating_power", 2, "W"), property("duty_cycle", 20, "%")];
  model.entities[1].properties = [formula("duty_cycle_load")];
  const request = { ...change(25), oldValues: [property("duty_cycle", 20, "%")], newValues: [property("duty_cycle", 25, "%")] };
  const calculation = impact(analyzeImpact(model, request), "mean-load").calculation;
  assert.equal(calculation.result, 0.5);
  assert.equal(calculation.ruleId, "duty_cycle_load");
  assert.deepEqual(calculation.inputs.map((item) => item.propertyKey), ["operating_power", "duty_cycle"]);
});
test("direct energy-balance inputs normalize joules and watt-hours for the same declared interval", () => {
  const model = powerModel();
  model.entities.find((item) => item.id === "generator").properties = [property("generated_energy", 3600, "J")];
  model.entities.find((item) => item.id === "budget").properties = [property("consumed_energy", 0.5, "Wh")];
  const request = { ...change(1800), targetEntityId: "generator", newValues: [property("generated_energy", 1800, "J")] };
  const result = analyzeImpact(model, request);
  assert.equal(impact(result, "balance").calculation.result, 0);
  assert.equal(impact(result, "balance").calculation.unit, "Wh");
  assert.equal(impact(result, "analysis-criterion").status, "review");
});
test("a duty-only change cannot invent an instantaneous overcurrent", () => {
  const model = powerModel();
  model.entities[0].properties.push(property("peak_current", 0.8, "A"));
  model.entities.push(entity("supply", "component", [property("available_current", 2, "A")]));
  model.relations.push(relation("supply-load", "supply", "emitter", "powers"));
  const result = analyzeImpact(model, change(100));
  assert.notEqual(impact(result, "supply").status, "critical");
  assert.equal(result.calculations.some((item) => item.ruleId === "required_current_within_available"), false);
});
test("a changed budget resolves unchanged duty-calculation inputs without marking them impacted", () => {
  const model = powerModel();
  model.entities.find((item) => item.id === "fixed-load").properties = [formula("duty_cycle_load")];
  model.entities.push(entity("periodic-load", "component", [property("operating_power", 3, "W"), property("duty_cycle", 25, "%")]));
  model.relations.push(relation("periodic-average", "fixed-load", "periodic-load"));
  const result = analyzeImpact(model, change(50));
  close(impact(result, "budget").calculation.result, 3.6);
  close(impact(result, "balance").calculation.result, -0.4);
  assert.equal(impact(result, "periodic-load").status, "unaffected");
  assert.equal(impact(result, "fixed-load").status, "unaffected");
  assert.ok(result.calculations.some((item) => item.ruleId === "duty_cycle_load"));
});
test("positive average balance does not route a duty change through supply siblings", () => {
  const model = powerModel();
  model.entities.push(entity("rail", "interface", []), entity("periodic-load", "component", [property("operating_power", 3, "W"), property("duty_cycle", 25, "%")]));
  model.entities.find((item) => item.id === "fixed-load").kind = "calculation";
  model.entities.find((item) => item.id === "fixed-load").properties = [formula("duty_cycle_load")];
  model.relations.push(relation("rail-emitter", "rail", "emitter", "powers"), relation("rail-periodic", "rail", "periodic-load", "powers"), relation("periodic-average", "fixed-load", "periodic-load"));
  const result = analyzeImpact(model, change(25));
  close(impact(result, "balance").calculation.result, 0.65);
  for (const id of ["rail", "periodic-load", "fixed-load"]) {
    assert.equal(impact(result, id).status, "unaffected");
    assert.deepEqual(impact(result, id).path, []);
  }
  assert.equal(impact(result, "budget").status, "valid");
});
test("documented deficit uses the energy path while preserving uncertainty in storage dependencies", () => {
  const model = powerModel();
  model.entities.push(entity("rail", "interface", []), entity("periodic-load", "component", [property("operating_power", 3, "W"), property("duty_cycle", 25, "%")]));
  model.entities.find((item) => item.id === "fixed-load").kind = "calculation";
  model.entities.find((item) => item.id === "fixed-load").properties = [formula("duty_cycle_load")];
  const storageRelation = model.relations.find((item) => item.id === "balance-storage");
  storageRelation.source = "inferred";
  storageRelation.confidence = 0.6;
  model.relations.push(relation("storage-rail", "storage", "rail", "powers"), relation("rail-emitter", "rail", "emitter", "powers"), relation("rail-periodic", "rail", "periodic-load", "powers"), relation("periodic-average", "fixed-load", "periodic-load"));
  const result = analyzeImpact(model, change(100));
  const storage = impact(result, "storage");
  assert.deepEqual(storage.path, ["emitter", "mean-load", "budget", "balance", "storage"]);
  assert.equal(storage.reasonCode, "energy_deficit_dependency");
  assert.equal(storage.reasoning.type, "inference");
  assert.equal(storage.confidence, 0.6);
  assert.equal(storage.calculation.result, -2.5);
  assert.equal(impact(result, "periodic-load").status, "review");
  assert.equal(impact(result, "fixed-load").status, "unaffected");
  assert.equal(impact(result, "analysis-criterion").status, "critical");
  assert.equal(impact(result, "phase-requirement").status, "review");
});
test("a recorded inference can propagate deficit review but cannot become a calculation premise", () => {
  const model = powerModel();
  model.evidence.push({ id: "storage-hypothesis", artifactId: "synthetic-context", artifactLabel: "Review hypothesis", excerpt: "A negative mean power balance may reduce storage charging availability and affect dependent operation.", kind: "inference" });
  const link = model.relations.find((item) => item.id === "balance-storage");
  link.source = "inferred";
  link.confidence = 0.55;
  link.evidenceRefs = ["storage-hypothesis"];
  const result = analyzeImpact(model, change(100));
  for (const id of ["storage", "controller"]) {
    const item = impact(result, id);
    assert.equal(item.status, "review");
    assert.equal(item.reasoning.type, "inference");
    assert.equal(item.reasonCode, "energy_deficit_dependency");
    assert.equal(item.confidence, 0.55);
    assert.ok(item.evidenceRefs.includes("storage-hypothesis"));
    assert.ok(item.path.includes("balance"));
  }
  assert.equal(impact(result, "analysis-criterion").status, "critical");
  model.entities.find((item) => item.id === "generator").properties[0].evidenceRefs = ["storage-hypothesis"];
  const unproven = analyzeImpact(model, change(100));
  assert.equal(unproven.metrics.critical, 0);
  assert.equal(impact(unproven, "balance").calculation, undefined);
  assert.equal(impact(unproven, "controller").status, "unaffected");
});
test("sub-nanowatt deficits survive the full duty and balance pipeline without premature rounding", () => {
  const model = powerModel();
  const generation = 3.6 - 1e-10;
  model.entities.find((item) => item.id === "generator").properties[0].value = generation;
  const result = analyzeImpact(model, change(50));
  const balance = impact(result, "balance").calculation;
  assert.ok(balance.result < 0 && balance.result > -1e-9, `Small deficit was changed to ${balance.result}`);
  assert.equal(impact(result, "analysis-criterion").status, "critical");
  assert.equal(balance.inputs.find((input) => input.entityId === "generator").value, generation);
  assert.equal(normalizeQuantity(1e-10, "W").value, 1e-10);
  assert.ok(result.calculations.find((calculation) => calculation.ruleId === "energy_over_interval").result < 0);
});
