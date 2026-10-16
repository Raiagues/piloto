import { describeEngineeringSystemViolation } from "../shared/engineering-schema.mjs";
import { createHash } from "node:crypto";

const key = (name) => name.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]/gu, "");

// A named subsystem such as "Electrical Power System (EPS)" explicitly
// identifies EPS as its alias. Never infer aliases from initials, translated
// words or component part numbers; identical components may be separate units.
function chunkEntityKey(entity) {
  if (["system", "subsystem"].includes(entity.kind)) {
    const name = entity.name.trim();
    const acronym = /^[A-Z][A-Z0-9&-]{1,11}$/u.test(name) ? name : /^.+\(([A-Z][A-Z0-9&-]{1,11})\)$/u.exec(name)?.[1];
    if (acronym) return `explicit-acronym:${acronym}`;
  }
  return key(entity.name);
}

/** Add verified source fragments without replacing existing technical values. */
export function mergeSourceModels(baseline, fragments) {
  const result = structuredClone(baseline);
  const initialRoots = result.entities.filter((entity) => !entity.parentId && !result.relations.some((relation) => relation.kind === "contains" && relation.to === entity.id));
  let missionRoot;
  for (const { id, model } of fragments) {
    const prefix = `source-${id.toLowerCase()}-`;
    const entityIds = new Map(), evidenceIds = new Map(model.evidence.map((item) => [item.id, prefix + item.id]));
    const relationIds = new Map(model.relations.map((item) => [item.id, prefix + item.id]));
    for (const entity of model.entities) {
      const matches = result.entities.filter((item) => key(item.name) === key(entity.name) && item.kind === entity.kind);
      entityIds.set(entity.id, matches.length === 1 ? matches[0].id : prefix + entity.id);
    }
    // Overview extractions sometimes call an already documented subsystem a
    // component. Reuse a unique exact name under the same resolved parent;
    // the existing detailed classification and values take precedence.
    for (const entity of model.entities) {
      if (!entity.parentId || !["subsystem", "component"].includes(entity.kind) || result.entities.some((item) => item.id === entityIds.get(entity.id))) continue;
      const matches = result.entities.filter((item) => key(item.name) === key(entity.name) && ["subsystem", "component"].includes(item.kind) && item.parentId === entityIds.get(entity.parentId));
      if (matches.length === 1) entityIds.set(entity.id, matches[0].id);
    }
    const refs = (ids) => ids.map((id) => evidenceIds.get(id));
    const properties = (items) => items.map((item) => ({ ...item, evidenceRefs: refs(item.evidenceRefs) }));
    result.evidence.push(...model.evidence.map((item) => ({ ...item, id: evidenceIds.get(item.id) })));
    for (const entity of model.entities) {
      const mapped = { ...entity, id: entityIds.get(entity.id), evidenceRefs: refs(entity.evidenceRefs), properties: properties(entity.properties), ...(entity.parentId ? { parentId: entityIds.get(entity.parentId) } : {}) };
      const existing = result.entities.find((item) => item.id === mapped.id);
      if (!existing) result.entities.push(mapped);
      else {
        existing.evidenceRefs = [...new Set([...existing.evidenceRefs, ...mapped.evidenceRefs])];
        existing.properties.push(...mapped.properties.filter((property) => !existing.properties.some((item) => item.key === property.key)));
      }
      if (!entity.parentId && entity.kind === "system") missionRoot ??= mapped.id;
    }
    for (const relation of model.relations) {
      const from = entityIds.get(relation.from), to = entityIds.get(relation.to);
      const existing = result.relations.find((item) => item.from === from && item.to === to && item.kind === relation.kind);
      if (existing) relationIds.set(relation.id, existing.id);
      else result.relations.push({ ...relation, id: relationIds.get(relation.id), from, to, evidenceRefs: refs(relation.evidenceRefs) });
    }
    result.requirements.push(...model.requirements.map((item) => ({ ...item, id: prefix + item.id, sourceRefs: refs(item.sourceRefs), originalSourceRefs: refs(item.originalSourceRefs ?? item.sourceRefs), relatedEntityIds: item.relatedEntityIds.map((id) => entityIds.get(id)), relatedRelationIds: item.relatedRelationIds.map((id) => relationIds.get(id)), ...(item.relatedPropertyRefs ? { relatedPropertyRefs: item.relatedPropertyRefs.map((ref) => ({ ...ref, entityId: entityIds.get(ref.entityId) })) } : {}), properties: properties(item.properties) })));
    for (const source of model.artifactSources) if (!result.artifactSources.some((item) => item.artifactId === source.artifactId)) result.artifactSources.push(source);
  }
  // This is organizational grouping inside the same project, not a new causal edge.
  if (missionRoot) for (const root of initialRoots) if (root.id !== missionRoot) root.parentId = missionRoot;
  const snapshot = { entities: baseline.entities, relations: baseline.relations, requirements: baseline.requirements, evidence: baseline.evidence };
  if (baseline.scenarios) result.scenarios = baseline.scenarios.map((scenario) => ({ ...scenario, baseline: scenario.baseline ?? structuredClone(snapshot) }));
  result.revision = (baseline.revision || 0) + 1;
  const violation = describeEngineeringSystemViolation(result);
  if (violation) throw new Error(`Source extension violates the engineering model contract: ${violation}`);
  return result;
}

/** Merge independent verified chunks. Names and explicit subsystem acronyms
 * are parent-sensitive; components require an exact name.
 * Conflicting values are reported for review, never silently averaged/replaced.
 * Unlike the legacy extension importer, this never invents a parent hierarchy.
 */
export function mergeChunkModels(project, fragments) {
  const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24);
  const result = { schemaVersion: 1, id: `system-${project.id}`, name: project.name, entities: [], relations: [], requirements: [], evidence: [], artifactSources: [], generatedAt: new Date().toISOString(), generatedFromRevision: project.memoryRevision || 0 };
  const conflicts = [], entityIdentity = new Map(), evidenceIdentity = new Map(), relationIdentity = new Map();
  const union = (a, b) => [...new Set([...a, ...b])];
  function properties(existing, candidates, entityId) {
    for (const property of candidates) {
      const current = existing.find((item) => item.key === property.key);
      if (!current) existing.push(property);
      else if (current.value === property.value && (current.unit || "") === (property.unit || "")) current.evidenceRefs = union(current.evidenceRefs, property.evidenceRefs);
      else if (!conflicts.some((item) => item.entityId === entityId && item.key === property.key && item.candidate.value === property.value && item.candidate.unit === property.unit)) conflicts.push({ kind: "property", entityId, key: property.key, kept: structuredClone(current), candidate: structuredClone(property), reason: "Fontes apresentam valores diferentes; confirmar revisão, condição de operação e unidade." });
    }
  }
  for (const { id: fragmentId, model } of fragments) {
    const evidenceIds = new Map(), entityIds = new Map(), relationIds = new Map();
    for (const record of model.evidence) {
      const identity = hash([record.artifactId, record.excerpt, record.kind]);
      const id = `ev-${identity}`;
      evidenceIds.set(record.id, id);
      if (!evidenceIdentity.has(identity)) { evidenceIdentity.set(identity, id); result.evidence.push({ ...record, id }); }
    }
    const refs = (ids) => (ids || []).map((id) => evidenceIds.get(id));
    const mapProperties = (items) => items.map((property) => ({ ...property, evidenceRefs: refs(property.evidenceRefs) }));
    const local = new Map(model.entities.map((entity) => [entity.id, entity]));
    function mapEntity(entity) {
      if (entityIds.has(entity.id)) return entityIds.get(entity.id);
      const parentId = entity.parentId ? mapEntity(local.get(entity.parentId)) : "";
      const identity = [entity.kind, chunkEntityKey(entity), parentId];
      const id = `obj-${hash(identity)}`;
      entityIds.set(entity.id, id);
      if (!entityIdentity.has(id)) {
        const next = { ...entity, id, evidenceRefs: refs(entity.evidenceRefs), properties: mapProperties(entity.properties) };
        if (parentId) next.parentId = parentId; else delete next.parentId;
        result.entities.push(next); entityIdentity.set(id, next);
      } else {
        const current = entityIdentity.get(id);
        current.evidenceRefs = union(current.evidenceRefs, refs(entity.evidenceRefs));
        properties(current.properties, mapProperties(entity.properties), id);
      }
      return id;
    }
    for (const entity of model.entities) mapEntity(entity);
    const requirementIds = new Map();
    for (const requirement of model.requirements) {
      const current = result.requirements.find((item) => item.id === requirement.id);
      let id = requirement.id;
      if (current && current.statement !== requirement.statement) {
        id = `${requirement.id.slice(0,65)}-${hash([fragmentId, requirement.statement])}`;
        conflicts.push({ kind: "requirement", requirementId: requirement.id, alternativeId: id, reason: "Mesmo identificador com enunciados diferentes; ambas as fontes foram preservadas." });
      }
      requirementIds.set(requirement.id, id);
    }
    for (const relation of model.relations) {
      const from = entityIds.get(relation.from) || requirementIds.get(relation.from);
      const to = entityIds.get(relation.to) || requirementIds.get(relation.to);
      if (from === to) throw new Error("A fusão de fontes não pode transformar uma relação em autorreferência.");
      const id = `rel-${hash([from, to, relation.kind, relation.source])}`;
      relationIds.set(relation.id, id);
      if (!relationIdentity.has(id)) {
        const next = { ...relation, id, from, to, evidenceRefs: refs(relation.evidenceRefs) };
        relationIdentity.set(id, next); result.relations.push(next);
      } else relationIdentity.get(id).evidenceRefs = union(relationIdentity.get(id).evidenceRefs, refs(relation.evidenceRefs));
    }
    for (const requirement of model.requirements) {
      const id = requirementIds.get(requirement.id);
      const sourceRefs = refs(requirement.sourceRefs);
      const mapped = { ...requirement, id, sourceRefs, originalSourceRefs: sourceRefs, relatedEntityIds: requirement.relatedEntityIds.map((id) => entityIds.get(id)), relatedRelationIds: requirement.relatedRelationIds.map((id) => relationIds.get(id)), properties: mapProperties(requirement.properties), ...(requirement.relatedPropertyRefs ? { relatedPropertyRefs: requirement.relatedPropertyRefs.map((ref) => ({ ...ref, entityId: entityIds.get(ref.entityId) })) } : {}) };
      const current = result.requirements.find((item) => item.id === id);
      if (!current) result.requirements.push(mapped);
      else {
        current.sourceRefs = union(current.sourceRefs, sourceRefs); current.originalSourceRefs = current.sourceRefs;
        current.relatedEntityIds = union(current.relatedEntityIds, mapped.relatedEntityIds);
        current.relatedRelationIds = union(current.relatedRelationIds, mapped.relatedRelationIds);
        properties(current.properties, mapped.properties, id);
      }
    }
    for (const source of model.artifactSources) if (!result.artifactSources.some((item) => item.artifactId === source.artifactId)) result.artifactSources.push(source);
  }
  const violation = describeEngineeringSystemViolation(result);
  if (violation) throw Object.assign(new Error(`A montagem dos trechos excede os limites ou apresenta conflito estrutural: ${violation}. Os checkpoints foram preservados.`), { code: "SYSTEM_MERGE_INVALID" });
  return { model: result, conflicts };
}
