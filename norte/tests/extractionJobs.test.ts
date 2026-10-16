import { describe, expect, it } from "vitest";
import { extractProject } from "../src/lib/extractionJobs";
import { ApiError } from "../src/lib/apiClient";

describe("document extraction job workflow", () => {
  it("reads every batch and applies only the completed map after explicit continuation", async () => {
    const requests: string[] = [], progress: string[] = [];
    let paused = false;
    const queue = [
      { jobId: "j1", status: "running" },
      { jobId: "j1", status: "paused", progress: { completedChunks: 8, totalChunks: 18 } },
      { jobId: "j1", status: "running" },
      { jobId: "j1", status: "completed" },
      { engineeringSystem: { id: "verified-map" } }
    ];
    const result = await extractProject({ projectId: "p1", language: "pt", api: async <T>(path: string) => { requests.push(path); if (path.endsWith("/resume")) expect(paused).toBe(true); return queue.shift() as T; }, onProgress: job => progress.push(job.status), onPause: async () => { paused = true; expect(requests.some(path => path.endsWith("/apply"))).toBe(false); }, wait: async () => {} });
    expect(result!.engineeringSystem.id).toBe("verified-map");
    expect(progress).toEqual(["running", "paused", "running", "completed"]);
    expect(requests.at(-1)).toBe("/system-ai/jobs/j1/apply");
  });
  it("does not apply partial output or hide provider failures", async () => {
    const requests: string[] = [];
    await expect(extractProject({ projectId: "p1", language: "pt", api: async <T>(path: string) => { requests.push(path); return { jobId: "j1", status: "failed", error: { code: "SOURCE_UNREADABLE", message: "A página 120 não foi lida." } } as T; }, onProgress() {}, onPause: async () => {}, wait: async () => {} })).rejects.toThrow("A página 120 não foi lida.");
    expect(requests).toEqual(["/system-ai/jobs"]);
  });
  it("restarts an expired job through its existing cache without leaking another account's job", async () => {
    const requests: string[] = [];
    const result = await extractProject({ projectId: "p1", language: "pt", jobId: "expired", api: async <T>(path: string) => {
      requests.push(path);
      if (path.includes("expired")) throw new ApiError(404, "EXTRACTION_NOT_FOUND", "Not found");
      return (path.endsWith("/apply") ? { engineeringSystem: { id: "new-map" } } : { jobId: "new", status: "completed" }) as T;
    }, onProgress() {}, onPause: async () => {}, wait: async () => {} });
    expect(result!.engineeringSystem.id).toBe("new-map");
    expect(requests).toEqual(["/system-ai/jobs/expired?projectId=p1", "/system-ai/jobs", "/system-ai/jobs/new/apply"]);
  });
});

const proposalModel = { schemaVersion: 1, id: "proposed", name: "Proposta", entities: [], relations: [], requirements: [], evidence: [], artifactSources: [], generatedAt: "2026-10-15T10:00:00Z", generatedFromRevision: 3 } as const;
describe("explicit map replacement", () => {
  it("does not start regeneration without a review callback", async () => {
    let called = false;
    await expect(extractProject({ projectId: "p", language: "pt", regenerate: true, api: async <T>() => { called = true; return {} as T; }, onProgress() {}, onPause: async () => {} })).rejects.toThrow("revisão");
    expect(called).toBe(false);
  });
  it("keeps the current map when the person cancels the completed proposal", async () => {
    const paths: string[] = [];
    const result = await extractProject({ projectId: "p", language: "pt", regenerate: true, api: async <T>(path: string, init?: RequestInit) => { paths.push(path); expect(JSON.parse(String(init?.body)).regenerate).toBe(true); return { jobId: "replace", status: "completed", result: proposalModel } as T; }, onProgress() {}, onPause: async () => {}, onReview: async (_job, model) => { expect(model.id).toBe("proposed"); expect(paths).toEqual(["/system-ai/jobs"]); return false; } });
    expect(result).toBeNull(); expect(paths).toEqual(["/system-ai/jobs"]);
  });
  it("requires affirmative review before apply and marks both regeneration and omissions as reviewed", async () => {
    const requests: { path: string; input: Record<string, unknown> }[] = []; let reviewed = false;
    await extractProject({ projectId: "p", language: "pt", regenerate: true, api: async <T>(path: string, init?: RequestInit) => {
      requests.push({ path, input: JSON.parse(String(init?.body)) });
      if (path.endsWith("/apply")) { expect(reviewed).toBe(true); return { engineeringSystem: proposalModel } as T; }
      return { jobId: "replace", status: "completed", result: { engineeringSystem: proposalModel }, report: { complete: true, needsReview: true, omissions: [] } } as T;
    }, onProgress() {}, onPause: async () => {}, onReview: async () => { reviewed = true; expect(requests.length).toBe(1); return true; } });
    expect(requests[1]).toEqual({ path: "/system-ai/jobs/replace/apply", input: { projectId: "p", language: "pt", regenerate: true, reviewed: true } });
  });
  it("requires review for an initial map with omissions and never silently applies it", async () => {
    let applied = false;
    await expect(extractProject({ projectId: "p", language: "pt", api: async <T>(path: string) => { applied ||= path.endsWith("/apply"); return { jobId: "initial", status: "completed", result: proposalModel, report: { complete: true, needsReview: true } } as T; }, onProgress() {}, onPause: async () => {} })).rejects.toThrow("revisão");
    expect(applied).toBe(false);
  });
  it("surfaces a baseline conflict after review without retrying an overwrite", async () => {
    const paths: string[] = [];
    await expect(extractProject({ projectId: "p", language: "pt", regenerate: true, api: async <T>(path: string) => { paths.push(path); if (path.endsWith("/apply")) throw new ApiError(409, "SYSTEM_BASELINE_CHANGED", "O mapa foi editado em outra aba."); return { jobId: "replace", status: "completed", result: proposalModel } as T; }, onProgress() {}, onPause: async () => {}, onReview: async () => true })).rejects.toThrow("O mapa foi editado em outra aba.");
    expect(paths).toEqual(["/system-ai/jobs", "/system-ai/jobs/replace/apply"]);
  });
});

describe("initial extraction with reviewable omissions", () => {
  it("applies only after review and sends reviewed without pretending this is regeneration", async () => {
    let approved = false; const inputs: Record<string, unknown>[] = [];
    const result = await extractProject({ projectId: "p", language: "pt", api: async <T>(path: string, init?: RequestInit) => {
      inputs.push(JSON.parse(String(init?.body)));
      if (path.endsWith("/apply")) { expect(approved).toBe(true); return { engineeringSystem: proposalModel } as T; }
      return { jobId: "initial", status: "completed", result: proposalModel, report: { complete: true, needsReview: true } } as T;
    }, onProgress() {}, onPause: async () => {}, onReview: async () => { approved = true; return true; } });
    expect(result!.engineeringSystem.id).toBe("proposed"); expect(inputs[1]).toEqual({ projectId: "p", language: "pt", reviewed: true });
  });
});

import { extractionJobStorageKey, extractionRecovery, mergeAppliedExtraction, observeExtractionJob } from "../src/lib/extractionJobs";
import { createEmptyProject } from "../src/lib/projectStore";
import type { ExtractionJob } from "../src/lib/extractionJobs";
import type { EngineeringSystemModel } from "../src/lib/engineeringSystem";

describe("background observation", () => {
  it("continues old paused jobs automatically, polls compact summaries, and never applies a completed proposal", async () => {
    const calls: { path: string; body?: string }[] = [], statuses: string[] = [];
    const queue: ExtractionJob[] = [{ jobId: "j", projectId: "p", status: "running" }, { jobId: "j", projectId: "p", status: "completed" }];
    await observeExtractionJob({ projectId: "p", initial: { jobId: "j", status: "paused" }, signal: new AbortController().signal, onProgress: job => statuses.push(job.status), wait: async () => {}, api: async <T>(path: string, init?: RequestInit) => { calls.push({ path, body: init?.body as string }); return queue.shift() as T; } });
    expect(JSON.parse(calls[0].body!)).toEqual({ projectId: "p", autoRun: true });
    expect(calls.map(call => call.path)).toEqual(["/system-ai/jobs/j/resume", "/system-ai/jobs/j?projectId=p&summary=true"]);
    expect(statuses).toEqual(["paused", "running", "completed"]);
  });
  it("detaches an old account observer before its response can enter another account's state", async () => {
    const controller = new AbortController(), seen: string[] = [];
    const promise = observeExtractionJob({ projectId: "p", initial: { jobId: "j", status: "running" }, signal: controller.signal, onProgress: job => seen.push(job.status), wait: async () => {}, api: async <T>() => { controller.abort(); return { jobId: "j", status: "completed" } as T; } });
    await expect(promise).rejects.toThrow();
    expect(seen).toEqual(["running"]);
  });
  it("does not treat a failed document as a completed map or start another paid job", async () => {
    let called = false;
    const failed: ExtractionJob = { jobId: "j", status: "failed", error: { code: "SOURCE_UNREADABLE", message: "Source unavailable" } };
    const job = await observeExtractionJob({ projectId: "p", initial: failed, signal: new AbortController().signal, onProgress() {}, api: async <T>() => { called = true; return {} as T; } });
    expect(job).toBe(failed); expect(called).toBe(false);
  });
  it("refuses a different project's job before publishing any state", async () => {
    let published = false;
    await expect(observeExtractionJob({ projectId: "p", initial: { jobId: "j", projectId: "other", status: "completed" }, signal: new AbortController().signal, onProgress() { published = true; }, api: async <T>() => ({} as T) })).rejects.toThrow("projeto");
    expect(published).toBe(false);
  });
  it("keeps task pointers isolated by both account and project", () => {
    expect(extractionJobStorageKey("a", "project")).not.toBe(extractionJobStorageKey("b", "project"));
    expect(extractionJobStorageKey("a:b", "c")).not.toBe(extractionJobStorageKey("a", "b:c"));
  });
  it("adds the approved map without replacing newer edits, memory or navigation", () => {
    const project = createEmptyProject("pt"); project.name = "Edited while reading"; project.navigation.lastRoute = "setup"; project.memoryRevision = 7; project.setup.statement = "A newer user note";
    const next = mergeAppliedExtraction(project, proposalModel as unknown as EngineeringSystemModel);
    expect(next.engineeringSystem?.id).toBe("proposed"); expect(next.phaseProgress.highestUnlockedStep).toBe(1);
    expect(next.navigation).toBe(project.navigation); expect(next.setup).toBe(project.setup); expect(next.memoryRevision).toBe(7); expect(next.name).toBe(project.name);
  });
});


describe("extraction recovery", () => {
  it("requires a deliberate new reading for changed sources instead of reconnecting in a loop", () => {
    expect(extractionRecovery(new ApiError(409, "PROJECT_MEMORY_CHANGED", "As fontes mudaram."))).toBe("restart");
    expect(extractionRecovery(new ApiError(409, "EXTRACTION_CHECKPOINT_UNAVAILABLE", "Checkpoint indisponível."))).toBe("restart");
  });
  it("distinguishes a connection failure from revoked access", () => {
    expect(extractionRecovery(new ApiError(503, "API_UNAVAILABLE", "Indisponível"))).toBe("reconnect");
    expect(extractionRecovery(new TypeError("Failed to fetch"))).toBe("reconnect");
    expect(extractionRecovery(new ApiError(403, "FORBIDDEN", "Acesso revogado"))).toBe("gone");
  });
});
