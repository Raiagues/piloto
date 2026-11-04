import type { DeliveryState } from './projectDelivery';
import type { MeetingSummary } from './meetings';
import { reviewEntries } from './sidebarTree';
import type { ReviewEntry } from './sidebarTree';
import { activityLink, requirementLink, reviewLink } from './workspaceLinks';

const DAY = 86_400_000;
const time = (date: string) => {
  const value = /^\d{4}-\d{2}-\d{2}$/.test(date) ? Date.parse(`${date}T00:00:00Z`) : NaN;
  return Number.isFinite(value) ? value : null;
};
const days = (from: string, to: string) => {
  const a = time(from),
    b = time(to);
  return a === null || b === null ? null : Math.round((b - a) / DAY);
};

export type AttentionItem = {
  id: string;
  tone: 'danger' | 'warning';
  kind: 'overdue' | 'blocked' | 'conflict' | 'revalidate' | 'documents' | 'changes' | 'findings';
  code: string;
  title: string;
  detail: string;
  href: string;
  date: string;
};
export type HomeOverview = {
  phase: {
    code: string;
    name: string;
    start: string;
    end: string;
    elapsed: number;
    daysLeft: number;
    state: 'current' | 'upcoming' | 'finished';
  } | null;
  timeline: {
    phases: { id: string; code: string; name: string; left: number; width: number; current: boolean; past: boolean }[];
    reviews: { id: string; code: string; at: number; state: ReviewEntry['state'] }[];
    today: number | null;
  } | null;
  next: (ReviewEntry & { criteriaMet: number; criteriaTotal: number }) | null;
  upcoming: ReviewEntry[];
  openReviews: number;
  requirements: { total: number; approved: number; inReview: number; withFindings: number; findings: number };
  documents: { planned: number; prepared: number; approved: number };
  attention: AttentionItem[];
  meetings: MeetingSummary[];
};

/** What an engineer needs on arrival: where the lifecycle stands, the next gate, and what is late or blocked. */
export function homeOverview(
  data: DeliveryState | null,
  meetings: MeetingSummary[] | null,
  projectId: string,
  today: string,
  pt: boolean,
): HomeOverview {
  const projectMeetings = (meetings || [])
    .filter(meeting => meeting.projectId === projectId)
    .sort((a, b) => (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || ''))
    .slice(0, 5);
  if (!data)
    return {
      phase: null,
      timeline: null,
      next: null,
      upcoming: [],
      openReviews: 0,
      requirements: { total: 0, approved: 0, inReview: 0, withFindings: 0, findings: 0 },
      documents: { planned: 0, prepared: 0, approved: 0 },
      attention: [],
      meetings: projectMeetings,
    };

  const ranges = data.lifecycleRanges.filter(range => time(range.start) !== null && time(range.end) !== null);
  const current = ranges.find(range => range.start <= today && today <= range.end);
  const upcomingPhase = ranges.find(range => range.start > today),
    last = ranges[ranges.length - 1];
  const focus = current || upcomingPhase || last;
  const phase = focus
    ? {
        code: focus.code,
        name: focus.name,
        start: focus.start,
        end: focus.end,
        elapsed: current
          ? Math.min(
              1,
              Math.max(0, (time(today)! - time(focus.start)! + DAY) / (time(focus.end)! - time(focus.start)! + DAY)),
            )
          : focus === upcomingPhase
            ? 0
            : 1,
        daysLeft: days(today, current ? focus.end : focus.start) ?? 0,
        state: current ? ('current' as const) : focus === upcomingPhase ? ('upcoming' as const) : ('finished' as const),
      }
    : null;

  const entries = reviewEntries(data, today);
  let timeline: HomeOverview['timeline'] = null;
  if (ranges.length) {
    const first = Math.min(...ranges.map(range => time(range.start)!)),
      end = Math.max(...ranges.map(range => time(range.end)! + DAY)),
      span = Math.max(DAY, end - first);
    const at = (value: number) => ((value - first) / span) * 100,
      now = time(today)!;
    timeline = {
      phases: ranges.map(range => ({
        id: range.id,
        code: range.code,
        name: range.name,
        left: at(time(range.start)!),
        width: Math.max(0.6, at(time(range.end)! + DAY) - at(time(range.start)!)),
        current: range === current,
        past: range.end < today,
      })),
      reviews: entries.flatMap(entry => {
        const value = time(entry.dueDate);
        return value !== null && value >= first && value <= end
          ? [{ id: entry.id, code: entry.code, at: at(value), state: entry.state }]
          : [];
      }),
      today: now >= first && now <= end ? at(now) : null,
    };
  }

  const tasks = data.tasks.filter(task => !task.archived && !task.excluded);
  const nextEntry = entries.find(entry => entry.state === 'overdue') || entries.find(entry => entry.state === 'next');
  const nextTask = nextEntry && tasks.find(task => task.id === nextEntry.id);
  const criteria = nextTask
    ? [
        ...nextTask.requirementIds.map(
          id => data.requirements.find(item => item.id === id && !item.archived)?.status === 'approved',
        ),
        ...nextTask.testIds.map(id => data.tests.find(item => item.id === id && !item.archived)?.status === 'passed'),
      ]
    : [];
  const next =
    nextEntry && nextTask
      ? {
          ...nextEntry,
          criteriaMet: criteria.filter(Boolean).length,
          criteriaTotal: criteria.length,
        }
      : null;

  const requirements = data.requirements.filter(item => !item.archived);
  const findingsOf = (item: DeliveryState['requirements'][number]) => item.analysis?.findings?.length || 0;
  const reviewsOpen = entries.filter(entry => entry.state !== 'done');

  const attention: AttentionItem[] = [];
  const ago = (date: string) => {
    const value = days(date, today) ?? 0;
    return pt
      ? `venceu há ${value} ${value === 1 ? 'dia' : 'dias'}`
      : `${value} ${value === 1 ? 'day' : 'days'} overdue`;
  };
  for (const task of tasks) {
    if (task.status === 'done') continue;
    const code = task.kind === 'review' ? task.reviewCode || '' : '',
      href = task.kind === 'review' ? reviewLink(projectId, task.id) : activityLink(projectId, task.id);
    const title =
      code && task.title.startsWith(code)
        ? task.title.slice(code.length).replace(/^\s*[·:-]\s*/, '') || task.title
        : task.title;
    if (task.overdue || (task.dueDate && task.dueDate < today))
      attention.push({
        id: `overdue:${task.id}`,
        tone: 'danger',
        kind: 'overdue',
        code,
        title,
        detail: ago(task.dueDate),
        href,
        date: task.dueDate,
      });
    else if (task.status === 'blocked' || task.blockedBy.length)
      attention.push({
        id: `blocked:${task.id}`,
        tone: 'warning',
        kind: 'blocked',
        code,
        title,
        detail: task.blockedBy.length
          ? pt
            ? `aguarda ${task.blockedBy.length} ${task.blockedBy.length === 1 ? 'atividade anterior' : 'atividades anteriores'}`
            : `waiting on ${task.blockedBy.length} earlier ${task.blockedBy.length === 1 ? 'activity' : 'activities'}`
          : pt
            ? 'marcada como bloqueada'
            : 'marked as blocked',
        href,
        date: task.dueDate,
      });
    else if (task.dateConflicts.length)
      attention.push({
        id: `conflict:${task.id}`,
        tone: 'warning',
        kind: 'conflict',
        code,
        title,
        detail: pt ? 'começa antes de uma dependência terminar' : 'starts before a dependency ends',
        href,
        date: task.startDate || task.dueDate,
      });
    if (task.reviewNeedsRevalidation)
      attention.push({
        id: `revalidate:${task.id}`,
        tone: 'warning',
        kind: 'revalidate',
        code,
        title,
        detail: pt ? 'critérios mudaram; revalidar evidências' : 'criteria changed; revalidate evidence',
        href,
        date: task.dueDate,
      });
  }
  // A review within two weeks whose documents are still incomplete.
  for (const entry of reviewsOpen) {
    const task = tasks.find(item => item.id === entry.id),
      due = task?.dueDate || '',
      left = days(today, due);
    if (
      !task ||
      !entry.planned ||
      entry.prepared >= entry.planned ||
      left === null ||
      left > 14 ||
      entry.state === 'overdue'
    )
      continue;
    attention.push({
      id: `documents:${entry.id}`,
      tone: left < 0 ? 'danger' : 'warning',
      kind: 'documents',
      code: entry.code,
      title: entry.label,
      detail: pt
        ? `${entry.prepared} de ${entry.planned} documentos; revisão ${left < 0 ? `atrasada há ${-left} dias` : left === 0 ? 'hoje' : `em ${left} dias`}`
        : `${entry.prepared} of ${entry.planned} documents; review ${left < 0 ? `${-left} days late` : left === 0 ? 'today' : `in ${left} days`}`,
      href: reviewLink(projectId, entry.id),
      date: due,
    });
  }
  for (const document of data.documents) {
    if (document.status !== 'changes_requested') continue;
    attention.push({
      id: `changes:${document.id}`,
      tone: 'warning',
      kind: 'changes',
      code: document.code,
      title: document.title,
      detail: pt ? 'alterações solicitadas na revisão' : 'changes requested in review',
      href: reviewLink(projectId, document.taskId, document.id),
      date: document.updatedAt?.slice(0, 10) || '',
    });
  }
  for (const requirement of requirements) {
    const count = findingsOf(requirement);
    if (count && requirement.status !== 'approved')
      attention.push({
        id: `findings:${requirement.id}`,
        tone: 'warning',
        kind: 'findings',
        code: requirement.id,
        title: requirement.title,
        detail: pt
          ? `${count} ${count === 1 ? 'apontamento' : 'apontamentos'} da análise`
          : `${count} analysis ${count === 1 ? 'finding' : 'findings'}`,
        href: requirementLink(projectId, requirement.id),
        date: '',
      });
  }
  attention.sort(
    (a, b) =>
      (a.tone === b.tone ? 0 : a.tone === 'danger' ? -1 : 1) || (a.date || '9999').localeCompare(b.date || '9999'),
  );

  const planned = entries.reduce((sum, entry) => sum + entry.planned, 0);
  return {
    phase,
    timeline,
    next,
    upcoming: reviewsOpen.slice(0, 4),
    openReviews: reviewsOpen.length,
    requirements: {
      total: requirements.length,
      approved: requirements.filter(item => item.status === 'approved').length,
      inReview: requirements.filter(item => item.status === 'in_review').length,
      withFindings: requirements.filter(item => findingsOf(item) > 0).length,
      findings: requirements.reduce((sum, item) => sum + findingsOf(item), 0),
    },
    documents: {
      planned,
      prepared: entries.reduce((sum, entry) => sum + entry.prepared, 0),
      approved: entries.reduce((sum, entry) => sum + entry.approved, 0),
    },
    attention,
    meetings: projectMeetings,
  };
}
