import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  ArrowRight,
  ChevronRight,
  FolderOpen,
  LoaderCircle,
  MessageSquare,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useRecentWork } from '../lib/workspaceHistory';
import { useDeliverySnapshot, useMeetingsSnapshot } from '../lib/workspaceIndex';
import { homeOverview } from '../lib/homeOverview';
import { countdown, shortDate } from '../lib/sidebarTree';
import { meetingLink, openLink, reviewLink, workspaceLink } from '../lib/workspaceLinks';
import { RecentList } from '../components/RecentWork';
import { projectMonogram } from '../components/MissionSidebar';
import type { ProjectSummary } from '../lib/team';
import type { Language } from '../lib/types';
import '../styles/features/home.css';
import '../styles/recent-work.css';
type Props = {
  language: Language;
  projects?: ProjectSummary[];
  teams?: { id: string; name: string }[];
  loadingProjects?: boolean;
  activeProjectId?: string;
  onOpenProject?: (projectId: string) => void;
  onDeleteProject?: (projectId: string) => Promise<void> | void;
  onCreateProject?: () => void;
  onOpenTeams?: () => void;
  onSearch?: () => void;
};

const percent = (value: number, total: number) => (total ? Math.round((value / total) * 100) : 0);

export function HomePage({
  language,
  projects = [],
  teams = [],
  loadingProjects = false,
  activeProjectId = '',
  onOpenProject,
  onDeleteProject,
  onCreateProject,
  onSearch,
}: Props) {
  const { user } = useAuth(),
    recent = useRecentWork(),
    pt = language === 'pt';
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [deletingId, setDeletingId] = useState('');
  const [allAttention, setAllAttention] = useState(false);
  const c = pt
    ? {
        create: 'Novo projeto',
        open: 'Abrir projeto',
        chooseProject: 'Escolha um projeto',
        empty: 'Nenhum projeto criado ainda.',
        emptyHint: 'Crie um projeto ou peça um convite para a equipe.',
        loading: 'Carregando projetos',
        untitled: 'Projeto sem nome',
        noTeam: 'Sem equipe',
        member: 'pessoa',
        members: 'pessoas',
        updated: 'Atualizado',
        delete: 'Excluir projeto',
        deleteConfirm:
          'Excluir este projeto permanentemente? A equipe e seus artefatos permanentes não serão apagados.',
        close: 'Fechar',
      }
    : {
        create: 'New project',
        open: 'Open project',
        chooseProject: 'Choose a project',
        empty: 'No projects have been created yet.',
        emptyHint: 'Create a project or ask a team for an invitation.',
        loading: 'Loading projects',
        untitled: 'Untitled project',
        noTeam: 'No team',
        member: 'person',
        members: 'people',
        updated: 'Updated',
        delete: 'Delete project',
        deleteConfirm: 'Delete this project permanently? The team and its permanent artifacts will not be deleted.',
        close: 'Close',
      };
  useEffect(() => {
    if (!projectPickerOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setProjectPickerOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [projectPickerOpen]);
  async function deleteProject(projectId: string) {
    if (!window.confirm(c.deleteConfirm)) return;
    setDeletingId(projectId);
    try {
      await onDeleteProject?.(projectId);
    } finally {
      setDeletingId('');
    }
  }
  const teamName = (project: ProjectSummary) => teams.find(team => team.id === project.teamId)?.name || c.noTeam;
  const date = (value: string) =>
    new Intl.DateTimeFormat(pt ? 'pt-BR' : 'en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(
      new Date(value),
    );
  const dayMonth = (value: string) =>
    value
      ? new Date(`${value}T12:00:00`)
          .toLocaleDateString(pt ? 'pt-BR' : 'en-GB', { day: '2-digit', month: 'short' })
          .replace('.', '')
      : '';
  const ordered = [...projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const firstName = (user?.name || '').trim().split(/\s+/u)[0];

  const project = projects.find(item => item.id === activeProjectId);
  const delivery = useDeliverySnapshot(project ? project.id : ''),
    meetings = useMeetingsSnapshot();
  const today = new Date().toISOString().slice(0, 10);
  const overview = useMemo(
    () => homeOverview(delivery, meetings, project?.id || '', today, pt),
    [delivery, meetings, project?.id, today, pt],
  );
  const go = (hash: string, params: Record<string, string> = {}) =>
    openLink(workspaceLink(hash, params, project?.id || ''));
  const { phase, timeline, next, requirements, documents } = overview;
  const reviewsLeft = overview.openReviews;

  return (
    <div className="home-shell home-landing-shell">
      <main className="home-main">
        <section className="home-landing" aria-labelledby="norte-home-title">
          <header className="home-heading">
            <div>
              <p className="home-today">
                {new Intl.DateTimeFormat(pt ? 'pt-BR' : 'en-GB', {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                }).format(new Date())}
              </p>
              <h1 id="norte-home-title">
                {firstName
                  ? pt
                    ? `Olá, ${firstName}`
                    : `Hello, ${firstName}`
                  : pt
                    ? 'Seu espaço de trabalho'
                    : 'Your workspace'}
              </h1>
            </div>
            <div className="home-heading-actions">
              {onSearch && (
                <button type="button" className="home-search" onClick={onSearch}>
                  <Search size={15} aria-hidden="true" />
                  <span>
                    {pt ? 'Buscar revisões, requisitos, reuniões…' : 'Search reviews, requirements, meetings…'}
                  </span>
                  <kbd>Ctrl K</kbd>
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  window.location.hash = '#/meetings';
                }}
              >
                <MessageSquare size={15} aria-hidden="true" />
                {pt ? 'Reuniões' : 'Meetings'}
              </button>
              <button type="button" className="primary" onClick={onCreateProject}>
                <Plus size={15} aria-hidden="true" />
                {c.create}
              </button>
            </div>
          </header>

          {project ? (
            <section className="home-focus" aria-labelledby="home-focus-title">
              <header>
                <span className="home-monogram" aria-hidden="true">
                  {projectMonogram(project.name || c.untitled)}
                </span>
                <div>
                  <h2 id="home-focus-title">{project.name || c.untitled}</h2>
                  <small>
                    {[teamName(project), phase ? `${pt ? 'fase' : 'phase'} ${phase.code} · ${phase.name}` : '']
                      .filter(Boolean)
                      .join(' · ')}
                  </small>
                </div>
                <button type="button" onClick={() => go('#/project')}>
                  {pt ? 'Visão geral' : 'Overview'}
                  <ArrowRight size={15} aria-hidden="true" />
                </button>
              </header>
              {!delivery ? (
                <p className="home-loading">
                  <LoaderCircle className="home-spin" size={15} aria-hidden="true" />
                  {pt ? 'Carregando o andamento do projeto…' : 'Loading project progress…'}
                </p>
              ) : (
                <>
                  {timeline && (
                    <button
                      type="button"
                      className="home-lifecycle"
                      onClick={() => go('#/schedule')}
                      aria-label={
                        pt
                          ? `Ciclo de vida com ${timeline.phases.length} fases. Abrir o cronograma.`
                          : `Lifecycle with ${timeline.phases.length} phases. Open the schedule.`
                      }
                    >
                      {timeline.phases.map(item => (
                        <span
                          key={item.id}
                          className={`home-lifecycle-phase${item.current ? ' is-current' : ''}${item.past ? ' is-past' : ''}`}
                          style={{ left: `${item.left}%`, width: `${item.width}%` }}
                          title={`${item.code} · ${item.name}`}
                        >
                          <b>{item.code}</b>
                          <span>{item.name}</span>
                        </span>
                      ))}
                      {timeline.reviews.map(item => (
                        <i
                          key={item.id}
                          className={`home-lifecycle-review state-${item.state}`}
                          style={{ left: `${item.at}%` }}
                          title={item.code}
                        />
                      ))}
                      {timeline.today !== null && (
                        <em className="home-lifecycle-today" style={{ left: `${timeline.today}%` }} />
                      )}
                    </button>
                  )}
                  <div className="home-kpis">
                    <button type="button" className="home-kpi" onClick={() => go('#/schedule')}>
                      <small>
                        {phase?.state === 'upcoming'
                          ? pt
                            ? 'Próxima fase'
                            : 'Next phase'
                          : phase?.state === 'finished'
                            ? pt
                              ? 'Última fase'
                              : 'Last phase'
                            : pt
                              ? 'Fase atual'
                              : 'Current phase'}
                      </small>
                      {phase ? (
                        <>
                          <strong>
                            <b>{phase.code}</b>
                            {phase.name}
                          </strong>
                          <span className="home-kpi-bar">
                            <i style={{ width: `${Math.round(phase.elapsed * 100)}%` }} />
                          </span>
                          <em>
                            {phase.state === 'current'
                              ? pt
                                ? `${Math.round(phase.elapsed * 100)}% do prazo · termina ${countdown(phase.end, today, pt)}`
                                : `${Math.round(phase.elapsed * 100)}% of the window · ends ${countdown(phase.end, today, pt)}`
                              : phase.state === 'upcoming'
                                ? pt
                                  ? `começa ${countdown(phase.start, today, pt)}`
                                  : `starts ${countdown(phase.start, today, pt)}`
                                : pt
                                  ? `encerrada em ${dayMonth(phase.end)}`
                                  : `ended ${dayMonth(phase.end)}`}
                          </em>
                        </>
                      ) : (
                        <>
                          <strong className="is-empty">{pt ? 'Sem fases' : 'No phases'}</strong>
                          <em>{pt ? 'Planeje as fases no cronograma.' : 'Plan the phases in the schedule.'}</em>
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      className={`home-kpi${next?.state === 'overdue' ? ' is-late' : ''}`}
                      disabled={!next}
                      onClick={() => next && openLink(reviewLink(project.id, next.id))}
                    >
                      <small>
                        {next?.state === 'overdue'
                          ? pt
                            ? 'Revisão atrasada'
                            : 'Overdue review'
                          : pt
                            ? 'Próxima revisão'
                            : 'Next review'}
                      </small>
                      {next ? (
                        <>
                          <strong>
                            <b>{next.code}</b>
                            {countdown(next.dueDate, today, pt)}
                          </strong>
                          <span className="home-kpi-bar">
                            <i style={{ width: `${percent(next.prepared, next.planned)}%` }} />
                          </span>
                          <em>
                            {[
                              next.planned
                                ? pt
                                  ? `${next.prepared} de ${next.planned} documentos`
                                  : `${next.prepared} of ${next.planned} documents`
                                : '',
                              next.criteriaTotal
                                ? pt
                                  ? `${next.criteriaMet}/${next.criteriaTotal} critérios`
                                  : `${next.criteriaMet}/${next.criteriaTotal} criteria`
                                : '',
                              dayMonth(next.dueDate),
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </em>
                        </>
                      ) : (
                        <>
                          <strong className="is-empty">{pt ? 'Nenhuma' : 'None'}</strong>
                          <em>{pt ? 'Sem revisões pendentes.' : 'No reviews pending.'}</em>
                        </>
                      )}
                    </button>
                    <button type="button" className="home-kpi" onClick={() => go('#/requirements')}>
                      <small>{pt ? 'Requisitos' : 'Requirements'}</small>
                      <strong>
                        {requirements.total}
                        <span>{pt ? (requirements.total === 1 ? 'ativo' : 'ativos') : 'active'}</span>
                      </strong>
                      <span className="home-kpi-bar is-split" aria-hidden="true">
                        <i
                          className="is-approved"
                          style={{ width: `${percent(requirements.approved, requirements.total)}%` }}
                        />
                        <i
                          className="is-review"
                          style={{ width: `${percent(requirements.inReview, requirements.total)}%` }}
                        />
                      </span>
                      <em>
                        {[
                          pt ? `${requirements.approved} aprovados` : `${requirements.approved} approved`,
                          requirements.inReview
                            ? pt
                              ? `${requirements.inReview} em revisão`
                              : `${requirements.inReview} in review`
                            : '',
                          requirements.withFindings
                            ? pt
                              ? `${requirements.withFindings} com apontamentos`
                              : `${requirements.withFindings} with findings`
                            : '',
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </em>
                    </button>
                    <button
                      type="button"
                      className="home-kpi"
                      onClick={() => go('#/schedule', next ? { review: next.id } : {})}
                    >
                      <small>{pt ? 'Documentos de revisão' : 'Review documents'}</small>
                      <strong>
                        {documents.prepared}
                        <span>
                          / {documents.planned} {pt ? 'preparados' : 'prepared'}
                        </span>
                      </strong>
                      <span className="home-kpi-bar">
                        <i style={{ width: `${percent(documents.prepared, documents.planned)}%` }} />
                      </span>
                      <em>
                        {pt
                          ? `${documents.approved} aprovados · ${reviewsLeft} ${reviewsLeft === 1 ? 'revisão pela frente' : 'revisões pela frente'}`
                          : `${documents.approved} approved · ${reviewsLeft} ${reviewsLeft === 1 ? 'review ahead' : 'reviews ahead'}`}
                      </em>
                    </button>
                  </div>
                </>
              )}
            </section>
          ) : (
            <section className="home-focus is-start" aria-labelledby="home-focus-title">
              <div>
                <h2 id="home-focus-title">
                  {projects.length
                    ? pt
                      ? 'Escolha um projeto para ver o andamento'
                      : 'Choose a project to see its progress'
                    : c.empty}
                </h2>
                <p>
                  {projects.length
                    ? pt
                      ? 'Fase atual, próxima revisão, requisitos e pendências aparecem aqui.'
                      : 'The current phase, next review, requirements and open issues appear here.'
                    : c.emptyHint}
                </p>
              </div>
              <div className="home-start-actions">
                {projects.length > 0 && (
                  <button type="button" onClick={() => setProjectPickerOpen(true)}>
                    <FolderOpen size={15} aria-hidden="true" />
                    {c.open}
                  </button>
                )}
                <button type="button" className="primary" onClick={onCreateProject}>
                  <Plus size={15} aria-hidden="true" />
                  {c.create}
                </button>
              </div>
            </section>
          )}

          <div className="home-grid">
            <div className="home-col">
              {project && delivery && (
                <section className="home-section" aria-labelledby="home-attention-title">
                  <header>
                    <h2 id="home-attention-title">{pt ? 'Precisa de atenção' : 'Needs attention'}</h2>
                    {overview.attention.length > 0 && <span>{overview.attention.length}</span>}
                  </header>
                  {overview.attention.length ? (
                    <ul className="home-rows">
                      {(allAttention ? overview.attention : overview.attention.slice(0, 6)).map(item => (
                        <li key={item.id}>
                          <button
                            type="button"
                            className={`home-row tone-${item.tone}`}
                            onClick={() => openLink(item.href)}
                          >
                            <i className="home-row-mark" aria-hidden="true" />
                            <b>{item.code || '—'}</b>
                            <span>
                              <strong>{item.title}</strong>
                              <small>{item.detail}</small>
                            </span>
                            <ChevronRight size={15} aria-hidden="true" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="home-empty">
                      {pt
                        ? 'Nada atrasado, bloqueado ou com apontamento aberto.'
                        : 'Nothing late, blocked or with open findings.'}
                    </p>
                  )}
                  {overview.attention.length > 6 && (
                    <button
                      type="button"
                      className="home-more"
                      aria-expanded={allAttention}
                      onClick={() => setAllAttention(value => !value)}
                    >
                      {allAttention
                        ? pt
                          ? 'Mostrar menos'
                          : 'Show less'
                        : pt
                          ? `Mostrar mais ${overview.attention.length - 6}`
                          : `Show ${overview.attention.length - 6} more`}
                    </button>
                  )}
                </section>
              )}
              <section className="home-section" aria-labelledby="home-continue-title">
                <header>
                  <h2 id="home-continue-title">{pt ? 'Continuar de onde parou' : 'Pick up where you left off'}</h2>
                </header>
                {recent.length ? (
                  <RecentList items={recent} language={language} />
                ) : (
                  <p className="home-empty">
                    {pt
                      ? 'Reuniões, atas, requisitos e documentos abertos nesta sessão aparecem aqui.'
                      : 'Meetings, minutes, requirements and documents opened in this session appear here.'}
                  </p>
                )}
              </section>
            </div>
            <div className="home-col">
              {project && delivery && (
                <section className="home-section" aria-labelledby="home-reviews-title">
                  <header>
                    <h2 id="home-reviews-title">{pt ? 'Próximas revisões' : 'Upcoming reviews'}</h2>
                    <button type="button" onClick={() => go('#/schedule')}>
                      {pt ? 'Cronograma' : 'Schedule'}
                      <ArrowRight size={13} aria-hidden="true" />
                    </button>
                  </header>
                  {overview.upcoming.length ? (
                    <ul className="home-rows">
                      {overview.upcoming.map(entry => (
                        <li key={entry.id}>
                          <button
                            type="button"
                            className={`home-row home-review state-${entry.state}`}
                            onClick={() => openLink(reviewLink(project.id, entry.id))}
                          >
                            <i className="home-diamond" aria-hidden="true" />
                            <b>{entry.code}</b>
                            <span>
                              <strong>{entry.label}</strong>
                              <small>
                                {[dayMonth(entry.dueDate), countdown(entry.dueDate, today, pt)]
                                  .filter(Boolean)
                                  .join(' · ')}
                              </small>
                            </span>
                            <span
                              className="home-review-docs"
                              title={pt ? 'Documentos preparados' : 'Documents prepared'}
                            >
                              <span
                                className="home-meter"
                                style={{ '--value': `${percent(entry.prepared, entry.planned)}%` } as CSSProperties}
                              >
                                <i />
                              </span>
                              <small>{entry.planned ? `${entry.prepared}/${entry.planned}` : '—'}</small>
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="home-empty">
                      {pt ? 'Nenhuma revisão pendente no cronograma.' : 'No pending reviews in the schedule.'}
                    </p>
                  )}
                </section>
              )}
              {project && (
                <section className="home-section" aria-labelledby="home-meetings-title">
                  <header>
                    <h2 id="home-meetings-title">{pt ? 'Reuniões do projeto' : 'Project meetings'}</h2>
                    <button
                      type="button"
                      onClick={() => {
                        window.location.hash = '#/meetings';
                      }}
                    >
                      {pt ? 'Todas' : 'All'}
                      <ArrowRight size={13} aria-hidden="true" />
                    </button>
                  </header>
                  {overview.meetings.length ? (
                    <ul className="home-rows">
                      {overview.meetings.map(meeting => {
                        const live = meeting.status === 'running';
                        return (
                          <li key={meeting.id}>
                            <button
                              type="button"
                              className="home-row home-meeting"
                              onClick={() => openLink(meetingLink(meeting.id, meeting.status === 'done'))}
                            >
                              <time dateTime={meeting.updatedAt || meeting.createdAt}>
                                {shortDate(meeting.updatedAt || meeting.createdAt || '', language)}
                              </time>
                              <span>
                                <strong>{meeting.title}</strong>
                                <small>
                                  {[
                                    live
                                      ? pt
                                        ? 'Ao vivo'
                                        : 'Live'
                                      : meeting.status === 'done'
                                        ? pt
                                          ? 'Ata disponível'
                                          : 'Minutes available'
                                        : pt
                                          ? 'Sem ata'
                                          : 'No minutes',
                                    meeting.scope === 'private'
                                      ? pt
                                        ? 'Por convite'
                                        : 'Invitation only'
                                      : meeting.sectorName || meeting.teamName || '',
                                  ]
                                    .filter(Boolean)
                                    .join(' · ')}
                                </small>
                              </span>
                              {live ? (
                                <i className="home-live" aria-hidden="true" />
                              ) : (
                                <ChevronRight size={15} aria-hidden="true" />
                              )}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="home-empty">
                      {meetings
                        ? pt
                          ? 'Nenhuma reunião neste projeto ainda.'
                          : 'No meetings in this project yet.'
                        : pt
                          ? 'Carregando reuniões…'
                          : 'Loading meetings…'}
                    </p>
                  )}
                </section>
              )}
              <section className="home-section" aria-labelledby="home-projects-title">
                <header>
                  <h2 id="home-projects-title">{pt ? 'Projetos' : 'Projects'}</h2>
                  {projects.length > 0 && (
                    <button type="button" onClick={() => setProjectPickerOpen(true)}>
                      {pt ? 'Gerenciar' : 'Manage'}
                      <ArrowRight size={13} aria-hidden="true" />
                    </button>
                  )}
                </header>
                {loadingProjects && !projects.length ? (
                  <p className="home-empty">
                    <LoaderCircle className="home-spin" size={15} aria-hidden="true" />
                    {c.loading}
                  </p>
                ) : !projects.length ? (
                  <p className="home-empty">{c.emptyHint}</p>
                ) : (
                  <ul className="home-rows">
                    {ordered.slice(0, 5).map(item => (
                      <li key={item.id}>
                        <button
                          type="button"
                          className={`home-row home-project${item.id === activeProjectId ? ' is-active' : ''}`}
                          aria-current={item.id === activeProjectId ? 'true' : undefined}
                          onClick={() => onOpenProject?.(item.id)}
                        >
                          <span className="home-project-mark" aria-hidden="true">
                            {projectMonogram(item.name || c.untitled)}
                          </span>
                          <span>
                            <strong>{item.name || c.untitled}</strong>
                            <small>
                              {teamName(item)} · {c.updated} {date(item.updatedAt)}
                            </small>
                          </span>
                          <ChevronRight size={15} aria-hidden="true" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          </div>
        </section>
      </main>

      {projectPickerOpen && (
        <div
          className="home-project-dialog-backdrop"
          role="presentation"
          onPointerDown={() => setProjectPickerOpen(false)}
        >
          <section
            className="home-project-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="home-project-dialog-title"
            onPointerDown={event => event.stopPropagation()}
          >
            <header>
              <div>
                <span>{c.open}</span>
                <h2 id="home-project-dialog-title">{c.chooseProject}</h2>
              </div>
              <button
                className="home-dialog-close"
                type="button"
                onClick={() => setProjectPickerOpen(false)}
                aria-label={c.close}
              >
                <X aria-hidden="true" />
              </button>
            </header>
            <div className="home-project-picker-list">
              {loadingProjects ? (
                <div className="home-project-dialog-empty">
                  <LoaderCircle className="home-spin" aria-hidden="true" />
                  {c.loading}
                </div>
              ) : projects.length === 0 ? (
                <div className="home-project-dialog-empty">
                  <FolderOpen aria-hidden="true" />
                  <strong>{c.empty}</strong>
                  <span>{c.emptyHint}</span>
                  <button type="button" onClick={onCreateProject}>
                    <Plus aria-hidden="true" />
                    {c.create}
                  </button>
                </div>
              ) : (
                ordered.map(item => (
                  <article className="home-project-picker-row" key={item.id}>
                    <button
                      className="home-project-open"
                      type="button"
                      onClick={() => {
                        setProjectPickerOpen(false);
                        onOpenProject?.(item.id);
                      }}
                    >
                      <span className="home-project-symbol">
                        <FolderOpen aria-hidden="true" />
                      </span>
                      <span className="home-project-copy">
                        <strong>{item.name || c.untitled}</strong>
                        <small>{teamName(item)}</small>
                      </span>
                      <span className="home-project-meta">
                        <small>
                          {item.memberCount} {item.memberCount === 1 ? c.member : c.members}
                        </small>
                        <small>
                          {c.updated} {date(item.updatedAt)}
                        </small>
                      </span>
                      <ArrowRight aria-hidden="true" />
                    </button>
                    <button
                      className="home-project-delete"
                      type="button"
                      disabled={deletingId === item.id}
                      onClick={() => void deleteProject(item.id)}
                      title={c.delete}
                      aria-label={`${c.delete}: ${item.name || c.untitled}`}
                    >
                      {deletingId === item.id ? (
                        <LoaderCircle className="home-spin" aria-hidden="true" />
                      ) : (
                        <Trash2 aria-hidden="true" />
                      )}
                    </button>
                  </article>
                ))
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
