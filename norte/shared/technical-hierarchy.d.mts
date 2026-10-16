import type { MissionProject } from '../src/lib/projectStore';
import type { EngineeringSystemModel } from '../src/lib/engineeringSystem';
export function technicalHierarchyError(model: EngineeringSystemModel, entityIds?: Set<string>): string | null;
export function technicalFolderDefinitions(project: MissionProject): { id: string; name: string; kind: string; parentId?: string }[];
export function respectsTechnicalFolders(project: MissionProject, model: EngineeringSystemModel): string | null;
