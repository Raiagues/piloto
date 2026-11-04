import type { DeliveryState } from './projectDelivery';
import { deliveryMethods } from './projectDelivery';
import type { MeetingSummary } from './meetings';
import type { ProjectSummary } from './team';
import type { Language } from './types';
import type { SearchItem } from './workspaceSearch';
import { reviewEntries } from './sidebarTree';
import { activityLink, meetingLink, requirementLink, reviewLink, sourceLink, workspaceLink } from './workspaceLinks';

type Sources = {
  language: Language;
  projectId: string;
  delivery: DeliveryState | null;
  meetings: readonly MeetingSummary[] | null;
  projects: readonly ProjectSummary[];
  teams: readonly { id: string; name: string }[];
  today?: string;
};

const dateText = (value: string, pt: boolean) => {
  const at = Date.parse(value.length === 10 ? `${value}T12:00:00` : value);
  return Number.isFinite(at)
    ? new Date(at).toLocaleDateString(pt ? 'pt-BR' : 'en', { day: '2-digit', month: 'short', year: 'numeric' })
    : '';
};

/** Everything the account can already open, flattened for the local search. Nothing here leaves the browser. */
export function buildSearchIndex({
  language,
  projectId,
  delivery,
  meetings,
  projects,
  teams,
  today = new Date().toISOString().slice(0, 10),
}: Sources): SearchItem[] {
  const pt = language === 'pt',
    items: SearchItem[] = [];
  const member = (id: string) => delivery?.members.find(person => person.id === id)?.name || '';
  const sector = (id: string) => delivery?.sectors.find(item => item.id === id)?.name || '';
  if (delivery && projectId) {
    const phases = delivery.lifecycleRanges;
    const reviews = reviewEntries(delivery, today);
    for (const task of delivery.tasks) {
      if (task.archived || task.excluded) continue;
      const phase = phases.find(item => item.id === task.phaseId);
      const phaseText = phase ? `${phase.code} · ${phase.name}` : task.phase;
      const statuses = [
        task.status,
        ...(task.overdue || (task.status !== 'done' && task.dueDate && task.dueDate < today) ? ['overdue'] : []),
        ...(task.blockedBy.length ? ['blocked'] : []),
      ];
      if (task.kind === 'review') {
        const entry = reviews.find(review => review.id === task.id)!;
        items.push({
          id: `review:${task.id}`,
          kind: 'review',
          code: entry.code,
          title: entry.label,
          href: reviewLink(projectId, task.id),
          subtitle: [
            phaseText,
            entry.planned
              ? pt
                ? `${entry.prepared}/${entry.planned} documentos`
                : `${entry.prepared}/${entry.planned} documents`
              : '',
            dateText(task.dueDate, pt),
          ]
            .filter(Boolean)
            .join(' · '),
          text: task.description,
          tags: [
            phase?.name || '',
            member(task.ownerId),
            ...(task.documentOptions || []).map(option => `${option.code} ${option.title}`),
          ],
          date: task.dueDate,
          statuses,
          boost: entry.state === 'next' ? 0.6 : entry.state === 'overdue' ? 0.4 : 0,
        });
      } else {
        items.push({
          id: `task:${task.id}`,
          kind: 'task',
          title: task.title,
          href: activityLink(projectId, task.id),
          subtitle: [phaseText, member(task.ownerId), dateText(task.dueDate || task.startDate, pt)]
            .filter(Boolean)
            .join(' · '),
          text: task.description,
          tags: [sector(task.sectorId), phase?.name || ''],
          date: task.dueDate || task.startDate,
          statuses,
        });
      }
    }
    for (const requirement of delivery.requirements) {
      if (requirement.archived) continue;
      const findings = requirement.analysis?.findings?.length || 0;
      const method = deliveryMethods.find(item => item.id === requirement.method);
      items.push({
        id: `requirement:${requirement.id}`,
        kind: 'requirement',
        code: requirement.id,
        title: requirement.title,
        href: requirementLink(projectId, requirement.id),
        subtitle: [
          sector(requirement.sectorId) || (pt ? 'Sistema' : 'System'),
          method ? (pt ? method.pt : method.en) : '',
          findings
            ? pt
              ? `${findings} apontamento${findings === 1 ? '' : 's'}`
              : `${findings} finding${findings === 1 ? '' : 's'}`
            : '',
        ]
          .filter(Boolean)
          .join(' · '),
        text: [requirement.statement, requirement.rationale, requirement.acceptanceCriteria].filter(Boolean).join('\n'),
        tags: [sector(requirement.sectorId), method?.pt || '', method?.en || ''],
        statuses: [requirement.status, ...(findings ? ['findings'] : [])],
      });
    }
    for (const document of delivery.documents) {
      const review = delivery.tasks.find(task => task.id === document.taskId);
      items.push({
        id: `document:${document.id}`,
        kind: 'document',
        code: document.code,
        title: document.title,
        href: reviewLink(projectId, document.taskId, document.id),
        subtitle: [review ? review.title : '', `v${document.version}`, document.authorName || '']
          .filter(Boolean)
          .join(' · '),
        text: document.body,
        tags: [review?.reviewCode || ''],
        date: document.updatedAt,
        statuses: [document.status],
      });
    }
    for (const phase of phases)
      items.push({
        id: `phase:${phase.id}`,
        kind: 'phase',
        code: phase.code,
        title: phase.name,
        href: workspaceLink('#/schedule', {}, projectId),
        subtitle: `${dateText(phase.start, pt)} — ${dateText(phase.end, pt)}`,
        statuses: phase.start <= today && phase.end >= today ? ['running'] : phase.end < today ? ['done'] : ['planned'],
      });
    for (const artifact of delivery.artifacts)
      items.push({
        id: `source:${artifact.id}`,
        kind: 'source',
        title: artifact.label,
        href: sourceLink(projectId, artifact.id),
        subtitle: pt ? 'Arquivo de origem do projeto' : 'Project source file',
      });
  }
  for (const meeting of meetings || []) {
    const when = meeting.createdAt || meeting.updatedAt || '';
    const recent = Date.now() - Date.parse(when) < 7 * 86_400_000;
    const place =
      meeting.scope === 'sector'
        ? meeting.sectorName || ''
        : meeting.scope === 'team'
          ? pt
            ? 'Geral da equipe'
            : 'Team general'
          : pt
            ? 'Por convite'
            : 'Invite only';
    items.push({
      id: `meeting:${meeting.id}`,
      kind: 'meeting',
      title: meeting.title,
      href: meetingLink(meeting.id, meeting.status === 'done'),
      subtitle: [meeting.projectName || meeting.teamName || '', place, dateText(when, pt)].filter(Boolean).join(' · '),
      tags: [
        meeting.projectName || '',
        meeting.teamName || '',
        meeting.sectorName || '',
        ...meeting.participants.map(person => person.name),
      ],
      date: when,
      statuses: [meeting.status === 'running' ? 'running' : meeting.status === 'done' ? 'done' : 'planned'],
      boost:
        (meeting.projectId === projectId ? 0.3 : 0) + (recent ? 0.3 : 0) + (meeting.status === 'running' ? 0.5 : 0),
    });
  }
  for (const project of projects)
    items.push({
      id: `project:${project.id}`,
      kind: 'project',
      title: project.name || (pt ? 'Projeto sem nome' : 'Untitled project'),
      href: workspaceLink('#/project', {}, project.id),
      subtitle: teams.find(team => team.id === project.teamId)?.name || (pt ? 'Projeto' : 'Project'),
      boost: project.id === projectId ? 0.2 : 0,
    });
  const pages: [string, string, string, string[]][] = [
    ['#/', 'Início', 'Home', ['painel', 'dashboard', 'inicio', 'home']],
    ['#/teams', 'Equipes', 'Teams', ['membros', 'pessoas', 'members']],
    ['#/meetings', 'Reuniões', 'Meetings', ['atas', 'gravação', 'minutes']],
    ['#/messages', 'Mensagens', 'Messages', ['chat', 'conversas']],
    ['#/people', 'Contatos', 'Contacts', ['pessoas', 'people']],
    ['#/new-project', 'Novo projeto', 'New project', ['criar', 'create']],
    ...(projectId
      ? ([
          ['#/project', 'Visão geral do projeto', 'Project overview', ['documentos', 'fontes', 'overview']],
          ['#/requirements', 'Requisitos', 'Requirements', ['tabela', 'subsistemas']],
          ['#/schedule', 'Cronograma', 'Schedule', ['gantt', 'planejamento', 'revisões', 'fases']],
        ] as [string, string, string, string[]][])
      : []),
  ];
  for (const [hash, ptLabel, enLabel, tags] of pages)
    items.push({
      id: `page:${hash}`,
      kind: 'page',
      title: pt ? ptLabel : enLabel,
      href: workspaceLink(hash, {}, projectId),
      subtitle: pt ? 'Página' : 'Page',
      tags,
    });
  return items;
}
