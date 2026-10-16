/** Conservative architecture cleanup: labels are aliases only within one parent.
 * Components are never deduplicated by part number: U2 and U4 may be identical parts.
 * No interface or physical connection is inferred here. */
const unique = values => [...new Set(values)];
const parentOf = (model, entity) => entity.parentId || model.relations.find(relation => relation.kind === "contains" && relation.to === entity.id)?.from || "";
function aliasName(name) {
  return name.normalize("NFKC").replace(/\s*\([A-Z][A-Z0-9&-]{1,9}\)\s*$/u, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
export function architectureAliasCandidates(model) {
  const groups = new Map();
  for (const entity of model.entities) {
    if (!["system", "subsystem"].includes(entity.kind)) continue;
    const key = `${entity.kind}|${parentOf(model, entity)}|${aliasName(entity.name)}`;
    groups.set(key, [...(groups.get(key) || []), entity]);
  }
  return [...groups.values()].filter(group => group.length > 1).map(group => {
    const ordered = [...group].sort((a, b) => b.evidenceRefs.length - a.evidenceRefs.length || a.id.localeCompare(b.id));
    const properties = new Map(), conflicts = [];
    for (const entity of ordered) for (const property of entity.properties) {
      const previous = properties.get(property.key);
      if (previous && (previous.value !== property.value || (previous.unit || "") !== (property.unit || ""))) conflicts.push(property.key);
      properties.set(property.key, property);
    }
    const descriptions = unique(ordered.map(entity => entity.description.trim()).filter(Boolean));
    return { canonicalId: ordered[0].id, entityIds: ordered.map(entity => entity.id), name: ordered[0].name, conflicts: unique(conflicts), descriptionFits: descriptions.join("\n").length <= 600 };
  });
}

/** Caller persists an audited revision. All sources, relation IDs and historical scenarios survive. */
export function mergeArchitectureAliases(model, entityIds) {
  const candidate = architectureAliasCandidates(model).find(group => group.entityIds.length === entityIds.length && group.entityIds.every(id => entityIds.includes(id)));
  if (!candidate || candidate.conflicts.length || !candidate.descriptionFits) throw new Error("These records cannot be merged without reviewing conflicting values or descriptions.");
  const members = model.entities.filter(entity => entityIds.includes(entity.id));
  const canonical = model.entities.find(entity => entity.id === candidate.canonicalId);
  const redirect = id => entityIds.includes(id) ? canonical.id : id;
  const properties = new Map();
  for (const entity of members) for (const property of entity.properties) {
    const previous = properties.get(property.key);
    properties.set(property.key, previous ? { ...previous, evidenceRefs: unique([...previous.evidenceRefs, ...property.evidenceRefs]), source: previous.source === property.source ? previous.source : "user" } : { ...property });
  }
  const merged = { ...canonical, source: members.every(entity => entity.source === canonical.source) ? canonical.source : "user", description: unique(members.map(entity => entity.description.trim()).filter(Boolean)).join("\n"), properties: [...properties.values()], evidenceRefs: unique(members.flatMap(entity => entity.evidenceRefs)), confidence: Math.min(...members.map(entity => entity.confidence)) };
  const relations = model.relations.map(relation => ({ ...relation, from: redirect(relation.from), to: redirect(relation.to) }));
  if (relations.some(relation => relation.from === relation.to)) throw new Error("Merging would erase a relationship between these records. Review it first.");
  const historicalScenarios = model.scenarios?.map(scenario => scenario.baseline ? scenario : { ...scenario, baseline: structuredClone({ entities: model.entities, relations: model.relations, requirements: model.requirements, evidence: model.evidence }) });
  return { ...model, ...(historicalScenarios ? { scenarios: historicalScenarios } : {}), entities: model.entities.filter(entity => !entityIds.includes(entity.id) || entity.id === canonical.id).map(entity => ({ ...(entity.id === canonical.id ? merged : entity), ...(entity.parentId ? { parentId: redirect(entity.parentId) } : {}) })), relations,
    requirements: model.requirements.map(requirement => ({ ...requirement, relatedEntityIds: unique(requirement.relatedEntityIds.map(redirect)), ...(requirement.relatedPropertyRefs ? { relatedPropertyRefs: [...new Map(requirement.relatedPropertyRefs.map(ref => { const next = { ...ref, entityId: redirect(ref.entityId) }; return [`${next.entityId}:${next.propertyKey}`, next]; })).values()] } : {}) })) };
}
