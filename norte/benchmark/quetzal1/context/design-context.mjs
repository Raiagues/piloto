/** Quetzal-1 V0 DESIGN CONTEXT ONLY. No flight outcomes or evaluator expectations.
 * Factual curation by Norte from the sources below; no third-party PDF is redistributed.
 * The optional structured model isolates reasoning tests from extraction quality.
 * Application startup attaches the text documents, never this model.
 */
export const QUETZAL_PROJECT_ID = "quetzal1-eps-comms";
export const QUETZAL_PROJECT_NAME = "Quetzal-1 EPS + COMMS";
export const PAPER_URL = "https://jossonline.com/storage/2023/05/Final-Aguilar-Nadalini-Design-and-On-Orbit-Performance-of-the-Electrical-Power-System-for-the-Quetzal-1-CubeSat.pdf";
export const HARDWARE_URL = "https://github.com/Quetzal-1-CubeSat-Team/quetzal1-hardware/blob/d4d1b59de384701a016a6e17353aff3c8ba64853/EPS/README.md";
export const contextFacts = [
  ["architecture", "Quetzal-1 is a 1U CubeSat developed by Universidad del Valle de Guatemala. This operating-point model covers EPS and Communications, with OBC and ADCS housekeeping represented only as power consumers. Payload operation is outside this operating point.", "JoSS 12(2), design sections 2.1–2.4; UVG / Quetzal-1 CubeSat Team"],
  ["distribution", "EPS contains solar panels, three battery chargers, a rechargeable battery pack, a main battery bus and a regulated 3.3 V rail. Solar panels feed the chargers; chargers and battery connect to the main bus. The main bus supplies the 3.3 V rail. That rail supplies AX100, OBC, EPS control and the battery heater.", "Official EPS block diagram and schematic sheets 02, 08; hardware revision d4d1b59"],
  ["solar", "The design estimate of orbital-average solar generation is 1.58 W. This is an average over the orbit, not instantaneous sunlight power.", "JoSS design section 2.4, p.1208"],
  ["battery", "The battery pack uses 2 parallel lithium-ion cells. Each cell has nominal capacity 2000 mAh and nominal voltage 3.7 V. Nominal capacity is not a measurement of available energy or state of charge. The main battery bus operates from 3.2 V to 4.2 V.", "JoSS design sections 2.1–2.2; official EPS schematic"],
  ["radio", "AX100 communications transceiver: receive input power 231 mW; transmit input power 2640 mW; design TX duty cycle 3.6 % and RX duty cycle 96.4 %. These two modes partition the budget interval. Duty cycle changes activity duration, not peak transmit power.", "JoSS Table 2, p.1208"],
  ["obc", "OBC electrical load: operating power 264 mW; duty cycle 100 %.", "JoSS Table 2, p.1208"],
  ["eps-control", "EPS controller and sensors: operating power 20 mW; duty cycle 100 %.", "JoSS Table 2, p.1208"],
  ["heater", "Battery heater: active operating power 908 mW. The heater-on design operating point uses duty cycle 33.33 %. The separate heater-off operating point uses duty cycle 0 %. Hold the selected heater duty fixed during a communications hypothesis; no thermal controller response is assumed.", "JoSS Table 2 and design discussion, p.1208; heater supply: schematic sheet 08"],
  ["housekeeping", "ADCS controller and sensor housekeeping is an auxiliary electrical load in this power budget: active operating power 66 mW; duty cycle 2.5 %. No attitude, torque or actuator model is included.", "JoSS Table 2, p.1208"],
  ["budget", "The design power budget uses a 10 % engineering allowance on all included loads. The selected operating point includes OBC, EPS controller and sensors, battery heater, ADCS housekeeping and AX100 receive/transmit activity; payload operation is excluded.", "JoSS Table 2 and section 2.4, p.1208"],
  ["requirements", "Design requirements, paraphrased from Table D1: MI-001 solar generation supports mission operation; MI-002 energy is stored in rechargeable batteries; MI-003 surplus generation restores battery charge after eclipse operations; MI-004 battery and generation supply loads during each mission phase. These statements specify no numeric orbital-average pass threshold.", "JoSS Table D1, p.1228; these are mission requirements, unrelated to any competition"]
];
export const methodFacts = [
  ["radio-average-rule", "COMMS average power is a calculation with formula duty_cycle_power: tx_power times tx_duty_cycle plus rx_power times the complementary fraction. AX100 supplies all three inputs. Percent duty cycles are divided by 100. The source's TX/RX modes are mutually exclusive and exhaustive for this budget."],
  ["active-load-rule", "Heater average contribution and Housekeeping average contribution each use formula duty_cycle_load: operating_power times duty_cycle divided by 100, sourced respectively from Battery heater and ADCS housekeeping. This reproduces the active-mode contributions of the design table; it does not measure standby consumption."],
  ["budget-rule", "Power budget uses formula sum_power. Its complete inputs for this selected operating point are OBC, EPS controller and sensors, Heater average contribution, Housekeeping average contribution and COMMS average power. Apply power_margin_multiplier 1.1 with dimensionless unit 1 once, to the sum. It represents the table's engineering allowance, not measured extra consumption."],
  ["balance-rule", "Energy balance uses formula energy_balance: orbital-average generated_power from Solar generation minus total_power from Power budget, producing power_margin in W. This is an average power balance; there is no integration interval, eclipse trajectory or initial battery charge in this context."],
  ["criterion", "Norte analysis criterion ANALYSIS-01: the selected operating point should have minimum_power_margin 0 W. This is an explicit analysis criterion created by Norte, not a quoted Quetzal mission requirement. It constrains Energy balance. A nonnegative orbital mean alone cannot verify MI-003 or MI-004 in every phase."],
  ["energy-path", "Engineering dependency hypotheses for review: Energy balance affects battery charging availability; Battery pack supplies EPS control through the main bus and regulated rail. Insufficient energy may affect controller operation. MI-001 traces to Solar generation and Energy balance; MI-002 to Battery pack; MI-003 to Energy balance and Battery pack; MI-004 to Energy balance, Battery pack and EPS controller. These are design relationships, not observations of an event or predictions of a reset time."]
];
const designText = [
  "Quetzal-1 EPS + COMMS — curated design context (V0)",
  "Attribution: Quetzal-1 CubeSat Team / Universidad del Valle de Guatemala; Aguilar-Nadalini et al., Journal of Small Satellites 12(2), 2023.",
  `Paper source: ${PAPER_URL}`,
  `Open hardware source (CC BY-SA 4.0): ${HARDWARE_URL}`,
  "This is a factual paraphrase and selected design data, not a copy of either document. No on-orbit observations are included.",
  ...contextFacts.map(([id, text, locator]) => `[${id}] ${text} Source: ${locator}.`)
].join("\n");
const methodText = ["Norte operating-point analysis definitions — authored methodology, not mission telemetry", ...methodFacts.map(([id, text]) => `[${id}] ${text}`)].join("\n");
export const contextDocuments = [
  { id: "quetzal-design-memory", label: "Quetzal-1 — EPS + COMMS design sources", fileName: "quetzal1-design-context.txt", text: designText },
  { id: "quetzal-analysis-method", label: "Power budget — analysis definitions", fileName: "quetzal1-analysis-definitions.txt", text: methodText }
];

export function createQuetzalArtifacts(ownerId = QUETZAL_PROJECT_ID, timestamp = new Date().toISOString(), createdBy = null) {
  return contextDocuments.map((document) => ({ id: document.id, kind: "document", label: document.label,
    description: document.id === "quetzal-design-memory" ? "Curated design facts with primary-source attribution." : "Explicit operating-point assumptions and calculation definitions.",
    url: `data:text/plain;base64,${btoa(String.fromCharCode(...new TextEncoder().encode(document.text)))}`,
    fileName: document.fileName, mimeType: "text/plain", size: new TextEncoder().encode(document.text).length,
    tags: ["design-context", "EPS", "COMMS"], official: false, scope: "project", ownerId, createdBy, connectedAt: timestamp, updatedAt: timestamp }));
}

/** Clean, structured INPUT for deterministic evaluation. Never an extraction prediction. */
export function createQuetzalDesignModel() {
  const prop = (key, value, unit, ref) => ({ key, name: key.replaceAll("_", " "), value, ...(unit ? { unit } : {}), source: "documented", evidenceRefs: [ref] });
  const entity = (id, name, kind, parentId, refs, properties = []) => ({ id, name, kind, ...(parentId ? { parentId } : {}), description: "", source: "documented", evidenceRefs: refs, confidence: 1, properties });
  const relation = (id, from, to, kind, refs, source = "documented") => ({ id, from, to, kind, label: kind.replaceAll("_", " "), source, evidenceRefs: refs, confidence: source === "inferred" ? 0.6 : 1 });
  const requirements = [
    ["MI-001", "Solar generation", "Solar generation supports mission operation.", ["solar", "energy-balance"]],
    ["MI-002", "Rechargeable energy storage", "Energy is stored in rechargeable batteries.", ["battery"]],
    ["MI-003", "Recharge after eclipse", "Surplus generation restores battery charge after eclipse operations.", ["energy-balance", "battery"]],
    ["MI-004", "Supply each mission phase", "Battery and generation supply loads during each mission phase.", ["energy-balance", "battery", "eps-controller"]]
  ].map(([id, title, statement, relatedEntityIds]) => ({ id, title, statement, originalStatement: statement, category: "Mission", subsystemTags: ["EPS"], reviewTags: [], status: "unreviewed", sourceRefs: ["requirements"], originalSourceRefs: ["requirements"], relatedEntityIds, relatedRelationIds: [], properties: [] }));
  requirements.push({ id: "ANALYSIS-01", title: "Nonnegative orbital-average margin", statement: "Norte criterion: orbital-average power margin ≥ 0 W.", originalStatement: "Norte criterion: orbital-average power margin ≥ 0 W.", category: "Analysis criterion · Norte", subsystemTags: ["EPS"], reviewTags: [], status: "unreviewed", sourceRefs: ["criterion"], originalSourceRefs: ["criterion"], relatedEntityIds: ["energy-balance"], relatedRelationIds: [], properties: [prop("minimum_power_margin", 0, "W", "criterion")] });
  return { schemaVersion: 1, id: "quetzal1-design-system", name: "Quetzal-1 EPS + COMMS", generatedAt: "2026-09-08T00:00:00.000Z", generatedFromRevision: 1,
    entities: [
      entity("system", "Quetzal-1", "system", undefined, ["architecture"]),
      entity("eps", "EPS", "subsystem", "system", ["distribution"]),
      entity("comms", "Communications", "subsystem", "system", ["radio"]),
      entity("solar", "Solar generation", "component", "eps", ["solar"], [prop("generated_power", 1.58, "W", "solar")]),
      entity("chargers", "Battery chargers", "component", "eps", ["distribution"]),
      entity("battery", "Battery pack", "component", "eps", ["battery"], [prop("cell_count", 2, undefined, "battery"), prop("cell_capacity", 2000, "mAh", "battery"), prop("nominal_voltage", 3.7, "V", "battery")]),
      entity("main-bus", "Main battery bus", "interface", "eps", ["battery"], [prop("minimum_voltage", 3.2, "V", "battery"), prop("maximum_voltage", 4.2, "V", "battery")]),
      entity("rail-3v3", "3.3 V rail", "interface", "eps", ["distribution"], [prop("output_voltage", 3.3, "V", "distribution")]),
      entity("radio", "AX100", "component", "comms", ["radio"], [prop("tx_duty_cycle", 3.6, "%", "radio"), prop("tx_power", 2640, "mW", "radio"), prop("rx_power", 231, "mW", "radio")]),
      entity("comms-average", "COMMS average power", "calculation", "comms", ["radio-average-rule"], [prop("formula", "duty_cycle_power", undefined, "radio-average-rule")]),
      entity("obc", "OBC", "component", "system", ["obc"], [prop("operating_power", 264, "mW", "obc")]),
      entity("eps-controller", "EPS controller and sensors", "component", "eps", ["eps-control"], [prop("operating_power", 20, "mW", "eps-control")]),
      entity("heater", "Battery heater", "component", "eps", ["heater"], [prop("operating_power", 908, "mW", "heater"), prop("duty_cycle", 33.33, "%", "heater")]),
      entity("heater-average", "Heater average contribution", "calculation", "eps", ["active-load-rule"], [prop("formula", "duty_cycle_load", undefined, "active-load-rule")]),
      entity("housekeeping", "ADCS housekeeping load", "component", "system", ["housekeeping"], [prop("operating_power", 66, "mW", "housekeeping"), prop("duty_cycle", 2.5, "%", "housekeeping")]),
      entity("housekeeping-average", "Housekeeping average contribution", "calculation", "eps", ["active-load-rule"], [prop("formula", "duty_cycle_load", undefined, "active-load-rule")]),
      entity("power-budget", "Power budget", "calculation", "eps", ["budget-rule"], [prop("formula", "sum_power", undefined, "budget-rule"), prop("power_margin_multiplier", 1.1, "1", "budget-rule")]),
      entity("energy-balance", "Energy balance", "performance", "eps", ["balance-rule"], [prop("formula", "energy_balance", undefined, "balance-rule")])
    ],
    relations: [
      relation("solar-chargers", "solar", "chargers", "powers", ["distribution"]), relation("chargers-bus", "chargers", "main-bus", "powers", ["distribution"]),
      relation("battery-bus", "battery", "main-bus", "powers", ["distribution"]), relation("bus-rail", "main-bus", "rail-3v3", "powers", ["distribution"]),
      ...["radio", "obc", "eps-controller", "heater"].map((id) => relation(`rail-${id}`, "rail-3v3", id, "powers", ["distribution"])),
      relation("radio-average", "comms-average", "radio", "derived_from", ["radio-average-rule"]),
      relation("heater-average-input", "heater-average", "heater", "derived_from", ["active-load-rule"]),
      relation("housekeeping-average-input", "housekeeping-average", "housekeeping", "derived_from", ["active-load-rule"]),
      ...["obc", "eps-controller", "heater-average", "housekeeping-average", "comms-average"].map((id) => relation(`${id}-budget`, id, "power-budget", "contributes_to", ["budget-rule"])),
      relation("balance-generation", "energy-balance", "solar", "derived_from", ["balance-rule"]), relation("balance-demand", "energy-balance", "power-budget", "derived_from", ["balance-rule"]),
      relation("balance-battery", "energy-balance", "battery", "affects", ["energy-path"], "inferred"), relation("battery-controller", "battery", "eps-controller", "affects", ["energy-path"], "inferred")
    ], requirements,
    evidence: [...contextFacts.map(([id, excerpt, locator]) => ({ id, artifactId: "quetzal-design-memory", artifactLabel: "Quetzal-1 curated design facts", excerpt, locator, kind: "fact" })), ...methodFacts.map(([id, excerpt]) => ({ id, artifactId: "quetzal-analysis-method", artifactLabel: "Norte analysis definitions", excerpt, kind: "fact" }))],
    artifactSources: contextDocuments.map((doc) => ({ artifactId: doc.id, artifactLabel: doc.label, status: "parsed" }))
  };
}
