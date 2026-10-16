import { goBack, initializeNavigation } from "./lib/navigation";
import { IdeasPage } from "./pages/IdeasPage";
import { ProjectGuide, JourneyHint, FirstVisit } from "./components/ProjectJourney";
import { AppHeader } from "./components/AppHeader";
import { TeamDashboardPage } from "./pages/TeamDashboardPage";
import { MeetingsPage } from "./pages/MeetingsPage";
import { ExtractionProposalDialog } from "./components/ExtractionProposalDialog";
import type { EngineeringSystemModel } from "./lib/engineeringSystem";
import { mergeAppliedExtraction } from "./lib/extractionJobs";
import { useExtractionTasks } from "./lib/useExtractionTasks";
import { ExtractionProgressPanel } from "./components/ExtractionProgressPanel";
import { ChatWidget } from "./components/chat/ChatWidget";
import { InvitationInbox } from "./components/TeamInvitations";
import { ProjectSetupPage } from "./pages/ProjectSetupPage";
import { PlatformAdminPage } from "./pages/PlatformAdminPage";
import { PeoplePage } from "./pages/PeoplePage";
import { MessagesPage } from "./pages/MessagesPage";
import { PlansPage } from "./pages/PlansPage";
import { SchedulePage } from "./pages/SchedulePage";
import "./organization.css";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { MissionSidebar } from "./components/MissionSidebar";
import { HomePage } from "./pages/HomePage";
import { StudySetupPage } from "./pages/StudySetupPage";
import { TeamPage } from "./pages/TeamPage";
import { TeamsHubPage } from "./pages/TeamsHubPage";
import { BrainstormPage } from "./pages/BrainstormPage";
import { RequirementsPage } from "./pages/RequirementsPage";
import { VerificationPage } from "./pages/VerificationPage";
import { DiscoveryPanel, useDiscoveryPanel } from "./components/DiscoveryPanel";
import type { RailKey } from "./lib/projectRail";
import { ApiError, useAuth } from "./lib/auth";
import { getStoredLanguage, resolveText, setStoredLanguage } from "./lib/i18n";
import { createEmptyProject, loadProject, normalizeProject, completeConception, recordMemoryRevision, saveProject } from "./lib/projectStore";
import type { MissionProject } from "./lib/projectStore";
import type { ProjectSummary, TeamRecord } from "./lib/team";
import type { Language } from "./lib/types";
import "./mission-sidebar.css";

type Route = "guide" | "ideas" | "schedule" | "people" | "messages" | "plans" | "dashboard" | "invitations" | "meetings" | "newProject" | "admin" | "home" | "setup" | "teams" | "projectTeam" | "brainstorm" | "requirements" | "verification";
/** Areas are reached freely, in any order, and never gate one another. */
export const PROJECT_AREAS = { requirements: "#/requirements", verification: "#/verification", schedule: "#/schedule" } as const;

const ACTIVE_PROJECT_KEY = "norte-active-project-v1";

function storedPreference(key: string): string {
  return typeof window === "undefined" ? "" : window.localStorage.getItem(key) || "";
}

function getRoute(): Route {
  if (window.location.hash === "#/guide") return "guide";
  if (window.location.hash.startsWith("#/ideas")) return "ideas";
  if (window.location.hash.startsWith("#/messages")) return "messages";
  if (window.location.hash === "#/people") return "people";
  if (window.location.hash === "#/plans") return "plans";
  if (window.location.hash.startsWith("#/admin")) return "admin";
  if (window.location.hash.startsWith("#/meetings")) return "meetings";
  if (window.location.hash === "#/dashboard") return "dashboard";
  if (window.location.hash.startsWith("#/invitations")) return "invitations";
  if (window.location.hash === "#/new-project") return "newProject";
  if (window.location.hash === "#/admin/users") return "admin";
  if (window.location.hash === "#/preliminary-design") return "brainstorm";
  if (window.location.hash.startsWith("#/brainstorming")) return "brainstorm";
  if (window.location.hash.startsWith("#/study-setup") || window.location.hash === "#/project-setup") return "setup";
  if (window.location.hash === "#/project-team") return "projectTeam";
  for (const [area, hash] of Object.entries(PROJECT_AREAS)) if (window.location.hash === hash) return area as Route;
  if (window.location.hash.startsWith("#/teams") || window.location.hash === "#/team") return "teams";
  return "home";
}

function projectSummary(project: MissionProject): ProjectSummary {
  return {
    id: project.id,
    name: project.name,
    programId: project.context.programId,
    teamId: project.context.teamId,
    updatedAt: project.updatedAt,
    memberCount: project.context.assignments.length
  };
}

function hasLocalWork(project: MissionProject): boolean {
  return Boolean(project.name.trim() || project.context.configured || project.board.nodes.length || project.setup.statement.trim());
}

export function App() {
  useEffect(() => initializeNavigation(), []);
  const auth = useAuth();
  const [language, setLanguage] = useState<Language>(getStoredLanguage);
  const [project, setProject] = useState<MissionProject>(() => loadProject(getStoredLanguage()));
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [teams, setTeams] = useState<TeamRecord[]>([]);
  const [membershipRevision, setMembershipRevision] = useState(0);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [route, setRoute] = useState<Route>(getRoute);
  const [pageContext, setPageContext] = useState<{teamId?:string;teamName?:string;projectId?:string;projectName?:string;sectorId?:string;sectorName?:string}|null>(null);
  useEffect(()=>{const receive=(event:Event)=>setPageContext((event as CustomEvent).detail || null);window.addEventListener("norte:page-context",receive);return()=>window.removeEventListener("norte:page-context",receive);},[]);
  const [sidebarExpanded, setSidebarExpanded] = useState(() => storedPreference("norte-sidebar-expanded") ? storedPreference("norte-sidebar-expanded") === "true" : window.innerWidth >= 1000);
  useEffect(() => { const media = window.matchMedia('(max-width: 900px)'); const collapse = () => { if (media.matches) setSidebarExpanded(false); }; collapse(); media.addEventListener('change', collapse); return () => media.removeEventListener('change', collapse); }, []);
  const discovery = useDiscoveryPanel();
  const [activeProjectId, setActiveProjectId] = useState(() => storedPreference(ACTIVE_PROJECT_KEY));
  const [saveError, setSaveError] = useState("");
  const [meetingNavigationError, setMeetingNavigationError] = useState("");
  const meetingRunning = useRef(false);
  const [initializationError, setInitializationError] = useState("");
  const initializationRef = useRef(false);
  const [isDraft, setIsDraft] = useState(false);
  const projectRef = useRef(project);
  const projectNavigationRef = useRef(0);
  const saveTimerRef = useRef<number | null>(null);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const cloudReadyRef = useRef(false);
  const persistableRef = useRef(false);
  const draftRef = useRef(false);
  const appliedMaps = useRef(new Map<string, { previousGeneratedAt?: string; model: EngineeringSystemModel }>());

  const refreshProjects = useCallback(async () => {
    const response = await auth.api<{ projects: ProjectSummary[]; validationResetId?: string | null }>("/projects");
    if (response.validationResetId && window.localStorage.getItem("norte-validation-reset-id") !== response.validationResetId) {
      // Only an explicitly guarded reset authorizes clearing obsolete workspace caches.
      const keys = Array.from({ length: window.localStorage.length }, (_, index) => window.localStorage.key(index));
      for (const key of keys) if (key && /^(norte-project-v2|mission-dev-project-v2|norte-active-project-v1|norte-default-team-v1|norte-brainstorm-lab|mission-dev-brainstorm-lab)/u.test(key)) window.localStorage.removeItem(key);
      window.localStorage.setItem("norte-validation-reset-id", response.validationResetId);
    }
    setProjects(response.projects);
    return response.projects;
  }, [auth.api]);

  const refreshTeams = useCallback(async () => {
    const response = await auth.api<{ teams: TeamRecord[] }>("/teams");
    setTeams(response.teams);
    return response.teams;
  }, [auth.api]);

  useEffect(() => {
    const refreshMembership = () => setMembershipRevision(value => value + 1);
    window.addEventListener("norte-membership-changed", refreshMembership);
    return () => window.removeEventListener("norte-membership-changed", refreshMembership);
  }, []);

  const persistProject = useCallback((nextProject: MissionProject) => {
    // Preserve write order: an older autosave must never arrive after a rename
    // or after saving progress while opening Conception. Failed saves do not block retries.
    const operation = saveQueueRef.current.then(async () => {
      const applied = appliedMaps.current.get(nextProject.id);
      // A queued save captured before explicit apply must not restore the old map.
      if (applied && nextProject.engineeringSystem?.generatedAt === applied.previousGeneratedAt) nextProject = mergeAppliedExtraction(nextProject, applied.model);
      const response = await auth.api<{ project: MissionProject }>("/projects/" + nextProject.id, { method: "PUT", body: JSON.stringify({ ...nextProject, organizationRevision: projectRef.current.id === nextProject.id ? projectRef.current.organizationRevision : nextProject.organizationRevision }) });
      if (projectRef.current.id === nextProject.id) {
        projectRef.current = { ...projectRef.current, organizationRevision: response.project.organizationRevision };
        setProject(current => current.id === nextProject.id ? { ...current, organizationRevision: response.project.organizationRevision } : current);
      }
      setSaveError("");
      setProjects((current) => {
        const next = current.filter((item) => item.id !== nextProject.id);
        return [projectSummary(nextProject), ...next];
      });
      if (projectRef.current.id === nextProject.id) {
        setActiveProjectId(nextProject.id);
        window.localStorage.setItem(ACTIVE_PROJECT_KEY, nextProject.id);
      }
      return normalizeProject(response.project);
    });
    saveQueueRef.current = operation.then(() => undefined, () => undefined);
    return operation;
  }, [auth.api]);

  const flushProject = useCallback(() => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (!persistableRef.current || draftRef.current) return Promise.resolve(true);
    const saved = saveProject(projectRef.current);
    projectRef.current = saved;
    if (cloudReadyRef.current && hasLocalWork(saved)) return persistProject(saved).then(() => true, reason => { setSaveError(reason instanceof Error ? reason.message : "Falha ao salvar."); return false; });
    return Promise.resolve(true);
  }, [persistProject]);

  const applyExtractionInSaveQueue = useCallback(async (projectId: string, operation: () => Promise<void>) => {
    if (projectRef.current.id === projectId) flushProject();
    const applying = saveQueueRef.current.then(operation);
    saveQueueRef.current = applying.then(() => undefined, () => undefined);
    await applying;
  }, [flushProject]);

  const onExtractionApplied = useCallback(async (projectId: string, response: { project?: MissionProject; engineeringSystem: EngineeringSystemModel }, previous?: EngineeringSystemModel) => {
    const current = projectRef.current;
    appliedMaps.current.set(projectId, { previousGeneratedAt: previous?.generatedAt ?? (current.id === projectId ? current.engineeringSystem?.generatedAt : undefined), model: response.engineeringSystem });
    if (current.id === projectId) {
      const next = saveProject(mergeAppliedExtraction(current, response.engineeringSystem));
      projectRef.current = next; setProject(next);
    }
    await refreshProjects().catch(() => undefined);
  }, [refreshProjects]);

  const extraction = useExtractionTasks({ api: auth.api, userId: auth.user?.id, activeProject: project, ready: !loadingProjects && Boolean(activeProjectId), language, applyInSaveQueue: applyExtractionInSaveQueue, onApplied: onExtractionApplied });

  useEffect(() => {
    const receive = (event: Event) => {
      const candidate = (event as CustomEvent<{ project: MissionProject }>).detail?.project;
      if (!candidate || candidate.id !== projectRef.current.id) return;
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
      if (candidate.engineeringSystem) appliedMaps.current.set(candidate.id, { previousGeneratedAt: projectRef.current.engineeringSystem?.generatedAt, model: candidate.engineeringSystem });
      projectRef.current = normalizeProject(candidate, language); setProject(saveProject(projectRef.current)); void refreshProjects();
    };
    window.addEventListener('norte:configuration-applied', receive);
    return () => window.removeEventListener('norte:configuration-applied', receive);
  }, [language, refreshProjects]);

  const changeProject = useCallback((candidate: MissionProject) => {
    const nextProject = recordMemoryRevision(projectRef.current, candidate);
    projectRef.current = nextProject;
    setProject(nextProject);
    if (!persistableRef.current || draftRef.current) return;
    setProjects((current) => current.map((item) => item.id === nextProject.id ? projectSummary(nextProject) : item));
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(flushProject, 240);
  }, [flushProject]);

  useEffect(() => {
    if (!auth.isDemo) return;
    function applyExplicitValidation(event: Event) {
      const candidate = (event as CustomEvent<{ project: MissionProject }>).detail?.project;
      if (!candidate) return;
      if (saveTimerRef.current !== null) { window.clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
      const next = saveProject(normalizeProject(candidate, getStoredLanguage()));
      projectRef.current = next;
      persistableRef.current = true;
      draftRef.current = false;
      setProject(next);
      setIsDraft(false);
      setActiveProjectId(next.id);
      window.localStorage.setItem(ACTIVE_PROJECT_KEY, next.id);
      void refreshProjects(); void refreshTeams();
    }
    window.addEventListener("norte-demo-validation-updated", applyExplicitValidation);
    return () => window.removeEventListener("norte-demo-validation-updated", applyExplicitValidation);
  }, [auth.isDemo, refreshProjects, refreshTeams]);

  useEffect(() => {
    let cancelled = false;
    cloudReadyRef.current = false;
    appliedMaps.current.clear();
    persistableRef.current = false;
    draftRef.current = false;
    setIsDraft(false);
    setLoadingProjects(true);

    void Promise.all([refreshProjects(), refreshTeams()])
      .then(async ([summaries]) => {
        if (cancelled || draftRef.current) return;
        if (summaries.length === 0) {
          const empty = createEmptyProject(getStoredLanguage());
          const directDraft = ["setup", "projectTeam"].includes(getRoute());
          draftRef.current = directDraft;
          setIsDraft(directDraft);
          projectRef.current = empty;
          setProject(empty);
          setActiveProjectId("");
          window.localStorage.removeItem(ACTIVE_PROJECT_KEY);
          return;
        }

        const storedId = storedPreference(ACTIVE_PROJECT_KEY);
        const preferredId = summaries.some((item) => item.id === storedId)
          ? storedId
          : summaries.some((item) => item.id === projectRef.current.id) ? projectRef.current.id : summaries[0].id;
        const response = await auth.api<{ project: MissionProject }>("/projects/" + preferredId);
        if (cancelled || !response.project) return;
        const normalized = normalizeProject(response.project, getStoredLanguage());
        projectRef.current = normalized;
        setProject(saveProject(normalized));
        persistableRef.current = true;
        setActiveProjectId(normalized.id);
        window.localStorage.setItem(ACTIVE_PROJECT_KEY, normalized.id);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) {
          cloudReadyRef.current = true;
          setLoadingProjects(false);
        }
      });

    return () => {
      cancelled = true;
      cloudReadyRef.current = false;
    };
  }, [auth.api, auth.user?.id, auth.user?.emailVerifiedAt, membershipRevision, refreshProjects, refreshTeams]);

  useEffect(() => {
    const message = (event: MessageEvent) => {
      const frame = document.querySelector<HTMLIFrameElement>(".meetings-frame");
      if (event.origin !== window.location.origin || event.source !== frame?.contentWindow || event.data?.type !== "norte:meeting-running") return;
      meetingRunning.current = event.data.running === true;
      if (!meetingRunning.current) setMeetingNavigationError("");
    };
    const preventNavigation = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest("[data-meeting-safe]")) return;
      if (!meetingRunning.current || !(event.target instanceof Element) || !event.target.closest(".mission-sidebar button,.app-header button,.app-header a")) return;
      event.preventDefault(); event.stopImmediatePropagation(); setMeetingNavigationError("Encerre ou interrompa a reunião antes de mudar de área.");
    };
    const leaving = (event: BeforeUnloadEvent) => { if (meetingRunning.current) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("message", message); window.addEventListener("click", preventNavigation, true); window.addEventListener("beforeunload", leaving);
    return () => { window.removeEventListener("message", message); window.removeEventListener("click", preventNavigation, true); window.removeEventListener("beforeunload", leaving); };
  }, []);

  useEffect(() => {
    function onHashChange() {
      const nextRoute = getRoute();
      if (meetingRunning.current && nextRoute !== "meetings") { window.history.replaceState(null, "", "#/meetings"); setMeetingNavigationError("Encerre ou interrompa a reunião antes de mudar de área."); return; }
      if (window.location.hash === "#/software") {
        window.location.replace("#/study-setup");
        return;
      }
      if (window.location.hash === "#/project-setup") {
        window.location.replace("#/study-setup");
        return;
      }
      if (window.location.hash === "#/team") {
        window.location.replace("#/teams");
        return;
      }
      setRoute(nextRoute);
    }

    window.addEventListener("hashchange", onHashChange);
    onHashChange();
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    function saveBeforeLeaving() {
      flushProject();
    }

    function saveWhenHidden() {
      if (document.visibilityState === "hidden") flushProject();
    }

    window.addEventListener("pagehide", saveBeforeLeaving);
    window.addEventListener("beforeunload", saveBeforeLeaving);
    document.addEventListener("visibilitychange", saveWhenHidden);
    return () => {
      window.removeEventListener("pagehide", saveBeforeLeaving);
      window.removeEventListener("beforeunload", saveBeforeLeaving);
      document.removeEventListener("visibilitychange", saveWhenHidden);
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    };
  }, [flushProject]);

  useEffect(() => {
    if (auth.status !== "authenticated" || loadingProjects || !activeProjectId || !["setup", "projectTeam", "brainstorm", "requirements", "verification"].includes(route)) return;
    void auth.api(`/projects/${activeProjectId}/visit`, { method: "POST" }).catch(() => undefined);
  }, [auth.api, auth.status, activeProjectId, route, loadingProjects]);

  useLayoutEffect(() => {
    const legacySelectors = [".app-page .home-sidebar", ".app-page .setup-sidebar", ".app-page .brain-sidebar", ".app-page .sidebar-overlay", ".app-page .square-menu", ".app-page .mobile-menu"];
    document.querySelectorAll<HTMLElement>(legacySelectors.join(",")).forEach((element) => {
      element.style.setProperty("display", "none", "important");
      element.setAttribute("aria-hidden", "true");
    });
  }, [route]);

  const t = useMemo(() => (path: string) => resolveText(language, path), [language]);
  const currentStep = ["setup", "projectTeam"].includes(route) ? 0 : route === "brainstorm" ? 1 : null;

  function changeLanguage(nextLanguage: Language) {
    setLanguage(nextLanguage);
    setStoredLanguage(nextLanguage);
    document.documentElement.lang = nextLanguage === "pt" ? "pt-BR" : "en";
  }

  async function openProject(projectId: string, overview = false) {
    const navigation = ++projectNavigationRef.current, startingHash = window.location.hash;
    const saved = await flushProject();
    if (!saved || navigation !== projectNavigationRef.current || window.location.hash !== startingHash) return;
    try {
      const response = await auth.api<{ project: MissionProject }>("/projects/" + projectId);
      if (navigation !== projectNavigationRef.current || window.location.hash !== startingHash) return;
      const next = saveProject(normalizeProject(response.project, language));
      draftRef.current = false;
      persistableRef.current = true;
      projectRef.current = next;
      setProject(next);
      setIsDraft(false);
      setActiveProjectId(next.id);
      window.localStorage.setItem(ACTIVE_PROJECT_KEY, next.id);
      const nextRoute = !overview && ["preliminary", "brainstorm"].includes(next.navigation.lastRoute ?? "") ? "brainstorm" : "setup";
      const url = new URL(window.location.href);
      if (nextRoute === "brainstorm") url.searchParams.set("view", next.navigation.lastConceptionWorkspace ?? "system");
      else url.searchParams.delete("view");
      url.hash = nextRoute === "brainstorm" ? "/brainstorming" : overview ? "/study-setup?tab=overview" : "/study-setup";
      window.history.pushState({ ...window.history.state, norteIndex: undefined }, "", url);
      window.dispatchEvent(new HashChangeEvent("hashchange"));
      setRoute(nextRoute);
    } catch {
      if (navigation !== projectNavigationRef.current || window.location.hash !== startingHash) return;
      const local = projects.find((item) => item.id === projectId);
      if (local && projectRef.current.id === projectId) window.location.hash = ["preliminary", "brainstorm"].includes(projectRef.current.navigation.lastRoute ?? "") ? "#/brainstorming" : "#/study-setup";
    }
  }

  async function createProject(candidate: MissionProject) {
    flushProject();
    await saveQueueRef.current;
    const response = await auth.api<{ project: MissionProject }>("/projects", { method: "POST", body: JSON.stringify(candidate) });
    const next = saveProject(normalizeProject(response.project, language));
    projectRef.current = next; setProject(next);
    persistableRef.current = true; draftRef.current = false; setIsDraft(false);
    setProjects(current => [projectSummary(next), ...current]);
    await refreshTeams();
    setActiveProjectId(next.id); window.localStorage.setItem(ACTIVE_PROJECT_KEY, next.id);
    window.location.hash = "#/study-setup";
  }
  async function commitProject(candidate: MissionProject) {
    if (saveTimerRef.current !== null) { window.clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
    const next = await persistProject(candidate);
    projectRef.current = next; setProject(saveProject(next));
  }

  async function deleteProject(projectId: string) {
    await auth.api("/projects/" + projectId, { method: "DELETE" });
    const remaining = projects.filter((item) => item.id !== projectId);
    setProjects(remaining);
    if (projectRef.current.id !== projectId && activeProjectId !== projectId) return;

    persistableRef.current = false;
    draftRef.current = false;
    setIsDraft(false);
    const nextId = remaining[0]?.id || "";
    setActiveProjectId(nextId);
    if (nextId) {
      window.localStorage.setItem(ACTIVE_PROJECT_KEY, nextId);
      const response = await auth.api<{ project: MissionProject }>("/projects/" + nextId);
      const next = saveProject(normalizeProject(response.project, language));
      projectRef.current = next;
      setProject(next);
      persistableRef.current = true;
    } else {
      window.localStorage.removeItem(ACTIVE_PROJECT_KEY);
      const empty = createEmptyProject(language);
      projectRef.current = empty;
      setProject(empty);
    }
  }

  function setProjectNavigation(lastRoute: MissionProject["navigation"]["lastRoute"]) {
    const current = projectRef.current;
    if (current.navigation.lastRoute === lastRoute) return current;
    const next = { ...current, navigation: { ...current.navigation, lastRoute } };
    changeProject(next);
    return next;
  }

  function openMemory() {
    setProjectNavigation("setup");
    window.location.hash = "#/study-setup";
  }

  function openTeams() {
    window.location.hash = "#/teams";
  }

  function openMeetings() {
    flushProject();
    window.location.hash = "#/meetings";
  }

  function openProjectTeam() {
    window.location.hash = "#/project-team";
  }

  async function openBrainstorm(regenerate = false) {
    if (initializationRef.current) return;
    initializationRef.current = true;
    setInitializationError("");
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    try {
      let current = projectRef.current;
      if (!persistableRef.current || draftRef.current) throw new Error(language === "pt" ? "Abra um projeto existente para iniciar a concepção." : "Open an existing project to start conception.");
      if (regenerate) {
        const existing = extraction.tasks[current.id];
        if (existing && !existing.applied && existing.job.status !== "failed") {
          extraction.select(current.id); extraction.setExpanded(true); return;
        }
        // Only startup is awaited. Processing and polling are independent of navigation.
        current = await persistProject(current);
        await extraction.start(current, regenerate);
        return;
      }
      const prepared = await persistProject(current.engineeringSystem ? completeConception(current, current.engineeringSystem) : { ...current, navigation: { ...current.navigation, lastRoute: "brainstorm" }, phaseProgress: { highestUnlockedStep: Math.max(1, current.phaseProgress.highestUnlockedStep) as 1 | 2 } });
      if (projectRef.current.id !== prepared.id) return;
      projectRef.current = prepared;
      setProject(saveProject(prepared));
      const url = new URL(window.location.href);
      url.searchParams.set("view", prepared.navigation.lastConceptionWorkspace ?? "system");
      const currentHash = window.location.hash;
      url.hash = currentHash;
      window.history.replaceState(window.history.state, "", url);
      window.location.hash = "/brainstorming";
      setRoute("brainstorm");
    } catch (reason) {
      const messages: Record<string, string> = language === "pt" ? {
        SYSTEM_MEMORY_INSUFFICIENT: "Vincule à memória um arquivo de texto ou PDF que descreva o sistema e tente novamente.",
        SYSTEM_AI_NOT_CONFIGURED: "A leitura assistida ainda não está configurada. A memória foi salva; tente novamente quando o serviço estiver disponível.",
        SYSTEM_AI_UNAVAILABLE: "O serviço de engenharia está temporariamente indisponível. A memória foi preservada. Tente novamente.",
        SYSTEM_RESPONSE_INVALID: "Não foi possível validar a arquitetura gerada. Tente novamente ou revise as fontes na memória.",
        SYSTEM_EVIDENCE_INVALID: "Não foi possível confirmar os dados nas fontes. Revise os arquivos vinculados e tente novamente.",
        SYSTEM_HIERARCHY_INVALID: "Não foi possível validar a organização do sistema. A memória foi preservada; tente novamente.",
        SYSTEM_FORMULA_INVALID: "Não foi possível validar as dependências dos cálculos. A memória foi preservada; tente novamente.",
        SYSTEM_MEMORY_STALE: "Os documentos mudaram. Use Atualizar mapa dos documentos na memória do projeto.",
        SYSTEM_BASELINE_CHANGED: "O mapa foi editado durante a leitura. A versão atual foi mantida; inicie outra atualização.",
        PROJECT_MEMORY_CHANGED: "A memória mudou durante a leitura. A versão atual foi mantida. Tente novamente para usar as fontes atuais."
      } : {
        SYSTEM_MEMORY_INSUFFICIENT: "Link a text or PDF file describing the system to Project Memory and try again.",
        SYSTEM_AI_NOT_CONFIGURED: "Assisted reading is not configured yet. Your memory is saved; retry when the service is available.",
        SYSTEM_AI_UNAVAILABLE: "The engineering service is temporarily unavailable. Your memory is preserved; try again.",
        SYSTEM_RESPONSE_INVALID: "The generated architecture could not be validated. Retry or review the sources in Project Memory.",
        SYSTEM_EVIDENCE_INVALID: "The extracted data could not be confirmed in its sources. Review the linked files and retry.",
        SYSTEM_HIERARCHY_INVALID: "The system hierarchy could not be validated. Your memory is preserved; try again.",
        SYSTEM_FORMULA_INVALID: "The calculation dependencies could not be validated. Your memory is preserved; try again.",
        SYSTEM_MEMORY_STALE: "Documents changed. Choose Update map from documents in Project Memory.",
        SYSTEM_BASELINE_CHANGED: "The map was edited during extraction. The current version was kept; start another update.",
        PROJECT_MEMORY_CHANGED: "Project Memory changed during extraction. The current map was kept. Retry using the current sources."
      };
      const message = (reason instanceof ApiError && messages[reason.code]) || (reason instanceof Error ? reason.message : language === "pt" ? "Não foi possível ler a memória. Tente novamente." : "Could not read project memory. Try again.");
      setInitializationError(message);
      throw new Error(message, { cause: reason });
    } finally {
      initializationRef.current = false;
    }
  }

  function openHome() {
    if (draftRef.current) {
      draftRef.current = false;
      persistableRef.current = false;
      setIsDraft(false);
      const empty = createEmptyProject(language);
      projectRef.current = empty;
      setProject(empty);
      setActiveProjectId("");
    } else {
      flushProject();
    }
    window.location.hash = "#/";
  }

  function openPipelineStep(step: number) {
    if (step === 0) openMemory();
    if (step === 1 && activeProjectId) void openBrainstorm().catch(() => undefined);
  }

  function openArea(area: keyof typeof PROJECT_AREAS) { window.location.hash = PROJECT_AREAS[area]; setRoute(area); }
  const railNavigation = {
    onOpen: (key: RailKey) => {
      if (key === "memory") openMemory();
      else if (key === "conception") void openBrainstorm().catch(() => undefined);
      else if (key in PROJECT_AREAS) openArea(key as keyof typeof PROJECT_AREAS);
    },
    onOpenDiscovery: () => { if (route === "meetings") discovery.toggle(); else window.location.hash = "#/ideas"; },
    discoveryOpen: discovery.open
  };

  let page = <HomePage language={language} t={t} onLanguageChange={changeLanguage} projects={projects} loadingProjects={loadingProjects} onOpenProject={(id) => void openProject(id)} onDeleteProject={deleteProject} onOpenTeams={openTeams} onCreateProject={() => { flushProject(); window.location.hash = "#/new-project"; }} onAdmin={auth.user?.accessRole === "owner_admin" && !auth.isDemo ? () => { window.location.hash = "#/admin/users"; } : undefined} />;
  if (route === "guide") page = <ProjectGuide project={project} activeProject={Boolean(activeProjectId && activeProjectId === project.id && !loadingProjects)} teams={teams} language={language} route={route} />;
  if (route === "ideas") page = <IdeasPage language={language} project={project} onProjectChange={changeProject} />;
  if (route === "dashboard") page = <TeamDashboardPage language={language} teams={teams} />;
  if (route === "meetings") page = <MeetingsPage language={language} projects={projects} activeProjectId={activeProjectId} />;
  if (route === "newProject") page = <ProjectSetupPage language={language} teams={teams} onCreate={createProject} onHome={openHome} onTeams={openTeams} />;
  if (route === "admin") page = <PlatformAdminPage language={language} />;
  if (route === "people") page = <PeoplePage language={language} />;
  if (route === "messages") page = <MessagesPage language={language} />;
  if (route === "plans") page = <PlansPage language={language} />;
  if (route === "schedule") page = <SchedulePage language={language} project={project} navigation={railNavigation} />;
  if (route === "setup") page = <StudySetupPage language={language} project={project} isDraft={isDraft} t={t} onLanguageChange={changeLanguage} onProjectChange={changeProject} onContinue={() => openBrainstorm()} onRegenerate={() => openBrainstorm(true)} onHome={openHome} onTeams={openTeams} onManageTeam={openProjectTeam} onPersistProject={commitProject} />;
  if (route === "teams") page = <TeamsHubPage onOpenProject={id => void openProject(id)} language={language} t={t} onLanguageChange={changeLanguage} onBack={() => goBack()} initialTeamId={new URLSearchParams(window.location.hash.split("?")[1] || "").get("team") || project.context.teamId || ""} onTeamsChanged={() => void refreshTeams()} />;
  if (route === "invitations") page = <InvitationInbox language={language} onBack={() => goBack()} />;
  if (route === "projectTeam") page = <TeamPage language={language} project={project} t={t} onLanguageChange={changeLanguage} onBack={() => goBack("#/study-setup")} onProjectSetup={openMemory} />;
  if (route === "requirements") page = <RequirementsPage language={language} project={project} navigation={railNavigation} />;
  if (route === "verification") page = <VerificationPage language={language} project={project} navigation={railNavigation} />;
  if (route === "brainstorm") page = <BrainstormPage key={`${project.id}:${route}`} language={language} project={project} t={t} onLanguageChange={changeLanguage} onProjectChange={changeProject} onHome={openHome} onBackSetup={openMemory} navigation={railNavigation} />;

  if (!activeProjectId && !loadingProjects && ["setup", "projectTeam", "brainstorm", "ideas", "requirements", "verification", "schedule"].includes(route)) page = <ProjectGuide project={project} activeProject={false} teams={teams} language={language} route={route} />;

  const discoveryAvailable = Boolean(activeProjectId) && !["people", "messages", "plans", "dashboard", "invitations", "home", "teams", "setup", "newProject", "admin", "ideas", "guide"].includes(route);
  const areaLabel = { guide: language === "pt" ? "Guia do projeto" : "Project guide", ideas: language === "pt" ? "Testar ideias" : "Test ideas", schedule: language === "pt" ? "Cronograma" : "Schedule", people: language === "pt" ? "Pessoas" : "People", messages: language === "pt" ? "Mensagens" : "Messages", plans: language === "pt" ? "Planos" : "Plans", meetings: language === "pt" ? "Reuniões" : "Meetings", dashboard: language === "pt" ? "Painel da equipe" : "Team dashboard", invitations: language === "pt" ? "Convites" : "Invitations", setup: language === "pt" ? "Memória do projeto" : "Project memory", projectTeam: language === "pt" ? "Equipe do projeto" : "Project team", brainstorm: language === "pt" ? "Concepção" : "Conception", requirements: language === "pt" ? "Requisitos" : "Requirements", verification: language === "pt" ? "Verificação" : "Verification", home: "", teams: "", newProject: "", admin: "" }[route];

  const projectArea = Boolean(activeProjectId) && ["setup", "projectTeam", "brainstorm", "ideas", "requirements", "verification", "schedule"].includes(route);
  const context = route === "meetings" ? pageContext : projectArea ? { teamId: project.context.teamId, teamName: teams.find(team=>team.id===project.context.teamId)?.name || project.context.teamName, projectId: project.id, projectName: project.name } : null;
  const crumbs = [
    ...(context?.teamId && context.teamName ? [{label:context.teamName,href:`#/teams?team=${encodeURIComponent(context.teamId)}`}] : []),
    ...(context?.projectId && context.projectName ? [{label:context.projectName,href:`#/study-setup?tab=overview`,onClick:()=>void openProject(context.projectId!, true)}] : []),
    ...(context && 'sectorId' in context && context.sectorId && context.sectorName ? [{label:context.sectorName,href:`#/meetings?team=${encodeURIComponent(context.teamId||'')}&sector=${encodeURIComponent(context.sectorId)}`}] : [])
  ];
  return (
    <div className={`${sidebarExpanded ? "app-shell sidebar-expanded" : "app-shell"} route-${route}${discovery.open && discoveryAvailable ? " discovery-open" : ""}`} style={discovery.open && discoveryAvailable ? { ["--discovery-width" as string]: `${discovery.width}px` } : undefined}>
      {meetingNavigationError && <div className="meetings-navigation-error" role="alert">{meetingNavigationError}</div>}
      <MissionSidebar language={language} currentStep={currentStep} expanded={sidebarExpanded} connectedLabel={t("common.connected")} homeLabel={t("home.start")} teamLabel={language === "pt" ? "Equipes" : "Teams"} homeActive={route === "home"} teamActive={route === "teams"} meetingsActive={route === "meetings"} onMeetings={openMeetings} ideasActive={route === "ideas"} onIdeas={() => { if (route === "meetings") discovery.toggle(); else window.location.hash = "#/ideas"; }} projects={projects} projectTeamName={teams.find((team) => team.id === project.context.teamId)?.name || project.context.teamName} highestUnlockedStep={activeProjectId ? Math.max(1, project.phaseProgress.highestUnlockedStep) : -1} activeProjectId={activeProjectId} onToggle={() => setSidebarExpanded((current) => { window.localStorage.setItem("norte-sidebar-expanded", String(!current)); return !current; })} onHome={openHome} onTeam={openTeams} onProjectSelect={(id) => void openProject(id)} onStepSelect={openPipelineStep} activeArea={route in PROJECT_AREAS ? route : null} onAreaSelect={openArea} />
      <div className="app-page"><AppHeader crumbs={crumbs} notice={auth.user?.demoAccount ? (language === "pt" ? "Sua conta de teste pode ser retomada neste navegador por 30 dias após o último acesso." : "Resume this test account in this browser for 30 days after your last visit.") : auth.user?.testEnvironment ? (language === "pt" ? "Ambiente de teste · cópia local dos dados" : "Test environment · local data copy") : undefined} language={language} title={areaLabel || ({ home: language === "pt" ? "Início" : "Home", teams: language === "pt" ? "Equipes" : "Teams", newProject: language === "pt" ? "Novo projeto" : "New project", admin: language === "pt" ? "Administração" : "Administration" } as Record<string, string>)[route] || ""} onHome={route !== "home" ? () => { flushProject(); goBack(route === "meetings" ? "#/meetings" : ["requirements", "verification", "schedule", "projectTeam", "brainstorm", "ideas"].includes(route) ? "#/study-setup" : "#/"); } : undefined} onLanguageChange={changeLanguage} canManageTeams={teams.some(team => team.canManage)} />{saveError && <div className="save-error" role="alert">{language === "pt" ? "Alterações não salvas: " : "Unsaved changes: "}{saveError}<button type="button" onClick={flushProject}>{language === "pt" ? "Tentar novamente" : "Retry"}</button></div>}<div className="app-content"><JourneyHint project={project} activeProject={Boolean(activeProjectId && activeProjectId === project.id && !loadingProjects)} teams={teams} language={language} route={route} />{page}</div></div>
      {discoveryAvailable && discovery.open && <DiscoveryPanel language={language} project={project} width={discovery.width} contextLabel={areaLabel} onClose={discovery.close} onResize={discovery.resize} onProjectChange={changeProject} />}
      {!loadingProjects && <FirstVisit language={language} route={route} activeProject={Boolean(activeProjectId)} />}
      <ChatWidget key={auth.user?.id} language={language} project={activeProjectId ? project : undefined} />
      {extraction.review && <ExtractionProposalDialog proposal={extraction.review.proposal} previous={extraction.review.previous} job={extraction.review.task.job} language={language} onDecide={apply => { void extraction.decide(apply); }} />}
      {extraction.visible && <ExtractionProgressPanel task={extraction.visible} tasks={Object.values(extraction.tasks)} language={language} expanded={extraction.expanded} onExpanded={extraction.setExpanded} onSelect={extraction.select} onReview={() => { if (extraction.visible) void extraction.openReview(extraction.visible); }} onRetry={() => { if (extraction.visible) void extraction.reconnect(extraction.visible); }} onOpenProject={() => { const id = extraction.visible?.projectId; if (!id) return; extraction.setExpanded(false); if (projectRef.current.id === id) openMemory(); else void openProject(id).then(() => { window.location.hash = "#/study-setup"; }); }} />}
      {initializationError && route !== "setup" && <div className="conception-error" role="alert"><p>{initializationError}</p><button type="button" onClick={() => { setInitializationError(""); openMemory(); }}>{language === "pt" ? "Voltar à memória do projeto" : "Back to project memory"}</button><button type="button" onClick={() => setInitializationError("")}>{language === "pt" ? "Fechar" : "Close"}</button></div>}
    </div>
  );
}
