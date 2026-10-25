import { ListChecks, ShieldCheck, CalendarDays, FolderOpen } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Language } from './types';
import type { ProjectArea } from './workspaceRoutes';

export type RailKey = ProjectArea;
export type RailStop = { key: RailKey; pt: string; en: string; Icon: LucideIcon; area: ProjectArea };
/** Shared ordering for the sidebar and each page's previous/next controls. */
export const PROJECT_RAIL: RailStop[] = [
  { key: 'requirements', pt: 'Requisitos', en: 'Requirements', Icon: ListChecks, area: 'requirements' },
  { key: 'verification', pt: 'Verificação', en: 'Verification', Icon: ShieldCheck, area: 'verification' },
  { key: 'schedule', pt: 'Cronograma', en: 'Schedule', Icon: CalendarDays, area: 'schedule' },
  { key: 'documents', pt: 'Documentos', en: 'Documents', Icon: FolderOpen, area: 'documents' }
];
export const railLabel = (stop: RailStop, language: Language) => language === 'pt' ? stop.pt : stop.en;
