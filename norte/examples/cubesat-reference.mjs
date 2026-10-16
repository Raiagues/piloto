/** Synthetic 3U CubeSat reference architecture.
 *
 * Explicit teaching fixture, not a real mission and never attributed to one. It
 * exists so a single hypothesis — "the camera weighs 1 kg", "the optics get
 * thicker" — travels the chain a systems engineer would trace by hand: the part,
 * its subsystem budget, the system budget, the requirement that fails, and the
 * neighbouring subsystems that must be re-examined even when no number exists yet.
 *
 * Every quantity below is documented in `cubesatMemoryText`, so the impact engine
 * can evaluate it; every dependency that carries no formula is still declared as
 * a relation, so it surfaces as an element to review rather than silently missing.
 */
const timestamp = "2026-01-01T00:00:00.000Z";

const facts = [
  ["architecture", "The 3U CubeSat contains the Payload, Power, Communication, Attitude control, Avionics, Structure and Thermal subsystems."],
  ["camera", "Camera CAM-3U mass is 350 g. Operating power is 4.5 W. Peak current is 1.4 A. Nominal voltage is 3.3 V. Thickness along the stack is 22 mm."],
  ["optics", "Optics barrel OB-50 mass is 180 g. Thickness along the stack is 46 mm."],
  ["storage", "Payload storage board mass is 60 g. Operating power is 0.8 W."],
  ["battery", "Battery pack BP-20 available energy is 20 Wh. Mass is 260 g."],
  ["eps", "EPS board continuous output limit is 3 A. Output voltage is 3.3 V. Mass is 95 g."],
  ["array", "Solar array generated power is 11 W. Mass is 300 g."],
  ["radio", "UHF transceiver TR-U1 transmit power is 3.2 W. Receive power is 0.6 W. Peak current is 1.1 A. Transmit duty cycle is 12 %. Mass is 85 g."],
  ["antenna", "Deployable antenna mass is 45 g. Thickness along the stack is 8 mm."],
  ["wheel", "Reaction wheel RW-3 operating power is 1.6 W. Peak current is 0.6 A. Mass is 140 g."],
  ["magnetorquer", "Magnetorquer set operating power is 0.4 W. Mass is 60 g."],
  ["obc", "On-board computer OBC-A operating power is 1.1 W. Mass is 70 g."],
  ["chassis", "3U chassis mass is 480 g. Rail wall thickness is 2 mm."],
  ["radiator", "Radiator panel mass is 90 g."],
  ["payload-budget", "Payload allocated mass is the sum of the Camera, Optics barrel and Payload storage board masses."],
  ["mass-budget", "Total mass is the sum of the Camera, Optics barrel, Payload storage board, Battery pack, EPS board, Solar array, UHF transceiver, Deployable antenna, Reaction wheel, Magnetorquer set, On-board computer, 3U chassis and Radiator panel masses."],
  ["stack-budget", "Payload stack height is the sum of the Camera, Optics barrel and Deployable antenna thicknesses."],
  ["power-budget", "Orbit average power is the sum of the Camera operating power, the UHF transceiver average power, the Reaction wheel operating power, the Magnetorquer set operating power, the On-board computer operating power and the Payload storage board operating power."],
  ["radio-duty", "UHF transceiver average power is its transmit power during the transmit duty cycle plus its receive power for the rest of the orbit."],
  ["energy-margin", "Power margin is the Solar array generated power minus the Orbit average power."],
  ["autonomy", "Autonomy in minutes is the Battery pack available energy in Wh divided by the Orbit average power in W, multiplied by 60."],
  ["structure-load", "The Camera and the Optics barrel are mounted on the 3U chassis; their mass drives the launch load the chassis must carry and the position of the centre of mass."],
  ["adcs-inertia", "The attitude control authority depends on the mass distribution of the Payload; the Reaction wheel is sized from the moment of inertia and the centre of mass offset."],
  ["thermal-path", "The Camera is thermally coupled to the Radiator panel; its dissipated power sets the radiator area."],
  ["controller-limit", "The EPS board powers the Camera, the UHF transceiver and the Reaction wheel; each supply line is limited by the EPS continuous output."],
  ["req-mass", "REQ-M01: Maximum launch mass is 4000 g, verified with the Total mass calculation."],
  ["req-payload", "REQ-M02: The Payload mass allocation is 700 g, verified with the Payload allocated mass calculation."],
  ["req-stack", "REQ-S01: Maximum payload stack height is 90 mm, verified with the Payload stack height calculation."],
  ["req-autonomy", "REQ-P02: Minimum eclipse autonomy is 120 min, verified with the Autonomy calculation."],
  ["req-margin", "REQ-P01: Minimum power margin is 0.5 W, verified with the Power margin calculation."]
];

export const cubesatMemoryText = [
  "Reference 3U CubeSat architecture. Synthetic teaching fixture; not a real mission.",
  ...facts.map(([, text]) => text)
].join("\n");

const MASS_CONTRIBUTORS = ["camera", "optics", "storage", "battery", "eps", "array", "radio", "antenna", "wheel", "magnetorquer", "obc", "chassis", "radiator"];
const PAYLOAD_MASS_CONTRIBUTORS = ["camera", "optics", "storage"];
const STACK_CONTRIBUTORS = ["camera", "optics", "antenna"];
const POWER_CONTRIBUTORS = ["camera", "radio-average", "wheel", "magnetorquer", "obc", "storage"];

export function createCubesatReferenceModel() {
  const property = (key, value, unit, evidence) => ({ key, name: key.replaceAll("_", " "), value, ...(unit ? { unit } : {}), source: "documented", evidenceRefs: [evidence] });
  const entity = (id, name, kind, parentId, evidenceRefs, properties = [], description = "") => ({ id, name, kind, ...(parentId ? { parentId } : {}), description, properties, source: "documented", evidenceRefs, confidence: 1 });
  const relation = (id, from, to, kind, evidenceRefs) => ({ id, from, to, kind, label: kind.replaceAll("_", " "), source: "documented", evidenceRefs, confidence: 1 });
  const requirement = (id, title, statement, tag, sourceRef, verifiedBy, properties) => ({ id, title, statement, originalStatement: statement, subsystemTags: [tag], reviewTags: [], status: "unreviewed", sourceRefs: [sourceRef], relatedEntityIds: [verifiedBy], relatedRelationIds: [], properties });

  return {
    schemaVersion: 1, id: "cubesat-reference", name: "Reference 3U CubeSat", generatedAt: timestamp, generatedFromRevision: 0,
    entities: [
      entity("system", "Reference 3U CubeSat", "system", undefined, ["architecture"]),
      entity("payload", "Payload", "subsystem", "system", ["architecture"]),
      entity("power", "Power", "subsystem", "system", ["architecture"]),
      entity("communication", "Communication", "subsystem", "system", ["architecture"]),
      entity("adcs", "Attitude control", "subsystem", "system", ["architecture"]),
      entity("avionics", "Avionics", "subsystem", "system", ["architecture"]),
      entity("structure", "Structure", "subsystem", "system", ["architecture"]),
      entity("thermal", "Thermal", "subsystem", "system", ["architecture"]),

      entity("camera", "Camera CAM-3U", "component", "payload", ["camera"], [property("mass", 350, "g", "camera"), property("operating_power", 4.5, "W", "camera"), property("peak_current", 1.4, "A", "camera"), property("nominal_voltage", 3.3, "V", "camera"), property("thickness", 22, "mm", "camera")], "Imaging camera, the mission payload instrument."),
      entity("optics", "Optics barrel OB-50", "component", "payload", ["optics"], [property("mass", 180, "g", "optics"), property("thickness", 46, "mm", "optics")], "Lens barrel mounted in front of the camera."),
      entity("storage", "Payload storage board", "component", "payload", ["storage"], [property("mass", 60, "g", "storage"), property("operating_power", 0.8, "W", "storage")]),

      entity("battery", "Battery pack BP-20", "component", "power", ["battery"], [property("available_energy", 20, "Wh", "battery"), property("mass", 260, "g", "battery")]),
      entity("eps", "EPS board", "component", "power", ["eps"], [property("available_current", 3, "A", "eps"), property("output_voltage", 3.3, "V", "eps"), property("mass", 95, "g", "eps")], "Electrical power supply and distribution board."),
      entity("array", "Solar array", "component", "power", ["array"], [property("generated_power", 11, "W", "array"), property("mass", 300, "g", "array")]),

      entity("radio", "UHF transceiver TR-U1", "component", "communication", ["radio"], [property("tx_power", 3.2, "W", "radio"), property("rx_power", 0.6, "W", "radio"), property("peak_current", 1.1, "A", "radio"), property("tx_duty_cycle", 12, "%", "radio"), property("mass", 85, "g", "radio")]),
      entity("antenna", "Deployable antenna", "component", "communication", ["antenna"], [property("mass", 45, "g", "antenna"), property("thickness", 8, "mm", "antenna")]),
      entity("radio-average", "Transceiver average power", "calculation", "communication", ["radio-duty"], [property("formula", "duty_cycle_power", undefined, "radio-duty")]),

      entity("wheel", "Reaction wheel RW-3", "component", "adcs", ["wheel"], [property("operating_power", 1.6, "W", "wheel"), property("peak_current", 0.6, "A", "wheel"), property("mass", 140, "g", "wheel")], "Momentum wheel sized from the payload moment of inertia."),
      entity("magnetorquer", "Magnetorquer set", "component", "adcs", ["magnetorquer"], [property("operating_power", 0.4, "W", "magnetorquer"), property("mass", 60, "g", "magnetorquer")]),

      entity("obc", "On-board computer OBC-A", "component", "avionics", ["obc"], [property("operating_power", 1.1, "W", "obc"), property("mass", 70, "g", "obc")]),

      entity("chassis", "3U chassis", "component", "structure", ["chassis"], [property("mass", 480, "g", "chassis"), property("thickness", 2, "mm", "chassis")], "Primary structure carrying the launch load."),
      entity("radiator", "Radiator panel", "component", "thermal", ["radiator"], [property("mass", 90, "g", "radiator")]),

      entity("payload-mass", "Payload allocated mass", "calculation", "payload", ["payload-budget"], [property("formula", "sum_mass", undefined, "payload-budget")]),
      entity("total-mass", "Total mass", "calculation", "structure", ["mass-budget"], [property("formula", "sum_mass", undefined, "mass-budget")]),
      entity("stack-height", "Payload stack height", "calculation", "payload", ["stack-budget"], [property("formula", "sum_thickness", undefined, "stack-budget")]),
      entity("power-budget", "Orbit average power", "calculation", "power", ["power-budget"], [property("formula", "sum_power", undefined, "power-budget")]),
      entity("power-margin", "Power margin", "performance", "power", ["energy-margin"], [property("formula", "energy_balance", undefined, "energy-margin")]),
      entity("autonomy", "Autonomy", "performance", "power", ["autonomy"], [property("formula", "energy_over_power", undefined, "autonomy")])
    ],
    relations: [
      ...MASS_CONTRIBUTORS.map((id) => relation(`mass-${id}`, id, "total-mass", "contributes_to", ["mass-budget"])),
      ...PAYLOAD_MASS_CONTRIBUTORS.map((id) => relation(`payload-mass-${id}`, id, "payload-mass", "contributes_to", ["payload-budget"])),
      ...STACK_CONTRIBUTORS.map((id) => relation(`stack-${id}`, id, "stack-height", "contributes_to", ["stack-budget"])),
      ...POWER_CONTRIBUTORS.map((id) => relation(`power-${id}`, id, "power-budget", "contributes_to", ["power-budget"])),
      relation("radio-duty", "radio-average", "radio", "derived_from", ["radio-duty"]),
      relation("margin-generation", "power-margin", "array", "derived_from", ["energy-margin"]),
      relation("margin-demand", "power-margin", "power-budget", "derived_from", ["energy-margin"]),
      relation("autonomy-energy", "autonomy", "battery", "derived_from", ["autonomy"]),
      relation("autonomy-power", "autonomy", "power-budget", "derived_from", ["autonomy"]),
      // Documented dependencies without a formula: the engine reports them as
      // elements to review instead of pretending it can compute them.
      relation("camera-chassis", "camera", "chassis", "mounted_on", ["structure-load"]),
      relation("optics-chassis", "optics", "chassis", "mounted_on", ["structure-load"]),
      // `mounted_on` carries the constraint downward; the launch load these parts
      // impose on the chassis travels the other way and is stated separately.
      relation("camera-load", "camera", "chassis", "affects", ["structure-load"]),
      relation("optics-load", "optics", "chassis", "affects", ["structure-load"]),
      relation("payload-adcs", "camera", "wheel", "affects", ["adcs-inertia"]),
      relation("optics-adcs", "optics", "wheel", "affects", ["adcs-inertia"]),
      relation("camera-thermal", "camera", "radiator", "thermal_coupling", ["thermal-path"]),
      relation("eps-camera", "eps", "camera", "powers", ["controller-limit"]),
      relation("eps-radio", "eps", "radio", "powers", ["controller-limit"]),
      relation("eps-wheel", "eps", "wheel", "powers", ["controller-limit"])
    ],
    requirements: [
      requirement("REQ-M01", "Maximum launch mass", "Total mass ≤ 4000 g", "Structure", "req-mass", "total-mass", [property("maximum_mass", 4000, "g", "req-mass")]),
      requirement("REQ-M02", "Payload mass allocation", "Payload allocated mass ≤ 700 g", "Payload", "req-payload", "payload-mass", [property("maximum_mass", 700, "g", "req-payload")]),
      requirement("REQ-S01", "Maximum payload stack height", "Payload stack height ≤ 90 mm", "Payload", "req-stack", "stack-height", [property("maximum_thickness", 90, "mm", "req-stack")]),
      requirement("REQ-P02", "Minimum eclipse autonomy", "Autonomy ≥ 120 min", "Power", "req-autonomy", "autonomy", [property("minimum_autonomy", 120, "min", "req-autonomy")]),
      requirement("REQ-P01", "Minimum power margin", "Power margin ≥ 0.5 W", "Power", "req-margin", "power-margin", [property("minimum_power_margin", 0.5, "W", "req-margin")])
    ],
    evidence: facts.map(([id, excerpt], index) => ({ id, artifactId: "cubesat-reference-memory", artifactLabel: "Reference 3U CubeSat architecture", locator: `L${index + 1}`, excerpt, kind: "fact" })),
    artifactSources: [{ artifactId: "cubesat-reference-memory", artifactLabel: "Reference 3U CubeSat architecture", status: "parsed" }]
  };
}
