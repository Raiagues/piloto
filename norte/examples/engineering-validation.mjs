/** Explicit, synthetic engineering fixture. Never loaded by normal startup or AI failure. */
const timestamp = "2026-01-01T00:00:00.000Z";
const facts = [
  ["architecture", "Validation rig contains Power, Communication, Payload, Thermal and Structure subsystems. Regulator powers Radio. Radio is thermally coupled to the enclosure."],
  ["radio", "Radio R1 peak current is 400 mA. Operating power is 1 W. Supported supply voltage is 3 V to 5 V."],
  ["regulator", "Regulator continuous output limit is 800 mA. Output voltage is 3.3 V."],
  ["battery", "Battery available energy is 8 Wh."],
  ["base-load", "Base load operating power is 5 W."],
  ["power-formula", "Power budget is the sum of Radio operating power and Base load operating power. Autonomy in minutes is available Battery energy in Wh divided by Power budget in W, multiplied by 60."],
  ["mass", "Payload mass is 120 g. Structure mass is 100 g. Total mass is the sum of Payload mass and Structure mass."],
  ["req-duration", "REQ-07: Minimum autonomy is 90 min. It is verified using the Autonomy calculation."],
  ["req-mass", "REQ-01: Maximum total mass is 350 g. It is verified using the Total mass calculation."]
];
export const validationMemoryText = facts.map(([, text]) => text).join("\n");
export function createEngineeringValidationModel() {
  const property = (key, value, unit, evidence) => ({ key, name: key.replaceAll("_", " "), value, ...(unit ? { unit } : {}), source: "documented", evidenceRefs: [evidence] });
  const entity = (id, name, kind, parentId, evidenceRefs, properties = []) => ({ id, name, kind, ...(parentId ? { parentId } : {}), description: "", properties, source: "documented", evidenceRefs, confidence: 1 });
  const relation = (id, from, to, kind, evidenceRefs) => ({ id, from, to, kind, label: kind.replaceAll("_", " "), source: "documented", evidenceRefs, confidence: 1 });
  return {
    schemaVersion: 1, id: "validation-system", name: "Engineering validation rig", generatedAt: timestamp, generatedFromRevision: 0,
    entities: [
      entity("system", "Validation rig", "system", undefined, ["architecture"]),
      entity("power", "Power", "subsystem", "system", ["architecture"]),
      entity("communication", "Communication", "subsystem", "system", ["architecture"]),
      entity("payload-system", "Payload", "subsystem", "system", ["architecture"]),
      entity("thermal", "Thermal enclosure", "subsystem", "system", ["architecture"]),
      entity("structure-system", "Structure", "subsystem", "system", ["architecture"]),
      entity("radio", "Radio R1", "component", "communication", ["radio"], [property("peak_current", 400, "mA", "radio"), property("operating_power", 1, "W", "radio"), property("minimum_voltage", 3, "V", "radio"), property("maximum_voltage", 5, "V", "radio")]),
      entity("regulator", "Regulator", "component", "power", ["regulator"], [property("available_current", 800, "mA", "regulator"), property("output_voltage", 3.3, "V", "regulator")]),
      entity("battery", "Battery", "component", "power", ["battery"], [property("available_energy", 8, "Wh", "battery")]),
      entity("base-load", "Base load", "component", "power", ["base-load"], [property("operating_power", 5, "W", "base-load")]),
      entity("power-budget", "Power budget", "calculation", "power", ["power-formula"], [property("formula", "sum_power", undefined, "power-formula")]),
      entity("autonomy", "Autonomy", "performance", "power", ["power-formula"], [property("formula", "energy_over_power", undefined, "power-formula")]),
      entity("payload", "Payload instrument", "component", "payload-system", ["mass"], [property("mass", 120, "g", "mass")]),
      entity("structure", "Structure frame", "component", "structure-system", ["mass"], [property("mass", 100, "g", "mass")]),
      entity("total-mass", "Total mass", "calculation", "structure-system", ["mass"], [property("formula", "sum_mass", undefined, "mass")])
    ],
    relations: [
      relation("regulator-radio", "regulator", "radio", "powers", ["architecture"]),
      relation("radio-budget", "radio", "power-budget", "contributes_to", ["power-formula"]),
      relation("base-budget", "base-load", "power-budget", "contributes_to", ["power-formula"]),
      relation("autonomy-power", "autonomy", "power-budget", "derived_from", ["power-formula"]),
      relation("autonomy-energy", "autonomy", "battery", "derived_from", ["power-formula"]),
      relation("radio-thermal", "radio", "thermal", "thermal_coupling", ["architecture"]),
      relation("payload-mass", "payload", "total-mass", "contributes_to", ["mass"]),
      relation("structure-mass", "structure", "total-mass", "contributes_to", ["mass"])
    ],
    requirements: [
      { id: "REQ-07", title: "Minimum autonomy", statement: "Autonomy ≥ 90 min", originalStatement: "Autonomy ≥ 90 min", subsystemTags: ["Power"], reviewTags: [], status: "unreviewed", sourceRefs: ["req-duration"], relatedEntityIds: ["autonomy"], relatedRelationIds: [], properties: [property("minimum_autonomy", 90, "min", "req-duration")] },
      { id: "REQ-01", title: "Maximum mass", statement: "Total mass ≤ 350 g", originalStatement: "Total mass ≤ 350 g", subsystemTags: ["Structure"], reviewTags: [], status: "unreviewed", sourceRefs: ["req-mass"], relatedEntityIds: ["total-mass"], relatedRelationIds: [], properties: [property("maximum_mass", 350, "g", "req-mass")] }
    ],
    evidence: facts.map(([id, excerpt], index) => ({ id, artifactId: "validation-memory", artifactLabel: "Explicit engineering validation fixture", locator: `L${index + 1}`, excerpt, kind: "fact" })),
    artifactSources: [{ artifactId: "validation-memory", artifactLabel: "Explicit engineering validation fixture", status: "parsed" }]
  };
}
export function validationChange(key = "peak_current", value = 1.2, unit = "A", targetEntityId = "radio") {
  const model = createEngineeringValidationModel();
  return { id: "validation-change", targetEntityId, kind: "parameter", oldValues: model.entities.find((item) => item.id === targetEntityId).properties.filter((item) => item.key === key), newValues: [{ key, name: key.replaceAll("_", " "), value, unit, source: "user", evidenceRefs: [] }], description: `${targetEntityId}: ${value} ${unit}`, createdAt: timestamp };
}
