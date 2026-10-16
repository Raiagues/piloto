/** Engineering baseline. Discovery coordinates and activity are never physical evidence. */
export type EngineeringSource = "documented" | "calculated" | "inferred" | "user";
export type EngineeringEntityKind = "system" | "subsystem" | "component" | "parameter" | "calculation" | "performance" | "interface";
export const ENGINEERING_RELATION_KINDS = ["contains", "powers", "connects_to", "depends_on", "affects", "contributes_to", "constrained_by", "satisfies", "requires", "produces", "consumes", "measured_by", "derived_from", "communicates_with", "mounted_on", "thermal_coupling", "unknown"] as const;
export type EngineeringRelationKind = typeof ENGINEERING_RELATION_KINDS[number];
export type EngineeringProperty = { key: string; name: string; value: number | string; unit?: string; source: EngineeringSource; evidenceRefs: string[] };
export type EngineeringEvidence = { id: string; artifactId: string; artifactLabel: string; locator?: string; excerpt: string; kind: "fact" | "calculation" | "inference" | "user" };
export type EngineeringArtifactSource = { artifactId: string; artifactLabel: string; status: "parsed" | "pdf" | "metadata_only" | "not_parsed"; reason?: string };
export type EngineeringEntity = { id: string; name: string; kind: EngineeringEntityKind; parentId?: string; description: string; properties: EngineeringProperty[]; source: EngineeringSource; evidenceRefs: string[]; confidence: number };
export type EngineeringRelation = { id: string; from: string; to: string; kind: EngineeringRelationKind; label: string; source: EngineeringSource; evidenceRefs: string[]; confidence: number };
export type EngineeringRequirement = {
  id: string; title: string; statement: string; originalStatement?: string; category?: string;
  subsystemTags: string[]; reviewTags: string[]; status: "unreviewed" | "accepted" | "review" | "verified";
  sourceRefs: string[]; originalSourceRefs?: string[]; relatedEntityIds: string[]; relatedRelationIds: string[];
  relatedPropertyRefs?: { entityId: string; propertyKey: string }[];
  properties: EngineeringProperty[]; classificationSource?: EngineeringSource;
};
export type EngineeringChange = { id: string; targetEntityId: string; kind: "replace_component" | "parameter" | "requirement"; oldValues: EngineeringProperty[]; newValues: EngineeringProperty[]; replacementName?: string; description: string; createdAt: string };
export type EngineeringCalculationInput = { entityId: string; propertyKey: string; value: number; unit: string; evidenceRefs: string[] };
export type EngineeringCalculation = { ruleId: string; expression: string; inputs: EngineeringCalculationInput[]; result: number | boolean; unit?: string; evidenceRefs: string[] };
export type ReasoningEvidence = { type: "fact" | "calculation" | "inference" | "unknown"; sourceRefs: string[]; inputFacts: EngineeringCalculationInput[]; traversedRelationIds: string[]; ruleId?: string; calculation?: EngineeringCalculation; shortExplanation: string; confidence: number; model?: string; createdAt: string };
export type EngineeringImpactStatus = "changed" | "valid" | "review" | "critical" | "unaffected";
export type EngineeringImpact = { entityId: string; status: EngineeringImpactStatus; reasonCode: string; shortExplanation: string; path: string[]; traversedRelationIds: string[]; evidenceRefs: string[]; calculation?: EngineeringCalculation; reasoning: ReasoningEvidence; confidence: number };
export type EngineeringAnalysis = { baseline?: Pick<EngineeringSystemModel, "entities" | "relations" | "requirements" | "evidence">; id: string; changeId: string; changedEntityId: string; change: EngineeringChange; impacts: EngineeringImpact[]; calculations: EngineeringCalculation[]; evidence?: EngineeringEvidence[]; unresolvedQuestions: string[]; createdAt: string; model?: string; metrics: { impacted: number; critical: number; review: number; evidenced: number; inferred: number } };
export type EngineeringScenario = EngineeringAnalysis;
export type EngineeringCorrectionSnapshot = { entity: EngineeringEntity } | { relation: EngineeringRelation } | { requirement: EngineeringRequirement };
export type EngineeringCorrectionProjectContext = { projectId?: string; projectName?: string; projectType?: string };
export type EngineeringCorrection = {
  id: string; transactionId: string; objectKind: "entity" | "relation" | "requirement";
  operation: "create" | "update" | "delete"; targetId: string;
  suggested: EngineeringCorrectionSnapshot | null; previous: EngineeringCorrectionSnapshot | null; corrected: EngineeringCorrectionSnapshot | null;
  context: EngineeringCorrectionProjectContext & { baselineId: string; baselineRevision: number; generatedFromRevision: number; entities: EngineeringEntity[]; entitiesTruncated: boolean };
  suggestedEvidence: EngineeringEvidence[]; previousEvidence: EngineeringEvidence[]; correctedEvidence: EngineeringEvidence[];
  createdAt: string;
};
export type EngineeringSystemModel = { schemaVersion: 1; id: string; name: string; entities: EngineeringEntity[]; relations: EngineeringRelation[]; requirements: EngineeringRequirement[]; evidence: EngineeringEvidence[]; artifactSources: EngineeringArtifactSource[]; generatedAt: string; generatedFromRevision: number; model?: string; revision?: number; scenarios?: EngineeringAnalysis[]; corrections?: EngineeringCorrection[] };

export function formatEngineeringProperty(property: EngineeringProperty): string {
  return `${property.value}${property.unit ? ` ${property.unit}` : ""}`;
}

export function requirementEntityIds(requirement: EngineeringRequirement, model: EngineeringSystemModel): Set<string> {
  const ids = new Set(requirement.relatedEntityIds);
  for (const relation of model.relations) if (requirement.relatedRelationIds.includes(relation.id)) { ids.add(relation.from); ids.add(relation.to); }
  return ids;
}

/** Return undefined for unknown versions instead of inventing an architecture. */
export function normalizeEngineeringSystem(value: unknown): EngineeringSystemModel | undefined {
  if (!value || typeof value !== "object" || !("schemaVersion" in value) || value.schemaVersion !== 1) return undefined;
  const model = value as EngineeringSystemModel;
  if (!Array.isArray(model.entities) || !Array.isArray(model.relations) || !Array.isArray(model.requirements) || !Array.isArray(model.evidence)) return undefined;
  return model;
}
