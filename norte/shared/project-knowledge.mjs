/** Stable, source-addressable review tasks. Resolving a task never fabricates a map fact. */
export function projectKnowledgeItems(project, report = {}) {
  const model = project.engineeringSystem, evidence = model?.evidence || [];
  const items = [];
  for (const note of report.reviewNotes || []) items.push({ id: `architecture:${note.id}`, kind: "architecture", title: note.title, reason: note.reason, artifactIds: note.artifactIds || [], entityId: note.entityId || null, action: "Compare as fontes e revise o objeto no mapa. Registrar a decisão não altera o fato automaticamente." });
  for (const [index, item] of (report.omissions || []).entries()) items.push({ id: `omission:${item.chunkId || ''}:${item.id || index}`, kind: 'omission', title: item.name || 'Informação sem comprovação', reason: item.reason, artifactIds: [item.artifactId].filter(Boolean), entityId: model?.entities?.some(e => e.id === item.id) ? item.id : null, action: 'Confira a fonte e registre a decisão. Informações omitidas ainda não fazem parte do mapa.' });
  for (const [index, item] of (report.conflicts || []).entries()) {
    const name = model?.entities?.find(e => e.id === item.entityId)?.name;
    const refs = [...(item.kept?.evidenceRefs || []), ...(item.candidate?.evidenceRefs || [])];
    items.push({ id: `conflict:${item.entityId || item.requirementId || ''}:${item.key || index}`, kind: 'conflict', title: [name, item.kept?.name || item.candidate?.name || 'Valores diferentes nas fontes'].filter(Boolean).join(' · '), reason: item.reason || 'Confira revisão, unidade e condição de operação.', artifactIds: [...new Set(refs.flatMap(id => evidence.filter(e => e.id === id).map(e => e.artifactId)))], entityId: item.entityId || null, kept: item.kept, candidate: item.candidate, action: 'Compare os valores e suas fontes antes de corrigir o mapa.' });
  }
  for (const document of report.documents || []) if (document.complete === false || document.missingPages?.length) items.push({ id: `document:${document.artifactId}`, kind: 'document', title: document.label, reason: document.missingPages?.length ? `Páginas sem texto suficiente: ${document.missingPages.join(', ')}.` : document.reason || 'Leitura incompleta.', artifactIds: [document.artifactId], action: 'Abra o original. Se necessário, substitua por uma versão legível e gere uma nova proposta.' });
  return items;
}
