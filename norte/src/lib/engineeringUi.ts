import { graphlib, layout } from "@dagrejs/dagre";
import type { EngineeringAnalysis, EngineeringEntity, EngineeringRelation, EngineeringRequirement, EngineeringSystemModel, EngineeringProperty } from "./engineeringSystem";
import { recordEngineeringCorrections } from "./engineeringCorrections";
import type { EngineeringCorrectionOptions } from "./engineeringCorrections";
import type { Language } from "./types";

export const ENGINEERING_NODE_WIDTH = 206;
export const ENGINEERING_NODE_HEIGHT = 126;
export type GraphPositions = Record<string, { x: number; y: number }>;

export function engineeringParentId(model: EngineeringSystemModel, entity: EngineeringEntity): string | undefined {
  return entity.parentId || model.relations.find((relation) => relation.kind === "contains" && relation.to === entity.id)?.from;
}

export function engineeringAncestors(model: EngineeringSystemModel, id: string): EngineeringEntity[] {
  const ancestors: EngineeringEntity[] = [];
  const seen = new Set<string>();
  let current = model.entities.find((entity) => entity.id === id);
  while (current && !seen.has(current.id)) {
    seen.add(current.id); ancestors.unshift(current);
    const parentId = engineeringParentId(model, current);
    current = model.entities.find((entity) => entity.id === parentId);
  }
  return ancestors;
}

/** Visual routing only. Endpoints retain the semantic direction of the relation. */
export function engineeringCurve(from: { x: number; y: number }, to: { x: number; y: number }, lane = 0, vertical = false) {
  const horizontal = !vertical && Math.abs(to.x - from.x) > Math.abs(to.y - from.y);
  const sign = (horizontal ? to.x - from.x : to.y - from.y) >= 0 ? 1 : -1;
  const start = { x: from.x + ENGINEERING_NODE_WIDTH / 2 + (horizontal ? sign * ENGINEERING_NODE_WIDTH / 2 : lane), y: from.y + ENGINEERING_NODE_HEIGHT / 2 + (horizontal ? lane : sign * ENGINEERING_NODE_HEIGHT / 2) };
  const end = { x: to.x + ENGINEERING_NODE_WIDTH / 2 - (horizontal ? sign * ENGINEERING_NODE_WIDTH / 2 : -lane), y: to.y + ENGINEERING_NODE_HEIGHT / 2 - (horizontal ? -lane : sign * ENGINEERING_NODE_HEIGHT / 2) };
  const bend = Math.abs(horizontal ? end.x - start.x : end.y - start.y) / 2;
  const c1 = { x: start.x + (horizontal ? sign * bend : 0), y: start.y + (horizontal ? 0 : sign * bend) };
  const c2 = { x: end.x - (horizontal ? sign * bend : 0), y: end.y - (horizontal ? 0 : sign * bend) };
  if (from.x === to.x && from.y === to.y) {
    return { path: `M${from.x + ENGINEERING_NODE_WIDTH},${from.y + 35} C${from.x + ENGINEERING_NODE_WIDTH + 110},${from.y - 70} ${from.x + ENGINEERING_NODE_WIDTH + 110},${from.y + 160} ${from.x + ENGINEERING_NODE_WIDTH},${from.y + 95}`, label: { x: from.x + ENGINEERING_NODE_WIDTH + 70, y: from.y + 65 } };
  }
  return { path: `M${start.x},${start.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${end.x},${end.y}`, label: { x: (start.x + 3 * c1.x + 3 * c2.x + end.x) / 8, y: (start.y + 3 * c1.y + 3 * c2.y + end.y) / 8 } };
}

/** Side ports for peers; route under intervening cards instead of through them. */
export function engineeringInterfaceCurve(from: { x: number; y: number }, to: { x: number; y: number }, lane = 0, obstacles: Array<{ x: number; y: number }> = []) {
  const horizontal = Math.abs(to.x - from.x) >= ENGINEERING_NODE_WIDTH && Math.abs(to.x - from.x) > Math.abs(to.y - from.y);
  if (!horizontal) return engineeringCurve(from, to, lane);
  const sign = to.x > from.x ? 1 : -1;
  const start = { x: from.x + (sign > 0 ? ENGINEERING_NODE_WIDTH : 0), y: from.y + ENGINEERING_NODE_HEIGHT / 2 + lane };
  const end = { x: to.x + (sign > 0 ? 0 : ENGINEERING_NODE_WIDTH), y: to.y + ENGINEERING_NODE_HEIGHT / 2 + lane };
  const blockers = obstacles.filter((node) => node.x + ENGINEERING_NODE_WIDTH > Math.min(start.x, end.x) && node.x < Math.max(start.x, end.x) && node.y < Math.max(start.y, end.y) + 16 && node.y + ENGINEERING_NODE_HEIGHT > Math.min(start.y, end.y) - 16);
  if (!blockers.length) return engineeringCurve(from, to, lane);
  const channel = Math.max(from.y, to.y, ...blockers.map((node) => node.y)) + ENGINEERING_NODE_HEIGHT + 32 + Math.abs(lane);
  const sx = start.x + sign * 24, ex = end.x - sign * 24, radius = 10;
  return { path: `M${start.x},${start.y} L${sx - sign * radius},${start.y} Q${sx},${start.y} ${sx},${start.y + radius} L${sx},${channel - radius} Q${sx},${channel} ${sx + sign * radius},${channel} L${ex - sign * radius},${channel} Q${ex},${channel} ${ex},${channel - radius} L${ex},${end.y + radius} Q${ex},${end.y} ${ex + sign * radius},${end.y} L${end.x},${end.y}`, label: { x: (sx + ex) / 2, y: channel } };
}

/** A branch expands locally without hiding its siblings or fabricating entities. */
export function expandedSystemEntities(model: EngineeringSystemModel, expanded: Set<string>): EngineeringEntity[] {
  return model.entities.filter((entity) => String(entity.kind) !== "requirement" && engineeringAncestors(model, entity.id).slice(0, -1).every((ancestor) => expanded.has(ancestor.id)));
}

/** Selection highlights descendants, direct interfaces and their ancestor context. */
export function engineeringFocus(model: EngineeringSystemModel, selectedId: string): Set<string> {
  const focus = new Set(model.entities.filter((entity) => engineeringAncestors(model, entity.id).some((ancestor) => ancestor.id === selectedId)).map((entity) => entity.id));
  const branch = new Set(focus);
  model.relations.filter((relation) => relation.kind !== "contains" && (branch.has(relation.from) || branch.has(relation.to))).forEach((relation) => { focus.add(relation.from); focus.add(relation.to); });
  for (const id of [...focus]) engineeringAncestors(model, id).forEach((ancestor) => focus.add(ancestor.id));
  return focus;
}

export function engineeringInitialScale(viewport: { width: number; height: number }, graph: { width: number; height: number }, fitRequested = false): number {
  const fitted = Math.min(1, (viewport.width - 100) / graph.width, (viewport.height - 130) / graph.height);
  return Math.max(fitRequested ? .2 : .8, fitted);
}

function reviewId(prefix = "review"): string { return `${prefix}-${crypto.randomUUID()}`; }

export function engineeringLabel(value: string, language: Language): string {
  const labels: Record<string, [string, string]> = {
    system: ["Sistema", "System"], subsystem: ["Subsistema", "Subsystem"], component: ["Componente", "Component"],
    requirement: ["Requisito", "Requirement"], parameter: ["Parâmetro", "Parameter"], calculation: ["Cálculo", "Calculation"], performance: ["Desempenho", "Performance"], interface: ["Interface", "Interface"],
    changed: ["Alterado", "Changed"], valid: ["Compatível", "Compatible"], review: ["Revisar", "Review"], critical: ["Conflito", "Conflict"], unaffected: ["Fora do impacto", "Outside impact"],
    documented: ["Fato documentado", "Documented fact"], calculated: ["Cálculo", "Calculation"], inferred: ["Inferência IA", "AI inference"], user: ["Informado pela equipe", "Team input"], fact: ["Fato", "Fact"], inference: ["Inferência", "Inference"],
    unreviewed: ["Não revisado", "Unreviewed"], accepted: ["Aceito", "Accepted"], verified: ["Verificado", "Verified"],
    contains: ["contém", "contains"], powers: ["alimenta", "powers"], connects_to: ["conecta", "connects to"], depends_on: ["depende de", "depends on"], affects: ["afeta", "affects"], contributes_to: ["contribui para", "contributes to"], constrained_by: ["limitado por", "constrained by"], satisfies: ["satisfaz", "satisfies"], requires: ["requer", "requires"], produces: ["produz", "produces"], consumes: ["consome", "consumes"], measured_by: ["medido por", "measured by"], derived_from: ["derivado de", "derived from"], communicates_with: ["comunica com", "communicates with"], mounted_on: ["montado em", "mounted on"], thermal_coupling: ["acoplamento térmico", "thermal coupling"], unknown: ["A confirmar", "To confirm"]
  };
  return labels[value]?.[language === "pt" ? 0 : 1] ?? value.replaceAll("_", " ");
}

export function formatEngineeringValue(property: Pick<EngineeringProperty, "value" | "unit">): string {
  return `${property.value}${property.unit ? ` ${property.unit}` : ""}`;
}

export function systemVisibleEntities(model: EngineeringSystemModel, parentId: string | null, relevantIds?: Set<string>): EngineeringEntity[] {
  // Requirements are a separate traceability layer, including when migrating a legacy model.
  const entities = model.entities.filter((entity) => String(entity.kind) !== "requirement");
  if (relevantIds) return entities.filter((entity) => relevantIds.has(entity.id));
  if (parentId) return entities.filter((entity) => entity.id === parentId || entity.parentId === parentId || model.relations.some((relation) => relation.kind === "contains" && relation.from === parentId && relation.to === entity.id));
  const roots = new Set(entities.filter((entity) => !entities.some((parent) => parent.id === engineeringParentId(model, entity))).map((entity) => entity.id));
  return entities.filter((entity) => roots.has(entity.id) || roots.has(engineeringParentId(model, entity) ?? ""));
}

export function layoutEngineeringGraph(model: EngineeringSystemModel, entities: EngineeringEntity[], analysis?: EngineeringAnalysis | null) {
  const visible = new Set(entities.map((entity) => entity.id));
  const traversed = analysis ? new Set(analysis.impacts.filter((impact) => impact.status !== "unaffected").flatMap((impact) => impact.traversedRelationIds)) : null;
  const relations = model.relations.filter((relation) => visible.has(relation.from) && visible.has(relation.to) && (!traversed || traversed.has(relation.id)));
  const graph = new graphlib.Graph({ directed: true, multigraph: true }).setGraph({ rankdir: "TB", nodesep: 156, ranksep: 110, marginx: 40, marginy: 40 }).setDefaultEdgeLabel(() => ({}));
  entities.forEach((entity) => graph.setNode(entity.id, { width: ENGINEERING_NODE_WIDTH, height: ENGINEERING_NODE_HEIGHT }));
  const reversedIds = new Set(relations.filter((relation) => analysis?.impacts.some((impact) => impact.path.some((id, index) => id === relation.to && impact.path[index + 1] === relation.from))).map((relation) => relation.id));
  // Architecture ranks express containment. Power/dependency cycles must not
  // turn sibling subsystems into a fake serial hierarchy.
  relations.filter((relation) => analysis || relation.kind === "contains").forEach((relation) => graph.setEdge(reversedIds.has(relation.id) ? relation.to : relation.from, reversedIds.has(relation.id) ? relation.from : relation.to, { weight: 3 }, relation.id));
  // A parentId carries containment too. This affects layout only; it is never evidence for impact.
  const containmentIds = new Set<string>();
  entities.forEach((entity) => {
    if (!analysis && entity.parentId && visible.has(entity.parentId) && !relations.some((relation) => relation.kind === "contains" && relation.from === entity.parentId && relation.to === entity.id)) {
      graph.setEdge(entity.parentId, entity.id, { weight: 3 }, `parent:${entity.id}`);
      containmentIds.add(entity.id);
    }
  });
  layout(graph);
  return {
    width: Math.max(286, graph.graph().width ?? 286), height: Math.max(206, graph.graph().height ?? 206),
    nodes: entities.map((entity) => ({ entity, x: graph.node(entity.id).x - ENGINEERING_NODE_WIDTH / 2, y: graph.node(entity.id).y - ENGINEERING_NODE_HEIGHT / 2 })),
    edges: relations.map((relation) => ({ relation, reversed: reversedIds.has(relation.id), points: (graph.edge({ v: reversedIds.has(relation.id) ? relation.to : relation.from, w: reversedIds.has(relation.id) ? relation.from : relation.to, name: relation.id })?.points ?? []) as Array<{ x: number; y: number }> })),
    containments: entities.filter((entity) => containmentIds.has(entity.id)).map((entity) => ({ id: entity.id, points: graph.edge({ v: entity.parentId!, w: entity.id, name: `parent:${entity.id}` }).points as Array<{ x: number; y: number }> }))
  };
}

export type RequirementFilters = { query?: string; tag?: string; status?: string; source?: string };
export function filterEngineeringRequirements(requirements: EngineeringRequirement[], filters: RequirementFilters): EngineeringRequirement[] {
  const query = filters.query?.trim().toLocaleLowerCase() ?? "";
  return requirements.filter((requirement) => {
    const tags = [...requirement.subsystemTags, ...requirement.reviewTags, requirement.category ?? ""];
    return (!query || [requirement.id, requirement.title, requirement.statement, ...tags].join(" ").toLocaleLowerCase().includes(query))
      && (!filters.tag || tags.includes(filters.tag)) && (!filters.status || requirement.status === filters.status)
      && (!filters.source || requirement.sourceRefs.includes(filters.source));
  });
}

export function requirementTrace(model: EngineeringSystemModel, requirement: EngineeringRequirement): { entities: Set<string>; relations: Set<string> } {
  const relations = new Set(requirement.relatedRelationIds);
  const entities = new Set([...requirement.relatedEntityIds, ...(requirement.relatedPropertyRefs ?? []).map((ref) => ref.entityId)]);
  model.relations.forEach((relation) => {
    if (relation.from === requirement.id || relation.to === requirement.id || relations.has(relation.id)) {
      entities.add(relation.from); entities.add(relation.to); relations.add(relation.id);
    }
  });
  return { entities, relations };
}

export function editEngineeringRequirement(original: EngineeringRequirement, patch: Partial<EngineeringRequirement>): EngineeringRequirement {
  return { ...original, ...patch, originalStatement: original.originalStatement ?? original.statement,
    originalSourceRefs: original.originalSourceRefs ?? original.sourceRefs,
    subsystemTags: (patch.subsystemTags ?? original.subsystemTags).map((tag) => tag.trim().slice(0, 80)).filter(Boolean).slice(0, 20),
    reviewTags: (patch.reviewTags ?? original.reviewTags).map((tag) => tag.trim().slice(0, 80)).filter(Boolean).slice(0, 20)
  };
}

/** Project the analyzed values for display; no scenario ever writes its baseline. */
export function projectEngineeringScenario(model: EngineeringSystemModel, analysis: EngineeringAnalysis): EngineeringSystemModel {
  if (analysis.baseline) model = { ...model, ...analysis.baseline };
  const changed = analysis.change.newValues.map((property, index) => ({ ...property, source: "user" as const, evidenceRefs: property.evidenceRefs.length ? property.evidenceRefs : [`change:${analysis.change.id}:${index}`] }));
  const projectProperties = (id: string, properties: EngineeringProperty[]) => {
    let projected = properties;
    if (id === analysis.changedEntityId) {
      projected = analysis.change.kind === "replace_component" ? changed : [...properties.filter((property) => !changed.some((next) => next.key === property.key)), ...changed];
      if (changed.some((property) => /current|voltage/u.test(property.key))) projected = projected.filter((property) => !["operating_power", "power", "required_power"].includes(property.key) || changed.some((next) => next.key === property.key));
    }
    const impact = analysis.impacts.find((item) => item.entityId === id);
    const calculation = impact?.calculation;
    const resultKey = calculation && ({ sum_power: "total_power", sum_mass: "total_mass", sum_thickness: "total_thickness", energy_over_power: "estimated_autonomy", duty_cycle_power: "average_power", duty_cycle_load: "average_power", energy_balance: calculation.unit === "Wh" ? "energy_margin" : "power_margin", energy_over_interval: "energy_margin" } as Record<string, string>)[calculation.ruleId];
    const hasOwnResult = Boolean(resultKey && calculation && typeof calculation.result === "number" && projected.some((property) => property.key === "formula" && property.value === calculation.ruleId));
    if (hasOwnResult && resultKey && calculation && typeof calculation.result === "number") projected = [...projected.filter((property) => property.key !== resultKey), { key: resultKey, name: resultKey.replaceAll("_", " "), value: calculation.result, unit: calculation.unit, source: "calculated", evidenceRefs: calculation.evidenceRefs }];
    if (impact?.status === "review" && !hasOwnResult && projected.some((property) => property.key === "formula")) projected = projected.filter((property) => property.key === "formula" || property.source !== "calculated");
    return projected;
  };
  return {
    ...model, evidence: analysis.evidence ?? model.evidence,
    entities: model.entities.map((entity) => {
      const replacement = entity.id === analysis.changedEntityId && analysis.change.kind === "replace_component";
      return { ...entity, name: entity.id === analysis.changedEntityId && analysis.change.replacementName ? analysis.change.replacementName : entity.name, properties: projectProperties(entity.id, entity.properties), ...(replacement ? { description: "", source: "user" as const, evidenceRefs: changed.flatMap((property) => property.evidenceRefs) } : {}) };
    }),
    requirements: model.requirements.map((requirement) => ({ ...requirement, properties: projectProperties(requirement.id, requirement.properties) }))
  };
}

export function engineeringRelationDirectionLabel(kind: string, reversed: boolean, language: Language): string {
  if (!reversed) return engineeringLabel(kind, language);
  const labels: Record<string, [string, string]> = { powers: ["alimentado por", "powered by"], depends_on: ["sustenta", "supports"], derived_from: ["usado em", "used by"], constrained_by: ["restringe", "constrains"], requires: ["requerido por", "required by"], consumes: ["consumido por", "consumed by"], measured_by: ["mede", "measures"], mounted_on: ["suporta", "mounts"], contains: ["parte de", "part of"] };
  return labels[kind]?.[language === "pt" ? 0 : 1] ?? engineeringLabel(kind, language);
}

/** Corrections are explicit team inputs. The original document remains inspectable. */
export function correctEngineeringEntity(model: EngineeringSystemModel, original: EngineeringEntity, draft: EngineeringEntity, timestamp = new Date().toISOString(), options: EngineeringCorrectionOptions = {}): EngineeringSystemModel {
  if (draft.parentId) {
    const parent = model.entities.find(entity => entity.id === draft.parentId);
    if (!parent || engineeringAncestors(model, parent.id).some(entity => entity.id === original.id)) throw new Error("Choose a parent outside this element's descendants.");
    if (draft.kind === "component" && (draft.parentId !== original.parentId || draft.kind !== original.kind) && parent.kind !== "subsystem") throw new Error("Place components inside a subsystem.");
    if (draft.kind === "subsystem" && !["system", "subsystem"].includes(parent.kind)) throw new Error("Place subsystems inside a system or subsystem.");
  } else if (draft.kind === "component" && (original.parentId || original.kind !== draft.kind)) throw new Error("Place components inside a subsystem.");
  const evidence = [...model.evidence];
  const originalRefs = new Set([...original.evidenceRefs, ...(options.evidenceRefs ?? []).filter(ref => model.evidence.some(item => item.id === ref))]);
  const properties = draft.properties.map((property) => {
    const previous = original.properties.find((item) => item.key === property.key);
    if (previous && previous.name === property.name && previous.value === property.value && previous.unit === property.unit) return previous;
    previous?.evidenceRefs.forEach((ref) => originalRefs.add(ref));
    const id = reviewId();
    evidence.push({ id, artifactId: "team-review", artifactLabel: "Team review", kind: "user", excerpt: `${original.name} · ${property.name}: ${previous ? formatEngineeringValue(previous) : "?"} → ${formatEngineeringValue(property)} · ${timestamp}`.slice(0, 600) });
    return { ...property, source: "user" as const, evidenceRefs: [id, ...(options.evidenceRefs ?? []).filter((ref) => model.evidence.some((item) => item.id === ref))] };
  });
  let relations = model.relations;
  if (original.parentId !== draft.parentId) {
    relations = relations.filter((relation) => !(relation.kind === "contains" && relation.to === original.id));
    if (draft.parentId) relations = [...relations, { id: reviewId("parent"), from: draft.parentId, to: original.id, kind: "contains", label: "", source: "user", confidence: 1, evidenceRefs: (options.evidenceRefs ?? []).filter(ref => model.evidence.some(item => item.id === ref)) }];
  }
  const corrected: EngineeringEntity = { ...draft, name: draft.name.trim(), properties, evidenceRefs: [...originalRefs], source: original.name !== draft.name || original.description !== draft.description || original.kind !== draft.kind || original.parentId !== draft.parentId ? "user" : original.source };
  if (!corrected.parentId) delete corrected.parentId;
  const relationIds = new Set(relations.map((relation) => relation.id));
  return recordEngineeringCorrections(model, { ...model, evidence, relations, requirements: model.requirements.map((requirement) => ({ ...requirement, relatedRelationIds: requirement.relatedRelationIds.filter((id) => relationIds.has(id)), ...(requirement.relatedPropertyRefs ? { relatedPropertyRefs: requirement.relatedPropertyRefs.filter(ref => ref.entityId !== original.id || corrected.properties.some(property => property.key === ref.propertyKey)) } : {}) })), entities: model.entities.map((entity) => entity.id === original.id ? corrected : entity) }, options, timestamp);
}

export function removeEngineeringRelation(model: EngineeringSystemModel, id: string, options: EngineeringCorrectionOptions = {}, timestamp = new Date().toISOString()): EngineeringSystemModel {
  const removed = model.relations.find((relation) => relation.id === id);
  return recordEngineeringCorrections(model, { ...model, entities: model.entities.map((entity) => {
    if (removed?.kind !== "contains" || entity.id !== removed.to || entity.parentId !== removed.from) return entity;
    const corrected = { ...entity }; delete corrected.parentId; return corrected;
  }), relations: model.relations.filter((relation) => relation.id !== id), requirements: model.requirements.map((requirement) => ({ ...requirement, relatedRelationIds: requirement.relatedRelationIds.filter((relationId) => relationId !== id) })) }, options, timestamp);
}

export function correctEngineeringRelation(model: EngineeringSystemModel, original: EngineeringRelation | null, draft: EngineeringRelation, timestamp = new Date().toISOString(), options: EngineeringCorrectionOptions = {}): EngineeringSystemModel {
  const objects = [...model.entities.map((entity) => ({ id: entity.id, name: entity.name })), ...model.requirements.map((requirement) => ({ id: requirement.id, name: requirement.title }))];
  if (draft.from === draft.to || !objects.some((object) => object.id === draft.from) || !objects.some((object) => object.id === draft.to)) throw new Error("Choose two different existing engineering objects.");
  if (draft.kind === "contains") {
    if (!model.entities.some((entity) => entity.id === draft.from) || !model.entities.some((entity) => entity.id === draft.to)) throw new Error("Containment connects engineering entities.");
    const visited = new Set<string>();
    let parent: string | undefined = draft.from;
    while (parent && !visited.has(parent)) { if (parent === draft.to) throw new Error("This containment would create a cycle."); visited.add(parent); parent = model.entities.find((entity) => entity.id === parent)?.parentId; }
  }
  const id = original?.id ?? reviewId("relation");
  const evidenceId = reviewId();
  const selectedRefs = [...new Set([...draft.evidenceRefs, ...(options.evidenceRefs ?? [])])].filter((ref) => model.evidence.some((item) => item.id === ref));
  const corrected: EngineeringRelation = { ...draft, id, source: "user", confidence: 1, evidenceRefs: [evidenceId, ...selectedRefs] };
  const evidence = [...model.evidence, { id: evidenceId, artifactId: "team-review", artifactLabel: "Team review", excerpt: `${objects.find((object) => object.id === draft.from)?.name} · ${draft.kind} · ${objects.find((object) => object.id === draft.to)?.name} · ${timestamp}`, kind: "user" as const }];
  let relations = [...model.relations.filter((relation) => relation.id !== id), corrected];
  const entities = model.entities.map((entity) => {
    const next = { ...entity };
    if (original?.kind === "contains" && entity.id === original.to && next.parentId === original.from) delete next.parentId;
    if (draft.kind === "contains" && entity.id === draft.to) next.parentId = draft.from;
    return next;
  });
  if (draft.kind === "contains") relations = relations.filter((relation) => relation.id === id || relation.kind !== "contains" || relation.to !== draft.to);
  const relationIds = new Set(relations.map((relation) => relation.id));
  const requirements = model.requirements.map((requirement) => ({ ...requirement, relatedRelationIds: requirement.relatedRelationIds.filter((relationId) => relationIds.has(relationId)) }));
  return recordEngineeringCorrections(model, { ...model, entities, evidence, relations, requirements }, { ...options, evidenceRefs: selectedRefs }, timestamp);
}

export function engineeringParentCandidates(model: EngineeringSystemModel, entityId: string, kind = model.entities.find(entity => entity.id === entityId)?.kind): EngineeringEntity[] {
  const descendants = new Set([entityId]);
  let changed = true;
  while (changed) {
    changed = false;
    model.entities.forEach((entity) => {
      if (!descendants.has(entity.id) && (entity.parentId && descendants.has(entity.parentId) || model.relations.some((relation) => relation.kind === "contains" && relation.to === entity.id && descendants.has(relation.from)))) { descendants.add(entity.id); changed = true; }
    });
  }
  return model.entities.filter(entity => !descendants.has(entity.id) && ["system", "subsystem", "component"].includes(entity.kind) && (kind === "component" ? entity.kind === "subsystem" : kind !== "subsystem" || entity.kind !== "component"));
}

export function correctEngineeringRequirement(model: EngineeringSystemModel, original: EngineeringRequirement, draft: EngineeringRequirement, timestamp = new Date().toISOString(), options: EngineeringCorrectionOptions = {}): EngineeringSystemModel {
  const evidence = [...model.evidence];
  const properties = draft.properties.map((property) => {
    const previous = original.properties.find((item) => item.key === property.key);
    if (previous?.value === property.value && previous.unit === property.unit) return previous;
    const id = reviewId();
    evidence.push({ id, artifactId: "team-review", artifactLabel: "Team review", kind: "user", excerpt: `${original.title} · ${property.name}: ${previous ? formatEngineeringValue(previous) : "?"} → ${formatEngineeringValue(property)} · ${timestamp}`.slice(0, 600) });
    return { ...property, source: "user" as const, evidenceRefs: [id, ...draft.sourceRefs] };
  });
  const corrected = editEngineeringRequirement(original, { ...draft, properties, classificationSource: "user" });
  return recordEngineeringCorrections(model, { ...model, evidence, requirements: model.requirements.map((requirement) => requirement.id === original.id ? corrected : requirement) }, { ...options, evidenceRefs: draft.sourceRefs }, timestamp);
}
