/** Authored synthetic engineering input. This file contains no evaluator answers. */
export const STRUCTURAL_CONTEXT_REVISION = "system-k-design-1";
export const STRUCTURAL_VARIANTS = ["nominal", "alternate"];

const designs = {
  nominal: { tx: 3.9, rx: .18, duty: 8, generation: 1.95, controller: .31, sensor: .24, sensorDuty: 20, conditioner: .84, conditionerDuty: 25, allowance: 1.15, railVoltage: 6, peakCurrent: .65, railCurrent: 1.4, packVoltage: 12.8, packEnergy: 24 },
  alternate: { tx: 4.8, rx: .26, duty: 12, generation: 2.7, controller: .42, sensor: .36, sensorDuty: 30, conditioner: 1.05, conditionerDuty: 18, allowance: 1.08, railVoltage: 8, peakCurrent: .6, railCurrent: 1.6, packVoltage: 16, packEnergy: 32 }
};

function factsFor(variant) {
  const d = designs[variant];
  if (!d) throw new Error(`Unknown structural variant: ${variant}`);
  return [
    ["structure", `System K is an authored synthetic remote monitoring station. Its Energy Unit contains Collector G2, Storage B7 and Regulator D2; its Link Unit contains Transceiver C4. Controller M3, Sensor S5 and Conditioner H2 are electrical consumers. This is a design exercise, not an observed field system.`],
    ["wiring", `Collector G2 supplies Storage B7; Storage B7 supplies Regulator D2. Regulator D2 supplies Transceiver C4, Controller M3, Sensor S5 and Conditioner H2. These are the complete electrical loads in the selected operating point.`],
    ["transceiver", `Transceiver C4 transmits at ${d.tx} W input power and receives at ${d.rx} W input power. Its design TX fraction is ${d.duty} %, with the complementary fraction spent receiving. TX and RX are mutually exclusive and exhaustive modes over the averaging interval. Design peak transmit current is ${d.peakCurrent} A at ${d.railVoltage} V.`],
    ["supply", `Regulator D2 output is ${d.railVoltage} V with instantaneous available current ${d.railCurrent} A. Collector G2 provides ${d.generation} W average power over the same operating interval. Average generation and instantaneous current capacity are separate quantities.`],
    ["storage", `Storage B7 nominal voltage is ${d.packVoltage} V and nominal energy is ${d.packEnergy} Wh. Initial stored energy, state of charge, time sequence and a failure threshold are unavailable. Nominal energy is not available energy.`],
    ["controller", `Controller M3 consumes ${d.controller} W continuously at this operating point.`],
    ["sensor", `Sensor S5 active power is ${d.sensor} W with active duty ${d.sensorDuty} %. Inactive input is negligible for this synthetic load specification.`],
    ["conditioner", `Conditioner H2 active power is ${d.conditioner} W with active duty ${d.conditionerDuty} %. Inactive input is negligible for this synthetic load specification. Hold this duty fixed during a communications change; no thermal response model is supplied.`],
    ["allowance", `Use design allowance multiplier ${d.allowance} once on the sum of all average electrical loads. The multiplier is a budgeting allowance, not a physical load or measured current.`]
  ];
}

const methodFacts = [
  ["mode-rule", "Link average uses formula duty_cycle_power: transmit input power times TX fraction plus receive input power times the complementary fraction. Transceiver C4 supplies the three inputs; percent fractions are divided by 100."],
  ["active-rule", "Sensor average and Conditioner average each use formula duty_cycle_load: active operating power times active duty divided by 100. Their only input components are Sensor S5 and Conditioner H2, respectively."],
  ["budget-rule", "Load budget uses formula sum_power with Link average, Controller M3, Sensor average and Conditioner average as its complete inputs. Apply the stated power_margin_multiplier once after summation."],
  ["balance-rule", "Power balance uses formula energy_balance: Collector G2 generated_power minus Load budget total_power. Assume ideal conversion in Regulator D2 for this synthetic exercise. The result is power_margin in W. No duration, storage trajectory or initial energy is specified, so this calculation does not determine a depletion or restart time."],
  ["criterion", "K-MEAN is an authored analysis criterion: minimum_power_margin is 0 W for the selected average operating point. K-PHASE is a separate operational requirement: the station must supply its loads throughout each operating phase. An interval average alone cannot verify every phase."],
  ["storage-dependency", "Engineering hypothesis for review: the power balance affects storage charging availability; stored energy supports operation through Regulator D2. The balance-to-storage relationship is inferred. It does not assert that a shutdown occurred or predict its time."]
];

export function structuralDocuments(variant = "nominal") {
  return [
    { id: "system-k-design", label: `System K — authored design (${variant})`, fileName: `system-k-${variant}-design.txt`, text: [`System K synthetic design; revision ${STRUCTURAL_CONTEXT_REVISION}; variant ${variant}.`, ...factsFor(variant).map(([id, excerpt]) => `[${id}] ${excerpt}`)].join("\n") },
    { id: "system-k-method", label: "System K — authored analysis definitions", fileName: "system-k-method.txt", text: ["Authored analysis definitions; engineering assumptions, not telemetry or evaluated outcomes.", ...methodFacts.map(([id, excerpt]) => `[${id}] ${excerpt}`)].join("\n") }
  ];
}

export function createStructuralModel(variant = "nominal") {
  const facts = factsFor(variant), d = designs[variant], documents = structuralDocuments(variant);
  const prop = (key, value, unit, ref) => ({ key, name: key.replaceAll("_", " "), value, ...(unit ? { unit } : {}), source: "documented", evidenceRefs: [ref] });
  const power = (key, value, ref) => prop(key, variant === "nominal" ? value * 1000 : value, variant === "nominal" ? "mW" : "W", ref);
  const formula = (value, ref) => prop("formula", value, undefined, ref);
  const entity = (id, name, kind, parentId, refs, properties = []) => ({ id, name, kind, ...(parentId ? { parentId } : {}), description: "", source: "documented", evidenceRefs: refs, confidence: 1, properties });
  const relation = (id, from, to, kind, ref, inferred = false) => ({ id, from, to, kind, label: kind.replaceAll("_", " "), source: inferred ? "inferred" : "documented", evidenceRefs: [ref], confidence: inferred ? .55 : 1 });
  return {
    schemaVersion: 1, id: `system-k-${variant}`, name: "System K", generatedAt: "2026-09-08T00:00:00.000Z", generatedFromRevision: 0,
    entities: [
      entity("system-k", "System K", "system", undefined, ["structure"]),
      entity("energy-unit", "Energy Unit", "subsystem", "system-k", ["structure"]),
      entity("link-unit", "Link Unit", "subsystem", "system-k", ["structure"]),
      entity("collector-g2", "Collector G2", "component", "energy-unit", ["supply"], [power("generated_power", d.generation, "supply")]),
      entity("storage-b7", "Storage B7", "component", "energy-unit", ["storage"], [prop("nominal_voltage", d.packVoltage, "V", "storage"), prop("nominal_energy", d.packEnergy, "Wh", "storage")]),
      entity("regulator-d2", "Regulator D2", "interface", "energy-unit", ["supply"], [prop("output_voltage", d.railVoltage, "V", "supply"), prop("available_current", d.railCurrent, "A", "supply")]),
      entity("transceiver-c4", "Transceiver C4", "component", "link-unit", ["transceiver"], [prop("tx_duty_cycle", d.duty, "%", "transceiver"), power("tx_power", d.tx, "transceiver"), power("rx_power", d.rx, "transceiver"), prop("peak_current", d.peakCurrent, "A", "transceiver")]),
      entity("link-average", "Link average", "calculation", "link-unit", ["mode-rule"], [formula("duty_cycle_power", "mode-rule")]),
      entity("controller-m3", "Controller M3", "component", "system-k", ["controller"], [power("operating_power", d.controller, "controller")]),
      entity("sensor-s5", "Sensor S5", "component", "energy-unit", ["sensor"], [power("operating_power", d.sensor, "sensor"), prop("duty_cycle", d.sensorDuty, "%", "sensor")]),
      entity("sensor-average", "Sensor average", "calculation", "energy-unit", ["active-rule"], [formula("duty_cycle_load", "active-rule")]),
      entity("conditioner-h2", "Conditioner H2", "component", "energy-unit", ["conditioner"], [power("operating_power", d.conditioner, "conditioner"), prop("duty_cycle", d.conditionerDuty, "%", "conditioner")]),
      entity("conditioner-average", "Conditioner average", "calculation", "energy-unit", ["active-rule"], [formula("duty_cycle_load", "active-rule")]),
      entity("load-budget", "Load budget", "calculation", "energy-unit", ["budget-rule"], [formula("sum_power", "budget-rule"), prop("power_margin_multiplier", d.allowance, "1", "allowance")]),
      entity("power-balance", "Power balance", "performance", "energy-unit", ["balance-rule"], [formula("energy_balance", "balance-rule")])
    ],
    relations: [
      relation("collector-storage", "collector-g2", "storage-b7", "powers", "wiring"),
      relation("storage-regulator", "storage-b7", "regulator-d2", "powers", "wiring"),
      ...["transceiver-c4", "controller-m3", "sensor-s5", "conditioner-h2"].map((id) => relation(`regulator-${id}`, "regulator-d2", id, "powers", "wiring")),
      relation("link-mode", "link-average", "transceiver-c4", "derived_from", "mode-rule"),
      relation("sensor-mode", "sensor-average", "sensor-s5", "derived_from", "active-rule"),
      relation("conditioner-mode", "conditioner-average", "conditioner-h2", "derived_from", "active-rule"),
      ...["link-average", "controller-m3", "sensor-average", "conditioner-average"].map((id) => relation(`${id}-budget`, id, "load-budget", "contributes_to", "budget-rule")),
      relation("balance-generation", "power-balance", "collector-g2", "derived_from", "balance-rule"),
      relation("balance-demand", "power-balance", "load-budget", "derived_from", "balance-rule"),
      relation("balance-storage", "power-balance", "storage-b7", "affects", "storage-dependency", true)
    ],
    requirements: [
      { id: "K-MEAN", title: "Nonnegative mean power margin", statement: "The selected average operating point shall have a power margin of at least 0 W.", category: "Authored analysis criterion", subsystemTags: ["Energy"], reviewTags: [], status: "unreviewed", sourceRefs: ["criterion"], relatedEntityIds: ["power-balance"], relatedRelationIds: [], properties: [prop("minimum_power_margin", 0, "W", "criterion")] },
      { id: "K-PHASE", title: "Supply every operating phase", statement: "The station shall supply its loads throughout each operating phase.", category: "Operational requirement", subsystemTags: ["Energy"], reviewTags: [], status: "unreviewed", sourceRefs: ["criterion"], relatedEntityIds: ["power-balance", "storage-b7", "controller-m3"], relatedRelationIds: [], properties: [] }
    ],
    evidence: [...facts, ...methodFacts].map(([id, excerpt]) => { const method = methodFacts.some(([key]) => key === id), document = documents[method ? 1 : 0]; return { id, artifactId: document.id, artifactLabel: document.label, locator: `Section ${id}`, excerpt, kind: id === "storage-dependency" ? "inference" : "fact" }; }),
    artifactSources: documents.map((document) => ({ artifactId: document.id, artifactLabel: document.label, status: "parsed" }))
  };
}
