/** Controlled fixture. Never called by migrations, builds or application startup. */
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import argon2 from 'argon2';
import { normalizeStoredData, createValidationProject } from '../server/data-store.mjs';
import { organizationError } from '../shared/project-organization.mjs';

export function assertPreviewEnvironment(env = process.env) {
  if (!['development', 'test'].includes(env.NODE_ENV) || env.RENDER || env.DATABASE_URL || env.NORTE_ALLOW_TEAM_PREVIEW !== '1') throw new Error('Use NODE_ENV=development/test e NORTE_ALLOW_TEAM_PREVIEW=1, sem RENDER ou DATABASE_URL. Este comando não aceita bancos remotos.');
}
export async function seedTeamPreview(value, email, { password = 'norte fictitious local test account' } = {}) {
  const data = normalizeStoredData(value);
  if (data.environment !== 'team-preview-test') throw new Error('O arquivo precisa ser uma cópia explicitamente marcada como team-preview-test.');
  const owner = data.users.find(u => u.email === email.toLowerCase() && u.active);
  if (!owner || !data.members.some(m => m.id === owner.memberId && m.accountId === owner.id)) throw new Error('A conta solicitada não existe ou não está ativa nesta cópia de teste. Nenhuma conta real foi criada ou alterada.');
  const prefix = `test-team-${createHash('sha256').update(owner.id).digest('hex').slice(0, 10)}`;
  if (data.teams.some(t => t.id === prefix)) return data;
  const now = new Date().toISOString(), hash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
  const people = [
    ['luna', 'Luna · TESTE', 'Pesquisa'], ['caio', 'Caio · TESTE', 'Aviônica'], ['iris', 'Íris · TESTE', 'Estruturas'],
    ['noa', 'Noa · TESTE', 'Propulsão'], ['davi', 'Davi · TESTE', 'Software'], ['bia', 'Bia · TESTE', 'Validação']
  ];
  const members = people.map(([key, name, area]) => {
    const id = `${prefix}-${key}`, userId = `${id}-user`;
    if (data.users.some(u => u.nickname === `teste_${key}_${prefix.slice(-10)}` || u.email === `${id}@example.test`)) throw new Error('Identidade de teste já existente; nenhuma alteração aplicada.');
    data.users.push({ id: userId, memberId: id, name, nickname: `teste_${key}_${prefix.slice(-10)}`, email: `${id}@example.test`, passwordHash: hash, emailVerifiedAt: now, accessRole: 'member', institution: 'Instituição fictícia · TESTE', course: 'Engenharia · TESTE', academicStage: '', active: true, isTestAccount: true, createdAt: now, updatedAt: now });
    const member = { id, accountId: userId, displayName: name, email: `${id}@example.test`, missionRole: 'member', primaryArea: area, secondaryAreas: [], institution: 'Instituição fictícia · TESTE', course: 'Engenharia · TESTE', academicStage: '', skills: [], availabilityHours: 0, notes: 'Pessoa fictícia. Exclusiva deste ambiente isolado de teste.', accountStatus: 'active', createdAt: now, updatedAt: now };
    data.members.push(member); return member;
  });
  const team = { id: prefix, name: 'Equipe Horizonte · TESTE', description: 'Exemplo fictício de competição, pesquisa e produto. Ambiente isolado.', captainMemberId: owner.memberId, adminMemberIds: [], memberIds: [owner.memberId, ...members.map(m => m.id)], artifactIds: [], joinRequests: [], createdBy: owner.id, createdAt: now, updatedAt: now, testFixture: true };
  data.teams.push(team);
  const definitions = [
    ['competition', 'Foguete Aurora · TESTE', ['Aviônica', 'Propulsão', 'Estruturas'], owner.memberId],
    ['research', 'Pesquisa Atmosfera · TESTE', ['Pesquisa', 'Instrumentação', 'Análise de dados'], members[0].id],
    ['product', 'Estação Solo · TESTE', ['Software', 'Eletrônica', 'Validação'], members[4].id]
  ];
  definitions.forEach(([type, name, sectors, lead], index) => {
    const project = { ...createValidationProject(now), id: `${prefix}-project-${index + 1}`, name, projectType: type, creatorId: owner.id, organizationRevision: 0, testFixture: true };
    const sectorItems = sectors.map((name, i) => ({ id: `${project.id}-sector-${i}`, name }));
    project.context = { ...project.context, configured: true, teamId: team.id, teamName: team.name, sectors: sectorItems, roles: [{ id: 'captain', name: 'Responsável pelo projeto' }, { id: 'manager', name: 'Gerente de setor' }, { id: 'member', name: 'Membro' }, { id: 'advisor', name: 'Orientador' }], folders: sectorItems.map(s => ({ id: `${s.id}-docs`, name: 'Documentação', parentId: s.id })), assignments: [
      { memberId: lead, roleId: 'captain', sectorId: '' },
      ...members.filter(m => m.id !== lead).map((m, i) => ({ memberId: m.id, roleId: i < 3 ? 'manager' : 'member', sectorId: sectorItems[i % 3].id, ...(i === 3 ? { sectorRoles: [{ sectorId: sectorItems[1].id, role: 'member' }, { sectorId: sectorItems[2].id, role: 'viewer' }] } : {}) }))
    ] };
    project.setup.statement = `Demonstração fictícia para testar a organização de ${name}. Não representa um produto real.`;
    for (const sector of sectorItems) {
      const text = `# Plano de ${sector.name}\n\nDocumento fictício para testar pastas, visualização e permissões.\n\n## Objetivo\nOrganizar referências e registrar resultados do projeto ${name}.\n\n## Próximos passos\n- Revisar o escopo com o responsável do setor.\n- Documentar um ensaio.\n\nNenhuma informação real de terceiros.`;
      const bytes = Buffer.from(text), id = `${sector.id}-artifact`;
      data.artifacts.push({ id, kind: 'document', label: `Plano de ${sector.name} · TESTE`, url: `data:text/markdown;base64,${bytes.toString('base64')}`, documentText: text, fileName: 'plano.md', mimeType: 'text/markdown', size: bytes.length, folderId: `${sector.id}-docs`, scope: 'project', ownerId: project.id, official: false, createdBy: owner.id, description: 'Documento fictício de validação.', tags: ['teste'], connectedAt: now, updatedAt: now });
      project.context.projectArtifactIds.push(id);
    }
    const error = organizationError(project); if (error) throw new Error(error);
    data.workspace.projects[project.id] = { document: project, revision: 1, createdBy: owner.id, createdAt: now, updatedAt: now, updatedBy: owner.id };
  });
  return data;
}

async function main() {
  assertPreviewEnvironment();
  const args = process.argv.slice(2), option = key => args[args.indexOf(key) + 1];
  if (!args.includes('--source') || !args.includes('--output') || !args.includes('--email')) throw new Error('Informe --source arquivo-local --output nova-copia --email conta-existente. A origem nunca será modificada.');
  const source = resolve(option('--source')), output = resolve(option('--output'));
  if (source === output) throw new Error('A saída deve ser uma nova cópia de teste.');
  if (await stat(output).then(() => true).catch(() => false)) throw new Error('A saída já existe. Não será sobrescrita.');
  const original = JSON.parse(await readFile(source, 'utf8'));
  const data = await seedTeamPreview({ ...original, environment: 'team-preview-test' }, option('--email'));
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(data, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  console.log(`Cópia de teste criada: ${output}. Origem e contas existentes preservadas. Nenhum email enviado.`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(e => { console.error(e.message); process.exitCode = 1; });
