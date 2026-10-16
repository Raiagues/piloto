/** STRUCTURAL_EVALUATION_ONLY. Never supplied as engineering context or to an inference provider. */
export const STRUCTURAL_REFERENCE_REVISION = "system-k-reference-2";
export const STRUCTURAL_REFERENCE_NOTES = [{ revision: "system-k-reference-2", change: "Positive-margin storage expectation changed from unaffected to review during development.", rationale: "The stated balance-to-charging relationship remains inferred and initial stored energy/state of charge are unknown. A positive interval average does not establish a verified storage outcome. Arithmetic and deficit-path expectations are unchanged.", reviewStatus: "Agent-authored correction before freeze; independent human engineering review pending. Earlier failed execution reports remain preserved." }];
export const structuralCases = [
  { id: "C2-nominal-duty-20", variant: "nominal", txDutyPercent: 20 },
  { id: "C2-nominal-continuous", variant: "nominal", txDutyPercent: 100 },
  { id: "C2-alternate-duty-25", variant: "alternate", txDutyPercent: 25 },
  { id: "C2-alternate-continuous", variant: "alternate", txDutyPercent: 100 }
];

// Independently transcribed design inputs in W, independent of production formulas,
// context constructors, unit normalizers and the impact engine under evaluation.
const inputs = {
  nominal: { transmitW: 3.9, receiveW: .18, controllerW: .31, sensorActiveW: .24, sensorFraction: .20, conditionerActiveW: .84, conditionerFraction: .25, allowance: 1.15, generationW: 1.95, peakCurrentA: .65, supplyCurrentA: 1.4 },
  alternate: { transmitW: 4.8, receiveW: .26, controllerW: .42, sensorActiveW: .36, sensorFraction: .30, conditionerActiveW: 1.05, conditionerFraction: .18, allowance: 1.08, generationW: 2.7, peakCurrentA: .6, supplyCurrentA: 1.6 }
};

export function structuralReference(caseId) {
  const testCase = structuralCases.find((item) => item.id === caseId);
  if (!testCase) throw new Error(`Unknown structural case: ${caseId}`);
  const d = inputs[testCase.variant], fraction = testCase.txDutyPercent / 100;
  const linkW = d.transmitW * fraction + d.receiveW * (1 - fraction);
  const sensorW = d.sensorActiveW * d.sensorFraction;
  const conditionerW = d.conditionerActiveW * d.conditionerFraction;
  const budgetW = (linkW + d.controllerW + sensorW + conditionerW) * d.allowance;
  const marginW = d.generationW - budgetW;
  const deficit = marginW < 0;
  const energyPath = ["transceiver-c4", "link-average", "load-budget", "power-balance"];
  return {
    ...testCase, referenceRevision: STRUCTURAL_REFERENCE_REVISION, revisionNotes: STRUCTURAL_REFERENCE_NOTES, inputs: { ...d, txFraction: fraction }, toleranceW: 1e-8,
    arithmetic: { sensorAverageW: sensorW, conditionerAverageW: conditionerW, linkAverageW: linkW, totalLoadW: budgetW, powerMarginW: marginW },
    calculations: [
      { entityId: "link-average", ruleId: "duty_cycle_power", result: linkW, unit: "W", expression: `${d.transmitW} × ${fraction} + ${d.receiveW} × ${1 - fraction}` },
      { entityId: "load-budget", ruleId: "sum_power", result: budgetW, unit: "W", expression: `(${linkW} + ${d.controllerW} + ${sensorW} + ${conditionerW}) × ${d.allowance}` },
      { entityId: "power-balance", ruleId: "energy_balance", result: marginW, unit: "W", expression: `${d.generationW} − ${budgetW}` }
    ],
    statuses: { "system-k": "unaffected", "energy-unit": "unaffected", "link-unit": "unaffected", "collector-g2": "unaffected", "transceiver-c4": "changed", "link-average": "valid", "load-budget": "valid", "power-balance": deficit ? "review" : "valid", "storage-b7": "review", "regulator-d2": deficit ? "review" : "unaffected", "controller-m3": deficit ? "review" : "unaffected", "sensor-s5": deficit ? "review" : "unaffected", "conditioner-h2": deficit ? "review" : "unaffected", "sensor-average": "unaffected", "conditioner-average": "unaffected", "K-MEAN": deficit ? "critical" : "valid", "K-PHASE": "review" },
    paths: { "link-average": energyPath.slice(0, 2), "load-budget": energyPath.slice(0, 3), "power-balance": energyPath, "K-MEAN": [...energyPath, "K-MEAN"], ...(deficit ? { "storage-b7": [...energyPath, "storage-b7"], "regulator-d2": [...energyPath, "storage-b7", "regulator-d2"], "controller-m3": [...energyPath, "storage-b7", "regulator-d2", "controller-m3"] } : {}) },
    criticalIds: deficit ? ["K-MEAN"] : [],
    forbiddenClaims: ["duty change raises peak transmit current", "instantaneous overcurrent caused by duration", "verified phase operation from interval average", "predicted shutdown time without initial energy and trajectory"],
    reviewStatus: "Authored synthetic evaluation reference; independent human engineering review pending."
  };
}
