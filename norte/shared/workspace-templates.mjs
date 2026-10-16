/** Optional document organization. These folders never assert a hardware hierarchy. */
export const DOCUMENT_FOLDER_TEMPLATES = {
  simple: { pt: 'Essencial · 3 pastas', en: 'Essential · 3 folders', folders: [
    { key: 'references', pt: 'Referências', en: 'References' },
    { key: 'design', pt: 'Desenvolvimento', en: 'Design' },
    { key: 'verification', pt: 'Verificação e testes', en: 'Verification and tests' }
  ] },
  engineering: { pt: 'Engenharia · 8 pastas', en: 'Engineering · 8 folders', folders: [
    { key: 'references', pt: 'Referências', en: 'References' },
    { key: 'requirements', pt: 'Requisitos', en: 'Requirements' },
    { key: 'components', pt: 'Componentes e projeto', en: 'Components and design' },
    { key: 'cad', parent: 'components', pt: 'CAD e desenhos', en: 'CAD and drawings' },
    { key: 'datasheets', parent: 'components', pt: 'Datasheets', en: 'Datasheets' },
    { key: 'repositories', parent: 'components', pt: 'Repositórios', en: 'Repositories' },
    { key: 'verification', pt: 'Verificação e testes', en: 'Verification and tests' },
    { key: 'decisions', pt: 'Decisões e revisões', en: 'Decisions and reviews' }
  ] }
};
const sameName = (a, b) => a.trim().normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase() === b.trim().normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase();
export function applyDocumentFolderTemplate(project, parentId, templateKey, language = 'pt') {
  const template = DOCUMENT_FOLDER_TEMPLATES[templateKey];
  if (!template || ![...project.context.sectors, ...(project.context.folders || [])].some(f => f.id === parentId)) throw new Error('Select an existing sector or folder.');
  const folders = [...(project.context.folders || [])], ids = new Set([...project.context.sectors, ...folders].map(f => f.id)), added = new Map();
  for (const definition of template.folders) {
    const parent = definition.parent ? added.get(definition.parent) : parentId;
    const existing = folders.find(f => f.parentId === parent && [definition.pt, definition.en].some(name => sameName(f.name, name)));
    if (existing) { added.set(definition.key, existing.id); continue; }
    const base = `folder-${parentId}-${definition.key}`.slice(0, 90);
    let id = base, suffix = 1; while (ids.has(id)) id = `${base}-${suffix++}`;
    ids.add(id); added.set(definition.key, id);
    folders.push({ id, parentId: parent, name: definition[language === 'en' ? 'en' : 'pt'] });
  }
  return { ...project, context: { ...project.context, folders } };
}
export function addSuggestedSectors(project, suggestions) {
  const sectors = [...project.context.sectors], ids = new Set([...sectors, ...(project.context.folders || [])].map(f => f.id));
  for (const item of suggestions) {
    if (sectors.some(s => s.id === item.id || sameName(s.name, item.name))) continue;
    let id = item.id, suffix = 1; while (ids.has(id)) id = `${item.id}-${suffix++}`;
    sectors.push({ id, name: item.name }); ids.add(id);
  }
  return { ...project, context: { ...project.context, sectors } };
}

/** Creates a document destination only; it never fabricates an official file. */
export function ensureProgramReferenceFolder(project, language = 'pt') {
  const pt = language !== 'en', context = { ...project.context, sectors: [...project.context.sectors], folders: [...(project.context.folders || [])] };
  if (context.programFolderId && context.folders.some(folder => folder.id === context.programFolderId)) return project;
  const ids = new Set([...context.sectors, ...context.folders].map(item => item.id));
  const idFor = base => { let id = base, suffix = 1; while (ids.has(id)) id = `${base}-${suffix++}`; ids.add(id); return id; };
  let sector = context.sectors.find(item => ['Gestão do projeto', 'Project management'].some(name => sameName(item.name, name)));
  if (!sector) { sector = { id: idFor('sector-project-management'), name: pt ? 'Gestão do projeto' : 'Project management' }; context.sectors.push(sector); }
  let folder = context.folders.find(item => item.parentId === sector.id && ['Edital e referências', 'Program and references'].some(name => sameName(item.name, name)));
  if (!folder) { folder = { id: idFor('folder-program-references'), parentId: sector.id, name: pt ? 'Edital e referências' : 'Program and references' }; context.folders.push(folder); }
  context.programFolderId = folder.id;
  return { ...project, context };
}
