import type { EngineeringCorrection, EngineeringCorrectionProjectContext, EngineeringCorrectionSnapshot, EngineeringEntity, EngineeringEvidence, EngineeringRelation, EngineeringRequirement, EngineeringSystemModel } from "./engineeringSystem";
import { ENGINEERING_LIMITS } from "../../shared/engineering-schema.mjs";

export type EngineeringCorrectionOptions = { project?: EngineeringCorrectionProjectContext; evidenceRefs?: string[] };
type CorrectableObject = EngineeringEntity | EngineeringRelation | EngineeringRequirement;

function snapshot(kind: EngineeringCorrection["objectKind"], object?: CorrectableObject): EngineeringCorrectionSnapshot | null {
  if (!object) return null;
  if (kind === "entity") return { entity: structuredClone(object as EngineeringEntity) };
  if (kind === "relation") return { relation: structuredClone(object as EngineeringRelation) };
  return { requirement: structuredClone(object as EngineeringRequirement) };
}

function objectRefs(object?: CorrectableObject): string[] {
  if (!object) return [];
  return [...("evidenceRefs" in object ? object.evidenceRefs : object.sourceRefs), ...("originalSourceRefs" in object ? object.originalSourceRefs ?? [] : []), ...("properties" in object ? object.properties.flatMap((property) => property.evidenceRefs) : [])];
}

function contextIds(object?: CorrectableObject): string[] {
  if (!object) return [];
  if ("from" in object) return [object.from, object.to];
  if ("statement" in object) return [...object.relatedEntityIds, ...(object.relatedPropertyRefs ?? []).map((ref) => ref.entityId)];
  return [object.id, ...(object.parentId ? [object.parentId] : [])];
}

function evidenceSnapshot(model: EngineeringSystemModel, object: CorrectableObject | undefined, context: EngineeringEntity[], extraRefs: string[] = []): EngineeringEvidence[] {
  const ids = new Set([...objectRefs(object), ...context.flatMap(objectRefs), ...extraRefs]);
  return structuredClone(model.evidence.filter((source) => ids.has(source.id)));
}

/** One expert action can change containment and requirement links together. Preserve each change in one transaction. */
export function recordEngineeringCorrections(before: EngineeringSystemModel, after: EngineeringSystemModel, options: EngineeringCorrectionOptions = {}, timestamp = new Date().toISOString()): EngineeringSystemModel {
  const objects = [...after.entities, ...after.relations, ...after.requirements];
  const exceedsEvidenceLimit = after.evidence.length > ENGINEERING_LIMITS.evidence || objects.some((object) =>
    ("evidenceRefs" in object ? object.evidenceRefs : object.sourceRefs).length > ENGINEERING_LIMITS.references
    || ("originalSourceRefs" in object && (object.originalSourceRefs?.length ?? 0) > ENGINEERING_LIMITS.references)
    || ("properties" in object && object.properties.some((property) => property.evidenceRefs.length > ENGINEERING_LIMITS.references)));
  if (exceedsEvidenceLimit) throw new Error("The correction would exceed the evidence limit. Existing records have been kept.");
  const transactionId = `correction-${crypto.randomUUID()}`;
  const corrections: EngineeringCorrection[] = [];
  const groups = [["entity", before.entities, after.entities], ["relation", before.relations, after.relations], ["requirement", before.requirements, after.requirements]] as const;
  for (const [objectKind, previousObjects, correctedObjects] of groups) {
    const ids = new Set([...previousObjects.map((object) => object.id), ...correctedObjects.map((object) => object.id)]);
    for (const targetId of ids) {
      const previous = previousObjects.find((object) => object.id === targetId);
      const corrected = correctedObjects.find((object) => object.id === targetId);
      if (JSON.stringify(previous) === JSON.stringify(corrected)) continue;
      const first = before.corrections?.find((correction) => correction.objectKind === objectKind && correction.targetId === targetId);
      const relevantIds = new Set([...contextIds(previous), ...contextIds(corrected)]);
      if (objectKind === "entity") before.relations.filter((relation) => relation.from === targetId || relation.to === targetId).forEach((relation) => { relevantIds.add(relation.from); relevantIds.add(relation.to); });
      const availableContext = [...relevantIds].map((id) => before.entities.find((entity) => entity.id === id) ?? after.entities.find((entity) => entity.id === id)).filter((entity): entity is EngineeringEntity => Boolean(entity));
      const entities = structuredClone(availableContext.slice(0, ENGINEERING_LIMITS.correctionContext));
      const previousEvidence = evidenceSnapshot(before, previous, entities);
      const correctedEvidence = evidenceSnapshot(after, corrected, entities, options.evidenceRefs);
      corrections.push({
        id: `review-${crypto.randomUUID()}`, transactionId, objectKind, operation: !previous ? "create" : !corrected ? "delete" : "update", targetId,
        suggested: structuredClone(first ? first.suggested : snapshot(objectKind, previous)), previous: snapshot(objectKind, previous), corrected: snapshot(objectKind, corrected),
        context: { baselineId: before.id, baselineRevision: before.revision ?? 0, generatedFromRevision: before.generatedFromRevision, ...options.project, entities, entitiesTruncated: availableContext.length > entities.length },
        suggestedEvidence: structuredClone(first ? first.suggestedEvidence : previousEvidence), previousEvidence, correctedEvidence, createdAt: timestamp
      });
    }
  }
  if (!corrections.length) return after;
  if ((before.corrections?.length ?? 0) + corrections.length > ENGINEERING_LIMITS.correctionHistory) throw new Error("The correction history limit has been reached. Existing records remain available for export.");
  return { ...after, revision: (before.revision ?? 0) + 1, corrections: [...(before.corrections ?? []), ...corrections] };
}

export function serializeEngineeringCorrections(model: EngineeringSystemModel, targetId?: string): string {
  return JSON.stringify({ schemaVersion: 1, baselineId: model.id, baselineName: model.name, baselineRevision: model.revision ?? 0, generatedFromRevision: model.generatedFromRevision, corrections: (model.corrections ?? []).filter((correction) => !targetId || correction.targetId === targetId) }, null, 2);
}

export function downloadEngineeringCorrections(model: EngineeringSystemModel, targetId?: string): void {
  const url = URL.createObjectURL(new Blob([serializeEngineeringCorrections(model, targetId)], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${model.id.replace(/[^a-z0-9_-]/giu, "-")}.corrections.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}
