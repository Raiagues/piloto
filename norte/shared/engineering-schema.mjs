import { HYPOTHESIS_MAX_LENGTH } from "./discovery-limits.mjs";
export const ENGINEERING_LIMITS = Object.freeze({ entities: 1000, relations: 3000, requirements: 2000, evidence: 8000, references: 2000, entityProperties: 1000, correctionContext: 8, correctionHistory: 1000 });
const str = (maxLength = 500, minLength = 0) => ({ type: "string", maxLength, minLength });
const list = (items, maxItems = 200) => ({ type: "array", items, maxItems });
const obj = (properties, required = Object.keys(properties)) => ({ type: "object", additionalProperties: false, properties, required });
// A long-document merge may accumulate references across hundreds of fragments.
// Per-request extraction limits are stricter than these persisted graph bounds.
const refs = () => list(str(140, 1), ENGINEERING_LIMITS.references);
const source = { type: "string", enum: ["documented", "calculated", "inferred", "user"] };
const confidence = { type: "number", minimum: 0, maximum: 1 };
export const propertySchema = obj({ key: str(100, 1), name: str(140, 1), value: { anyOf: [{ type: "number" }, str(500)] }, unit: str(30), source, evidenceRefs: refs() }, ["key", "name", "value", "source", "evidenceRefs"]);
export const evidenceSchema = obj({ id: str(140, 1), artifactId: str(140, 1), artifactLabel: str(160, 1), locator: str(160), excerpt: str(600, 1), kind: { type: "string", enum: ["fact", "calculation", "inference", "user"] } }, ["id", "artifactId", "artifactLabel", "excerpt", "kind"]);
export const entitySchema = obj({ id: str(100, 1), name: str(140, 1), kind: { type: "string", enum: ["system", "subsystem", "component", "parameter", "calculation", "performance", "interface"] }, parentId: str(100), description: str(600), properties: list(propertySchema, ENGINEERING_LIMITS.entityProperties), source, evidenceRefs: refs(), confidence }, ["id", "name", "kind", "description", "properties", "source", "evidenceRefs", "confidence"]);
export const relationSchema = obj({ id: str(100, 1), from: str(100, 1), to: str(100, 1), kind: { type: "string", enum: ["contains", "powers", "connects_to", "depends_on", "affects", "contributes_to", "constrained_by", "satisfies", "requires", "produces", "consumes", "measured_by", "derived_from", "communicates_with", "mounted_on", "thermal_coupling", "unknown"] }, label: str(160), source, evidenceRefs: refs(), confidence });
export const requirementSchema = obj({ id: str(100, 1), title: str(160, 1), statement: str(1200, 1), originalStatement: str(1200), category: str(100), subsystemTags: list(str(80), 20), reviewTags: list(str(80), 20), status: { type: "string", enum: ["unreviewed", "accepted", "review", "verified"] }, sourceRefs: refs(), originalSourceRefs: refs(), relatedEntityIds: refs(), relatedRelationIds: refs(), relatedPropertyRefs: list(obj({ entityId: str(100, 1), propertyKey: str(100, 1) })), properties: list(propertySchema, 40), classificationSource: source }, ["id", "title", "statement", "subsystemTags", "reviewTags", "status", "sourceRefs", "relatedEntityIds", "relatedRelationIds", "properties"]);
export const changeSchema = obj({ id: str(100, 1), targetEntityId: str(100, 1), kind: { type: "string", enum: ["replace_component", "parameter", "requirement"] }, oldValues: list(propertySchema, 40), newValues: list(propertySchema, 40), replacementName: str(140), description: str(HYPOTHESIS_MAX_LENGTH), createdAt: str(40, 1) }, ["id", "targetEntityId", "kind", "oldValues", "newValues", "description", "createdAt"]);
const inputSchema = obj({ entityId: str(100, 1), propertyKey: str(100, 1), value: { type: "number" }, unit: str(30), evidenceRefs: refs() });
const calculationSchema = obj({ ruleId: str(100, 1), expression: str(800), inputs: list(inputSchema), result: { anyOf: [{ type: "number" }, { type: "boolean" }] }, unit: str(30), evidenceRefs: refs() }, ["ruleId", "expression", "inputs", "result", "evidenceRefs"]);
const reasoningSchema = obj({ type: { type: "string", enum: ["fact", "calculation", "inference", "unknown"] }, sourceRefs: refs(), inputFacts: list(inputSchema), traversedRelationIds: refs(), ruleId: str(100), calculation: calculationSchema, shortExplanation: str(800), confidence, model: str(100), createdAt: str(40, 1) }, ["type", "sourceRefs", "inputFacts", "traversedRelationIds", "shortExplanation", "confidence", "createdAt"]);
const impactSchema = obj({ entityId: str(100, 1), status: { type: "string", enum: ["changed", "valid", "review", "critical", "unaffected"] }, reasonCode: str(100), shortExplanation: str(800), path: refs(), traversedRelationIds: refs(), evidenceRefs: refs(), calculation: calculationSchema, reasoning: reasoningSchema, confidence }, ["entityId", "status", "reasonCode", "shortExplanation", "path", "traversedRelationIds", "evidenceRefs", "reasoning", "confidence"]);
export const analysisSchema = obj({ baseline: obj({ entities: list(entitySchema, ENGINEERING_LIMITS.entities), relations: list(relationSchema, ENGINEERING_LIMITS.relations), requirements: list(requirementSchema, ENGINEERING_LIMITS.requirements), evidence: list(evidenceSchema, ENGINEERING_LIMITS.evidence) }), id: str(140, 1), changeId: str(100, 1), changedEntityId: str(100, 1), change: changeSchema, impacts: list(impactSchema, 400), calculations: list(calculationSchema, 400), evidence: list(evidenceSchema, ENGINEERING_LIMITS.evidence), unresolvedQuestions: list(str(800), 400), createdAt: str(40, 1), model: str(100), metrics: obj({ impacted: { type: "integer" }, critical: { type: "integer" }, review: { type: "integer" }, evidenced: { type: "integer" }, inferred: { type: "integer" } }) }, ["id", "changeId", "changedEntityId", "change", "impacts", "calculations", "unresolvedQuestions", "createdAt", "metrics"]);
const correctionSnapshotSchema = { anyOf: [{ type: "null" }, obj({ entity: entitySchema }), obj({ relation: relationSchema }), obj({ requirement: requirementSchema })] };
export const correctionSchema = obj({
  id: str(100, 1), transactionId: str(100, 1), objectKind: { type: "string", enum: ["entity", "relation", "requirement"] }, operation: { type: "string", enum: ["create", "update", "delete"] }, targetId: str(100, 1),
  suggested: correctionSnapshotSchema, previous: correctionSnapshotSchema, corrected: correctionSnapshotSchema,
  context: obj({ baselineId: str(100, 1), baselineRevision: { type: "integer", minimum: 0 }, generatedFromRevision: { type: "integer", minimum: 0 }, projectId: str(100, 1), projectName: str(200), projectType: str(140), entities: list(entitySchema, ENGINEERING_LIMITS.correctionContext), entitiesTruncated: { type: "boolean" } }, ["baselineId", "baselineRevision", "generatedFromRevision", "entities", "entitiesTruncated"]),
  suggestedEvidence: list(evidenceSchema, ENGINEERING_LIMITS.evidence), previousEvidence: list(evidenceSchema, ENGINEERING_LIMITS.evidence), correctedEvidence: list(evidenceSchema, ENGINEERING_LIMITS.evidence), createdAt: str(40, 1)
});
export const engineeringSystemSchema = obj({ schemaVersion: { type: "integer", enum: [1] }, id: str(100, 1), name: str(140, 1), entities: list(entitySchema, ENGINEERING_LIMITS.entities), relations: list(relationSchema, ENGINEERING_LIMITS.relations), requirements: list(requirementSchema, ENGINEERING_LIMITS.requirements), evidence: list(evidenceSchema, ENGINEERING_LIMITS.evidence), artifactSources: list(obj({ artifactId: str(140, 1), artifactLabel: str(160, 1), status: { type: "string", enum: ["parsed", "pdf", "metadata_only", "not_parsed"] }, reason: str(500) }, ["artifactId", "artifactLabel", "status"])), generatedAt: str(40, 1), generatedFromRevision: { type: "integer", minimum: 0 }, model: str(100), revision: { type: "integer", minimum: 0 }, scenarios: list(analysisSchema, 30), corrections: list(correctionSchema, ENGINEERING_LIMITS.correctionHistory) }, ["schemaVersion", "id", "name", "entities", "relations", "requirements", "evidence", "artifactSources", "generatedAt", "generatedFromRevision"]);
export const generationRequestSchema = obj({ projectId: str(100, 1), language: { type: "string", enum: ["pt", "en"] } }, ["projectId"]);

/** The same bounded JSON Schema is used at HTTP and provider response boundaries. */
export function matchesSchema(value, schema) {
  if (schema.anyOf) return schema.anyOf.some((alternative) => matchesSchema(value, alternative));
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (schema.type === "string") return typeof value === "string" && value.length >= (schema.minLength ?? 0) && value.length <= (schema.maxLength ?? Infinity);
  if (schema.type === "number" || schema.type === "integer") return typeof value === "number" && Number.isFinite(value) && (schema.type !== "integer" || Number.isInteger(value)) && value >= (schema.minimum ?? -Infinity) && value <= (schema.maximum ?? Infinity);
  if (schema.type === "boolean") return typeof value === "boolean";
  if (schema.type === "null") return value === null;
  if (schema.type === "array") return Array.isArray(value) && value.length <= (schema.maxItems ?? Infinity) && value.every((item) => matchesSchema(item, schema.items));
  if (schema.type === "object") return value !== null && typeof value === "object" && !Array.isArray(value) && schema.required.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => Object.hasOwn(schema.properties, key) && matchesSchema(value[key], schema.properties[key]));
  return false;
}

/** An actionable contract error lets a bounded retry fix the offending field. */
export function describeSchemaViolation(value, schema, path = "response") {
  if (matchesSchema(value, schema)) return null;
  if (schema.anyOf) return `${path} has an unsupported value type`;
  if (schema.enum && !schema.enum.includes(value)) return `${path} must use one of: ${schema.enum.join(", ")}`;
  if (schema.type === "object") {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return `${path} must be an object`;
    const missing = schema.required.find((key) => !Object.hasOwn(value,key));
    if (missing) return `${path}.${missing} is required`;
    for (const [key, child] of Object.entries(value)) {
      if (!Object.hasOwn(schema.properties,key)) return `${path}.${key} is not allowed`;
      const error = describeSchemaViolation(child,schema.properties[key],`${path}.${key}`);
      if (error) return error;
    }
  }
  if (schema.type === "array") {
    if (!Array.isArray(value)) return `${path} must be an array`;
    if (value.length > (schema.maxItems ?? Infinity)) return `${path} exceeds ${schema.maxItems} items`;
    for (let index = 0; index < value.length; index += 1) {
      const error = describeSchemaViolation(value[index],schema.items,`${path}[${index}]`);
      if (error) return error;
    }
  }
  if (schema.type === "string") return typeof value !== "string" ? `${path} must be a string; omit optional fields instead of null` : `${path} must have ${schema.minLength ?? 0}–${schema.maxLength ?? "unbounded"} characters`;
  if (["number","integer"].includes(schema.type)) return `${path} must be a finite ${schema.type} between ${schema.minimum ?? "-infinity"} and ${schema.maximum ?? "infinity"}`;
  return `${path} has an invalid ${schema.type} value`;
}

/**
 * Name the first violated rule, or null when the model is valid.
 *
 * "Invalid fields or references" is useless to whoever has to fix it. Every
 * check below returns the object and field that actually failed, so a rejected
 * extraction can be diagnosed from the error alone.
 */
export function describeEngineeringSystemViolation(model) {
  if (!matchesSchema(model, engineeringSystemSchema)) return `the response does not match the engineering schema: ${describeSchemaViolation(model, engineeringSystemSchema)}`;
  const entities = new Map(model.entities.map((item) => [item.id, item]));
  const requirements = new Set(model.requirements.map((item) => item.id));
  const relations = new Set(model.relations.map((item) => item.id));
  const evidence = new Set(model.evidence.map((item) => item.id));
  if (entities.size !== model.entities.length) return "duplicate entity id";
  if (requirements.size !== model.requirements.length) return "duplicate requirement id";
  if (relations.size !== model.relations.length) return "duplicate relation id";
  if (evidence.size !== model.evidence.length) return "duplicate evidence id";
  const collision = [...requirements].find((id) => entities.has(id));
  if (collision) return `id ${collision} is used by both an entity and a requirement`;

  const unknownRef = (refs) => refs.find((ref) => !evidence.has(ref));
  const propertyViolation = (owner, properties) => {
    const keys = properties.map((item) => item.key);
    const duplicate = keys.find((key, index) => keys.indexOf(key) !== index);
    if (duplicate) return `${owner} repeats property ${duplicate}`;
    for (const property of properties) {
      const missing = unknownRef(property.evidenceRefs);
      if (missing) return `${owner} property ${property.key} cites ${missing}, which is not an evidence id`;
    }
    return null;
  };

  for (const entity of model.entities) {
    const missing = unknownRef(entity.evidenceRefs);
    if (missing) return `entity ${entity.id} cites ${missing}, which is not an evidence id`;
    const property = propertyViolation(`entity ${entity.id}`, entity.properties);
    if (property) return property;
    const visited = new Set([entity.id]);
    let parent = entity.parentId;
    while (parent) {
      if (!entities.has(parent)) return `entity ${entity.id} has parentId ${parent}, which does not exist`;
      if (visited.has(parent)) return `entity ${entity.id} sits in a parentId cycle`;
      visited.add(parent);
      parent = entities.get(parent).parentId;
    }
  }

  for (const relation of model.relations) {
    const known = (id) => entities.has(id) || requirements.has(id);
    if (!known(relation.from)) return `relation ${relation.id} starts at ${relation.from}, which does not exist`;
    if (!known(relation.to)) return `relation ${relation.id} ends at ${relation.to}, which does not exist`;
    if (relation.from === relation.to) return `relation ${relation.id} connects ${relation.from} to itself`;
    const missing = unknownRef(relation.evidenceRefs);
    if (missing) return `relation ${relation.id} cites ${missing}, which is not an evidence id`;
  }

  for (const scenario of model.scenarios || []) {
    if (!scenario.baseline) continue;
    const violation = describeEngineeringSystemViolation({ ...model, ...scenario.baseline, scenarios: [], corrections: [] });
    if (violation) return `scenario ${scenario.id} archived baseline: ${violation}`;
  }

  // Historical correction snapshots are self-contained. Their objects may have since been removed.
  const corrections = model.corrections || [];
  if (new Set(corrections.map((item) => item.id)).size !== corrections.length) return "duplicate correction id";
  for (const correction of corrections) {
    if (correction.context.baselineId !== model.id) return `correction ${correction.id} belongs to another baseline`;
    if (correction.context.baselineRevision > (model.revision || 0)) return `correction ${correction.id} claims a future baseline revision`;
    const shape = correction.operation === "create" ? correction.previous === null && correction.corrected !== null
      : correction.operation === "update" ? correction.previous !== null && correction.corrected !== null
        : correction.previous !== null && correction.corrected === null;
    if (!shape) return `correction ${correction.id} does not match its ${correction.operation} operation`;
    for (const [snapshot, sources] of [[correction.suggested, correction.suggestedEvidence], [correction.previous, correction.previousEvidence], [correction.corrected, correction.correctedEvidence]]) {
      if (!snapshot) continue;
      const object = snapshot[correction.objectKind];
      if (!object || object.id !== correction.targetId) return `correction ${correction.id} snapshots a different object`;
      const sourceIds = new Set(sources.map((item) => item.id));
      const refs = [...(object.evidenceRefs || object.sourceRefs || []), ...(object.originalSourceRefs || []), ...(object.properties || []).flatMap((property) => property.evidenceRefs)];
      if (refs.some((id) => !sourceIds.has(id))) return `correction ${correction.id} cites evidence missing from its snapshot`;
    }
    const contextSources = new Set([...correction.suggestedEvidence, ...correction.previousEvidence, ...correction.correctedEvidence].map((item) => item.id));
    if (correction.context.entities.some((entity) => [...entity.evidenceRefs, ...entity.properties.flatMap((property) => property.evidenceRefs)].some((id) => !contextSources.has(id)))) return `correction ${correction.id} context cites evidence it does not carry`;
  }

  for (const requirement of model.requirements) {
    // The most common provider defect: an artifactId where an evidence id belongs.
    const missing = unknownRef(requirement.sourceRefs);
    if (missing) return `requirement ${requirement.id} cites ${missing} in sourceRefs, which is not an evidence id`;
    const original = unknownRef(requirement.originalSourceRefs || []);
    if (original) return `requirement ${requirement.id} cites ${original} in originalSourceRefs, which is not an evidence id`;
    const property = propertyViolation(`requirement ${requirement.id}`, requirement.properties);
    if (property) return property;
    const entity = requirement.relatedEntityIds.find((id) => !entities.has(id));
    if (entity) return `requirement ${requirement.id} links to entity ${entity}, which does not exist`;
    const relation = requirement.relatedRelationIds.find((id) => !relations.has(id));
    if (relation) return `requirement ${requirement.id} links to relation ${relation}, which does not exist`;
    const reference = (requirement.relatedPropertyRefs || []).find((ref) => !entities.get(ref.entityId)?.properties.some((property) => property.key === ref.propertyKey));
    if (reference) return `requirement ${requirement.id} links to property ${reference.propertyKey} on ${reference.entityId}, which does not exist`;
  }
  return null;
}

export function validateEngineeringSystem(model) {
  return describeEngineeringSystemViolation(model) === null;
}
