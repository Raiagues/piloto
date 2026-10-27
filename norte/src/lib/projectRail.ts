import { LayoutDashboard, ListChecks, CalendarDays } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Language } from './types';
import type { ProjectArea } from './workspaceRoutes';

export type RailKey = ProjectArea;
export type RailStop = { key: RailKey; pt: string; en: string; Icon: LucideIcon; area: ProjectArea };
/** Shared ordering for the sidebar and the header location. */
export const PROJECT_RAIL: RailStop[] = [
  { key: 'project', pt: 'Visão geral', en: 'Overview', Icon: LayoutDashboard, area: 'project' },
  { key: 'requirements', pt: 'Requisitos', en: 'Requirements', Icon: ListChecks, area: 'requirements' },
  { key: 'schedule', pt: 'Cronograma', en: 'Schedule', Icon: CalendarDays, area: 'schedule' }
];
export const railLabel = (stop: RailStop, language: Language) => language === 'pt' ? stop.pt : stop.en;
