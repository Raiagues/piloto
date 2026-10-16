/** Evaluator v0.1-development.1; frozen locale rules for subsequent model runs.
 * Re-evaluating previously inspected outputs is diagnostic, not fresh performance.
 */
import { validateEngineeringSystem } from "../shared/engineering-schema.mjs";

const normalized = (value) => String(value || "").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/gu, " ").trim();
const vocabulary = {
  comunicacoes: "communications", paineis: "panels", solares: "solar", geracao: "generation", carregadores: "chargers",
  bateria: "battery", baterias: "battery", batteries: "battery", recarregavel: "rechargeable", recarregaveis: "rechargeable",
  barramento: "bus", principal: "main", trilho: "rail", regulado: "regulated", transceptor: "transceiver",
  controlador: "controller", sensores: "sensors", aquecedor: "heater", potencia: "power", media: "average", medio: "average",
  contribuicao: "contribution", orcamento: "budget", balanco: "balance", energia: "energy", armazenamento: "storage",
  armazenada: "storage", armazenado: "storage", stored: "storage", store: "storage", excedente: "surplus", excess: "surplus",
  restaura: "restore", carga: "charge", cargas: "loads", apos: "after", operacao: "operation", operacoes: "operation",
  operations: "operation", missao: "mission", fase: "phase", fases: "phase", phases: "phase", suprem: "supply",
  suprimento: "supply", criterio: "criterion", analise: "analysis", margem: "margin", minima: "minimum", minimo: "minimum"
};
const stopwords = new Set(["a", "o", "e", "as", "os", "de", "do", "da", "dos", "das", "of", "and", "the", "calculo", "calculation", "pack"]);
const words = (value) => normalized(String(value || "").replace(/(\d)([A-Za-z])/gu, "$1 $2")).split(" ").filter((word) => word && !stopwords.has(word)).map((word) => vocabulary[word] || word);
const metric = (numerator, denominator) => ({ value: denominator ? numerator / denominator : null, numerator, denominator });
const units = { W: ["power", 1], mW: ["power", 0.001], kW: ["power", 1000], V: ["voltage", 1], mV: ["voltage", 0.001], mAh: ["capacity", 1], Ah: ["capacity", 1000], "%": ["ratio", 0.01], "1": ["ratio", 1], "": ["count", 1] };
function sameValue(actual, expected) {
  if (typeof expected.value !== "number") return actual.value === expected.value;
  const left = units[actual.unit || ""], right = units[expected.unit || ""];
  return typeof actual.value === "number" && left && right && left[0] === right[0] && Math.abs(actual.value * left[1] - expected.value * right[1]) <= 1e-8;
}
function sameUnit(actual, expected) {
  const left = units[actual.unit || ""], right = units[expected.unit || ""];
  return Boolean(left && right && left[0] === right[0]);
}
function matchEntities(prediction, expected) {
  const matches = new Map(), used = new Set();
  for (const gold of expected) {
    const candidates = prediction.filter((item) => !used.has(item.id)).map((item) => {
      const name = words(item.name);
      const aliasScores = gold.aliases.map((alias) => {
        const term = words(alias), signature = (tokens) => [...tokens].sort().join(" ");
        if (signature(name) === signature(term)) return 1000 + term.length;
        return term.every((token) => name.includes(token)) ? term.length * 10 : 0;
      });
      const score = Math.max(0, ...aliasScores);
      return { item, score: score ? score + (gold.kinds.includes(item.kind) ? 200 : 0) : 0 };
    }).filter((item) => item.score).sort((a, b) => b.score - a.score);
    if (candidates.length && (candidates.length === 1 || candidates[0].score > candidates[1].score)) {
      matches.set(gold.id, candidates[0].item); used.add(candidates[0].item.id);
    }
  }
  return matches;
}
function evidenceCheck(refs, evidence, documents) {
  return Array.isArray(refs) && refs.length > 0 && refs.every((ref) => {
    const item = evidence.get(ref);
    return item && typeof item.excerpt === "string" && item.excerpt.trim() && (!documents || documents.some((doc) => doc.id === item.artifactId && doc.text.includes(item.excerpt)));
  });
}
function propertyResults(object, expected = []) {
  return expected.map((gold) => {
    const found = object?.properties?.find((item) => gold.keys.some((candidate) => normalized(candidate) === normalized(item.key)));
    return { keys: gold.keys, expected: gold, actual: found || null, correct: Boolean(found && sameValue(found, gold)), unitCorrect: Boolean(found && sameUnit(found, gold)) };
  });
}

export function evaluateExtraction(prediction, truth, documents) {
  const gold = truth.extraction;
  if (!validateEngineeringSystem(prediction)) return { id: "A0-curated-context", class: "A0", status: "fail", failures: ["Prediction has an invalid engineering schema or dangling references."], metrics: {}, predicted: prediction };
  const matches = matchEntities(prediction.entities, gold.entities);
  const canonical = new Map([...matches].map(([id, item]) => [item.id, id]));
  const evidence = new Map(prediction.evidence.map((item) => [item.id, item]));
  const entityResults = gold.entities.map((item) => ({ expectedId: item.id, predictedId: matches.get(item.id)?.id || null, correctKind: item.kinds.includes(matches.get(item.id)?.kind), properties: propertyResults(matches.get(item.id), item.properties) }));
  const properties = entityResults.flatMap((item) => item.properties);
  const relationKey = (from, kind, to) => {
    // Explicit calculation dependencies can be expressed in either documented schema direction.
    if (kind === "contributes_to") return `${to}|derived_from|${from}`;
    return `${from}|${kind}|${to}`;
  };
  const expectedRelations = new Set(gold.relations.map(([from, kind, to]) => relationKey(from, kind, to)));
  const predictedRelations = prediction.relations.filter((item) => item.kind !== "contains").map((item) => ({ ...item, signature: relationKey(canonical.get(item.from) || `unmatched:${item.from}`, item.kind, canonical.get(item.to) || `unmatched:${item.to}`) }));
  const matchingRelations = predictedRelations.filter((item) => expectedRelations.has(item.signature));
  const relationRecall = new Set(matchingRelations.map((item) => item.signature)).size;
  const requirementResults = gold.requirements.map((item) => {
    const cleanIdentifier = (id) => normalized(id).replace(/^(?:(?:req|requirement|requisito)\s+)+/u, "");
    const found = prediction.requirements.find((candidate) => cleanIdentifier(candidate.id) === normalized(item.id) || (` ${normalized(candidate.title)} `).includes(` ${normalized(item.id)} `));
    const statementWords = words(`${found?.title || ""} ${found?.statement || ""}`);
    const correctMeaning = Boolean(found && item.terms.every((alternatives) => alternatives.some((term) => words(term).every((word) => statementWords.includes(word)))));
    const foundRelated = new Set((found?.relatedEntityIds || []).map((id) => canonical.get(id)));
    const correctTrace = Boolean(found && item.related.every((id) => foundRelated.has(id)));
    const propertyChecks = propertyResults(found, item.properties);
    return { expectedId: item.id, predictedId: found?.id || null, correctMeaning, correctTrace, properties: propertyChecks, correct: correctMeaning && correctTrace && propertyChecks.every((property) => property.correct) };
  });
  properties.push(...requirementResults.flatMap((item) => item.properties));
  const claims = [
    ...prediction.entities.map((item) => ({ id: item.id, refs: item.evidenceRefs })),
    ...prediction.entities.flatMap((item) => item.properties.map((property) => ({ id: `${item.id}.${property.key}`, refs: property.evidenceRefs }))),
    ...prediction.relations.map((item) => ({ id: item.id, refs: item.evidenceRefs })),
    ...prediction.requirements.map((item) => ({ id: item.id, refs: item.sourceRefs })),
    ...prediction.requirements.flatMap((item) => item.properties.map((property) => ({ id: `${item.id}.${property.key}`, refs: property.evidenceRefs })))
  ];
  const unsupported = claims.filter((item) => !evidenceCheck(item.refs, evidence, documents)).map((item) => ({ claim: item.id, reason: "Evidence is absent, unresolved, or not a literal fragment of allowed context." }));
  const sourceClassifications = gold.relations.filter((item) => item[4]).map(([from, kind, to, , source]) => {
    const matching = predictedRelations.find((item) => item.signature === relationKey(from, kind, to));
    const correct = matching?.source === source;
    if (matching && !correct) unsupported.push({ claim: matching.id, reason: `Source-defined hypothesis requires source=${source}; a literal quotation of a hypothesis does not make the relationship a documented fact.` });
    return { from, kind, to, expectedSource: source, actualSource: matching?.source || null, correct };
  });
  const provenanceFailures = claims.filter((item) => !evidenceCheck(item.refs, evidence, documents)).length;
  const metrics = {
    entityPrecision: metric(matches.size, prediction.entities.length), entityRecall: metric(matches.size, gold.entities.length),
    entityKindAccuracy: metric(entityResults.filter((item) => item.correctKind).length, gold.entities.length),
    propertyAccuracy: metric(properties.filter((item) => item.correct).length, properties.length),
    unitAccuracy: metric(properties.filter((item) => typeof item.expected.value === "number" && item.unitCorrect).length, properties.filter((item) => typeof item.expected.value === "number").length),
    relationPrecision: metric(matchingRelations.length, predictedRelations.length), relationRecall: metric(relationRecall, expectedRelations.size),
    requirementExtractionAccuracy: metric(requirementResults.filter((item) => item.correct).length, gold.requirements.length),
    provenanceCoverage: metric(claims.length - provenanceFailures, claims.length),
    sourceClassificationAccuracy: metric(sourceClassifications.filter((item) => item.correct).length, sourceClassifications.length)
  };
  const failures = Object.entries(metrics).filter(([, item]) => item.value !== 1).map(([name, item]) => `${name}: ${item.numerator}/${item.denominator}`);
  return { id: "A0-curated-context", class: "A0", status: failures.length ? "fail" : "pass", evaluationScope: gold.scope, metrics, failures, expected: gold, predicted: prediction, entities: entityResults, relations: { missing: [...expectedRelations].filter((key) => !matchingRelations.some((item) => item.signature === key)), unexpected: predictedRelations.filter((item) => !expectedRelations.has(item.signature)), sourceClassifications }, requirements: requirementResults, unsupportedClaims: unsupported, sourcesUsed: prediction.evidence };
}

export function benchmarkChange(model, benchmarkCase) {
  const radio = model.entities.find((item) => item.id === "radio");
  return { id: benchmarkCase.id, targetEntityId: "radio", kind: "parameter", oldValues: (radio?.properties || []).filter((property) => property.key === "tx_duty_cycle"), newValues: [{ key: "tx_duty_cycle", name: "TX duty cycle", value: benchmarkCase.txDutyPercent, unit: "%", source: "user", evidenceRefs: [] }], description: benchmarkCase.txDutyPercent === 100 ? "Communications transmitter remains continuously active." : `Increase communications TX duty cycle to ${benchmarkCase.txDutyPercent}%.`, createdAt: "2026-09-08T00:00:00.000Z" };
}

export function evaluateImpact(model, result, benchmarkCase) {
  const impacts = result.impacts || [], active = impacts.filter((item) => item.status !== "unaffected");
  const affected = new Set(active.map((item) => item.entityId)), critical = active.filter((item) => item.status === "critical").map((item) => item.entityId);
  const evidence = new Map((result.evidence || []).map((item) => [item.id, item]));
  const originalEvidence = new Map(model.evidence.map((item) => [item.id, item]));
  const objects = new Set([...model.entities, ...model.requirements].map((item) => item.id));
  const knownRefs = new Set([...model.evidence.map((item) => item.id), ...(result.change?.newValues || []).flatMap((item) => item.evidenceRefs)]);
  const supported = (refs) => evidenceCheck(refs, evidence) && refs.every((ref) => {
    const original = originalEvidence.get(ref), actual = evidence.get(ref);
    return knownRefs.has(ref) && (!original || ["excerpt", "artifactId", "kind"].every((field) => original[field] === actual[field]));
  });
  const failures = [], unsupportedClaims = [], claimChecks = [];
  const unsupported = (claim, reason) => unsupportedClaims.push({ claim, reason });
  for (const item of active) {
    const goodRefs = supported(item.evidenceRefs) && supported(item.reasoning?.sourceRefs || []);
    claimChecks.push({ id: `impact:${item.entityId}`, traced: goodRefs });
    if (!goodRefs) unsupported(`impact:${item.entityId}`, "Missing or unrecognized evidence references.");
    if (!objects.has(item.entityId)) unsupported(`impact:${item.entityId}`, "Unknown impacted object.");
    if (item.status === "critical" && (!item.calculation || item.reasoning?.type !== "calculation" || !benchmarkCase.expectedCritical.includes(item.entityId))) unsupported(`impact:${item.entityId}`, "Critical conclusion is not supported by the independent expected criteria.");
    const text = `${item.shortExplanation} ${item.reasoning?.shortExplanation || ""}`;
    if (/\b(?:6|six)\s*(?:hours?|h)\b|\b(?:24\s+(?:recorded\s+)?(?:failures|events)|4\s+external\s+resets)\b/iu.test(text)) unsupported(`impact:${item.entityId}`, "Prediction contains withheld flight-specific outcomes.");
    if (item.path?.[0] !== result.changedEntityId || item.path.at(-1) !== item.entityId) unsupported(`impact:${item.entityId}`, "Impact path does not connect the changed object to this object.");
    if ((item.traversedRelationIds || []).length !== (item.path?.length || 1) - 1) unsupported(`impact:${item.entityId}`, "Path and traversed relation counts disagree.");
    for (const [index, id] of (item.traversedRelationIds || []).entries()) {
      const from = item.path[index], to = item.path[index + 1];
      const relation = model.relations.find((candidate) => candidate.id === id);
      const requirement = model.requirements.find((candidate) => candidate.id === to);
      const trace = requirement && id === `trace:${to}:${from}` && requirement.relatedEntityIds.includes(from);
      const reverse = relation && ["derived_from", "depends_on", "requires", "consumes", "mounted_on"].includes(relation.kind);
      const bilateral = relation && ["powers", "connects_to", "communicates_with", "thermal_coupling"].includes(relation.kind);
      const direction = relation && (reverse ? relation.to === from && relation.from === to : bilateral ? [relation.from, relation.to].includes(from) && [relation.from, relation.to].includes(to) && from !== to : relation.from === from && relation.to === to);
      if (!trace && (!direction || ["contains", "unknown"].includes(relation?.kind))) unsupported(`impact:${item.entityId}`, "Path traverses an unsupported relation or direction.");
    }
    if (item.status === "critical" && (item.traversedRelationIds || []).some((id) => model.relations.find((relation) => relation.id === id)?.source === "inferred")) unsupported(`impact:${item.entityId}`, "An unverified inferred path cannot establish a numerical critical conclusion.");
  }
  for (const [index, calculation] of (result.calculations || []).entries()) {
    const goodRefs = supported(calculation.evidenceRefs) && calculation.inputs?.length > 0 && calculation.inputs.every((input) => supported(input.evidenceRefs) && objects.has(input.entityId));
    claimChecks.push({ id: `calculation:${index}`, traced: Boolean(goodRefs) });
    if (!goodRefs) unsupported(`calculation:${index}`, "Calculation inputs or evidence cannot be traced.");
  }
  const calculationResults = benchmarkCase.expectedCalculations.map((expected) => {
    const actual = impacts.find((item) => item.entityId === expected.entityId)?.calculation;
    const absoluteError = actual && typeof actual.result === "number" ? Math.abs(actual.result - expected.value) : null;
    const correct = actual?.ruleId === expected.ruleId && actual.unit === expected.unit && absoluteError !== null && absoluteError <= expected.tolerance;
    if (!correct) {
      failures.push(`${expected.entityId}: expected ${expected.value} ${expected.unit}; actual ${actual?.result ?? "missing"} ${actual?.unit || ""}.`);
      if (actual) unsupported(`impact:${expected.entityId}`, "Numerical conclusion disagrees with the independent expected calculation.");
    }
    return { expected, actual: actual || null, absoluteError, correct };
  });
  const missing = benchmarkCase.expectedAffected.filter((id) => !affected.has(id));
  if (missing.length) failures.push(`Missing dependencies: ${missing.join(", ")}.`);
  const missedCritical = benchmarkCase.expectedCritical.filter((id) => !critical.includes(id));
  if (missedCritical.length) failures.push(`Missing critical criteria: ${missedCritical.join(", ")}.`);
  for (const [id, status] of Object.entries(benchmarkCase.expectedStatuses)) {
    const actual = impacts.find((item) => item.entityId === id)?.status;
    if (actual !== status) failures.push(`${id}: expected status ${status}, actual ${actual || "missing"}.`);
  }
  const balancePath = impacts.find((item) => item.entityId === "energy-balance")?.path || [];
  if (benchmarkCase.requiredCalculationPath.some((id, index) => balancePath[index] !== id)) failures.push("Energy-balance impact lacks the required calculation dependency path.");
  const unsupportedIds = new Set(unsupportedClaims.map((item) => item.claim));
  if (unsupportedIds.size) failures.push(`${unsupportedIds.size} unsupported claim(s); inspect unsupportedClaims.`);
  const metrics = {
    dependencyRecall: metric(benchmarkCase.expectedAffected.length - missing.length, benchmarkCase.expectedAffected.length),
    criticalImpactPrecision: metric(critical.filter((id) => benchmarkCase.expectedCritical.includes(id)).length, critical.length),
    calculationAccuracy: metric(calculationResults.filter((item) => item.correct).length, calculationResults.length),
    unsupportedClaimRate: metric(unsupportedIds.size, claimChecks.length),
    traceabilityCoverage: metric(claimChecks.filter((item) => item.traced).length, claimChecks.length),
    requirementImpactRecall: metric(benchmarkCase.expectedRequirements.filter((id) => affected.has(id)).length, benchmarkCase.expectedRequirements.length)
  };
  metrics.uncertaintyHandling = metric(Object.entries(benchmarkCase.expectedStatuses).filter(([, status]) => status === "review").filter(([id]) => impacts.find((item) => item.entityId === id)?.status === "review").length, Object.values(benchmarkCase.expectedStatuses).filter((status) => status === "review").length);
  return { id: benchmarkCase.id, class: benchmarkCase.class, status: failures.length ? "fail" : "pass", falseCriticalCount: critical.filter((id) => !benchmarkCase.expectedCritical.includes(id)).length, metrics, failures, input: model, change: result.change, expected: benchmarkCase, predicted: result, expectedAffected: benchmarkCase.expectedAffected, predictedAffected: [...affected], expectedCalculations: benchmarkCase.expectedCalculations, actualCalculations: result.calculations, calculationResults, sourcesUsed: result.evidence, unsupportedClaims, ...(benchmarkCase.historicalObservations ? { historicalComparison: { status: "qualitative_only", observations: benchmarkCase.historicalObservations, explanation: "Observed flight values are withheld evaluation references, not numerical prediction targets. This is causal reconstruction, not blind historical prediction." } } : {}) };
}
