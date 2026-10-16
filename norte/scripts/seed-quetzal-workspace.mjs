/** Opt-in organization of the real corpus. Never runs during startup and never writes the source file. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { organizationError, isProjectAdmin, folderPath } from '../shared/project-organization.mjs';

export const QUETZAL_WORKSPACE_SOURCES = {
  hardware: 'https://github.com/Quetzal-1-CubeSat-Team/quetzal1-hardware/tree/d4d1b59de384701a016a6e17353aff3c8ba64853',
  software: 'https://github.com/Quetzal-1-CubeSat-Team/quetzal1-flight-software/tree/dbfb67a2c8a7336f765e320d37a8a02e3ab4c212',
  mission: 'https://www.uvg.edu.gt/cubesat-en/'
};
const sectors = [['systems', 'Engenharia de sistemas'], ['eps', 'Energia · EPS'], ['adcs', 'Atitude · ADCS'], ['comms', 'Comunicações'], ['adm', 'Abertura de antenas · ADM']];
const destinations = {
  'quetzal-hardware-overview': ['systems', 'Arquitetura e interfaces'],
  'quetzal-eps-hardware-readme': ['eps', 'Visão geral'],
  'quetzal-eps-schematic': ['eps', 'Placa EPS PT-MIS-PCB-002', 'Esquemático'],
  'quetzal-eps-bom-reference': ['eps', 'Placa EPS PT-MIS-PCB-002', 'Lista de materiais'],
  'quetzal-eps-flight-software-readme': ['eps', 'Software de voo'],
  'quetzal-adcs-hardware': ['adcs', 'Placa ADCS PT-MIS-PCB-001', 'Projeto eletrônico'],
  'quetzal-adcs-software': ['adcs', 'Software de voo'],
  'quetzal-adm-hardware': ['adm', 'Placa ADM PT-MIS-PCB-004', 'Mecanismo e painel Z-'],
  'gomspace-nanocom-ax100-datasheet': ['comms', 'Componentes', 'NanoCom AX100', 'Datasheets'],
  'ti-ina260-datasheet': ['eps', 'Placa EPS PT-MIS-PCB-002', 'Componentes', 'INA260', 'Datasheets'],
  'ti-tps2551-datasheet': ['eps', 'Placa EPS PT-MIS-PCB-002', 'Componentes', 'TPS2551', 'Datasheets'],
  'ti-ina169-datasheet': ['eps', 'Placa EPS PT-MIS-PCB-002', 'Componentes', 'INA169', 'Datasheets'],
  'ti-tps63070-datasheet': ['eps', 'Placa EPS PT-MIS-PCB-002', 'Componentes', 'TPS63070', 'Datasheets'],
  'ti-tmp100-datasheet': ['eps', 'Placa EPS PT-MIS-PCB-002', 'Componentes', 'TMP100', 'Datasheets'],
  'ti-bq27441-g1-datasheet': ['eps', 'Placa EPS PT-MIS-PCB-002', 'Componentes', 'BQ27441-G1 · referência BOM', 'Datasheets'],
  'ti-bq27741-g1-datasheet': ['eps', 'Placa EPS PT-MIS-PCB-002', 'Componentes', 'BQ27741-G1 · referência software', 'Datasheets'],
  'microchip-atmega328p-datasheet': ['eps', 'Placa EPS PT-MIS-PCB-002', 'Componentes', 'ATmega328P', 'Datasheets']
};
export const QUETZAL_WORKSPACE_DOCUMENT_IDS = Object.freeze(Object.keys(destinations));
const digest = value => createHash('sha256').update(value).digest('hex').slice(0, 12);
/** Returns a clone plus audit. Existing architecture, original bytes, user accounts and unrelated projects are preserved. */
export function seedQuetzalWorkspace(value, { projectId, actorId, allowLocalTest = false, now = () => new Date().toISOString() } = {}) {
  const data = structuredClone(value), record = Object.hasOwn(data.workspace?.projects || {}, projectId) && data.workspace.projects[projectId];
  if (!record || !/quetzal/i.test(record.document.name)) throw new Error('Selecione explicitamente o projeto Quetzal-1 existente.');
  const project = record.document, actor = data.users.find(u => u.id === actorId && u.active), team = data.teams.find(t => t.id === project.context.teamId);
  if (!actor || !team || !team.memberIds.includes(actor.memberId) || !isProjectAdmin(project, actor, record.createdBy)) throw new Error('A conta indicada precisa administrar este projeto e pertencer à equipe.');
  const sandbox = record.demoSandboxId || project.demoSandboxId || null;
  if (sandbox ? sandbox !== actor.demoSandboxId || sandbox !== team.demoSandboxId : !(allowLocalTest && data.environment === 'quetzal-workspace-test')) throw new Error('A fixture exige o sandbox da conta de teste, ou uma cópia local marcada quetzal-workspace-test.');
  if (record.quetzalWorkspaceFixture?.version === 1) return { data, audit: { changed: false, projectId, alreadyApplied: true } };
  const artifacts = data.artifacts.filter(a => a.scope === 'project' && a.ownerId === projectId), matched = artifacts.map(artifact => ({ artifact, sourceId: Object.keys(destinations).find(id => artifact.provenance?.sourceId === id || artifact.id === id || artifact.id.endsWith(`-${id}`) || artifact.fileName === `${id}.txt`) })).filter(item => item.sourceId);
  if (matched.length !== 17 || new Set(matched.map(item => item.sourceId)).size !== 17) throw new Error('Os 17 documentos originais precisam existir, sem duplicações. A fixture não inventa nem substitui fontes.');
  const timestamp = now(), prefix = `q-workspace-${digest(projectId)}`, marker = sandbox ? { demoSandboxId: sandbox } : {}, before = { artifactCount: artifacts.length, entityCount: project.engineeringSystem?.entities?.length || 0 }, moves = [];
  project.context.sectors ||= []; project.context.folders ||= [];
  for (const [key, name] of sectors) { const id = `${prefix}-${key}`; if (!project.context.sectors.some(s => s.id === id)) project.context.sectors.push({ id, name }); }
  const ensurePath = path => { let parentId = `${prefix}-${path[0]}`; for (let index = 1; index < path.length; index++) { const id = `${prefix}-folder-${digest(path.slice(0, index + 1).join('/'))}`; if (!project.context.folders.some(f => f.id === id)) project.context.folders.push({ id, name: path[index], parentId }); parentId = id; } return parentId; };
  for (const { artifact, sourceId } of matched) {
    const from = folderPath(project, artifact.folderId), folderId = ensurePath(destinations[sourceId]);
    artifact.folderId = folderId; artifact.revision = (artifact.revision || 0) + 1; artifact.updatedAt = timestamp;
    moves.push({ artifactId: artifact.id, sourceId, from, to: folderPath(project, folderId), sourceUrl: artifact.provenance?.sourceUrl || null });
  }
  // Only the two known empty folders from the original validation fixture are retired.
  for (const sectorId of ['mission', 'references']) {
    const folderId = `${sectorId}-documents`, sector = project.context.sectors.find(s => s.id === sectorId);
    if (!sector || !['Missão e subsistemas', 'Referências de componentes'].includes(sector.name)) continue;
    const branch = project.context.folders.filter(f => f.parentId === sectorId || f.parentId === folderId);
    const used = artifacts.some(a => [sectorId, folderId].includes(a.folderId)) || project.context.assignments.some(a => a.sectorId === sectorId || a.sectorRoles?.some(r => r.sectorId === sectorId)) || project.context.programFolderId === folderId || Object.values(project.context.teamArtifactFolders || {}).some(id => [sectorId, folderId].includes(id));
    if (!used && branch.every(f => f.id === folderId)) { project.context.folders = project.context.folders.filter(f => f.id !== folderId); project.context.sectors = project.context.sectors.filter(s => s.id !== sectorId); }
  }
  const people = [];
  const names = [['ana', 'Ana', 'systems', 'manager'], ['bruno', 'Bruno', 'eps', 'manager'], ['clara', 'Clara', 'adcs', 'manager'], ['davi', 'Davi', 'comms', 'manager'], ['elisa', 'Elisa', 'adm', 'manager'], ['felipe', 'Felipe', 'eps', 'member'], ['gabriela', 'Gabriela', 'adcs', 'member']];
  for (const [key, firstName, sector, role] of names) {
    const memberId = `${sandbox || prefix}-q-${key}`, userId = `${memberId}-user`, name = `${firstName} · EXEMPLO`, email = `${digest(projectId)}.${key}@demo.norte.invalid`;
    if (data.users.some(u => u.id === userId || u.email === email) || data.members.some(m => m.id === memberId)) throw new Error('Identidade fictícia já existente fora desta fixture; nenhuma alteração aplicada.');
    const area = sectors.find(s => s[0] === sector)[1];
    data.users.push({ id: userId, memberId, name, nickname: `q_${key}_${digest(projectId).slice(0, 6)}`, email, passwordHash: 'demo-account-without-password', isFictionalProfile: true, emailVerifiedAt: timestamp, accessRole: 'member', active: true, isTestAccount: true, isDemoAccount: Boolean(sandbox), institution: 'Equipe fictícia para demonstração', course: 'Engenharia · EXEMPLO', primaryArea: area, createdAt: timestamp, updatedAt: timestamp, ...marker });
    data.members.push({ id: memberId, accountId: userId, displayName: name, email, isFictionalProfile: true, missionRole: role, primaryArea: area, secondaryAreas: [], institution: 'Equipe fictícia para demonstração', course: 'Engenharia · EXEMPLO', academicStage: '', skills: [], availabilityHours: 0, notes: 'Pessoa fictícia para demonstrar permissões. Não representa a equipe real do Quetzal-1.', accountStatus: 'active', createdAt: timestamp, updatedAt: timestamp, ...marker });
    team.memberIds.push(memberId); project.context.assignments.push({ memberId, roleId: role, sectorId: `${prefix}-${sector}` }); people.push({ userId, memberId, name, role, sector: area });
  }
  for (const [id, name] of [['captain', 'Responsável pelo projeto'], ['manager', 'Gerente de setor'], ['member', 'Membro']]) if (!project.context.roles.some(r => r.id === id)) project.context.roles.push({ id, name });
  project.context.summary ||= { scope: 'Documentação pública de hardware e software do Quetzal-1: EPS, ADCS, abertura de antenas e referências de componentes. Datasheets descrevem capacidade do fabricante, não comprovam a configuração de voo.', nextSteps: 'Conferir revisões da placa EPS e comparar a referência BQ27441-G1 da lista de materiais com BQ27741-G1 do software. Revisar limites elétricos no esquemático antes de aprovar requisitos.' };
  const error = organizationError(project); if (error) throw new Error(error);
  project.organizationRevision = (project.organizationRevision || 0) + 1; project.updatedAt = timestamp;
  // Folder context participates in future extraction. Preserve the current map as a reviewable baseline.
  project.memoryRevision = (project.memoryRevision || 0) + 1;
  record.revision = (record.revision || 0) + 1; record.updatedAt = timestamp; record.updatedBy = actor.id;
  record.quetzalWorkspaceFixture = { version: 1, createdAt: timestamp, actorId: actor.id, sources: QUETZAL_WORKSPACE_SOURCES };
  team.updatedAt = timestamp;
  if (data.workspace.project?.document?.id === projectId) data.workspace.project = record;
  return { data, audit: { changed: true, projectId, before, moves, fictionalPeople: people, captainMemberId: team.captainMemberId, sources: QUETZAL_WORKSPACE_SOURCES, preserved: { artifactCount: artifacts.length, entityCount: project.engineeringSystem?.entities?.length || 0, originalBytes: true }, notes: ['Pastas organizam responsabilidade e evidências; não criam sistemas técnicos automaticamente.', 'ATmega328P permanece como referência única no EPS; ADCS usa o mesmo datasheet por referência, sem duplicar arquivo.', 'BQ27441-G1 e BQ27741-G1 permanecem separados: não foi presumida equivalência entre revisões.', 'A placa ADM também contém painel Z-; a pasta preserva esse contexto compartilhado.', 'Nenhum convite, sessão ou senha de acesso foi criado para as pessoas fictícias.'] } };
}
async function main() {
  if (!['development', 'test'].includes(process.env.NODE_ENV) || process.env.RENDER || process.env.DATABASE_URL || process.env.NORTE_ALLOW_QUETZAL_WORKSPACE !== '1') throw new Error('Use NODE_ENV=development/test e NORTE_ALLOW_QUETZAL_WORKSPACE=1, sem bancos remotos.');
  const args = process.argv.slice(2), option = key => args[args.indexOf(key) + 1];
  for (const key of ['--source', '--output', '--project', '--actor']) if (!args.includes(key)) throw new Error(`Informe ${key}. A origem nunca será modificada.`);
  const source = resolve(option('--source')), output = resolve(option('--output')); if (source === output) throw new Error('A saída deve ser uma nova cópia.');
  const original = JSON.parse(await readFile(source, 'utf8'));
  const { data, audit } = seedQuetzalWorkspace(original, { projectId: option('--project'), actorId: option('--actor') });
  await mkdir(dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(data, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  await writeFile(`${output}.audit.json`, JSON.stringify(audit, null, 2) + '\n', { mode: 0o600, flag: 'wx' }); console.log(JSON.stringify(audit, null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
