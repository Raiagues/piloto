import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import {
  Check,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ChevronsUpDown,
  ExternalLink,
  FolderKanban,
  Folder,
  FolderOpen,
  Home,
  MessageSquare,
  Plus,
  Search,
  UsersRound,
} from 'lucide-react';
import { Brand } from './Brand';
import { PROJECT_RAIL, railLabel } from '../lib/projectRail';
import { meetingFolders, requirementGroups, reviewEntries, shortDate } from '../lib/sidebarTree';
import type { MeetingEntry, ReviewEntry } from '../lib/sidebarTree';
import { useDeliverySnapshot, useMeetingsSnapshot } from '../lib/workspaceIndex';
import type { DeliveryState } from '../lib/projectDelivery';
import type { MeetingSummary } from '../lib/meetings';
import { meetingLink, reviewLink } from '../lib/workspaceLinks';
import type { ProjectArea } from '../lib/workspaceRoutes';
import type { RequirementsOutline } from '../lib/requirementsOutline';
import type { ProjectSummary } from '../lib/team';
import type { Language } from '../lib/types';

type Props = {
  language: Language;
  expanded: boolean;
  route: string;
  projects: ProjectSummary[];
  teams: { id: string; name: string }[];
  activeProjectId: string;
  activeProjectName: string;
  activeTeam: { id: string; name: string } | null;
  loadingProjects?: boolean;
  projectLoadFailed?: boolean;
  outline?: RequirementsOutline | null;
  subsystem?: string;
  onToggle: () => void;
  onNavigate: (hash: string) => void;
  onOpen: (href: string) => void;
  onSearch: () => void;
  onProjectSelect: (projectId: string) => void;
  onAreaSelect: (area: ProjectArea) => void;
  onSubsystemSelect: (id: string) => void;
  /** Read-only snapshots for the trees; the pages own loading and writes. */
  delivery?: DeliveryState | null;
  meetings?: readonly MeetingSummary[] | null;
};

/** Two letters for the project tile: an acronym in the name wins, otherwise the first two words. */
export function projectMonogram(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const acronym = words.find(word => /^[A-Z0-9]{2,6}$/.test(word));
  if (acronym) return acronym.slice(0, 2);
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] || '?').slice(0, 2)).toUpperCase();
}

const subscribeLocation = (listener: () => void) => {
  window.addEventListener('popstate', listener);
  window.addEventListener('hashchange', listener);
  return () => {
    window.removeEventListener('popstate', listener);
    window.removeEventListener('hashchange', listener);
  };
};
const useLocationSearch = () =>
  useSyncExternalStore(
    subscribeLocation,
    () => window.location.search,
    () => '',
  );

const TREE_KEY = 'norte-sidebar-tree-v1';
/** Which branches are open survives reloads; the address decides what is selected. */
function useTreeState() {
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(TREE_KEY) || '{}');
      return saved && typeof saved === 'object' ? saved : {};
    } catch {
      return {};
    }
  });
  const set = (key: string, value: (current: boolean) => boolean, fallback: boolean) =>
    setOpen(current => {
      const next = { ...current, [key]: value(current[key] ?? fallback) };
      try {
        window.localStorage.setItem(TREE_KEY, JSON.stringify(next));
      } catch {
        /* Preference only. */
      }
      return next;
    });
  return {
    isOpen: (key: string, fallback: boolean) => open[key] ?? fallback,
    toggle: (key: string, fallback: boolean) => set(key, value => !value, fallback),
    expand: (key: string) => set(key, () => true, true),
  };
}

/** Global places first, then one project context: a tile, its name and team; the menu lists the other projects. */
function ProjectSwitcher({
  language,
  expanded,
  projects,
  teams,
  activeProjectId,
  activeProjectName,
  activeTeam,
  loadingProjects,
  projectLoadFailed,
  onExpand,
  onNavigate,
  onProjectSelect,
}: Pick<
  Props,
  | 'language'
  | 'expanded'
  | 'projects'
  | 'teams'
  | 'activeProjectId'
  | 'activeProjectName'
  | 'activeTeam'
  | 'loadingProjects'
  | 'projectLoadFailed'
  | 'onNavigate'
  | 'onProjectSelect'
> & { onExpand: () => void }) {
  const pt = language === 'pt',
    [open, setOpen] = useState(false),
    root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !root.current?.contains(event.target as Node))
        setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);
  const groups = [
    ...teams
      .filter(team => projects.some(project => project.teamId === team.id))
      .map(team => ({
        id: team.id,
        name: team.name,
        projects: projects.filter(project => project.teamId === team.id),
      })),
    ...(projects.some(project => !project.teamId || !teams.some(team => team.id === project.teamId))
      ? [
          {
            id: '',
            name: pt ? 'Outros projetos' : 'Other projects',
            projects: projects.filter(project => !project.teamId || !teams.some(team => team.id === project.teamId)),
          },
        ]
      : []),
  ];
  const empty = loadingProjects
    ? pt
      ? 'Carregando projetos…'
      : 'Loading projects…'
    : projectLoadFailed
      ? pt
        ? 'Projetos indisponíveis'
        : 'Projects unavailable'
      : pt
        ? 'Nenhum projeto ainda'
        : 'No projects yet';
  const label = pt ? 'Trocar projeto' : 'Switch project';
  const name = activeProjectName || (projects.length ? (pt ? 'Escolha um projeto' : 'Choose a project') : empty);
  return (
    <div className="project-switcher" ref={root}>
      {expanded ? (
        <button
          type="button"
          className={`project-switcher-trigger${activeProjectName ? '' : ' is-empty'}`}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={`${label}: ${activeProjectName || empty}`}
          onClick={() => setOpen(value => !value)}
        >
          <span className="project-monogram" aria-hidden="true">
            {activeProjectName ? projectMonogram(activeProjectName) : <FolderKanban size={15} />}
          </span>
          <span className="project-switcher-copy">
            <strong>{name}</strong>
            <small>{activeTeam?.name || (pt ? 'Projeto' : 'Project')}</small>
          </span>
          <ChevronsUpDown size={14} aria-hidden="true" />
        </button>
      ) : (
        <button
          type="button"
          className="mission-nav-item mission-project-tile"
          title={activeProjectName || label}
          aria-label={label}
          onClick={() => {
            onExpand();
            setOpen(true);
          }}
        >
          <span className="project-monogram" aria-hidden="true">
            {activeProjectName ? projectMonogram(activeProjectName) : <FolderKanban size={15} />}
          </span>
        </button>
      )}
      {open && expanded && (
        <div className="project-switcher-menu" role="listbox" aria-label={label}>
          {groups.length ? (
            groups.map(group => (
              <section key={group.id || 'other'}>
                <header>
                  <span>{group.name}</span>
                  {group.id && (
                    <a
                      href={`#/teams?team=${encodeURIComponent(group.id)}`}
                      onClick={event => {
                        event.preventDefault();
                        setOpen(false);
                        onNavigate(`#/teams?team=${encodeURIComponent(group.id)}`);
                      }}
                      title={pt ? 'Abrir página da equipe' : 'Open team page'}
                    >
                      <ExternalLink size={12} aria-hidden="true" />
                      {pt ? 'Equipe' : 'Team'}
                    </a>
                  )}
                </header>
                {group.projects.map(project => (
                  <button
                    type="button"
                    role="option"
                    aria-selected={project.id === activeProjectId}
                    key={project.id}
                    onClick={() => {
                      setOpen(false);
                      if (project.id !== activeProjectId) onProjectSelect(project.id);
                      else onNavigate('#/project');
                    }}
                  >
                    <span className="project-monogram small" aria-hidden="true">
                      {projectMonogram(project.name || '?')}
                    </span>
                    <span>{project.name || (pt ? 'Projeto sem nome' : 'Untitled project')}</span>
                    {project.id === activeProjectId && <Check size={14} aria-hidden="true" />}
                  </button>
                ))}
              </section>
            ))
          ) : (
            <p>{empty}</p>
          )}
          <footer>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onNavigate('#/new-project');
              }}
            >
              <Plus size={14} aria-hidden="true" />
              {pt ? 'Novo projeto' : 'New project'}
            </button>
          </footer>
        </div>
      )}
    </div>
  );
}

function Twisty({ open, label, onToggle }: { open: boolean; label: string; onToggle: () => void }) {
  return (
    <button type="button" className="tree-twisty" aria-expanded={open} aria-label={label} onClick={onToggle}>
      <ChevronRight size={13} aria-hidden="true" />
    </button>
  );
}

const documentState = (status: string) =>
  ['approved', 'in_review', 'changes_requested'].includes(status) ? status : 'draft';

function ReviewBranch({
  review,
  pt,
  active,
  activeDocument,
  open,
  onToggle,
  onOpen,
}: {
  review: ReviewEntry;
  pt: boolean;
  active: boolean;
  activeDocument: string;
  open: boolean;
  onToggle: () => void;
  onOpen: (documentId?: string) => void;
}) {
  const ready = review.planned ? review.prepared / review.planned : 0,
    done = review.planned ? review.approved / review.planned : 0;
  const summary = review.planned
    ? pt
      ? `${review.prepared} de ${review.planned} documentos preparados · ${review.approved} aprovados`
      : `${review.prepared} of ${review.planned} documents prepared · ${review.approved} approved`
    : pt
      ? 'Sem documentos previstos'
      : 'No documents planned';
  const date = review.dueDate
    ? new Date(`${review.dueDate}T12:00:00`).toLocaleDateString(pt ? 'pt-BR' : 'en', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      })
    : pt
      ? 'sem data'
      : 'undated';
  return (
    <div className={`tree-branch${open ? ' is-open' : ''}`}>
      <div className={`tree-row review-row state-${review.state}${active ? ' is-active' : ''}`}>
        {review.documents.length ? (
          <Twisty open={open} label={`${pt ? 'Documentos de' : 'Documents for'} ${review.code}`} onToggle={onToggle} />
        ) : (
          <span className="tree-twisty-space" aria-hidden="true" />
        )}
        <button
          type="button"
          className="tree-link"
          aria-current={active && !activeDocument ? 'page' : undefined}
          title={`${review.title}\n${date} · ${summary}`}
          onClick={() => onOpen()}
        >
          <i className="tree-diamond" aria-hidden="true" />
          <b>{review.code}</b>
          <span>{review.label}</span>
          {review.planned > 0 && (
            <small className="tree-progress" aria-label={summary}>
              <i
                style={
                  { '--ready': `${Math.round(ready * 100)}%`, '--done': `${Math.round(done * 100)}%` } as CSSProperties
                }
              />
              {review.prepared}/{review.planned}
            </small>
          )}
        </button>
      </div>
      {open && review.documents.length > 0 && (
        <div
          className="tree-children"
          role="group"
          aria-label={`${pt ? 'Documentos de' : 'Documents for'} ${review.code}`}
        >
          {review.documents.map(document => (
            <button
              type="button"
              key={document.id}
              className={`tree-leaf document-leaf${activeDocument === document.id ? ' is-active' : ''}`}
              aria-current={activeDocument === document.id ? 'page' : undefined}
              title={`${document.title} · v${document.version}`}
              onClick={() => onOpen(document.id)}
            >
              <i className={`tree-status ${documentState(document.status)}`} aria-hidden="true" />
              <b>{document.code}</b>
              <span>{document.title}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function MeetingLeaf({
  meeting,
  language,
  active,
  onOpen,
}: {
  meeting: MeetingEntry;
  language: Language;
  active: boolean;
  onOpen: () => void;
}) {
  const pt = language === 'pt',
    live = meeting.status === 'running';
  const state = live
    ? pt
      ? 'Ao vivo'
      : 'Live'
    : meeting.status === 'done'
      ? pt
        ? 'Ata disponível'
        : 'Minutes available'
      : meeting.status === 'interrupted'
        ? pt
          ? 'Interrompida'
          : 'Interrupted'
        : pt
          ? 'Não iniciada'
          : 'Not started';
  return (
    <button
      type="button"
      className={`tree-leaf meeting-leaf${active ? ' is-active' : ''}`}
      aria-current={active ? 'page' : undefined}
      title={`${meeting.title}\n${state}`}
      onClick={onOpen}
    >
      <time dateTime={meeting.date}>{shortDate(meeting.date, language)}</time>
      <span>{meeting.title}</span>
      {meeting.status !== 'done' && <i className={`tree-meeting-state ${live ? 'live' : 'idle'}`} aria-label={state} />}
    </button>
  );
}

export function MissionSidebar(props: Props) {
  const {
    language,
    expanded,
    route,
    activeProjectId,
    activeTeam,
    outline,
    subsystem = '',
    onToggle,
    onNavigate,
    onOpen,
    onSearch,
    onAreaSelect,
    onSubsystemSelect,
    delivery = null,
    meetings = null,
  } = props;
  const pt = language === 'pt';
  const params = new URLSearchParams(useLocationSearch());
  const tree = useTreeState();
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const global = [
    { key: 'home', hash: '#/', label: pt ? 'Início' : 'Home', Icon: Home },
    {
      key: 'teams',
      hash: activeTeam ? `#/teams?team=${encodeURIComponent(activeTeam.id)}` : '#/teams',
      label: pt ? 'Equipes' : 'Teams',
      Icon: UsersRound,
    },
  ];
  const liveOutline = outline?.projectId === activeProjectId ? outline : null;
  const groups = liveOutline?.groups || (delivery ? requirementGroups(delivery, language) : []);
  const requirementTotal =
    liveOutline?.total ?? (delivery ? delivery.requirements.filter(requirement => !requirement.archived).length : null);
  const reviews = delivery ? reviewEntries(delivery) : null;
  const folders =
    meetings && activeProjectId ? meetingFolders(meetings, activeProjectId, delivery?.sectors || [], language) : [];
  const projectMeetings = folders.reduce((total, folder) => total + folder.meetings.length, 0);
  const activeReview = route === 'schedule' ? params.get('review') || '' : '',
    activeDocument = ['schedule', 'project'].includes(route) ? params.get('document') || '' : '';
  const activeMeeting = route === 'meetings' ? params.get('meeting') || '' : '';

  const openReview = (review: ReviewEntry, documentId = '') => {
    if (documentId && !tree.isOpen(`review:${review.id}`, false)) tree.toggle(`review:${review.id}`, false);
    onOpen(reviewLink(activeProjectId, review.id, documentId));
  };
  const branchOpen = (key: string, fallback: boolean) => expanded && tree.isOpen(key, fallback);
  const navItem = (
    label: string,
    Icon: typeof Home,
    options: {
      current: boolean;
      locked?: boolean;
      phase?: boolean;
      onClick: () => void;
      count?: ReactNode;
      branch?: { key: string; fallback: boolean };
    },
  ) => {
    const open = options.branch ? branchOpen(options.branch.key, options.branch.fallback) : false;
    return (
      <div className={`mission-nav-row${options.branch ? ' has-branch' : ''}`}>
        <button
          type="button"
          className={`mission-nav-item${options.phase ? ' mission-phase' : ''}${options.current ? ' active current' : ''}${options.locked ? ' locked' : ''}`}
          aria-current={options.current ? 'page' : undefined}
          disabled={options.locked}
          title={
            !expanded
              ? label
              : options.locked
                ? pt
                  ? 'Escolha um projeto primeiro'
                  : 'Choose a project first'
                : undefined
          }
          onClick={options.onClick}
        >
          <span className="mission-nav-icon">
            <Icon aria-hidden="true" />
          </span>
          <span className="mission-nav-label">{label}</span>
          {expanded && options.count !== undefined && options.count !== null && (
            <small className="mission-nav-count">{options.count}</small>
          )}
        </button>
        {expanded && options.branch && !options.locked && (
          <Twisty
            open={open}
            label={`${open ? (pt ? 'Recolher' : 'Collapse') : pt ? 'Expandir' : 'Expand'} ${label}`}
            onToggle={() => tree.toggle(options.branch!.key, options.branch!.fallback)}
          />
        )}
      </div>
    );
  };

  return (
    <>
      <aside
        className={expanded ? 'mission-sidebar expanded' : 'mission-sidebar collapsed'}
        aria-label={pt ? 'Navegação principal' : 'Main navigation'}
      >
        <div className="mission-sidebar-header">
          <Brand language={language} />
          <button
            className="mission-sidebar-toggle"
            type="button"
            onClick={onToggle}
            aria-label={
              expanded
                ? pt
                  ? 'Recolher barra lateral'
                  : 'Collapse sidebar'
                : pt
                  ? 'Expandir barra lateral'
                  : 'Expand sidebar'
            }
            aria-expanded={expanded}
          >
            {expanded ? <ChevronsLeft size={17} aria-hidden="true" /> : <ChevronsRight size={17} aria-hidden="true" />}
          </button>
        </div>
        <div className="mission-search-slot">
          <button
            type="button"
            className="mission-search"
            onClick={onSearch}
            aria-keyshortcuts={mac ? 'Meta+K' : 'Control+K'}
            aria-label={
              pt
                ? 'Buscar revisões, requisitos, documentos e reuniões'
                : 'Search reviews, requirements, documents and meetings'
            }
            title={!expanded ? (pt ? 'Buscar' : 'Search') : undefined}
          >
            <Search size={15} aria-hidden="true" />
            <span>{pt ? 'Buscar no Norte' : 'Search Norte'}</span>
            <kbd>{mac ? '⌘K' : 'Ctrl K'}</kbd>
          </button>
        </div>
        <nav className="mission-sidebar-scroll" aria-label={pt ? 'Áreas' : 'Areas'}>
          <div className="mission-nav-group">
            {global.map(item => (
              <div className="mission-nav-row" key={item.key}>
                <button
                  type="button"
                  className={route === item.key ? 'mission-nav-item active' : 'mission-nav-item'}
                  aria-current={route === item.key ? 'page' : undefined}
                  title={!expanded ? item.label : undefined}
                  onClick={() => onNavigate(item.hash)}
                >
                  <span className="mission-nav-icon">
                    <item.Icon aria-hidden="true" />
                  </span>
                  <span className="mission-nav-label">{item.label}</span>
                </button>
              </div>
            ))}
          </div>
          <div className="mission-nav-group mission-project-group">
            {expanded && <span className="mission-nav-heading">{pt ? 'Projeto' : 'Project'}</span>}
            <ProjectSwitcher {...props} onExpand={onToggle} />
            {PROJECT_RAIL.map(item => {
              const label = railLabel(item, language),
                locked = !activeProjectId,
                current = !locked && route === item.area;
              if (item.area === 'project')
                return (
                  <div key={item.key}>
                    {navItem(label, item.Icon, {
                      current,
                      locked,
                      phase: true,
                      onClick: () => onAreaSelect('project'),
                    })}
                  </div>
                );
              if (item.area === 'requirements') {
                // Opening the area unfolds its subsystems; the arrow folds them again, also while the area is open.
                const open = expanded && !locked && groups.length > 0 && branchOpen('requirements', current);
                return (
                  <div key={item.key} className="mission-nav-branch">
                    {navItem(label, item.Icon, {
                      current,
                      locked,
                      phase: true,
                      count: requirementTotal ?? undefined,
                      onClick: () => {
                        tree.expand('requirements');
                        if (current) onSubsystemSelect('');
                        else onAreaSelect('requirements');
                      },
                      branch: groups.length ? { key: 'requirements', fallback: current } : undefined,
                    })}
                    {open && (
                      <div
                        className="mission-outline tree-children"
                        role="group"
                        aria-label={pt ? 'Requisitos por subsistema' : 'Requirements by subsystem'}
                      >
                        <button
                          type="button"
                          className={`tree-leaf${current && !subsystem ? ' is-active' : ''}`}
                          aria-current={current && !subsystem ? 'true' : undefined}
                          onClick={() => onSubsystemSelect('')}
                        >
                          <i className="tree-dot" aria-hidden="true" />
                          <span>{pt ? 'Todos os requisitos' : 'All requirements'}</span>
                          <small>{requirementTotal}</small>
                        </button>
                        {groups.map(group => (
                          <button
                            type="button"
                            key={group.id}
                            className={`tree-leaf${current && subsystem === group.id ? ' is-active' : ''}`}
                            aria-current={current && subsystem === group.id ? 'true' : undefined}
                            onClick={() => onSubsystemSelect(group.id)}
                          >
                            <i className="tree-dot" aria-hidden="true" />
                            <span>{group.name}</span>
                            <small>{group.count}</small>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              }
              const open = !locked && branchOpen('schedule', true);
              return (
                <div key={item.key} className="mission-nav-branch">
                  {navItem(label, item.Icon, {
                    current: current && !activeReview,
                    locked,
                    phase: true,
                    onClick: () => {
                      tree.expand('schedule');
                      onAreaSelect('schedule');
                    },
                    branch: { key: 'schedule', fallback: true },
                  })}
                  {open && reviews && (
                    <div
                      className="tree-children review-tree"
                      role="group"
                      aria-label={pt ? 'Revisões do cronograma' : 'Schedule reviews'}
                    >
                      {reviews.length ? (
                        reviews.map(review => (
                          <ReviewBranch
                            key={review.id}
                            review={review}
                            pt={pt}
                            active={activeReview === review.id}
                            activeDocument={activeReview === review.id || route === 'project' ? activeDocument : ''}
                            open={tree.isOpen(
                              `review:${review.id}`,
                              activeReview === review.id && Boolean(activeDocument),
                            )}
                            onToggle={() =>
                              tree.toggle(`review:${review.id}`, activeReview === review.id && Boolean(activeDocument))
                            }
                            onOpen={documentId => openReview(review, documentId)}
                          />
                        ))
                      ) : (
                        <p className="tree-empty">{pt ? 'Nenhuma revisão planejada' : 'No reviews planned'}</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            <div className="mission-nav-branch">
              {navItem(pt ? 'Reuniões' : 'Meetings', MessageSquare, {
                current: route === 'meetings' && !activeMeeting,
                onClick: () => {
                  if (activeProjectId) tree.expand('meetings');
                  onNavigate('#/meetings');
                },
                count: activeProjectId && meetings ? projectMeetings : undefined,
                branch: activeProjectId ? { key: 'meetings', fallback: true } : undefined,
              })}
              {activeProjectId && branchOpen('meetings', true) && meetings && (
                <div
                  className="tree-children meeting-tree"
                  role="group"
                  aria-label={pt ? 'Reuniões do projeto por setor' : 'Project meetings by sector'}
                >
                  {folders.map(folder => {
                    const contains = folder.meetings.some(meeting => meeting.id === activeMeeting),
                      key = `folder:${folder.key}`,
                      open = folder.meetings.length > 0 && tree.isOpen(key, contains);
                    return (
                      <div
                        className={`tree-branch${open ? ' is-open' : ''}${folder.meetings.length ? '' : ' is-empty'}`}
                        key={folder.key}
                      >
                        <button
                          type="button"
                          className="tree-row tree-folder"
                          aria-expanded={folder.meetings.length ? open : undefined}
                          disabled={!folder.meetings.length}
                          title={
                            folder.meetings.length
                              ? undefined
                              : pt
                                ? 'Ainda sem reuniões neste setor'
                                : 'No meetings in this sector yet'
                          }
                          onClick={() => tree.toggle(key, contains)}
                        >
                          <span className="tree-twisty-icon" aria-hidden="true">
                            {folder.meetings.length ? <ChevronRight size={13} /> : null}
                          </span>
                          {open ? <FolderOpen size={14} aria-hidden="true" /> : <Folder size={14} aria-hidden="true" />}
                          <span>{folder.label}</span>
                          <small>{folder.meetings.length}</small>
                        </button>
                        {open && (
                          <div className="tree-children" role="group" aria-label={folder.label}>
                            {folder.months.length
                              ? folder.months.map(month => (
                                  <div className="tree-month" key={month.key}>
                                    <span className="tree-month-label">{month.label}</span>
                                    {month.meetings.map(meeting => (
                                      <MeetingLeaf
                                        key={meeting.id}
                                        meeting={meeting}
                                        language={language}
                                        active={activeMeeting === meeting.id}
                                        onOpen={() => onOpen(meetingLink(meeting.id, meeting.status === 'done'))}
                                      />
                                    ))}
                                  </div>
                                ))
                              : folder.meetings.map(meeting => (
                                  <MeetingLeaf
                                    key={meeting.id}
                                    meeting={meeting}
                                    language={language}
                                    active={activeMeeting === meeting.id}
                                    onOpen={() => onOpen(meetingLink(meeting.id, meeting.status === 'done'))}
                                  />
                                ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {!folders.length && (
                    <p className="tree-empty">{pt ? 'Nenhuma reunião neste projeto' : 'No meetings in this project'}</p>
                  )}
                </div>
              )}
            </div>
          </div>
        </nav>
      </aside>
      <button
        className={expanded ? 'mission-sidebar-overlay visible' : 'mission-sidebar-overlay'}
        type="button"
        tabIndex={expanded ? 0 : -1}
        aria-label={pt ? 'Fechar navegação' : 'Close navigation'}
        onClick={onToggle}
      />
    </>
  );
}

/** The shell's sidebar: the same navigation fed by the shared project and meeting snapshots. */
export function ConnectedMissionSidebar(props: Omit<Props, 'delivery' | 'meetings'>) {
  const delivery = useDeliverySnapshot(props.activeProjectId),
    meetings = useMeetingsSnapshot();
  return <MissionSidebar {...props} delivery={delivery} meetings={meetings} />;
}
