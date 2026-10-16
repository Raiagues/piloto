import type { EngineeringEntity, EngineeringEntityKind, EngineeringSystemModel, EngineeringRelation } from "./engineeringSystem";
import { engineeringAncestors, engineeringParentId } from "./engineeringUi";
import { recordEngineeringCorrections, type EngineeringCorrectionOptions } from "./engineeringCorrections";
import { mergeArchitectureAliases } from "../../shared/engineering-architecture.mjs";

export type ArchitectureInterface = { from: string; to: string; relations: EngineeringRelation[]; aggregated: boolean };
export function architectureScope(model: EngineeringSystemModel, scopeId: string | null) {
  const root = model.entities.find(entity => entity.id === scopeId) ?? model.entities.find(entity => entity.kind === "system" && !engineeringParentId(model, entity));
  const children = model.entities.filter(entity => root ? engineeringParentId(model, entity) === root.id : !engineeringParentId(model, entity));
  const descendants = model.entities.filter(entity => !root || entity.id !== root.id && engineeringAncestors(model, entity.id).some(parent => parent.id === root.id));
  return { root, children, descendants };
}
/** Collapse endpoints only for presentation. Every aggregate retains original relations for inspection. */
export function architectureInterfaces(model: EngineeringSystemModel, scopeId: string | null): ArchitectureInterface[] {
  const { root, children } = architectureScope(model, scopeId);
  const visible = new Set(children.map(entity => entity.id));
  const representative = (id: string) => engineeringAncestors(model, id).find(entity => visible.has(entity.id))?.id;
  const groups = new Map<string, ArchitectureInterface>();
  for (const relation of model.relations) {
    if (relation.kind === "contains") continue;
    const from = representative(relation.from), to = representative(relation.to);
    if (!from || !to || from === to || relation.from === root?.id || relation.to === root?.id) continue;
    const key = `${from}:${to}`, previous = groups.get(key);
    groups.set(key, { from, to, relations: [...(previous?.relations ?? []), relation], aggregated: Boolean(previous?.aggregated || from !== relation.from || to !== relation.to) });
  }
  return [...groups.values()];
}
export function architectureIssues(model: EngineeringSystemModel) {
  return model.entities.filter(entity => entity.kind === "component" && model.entities.find(parent => parent.id === engineeringParentId(model, entity))?.kind !== "subsystem" || entity.kind === "subsystem" && /\b(solar panel|pcb|microcontroller|resistor|regulator|sensor|painel solar|resistor|sensor)\b/iu.test(entity.name));
}
export function mergeEngineeringAliases(model: EngineeringSystemModel, ids: string[], options: EngineeringCorrectionOptions = {}) {
  return recordEngineeringCorrections(model, mergeArchitectureAliases(model, ids) as EngineeringSystemModel, options);
}
export function createManualEngineeringSystem(name: string, memoryRevision = 0): EngineeringSystemModel {
  const id = `system-${crypto.randomUUID()}`;
  return { schemaVersion: 1, id: `model-${crypto.randomUUID()}`, name: name.slice(0, 140), entities: [{ id, name: name.slice(0, 140), kind: "system", description: "", properties: [], source: "user", evidenceRefs: [], confidence: 1 }], relations: [], requirements: [], evidence: [], artifactSources: [], generatedAt: new Date().toISOString(), generatedFromRevision: memoryRevision };
}
export function addEngineeringEntity(model: EngineeringSystemModel, name: string, kind: EngineeringEntityKind, parentId: string | undefined, options: EngineeringCorrectionOptions = {}) {
  if (!name.trim()) throw new Error("Give the element a name.");
  const parent = model.entities.find(entity => entity.id === parentId);
  if (!parent || !["system", "subsystem", "component"].includes(parent.kind)) throw new Error("Choose an existing parent.");
  if (kind === "component" && parent.kind !== "subsystem") throw new Error("Place components inside a subsystem.");
  if (kind === "subsystem" && !["system", "subsystem"].includes(parent.kind)) throw new Error("Place subsystems inside a system or subsystem.");
  const entity: EngineeringEntity = { id: `element-${crypto.randomUUID()}`, name: name.trim().slice(0, 140), kind, parentId: parent.id, description: "", properties: [], source: "user", evidenceRefs: [], confidence: 1 };
  return recordEngineeringCorrections(model, { ...model, entities: [...model.entities, entity] }, options);
}

/** Interfaces crossing this selected system boundary, kept at their documented endpoints. */
export function architectureBoundaryInterfaces(model: EngineeringSystemModel, scopeId: string | null): EngineeringRelation[] {
  const { root, descendants } = architectureScope(model, scopeId);
  if (!root) return [];
  const inside = new Set([root.id, ...descendants.map(entity => entity.id)]);
  const known = new Set(model.entities.map(entity => entity.id));
  return model.relations.filter(relation => relation.kind !== "contains" && known.has(relation.from) && known.has(relation.to) && inside.has(relation.from) !== inside.has(relation.to));
}
