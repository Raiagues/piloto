/** Remove unsupported claims, never repair their facts or weaken validation.
 * Only call after bounded grounding retries on a complete, schema-valid result.
 */
export function quarantineExtraction(candidate, validate) {
  const value = structuredClone(candidate);
  const omissions = [];
  const removed = { entities: new Set(), relations: new Set(), requirements: new Set(), properties: new Set(), evidence: new Set() };
  const kinds = { entities: "entity", relations: "relation", requirements: "requirement", evidence: "evidence" };
  function omit(collection, id, reason) {
    const item = value[collection].find((item) => item.id === id);
    if (!item) return false;
    value[collection] = value[collection].filter((item) => item.id !== id);
    removed[collection].add(id);
    omissions.push({ kind: kinds[collection], id, ...(item.name || item.title ? { name: item.name || item.title } : {}), reason });
    return true;
  }
  function omitProperty(collection, id, key, reason) {
    const owner = value[collection].find((item) => item.id === id);
    if (!owner?.properties?.some((item) => item.key === key)) return false;
    if (collection === "requirements") return omit(collection,id,reason);
    const property = owner.properties.find((item) => item.key === key);
    owner.properties = owner.properties.filter((item) => item.key !== key);
    removed.properties.add(`${id}:${key}`);
    omissions.push({ kind: "property", id: `${id}:${key}`, name: property.name, reason });
    return true;
  }
  function pruneDependents() {
    let changed;
    do {
      changed = false;
      for (const collection of ["entities","relations","requirements"]) for (const item of [...value[collection]]) {
        const refs = item.evidenceRefs || item.sourceRefs || [];
        const bad = refs.some((id) => removed.evidence.has(id)) ||
          (collection === "entities" && removed.entities.has(item.parentId)) ||
          (collection === "relations" && [item.from,item.to].some((id) => removed.entities.has(id) || removed.requirements.has(id))) ||
          (collection === "requirements" && (item.relatedEntityIds.some((id) => removed.entities.has(id)) || item.relatedRelationIds.some((id) => removed.relations.has(id)) || (item.relatedPropertyRefs || []).some((ref) => removed.properties.has(`${ref.entityId}:${ref.propertyKey}`))));
        if (bad) { changed = omit(collection,item.id,"Depende de uma afirmação sem comprovação; revisar a fonte original.") || changed; continue; }
        for (const property of [...(item.properties || [])]) if (property.evidenceRefs.some((id) => removed.evidence.has(id))) changed = omitProperty(collection,item.id,property.key,"A fonte desta propriedade não pôde ser comprovada.") || changed;
      }
    } while (changed);
  }
  for (let attempts = 0; attempts < 2000; attempts += 1) {
    try { return { model: validate(value), review: { needsReview: omissions.length > 0, omissions } }; }
    catch (error) {
      // Structural/schema/transport failures never become a partial success.
      const issue = error.grounding;
      if (!["SYSTEM_EVIDENCE_INVALID","SYSTEM_SOURCE_SCOPE_INVALID"].includes(error.code) || !issue) throw error;
      let changed = false;
      if (issue.kind === "evidence") changed = omit("evidence",issue.id,"Citação não encontrada literalmente na fonte; revisar o original.");
      else if (issue.kind === "property" && ["entities","requirements"].includes(issue.collection)) changed = omitProperty(issue.collection,issue.id,issue.key,issue.reason === "absolute_limit" ? "A fonte define um limite absoluto de dano, não uma condição de operação; revisar a classificação e as condições." : "Valor ou unidade sem comprovação na citação; revisar o original.");
      else if (issue.kind === "object" && ["entities","relations","requirements"].includes(issue.collection)) changed = omit(issue.collection,issue.id,"Afirmação sem suporte documental suficiente; revisar o original.");
      if (!changed) throw error;
      pruneDependents();
    }
  }
  throw Object.assign(new Error("O limite de revisão do trecho foi atingido; nenhuma extração parcial foi publicada."),{code:"SYSTEM_QUARANTINE_LIMIT"});
}
