export const MTCR_ANNEX_URL: string;
export type OfficialResearchSource = { id: string; title: string; url: string; section: string; summary: string };
export const OFFICIAL_RESEARCH_SOURCES: OfficialResearchSource[];
export function inspectRegulatoryReferences(requirement: { statement: string }, standards?: string[]): {
  id: string; ruleId: string; severity: string; title: string; explanation: string;
  suggestion: string; start: number; end: number; affectedText: string; origin: string;
  reference: { title: string; source: string; section: string; page: number; url: string; checkedAt: string };
}[];
