import './styles/features/project.css';
import { lazy, Suspense, useEffect, useState } from 'react';
import { goBack, initializeNavigation } from './lib/navigation';
import { ProjectAccessPanel } from './components/ProjectAccessPanel';
import { RecentWork } from './components/RecentWork';
import { AppHeader } from './components/AppHeader';
import { MissionSidebar } from './components/MissionSidebar';
import { useAuth } from './lib/auth';
import { getStoredLanguage, setStoredLanguage } from './lib/i18n';
import { useProjectWorkspace } from './lib/useProjectWorkspace';
import { useMeetingNavigation } from './lib/useMeetingNavigation';
import { PROJECT_AREAS, workspaceRedirect, workspaceRoute } from './lib/workspaceRoutes';
import type { ProjectArea } from './lib/workspaceRoutes';
import type { Language } from './lib/types';
import './styles/features/teams.css';

const HomePage = lazy(() => import('./pages/HomePage').then(module => ({ default: module.HomePage })));
const MeetingsPage = lazy(() => import('./pages/MeetingsPage').then(module => ({ default: module.MeetingsPage })));
const ProjectSetupPage = lazy(() => import('./pages/ProjectSetupPage').then(module => ({ default: module.ProjectSetupPage })));
const PlatformAdminPage = lazy(() => import('./pages/PlatformAdminPage').then(module => ({ default: module.PlatformAdminPage })));
const MeetingObservabilityPage = lazy(() => import('./pages/MeetingObservabilityPage').then(module => ({ default: module.MeetingObservabilityPage })));
const PeoplePage = lazy(() => import('./pages/PeoplePage').then(module => ({ default: module.PeoplePage })));
const MessagesPage = lazy(() => import('./pages/MessagesPage').then(module => ({ default: module.MessagesPage })));
const DocumentsPage = lazy(() => import('./pages/DocumentsPage').then(module => ({ default: module.DocumentsPage })));
const SchedulePage = lazy(() => import('./pages/SchedulePage').then(module => ({ default: module.SchedulePage })));
const RequirementsPage = lazy(() => import('./pages/RequirementsPage').then(module => ({ default: module.RequirementsPage })));
const VerificationPage = lazy(() => import('./pages/VerificationPage').then(module => ({ default: module.VerificationPage })));
const TeamsHubPage = lazy(() => import('./pages/TeamsHubPage').then(module => ({ default: module.TeamsHubPage })));
const InvitationInbox = lazy(() => import('./components/TeamInvitations').then(module => ({ default: module.InvitationInbox })));
const ChatWidget = lazy(() => import('./components/chat/ChatWidget').then(module => ({ default: module.ChatWidget })));

type PageContext = { teamId?: string; teamName?: string; projectId?: string; projectName?: string; sectorId?: string; sectorName?: string };

export function App() {
  const auth = useAuth();
  const admin = auth.user?.accessRole === 'owner_admin';
  const [language, setLanguage] = useState<Language>(getStoredLanguage);
  const [route, setRoute] = useState(() => workspaceRoute(window.location.hash));
  const [pageContext, setPageContext] = useState<PageContext | null>(null);
  const [sidebarExpanded, setSidebarExpanded] = useState(() => {
    const stored = window.localStorage.getItem('norte-sidebar-expanded');
    return stored === null ? window.innerWidth >= 1000 : stored === 'true';
  });
  const workspace = useProjectWorkspace(language);
  const { project, projects, teams, activeProjectId } = workspace;
  const meeting = useMeetingNavigation();
  const pt = language === 'pt';

  useEffect(() => initializeNavigation(), []);
  useEffect(() => {
    const receive = (event: Event) => setPageContext((event as CustomEvent).detail || null);
    window.addEventListener('norte:page-context', receive);
    return () => window.removeEventListener('norte:page-context', receive);
  }, []);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 900px)');
    const collapse = () => { if (media.matches) setSidebarExpanded(false); };
    collapse(); media.addEventListener('change', collapse);
    return () => media.removeEventListener('change', collapse);
  }, []);
  useEffect(() => {
    const onHashChange = () => {
      const nextRoute = workspaceRoute(window.location.hash);
      if (meeting.running.current && nextRoute !== 'meetings') {
        window.history.replaceState(null, '', '#/meetings');
        meeting.setError(pt ? 'Encerre ou interrompa a reunião antes de mudar de área.' : 'End or pause the meeting before navigating.');
        return;
      }
      const redirect = workspaceRedirect(window.location.hash);
      if (redirect) { window.location.replace(redirect); return; }
      if (!admin && ['admin', 'meetingObservability'].includes(nextRoute)) { window.location.replace('#/'); return; }
      const url = new URL(window.location.href);
      const scopedParams: Record<string, string[]> = { meetings: ['meeting', 'event', 'view'], documents: ['document', 'artifact'], schedule: ['review', 'document', 'delivery-record'], requirements: ['delivery-record'], verification: ['delivery-record'] };
      for (const key of ['meeting', 'event', 'view', 'document', 'artifact', 'review', 'delivery-record']) {
        if (!(scopedParams[nextRoute] || []).includes(key)) url.searchParams.delete(key);
      }
      window.history.replaceState(null, '', url);
      setRoute(nextRoute);
    };
    onHashChange(); window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [admin, meeting.running, meeting.setError, pt]);

  function changeLanguage(value: Language) {
    setLanguage(value); setStoredLanguage(value); document.documentElement.lang = value === 'pt' ? 'pt-BR' : 'en';
  }
  const openHome = () => { window.location.hash = '#/'; };
  const openTeams = () => { window.location.hash = '#/teams'; };
  const newProject = () => { window.location.hash = '#/new-project'; };
  const openArea = (area: ProjectArea) => { window.location.hash = PROJECT_AREAS[area]; };
  const navigation = { onOpen: openArea };
  const projectArea = route in PROJECT_AREAS;
  const loadingMessage = workspace.error === 'access'
    ? pt ? 'Este projeto não está disponível para seu acesso atual. Confira sua participação na equipe.' : 'This project is unavailable with your current access. Check your team membership.'
    : workspace.error ? pt ? 'Não foi possível carregar o projeto. Tente novamente.' : 'The project could not be loaded. Try again.' : '';

  let page = <HomePage language={language} projects={projects} loadingProjects={workspace.loading} onOpenProject={id => void workspace.openProject(id)} onDeleteProject={workspace.deleteProject} onOpenTeams={openTeams} onCreateProject={newProject} />;
  if (route === 'meetings') page = <MeetingsPage language={language} projects={projects} activeProjectId={activeProjectId} />;
  if (route === 'newProject') page = <ProjectSetupPage language={language} teams={teams} onCreate={workspace.createProject} onHome={openHome} onTeams={openTeams} />;
  if (admin && route === 'admin') page = <PlatformAdminPage language={language} />;
  if (admin && route === 'meetingObservability') page = <MeetingObservabilityPage language={language} />;
  if (route === 'people') page = <PeoplePage language={language} />;
  if (route === 'messages') page = <MessagesPage language={language} />;
  if (route === 'documents') page = <DocumentsPage language={language} project={project} navigation={navigation} />;
  if (route === 'schedule') page = <SchedulePage language={language} project={project} navigation={navigation} />;
  if (route === 'requirements') page = <RequirementsPage language={language} project={project} navigation={navigation} />;
  if (route === 'verification') page = <VerificationPage language={language} project={project} navigation={navigation} />;
  if (route === 'teams') page = <TeamsHubPage onOpenProject={id => void workspace.openProject(id)} language={language} initialTeamId={new URLSearchParams(window.location.hash.split('?')[1] || '').get('team') || project.context.teamId || ''} onTeamsChanged={() => void workspace.refreshTeams()} />;
  if (route === 'invitations') page = <InvitationInbox language={language} onBack={() => goBack()} />;
  if (projectArea && !workspace.ready) page = <ProjectAccessPanel language={language} loading={workspace.loading} error={loadingMessage} projects={projects} opening={workspace.opening} onRetry={workspace.retry} onSelect={id => void workspace.openProject(id)} onCreate={newProject} />;

  const title = {
    home: pt ? 'Início' : 'Home', teams: pt ? 'Equipes' : 'Teams', newProject: pt ? 'Novo projeto' : 'New project',
    admin: pt ? 'Administração' : 'Administration', meetingObservability: pt ? 'Diagnóstico de reuniões' : 'Meeting diagnostics',
    people: pt ? 'Contatos' : 'Contacts', messages: pt ? 'Mensagens' : 'Messages', meetings: pt ? 'Reuniões' : 'Meetings',
    invitations: pt ? 'Convites' : 'Invitations', requirements: pt ? 'Requisitos' : 'Requirements',
    verification: pt ? 'Verificação' : 'Verification', schedule: pt ? 'Cronograma' : 'Schedule', documents: pt ? 'Documentos' : 'Documents'
  }[route];
  const context: PageContext | null = route === 'meetings' ? pageContext : projectArea && workspace.ready ? {
    teamId: project.context.teamId || undefined, teamName: teams.find(team => team.id === project.context.teamId)?.name || project.context.teamName,
    projectId: project.id, projectName: project.name
  } : null;
  const crumbs = [
    ...(context?.teamId && context.teamName ? [{ label: context.teamName, href: `#/teams?team=${encodeURIComponent(context.teamId)}` }] : []),
    ...(context?.projectId && context.projectName ? [{ label: context.projectName, href: '#/requirements', onClick: () => void workspace.openProject(context.projectId!) }] : []),
    ...(context?.sectorId && context.sectorName ? [{ label: context.sectorName, href: `#/meetings?team=${encodeURIComponent(context.teamId || '')}&sector=${encodeURIComponent(context.sectorId)}` }] : [])
  ];
  return <div className={`app-shell${sidebarExpanded ? ' sidebar-expanded' : ''} route-${route}`}>
    {meeting.error && <div className="meetings-navigation-error" role="alert">{meeting.error}</div>}
    <MissionSidebar language={language} expanded={sidebarExpanded} homeLabel={pt ? 'Início' : 'Home'} teamLabel={pt ? 'Equipes' : 'Teams'} homeActive={route === 'home'} teamActive={route === 'teams'} meetingsActive={route === 'meetings'} onMeetings={() => { window.location.hash = '#/meetings'; }} projects={projects} loadingProjects={workspace.loading} projectLoadFailed={Boolean(workspace.error)} projectTeamName={workspace.ready ? teams.find(team => team.id === project.context.teamId)?.name || project.context.teamName : ''} activeProjectId={activeProjectId} onToggle={() => setSidebarExpanded(current => { window.localStorage.setItem('norte-sidebar-expanded', String(!current)); return !current; })} onHome={openHome} onTeam={openTeams} onProjectSelect={id => void workspace.openProject(id)} activeArea={projectArea ? route : null} onAreaSelect={openArea} />
    <div className="app-page">
      <AppHeader crumbs={crumbs} language={language} title={title} onHome={route !== 'home' && route !== 'meetings' ? () => goBack('#/') : undefined} onLanguageChange={changeLanguage} />
      {(workspace.error || workspace.teamError) && <div className="project-resource-notice" role="status"><span>{workspace.error ? loadingMessage : pt ? 'A lista de equipes não carregou. Você pode continuar no projeto aberto.' : 'The team directory could not be loaded. You can continue in the open project.'}</span><button type="button" disabled={workspace.loading || Boolean(workspace.opening)} onClick={workspace.retry}>{pt ? 'Recarregar dados' : 'Reload data'}</button></div>}
      {auth.user && <RecentWork key={auth.user.id} userId={auth.user.id} language={language}/>}
      <div className="app-content"><Suspense fallback={<p role="status">{pt ? 'Carregando…' : 'Loading…'}</p>}>{page}</Suspense></div>
    </div>
    <Suspense fallback={null}><ChatWidget key={auth.user?.id} language={language} /></Suspense>
  </div>;
}
