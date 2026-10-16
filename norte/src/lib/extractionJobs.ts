import { ApiError } from "./apiClient";
import { normalizeEngineeringSystem } from "./engineeringSystem";
import type { MissionProject } from "./projectStore";
import type { EngineeringSystemModel } from "./engineeringSystem";

export type ExtractionProgress = { totalDocuments: number; processedDocuments: number; totalChunks: number; completedChunks: number; cachedChunks: number; failedChunks: number; coverage: number };
export type ExtractionDocument = { artifactId: string; label: string; complete: boolean; reason?: string; limitations?: string[]; totalCharacters?: number; coveredCharacters?: number; totalPages?: number; missingPages?: number[]; totalChunks?: number; completedChunks?: number; cachedChunks?: number; activeChunks?: number; stage?: "queued" | "reading" | "completed" | "failed" };
export type ExtractionReport = {
  complete: boolean; needsReview?: boolean; completedAt?: string; progress?: Partial<ExtractionProgress>;
  omissionCount?: number; conflictCount?: number;
  fixtureLabel?: string;
  reviewNotes?: { id: string; title: string; reason: string; artifactIds: string[]; entityId?: string|null }[];
  omissions?: { chunkId: string; artifactId: string; kind: string; id: string; name?: string; reason: string }[];
  warnings?: string[];
  documents?: ExtractionDocument[];
  conflicts?: { reason?: string; kind?: string; key?: string; entityId?: string; requirementId?: string; alternativeId?: string; kept?: unknown; candidate?: unknown }[];
};
export type ExtractionJob = {
  projectId?: string; regenerate?: boolean; autoRun?: boolean; applied?: boolean;
  jobId: string; status: "queued" | "preparing" | "running" | "paused" | "failed" | "completed";
  progress?: ExtractionProgress;
  report?: ExtractionReport;
  error?: { code: string; message: string };
  result?: EngineeringSystemModel | { engineeringSystem: EngineeringSystemModel };
};
type Api = <T>(path: string, init?: RequestInit) => Promise<T>;

/** Only a completed, fully validated job is applied. Pauses never substitute a
 * sample or a partial architecture for the documents that remain unread. */
export async function extractProject({ api, projectId, language, jobId, regenerate = false, onReview, onProgress, onPause, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) }: {
  api: Api; projectId: string; language: "pt" | "en"; jobId?: string; regenerate?: boolean;
  onReview?: (job: ExtractionJob, proposal: EngineeringSystemModel) => Promise<boolean>;
  onProgress: (job: ExtractionJob) => void; onPause: (job: ExtractionJob) => Promise<void>; wait?: (ms: number) => Promise<void>;
}): Promise<{ engineeringSystem: EngineeringSystemModel; project?: MissionProject; regenerated?: boolean } | null> {
  if (regenerate && !onReview) throw new Error("A atualização do mapa exige revisão antes de substituir a versão atual.");
  const payload = { method: "POST", body: JSON.stringify({ projectId, language }) };
  const startPayload = { ...payload, body: JSON.stringify({ projectId, language, ...(regenerate ? { regenerate: true } : {}) }) };
  let job: ExtractionJob;
  try { job = jobId ? await api<ExtractionJob>(`/system-ai/jobs/${encodeURIComponent(jobId)}?projectId=${encodeURIComponent(projectId)}`) : await api<ExtractionJob>("/system-ai/jobs", startPayload); }
  catch (error) {
    if (!(jobId && error instanceof ApiError && error.status === 404)) throw error;
    job = await api<ExtractionJob>("/system-ai/jobs", startPayload);
  }
  for (;;) {
    if (!job.jobId) throw new Error("O serviço não identificou a extração. Tente novamente.");
    onProgress(job);
    if (job.status === "completed") {
      if (regenerate || job.report?.needsReview) {
        if (!onReview) throw new Error("A proposta exige revisão antes de ser aplicada.");
        const candidate = job.result && "engineeringSystem" in job.result ? job.result.engineeringSystem : job.result;
        const proposal = normalizeEngineeringSystem(candidate);
        if (!proposal) throw new Error("A proposta de mapa não está disponível para revisão. A versão atual foi mantida.");
        if (!await onReview(job, proposal)) return null;
      }
      const applyPayload = { ...payload, body: JSON.stringify({ projectId, language, ...(regenerate ? { regenerate: true } : {}), ...(job.report?.needsReview ? { reviewed: true } : {}) }) };
      return api<{ engineeringSystem: EngineeringSystemModel; project?: MissionProject; regenerated?: boolean }>(`/system-ai/jobs/${encodeURIComponent(job.jobId)}/apply`, applyPayload);
    }
    if (job.status === "failed") throw new ApiError(502, job.error?.code || "EXTRACTION_FAILED", job.error?.message || "A extração não foi concluída. Os documentos e os trechos já lidos foram preservados.");
    if (job.status === "paused") {
      await onPause(job);
      job = await api<ExtractionJob>(`/system-ai/jobs/${encodeURIComponent(job.jobId)}/resume`, payload);
    } else {
      await wait(2000);
      job = await api<ExtractionJob>(`/system-ai/jobs/${encodeURIComponent(job.jobId)}?projectId=${encodeURIComponent(projectId)}`);
    }
  }
}


/** Only identifiers are kept in the browser; source documents and maps remain
 * account-scoped on the server. Encoding both IDs prevents ambiguous keys. */
export const extractionJobStorageKey = (userId: string, projectId: string) =>
  `norte-extraction-v2:${encodeURIComponent(userId)}:${encodeURIComponent(projectId)}`;

/** Observe server work without applying a map or changing the current page.
 * Aborting this observer never cancels server work. Reloading may safely attach
 * another observer; only the server owns scheduling and batch continuation. */
export async function observeExtractionJob({ api, projectId, initial, signal, onProgress, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) }: {
  api: Api; projectId: string; initial: ExtractionJob; signal: AbortSignal;
  onProgress: (job: ExtractionJob) => void; wait?: (ms: number) => Promise<void>;
}): Promise<ExtractionJob> {
  let job = initial;
  for (;;) {
    signal.throwIfAborted();
    if (!job.jobId || (job.projectId && job.projectId !== projectId)) throw new Error("A tarefa não pertence a este projeto.");
    onProgress(job);
    if (job.status === "completed" || job.status === "failed" || job.applied) return job;
    if (job.status === "paused") {
      job = await api<ExtractionJob>(`/system-ai/jobs/${encodeURIComponent(job.jobId)}/resume`, {
        method: "POST", signal, body: JSON.stringify({ projectId, autoRun: true })
      });
    } else {
      await wait(2500);
      signal.throwIfAborted();
      job = await api<ExtractionJob>(`/system-ai/jobs/${encodeURIComponent(job.jobId)}?projectId=${encodeURIComponent(projectId)}&summary=true`, { signal });
    }
  }
}

/** Applying a map must preserve edits and navigation made while it was read. */
export function mergeAppliedExtraction(project: MissionProject, engineeringSystem: EngineeringSystemModel): MissionProject {
  return { ...project, engineeringSystem, systemGeneratedFromRevision: engineeringSystem.generatedFromRevision,
    phaseProgress: { highestUnlockedStep: project.phaseProgress.highestUnlockedStep === 2 ? 2 : 1 } };
}

export function extractionRecovery(error: unknown): "gone" | "restart" | "reconnect" {
  if (error instanceof ApiError && [401, 403, 404].includes(error.status)) return "gone";
  if (error instanceof ApiError && error.status === 409) return "restart";
  return "reconnect";
}
