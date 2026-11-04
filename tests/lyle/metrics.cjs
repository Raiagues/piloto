'use strict';
// How the LYLE highlights are scored. Each metric is explained in the README, section "Testes".

const overlap = (a, b) => Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
const iou = (a, b) => {
  const shared = overlap(a, b);
  return shared / (a.end - a.start + b.end - b.start - shared);
};
const ratio = (part, whole) => (whole ? part / whole : null);

/** Findings of one turn that touch the mark of the answer key. The right rule wins over a higher score. */
function matches(alert, findings) {
  const touching = findings.filter(item => item.turnKey === alert.turn && overlap(item, alert) > 0);
  return touching.sort(
    (a, b) => (b.ruleId === alert.rule) - (a.ruleId === alert.rule) || iou(b, alert) - iou(a, alert),
  );
}

function score(alerts, findings, sentences) {
  const rows = alerts.map(alert => {
    const [best] = matches(alert, findings),
      proofs = best?.evidence.map(item => item.turnKey) || [];
    return {
      alert,
      finding: best || null,
      found: Boolean(best),
      rightRule: best?.ruleId === alert.rule,
      iou: best ? iou(best, alert) : 0,
      proofExpected: alert.proofTurns.length > 0,
      proofRight: alert.proofTurns.some(turn => proofs.includes(turn)),
    };
  });
  const claimed = new Set(alerts.flatMap(alert => matches(alert, findings)));
  const falseAlarms = findings.filter(item => !claimed.has(item)),
    found = rows.filter(row => row.found);
  const precision = ratio(claimed.size, findings.length),
    recall = ratio(found.length, alerts.length);
  return {
    rows,
    falseAlarms,
    alerts: alerts.length,
    sentences,
    findings: findings.length,
    found: found.length,
    recall,
    precision,
    f1: precision && recall ? (2 * precision * recall) / (precision + recall) : 0,
    rightRule: ratio(rows.filter(row => row.rightRule).length, alerts.length),
    meanIou: ratio(
      found.reduce((sum, row) => sum + row.iou, 0),
      found.length,
    ),
    closeMarks: ratio(found.filter(row => row.iou >= 0.8).length, found.length),
    proofRight: ratio(rows.filter(row => row.proofRight).length, rows.filter(row => row.proofExpected).length),
    falseAlarmsPer100: (100 * falseAlarms.length) / sentences,
  };
}

module.exports = { score, overlap, iou };
