import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, CalendarClock, Download, FileText, Layers, Paperclip, UsersRound, Video } from 'lucide-react';
import { API_ORIGIN, useAuth } from '../lib/auth';
import { artifactHref } from '../lib/artifacts';
import { claimBack } from '../lib/navigation';
import { rememberWorkspace } from '../lib/workspaceHistory';
import type { ConnectedArtifact } from '../lib/team';
import type { MeetingSummary } from '../lib/meetings';
import type { MissionProject } from '../lib/projectStore';
import type { Language } from '../lib/types';
import { ProjectAreaShell } from '../components/ProjectAreaShell';
import type { RailNavigation } from '../components/ProjectAreaShell';
import { useProjectDelivery, deliveryStatus, openDeliveryRecord } from '../lib/projectDelivery';
import type { DeliveryState } from '../lib/projectDelivery';
import { DeliveryAlert } from '../components/delivery/DeliveryShared';
import { DocumentWorkspace, documentLocation } from '../components/delivery/DocumentWorkspace';
import { PdfPreview } from '../components/delivery/PdfPreview';
import { ReviewDocumentWorkspace } from '../components/delivery/ReviewDocumentWorkspace';
import '../styles/document-library.css';
import '../styles/features/overview.css';

const meetingStatus = (status: string, pt: boolean) =>
  (
    ({
      draft: ['Não iniciada', 'Not started'],
      running: ['Em andamento', 'In progress'],
      done: ['Ata disponível', 'Minutes ready'],
      interrupted: ['Preservada', 'Preserved'],
    }) as Record<string, string[]>
  )[status]?.[pt ? 0 : 1] || status;
// Calendar dates (YYYY-MM-DD) are local days, not UTC midnight.
const shortDate = (value: string, language: Language) => {
  const at = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(value || '') ? `${value}T12:00:00` : value);
  return Number.isFinite(at)
    ? new Intl.DateTimeFormat(language === 'pt' ? 'pt-BR' : 'en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      }).format(at)
    : '—';
};

function SourcePreview({ artifact, pt }: { artifact: ConnectedArtifact; pt: boolean }) {
  const [text, setText] = useState(''),
    [error, setError] = useState('');
  const source =
    artifact.documentText !== undefined
      ? `${API_ORIGIN}/api/artifacts/${encodeURIComponent(artifact.id)}/pdf`
      : artifactHref(artifact);
  const pdf = artifact.documentText !== undefined || artifact.mimeType === 'application/pdf';
  useEffect(() => {
    if (!artifact.contentPath || !artifact.mimeType?.startsWith('text/')) return;
    let alive = true;
    void fetch(source, { credentials: 'include' })
      .then(response => {
        if (!response.ok) throw new Error(pt ? 'Documento indisponível.' : 'Document unavailable.');
        return response.text();
      })
      .then(value => {
        if (alive) setText(value);
      })
      .catch(reason => {
        if (alive) setError(reason.message);
      });
    return () => {
      alive = false;
    };
  }, [artifact.contentPath, artifact.mimeType, source, pt]);
  return (
    <section className="document-source-workspace">
      <header className="document-editor-heading">
        <Paperclip size={16} aria-hidden="true" />
        <h2>{artifact.label}</h2>
        <a
          className="overview-link-button"
          href={`${source}${artifact.contentPath ? '?download=1' : ''}`}
          target="_blank"
          rel="noreferrer"
        >
          <Download size={15} />
          {pt ? 'Abrir original' : 'Open original'}
        </a>
      </header>
      <div className="document-draft-content">
        <div className="document-source-preview">
          {pdf && (artifact.contentPath || artifact.documentText !== undefined) ? (
            <PdfPreview title={artifact.label} source={source} pt={pt} />
          ) : artifact.contentPath && artifact.mimeType?.startsWith('image/') ? (
            <img src={source} alt={artifact.label} />
          ) : text ? (
            <pre>{text}</pre>
          ) : (
            <div className="document-empty">
              <FileText size={32} />
              <p>{pt ? 'Consulte o arquivo no formato original.' : 'Open the file in its original format.'}</p>
            </div>
          )}
          {error && <p role="alert">{error}</p>}
        </div>
      </div>
    </section>
  );
}

function nextMilestones(data: DeliveryState) {
  const today = new Date().toISOString().slice(0, 10);
  return data.tasks
    .filter(task => !task.archived && task.status !== 'done' && task.dueDate)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .map(task => ({ ...task, late: task.dueDate < today }));
}

export function ProjectOverviewPage({
  language,
  project,
  teams,
  navigation,
}: {
  language: Language;
  project: MissionProject;
  teams: { id: string; name: string }[];
  navigation: RailNavigation;
}) {
  const pt = language === 'pt',
    { api } = useAuth(),
    { data, busy, error, refresh, mutate } = useProjectDelivery(project.id);
  const [artifacts, setArtifacts] = useState<ConnectedArtifact[]>([]),
    [meetings, setMeetings] = useState<MeetingSummary[]>([]);
  const [selected, setSelected] = useState(() => new URL(window.location.href).searchParams.get('document') || ''),
    [sourceId, setSourceId] = useState(() => new URL(window.location.href).searchParams.get('artifact') || ''),
    [packageOpen, setPackageOpen] = useState(() => new URL(window.location.href).searchParams.has('review'));
  const [localError, setLocalError] = useState('');
  const loadSources = useCallback(async () => {
    const [sources, rooms] = await Promise.all([
      api<{ artifacts: ConnectedArtifact[] }>('/artifacts'),
      api<{ meetings: MeetingSummary[] }>('/meetings'),
    ]);
    const ids = new Set([
      ...(project.context.projectArtifactIds || []),
      ...(project.context.teamArtifactIds || []),
      ...(project.context.programArtifactIds || []),
    ]);
    setArtifacts(
      sources.artifacts.filter(
        artifact => (artifact.scope === 'project' && artifact.ownerId === project.id) || ids.has(artifact.id),
      ),
    );
    setMeetings(rooms.meetings.filter(meeting => meeting.projectId === project.id && !meeting.example));
  }, [
    api,
    project.id,
    project.context.projectArtifactIds,
    project.context.teamArtifactIds,
    project.context.programArtifactIds,
  ]);
  useEffect(() => {
    void loadSources().catch(reason => setLocalError(reason.message));
  }, [loadSources]);
  const chosenSource = artifacts.find(artifact => artifact.id === sourceId),
    open = Boolean(selected || chosenSource || packageOpen);
  const selectDocument = (id: string) => {
    setSelected(id);
    setSourceId('');
    setPackageOpen(false);
    documentLocation(project.id, id);
  };
  const closeAll = useCallback(() => {
    setSelected('');
    setSourceId('');
    setPackageOpen(false);
    const url = new URL(window.location.href);
    for (const key of ['document', 'artifact', 'review', 'template']) url.searchParams.delete(key);
    window.history.replaceState(window.history.state, '', url);
  }, []);
  useEffect(() => {
    const restore = () => {
      const url = new URL(window.location.href);
      setSelected(url.searchParams.has('review') ? '' : url.searchParams.get('document') || '');
      setSourceId(url.searchParams.get('artifact') || '');
      setPackageOpen(url.searchParams.has('review'));
    };
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, []);
  // An open file is an inner level of this page: the header's back closes it first.
  useEffect(
    () =>
      open
        ? claimBack(() => {
            closeAll();
            return true;
          })
        : undefined,
    [open, closeAll],
  );
  useEffect(() => {
    if (chosenSource)
      rememberWorkspace(chosenSource.label, {
        kind: 'source',
        context: project.name,
        detail: pt ? 'Original' : 'Original',
      });
  }, [chosenSource, project.name, pt]);

  if (open)
    return (
      <ProjectAreaShell language={language} project={project} area="project" navigation={navigation}>
        <div className="document-library overview-document-open">
          <DeliveryAlert
            error={error || localError}
            refresh={() => {
              void refresh();
              void loadSources();
            }}
            pt={pt}
          />
          {chosenSource && <SourcePreview key={chosenSource.id} artifact={chosenSource} pt={pt} />}
          {selected && data && (
            <DocumentWorkspace
              projectId={project.id}
              context={project.name}
              data={data}
              activeId={selected}
              onSelect={selectDocument}
              onClose={closeAll}
              busy={busy}
              error={error}
              mutate={mutate}
              pt={pt}
            />
          )}
          {packageOpen && data && (
            <ReviewDocumentWorkspace
              projectId={project.id}
              data={data}
              busy={busy}
              error={error}
              mutate={mutate}
              pt={pt}
            />
          )}
        </div>
      </ProjectAreaShell>
    );

  const milestones = data ? nextMilestones(data) : [];
  const nextReview = milestones.find(task => task.kind === 'review') || milestones[0];
  const team = teams.find(item => item.id === project.context.teamId)?.name || project.context.teamName;
  const recentMeetings = [...meetings]
    .sort((a, b) => (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || ''))
    .slice(0, 6);
  const daysUntil = (date: string) =>
    Math.round((Date.parse(date) - Date.parse(new Date().toISOString().slice(0, 10))) / 86400000);
  const openMeeting = (id: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set('project', project.id);
    url.searchParams.set('meeting', id);
    for (const key of ['document', 'artifact', 'review', 'template']) url.searchParams.delete(key);
    url.hash = '/meetings';
    window.location.assign(url.toString());
  };

  // Deliberately short: who is in the project, what comes next and the latest meetings.
  return (
    <ProjectAreaShell language={language} project={project} area="project" navigation={navigation}>
      <div className="project-overview">
        <DeliveryAlert
          error={error || localError}
          refresh={() => {
            void refresh();
            void loadSources();
          }}
          pt={pt}
        />
        <dl className="overview-facts" aria-label={pt ? 'Resumo do projeto' : 'Project summary'}>
          <div>
            <dt>
              <UsersRound size={14} aria-hidden="true" />
              {pt ? 'Equipe' : 'Team'}
            </dt>
            <dd>
              {team ? <a href={`#/teams?team=${encodeURIComponent(project.context.teamId || '')}`}>{team}</a> : '—'}
            </dd>
          </div>
          <div>
            <dt>
              <Layers size={14} aria-hidden="true" />
              {pt ? 'Setores' : 'Sectors'}
            </dt>
            <dd>{project.context.sectors.length || '—'}</dd>
          </div>
          <div>
            <dt>
              <UsersRound size={14} aria-hidden="true" />
              {pt ? 'Pessoas' : 'People'}
            </dt>
            <dd>{data?.members.length ?? project.context.assignments.length}</dd>
          </div>
          <div>
            <dt>
              <CalendarClock size={14} aria-hidden="true" />
              {pt ? 'Atualizado' : 'Updated'}
            </dt>
            <dd>{shortDate(project.updatedAt, language)}</dd>
          </div>
          <div className={`overview-next${nextReview?.late ? ' late' : ''}`}>
            <dt>
              <CalendarClock size={14} aria-hidden="true" />
              {pt ? 'Próximo marco' : 'Next milestone'}
            </dt>
            <dd>
              {nextReview ? (
                <button type="button" onClick={() => openDeliveryRecord('schedule', nextReview.id)}>
                  <strong>{nextReview.reviewCode || nextReview.title}</strong>
                  <small>
                    {shortDate(nextReview.dueDate, language)} ·{' '}
                    {nextReview.late
                      ? pt
                        ? 'atrasado'
                        : 'overdue'
                      : `${daysUntil(nextReview.dueDate)} ${pt ? 'dias' : 'days'}`}
                  </small>
                </button>
              ) : (
                <span className="overview-muted">
                  {data ? (pt ? 'Cronograma não planejado' : 'Schedule not planned') : '…'}
                </span>
              )}
            </dd>
          </div>
        </dl>

        <div className="overview-grid">
          <section className="overview-panel">
            <header className="overview-panel-head">
              <h2>{pt ? 'Próximos marcos' : 'Upcoming milestones'}</h2>
              <button type="button" className="overview-more" onClick={() => navigation.onOpen('schedule')}>
                {pt ? 'Cronograma' : 'Schedule'}
                <ArrowRight size={14} />
              </button>
            </header>
            {milestones.length ? (
              <ol className="overview-list">
                {milestones.slice(0, 6).map(task => (
                  <li key={task.id}>
                    <button type="button" onClick={() => openDeliveryRecord('schedule', task.id)}>
                      <span className={`overview-date-chip${task.late ? ' late' : ''}`}>
                        <b>{new Date(task.dueDate + 'T12:00:00').getDate()}</b>
                        {new Intl.DateTimeFormat(pt ? 'pt-BR' : 'en-GB', { month: 'short' }).format(
                          new Date(task.dueDate + 'T12:00:00'),
                        )}
                      </span>
                      <span>
                        <strong>{task.title}</strong>
                        <small>
                          {task.late ? (pt ? 'Atrasado' : 'Overdue') : deliveryStatus(task.status, pt)}
                          {task.kind === 'review' ? ` · ${pt ? 'revisão' : 'review'}` : ''}
                        </small>
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="overview-note">
                {pt
                  ? 'Nenhuma atividade com data. O cronograma começa vazio até a equipe planejar as fases.'
                  : 'No dated activity. The schedule stays empty until the team plans its phases.'}
              </p>
            )}
          </section>
          <section className="overview-panel">
            <header className="overview-panel-head">
              <h2>{pt ? 'Reuniões do projeto' : 'Project meetings'}</h2>
              <a className="overview-more" href="#/meetings">
                {pt ? 'Todas' : 'All'}
                <ArrowRight size={14} />
              </a>
            </header>
            {recentMeetings.length ? (
              <ul className="overview-list">
                {recentMeetings.map(meeting => (
                  <li key={meeting.id}>
                    <button type="button" onClick={() => openMeeting(meeting.id)}>
                      <span className="overview-doc-icon meeting">
                        <Video size={15} aria-hidden="true" />
                      </span>
                      <span>
                        <strong>{meeting.title}</strong>
                        <small>
                          {meetingStatus(meeting.status, pt)}
                          {meeting.sectorName ? ` · ${meeting.sectorName}` : ''}
                        </small>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="overview-note">
                {pt ? 'Nenhuma reunião ligada a este projeto.' : 'No meetings linked to this project.'}
              </p>
            )}
          </section>
        </div>
      </div>
    </ProjectAreaShell>
  );
}
