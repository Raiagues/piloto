/** Local, opt-in account/corpus preparation. Never calls an AI provider or mail API.
 * node norte/scripts/prepare-local-test-account.mjs --apply
 * --import-reviewed-map FILE only PREPARES a validated payload; it does not publish it.
 */
import { chmod, lstat, mkdir, open, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createValidationProject, VALIDATION_PROJECT_ID } from '../server/data-store.mjs';
import { prepareProjectArtifacts, validateExtractedSystem } from '../server/system-ai.mjs';

export const LOCAL_ORIGIN = 'http://127.0.0.1:8000';
export const ACCOUNT = Object.freeze({ name: 'Conta de teste Norte', email: 'teste@norte.local', nickname: 'teste_norte' });
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const MARKER = '# Norte local test account v1';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const ensure = (condition, message) => { if (!condition) throw new Error(message); };

export function optionsFromArgs(args) {
  const options = { apply: false, importReviewedMap: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--apply') options.apply = true;
    else if (args[i] === '--import-reviewed-map' && args[i + 1] && !args[i + 1].startsWith('--')) options.importReviewedMap = resolve(args[++i]);
    else throw new Error('Use --apply e, opcionalmente, --import-reviewed-map ARQUIVO. O destino é fixo: ' + LOCAL_ORIGIN);
  }
  ensure(!options.importReviewedMap || options.apply, 'A preparação do mapa exige --apply e uma conta local já preparada.');
  return options;
}

export async function loadVerifiedCorpus(directory) {
  const base = await realpath(directory), manifestBytes = await readFile(resolve(base, 'manifest.json'));
  const manifest = JSON.parse(manifestBytes), selected = manifest.sources?.filter(source => ['project_context', 'supporting_datasheet'].includes(source.role));
  ensure(selected?.length === 17, 'O manifesto deve conter exatamente 17 fontes públicas de projeto/componentes.');
  ensure(new Set(selected.map(source => source.id)).size === selected.length, 'Identidades duplicadas no manifesto.');
  const checkedFile = async (path, hash) => {
    ensure(typeof path === 'string' && !/evaluation|benchmark/iu.test(path), 'Fonte de avaliação não pode entrar na memória.');
    const file = await realpath(resolve(base, path));
    ensure(file.startsWith(base + sep), 'O documento deve permanecer dentro do corpus local.');
    const bytes = await readFile(file);
    ensure(/^[a-f0-9]{64}$/u.test(hash || '') && sha(bytes) === hash, 'Hash de documento divergente; confira o corpus antes de importar.');
    return bytes;
  };
  const documents = [];
  for (const source of selected) {
    ensure(/^[a-z0-9][a-z0-9-]{0,110}$/u.test(source.id), 'Identidade de fonte inválida.');
    const url = new URL(source.source_url);
    ensure(url.protocol === 'https:' && !url.username && !url.password && ['raw.githubusercontent.com', 'gomspace.com', 'www.ti.com', 'ww1.microchip.com'].includes(url.hostname), 'Origem documental não reconhecida.');
    await checkedFile(source.path, source.sha256);
    const bytes = await checkedFile(source.text_path, source.text_sha256);
    if (source.pages_path) await checkedFile(source.pages_path, source.pages_sha256);
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    ensure(text.trim() && !text.includes('\0'), 'Texto documental inválido.');
    documents.push({ source, bytes, text });
  }
  return { manifestSha256: sha(manifestBytes), documents };
}

async function safeFile(path) {
  try {
    const info = await lstat(path);
    ensure(info.isFile() && !info.isSymbolicLink(), 'Recusado arquivo de estado não regular.');
    ensure(!process.getuid || info.uid === process.getuid(), 'O arquivo de estado pertence a outro usuário.');
    await chmod(path, 0o600);
    return true;
  } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
async function privateWrite(path, value, exclusive = false) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n';
  if (exclusive) return writeFile(path, text, { mode: 0o600, flag: 'wx' });
  await safeFile(path);
  const temporary = path + '.' + randomBytes(8).toString('hex') + '.tmp';
  await writeFile(temporary, text, { mode: 0o600, flag: 'wx' });
  await rename(temporary, path);
}

export function localApi({ session, fetchImpl = fetch, origin = LOCAL_ORIGIN }) {
  ensure(origin === LOCAL_ORIGIN, 'Este script aceita somente ' + LOCAL_ORIGIN);
  return async (path, body, method = body === undefined ? 'GET' : 'POST', binary = false) => {
    ensure(/^\/[a-zA-Z0-9/?=&._%-]+$/u.test(path) && !decodeURIComponent(path).includes('..') && !path.startsWith('//'), 'Rota local inválida.');
    const response = await fetchImpl(origin + '/api' + path, {
      method, redirect: 'error', signal: AbortSignal.timeout(60_000),
      headers: { origin, ...(session.cookie ? { cookie: session.cookie } : {}), ...(session.csrfToken ? { 'x-csrf-token': session.csrfToken } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    if (!response.ok) {
      const value = await response.json().catch(() => ({}));
      throw Object.assign(new Error(`A API recusou ${method} ${path.split('?')[0]}: HTTP ${response.status} (${String(value.error || 'REQUEST_FAILED').replace(/[^A-Z0-9_]/gu, '').slice(0, 80)}). Nenhuma conta existente será substituída.`), { status: response.status });
    }
    const cookie = response.headers.get('set-cookie');
    if (cookie) session.cookie = cookie.split(';')[0];
    if (binary) return Buffer.from(await response.arrayBuffer());
    return response.status === 204 ? null : response.json();
  };
}

function accountMatches(user, saved) {
  ensure(user && !user.demoAccount && user.email === ACCOUNT.email && user.nickname === ACCOUNT.nickname && (!saved?.id || saved.id === user.id), 'A sessão não pertence à conta local preparada por este script.');
}
function ownedTeam(team, user) {
  return team?.membership === 'member' && team.createdBy === user.id && team.canManage && team.memberIds.length === 1 && team.memberIds[0] === user.memberId;
}
function emptyProject(project) {
  return !project.engineeringSystem && !(project.context?.projectArtifactIds?.length) && !(project.context?.teamArtifactIds?.length) && !(project.board?.nodes?.length) && !(project.board?.links?.length) && !(project.studies?.length) && !project.setup?.statement;
}

export function reviewedMapPayload(input, { project, revision, artifacts, corpus }) {
  ensure(!project.engineeringSystem, 'O projeto já possui mapa; não sobrescrever correções ou versões existentes.');
  const model = structuredClone(input.result?.engineeringSystem || input.result || input.engineeringSystem || input);
  const byOld = new Map(), mapping = [];
  ensure(Array.isArray(model.artifactSources) && model.artifactSources.length === corpus.documents.length, 'O mapa deve declarar todas as 17 fontes do corpus, sem fontes adicionais.');
  for (const previous of model.artifactSources) {
    const matches = corpus.documents.filter(({ source }) => previous.artifactId === source.id || previous.artifactId.endsWith('-' + source.id));
    ensure(matches.length === 1, 'Não foi possível identificar uma fonte do mapa pelo manifesto.');
    const { source } = matches[0], current = artifacts.find(item => item.fileName === source.id + '.txt');
    ensure(current && current.scope === 'project' && current.ownerId === project.id && current.label === source.title && current.sourceRole === source.role && sha(current.verifiedBytes) === source.text_sha256, 'Fonte de destino não corresponde ao documento verificado.');
    ensure(!mapping.some(item => item.sourceId === source.id), 'O mapa repete uma fonte do corpus.');
    byOld.set(previous.artifactId, current.id);
    mapping.push({ sourceId: source.id, previousArtifactId: previous.artifactId, artifactId: current.id, textSha256: source.text_sha256, originalSha256: source.sha256, sourceUrl: source.source_url, role: source.role });
    previous.artifactId = current.id;
  }
  for (const evidence of model.evidence || []) {
    ensure(byOld.has(evidence.artifactId), 'Evidência aponta para fonte ausente no mapa.');
    evidence.artifactId = byOld.get(evidence.artifactId);
  }
  ensure(input.report?.complete === true && input.progress?.coverage === 1, 'O mapa revisado precisa do relatório completo e da cobertura de leitura integral.');
  const report = structuredClone(input.report);
  ensure(Array.isArray(report.documents) && report.documents.length === corpus.documents.length && new Set(report.documents.map(item => item.artifactId)).size === corpus.documents.length, 'O relatório deve identificar todas as fontes do corpus uma única vez.');
  if (report.omissions === undefined) report.omissions = [];
  ensure(Array.isArray(report.omissions), 'A lista de omissões do relatório é inválida.');
  // Only document references change: chunk/object IDs remain the original audit identifiers.
  for (const entries of [report.documents, report.omissions]) for (const item of entries) {
    ensure(item && typeof item === 'object' && byOld.has(item.artifactId), 'O relatório aponta para uma fonte ausente no mapa.');
    item.artifactId = byOld.get(item.artifactId);
  }
  const inline = artifacts.map(item => ({ ...item, url: 'data:text/plain;base64,' + item.verifiedBytes.toString('base64') }));
  const validated = validateExtractedSystem(model, project, prepareProjectArtifacts(project, inline), model.model);
  return {
    preparedAt: new Date().toISOString(), applied: false, target: { origin: LOCAL_ORIGIN, projectId: project.id, expectedRevision: revision, expectedMemoryRevision: project.memoryRevision, requiresEmptyBaseline: true },
    provenance: { manifestSha256: corpus.manifestSha256, inputSha256: sha(JSON.stringify(input)), sources: mapping, originalGeneratedAt: model.generatedAt, report, progress: structuredClone(input.progress), reviewNote: 'Payload preparado para revisão explícita. Não atesta revisão humana nem publica o mapa.' },
    project: { ...project, engineeringSystem: validated, systemGeneratedFromRevision: project.memoryRevision, phaseProgress: { highestUnlockedStep: Math.max(1, project.phaseProgress?.highestUnlockedStep || 0) } }
  };
}

export async function prepareLocalTestAccount({ apply = false, importReviewedMap = null, rootDirectory = ROOT, fetchImpl = fetch } = {}) {
  const corpus = await loadVerifiedCorpus(resolve(rootDirectory, 'project-documents/quetzal-1'));
  if (!apply) return { applied: false, origin: LOCAL_ORIGIN, documents: corpus.documents.length, message: 'Plano verificado. Use --apply para preparar somente a conta local; nenhuma chamada de IA será feita.' };
  const runtime = resolve(rootDirectory, '.runtime'), validation = resolve(runtime, 'validation');
  for (const directory of [runtime, validation]) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    ensure(!(await lstat(directory)).isSymbolicLink(), 'Diretório de estado não pode ser link simbólico.');
  }
  const lockPath = resolve(validation, 'reusable-account.lock');
  const lock = await open(lockPath, 'wx', 0o600).catch(error => {
    if (error.code === 'EEXIST') throw new Error('Há outra preparação em andamento ou um bloqueio interrompido. Confira o processo antes de remover .runtime/validation/reusable-account.lock.');
    throw error;
  });
  try {
  const credentialsFile = resolve(runtime, 'conta-teste.txt'), stateFile = resolve(validation, 'reusable-session.json');
  const hasCredentials = await safeFile(credentialsFile), hasState = await safeFile(stateFile);
  ensure(!hasState || hasCredentials, 'A sessão existe sem o arquivo original de credenciais; não redefinir senha.');
  let password;
  if (hasCredentials) {
    const text = await readFile(credentialsFile, 'utf8');
    ensure(text.startsWith(MARKER + '\n') && text.includes('Endereço: ' + LOCAL_ORIGIN) && text.includes('E-mail: ' + ACCOUNT.email), 'Arquivo de credenciais não reconhecido; não será sobrescrito.');
    password = /^Senha: ([A-Za-z0-9_-]{32,128})$/mu.exec(text)?.[1];
    ensure(password, 'Senha local ausente ou inválida; não será redefinida.');
  } else {
    password = randomBytes(32).toString('base64url');
    await privateWrite(credentialsFile, `${MARKER}\nEndereço: ${LOCAL_ORIGIN}\nE-mail: ${ACCOUNT.email}\nNickname: ${ACCOUNT.nickname}\nSenha: ${password}\n\nEntre com e-mail e senha; não use o botão de conta demonstrativa para esta conta persistente.\n`, true);
  }
  const state = hasState ? JSON.parse(await readFile(stateFile, 'utf8')) : { version: 1, origin: LOCAL_ORIGIN, email: ACCOUNT.email, nickname: ACCOUNT.nickname, createdAt: new Date().toISOString(), registrationAttempted: false, artifacts: {} };
  ensure(state.version === 1 && state.origin === LOCAL_ORIGIN && state.email === ACCOUNT.email && state.nickname === ACCOUNT.nickname, 'Estado local incompatível; não será reutilizado.');
  const persist = () => privateWrite(stateFile, state), api = localApi({ session: state, fetchImpl });
  let auth;
  if (state.cookie) { try { auth = await api('/auth/session'); } catch (error) { if (error.status !== 401) throw error; } }
  if (!auth?.user) {
    if (!state.registrationAttempted) {
      state.registrationAttempted = true; await persist();
      auth = await api('/auth/register', { ...ACCOUNT, password });
    } else auth = await api('/auth/login', { email: ACCOUNT.email, password });
  }
  accountMatches(auth.user, state.user);
  state.user = auth.user; state.csrfToken = auth.csrfToken; await persist();
  const teams = (await api('/teams')).teams, memberships = teams.filter(team => team.membership === 'member');
  let team = state.teamId ? teams.find(team => team.id === state.teamId) : memberships[0];
  ensure(!state.teamId || team, 'A equipe preparada foi removida; não recriá-la silenciosamente.');
  ensure(memberships.length <= 1 && (!team || ownedTeam(team, auth.user)), 'A conta possui equipe compartilhada ou alterada; preservar os dados e interromper.');
  if (!team) team = (await api('/teams', { name: 'Equipe de teste Norte', description: 'Ambiente local persistente de validação Quetzal-1.' })).team;
  ensure(ownedTeam(team, auth.user), 'A equipe deve conter somente o criador da conta.');
  state.teamId = team.id; await persist();
  const summaries = (await api('/projects')).projects;
  ensure(summaries.length <= 1, 'A conta contém outros projetos; não alterar nem criar duplicatas.');
  let projectEnvelope;
  const plannedId = 'quetzal-local-test-' + auth.user.id;
  if (summaries.length) {
    const candidate = summaries[0];
    ensure(candidate.teamId === team.id && (!state.projectId || candidate.id === state.projectId), 'O projeto existente não corresponde à equipe preparada.');
    projectEnvelope = await api('/projects/' + candidate.id);
    ensure(projectEnvelope.project.creatorId === auth.user.id, 'O projeto pertence a outra conta.');
    if (!state.projectId) ensure(candidate.id === plannedId || (candidate.id === VALIDATION_PROJECT_ID && emptyProject(projectEnvelope.project)), 'O projeto inicial contém dados; não será reutilizado automaticamente.');
  } else {
    ensure(!state.projectId, 'O projeto preparado foi removido; não recriá-lo silenciosamente.');
    const project = createValidationProject();
    Object.assign(project, { id: plannedId, name: 'Quetzal-1 — teste local' });
    Object.assign(project.context, { teamId: team.id, teamName: team.name, assignments: [{ memberId: auth.user.memberId, roleId: 'captain', sectorId: '' }] });
    projectEnvelope = await api('/projects', project);
  }
  state.projectId = projectEnvelope.project.id; await persist();
  let artifacts = (await api('/artifacts')).artifacts.filter(item => item.ownerId === state.projectId);
  ensure(artifacts.every(item => item.scope === 'project' && corpus.documents.some(({ source }) => item.fileName === source.id + '.txt')), 'O projeto contém arquivos não preparados por este importador; preservar e interromper.');
  ensure(new Set(artifacts.map(item => item.fileName)).size === artifacts.length, 'Arquivos duplicados no projeto; não escolher nem remover silenciosamente.');
  if (projectEnvelope.project.engineeringSystem) ensure(artifacts.length === corpus.documents.length, 'O mapa existente não pode receber documentos automaticamente.');
  const verified = [];
  for (const { source, bytes } of corpus.documents) {
    let artifact = artifacts.find(item => item.fileName === source.id + '.txt');
    if (!artifact) {
      artifact = (await api('/artifacts', { kind: 'document', label: source.title, sourceRole: source.role, scope: 'project', ownerId: state.projectId, fileName: source.id + '.txt', mimeType: 'text/plain', size: bytes.length, url: 'data:text/plain;base64,' + bytes.toString('base64'), tags: ['norte-local-test'], description: `Fonte: ${source.source_url}\nPapel: ${source.role}\nSHA-256 texto: ${source.text_sha256}\nOriginal e licença: manifesto local Quetzal-1.` })).artifact;
    }
    const uploaded = await api('/artifacts/' + artifact.id + '/content', undefined, 'GET', true);
    ensure(sha(uploaded) === source.text_sha256 && artifact.sourceRole === source.role && artifact.label === source.title, 'O documento salvo foi alterado; nenhuma correção automática será feita.');
    state.artifacts[source.id] = { id: artifact.id, textSha256: source.text_sha256, originalSha256: source.sha256, sourceRole: source.role, sourceUrl: source.source_url };
    verified.push({ ...artifact, verifiedBytes: uploaded }); await persist();
  }
  projectEnvelope = await api('/projects/' + state.projectId);
  ensure(projectEnvelope.project.context.projectArtifactIds.length === corpus.documents.length && projectEnvelope.project.context.projectArtifactIds.every(id => verified.some(item => item.id === id)), 'Os vínculos do projeto mudaram durante a preparação.');
  state.manifestSha256 = corpus.manifestSha256; state.preparedAt = new Date().toISOString(); await persist();
  await privateWrite(resolve(validation, 'reusable-import-report.json'), { origin: LOCAL_ORIGIN, userId: state.user.id, teamId: state.teamId, projectId: state.projectId, documents: state.artifacts, manifestSha256: corpus.manifestSha256, preparedAt: state.preparedAt, providerCalls: 0 });
  if (importReviewedMap) {
    const input = JSON.parse(await readFile(importReviewedMap, 'utf8'));
    if (input.status) ensure(input.status === 'completed' && input.report?.complete && input.progress?.coverage === 1, 'A extração ainda não está completa; não preparar um mapa parcial.');
    const payload = reviewedMapPayload(input, { ...projectEnvelope, artifacts: verified, corpus });
    await privateWrite(resolve(validation, 'reviewed-map-payload.json'), payload);
  }
  return { applied: true, origin: LOCAL_ORIGIN, documents: verified.length, teamId: state.teamId, projectId: state.projectId, credentialsFile, sessionFile: stateFile, mapPayloadPrepared: Boolean(importReviewedMap), mapApplied: false, providerCalls: 0 };
  } finally { await lock.close(); await unlink(lockPath); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await prepareLocalTestAccount(optionsFromArgs(process.argv.slice(2))), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
