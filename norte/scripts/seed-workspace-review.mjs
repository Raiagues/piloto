/** Explicit local preparation requested for the revised workspace.
 * node norte/scripts/seed-workspace-review.mjs [--check | --help]
 * Uses the normal API; never edits old projects or resets a password.
 * Credentials stay in .runtime/workspace-review-credentials.json (0600).
 */
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
if (process.argv.includes('--help')) {
  console.log('Uso: node norte/scripts/seed-workspace-review.mjs [--check]\n--check verifica o documento sem criar registros. Sem opção, prepara a conta e o projeto no servidor local em execução.');
  process.exit(0);
}
if (process.argv.slice(2).some(argument => argument !== '--check')) throw new Error('Opção desconhecida. Use --help.');
const SOURCE = JSON.parse(readFileSync(join(ROOT, 'novo_teste/projeto/requirements.json'), 'utf8'));
const DOCX = readFileSync(join(ROOT, SOURCE.sourceFile));
const ensure = (ok, message) => { if (!ok) throw new Error(message); };
ensure(createHash('sha256').update(DOCX).digest('hex') === SOURCE.sha256, 'O DOCX mudou. Prepare e revise novamente o JSON antes de importar.');
ensure(SOURCE.requirements.length === 8 && new Set(SOURCE.requirements.map(r => r.id)).size === 8, 'O roteiro do LYLE precisa ter oito requisitos únicos.');

if (process.argv.includes('--check')) {
  console.log(JSON.stringify({ source: SOURCE.sourceFile, sha256: SOURCE.sha256, requirements: SOURCE.requirements.length, comments: SOURCE.requirements.reduce((n, r) => n + r.comments.length, 0), schedule: 'provisional_ecss', verification: 0, execution: 'not_started' }, null, 2));
} else {
  const envPort = existsSync(join(ROOT, '.env')) ? /^PORT=(\d+)$/mu.exec(readFileSync(join(ROOT, '.env'), 'utf8'))?.[1] : null;
  const origin = process.env.NORTE_REVIEW_ORIGIN || `http://127.0.0.1:${process.env.PORT || envPort || 8000}`;
  ensure(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(origin).hostname) || (origin === 'https://norte-r007.onrender.com' && process.env.NORTE_REVIEW_PUBLISH === '1'), 'Use o servidor local ou a publicação autorizada do Norte.');
  const runtime = process.env.NORTE_REVIEW_RUNTIME ? resolve(process.env.NORTE_REVIEW_RUNTIME) : join(ROOT, '.runtime'); mkdirSync(runtime, { recursive: true, mode: 0o700 });
  const credentialsPath = join(runtime, 'workspace-review-credentials.json'), statePath = join(runtime, 'workspace-review-seed-state.json');
  const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : { version: 1, origin, sourceSha256: SOURCE.sha256 };
  ensure(state.origin === origin && state.sourceSha256 === SOURCE.sha256, 'O estado pertence a outro servidor ou documento; não será reutilizado.');
  const save = () => { writeFileSync(statePath, JSON.stringify(state, null, 2), { mode: 0o600 }); chmodSync(statePath, 0o600); };
  let credentials;
  if (existsSync(credentialsPath)) {
    credentials = JSON.parse(readFileSync(credentialsPath, 'utf8'));
    ensure(credentials.purpose === 'norte-workspace-review-v1' && credentials.origin === origin && credentials.password, 'Arquivo de credenciais não reconhecido; preservado.');
  } else {
    const suffix = randomBytes(3).toString('hex');
    credentials = { purpose: 'norte-workspace-review-v1', origin, name: 'Teste Norte', login: `teste_norte_${suffix}`, nickname: `teste_norte_${suffix}`, password: randomBytes(24).toString('base64url'), createdAt: new Date().toISOString() };
    writeFileSync(credentialsPath, JSON.stringify(credentials, null, 2), { mode: 0o600, flag: 'wx' });
  }
  let cookie = '', csrf = '';
  async function api(path, body, method = body === undefined ? 'GET' : 'POST') {
    const response = await fetch(`${origin}/api${path}`, { method, redirect: 'error', signal: AbortSignal.timeout(120_000),
      headers: { origin, ...(cookie ? { cookie } : {}), ...(csrf ? { 'x-csrf-token': csrf } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const cookies = response.headers.getSetCookie(); if (cookies.length) cookie = cookies.map(item => item.split(';')[0]).join('; ');
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(`${method} ${path}: HTTP ${response.status} ${result.error || ''} ${result.message || ''}`), { status: response.status });
    if (result.csrfToken) csrf = result.csrfToken;
    return result;
  }
  try {
    try { await api('/auth/login', { login: credentials.login, password: credentials.password }); }
    catch (error) {
      if (error.status !== 401 || state.registered) throw error;
      await api('/auth/register', { name: credentials.name, login: credentials.login, nickname: credentials.nickname, password: credentials.password });
    }
    state.registered = true; save();
    const { user } = await api('/auth/session');
    ensure(user.accessRole === 'member' && !user.demoAccount, 'A conta precisa ser comum e permanente. Não será rebaixada automaticamente.');
    ensure(!state.userId || state.userId === user.id, 'Identidade diferente do estado salvo; importação interrompida.');
    state.userId = user.id; save();
    const teamName = 'Equipe teste';
    if (!state.teamId) {
      const teams = (await api('/teams')).teams;
      const prior = teams.find(team => team.name === teamName && team.createdBy === user.id);
      state.teamId = prior?.id || (await api('/teams', { name: teamName, description: '' })).team.id; save();
    }
    const team = (await api('/teams')).teams.find(item => item.id === state.teamId);
    ensure(team && team.memberIds.length === 1 && team.memberIds[0] === user.memberId, 'A equipe já mudou; participantes serão preservados e o preparo interrompido.');
    const subsystems = [...new Set(SOURCE.requirements.map(item => item.subsystem))];
    const sectors = subsystems.map((name, index) => ({ id: `lyle-subsystem-${index + 1}`, name }));
    const projectId = state.projectId || `lyle-review-${user.id.slice(0, 8)}`;
    let existing;
    try { existing = (await api(`/projects/${projectId}`)).project; } catch (error) { if (error.status !== 404) throw error; }
    if (!existing) {
      const timestamp = new Date().toISOString();
      const project = { schemaVersion: 2, id: projectId, name: SOURCE.name, createdAt: timestamp, updatedAt: timestamp,
        navigation: { lastRoute: 'requirements' }, phaseProgress: { highestUnlockedStep: 0 }, memoryRevision: 1,
        context: { configured: true, programId: null, modalityId: null, categoryId: null, referenceProgram: 'independent', teamId: state.teamId, teamName,
          teamArtifactIds: [], projectArtifactIds: [], roles: [{ id: 'captain', name: 'Responsável' }, { id: 'manager', name: 'Gestor' }, { id: 'member', name: 'Integrante' }, { id: 'advisor', name: 'Revisor' }],
          sectors, folders: [], assignments: [{ memberId: user.memberId, roleId: 'captain', sectorId: '' }] },
        setup: { intent: 'problem', statement: SOURCE.purpose, framework: 'norte-core', references: [] }, board: { nodes: [], links: [] },
        progress: { mode: 'standard', customCriteria: [] }, studies: [], resolvedIssueKeys: [], templates: { activeTemplateId: 'norte-core-v1', lockedPaths: [] } };
      await api('/projects', project);
    } else ensure(existing.context.teamId === state.teamId && existing.creatorId === user.id, 'O projeto existente não pertence a esta preparação.');
    state.projectId = projectId; save();
    let artifacts = (await api('/artifacts')).artifacts.filter(item => item.scope === 'project' && item.ownerId === projectId);
    async function sourceArtifact(key, input) {
      const label = input.label, prior = artifacts.find(item => item.label === label);
      const artifact = prior || (await api('/artifacts', { ...input, scope: 'project', ownerId: projectId, description: `Fonte fornecida pelo usuário. SHA-256 DOCX: ${SOURCE.sha256}`, tags: ['LYLE', 'fonte-do-projeto'], sourceRole: 'project_context' })).artifact;
      state[key] = artifact.id; save(); return artifact.id;
    }
    const mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    const originalId = await sourceArtifact('originalArtifactId', { kind: 'document', label: 'LYLE · Documento original', fileName: basename(SOURCE.sourceFile), mimeType: mime, size: DOCX.length, url: `data:${mime};base64,${DOCX.toString('base64')}` });
    const documentText = `# ${SOURCE.name}\n\nFonte: ${SOURCE.sourceFile}\nSHA-256: ${SOURCE.sha256}\n\n` + SOURCE.paragraphs.map(item => `## Parágrafo ${item.paragraph}\n\n${item.text}\n\n${item.comments.map(comment => `> Comentário ${comment.id}: ${comment.text}`).join('\n\n')}`).join('\n\n');
    const readableId = await sourceArtifact('readableArtifactId', { kind: 'document', label: 'LYLE · Texto e comentários da fonte', documentText });
    let delivery = await api(`/projects/${projectId}/delivery`);
    const action = async (body) => { delivery = await api(`/projects/${projectId}/delivery/actions`, { ...body, expectedRevision: delivery.revision, expectedBaselineHash: delivery.baselineHash }); };
    if (!delivery.standardsConfigured) await action({ action: 'standards.set', standards: ['nasa-hb', 'mtcr'] });
    for (const item of SOURCE.requirements) {
      const prior = delivery.requirements.find(requirement => requirement.id === item.id);
      if (prior) { ensure(prior.statement === item.statement, `${item.id} já foi editado; nenhuma alteração será sobrescrita.`); continue; }
      await action({ action: 'requirement.save', item: { identifier: item.id, title: item.title, statement: item.statement,
        sectorId: sectors.find(sector => sector.name === item.subsystem).id, method: 'unspecified', level: 'system', ownerId: user.id,
        artifactIds: [originalId, readableId], parentIds: [], sourceRefs: [], entityIds: [], sourceLocator: item.sourceLocator,
        sourceComment: item.comments.map(comment => `Comentário ${comment.id}: ${comment.text}`).join('\n\n') } });
    }
    ensure(!delivery.tests.length, 'A verificação já mudou; seus dados foram preservados.');
    if (!delivery.lifecycle && !delivery.tasks.length) {
      await action({ action: 'lifecycle.configure', profile: 'ecss', startDate: '2026-10-26', durations: [4, 6, 8, 32, 24, 52, 4], selectedReviews: ['MDR', 'PRR', 'SRR', 'PDR', 'CDR', 'TRR', 'QR', 'AR'] });
      for (const [title, startDate, dueDate] of [
        ['Conferir requisitos e comentários de origem', '2026-10-26', '2026-11-06'],
        ['Avaliar aplicabilidade das referências', '2026-11-09', '2026-11-20'],
        ['Definir critérios e responsáveis de verificação', '2026-11-23', '2026-12-04']
      ]) await action({ action: 'task.save', item: { title, startDate, dueDate, kind: 'task', phaseId: '', sectorId: '', ownerId: user.id, status: 'planned', description: 'Planejamento provisório para o ambiente de teste LYLE. Datas e escopo precisam de revisão da equipe; não representam execução nem aprovação.', dependencyIds: [], requirementIds: delivery.requirements.map(r => r.id), testIds: [], inputArtifactIds: [originalId], outputArtifactIds: [] } });
    }
    if (!state.analysisRunId) {
      // This one initial rules check was explicitly requested for the supplied case.
      // It does not start an LLM call or create verification suggestions.
      const { run } = await api(`/projects/${projectId}/delivery/assistant-runs`, { kind: 'requirements', assisted: false });
      state.analysisRunId = run.id; save();
    }
    const deadline = Date.now() + 60_000;
    let run;
    do {
      ({ run } = await api(`/projects/${projectId}/delivery/assistant-runs/${state.analysisRunId}`));
      if (!['queued', 'running'].includes(run.status)) break;
      await new Promise(resolve => setTimeout(resolve, 500));
    } while (Date.now() < deadline);
    ensure(run?.status === 'completed', `Análise inicial ${run?.status || 'indisponível'}; registro preservado para inspeção.`);
    state.completedAt ||= new Date().toISOString(); save();
    console.log(JSON.stringify({ origin, credentialsPath, teamId: state.teamId, projectId, requirements: delivery.requirements.length, schedule: delivery.tasks.length, verification: delivery.tests.length, analysisRunId: state.analysisRunId }, null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
