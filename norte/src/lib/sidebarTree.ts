import type { DeliveryState } from './projectDelivery';
import type { MeetingSummary } from './meetings';
import type { Language } from './types';

export type ReviewState = 'done' | 'overdue' | 'next' | 'planned';
export type ReviewEntry = {
  id: string;
  code: string;
  title: string;
  label: string;
  dueDate: string;
  state: ReviewState;
  planned: number;
  prepared: number;
  approved: number;
  documents: { id: string; title: string; code: string; status: string; version: number }[];
};
export type MeetingEntry = { id: string; title: string; date: string; status: string };
export type MeetingFolder = {
  key: string;
  kind: 'team' | 'sector' | 'private';
  label: string;
  meetings: MeetingEntry[];
  months: { key: string; label: string; meetings: MeetingEntry[] }[];
};

/** Reviews in date order with how many planned documents exist and how many are approved. */
export function reviewEntries(
  data: Pick<DeliveryState, 'tasks' | 'documents'>,
  today = new Date().toISOString().slice(0, 10),
): ReviewEntry[] {
  const reviews = data.tasks
    .filter(task => task.kind === 'review' && !task.archived && !task.excluded)
    .sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || a.title.localeCompare(b.title));
  const next = reviews.find(task => task.status !== 'done' && task.dueDate && task.dueDate >= today);
  return reviews.map(task => {
    const options = task.documentOptions || [],
      saved = data.documents.filter(document => document.taskId === task.id);
    const planned = options.filter(option => saved.some(document => document.templateId === option.id));
    const code = task.reviewCode || task.title.split(/\s*[·:]\s*/)[0].trim();
    const label = task.title.startsWith(code)
      ? task.title.slice(code.length).replace(/^\s*[·:-]\s*/, '') || task.title
      : task.title;
    const state: ReviewState =
      task.status === 'done'
        ? 'done'
        : task.overdue || (task.dueDate && task.dueDate < today)
          ? 'overdue'
          : task.id === next?.id
            ? 'next'
            : 'planned';
    return {
      id: task.id,
      code,
      title: task.title,
      label,
      dueDate: task.dueDate,
      state,
      planned: options.length,
      prepared: planned.length,
      approved: saved.filter(
        document => document.status === 'approved' && options.some(option => option.id === document.templateId),
      ).length,
      documents: saved.map(document => ({
        id: document.id,
        title: document.title,
        code: document.code,
        status: document.status,
        version: document.version,
      })),
    };
  });
}

/** Requirement subsystems with active counts, in the project's sector order; requirements without a sector stay under "System". */
export function requirementGroups(data: Pick<DeliveryState, 'requirements' | 'sectors'>, language: Language) {
  const active = data.requirements.filter(requirement => !requirement.archived);
  return [{ id: '__system', name: language === 'pt' ? 'Sistema' : 'System' }, ...data.sectors]
    .map(sector => ({
      id: sector.id,
      name: sector.name,
      count: active.filter(requirement => (requirement.sectorId || '__system') === sector.id).length,
    }))
    .filter(group => group.count > 0);
}

const MONTH_LIMIT = 6;
/**
 * Meetings of one project in folders: the team's general meetings, one folder per project sector (also when still empty)
 * and invitation-only meetings. Busy folders are split by month so a long history never floods the sidebar.
 */
export function meetingFolders(
  meetings: readonly MeetingSummary[],
  projectId: string,
  sectors: readonly { id: string; name: string }[],
  language: Language,
): MeetingFolder[] {
  const pt = language === 'pt',
    folders = new Map<string, MeetingFolder>();
  const month = new Intl.DateTimeFormat(pt ? 'pt-BR' : 'en', { month: 'long', year: 'numeric' });
  for (const meeting of meetings) {
    if (!projectId || meeting.projectId !== projectId) continue;
    const scope = meeting.scope || 'private';
    const key = scope === 'sector' ? `sector:${meeting.sectorId || ''}` : scope;
    const label =
      scope === 'sector'
        ? meeting.sectorName ||
          sectors.find(sector => sector.id === meeting.sectorId)?.name ||
          (pt ? 'Setor' : 'Sector')
        : scope === 'team'
          ? pt
            ? 'Geral da equipe'
            : 'Team general'
          : pt
            ? 'Por convite'
            : 'Invite only';
    const folder = folders.get(key) || { key, kind: scope, label, meetings: [], months: [] };
    folder.meetings.push({
      id: meeting.id,
      title: meeting.title,
      date: meeting.createdAt || meeting.updatedAt || '',
      status: meeting.status,
    });
    folders.set(key, folder);
  }
  if (projectId)
    for (const sector of sectors)
      if (!folders.has(`sector:${sector.id}`))
        folders.set(`sector:${sector.id}`, {
          key: `sector:${sector.id}`,
          kind: 'sector',
          label: sector.name,
          meetings: [],
          months: [],
        });
  const rank = (folder: MeetingFolder) =>
    folder.kind === 'team'
      ? -1
      : folder.kind === 'private'
        ? Number.MAX_SAFE_INTEGER
        : (index => (index < 0 ? sectors.length : index))(
            sectors.findIndex(sector => folder.key === `sector:${sector.id}`),
          );
  return [...folders.values()]
    .sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label, pt ? 'pt-BR' : 'en'))
    .map(folder => {
      folder.meetings.sort((a, b) => b.date.localeCompare(a.date));
      if (folder.meetings.length > MONTH_LIMIT) {
        const months = new Map<string, { key: string; label: string; meetings: MeetingEntry[] }>();
        for (const meeting of folder.meetings) {
          const at = Date.parse(meeting.date),
            key = Number.isFinite(at) ? meeting.date.slice(0, 7) : 'undated';
          const group = months.get(key) || {
            key,
            label: Number.isFinite(at) ? month.format(at) : pt ? 'Sem data' : 'Undated',
            meetings: [],
          };
          group.meetings.push(meeting);
          months.set(key, group);
        }
        folder.months = [...months.values()];
      }
      return folder;
    });
}

/** "27/10" for this year, "27/10/25" otherwise: dates line up in the narrow sidebar. */
export function shortDate(value: string, language: Language, now = new Date()) {
  const at = Date.parse(value);
  if (!Number.isFinite(at)) return '—';
  const date = new Date(at),
    sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString(language === 'pt' ? 'pt-BR' : 'en-GB', {
    day: '2-digit',
    month: '2-digit',
    ...(sameYear ? {} : { year: '2-digit' }),
  });
}

/** "em 12 dias", "hoje", "há 3 dias": how far the review is from today. */
export function countdown(date: string, today: string, pt: boolean) {
  if (!date) return '';
  const days = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (!Number.isFinite(days)) return '';
  if (days === 0) return pt ? 'hoje' : 'today';
  if (days === 1) return pt ? 'amanhã' : 'tomorrow';
  if (days === -1) return pt ? 'ontem' : 'yesterday';
  return days > 0 ? (pt ? `em ${days} dias` : `in ${days} days`) : pt ? `há ${-days} dias` : `${-days} days ago`;
}
