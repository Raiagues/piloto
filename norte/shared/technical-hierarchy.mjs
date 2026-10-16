/** Strict for newly generated/edited architecture; legacy saved models stay readable. */
export function technicalHierarchyError(model, entityIds) {
  const entities = new Map(model.entities.map(e => [e.id, e]));
  for (const entity of model.entities) {
    if (entityIds && !entityIds.has(entity.id)) continue;
    const parents = new Set([entity.parentId, ...model.relations.filter(r => r.kind === 'contains' && r.to === entity.id).map(r => r.from)].filter(Boolean));
    if (parents.size > 1) return `Conflicting parents for ${entity.name}.`;
    const parent = entities.get([...parents][0]);
    if (entity.kind === 'component' && parent?.kind !== 'subsystem') return `Component ${entity.name} must belong to a subsystem.`;
    if (entity.kind === 'subsystem' && !['system', 'subsystem'].includes(parent?.kind)) return `Subsystem ${entity.name} must belong to a system or subsystem.`;
    if (entity.kind === 'system' && parent && parent.kind !== 'system') return `System ${entity.name} cannot belong to a component or subsystem.`;
  }
  return null;
}
export function technicalFolderDefinitions(project) {
  const folders = project.context?.folders || [];
  return folders.filter(f => f.technicalKind).map(folder => {
    let parent = folders.find(f => f.id === folder.parentId);
    const visited = new Set([folder.id]);
    while (parent && !parent.technicalKind && !visited.has(parent.id)) { visited.add(parent.id); parent = folders.find(f => f.id === parent.parentId); }
    return { id: folder.id, name: folder.name, kind: folder.technicalKind, parentId: parent?.technicalKind ? parent.id : undefined };
  });
}
export function respectsTechnicalFolders(project, model) {
  const definitions = technicalFolderDefinitions(project);
  for (const definition of definitions) {
    const entity = model.entities.find(e => e.id === definition.id) || model.entities.find(e => e.name.toLocaleLowerCase() === definition.name.toLocaleLowerCase());
    if (!entity) continue; // incomplete evidence is allowed; invented objects are not
    const parent = definitions.find(d => d.id === definition.parentId);
    const expectedParent = parent && (model.entities.find(e => e.id === parent.id) || model.entities.find(e => e.name.toLocaleLowerCase() === parent.name.toLocaleLowerCase()));
    if (entity.kind !== definition.kind || parent && entity.parentId !== expectedParent?.id) return `A arquitetura contradiz a classificação definida para ${definition.name}.`;
  }
  return null;
}
