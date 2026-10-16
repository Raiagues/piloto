/** Shared extraction-only enum constraints for provider and runtime validation. */
export const EXTRACTED_SOURCE_KINDS = Object.freeze(["documented", "inferred"]);
export const EXTRACTED_EVIDENCE_KINDS = Object.freeze(["fact"]);
/** The persistence model names a requirement's citations `sourceRefs`, while
 * every other object uses `evidenceRefs`. Providers read "source" as "source
 * document" and answer with an artifactId, which the reference check then
 * rejects - the single defect behind almost every contract rejection measured
 * on real documents. The extraction contract therefore calls the field
 * `evidenceRefs` everywhere, and code maps it back on the way in. */
export function requirementEvidenceField(requirementSchema) {
  const schema = structuredClone(requirementSchema);
  if (!schema.properties?.sourceRefs) return schema;
  schema.properties = Object.fromEntries(Object.entries(schema.properties).map(([name, value]) => [name === "sourceRefs" ? "evidenceRefs" : name, value]));
  schema.required = schema.required.map((name) => (name === "sourceRefs" ? "evidenceRefs" : name));
  return schema;
}

/** Restore the persisted field name after extraction. */
export function restoreRequirementSourceRefs(requirement) {
  if (!requirement || typeof requirement !== "object" || !Object.hasOwn(requirement, "evidenceRefs")) return requirement;
  const { evidenceRefs, ...rest } = requirement;
  return { ...rest, sourceRefs: evidenceRefs };
}

export function extractionEnums(schema) {
  const copy = structuredClone(schema);
  function visit(node) {
    if (!node || typeof node !== "object") return;
    if (node.properties?.source) node.properties.source.enum = [...EXTRACTED_SOURCE_KINDS];
    if (node.properties?.classificationSource) node.properties.classificationSource.enum = [...EXTRACTED_SOURCE_KINDS];
    if (node.properties?.excerpt && node.properties?.kind) node.properties.kind.enum = [...EXTRACTED_EVIDENCE_KINDS];
    Object.values(node).forEach((value) => { if (Array.isArray(value)) value.forEach(visit); else visit(value); });
  }
  visit(copy); return copy;
}
