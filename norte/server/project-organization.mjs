import { technicalHierarchyError, respectsTechnicalFolders } from "../shared/technical-hierarchy.mjs";
import { isDeepStrictEqual } from 'node:util';
import { canEditSector, folderSector, isProjectAdmin, organizationError, sectorRole } from '../shared/project-organization.mjs';
export function organizationFailure(message, statusCode = 403, code = 'FORBIDDEN') {
  return Object.assign(new Error(message), { statusCode, code });
}
export function requireProjectAdmin(record, user) {
  if (!isProjectAdmin(record.document, user, record.createdBy)) throw organizationFailure('Somente o capitão ou administrador pode configurar o projeto.');
}
export function requireArtifactEditor(data, user, artifact) {
  if (user.accessRole === 'advisor') throw organizationFailure('Orientadores possuem acesso de leitura.');
  const record = data.workspace.projects?.[artifact.ownerId];
  if (!record) {
    // Existing unowned legacy artifacts keep their creator/admin, never a global manager.
    if (!artifact.ownerId && artifact.createdBy === user.id) return;
    throw organizationFailure('Projeto do artefato não encontrado.', 404, 'PROJECT_NOT_FOUND');
  }
  const team = data.teams.find(t => t.id === record.document.context?.teamId);
  if (team && !team.memberIds.includes(user.memberId)) throw organizationFailure('Você não pertence à equipe deste projeto.');
  const folderId = artifact.folderId || null;
  const sectorId = folderSector(record.document, folderId);
  if (folderId && !sectorId) throw organizationFailure('Pasta não encontrada neste projeto.', 400, 'FOLDER_NOT_FOUND');
  if (!canEditSector(record.document, user, sectorId, record.createdBy)) throw organizationFailure('Você não pode editar artefatos deste setor.');
}
export function validateProjectOrganization(data, previous, next, user) {
  const old = previous?.document;
  if (next.context) {
    const error = organizationError(next);
    if (error) throw organizationFailure(error, 400, 'INVALID_ORGANIZATION');
    const team = data.teams.find(t => t.id === next.context.teamId);
    if (next.context.publicSummary !== undefined && typeof next.context.publicSummary !== "boolean") throw organizationFailure("Invalid public summary setting.", 400, "INVALID_ORGANIZATION");
    for (const a of next.context.assignments) {
      if (old?.context?.teamId === next.context.teamId && old?.context?.assignments?.some(previous => isDeepStrictEqual(previous, a))) continue;
      if (!team || !data.members.some(m => m.id === a.memberId) || !team.memberIds.includes(a.memberId)) throw organizationFailure('Selecione membros da equipe do projeto.', 400, 'INVALID_MEMBER');
    }
    if (next.context.teamArtifactFolders !== undefined && (typeof next.context.teamArtifactFolders !== 'object' || !next.context.teamArtifactFolders || Array.isArray(next.context.teamArtifactFolders))) throw organizationFailure('Invalid reference folders.', 400, 'INVALID_FOLDER');
    for (const [id, folderId] of Object.entries(next.context.teamArtifactFolders || {})) {
      if (!next.context.teamArtifactIds?.includes(id) || typeof folderId !== 'string' || !folderSector(next, folderId)) throw organizationFailure('Mova as referências antes de remover a pasta.', 409, 'FOLDER_NOT_EMPTY');
    }
    for (const artifact of data.artifacts.filter(a => a.scope === 'project' && a.ownerId === next.id && a.folderId)) {
      if (!folderSector(next, artifact.folderId)) throw organizationFailure('Mova os arquivos antes de excluir a pasta ou setor.', 409, 'FOLDER_NOT_EMPTY');
    }
    for (const id of next.context.projectArtifactIds || []) {
      if (!data.artifacts.some(a => a.id === id && a.scope === 'project' && a.ownerId === next.id)) throw organizationFailure('Artefato não pertence a este projeto.', 400, 'INVALID_ARTIFACT');
    }
    for (const id of next.context.teamArtifactIds || []) {
      if (!data.artifacts.some(a => a.id === id && a.scope === 'team' && a.ownerId === next.context.teamId)) throw organizationFailure('Referência não pertence à equipe.', 400, 'INVALID_ARTIFACT');
    }
    for (const id of next.context.programArtifactIds || []) {
      if (!next.context.projectArtifactIds?.includes(id) && !next.context.teamArtifactIds?.includes(id)) throw organizationFailure('A referência precisa pertencer à memória deste projeto.', 400, 'INVALID_ARTIFACT');
    }
  }
  if (next.engineeringSystem && !isDeepStrictEqual(old?.engineeringSystem, next.engineeringSystem)) {
    const shape = (model, entity) => {
      const parents = [entity.parentId, ...model.relations.filter(r => r.kind === 'contains' && r.to === entity.id).map(r => r.from)].filter(Boolean);
      return { kind: entity.kind, parents: [...new Set(parents)].sort().map(id => [id, model.entities.find(e => e.id === id)?.kind]) };
    };
    const changed = old?.engineeringSystem && new Set(next.engineeringSystem.entities.filter(entity => {
      const before = old.engineeringSystem.entities.find(e => e.id === entity.id);
      return !before || !isDeepStrictEqual(shape(old.engineeringSystem, before), shape(next.engineeringSystem, entity));
    }).map(e => e.id));
    // Old unclassified hardware remains editable; only changed containment must
    // meet the new rule. No startup migration invents missing subsystems.
    const error = technicalHierarchyError(next.engineeringSystem, changed) || respectsTechnicalFolders(next, next.engineeringSystem);
    if (error) throw organizationFailure(error, 400, "INVALID_HIERARCHY");
  }
  if (!old) return;
  if (next.creatorId !== old.creatorId) throw organizationFailure('O proprietário do projeto não pode ser alterado.');
  if (isProjectAdmin(old, user, previous.createdBy)) return;
  const oldContext = old.context || {}, nextContext = next.context || {};
  // A member may save navigation and ideas, but cannot overwrite other sectors,
  // ownership, the shared technical baseline or project-wide settings via PUT.
  for (const field of ['name', 'projectType', 'setup', 'engineeringSystem']) {
    if (!isDeepStrictEqual(old[field], next[field])) throw organizationFailure('Somente a liderança pode alterar as informações gerais e a arquitetura do projeto.');
  }
  for (const field of new Set([...Object.keys(oldContext), ...Object.keys(nextContext)])) {
    if (['assignments', 'folders', 'configured', 'teamArtifactFolders'].includes(field)) continue;
    if (!isDeepStrictEqual(oldContext[field], nextContext[field])) throw organizationFailure('Somente a liderança pode alterar a estrutura e as referências do projeto.');
  }
  const fromPlacements = oldContext.teamArtifactFolders || {}, toPlacements = nextContext.teamArtifactFolders || {};
  for (const id of new Set([...Object.keys(fromPlacements), ...Object.keys(toPlacements)])) {
    if (fromPlacements[id] === toPlacements[id]) continue;
    if (!canEditSector(old, user, folderSector(old, fromPlacements[id])) || !canEditSector(old, user, folderSector(next, toPlacements[id]))) throw organizationFailure('Sem permissão para mover esta referência.');
  }
  const oldAssignments = oldContext.assignments || [], nextAssignments = nextContext.assignments || [];
  if (!isDeepStrictEqual(oldAssignments, nextAssignments)) {
    if (oldAssignments.length !== nextAssignments.length) throw organizationFailure('Somente o capitão pode adicionar ou remover participantes.');
    for (const a of nextAssignments) {
      const before = oldAssignments.find(b => b.memberId === a.memberId);
      if (!before || !isDeepStrictEqual({ ...before, sectorRoles: [] }, { ...a, sectorRoles: [] })) throw organizationFailure('Somente o capitão pode alterar cargos e setores principais.');
      const sectorIds = new Set([...(before.sectorRoles || []), ...(a.sectorRoles || [])].map(g => g.sectorId));
      for (const sector of sectorIds) {
        const from = before.sectorRoles?.find(g => g.sectorId === sector), to = a.sectorRoles?.find(g => g.sectorId === sector);
        if (!isDeepStrictEqual(from, to) && (sectorRole(old, user, sector) !== 'manager' || a.memberId === user.memberId || (from?.role || (before.roleId === 'manager' && before.sectorId === sector ? 'manager' : '')) === 'manager' || to?.role === 'manager' || before.roleId === 'captain' || before.roleId === 'advisor')) throw organizationFailure('O gerente pode atribuir leitura ou edição somente no próprio setor.');
      }
    }
  }
  const oldFolders = oldContext.folders || [], nextFolders = nextContext.folders || [];
  for (const id of new Set([...oldFolders, ...nextFolders].map(f => f.id))) {
    const from = oldFolders.find(f => f.id === id), to = nextFolders.find(f => f.id === id);
    if (isDeepStrictEqual(from, to)) continue;
    for (const [project, folder] of [[old, from], [next, to]]) {
      if (folder && sectorRole(old, user, folderSector(project, folder.id)) !== 'manager') throw organizationFailure('Somente o gerente pode organizar pastas do próprio setor.');
    }
    // Moving an ancestor also moves all its artifacts; both domains need authority.
    for (const artifact of data.artifacts.filter(a => a.ownerId === next.id && a.folderId)) {
      if (folderSector(old, artifact.folderId) !== folderSector(next, artifact.folderId) && (!canEditSector(old, user, folderSector(old, artifact.folderId)) || !canEditSector(old, user, folderSector(next, artifact.folderId)))) throw organizationFailure('Sem permissão para mover arquivos entre estes setores.');
    }
  }
}
