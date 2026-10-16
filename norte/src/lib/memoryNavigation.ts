import type { MissionProject } from './projectStore';
import type { ConnectedArtifact } from './team';
export const ARTIFACT_DRAG_TYPE = 'application/x-norte-artifact';
export function memoryFolderChain(project: MissionProject, id?: string | null) {
  const all = [...project.context.sectors, ...(project.context.folders || [])], result: { id: string; name: string }[] = [], seen = new Set();
  while (id && !seen.has(id)) { seen.add(id); const folder = all.find(f => f.id === id); if (!folder) break; result.unshift(folder); id = 'parentId' in folder && typeof folder.parentId === 'string' ? folder.parentId : null; }
  return result;
}
export function memoryFolderIncludes(project: MissionProject, artifact: ConnectedArtifact, folderId: string) {
  return folderId === 'all' || (!folderId && !artifact.folderId) || memoryFolderChain(project, artifact.folderId).some(folder => folder.id === folderId) || (folderId === project.context.programFolderId && Boolean(project.context.programArtifactIds?.includes(artifact.id)));
}
