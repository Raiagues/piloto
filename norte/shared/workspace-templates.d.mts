import type { MissionProject } from '../src/lib/projectStore';
export const DOCUMENT_FOLDER_TEMPLATES: Record<string, { pt: string; en: string; folders: { key: string; parent?: string; pt: string; en: string }[] }>;
export function applyDocumentFolderTemplate(project: MissionProject, parentId: string, templateKey: string, language?: string): MissionProject;
export function addSuggestedSectors(project: MissionProject, suggestions: { id: string; name: string }[]): MissionProject;
export function ensureProgramReferenceFolder(project: MissionProject, language?: string): MissionProject;
