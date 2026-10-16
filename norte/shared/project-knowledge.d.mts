import type { MissionProject } from '../src/lib/projectStore';
import type { ExtractionReport } from '../src/lib/extractionJobs';
export type KnowledgeItem = { id: string; kind: 'omission'|'conflict'|'document'|'architecture'; title: string; reason: string; artifactIds: string[]; entityId?: string|null; action: string; kept?: unknown; candidate?: unknown };
export function projectKnowledgeItems(project: MissionProject, report?: ExtractionReport): KnowledgeItem[];
