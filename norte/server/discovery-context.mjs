import { RELATED_CARD_LIMIT, CLARIFICATION_MAX_TURNS } from "../shared/discovery-limits.mjs";

const plain = (text) => String(text || "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
const ignored = new Set("para como uma com que por dos das the with from what change mudar aumentar reduzir would this that quero projeto project hypothesis hipotese".split(" "));
const equivalents = [["camera", "imaging", "imagem", "image"], ["peso", "massa", "mass", "weight"], ["energia", "energy"], ["bateria", "battery"], ["potencia", "power"], ["corrente", "current"], ["tensao", "voltage"], ["antena", "antenna"], ["transmissor", "transmitter", "radio"]];
const words = (text) => new Set((plain(text).match(/[\p{L}\d_]{3,}/gu) || []).filter((word) => !ignored.has(word)));

/** Bounded, source-labelled neighborhood. No files, people, coordinates or prior scenarios. */
export function selectDiscoveryContext(model, text, context = {}) {
  const clarifications = (context.clarifications || []).slice(-CLARIFICATION_MAX_TURNS);
  const links = (context.links || []).filter((link) => link.from === context.nodeId || link.to === context.nodeId);
  const neighbors = new Set(links.flatMap((link) => [link.from, link.to]).filter((id) => id !== context.nodeId));
  const relatedCards = (context.relatedCards || []).filter((card) => neighbors.has(card.id)).slice(0, RELATED_CARD_LIMIT);
  const cardIds = new Set([context.nodeId, ...relatedCards.map((card) => card.id)]);
  const query = words([text, ...clarifications.map((turn) => turn.answer), ...relatedCards.map((card) => card.description || card.text)].join(" "));
  for (const group of equivalents) if (group.some((word) => query.has(word))) group.forEach((word) => query.add(word));
  const score = (item) => {
    const name = words(item.name || item.title);
    const description = words(`${item.description || item.statement || ""} ${(item.properties || []).map((p) => `${p.key} ${p.name}`).join(" ")}`);
    return [...query].reduce((sum, word) => sum + (name.has(word) ? 5 : description.has(word) ? 1 : 0), 0);
  };
  const all = [...model.entities, ...model.requirements];
  const byId = new Map(all.map((item) => [item.id, item]));
  const ranked = all.map((item, index) => ({ item, index, score: score(item) })).filter((item) => item.score > 0).sort((a, b) => b.score - a.score || a.index - b.index);
  const seeds = ranked.slice(0, 12).map(({ item }) => item.id);
  const selected = new Set(seeds);
  // One engineering edge, plus ancestors. Traversing the whole connected graph would
  // defeat selection and imply an impact analysis, which is deliberately separate.
  for (const relation of model.relations) if (seeds.includes(relation.from) || seeds.includes(relation.to)) {
    for (const id of [relation.from, relation.to]) if (selected.size < 28) selected.add(id);
  }
  for (const requirement of model.requirements) if (requirement.relatedEntityIds?.some((id) => seeds.includes(id)) && selected.size < 32) selected.add(requirement.id);
  for (const id of [...selected]) {
    let parentId = byId.get(id)?.parentId;
    const visited = new Set();
    while (parentId && !visited.has(parentId) && selected.size < 40) { visited.add(parentId); selected.add(parentId); parentId = byId.get(parentId)?.parentId; }
  }
  const entities = model.entities.filter((item) => selected.has(item.id));
  const requirements = model.requirements.filter((item) => selected.has(item.id));
  const relations = model.relations.filter((item) => selected.has(item.from) && selected.has(item.to)).slice(0, 64);
  const evidenceIds = new Set([...entities, ...requirements, ...relations].flatMap((item) => [...(item.evidenceRefs || item.sourceRefs || []), ...(item.properties || []).flatMap((property) => property.evidenceRefs || [])]));
  const evidence = model.evidence.filter((item) => evidenceIds.has(item.id)).slice(0, 32);
  const result = {
    project: { name: context.project?.name || model.name, type: context.project?.projectType || "", purpose: (context.project?.setup?.statement || "").slice(0, 2000) },
    // A compact lookup keeps ambiguous names visible even when detailed context is limited.
    targetIndex: all.map(({ id, name, title, kind, parentId, description, statement }) => ({ id, name: name || title, kind: kind || "requirement", parentId, description: (description || statement || "").slice(0, 160) })),
    entities, requirements, relations, evidence,
    relatedCards: relatedCards.map(({ id, text: title, description }) => ({ id, title, hypothesis: description || title, source: "user_hypothesis_not_evidence" })),
    cardLinks: links.filter((link) => cardIds.has(link.from) && cardIds.has(link.to)).map(({ from, to }) => ({ from, to })),
    clarifications,
    selection: { detailedObjects: selected.size, totalObjects: all.length, omittedObjects: all.filter((item) => !selected.has(item.id)).length, omittedEvidence: evidenceIds.size - evidence.length, omittedRelations: model.relations.length - relations.length }
  };
  // Hard aggregate budget in addition to item limits; a large property string must
  // not turn a neighborhood into an unbounded prompt. Never cut evidence excerpts.
  let remaining = 100_000 - JSON.stringify({ project: result.project, relatedCards: result.relatedCards, cardLinks: result.cardLinks, clarifications }).length;
  result.selection.budgetOmissions = {};
  for (const field of ["entities", "requirements", "relations", "evidence", "targetIndex"]) {
    const original = result[field];
    result[field] = original.filter((item) => {
      const size = JSON.stringify(item).length + 1;
      if (size > remaining) return false;
      remaining -= size; return true;
    });
    result.selection.budgetOmissions[field] = original.length - result[field].length;
  }
  return result;
}
