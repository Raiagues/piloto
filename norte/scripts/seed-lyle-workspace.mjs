/** Explicit preparation of the LYLE case inside an existing account (the administrator by default).
 * node norte/scripts/seed-lyle-workspace.mjs [--check | --help]
 * Uses the normal API with the account's own credentials: never registers accounts,
 * resets passwords, deletes data or overwrites edited records. No AI provider is called.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync, renameSync } from 'node:fs';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const HELP = `Uso: node norte/scripts/seed-lyle-workspace.mjs [--check]

Prepara na conta indicada a equipe "Equipe LYLE", o projeto Veículo Orbital LYLE, os oito requisitos
com os comentários do DOCX, a checagem por regras (sem IA), um cronograma provisório ECSS, os rascunhos
SRR derivados dos requisitos e as três reuniões já avaliadas do PDF de transcrições.

  --check                     confere as fontes sem acessar o servidor
  NORTE_REVIEW_ORIGIN         servidor (padrão: http://127.0.0.1:PORT do .env ou 8000)
  NORTE_REVIEW_PUBLISH=1      necessário para usar https://norte-r007.onrender.com
  NORTE_SEED_CREDENTIALS      arquivo privado com Login e Senha da conta (padrão: .runtime/norte-admin-credentials.txt)
  NORTE_SEED_ROLE             papel exigido da conta (padrão: owner_admin; use "any" para outra conta)

Os requisitos só podem ser gravados com NORTE_DELIVERY_READ_ONLY desativado no servidor durante o preparo.`;
if (process.argv.includes('--help')) { console.log(HELP); process.exit(0); }
if (process.argv.slice(2).some(argument => argument !== '--check')) throw new Error('Opção desconhecida. Use --help.');

const ensure = (ok, message) => { if (!ok) throw new Error(message); };
const sha = buffer => createHash('sha256').update(buffer).digest('hex');
const SOURCE = JSON.parse(readFileSync(join(ROOT, 'novo_teste/projeto/requirements.json'), 'utf8'));
const DOCX = readFileSync(join(ROOT, SOURCE.sourceFile)), PDF_PATH = 'novo_teste/LYLE_transcricoes_com_alertas.pdf', PDF = readFileSync(join(ROOT, PDF_PATH));
const BUNDLE = JSON.parse(readFileSync(join(ROOT, 'novo_teste/resultados/reunioes/artefatos/lyle-meetings-seed.json'), 'utf8'));
ensure(sha(DOCX) === SOURCE.sha256, 'O DOCX mudou. Prepare e revise novamente o JSON antes de importar.');
ensure(SOURCE.requirements.length === 8 && new Set(SOURCE.requirements.map(r => r.id)).size === 8, 'O roteiro do LYLE precisa ter oito requisitos únicos.');
ensure(BUNDLE.schema === 'norte.lyle-evaluation-import.v1' && BUNDLE.meetings?.length === 3 && BUNDLE.meetings.every(m => m.run?.status === 'done' && m.source?.sha256 === sha(PDF)), 'O pacote das reuniões não corresponde ao PDF de transcrições.');
const meetingTitle = item => item.title.replace(/^Resultado de teste · /u, '');

if (process.argv.includes('--check')) {
  console.log(JSON.stringify({ requirements: SOURCE.requirements.length, comments: SOURCE.requirements.reduce((n, r) => n + r.comments.length, 0), meetings: BUNDLE.meetings.map(m => ({ title: meetingTitle(m), events: m.run.meeting_events.length, transcript: m.run.transcript.length })), documents: ['REQ', 'RTM'], schedule: 'provisional_ecss', providerCalls: 0 }, null, 2));
  process.exit(0);
}

const envPort = existsSync(join(ROOT, '.env')) ? /^PORT=(\d+)$/mu.exec(readFileSync(join(ROOT, '.env'), 'utf8'))?.[1] : null;
const origin = process.env.NORTE_REVIEW_ORIGIN || `http://127.0.0.1:${process.env.PORT || envPort || 8000}`;
ensure(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(origin).hostname) || (origin === 'https://norte-r007.onrender.com' && process.env.NORTE_REVIEW_PUBLISH === '1'), 'Use o servidor local ou a publicação autorizada do Norte (NORTE_REVIEW_PUBLISH=1).');
const runtime = process.env.NORTE_REVIEW_RUNTIME ? resolve(process.env.NORTE_REVIEW_RUNTIME) : join(ROOT, '.runtime'); mkdirSync(runtime, { recursive: true, mode: 0o700 });
// Accepts the private JSON format or the "Login: … / Senha: …" text written at provisioning.
function credentials(path) {
  ensure(existsSync(path), `Arquivo de credenciais ausente: ${path}`);
  const raw = readFileSync(path, 'utf8');
  try { const value = JSON.parse(raw); if (value.login && value.password) return { login: value.login, password: value.password }; } catch { /* text format */ }
  const field = label => raw.split(/\r?\n/u).map(line => new RegExp(`^${label}\\s*:\\s*(.+)$`, 'iu').exec(line.trim())?.[1]?.trim()).find(Boolean);
  const login = field('Login') || field('Nickname') || field('E-mail') || field('Email'), password = field('Senha inicial') || field('Senha') || field('Password');
  ensure(login && password, 'O arquivo de credenciais não tem Login e Senha reconhecíveis.');
  return { login, password };
}
const account = credentials(resolve(process.env.NORTE_SEED_CREDENTIALS || join(runtime, 'norte-admin-credentials.txt')));
const requiredRole = process.env.NORTE_SEED_ROLE || 'owner_admin';
const statePath = join(runtime, `lyle-workspace-seed-${sha(Buffer.from(origin)).slice(0, 10)}.json`);
const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : { version: 1, origin, sourceSha256: SOURCE.sha256, meetings: {} };
ensure(state.origin === origin && state.sourceSha256 === SOURCE.sha256, 'O estado pertence a outro servidor ou documento; não será reutilizado.');
const save = () => { const temporary = statePath + '.tmp'; writeFileSync(temporary, JSON.stringify(state, null, 2), { mode: 0o600 }); chmodSync(temporary, 0o600); renameSync(temporary, statePath); };

let cookie = '', csrf = '';
async function api(path, body, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(`${origin}/api${path}`, { method, redirect: 'error', signal: AbortSignal.timeout(120_000),
    headers: { origin, ...(cookie ? { cookie } : {}), ...(csrf ? { 'x-csrf-token': csrf } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const cookies = response.headers.getSetCookie(); if (cookies.length) cookie = cookies.map(item => item.split(';')[0]).join('; ');
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(`${method} ${path.split('?')[0]}: HTTP ${response.status} ${result.code || result.error || ''} ${result.message || ''}`.trim()), { status: response.status, code: result.code || result.error });
  if (result.csrfToken) csrf = result.csrfToken;
  return result;
}

try {
  await api('/auth/login', { login: account.login, password: account.password });
  const { user } = await api('/auth/session');
  ensure(requiredRole === 'any' || user.accessRole === requiredRole, `A conta precisa ter o papel ${requiredRole}; nada foi alterado.`);
  ensure(!state.userId || state.userId === user.id, 'Identidade diferente do estado salvo; preparo interrompido.');
  state.userId = user.id; save();

  const teamName = 'Equipe LYLE';
  if (!state.teamId) {
    const prior = (await api('/teams')).teams.find(team => team.name === teamName && team.createdBy === user.id);
    state.teamId = prior?.id || (await api('/teams', { name: teamName, description: 'Veículo Orbital LYLE: requisitos, revisões e reuniões do caso fornecido.' })).team.id; save();
  }
  ensure((await api('/teams')).teams.some(team => team.id === state.teamId), 'A equipe do preparo não está mais disponível para esta conta.');
  const subsystems = [...new Set(SOURCE.requirements.map(item => item.subsystem))];
  const sectors = subsystems.map((name, index) => ({ id: `lyle-subsystem-${index + 1}`, name }));
  const projectId = state.projectId || `lyle-${user.id.slice(0, 8)}`;
  let existing;
  try { existing = (await api(`/projects/${projectId}`)).project; } catch (error) { if (error.status !== 404) throw error; }
  if (!existing) {
    const timestamp = new Date().toISOString();
    await api('/projects', { schemaVersion: 2, id: projectId, name: SOURCE.name, createdAt: timestamp, updatedAt: timestamp,
      navigation: { lastRoute: 'requirements' }, phaseProgress: { highestUnlockedStep: 0 }, memoryRevision: 1,
      context: { configured: true, programId: null, modalityId: null, categoryId: null, referenceProgram: 'independent', teamId: state.teamId, teamName,
        teamArtifactIds: [], projectArtifactIds: [], roles: [{ id: 'captain', name: 'Responsável' }, { id: 'manager', name: 'Gestor' }, { id: 'member', name: 'Integrante' }, { id: 'advisor', name: 'Revisor' }],
        sectors, folders: [], assignments: [{ memberId: user.memberId, roleId: 'captain', sectorId: '' }] },
      setup: { intent: 'problem', statement: SOURCE.purpose, framework: 'norte-core', references: [] }, board: { nodes: [], links: [] },
      progress: { mode: 'standard', customCriteria: [] }, studies: [], resolvedIssueKeys: [], templates: { activeTemplateId: 'norte-core-v1', lockedPaths: [] } });
  } else ensure(existing.context.teamId === state.teamId, 'O projeto existente não pertence a esta preparação.');
  state.projectId = projectId; save();

  let artifacts = (await api('/artifacts')).artifacts.filter(item => item.scope === 'project' && item.ownerId === projectId);
  async function sourceArtifact(key, input) {
    const prior = artifacts.find(item => item.label === input.label);
    const artifact = prior || (await api('/artifacts', { ...input, scope: 'project', ownerId: projectId, tags: ['LYLE', 'fonte-do-projeto'], sourceRole: 'project_context' })).artifact;
    if (!prior) artifacts.push(artifact);
    state[key] = artifact.id; save(); return artifact.id;
  }
  const docx = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const originalId = await sourceArtifact('originalArtifactId', { kind: 'document', label: 'LYLE · Documento original', description: `Fonte fornecida pelo usuário. SHA-256: ${SOURCE.sha256}`, fileName: basename(SOURCE.sourceFile), mimeType: docx, size: DOCX.length, url: `data:${docx};base64,${DOCX.toString('base64')}` });
  const documentText = `# ${SOURCE.name}\n\nFonte: ${SOURCE.sourceFile}\nSHA-256: ${SOURCE.sha256}\n\n` + SOURCE.paragraphs.map(item => `## Parágrafo ${item.paragraph}\n\n${item.text}\n\n${item.comments.map(comment => `> Comentário ${comment.id}: ${comment.text}`).join('\n\n')}`).join('\n\n');
  const readableId = await sourceArtifact('readableArtifactId', { kind: 'document', label: 'LYLE · Texto e comentários da fonte', description: `Leitura do DOCX fornecido. SHA-256: ${SOURCE.sha256}`, documentText });
  await sourceArtifact('transcriptsArtifactId', { kind: 'document', label: 'LYLE · Transcrições das reuniões', description: `PDF de transcrições fornecido pelo usuário. SHA-256: ${sha(PDF)}`, fileName: basename(PDF_PATH), mimeType: 'application/pdf', size: PDF.length, url: `data:application/pdf;base64,${PDF.toString('base64')}` });

  let delivery = await api(`/projects/${projectId}/delivery`);
  ensure(!delivery.permissions.readOnly, 'O servidor está com NORTE_DELIVERY_READ_ONLY=1. Desative temporariamente para gravar os requisitos e reative depois.');
  const action = async body => { delivery = await api(`/projects/${projectId}/delivery/actions`, { ...body, expectedRevision: delivery.revision, expectedBaselineHash: delivery.baselineHash }); };
  if (!delivery.standardsConfigured) await action({ action: 'standards.set', standards: ['nasa-hb', 'mtcr'] });
  for (const item of SOURCE.requirements) {
    const prior = delivery.requirements.find(requirement => requirement.id === item.id);
    if (prior) { ensure(prior.statement === item.statement, `${item.id} já foi editado; nenhuma alteração será sobrescrita.`); continue; }
    await action({ action: 'requirement.save', item: { identifier: item.id, title: item.title, statement: item.statement,
      sectorId: sectors.find(sector => sector.name === item.subsystem).id, method: 'unspecified', level: 'system', ownerId: user.id,
      artifactIds: [originalId, readableId], parentIds: [], sourceRefs: [], entityIds: [], sourceLocator: item.sourceLocator,
      sourceComment: item.comments.map(comment => `Comentário ${comment.id}: ${comment.text}`).join('\n\n') } });
  }
  if (!delivery.lifecycle && !delivery.tasks.length) {
    await action({ action: 'lifecycle.configure', profile: 'ecss', startDate: '2026-10-26', durations: [4, 6, 8, 32, 24, 52, 4], selectedReviews: ['MDR', 'PRR', 'SRR', 'PDR', 'CDR', 'TRR', 'QR', 'AR'] });
    for (const [title, startDate, dueDate] of [
      ['Conferir requisitos e comentários de origem', '2026-10-26', '2026-11-06'],
      ['Avaliar aplicabilidade das referências', '2026-11-09', '2026-11-20'],
      ['Definir critérios e responsáveis de verificação', '2026-11-23', '2026-12-04']
    ]) await action({ action: 'task.save', item: { title, startDate, dueDate, kind: 'task', phaseId: '', sectorId: '', ownerId: user.id, status: 'planned', description: 'Planejamento provisório do caso LYLE. Datas e escopo precisam de revisão da equipe; não representam execução nem aprovação.', dependencyIds: [], requirementIds: delivery.requirements.map(r => r.id), testIds: [], inputArtifactIds: [originalId], outputArtifactIds: [] } });
  }
  // The SRR drafts are the deterministic templates filled from the saved requirements.
  const srr = delivery.tasks.find(task => task.kind === 'review' && task.reviewCode === 'SRR' && !task.archived);
  for (const templateId of srr ? ['REQ', 'RTM'] : []) if (!delivery.documents.some(document => document.taskId === srr.id && document.templateId === templateId)) await action({ action: 'document.prepare', taskId: srr.id, templateId });
  if (!state.analysisRunId) {
    // One rules check of the supplied case. It does not call an LLM or create verification suggestions.
    const { run } = await api(`/projects/${projectId}/delivery/assistant-runs`, { kind: 'requirements', assisted: false });
    state.analysisRunId = run.id; save();
  }
  const deadline = Date.now() + 60_000; let run;
  do {
    ({ run } = await api(`/projects/${projectId}/delivery/assistant-runs/${state.analysisRunId}`));
    if (!['queued', 'running'].includes(run.status)) break;
    await new Promise(done => setTimeout(done, 500));
  } while (Date.now() < deadline);
  ensure(run?.status === 'completed', `Checagem por regras ${run?.status || 'indisponível'}; registro preservado para inspeção.`);

  const require = createRequire(import.meta.url);
  const { prepare } = require('../../novo_teste/resultados/reunioes/scripts/preparar-seed-lyle.cjs');
  const meetings = (await api('/meetings')).meetings, imported = [];
  for (const item of BUNDLE.meetings) {
    const title = meetingTitle(item), known = state.meetings[item.scenarioId];
    let meeting = known?.id ? (await api(`/meetings/${encodeURIComponent(known.id)}`)).meeting : meetings.find(m => m.title === title && m.ownerId === user.id && m.projectId === projectId);
    if (!meeting) meeting = (await api('/meetings', { title, scope: 'team', teamId: state.teamId, projectId })).meeting;
    ensure(meeting.ownerId === user.id && meeting.projectId === projectId, 'A reunião de destino não pertence à conta/projeto esperado.');
    state.meetings[item.scenarioId] = { id: meeting.id }; save();
    const key = 'norte.meeting-room.session.v2.' + meeting.id, path = `/meetings/${encodeURIComponent(meeting.id)}/legacy/records`;
    const saved = await api(`${path}?key=${encodeURIComponent(key)}`);
    if (saved.value !== null) {
      const current = JSON.parse(saved.value);
      ensure(current.source_document?.sha256 === item.source.sha256, `A reunião ${title} já tem registros diferentes; nada foi sobrescrito.`);
      imported.push({ title, status: 'preserved_existing' }); continue;
    }
    const record = prepare(item.run, item.organized, meeting.id); record.title = title; record.project_id = projectId; record.source_document = item.source;
    await api(path, { key, value: JSON.stringify(record), expected_version: saved.version });
    imported.push({ title, status: 'imported' });
  }
  state.completedAt ||= new Date().toISOString(); save();
  delivery = await api(`/projects/${projectId}/delivery`);
  console.log(JSON.stringify({ origin, account: user.nickname || user.login, role: user.accessRole, teamId: state.teamId, projectId, requirements: delivery.requirements.length, analysed: delivery.requirements.filter(r => r.analysis?.engine !== 'not_analyzed').length, documents: delivery.documents.length, schedule: delivery.tasks.length, meetings: imported, providerCalls: 0 }, null, 2));
} catch (error) { console.error(error.message); process.exitCode = 1; }
