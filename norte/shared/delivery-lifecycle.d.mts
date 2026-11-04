export interface Lifecycle {
  profile: string;
  startDate: string;
  durations: number[];
  selectedReviews?: string[];
  phases?: LifecyclePhase[];
}
export interface ReviewDefinition {
  id: string;
  title: string;
  english?: string;
  phase: number;
  position: number;
  lane: number;
  week?: number;
  active: boolean;
  focus: string;
}
export interface LifecyclePhase {
  id: string;
  templateCode?: string;
  code: string;
  name: string;
  start: string;
  end: string;
}
export interface LifecycleRange extends LifecyclePhase {
  index: number;
}
export const REVIEW_PROFILES: Record<string, ReviewDefinition[]>;
export const LIFE_PHASES: Record<string, string[][]>;
export const LIFE_DURATIONS: Record<string, number[]>;
export function shiftDate(date: string, days: number): string;
export function lifecycleRanges(lifecycle: Lifecycle): LifecycleRange[];
export function lifecycleMilestones(
  lifecycle: Lifecycle,
): (ReviewDefinition & { date: string; phaseId: string; phaseName: string })[];
export function reviewDocuments(profile: string, code: string): import('./document-templates.mjs').DocumentOption[];
