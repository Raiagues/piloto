import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "./apiClient";
import { normalizeEngineeringSystem } from "./engineeringSystem";
import { extractionJobStorageKey, extractionRecovery, observeExtractionJob } from "./extractionJobs";
import type { ExtractionJob } from "./extractionJobs";
import type { EngineeringSystemModel } from "./engineeringSystem";
import type { MissionProject } from "./projectStore";
import type { Language } from "./types";

type Api = <T>(path: string, init?: RequestInit) => Promise<T>;
export type ExtractionTask = { projectId: string; projectName: string; regenerate: boolean; job: ExtractionJob; error?: string; restartRequired?: boolean; applying?: boolean; applied?: boolean };
type Review = { task: ExtractionTask; proposal: EngineeringSystemModel; previous?: EngineeringSystemModel };

function remember(userId: string, task: ExtractionTask) {
  try { window.localStorage.setItem(extractionJobStorageKey(userId, task.projectId), JSON.stringify({ projectId: task.projectId, projectName: task.projectName, jobId: task.job.jobId, regenerate: task.regenerate })); } catch { /* Server discovery works even when local storage is unavailable. */ }
}

export function useExtractionTasks({ api, userId, activeProject, ready, language, applyInSaveQueue, onApplied }: {
  api: Api; userId?: string; activeProject: MissionProject; ready: boolean; language: Language;
  applyInSaveQueue: (projectId: string, operation: () => Promise<void>) => Promise<void>;
  onApplied: (projectId: string, response: { project?: MissionProject; engineeringSystem: EngineeringSystemModel }, previous?: EngineeringSystemModel) => Promise<void>;
}) {
  const [tasks, setTasks] = useState<Record<string, ExtractionTask>>({});
  const [selectedId, setSelectedId] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [review, setReview] = useState<Review | null>(null);
  const observers = useRef(new Map<string, AbortController>());
  const starting = useRef(new Set<string>());
  const taskRef = useRef(tasks); taskRef.current = tasks;
  const userRef = useRef(userId); userRef.current = userId;
  const mounted = useRef(true);
  const discovery = useRef(new Set<string>());

  const observe = useCallback((initial: ExtractionJob, projectId: string, projectName: string, regenerate = false, owner = userId) => {
    if (!mounted.current || !owner || userRef.current !== owner || initial.applied) return;
    const previous = observers.current.get(projectId); previous?.abort();
    const controller = new AbortController(); observers.current.set(projectId, controller);
    const update = (job: ExtractionJob) => {
      if (!mounted.current || controller.signal.aborted || userRef.current !== owner) return;
      const task: ExtractionTask = { projectId, projectName, regenerate: job.regenerate ?? regenerate, job };
      setTasks(current => ({ ...current, [projectId]: task })); remember(owner, task);
    };
    void observeExtractionJob({ api, projectId, initial, signal: controller.signal, onProgress: update }).catch(error => {
      if (!mounted.current || controller.signal.aborted || userRef.current !== owner) return;
      if (extractionRecovery(error) === "gone") {
        setTasks(current => { const next = { ...current }; delete next[projectId]; return next; });
        window.localStorage.removeItem(extractionJobStorageKey(owner, projectId)); return;
      }
      if (extractionRecovery(error) === "restart" && error instanceof ApiError) {
        setTasks(current => current[projectId] ? { ...current, [projectId]: { ...current[projectId], job: { ...current[projectId].job, status: "failed", error: { code: error.code, message: error.message } }, restartRequired: true, error: error.message } } : current);
        return;
      }
      setTasks(current => current[projectId] ? { ...current, [projectId]: { ...current[projectId], error: language === "pt" ? "O progresso está indisponível. Seus documentos foram mantidos; tente reconectar." : "Progress is unavailable. Your documents have been kept; try reconnecting." } } : current);
    }).finally(() => { if (observers.current.get(projectId) === controller) observers.current.delete(projectId); });
  }, [api, userId, language]);

  useEffect(() => {
    const controllers = observers.current; mounted.current = true;
    setTasks({}); setReview(null); setSelectedId(""); setExpanded(false); discovery.current.clear(); starting.current.clear();
    if (userId) {
      const prefix = `norte-extraction-v2:${encodeURIComponent(userId)}:`;
      for (let index = 0; index < window.localStorage.length; index++) {
        const key = window.localStorage.key(index); if (!key?.startsWith(prefix)) continue;
        try {
          const saved = JSON.parse(window.localStorage.getItem(key) || "null");
          if (!saved?.jobId || !saved.projectId) continue;
          discovery.current.add(saved.projectId);
          // Resolve the latest server task: another tab may have replaced the
          // locally remembered one or already approved it.
          void api<{ job: ExtractionJob | null }>(`/system-ai/jobs/latest?projectId=${encodeURIComponent(saved.projectId)}`).then(({ job }) => {
            if (!mounted.current || userRef.current !== userId) return;
            if (!job || job.applied) { window.localStorage.removeItem(key); return; }
            observe(job, saved.projectId, saved.projectName, job.regenerate ?? saved.regenerate, userId);
          }).catch(error => { discovery.current.delete(saved.projectId); if (extractionRecovery(error) === "gone") window.localStorage.removeItem(key); });
        } catch { /* Ignore invalid browser metadata; server discovery is authoritative. */ }
      }
    }
    return () => { mounted.current = false; controllers.forEach(controller => controller.abort()); controllers.clear(); };
    // Language changes update labels without restarting observers or discarding jobs.
  }, [api, userId]);

  useEffect(() => {
    if (!ready || !userId || !activeProject.id || discovery.current.has(activeProject.id)) return;
    const projectId = activeProject.id, owner = userId;
    discovery.current.add(projectId);
    void api<{ job: ExtractionJob | null }>(`/system-ai/jobs/latest?projectId=${encodeURIComponent(projectId)}`).then(({ job }) => {
      if (!mounted.current || !job || job.applied || userRef.current !== owner || starting.current.has(projectId) || observers.current.has(projectId)) return;
      observe(job, projectId, activeProject.name, Boolean(job.regenerate), owner);
    }).catch(() => { discovery.current.delete(projectId); });
  }, [activeProject.id, activeProject.name, api, observe, ready, userId]);

  async function start(project: MissionProject, regenerate = false) {
    if (!userId) return;
    setSelectedId(project.id); setExpanded(true);
    const existing = taskRef.current[project.id];
    if (starting.current.has(project.id) || (existing && !existing.applied && existing.job.status !== "failed")) return;
    starting.current.add(project.id);
    const owner = userId;
    try {
      const job = await api<ExtractionJob>("/system-ai/jobs", { method: "POST", body: JSON.stringify({ projectId: project.id, language, autoRun: true, ...(regenerate ? { regenerate: true } : {}) }) });
      if (mounted.current && userRef.current === owner) observe(job, project.id, project.name, regenerate, owner);
    } finally { starting.current.delete(project.id); }
  }

  async function reconnect(task: ExtractionTask) {
    if (!userId) return;
    const owner = userId;
    try {
      if (task.restartRequired) {
        const response = await api<{ project: MissionProject }>(`/projects/${encodeURIComponent(task.projectId)}`);
        if (mounted.current && userRef.current === owner) await start(response.project, Boolean(response.project.engineeringSystem));
        return;
      }
      const job = await api<ExtractionJob>(`/system-ai/jobs/${encodeURIComponent(task.job.jobId)}?projectId=${encodeURIComponent(task.projectId)}&summary=true`);
      if (!mounted.current || userRef.current !== owner) return;
      const resumed = job.status === "failed" ? await api<ExtractionJob>(`/system-ai/jobs/${encodeURIComponent(job.jobId)}/resume`, { method: "POST", body: JSON.stringify({ projectId: task.projectId, autoRun: true }) }) : job;
      if (mounted.current && userRef.current === owner) observe(resumed, task.projectId, task.projectName, task.regenerate, owner);
    } catch (error) { if (mounted.current && userRef.current === owner) setTasks(current => ({ ...current, [task.projectId]: { ...task, restartRequired: extractionRecovery(error) === "restart", ...(extractionRecovery(error) === "restart" ? { job: { ...task.job, status: "failed" as const } } : {}), error: error instanceof Error ? error.message : "Falha ao reconectar." } })); }
  }

  async function openReview(task: ExtractionTask) {
    const owner = userId;
    try {
      const [job, project] = await Promise.all([
        api<ExtractionJob>(`/system-ai/jobs/${encodeURIComponent(task.job.jobId)}?projectId=${encodeURIComponent(task.projectId)}`),
        api<{ project: MissionProject }>(`/projects/${encodeURIComponent(task.projectId)}`)
      ]);
      if (!mounted.current || userRef.current !== owner) return;
      const proposal = normalizeEngineeringSystem(job.result && "engineeringSystem" in job.result ? job.result.engineeringSystem : job.result);
      if (!proposal || job.status !== "completed") throw new Error(language === "pt" ? "A proposta ainda não está disponível." : "The proposal is not ready yet.");
      setReview({ task: { ...task, job }, proposal, previous: project.project.engineeringSystem });
    } catch (error) { if (mounted.current && userRef.current === owner) setTasks(current => ({ ...current, [task.projectId]: { ...task, restartRequired: extractionRecovery(error) === "restart", ...(extractionRecovery(error) === "restart" ? { job: { ...task.job, status: "failed" as const } } : {}), error: error instanceof Error ? error.message : "Falha ao abrir proposta." } })); }
  }

  async function decide(apply: boolean) {
    const current = review; setReview(null);
    if (!apply || !current || !userId) return;
    const task = current.task, owner = userId;
    setSelectedId(task.projectId);
    setTasks(previous => ({ ...previous, [task.projectId]: { ...task, applying: true, error: undefined } }));
    try {
      await applyInSaveQueue(task.projectId, async () => {
      if (!mounted.current || userRef.current !== owner) return;
      const response = await api<{ project?: MissionProject; engineeringSystem: EngineeringSystemModel }>(`/system-ai/jobs/${encodeURIComponent(task.job.jobId)}/apply`, { method: "POST", body: JSON.stringify({ projectId: task.projectId, language, ...(task.regenerate ? { regenerate: true } : {}), reviewed: true }) });
      if (!mounted.current || userRef.current !== owner) return;
      await onApplied(task.projectId, response, current.previous);
      });
      if (!mounted.current || userRef.current !== owner) return;
      window.localStorage.removeItem(extractionJobStorageKey(owner, task.projectId));
      setTasks(previous => ({ ...previous, [task.projectId]: { ...task, applied: true, applying: false, job: { ...task.job, applied: true } } }));
    } catch (error) {
      if (mounted.current && userRef.current === owner) setTasks(previous => ({ ...previous, [task.projectId]: { ...task, restartRequired: extractionRecovery(error) === "restart", ...(extractionRecovery(error) === "restart" ? { job: { ...task.job, status: "failed" as const } } : {}), error: error instanceof Error ? error.message : "Não foi possível aplicar a proposta." } }));
    }
  }

  const visible = tasks[selectedId] || tasks[activeProject.id] || Object.values(tasks).find(task => !task.applied) || null;
  return { tasks, visible, expanded, setExpanded, select: setSelectedId, review, start, reconnect, openReview, decide };
}
