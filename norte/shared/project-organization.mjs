import { technicalFolderDefinitions, technicalHierarchyError } from "./technical-hierarchy.mjs";
/** Organization is shared by the client and API; sectors never imply hardware. */
export const PROJECT_TYPES = {
  competition: { pt: 'Competição', en: 'Competition', sectors: [['Aviônica', 'Avionics'], ['Estruturas', 'Structures'], ['Gestão do projeto', 'Project management']] },
  research: { pt: 'Pesquisa', en: 'Research', sectors: [['Pesquisa', 'Research'], ['Experimentos', 'Experiments'], ['Gestão do projeto', 'Project management']] },
  product: { pt: 'Desenvolvimento de produto', en: 'Product development', sectors: [['Engenharia', 'Engineering'], ['Validação', 'Validation'], ['Gestão do projeto', 'Project management']] },
  custom: { pt: 'Personalizado', en: 'Custom', sectors: [] }
};
// Editable responsibility templates, never a technical architecture or competition rule.
const COMPETITION_SECTORS = {
  general: [['Engenharia', 'Engineering'], ['Eletrônica', 'Electronics'], ['Software', 'Software'], ['Fabricação', 'Manufacturing'], ['Testes e integração', 'Testing and integration'], ['Gestão e patrocínios', 'Management and sponsorship']],
  satellite: [['Estruturas', 'Structures'], ['Eletrônica e energia', 'Electronics and power'], ['Software embarcado', 'Embedded software'], ['Comunicação', 'Communications'], ['Carga útil', 'Payload'], ['Testes e integração', 'Testing and integration'], ['Gestão e patrocínios', 'Management and sponsorship']],
  rocket: [['Aerodinâmica e estruturas', 'Aerodynamics and structures'], ['Propulsão', 'Propulsion'], ['Aviônica', 'Avionics'], ['Recuperação', 'Recovery'], ['Carga útil', 'Payload'], ['Operações e testes', 'Operations and testing'], ['Gestão e patrocínios', 'Management and sponsorship']],
  aircraft: [['Aerodinâmica', 'Aerodynamics'], ['Estruturas', 'Structures'], ['Desempenho e estabilidade', 'Performance and stability'], ['Propulsão', 'Propulsion'], ['Elétrica e controle', 'Electrical and control'], ['Fabricação e testes', 'Manufacturing and testing'], ['Gestão e patrocínios', 'Management and sponsorship']],
  formula: [['Chassi', 'Chassis'], ['Suspensão e direção', 'Suspension and steering'], ['Powertrain', 'Powertrain'], ['Elétrica e eletrônica', 'Electrical and electronics'], ['Aerodinâmica', 'Aerodynamics'], ['Freios e ergonomia', 'Brakes and ergonomics'], ['Gestão e patrocínios', 'Management and sponsorship']],
  baja: [['Chassi e segurança', 'Chassis and safety'], ['Suspensão e direção', 'Suspension and steering'], ['Powertrain', 'Powertrain'], ['Freios', 'Brakes'], ['Elétrica e instrumentação', 'Electrical and instrumentation'], ['Fabricação e testes', 'Manufacturing and testing'], ['Gestão e patrocínios', 'Management and sponsorship']],
  theoretical: [['Estudos', 'Studies'], ['Pesquisa', 'Research'], ['Gestão do projeto', 'Project management']]
};
export function suggestedSectors(type, language = 'pt', programId = '', modalityId = '') {
  const family = programId === 'obsat' ? (modalityId === 'theoretical' ? 'theoretical' : 'satellite')
    : programId === 'lasc' ? (modalityId === 'satellite' ? 'satellite' : modalityId === 'rocket' ? 'rocket' : 'general')
    : ({ 'sae-aerodesign': 'aircraft', 'formula-sae': 'formula', 'baja-sae': 'baja' })[programId] || 'general';
  const names = type === 'competition' ? COMPETITION_SECTORS[family] : PROJECT_TYPES[type]?.sectors || [];
  return names.map((pair, index) => ({ id: `sector-${type}-${type === 'competition' ? family + '-' : ''}${index + 1}`, name: pair[language === 'en' ? 1 : 0] }));
}
export function isProjectAdmin(project, user, creatorId = project.creatorId) {
  return Boolean(user && user.accessRole !== 'advisor' && (creatorId === user.id || project.context?.assignments?.some(a => a.memberId === user.memberId && a.roleId === 'captain')));
}
export function sectorRole(project, user, sectorId) {
  const assignment = project.context?.assignments?.find(a => a.memberId === user?.memberId);
  if (!assignment || user?.accessRole === 'advisor' || assignment.roleId === 'advisor') return 'viewer';
  const explicit = assignment.sectorRoles?.find(a => a.sectorId === sectorId);
  if (explicit) return explicit.role;
  return assignment.sectorId === sectorId && sectorId ? (assignment.roleId === 'manager' ? 'manager' : 'member') : 'viewer';
}
export function canEditSector(project, user, sectorId, creatorId) {
  return isProjectAdmin(project, user, creatorId) || Boolean(sectorId && ['manager', 'member'].includes(sectorRole(project, user, sectorId)));
}
export function folderSector(project, folderId) {
  if (!folderId) return null;
  if (project.context.sectors?.some(s => s.id === folderId)) return folderId;
  const folder = project.context.folders?.find(f => f.id === folderId);
  return folder ? folderSector(project, folder.parentId) : null;
}
export function folderPath(project, folderId) {
  if (!folderId) return '';
  const sector = project.context.sectors?.find(s => s.id === folderId);
  if (sector) return sector.name;
  const folder = project.context.folders?.find(f => f.id === folderId);
  return folder ? `${folderPath(project, folder.parentId)} / ${folder.name}` : '';
}
export function organizationError(project) {
  const context = project.context;
  if (!context || !Array.isArray(context.sectors) || !Array.isArray(context.assignments) || !Array.isArray(context.roles)) return 'Invalid project organization.';
  if (project.projectType !== undefined && !Object.hasOwn(PROJECT_TYPES, project.projectType)) return 'Invalid project type.';
  if (context.roles.length > 100 || context.roles.some(role => !role || typeof role.id !== 'string' || !/^[\w.:-]{1,100}$/.test(role.id) || typeof role.name !== 'string' || !role.name.trim() || role.name.length > 100) || new Set(context.roles.map(role => role.id)).size !== context.roles.length) return 'Invalid project roles.';
  for (const field of ['teamArtifactIds', 'projectArtifactIds', 'programArtifactIds']) {
    if (context[field] !== undefined && (!Array.isArray(context[field]) || context[field].length > 5000 || context[field].some(id => typeof id !== 'string' || id.length > 100))) return 'Invalid artifact references.';
  }
  const folders = context.folders || [];
  if (!Array.isArray(folders) || folders.length > 1000 || context.sectors.length > 100 || context.assignments.length > 500) return 'Organization limit exceeded.';
  const ids = new Set();
  for (const item of [...context.sectors, ...folders]) {
    if (!item || typeof item.id !== 'string' || !/^[\w.:-]{1,100}$/.test(item.id) || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 100 || ids.has(item.id)) return 'Invalid or duplicate folder/sector.';
    ids.add(item.id);
  }
  for (const folder of folders) {
    const seen = new Set([folder.id]);
    let parent = folder.parentId;
    while (parent && !context.sectors.some(s => s.id === parent)) {
      if (seen.has(parent)) return 'Folders cannot form a cycle.';
      seen.add(parent);
      parent = folders.find(f => f.id === parent)?.parentId;
    }
    if (!parent) return 'Each folder must belong to a sector.';
    if (folder.entityId && !project.engineeringSystem?.entities.some(e => e.id === folder.entityId)) return 'Linked technical object does not exist.';
  }
  if (context.programFolderId !== undefined && context.programFolderId !== null && (typeof context.programFolderId !== 'string' || !folders.some(folder => folder.id === context.programFolderId))) return 'Invalid project reference folder.';
  if (context.summary !== undefined && (!context.summary || typeof context.summary !== 'object' || Array.isArray(context.summary) || Object.keys(context.summary).some(key => !['scope', 'nextSteps'].includes(key)) || ['scope', 'nextSteps'].some(key => typeof context.summary[key] !== 'string' || context.summary[key].length > 5000))) return 'Invalid project summary.';
  const definitions = technicalFolderDefinitions(project);
  if (definitions.some(d => !["system", "subsystem", "component"].includes(d.kind))) return "Invalid technical classification.";
  const hierarchyError = technicalHierarchyError({ entities: definitions, relations: [] });
  if (hierarchyError) return hierarchyError;
  const members = new Set();
  for (const a of context.assignments) {
    if (!a || typeof a.memberId !== 'string' || members.has(a.memberId) || !context.roles.some(r => r.id === a.roleId)) return 'Invalid or duplicate project member/role.';
    members.add(a.memberId);
    if (a.sectorId && !context.sectors.some(s => s.id === a.sectorId)) return 'Unknown member sector.';
    if (a.sectorRoles !== undefined && (!Array.isArray(a.sectorRoles) || a.sectorRoles.length > 100)) return 'Invalid sector responsibilities.';
    const granted = new Set();
    for (const grant of a.sectorRoles || []) {
      if (!grant || !context.sectors.some(s => s.id === grant.sectorId) || granted.has(grant.sectorId) || !['manager', 'member', 'viewer'].includes(grant.role)) return 'Invalid sector permission.';
      granted.add(grant.sectorId);
    }
  }
  return null;
}
