/** Complete, bounded source traversal. A checkpoint is not a verified final map. */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { clearImmediate, setImmediate } from "node:timers";
import { mergeChunkModels } from "./merge-source-models.mjs";

export const EXTRACTION_PROMPT_VERSION = "long-documents-v3";
export const CHUNK_CHARACTERS = 32_000;
export const hashValue = (value) => createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
const failure = (code, message, statusCode = 422) => Object.assign(new Error(message), { code, statusCode });

/** Offset ranges overlap, but their union covers every source character. */
export function documentChunks(parsed, { chunkCharacters = CHUNK_CHARACTERS, overlap = 600 } = {}) {
  if (!Number.isInteger(chunkCharacters) || chunkCharacters < 1000 || chunkCharacters > 64_000 || overlap < 0 || overlap >= chunkCharacters / 2) throw new Error("Invalid chunk size");
  const chunks = [];
  for (const source of parsed) {
    if (!source.text) continue;
    for (let start = 0; start < source.text.length;) {
      let end = Math.min(source.text.length, start + chunkCharacters);
      if (end < source.text.length) {
        const boundary = source.text.lastIndexOf("\n", end);
        if (boundary > start + chunkCharacters / 2) end = boundary + 1;
      }
      const text = source.text.slice(start, end);
      const pages = (source.pages || []).filter((page) => page.end >= start && page.start < end).map((page) => page.page);
      const sha256 = hashValue({ artifactId: source.source.artifactId, start, end, text });
      chunks.push({ id: `chunk-${sha256.slice(0,24)}`, artifactId: source.source.artifactId, source, start, end, pages, text, sha256 });
      if (end === source.text.length) break;
      start = end - overlap;
    }
  }
  return chunks;
}

export function sourceCoverage(parsed, chunks, completed) {
  return parsed.map((source) => {
    const selected = chunks.filter((chunk) => chunk.artifactId === source.source.artifactId);
    const finished = selected.filter((chunk) => completed.has(chunk.id));
    let covered = 0, end = 0;
    for (const range of finished.sort((a,b) => a.start - b.start)) { covered += Math.max(0, range.end - Math.max(end, range.start)); end = Math.max(end, range.end); }
    return { artifactId: source.source.artifactId, label: source.source.artifactLabel, status: source.source.status, totalCharacters: source.text?.length || 0, coveredCharacters: covered, totalPages: source.pages?.length || 0, missingPages: source.missingPages || [], totalChunks: selected.length, completedChunks: finished.length, complete: selected.length > 0 && finished.length === selected.length && !(source.missingPages?.length), ...(source.sparseLayout ? { limitations: ["Disposição gráfica detectada: texto lido integralmente, mas fios, setas, geometria e conectividade exigem revisão visual do original."] } : {}), ...(source.source.reason ? { reason: source.source.reason } : {}) };
  });
}

/** Only previously verified evidence can supply a fragment's parent context. */
export function fragmentContext(models, maxCharacters = 12_000, chunk) {
  const entities = [], evidence = [];
  const input = `${chunk?.source?.source?.artifactLabel || ""} ${chunk?.text || ""}`.toLocaleLowerCase("en-US");
  const reference = chunk?.source?.role === "supporting_datasheet";
  const relevant = (entity) => input.includes(entity.name.toLocaleLowerCase("en-US")) || (entity.name.match(/\b[a-z]+[a-z0-9-]*\d[a-z0-9-]*\b/giu) || []).some((part) => part.length >= 4 && input.includes(part.toLocaleLowerCase("en-US")));
  const parents = new Set();
  for (const model of models) for (const entity of model.entities.filter(relevant)) {
    let parentId = entity.parentId;
    const visited = new Set();
    while (parentId && !visited.has(parentId)) { visited.add(parentId); parents.add(`${model.id}:${parentId}`); parentId = model.entities.find((parent) => parent.id === parentId)?.parentId; }
  }
  const candidates = models.flatMap((model) => model.entities.filter((entity) => ["system", "subsystem", "component"].includes(entity.kind)).map((entity) => ({ model, entity }))).sort((a,b) => {
    const score = ({ model, entity }) => reference
      ? entity.kind === "system" ? 0 : relevant(entity) || parents.has(`${model.id}:${entity.id}`) ? 1 : entity.kind === "subsystem" ? 2 : 3
      : entity.kind === "system" ? 0 : entity.kind === "subsystem" ? 1 : input.includes(entity.name.toLocaleLowerCase("en-US")) ? 2 : 3;
    return score(a) - score(b);
  });
  for (const { model, entity } of candidates) {
    if (entities.some((e) => e.name === entity.name && e.kind === entity.kind)) continue;
    const quoted = model.evidence.filter((item) => entity.evidenceRefs.includes(item.id)).map((item) => ({ ...item, id: `ctx-${hashValue([item.artifactId,item.excerpt]).slice(0,20)}` }));
    const next = { id: entity.id, name: entity.name, kind: entity.kind, parentId: entity.parentId, evidenceRefs: quoted.map((item) => item.id) };
    const unique = quoted.filter((item) => !evidence.some((e) => e.id === item.id));
    if (JSON.stringify({ entities: [...entities,next], evidence: [...evidence,...unique] }).length > maxCharacters) continue;
    entities.push(next); evidence.push(...unique);
    if (entities.length >= 40) break;
  }
  return { entities, evidence };
}

async function atomicJson(path, value) {
  await mkdir(join(path, ".."), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
  await rename(temporary, path);
}

/** Scope is part of every cache key; verified excerpts never cross accounts. */
export function createLongDocumentJobs(options) {
  const jobs = new Map(), starts = new Map(), pending = new Set();
  const maxChunksPerRun = Math.max(1, Math.min(200, Math.floor(Number(options.maxChunksPerRun) || 24)));
  const concurrency = Math.max(1, Math.min(2, Math.floor(Number(options.concurrency) || 2)));
  const cacheDirectory = options.cacheDirectory;
  const capacityWaiters = [];
  let activeCalls = 0, closed = false;
  const assertOpen = () => { if (closed) throw failure("EXTRACTION_INTERRUPTED", "O processamento foi pausado durante a reinicialização."); };
  function track(operation) {
    pending.add(operation);
    operation.then(() => pending.delete(operation), () => pending.delete(operation));
    return operation;
  }
  // The bound covers every job in this service, not just one browser request.
  async function limited(job, operation) {
    if (activeCalls >= concurrency) await new Promise(resolve => capacityWaiters.push(resolve));
    else activeCalls++;
    try {
      if (closed) throw failure("EXTRACTION_INTERRUPTED", "O processamento foi pausado durante a reinicialização.");
      await job.assertAuthorized?.();
      assertOpen();
      return await operation();
    } finally {
      const next = capacityWaiters.shift();
      if (next) next(); else activeCalls--;
    }
  }
  function view(job, { summary = false } = {}) {
    // Never clone the (potentially large) final graph for a progress poll.
    return structuredClone({ jobId: job.id, projectId: job.project.id, status: job.status, autoRun: job.autoRun, progress: job.progress, createdAt: job.createdAt, updatedAt: job.updatedAt,
      ...(job.report ? { report: summary ? { ...job.report, omissions: undefined, conflicts: undefined, omissionCount: job.report.omissions?.length || 0, conflictCount: job.report.conflicts?.length || 0 } : job.report } : {}),
      ...(job.error ? { error: job.error } : {}), ...(!summary && job.status === "completed" ? { result: job.result } : {}) });
  }
  function owned(id, scopeKey) {
    const job = jobs.get(id);
    if (!job || job.scopeKey !== scopeKey) throw failure("EXTRACTION_JOB_NOT_FOUND", "Extração não encontrada.", 404);
    return job;
  }
  const checkpointPath = (scopeKey, id) => join(cacheDirectory, "jobs", `${hashValue(scopeKey).slice(0,24)}-${id}.json`);
  function checkpoint(job) {
    return track((async () => {
      job.updatedAt = new Date().toISOString();
      await options.onProgress?.(view(job, { summary: true }));
      // Inputs remain in the project datastore; only bounded metadata/progress and
      // a completed result live here. Verified chunks already have atomic files.
      if (cacheDirectory) await atomicJson(checkpointPath(job.scopeKey, job.id), { ...view(job), checkpointVersion: 2, scopeKey: job.scopeKey, fingerprint: job.fingerprint, model: options.model, language: job.language });
    })());
  }
  function progress(job) {
    const chunks = job.chunks || [];
    const documents = sourceCoverage(job.parsed || [], chunks, job.completed).map(document => {
      const selected = chunks.filter(chunk => chunk.artifactId === document.artifactId);
      const activeChunks = selected.filter(chunk => job.active.has(chunk.id)).length;
      const cachedChunks = selected.filter(chunk => job.cached.has(chunk.id)).length;
      const failedChunks = selected.filter(chunk => job.failed.has(chunk.id)).length;
      return { ...document, activeChunks, cachedChunks, failedChunks,
        stage: document.complete ? "completed" : activeChunks ? "reading" : failedChunks || document.status === "not_parsed" ? "failed" : document.completedChunks ? "reading" : "queued" };
    });
    const totalChunks = chunks.length;
    job.progress = { totalDocuments: documents.length, processedDocuments: documents.filter(d => d.complete).length, totalChunks, completedChunks: job.completed.size, activeChunks: job.active.size, cachedChunks: job.cached.size, failedChunks: job.failed.size, coverage: totalChunks ? job.completed.size / totalChunks : 0 };
    const omissions = [...job.reviews.entries()].flatMap(([chunkId, review]) => review.omissions.map(item => ({ chunkId, artifactId: chunks.find(chunk => chunk.id === chunkId)?.artifactId, ...item })));
    const omissionWarning = omissions.length === 1 ? "1 citação ou afirmação foi omitida" : `${omissions.length} citações ou afirmações foram omitidas`;
    job.report = { version: EXTRACTION_PROMPT_VERSION, complete: documents.length > 0 && documents.every(d => d.complete || d.status === "metadata_only"), needsReview: omissions.length > 0 || Boolean(job.conflicts?.length) || documents.some(d => d.limitations?.length), omissions, documents, conflicts: job.conflicts || [], warnings: ["Cobertura indica trechos processados, não garantia de perfeição da interpretação. Esquemas, tabelas e informações ambíguas exigem conferência.", ...(omissions.length ? [`${omissionWarning} por falta de comprovação após duas tentativas. Revise as fontes: o mapa contém apenas a parte verificável.`] : [])] };
  }
  function schedule(job) {
    if (job.running || job.scheduled || closed) return;
    job.scheduled = setImmediate(() => {
      job.scheduled = false;
      if (closed) return;
      job.execution = track(run(job).catch(() => { job.status = "failed"; job.error = { code: "CHECKPOINT_WRITE_FAILED", message: "Não foi possível salvar o progresso da extração." }; }));
    });
  }
  async function run(job) {
    if (job.running || closed) return;
    job.running = true;
    delete job.error;
    job.failed.clear();
    try {
      await job.assertAuthorized?.();
      job.status = "preparing";
      await checkpoint(job);
      if (!job.parsed) {
        job.parsed = await options.prepare(job.project, job.artifacts);
        job.chunks = documentChunks(job.parsed, options);
        progress(job);
      }
      const unread = job.parsed.filter(source => source.source.status === "not_parsed" || source.missingPages?.length);
      if (unread.length) throw failure("SYSTEM_DOCUMENT_UNREADABLE", "Há documentos ou páginas sem leitura completa. Confira a cobertura, aplique OCR ou corrija o arquivo e inicie outra extração.");
      if (!job.chunks.length) throw failure("SYSTEM_MEMORY_INSUFFICIENT", "Conecte um documento legível à memória do projeto.");
      job.status = "running";
      await checkpoint(job);
      let requested = 0;
      while (!closed && job.completed.size < job.chunks.length && (job.autoRun || requested < maxChunksPerRun)) {
        await job.assertAuthorized?.();
        const pending = job.chunks.filter(chunk => !job.completed.has(chunk.id));
        const referenceStage = pending[0]?.source.role === "supporting_datasheet";
        // Mission evidence always precedes manufacturer references. Batch size
        // stays deterministic, keeping the existing context/cache keys stable.
        const allowance = Math.min(concurrency, maxChunksPerRun - requested % maxChunksPerRun);
        const batch = pending.filter(chunk => (chunk.source.role === "supporting_datasheet") === referenceStage).slice(0, allowance);
        batch.forEach(chunk => job.active.add(chunk.id));
        progress(job);
        await checkpoint(job);
        const outcomes = await Promise.allSettled(batch.map(async chunk => {
          const context = fragmentContext([...job.fragments.values()], 12_000, chunk);
          const key = hashValue({ scope: job.scopeKey, project: job.project.id, projectContext: job.project.context, model: options.model, prompt: EXTRACTION_PROMPT_VERSION, feedback: job.feedback, language: job.language, chunk: chunk.sha256, context });
          let model, review, cached = false;
          if (cacheDirectory) {
            try {
              const raw = JSON.parse(await readFile(join(cacheDirectory, "chunks", `${key}.json`), "utf8"));
              if (raw.key === key) { model = await options.validateCached(raw.model, job.project, chunk, context); review = raw.review; cached = true; }
            } catch { /* A corrupt/stale checkpoint is never accepted as evidence. */ }
          }
          if (!model) {
            const extracted = await limited(job, () => options.extractChunk(job.project, chunk, context, job.language, job.feedback));
            model = extracted?.review ? extracted.model : extracted;
            review = extracted?.review;
            if (cacheDirectory) await atomicJson(join(cacheDirectory, "chunks", `${key}.json`), { key, model, ...(review ? { review } : {}) });
          }
          return { chunk, model, review, cached };
        }));
        requested += batch.length;
        let error;
        for (const [index, outcome] of outcomes.entries()) {
          job.active.delete(batch[index].id);
          if (outcome.status === "rejected") { job.failed.add(batch[index].id); error ||= outcome.reason; continue; }
          const { chunk, model, review, cached } = outcome.value;
          job.fragments.set(chunk.id, model);
          if (review?.omissions?.length) job.reviews.set(chunk.id, review);
          job.completed.add(chunk.id);
          if (cached) job.cached.add(chunk.id);
        }
        progress(job);
        await checkpoint(job);
        if (error) throw error;
        if (job.autoRun && requested % maxChunksPerRun === 0) await new Promise(resolve => setImmediate(resolve));
      }
      if (job.completed.size < job.chunks.length) job.status = "paused";
      else {
        await job.assertAuthorized?.();
        const assembled = mergeChunkModels(job.project, job.chunks.map(chunk => ({ id: chunk.id, model: job.fragments.get(chunk.id) })));
        job.conflicts = assembled.conflicts;
        progress(job);
        job.result = await options.validateFinal(assembled.model, job.project, job.parsed);
        job.status = "completed";
      }
    } catch (error) {
      job.status = closed ? "paused" : "failed";
      job.error = { code: error.code || "SYSTEM_EXTRACTION_FAILED", message: error.message || "A extração falhou; os trechos já validados foram preservados." };
      progress(job);
    } finally {
      job.active.clear();
      try { await checkpoint(job); }
      finally { job.running = false; }
    }
  }
  async function identity(project, artifacts, language, scopeKey) {
    const feedback = await options.feedbackContext?.(project) || null;
    // Navigation and edits elsewhere in the UI do not create a new extraction.
    const sourceProject = { id: project.id, name: project.name, memoryRevision: project.memoryRevision || 0, context: project.context, setup: project.setup };
    return { feedback, fingerprint: hashValue({ scopeKey, project: sourceProject, artifacts, language, feedback, model: options.model, prompt: EXTRACTION_PROMPT_VERSION }) };
  }
  function makeJob(project, artifacts, language, settings, signature, id = randomUUID()) {
    const job = { id, project: structuredClone(project), artifacts: structuredClone(artifacts), language, scopeKey: settings.scopeKey, autoRun: settings.autoRun === true, assertAuthorized: settings.assertAuthorized, ...signature, status: "queued", progress: { totalDocuments: artifacts.length, processedDocuments: 0, totalChunks: 0, completedChunks: 0, activeChunks: 0, cachedChunks: 0, failedChunks: 0, coverage: 0 }, completed: new Set(), fragments: new Map(), reviews: new Map(), cached: new Set(), failed: new Set(), active: new Set(), createdAt: new Date().toISOString() };
    job.report = { complete: false, documents: artifacts.map(artifact => ({ artifactId: artifact.id, label: artifact.label || artifact.fileName || "Documento", complete: false, totalChunks: 0, completedChunks: 0, activeChunks: 0, cachedChunks: 0, stage: "queued" })), omissions: [], conflicts: [], warnings: [] };
    return job;
  }
  return {
    async start(project, artifacts, language = "en", { scopeKey = project.id, autoRun = false, assertAuthorized } = {}) {
      assertOpen();
      const signature = await identity(project, artifacts, language, scopeKey);
      assertOpen();
      // Concurrent HTTP starts share both the durable write and the same job id.
      if (starts.has(signature.fingerprint)) return starts.get(signature.fingerprint);
      const operation = (async () => {
        const existing = [...jobs.values()].find(job => job.fingerprint === signature.fingerprint);
        if (existing) {
          if (autoRun) existing.autoRun = true;
          if (assertAuthorized) existing.assertAuthorized = assertAuthorized;
          if (["failed", "paused"].includes(existing.status)) { await existing.execution; assertOpen(); if (["failed", "paused"].includes(existing.status)) { existing.status = "queued"; await checkpoint(existing); schedule(existing); } }
          return view(existing);
        }
        if (jobs.size >= 100) {
          const oldest = [...jobs.values()].find(job => !job.running && !job.scheduled);
          if (oldest) jobs.delete(oldest.id); else throw failure("EXTRACTION_BUSY", "Há extrações em andamento; tente novamente em instantes.", 429);
        }
        const job = makeJob(project, artifacts, language, { scopeKey, autoRun, assertAuthorized }, signature);
        jobs.set(job.id, job);
        await checkpoint(job);
        schedule(job);
        return view(job);
      })();
      starts.set(signature.fingerprint, operation);
      try { return await operation; } finally { starts.delete(signature.fingerprint); }
    },
    job(id, { scopeKey, summary = false } = {}) { return view(owned(id, scopeKey), { summary }); },
    async restore(id, project, artifacts, language = "en", { scopeKey = project.id, autoRun = false, assertAuthorized } = {}) {
      assertOpen();
      if (jobs.has(id)) return view(owned(id, scopeKey));
      if (!cacheDirectory || !/^[a-zA-Z0-9-]{1,100}$/u.test(id)) return null;
      let saved;
      try { saved = JSON.parse(await readFile(checkpointPath(scopeKey, id), "utf8")); }
      catch (error) { if (["ENOENT", "SyntaxError"].includes(error.code || error.name)) return null; throw error; }
      const signature = await identity(project, artifacts, language, scopeKey);
      assertOpen();
      if (saved.checkpointVersion !== 2 || saved.jobId !== id || saved.projectId !== project.id || saved.scopeKey !== scopeKey || saved.fingerprint !== signature.fingerprint || saved.model !== options.model) return null;
      const job = makeJob(project, artifacts, language, { scopeKey, autoRun: autoRun || saved.autoRun, assertAuthorized }, signature, id);
      Object.assign(job, { status: ["completed", "failed"].includes(saved.status) ? saved.status : "paused", createdAt: saved.createdAt, updatedAt: saved.updatedAt, progress: saved.progress, report: saved.report, ...(saved.result ? { result: saved.result } : {}), ...(saved.error ? { error: saved.error } : {}) });
      if (job.status === "completed") {
        // A private checkpoint is still only a cache. Revalidate the graph and
        // quotations against current full sources before exposing it, for free.
        await assertAuthorized?.();
        const parsed = await options.prepare(project, artifacts);
        try {
          if (!saved.report?.complete) throw new Error("Incomplete source coverage");
          job.result = await options.validateFinal(saved.result, project, parsed);
          job.result.generatedAt = saved.result.generatedAt;
        }
        catch { throw failure("EXTRACTION_CHECKPOINT_UNAVAILABLE", "O mapa salvo precisa ser validado novamente. Inicie outra extração para reutilizar os trechos válidos.", 409); }
        await assertAuthorized?.();
      }
      assertOpen();
      jobs.set(id, job);
      // A restart revalidates cached fragments against the same inputs. Failures
      // stay stopped until the user retries; successful completion costs no call.
      if (job.autoRun && ["queued", "preparing", "running", "paused"].includes(saved.status)) { job.status = "queued"; schedule(job); }
      return view(job);
    },
    async resume(id, { scopeKey, autoRun, assertAuthorized } = {}) {
      assertOpen();
      const job = owned(id, scopeKey);
      if (typeof autoRun === "boolean") job.autoRun = autoRun;
      if (assertAuthorized) job.assertAuthorized = assertAuthorized;
      if (["paused", "failed"].includes(job.status)) { await job.execution; assertOpen(); if (["paused", "failed"].includes(job.status)) { job.status = "queued"; await checkpoint(job); schedule(job); } }
      return view(job);
    },
    async close() {
      closed = true;
      for (const job of jobs.values()) if (job.scheduled) { clearImmediate(job.scheduled); job.scheduled = false; }
      // A terminal status is visible before its final durable write. Drain that
      // write and its progress callback before the app closes the datastore.
      while (pending.size || starts.size) await Promise.allSettled([...pending, ...starts.values()]);
    }
  };
}
