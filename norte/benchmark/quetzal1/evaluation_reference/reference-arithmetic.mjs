/** Independent evaluator arithmetic from Q-EPS-D Table 2, never production inputs. */
export function calculateReference(txDutyPercent, heaterDutyFraction = 0.3333) {
  if (!Number.isFinite(txDutyPercent) || txDutyPercent < 0 || txDutyPercent > 100) throw new Error("Invalid evaluation TX duty.");
  const transmitFraction = txDutyPercent / 100;
  const comms = 0.231 * (1 - transmitFraction) + 2.640 * transmitFraction;
  const otherLoads = 0.264 + 0.020 + 0.908 * heaterDutyFraction + 0.066 * 0.025;
  const budget = (comms + otherLoads) * 1.1;
  return { "comms-average": comms, "power-budget": budget, "energy-balance": 1.58 - budget };
}
