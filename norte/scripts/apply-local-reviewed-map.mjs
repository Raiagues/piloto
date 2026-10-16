/** Offline publication only. Stop ./start's services before using --apply.
 * node norte/scripts/apply-local-reviewed-map.mjs --apply
 * No network/provider calls, no identity migration and no existing map replacement.
 */
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual, parseEnv } from 'node:util';
import { JsonDataStore } from '../server/data-store.mjs';
import { prepareProjectArtifacts, validateExtractedSystem } from '../server/system-ai.mjs';
import { ACCOUNT, LOCAL_ORIGIN, loadVerifiedCorpus } from './prepare-local-test-account.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const hash = value => createHash('sha256').update(value).digest('hex');
const ensure = (condition, message) => { if (!condition) throw new Error(message); };
async function privateRead(path) {
  const info = await lstat(path);
  ensure(info.isFile() && !info.isSymbolicLink() && (!process.getuid || info.uid === process.getuid()), 'Arquivo local privado inválido; nada será aplicado.');
  ensure((info.mode & 0o077) === 0, 'O arquivo local deve ter permissão 0600 antes da aplicação.');
  return readFile(path);
}

export async function assertLocalJsonConfiguration(root, env = process.env) {
  const configs = [env];
  for (const path of ['.env', '.env.local', 'norte/.env', 'norte/.env.local']) {
    try { configs.push(parseEnv(await readFile(resolve(root, path), 'utf8'))); }
    catch (error) { if (error.code !== 'ENOENT') throw new Error('Não foi possível conferir a configuração local.', { cause: error }); }
  }
  for (const config of configs) {
    ensure(!config.DATABASE_URL && config.NODE_ENV !== 'production' && !config.RENDER, 'Este aplicador é exclusivo do armazenamento JSON local, fora de produção.');
    ensure(!config.NORTE_STORE_FILE || resolve(root, config.NORTE_STORE_FILE) === resolve(root, '.runtime/norte-data.json'), 'O caminho configurado do banco não corresponde ao banco local esperado.');
    ensure(!config.PORT || config.PORT === '8000', 'O site deve usar a porta local esperada.');
    ensure(!config.NORTE_MEETING_PORT || config.NORTE_MEETING_PORT === '8790', 'O serviço privado deve usar a porta local esperada.');
  }
}

/** Holding the launcher's flock prevents ./start while we reserve both ports. */
export async function holdOfflineGuard(runtime) {
  const lockPath = resolve(runtime, 'service.lock');
  try { ensure(!(await lstat(lockPath)).isSymbolicLink(), 'O lock do serviço não pode ser link simbólico.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const child = spawn('python3', ['-c', 'import fcntl,sys; f=open(sys.argv[1],"a"); fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB); print("locked",flush=True); sys.stdin.buffer.read()', lockPath], { stdio: ['pipe', 'pipe', 'ignore'] });
  const reserved = [];
  const release = async () => {
    for (const server of reserved) await new Promise(resolve => server.close(resolve));
    if (child.exitCode === null) await new Promise(resolve => { child.once('exit', resolve); child.stdin.end(); });
  };
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { child.kill(); reject(new Error('Não foi possível bloquear o launcher local.')); }, 5000);
      child.once('error', () => { clearTimeout(timer); reject(new Error('Python não pôde bloquear o launcher local.')); });
      child.once('exit', () => { clearTimeout(timer); reject(new Error('O launcher está ocupado. Aguarde o término de ./stop.')); });
      child.stdout.once('data', bytes => { clearTimeout(timer); if (bytes.toString().trim() === 'locked') resolve(); else reject(new Error('Lock local inválido.')); });
    });
    try {
      const saved = JSON.parse(await readFile(resolve(runtime, 'server.pid'), 'utf8'));
      const number = typeof saved === 'number' ? saved : saved.pid;
      ensure(Number.isSafeInteger(number) && number > 1, 'Registro do serviço inválido; execute ./stop antes de aplicar.');
      let alive = true;
      try { process.kill(number, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; else throw error; }
      ensure(!alive, 'Os serviços locais ainda estão ativos. Execute ./stop antes de aplicar.');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    for (const port of [8000, 8790]) {
      const server = createServer(socket => socket.destroy());
      await new Promise((resolve, reject) => { server.once('error', () => reject(new Error('Uma porta local ainda está ocupada. Execute ./stop e aguarde.'))); server.listen(port, '127.0.0.1', resolve); });
      reserved.push(server);
    }
    return { release, assertHeld: () => ensure(child.exitCode === null && !child.killed && reserved.every(server => server.listening), 'O bloqueio exclusivo foi perdido; nada será aplicado.') };
  } catch (error) { await release(); throw error; }
}

export function validatePreparedPublication(data, payload, session, corpus) {
  ensure(payload?.applied === false && payload.target?.origin === LOCAL_ORIGIN && payload.target.requiresEmptyBaseline === true, 'Payload não corresponde à publicação local revisada.');
  ensure(session?.origin === LOCAL_ORIGIN && session.user?.email === ACCOUNT.email && session.user.nickname === ACCOUNT.nickname && !session.user.demoAccount, 'A conta persistente não foi confirmada.');
  const user = data.users.find(user => user.id === session.user.id && user.active && !user.isDemoAccount && !user.demoSandboxId);
  ensure(user && user.email === ACCOUNT.email && user.nickname === ACCOUNT.nickname && user.accessRole !== 'advisor', 'A conta local não está ativa ou não pode editar.');
  ensure(payload.target.projectId === session.projectId && payload.project?.id === session.projectId, 'O projeto do payload não corresponde à conta preparada.');
  const record = data.workspace.projects?.[session.projectId], project = record?.document;
  ensure(record && record.createdBy === user.id && project.creatorId === user.id && !record.demoSandboxId && !project.demoSandboxId, 'O projeto não pertence exclusivamente à conta local.');
  const team = data.teams.find(team => team.id === session.teamId && team.id === project.context?.teamId);
  ensure(team && team.createdBy === user.id && !team.demoSandboxId && team.memberIds.length === 1 && team.memberIds[0] === user.memberId, 'A equipe mudou ou possui outros participantes.');
  ensure(!project.engineeringSystem, 'O projeto já possui mapa; nenhuma versão será sobrescrita.');
  ensure(record.revision === payload.target.expectedRevision && project.memoryRevision === payload.target.expectedMemoryRevision, 'Conflito: o projeto ou sua memória mudou desde a preparação.');
  const withoutMap = value => {
    const copy = structuredClone(value); delete copy.engineeringSystem; delete copy.systemGeneratedFromRevision; delete copy.phaseProgress; return copy;
  };
  ensure(isDeepStrictEqual(withoutMap(project), withoutMap(payload.project)), 'O payload tenta alterar informações além do mapa revisado.');
  ensure(payload.provenance?.manifestSha256 === corpus.manifestSha256, 'O manifesto mudou desde a preparação.');
  const artifacts = data.artifacts.filter(item => item.ownerId === project.id && item.scope === 'project');
  ensure(artifacts.length === 17 && project.context.projectArtifactIds.length === 17 && project.context.projectArtifactIds.every(id => artifacts.some(item => item.id === id)) && !project.context.teamArtifactIds?.length, 'Os vínculos documentais mudaram.');
  const mappings = payload.provenance.sources;
  ensure(Array.isArray(mappings) && mappings.length === 17 && new Set(mappings.map(item => item.sourceId)).size === 17, 'Proveniência documental incompleta.');
  const report = payload.provenance.report;
  ensure(report?.complete === true && payload.provenance.progress?.coverage === 1, 'O relatório não confirma a leitura completa das fontes.');
  ensure(Array.isArray(report.documents) && report.documents.length === 17 && new Set(report.documents.map(item => item.artifactId)).size === 17 && report.documents.every(item => item.complete === true && artifacts.some(artifact => artifact.id === item.artifactId)), 'O relatório documental não corresponde às fontes atuais concluídas.');
  ensure(Array.isArray(report.omissions) && report.omissions.every(item => item && artifacts.some(artifact => artifact.id === item.artifactId)), 'As omissões do relatório apontam para fontes indisponíveis.');
  for (const { source } of corpus.documents) {
    const artifact = artifacts.find(item => item.fileName === source.id + '.txt'), mapping = mappings.find(item => item.sourceId === source.id);
    ensure(artifact && mapping && artifact.createdBy === user.id && artifact.label === source.title && artifact.sourceRole === source.role && !artifact.demoSandboxId, 'Uma fonte foi substituída ou mudou de proprietário/papel.');
    ensure(mapping.artifactId === artifact.id && mapping.textSha256 === source.text_sha256 && mapping.originalSha256 === source.sha256 && mapping.sourceUrl === source.source_url && mapping.role === source.role, 'A proveniência não corresponde ao documento original.');
    const match = /^data:text\/plain;base64,([A-Za-z0-9+/]+={0,2})$/u.exec(artifact.url || '');
    ensure(match && Buffer.from(match[1], 'base64').toString('base64') === match[1] && hash(Buffer.from(match[1], 'base64')) === source.text_sha256, 'O conteúdo salvo de uma fonte foi alterado.');
  }
  const model = payload.project.engineeringSystem;
  ensure(model?.generatedFromRevision === project.memoryRevision && model.artifactSources?.length === 17 && new Set(model.artifactSources.map(item => item.artifactId)).size === 17 && model.artifactSources.every(item => artifacts.some(artifact => artifact.id === item.artifactId)), 'O mapa não corresponde às fontes e à revisão atuais.');
  ensure(!model.corrections?.length && !model.scenarios?.length, 'O importador não migra decisões ou correções de outra conta.');
  const validated = validateExtractedSystem(model, project, prepareProjectArtifacts(project, artifacts), model.model);
  return { user, project, record, validated };
}

export async function commitPreparedPublication(store, payload, session, corpus, assertUnchanged = async () => {}) {
  return store.update(async data => {
    const { user, project, record, validated } = validatePreparedPublication(data, payload, session, corpus);
    await assertUnchanged();
    const timestamp = new Date().toISOString();
    record.document = { ...project, engineeringSystem: validated, systemGeneratedFromRevision: project.memoryRevision, phaseProgress: { highestUnlockedStep: Math.max(1, project.phaseProgress?.highestUnlockedStep || 0) }, updatedAt: timestamp };
    record.revision++; record.updatedBy = user.id; record.updatedAt = timestamp;
    record.extractionReport = { ...structuredClone(payload.provenance.report || {}), progress: structuredClone(payload.provenance.progress || null), completedAt: timestamp, importedFromReviewedPayload: true };
    record.reviewedMapImport = { appliedAt: timestamp, appliedBy: user.id, payloadSha256: hash(JSON.stringify(payload)), manifestSha256: corpus.manifestSha256, previousRevision: payload.target.expectedRevision, sources: structuredClone(payload.provenance.sources) };
    if (data.projectLearning?.[project.id]) data.projectLearning[project.id].cache = {};
    if (data.workspace.project?.document?.id === project.id) data.workspace.project = record;
    return { applied: true, projectId: project.id, revision: record.revision, memoryRevision: project.memoryRevision, entities: validated.entities.length, relations: validated.relations.length, requirements: validated.requirements.length, evidence: validated.evidence.length, documents: 17, providerCalls: 0 };
  });
}

export async function applyLocalReviewedMap({ apply = false, rootDirectory = ROOT } = {}) {
  await assertLocalJsonConfiguration(rootDirectory);
  const runtime = resolve(rootDirectory, '.runtime'), validation = resolve(runtime, 'validation');
  for (const directory of [runtime, validation]) ensure(!(await lstat(directory)).isSymbolicLink(), 'O diretório local não pode ser link simbólico.');
  const payload = JSON.parse(await privateRead(resolve(validation, 'reviewed-map-payload.json')));
  const session = JSON.parse(await privateRead(resolve(validation, 'reusable-session.json')));
  const corpus = await loadVerifiedCorpus(resolve(rootDirectory, 'project-documents/quetzal-1'));
  const databaseFile = resolve(runtime, 'norte-data.json');
  let guard;
  try {
    if (apply) guard = await holdOfflineGuard(runtime);
    const original = await privateRead(databaseFile), data = JSON.parse(original);
    ensure(data.schemaVersion === 10, 'O formato do banco local mudou; nenhuma migração será feita por este script.');
    validatePreparedPublication(data, payload, session, corpus);
    if (!apply) return { applied: false, valid: true, projectId: session.projectId, message: 'Payload validado. Pare os serviços e use --apply para publicar a versão revisada.' };
    guard.assertHeld();
    const backupDirectory = resolve(validation, 'backups'); await mkdir(backupDirectory, { recursive: true, mode: 0o700 });
    ensure(!(await lstat(backupDirectory)).isSymbolicLink(), 'O diretório de backup não pode ser link simbólico.');
    const backupFile = resolve(backupDirectory, `before-reviewed-map-${randomUUID()}.json`);
    await writeFile(backupFile, original, { flag: 'wx', mode: 0o600 });
    const store = await new JsonDataStore(databaseFile).init();
    const result = await commitPreparedPublication(store, payload, session, corpus, async () => {
      guard.assertHeld();
      ensure(hash(await privateRead(databaseFile)) === hash(original), 'O banco mudou durante a preparação; publicação cancelada.');
    });
    await store.close();
    const report = { ...result, completedAt: new Date().toISOString(), backupFile, payloadSha256: hash(JSON.stringify(payload)), manifestSha256: corpus.manifestSha256 };
    await writeFile(resolve(validation, 'reusable-map-apply-report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    return report;
  } finally { await guard?.release(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    ensure(process.argv.slice(2).every(arg => arg === '--apply'), 'Use somente --apply; destino e arquivos são locais e fixos.');
    console.log(JSON.stringify(await applyLocalReviewedMap({ apply: process.argv.includes('--apply') }), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
