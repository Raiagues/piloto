import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from './auth';
import { getStoredLanguage } from './i18n';
import { canRetainReadCache } from './projectLoading';
import { createEmptyProject, normalizeProject } from './projectStore';
import type { MissionProject } from './projectStore';
import type { ProjectSummary, TeamRecord } from './team';
import type { Language } from './types';

const ACTIVE_PROJECT_KEY = 'norte-active-project-v1';
function summary(project: MissionProject): ProjectSummary {
  return { id: project.id, name: project.name, programId: project.context.programId, teamId: project.context.teamId, updatedAt: project.updatedAt, memberCount: project.context.assignments.length };
}

/** Loads workspace context. Each editor owns its API writes; navigation never writes a stale project snapshot. */
export function useProjectWorkspace(language: Language) {
  const { api, user } = useAuth();
  const [project, setProject] = useState(() => createEmptyProject(getStoredLanguage()));
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [teams, setTeams] = useState<TeamRecord[]>([]);
  const [activeProjectId, setActiveProjectId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [teamError, setTeamError] = useState(false);
  const [opening, setOpening] = useState('');
  const [revision, setRevision] = useState(0);
  const current = useRef(project), owner = useRef(''), navigation = useRef(0), ready = useRef(false), failedOpen = useRef('');

  const accept = useCallback((candidate: MissionProject) => {
    const next = normalizeProject(candidate, getStoredLanguage());
    current.current = next; ready.current = true;
    setProject(next); setActiveProjectId(next.id);
    window.localStorage.setItem(ACTIVE_PROJECT_KEY, next.id);
    return next;
  }, []);

  const refreshTeams = useCallback(async (signal?: AbortSignal) => {
    const response = await api<{ teams: TeamRecord[] }>('/teams', { signal });
    if (signal?.aborted) return;
    setTeams(response.teams); setTeamError(false);
  }, [api]);

  useEffect(() => {
    const membershipChanged = () => setRevision(value => value + 1);
    const configurationApplied = (event: Event) => {
      const candidate = (event as CustomEvent<{ project: MissionProject }>).detail?.project;
      if (!candidate || candidate.id !== current.current.id) return;
      accept(candidate); setProjects(items => items.map(item => item.id === candidate.id ? summary(candidate) : item));
    };
    window.addEventListener('norte-membership-changed', membershipChanged);
    window.addEventListener('norte:configuration-applied', configurationApplied);
    return () => { window.removeEventListener('norte-membership-changed', membershipChanged); window.removeEventListener('norte:configuration-applied', configurationApplied); };
  }, [accept]);

  useEffect(() => {
    const controller = new AbortController(), request = navigation.current, nextOwner = user?.id || '';
    const alreadyOpen = owner.current === nextOwner && ready.current;
    if (owner.current !== nextOwner) {
      ready.current = false; setActiveProjectId(''); setProjects([]); setTeams([]);
      const empty = createEmptyProject(getStoredLanguage()); current.current = empty; setProject(empty);
    }
    owner.current = nextOwner;
    setLoading(true); setError(''); setTeamError(false); failedOpen.current = '';
    void refreshTeams(controller.signal).catch(reason => {
      if (!controller.signal.aborted) { setTeamError(true); if (!canRetainReadCache(reason)) setTeams([]); }
    });
    void (async () => {
      try {
        const response = await api<{ projects: ProjectSummary[] }>('/projects', { signal: controller.signal });
        if (controller.signal.aborted || request !== navigation.current) return;
        setProjects(response.projects);
        if (alreadyOpen && response.projects.some(item => item.id === current.current.id)) return;
        ready.current = false; setActiveProjectId('');
        if (!response.projects.length) {
          window.localStorage.removeItem(ACTIVE_PROJECT_KEY);
          const empty = createEmptyProject(getStoredLanguage()); current.current = empty; setProject(empty);
          return;
        }
        const storedId = new URLSearchParams(window.location.search).get('project') || window.localStorage.getItem(ACTIVE_PROJECT_KEY);
        const selected = response.projects.find(item => item.id === storedId) || response.projects[0];
        const loaded = await api<{ project: MissionProject }>(`/projects/${selected.id}`, { signal: controller.signal });
        if (!controller.signal.aborted && request === navigation.current) accept(loaded.project);
      } catch (reason) {
        if (controller.signal.aborted || request !== navigation.current) return;
        setError(canRetainReadCache(reason) ? 'load' : 'access');
        if (!canRetainReadCache(reason)) { ready.current = false; setActiveProjectId(''); setProjects([]); }
      } finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [api, user?.id, user?.emailVerifiedAt, revision, refreshTeams, accept]);

  useEffect(() => {
    const restore = () => {
      const id = new URLSearchParams(window.location.search).get('project');
      if (!id || id === current.current.id) return;
      const request = ++navigation.current;
      setLoading(true); ready.current = false;
      void api<{ project: MissionProject }>(`/projects/${encodeURIComponent(id)}`).then(response => {
        if (request === navigation.current) { accept(response.project); setError(''); }
      }).catch(() => { if (request === navigation.current) setError('access'); })
        .finally(() => { if (request === navigation.current) setLoading(false); });
    };
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, [api, accept]);

  async function openProject(id: string) {
    const request = ++navigation.current, startingHash = window.location.hash;
    setOpening(id); setError(''); failedOpen.current = '';
    try {
      const response = await api<{ project: MissionProject }>(`/projects/${id}`);
      if (request !== navigation.current || window.location.hash !== startingHash) return;
      const next = accept(response.project);
      setProjects(items => items.some(item => item.id === next.id) ? items : [summary(next), ...items]);
      const url = new URL(window.location.href);
      url.searchParams.set('project', id);
      url.searchParams.delete('delivery-record');
      url.searchParams.delete('document');
      window.history.replaceState(null, '', url);
      window.location.hash = '#/requirements';
    } catch (reason) {
      if (request !== navigation.current || window.location.hash !== startingHash) return;
      if (!canRetainReadCache(reason)) {
        setProjects(items => items.filter(item => item.id !== id));
        if (current.current.id === id) { ready.current = false; setActiveProjectId(''); }
      }
      failedOpen.current = id; setError(canRetainReadCache(reason) ? 'open' : 'access');
    } finally { if (request === navigation.current) setOpening(''); }
  }

  async function createProject(candidate: MissionProject) {
    const response = await api<{ project: MissionProject }>('/projects', { method: 'POST', body: JSON.stringify(candidate) });
    navigation.current++; const next = accept(response.project);
    setProjects(items => [summary(next), ...items.filter(item => item.id !== next.id)]);
    void refreshTeams().catch(() => setTeamError(true));
    setError(''); failedOpen.current = ''; window.location.hash = '#/requirements';
  }

  async function deleteProject(id: string) {
    await api(`/projects/${id}`, { method: 'DELETE' });
    const remaining = projects.filter(item => item.id !== id); setProjects(remaining);
    if (current.current.id !== id) return;
    navigation.current++; ready.current = false; setActiveProjectId('');
    window.localStorage.removeItem(ACTIVE_PROJECT_KEY);
    const empty = createEmptyProject(language); current.current = empty; setProject(empty);
    if (remaining[0]) { window.localStorage.setItem(ACTIVE_PROJECT_KEY, remaining[0].id); setRevision(value => value + 1); }
  }

  function retry() { if (failedOpen.current) void openProject(failedOpen.current); else setRevision(value => value + 1); }
  return { project, projects, teams, activeProjectId, loading, error, teamError, opening, ready: ready.current && project.id === activeProjectId, openProject, createProject, deleteProject, refreshTeams, retry };
}
