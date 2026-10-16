import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newDb } from 'pg-mem';
import { buildApp } from './app.mjs';
import { PostgresDataStore } from './postgres-store.mjs';
import { createValidationProject, normalizeStoredData } from './data-store.mjs';
import { suggestedSectors, organizationError } from '../shared/project-organization.mjs';
import { technicalHierarchyError, respectsTechnicalFolders } from '../shared/technical-hierarchy.mjs';
import { buildSystemPrompt, createSystemAiService } from './system-ai.mjs';
import { renderArtifactPdf } from './artifact-pdf.mjs';

async function fixture(t, postgres = false) {
  const directory = await mkdtemp(join(tmpdir(), 'norte-organization-'));
  const storeFile = join(directory, 'state.json');
  const adapter = postgres && newDb().adapters.createPg();
  const store = adapter && await new PostgresDataStore('postgresql://test', { pool: new adapter.Pool() }).init();
  let app = await buildApp({ ...(store ? { store } : { storeFile }), logger: false });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  async function account(name) {
    const response = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { name, email: `${name}@example.test`, password: 'a long test passphrase for engineering' } });
    assert.equal(response.statusCode, 201, response.body);
    return { ...response.json().user, headers: { cookie: response.headers['set-cookie'].split(';')[0], 'x-csrf-token': response.json().csrfToken } };
  }
  const owner = await account('Owner'), captain = await account('Captain'), manager = await account('Manager'), member = await account('Member'), outsider = await account('Outsider');
  const request = (actor, method, path, payload) => app.inject({ method, url: `/api${path}`, headers: actor.headers, ...(payload ? { payload: method === 'PATCH' && path.startsWith('/artifacts/') ? { expectedRevision: app.missionStore.read().artifacts.find(a => a.id === path.slice('/artifacts/'.length))?.revision || 0, ...payload } : payload } : {}) });
  const teamResponse = await request(captain, 'POST', '/teams', { name: 'Engineering team' });
  assert.equal(teamResponse.statusCode, 201, teamResponse.body);
  const team = teamResponse.json().team;
  for (const user of [manager, member]) {
    const invited = await request(captain, 'POST', `/teams/${team.id}/invitations`, { nickname: user.nickname });
    assert.equal(invited.statusCode, 201, invited.body);
    assert.equal((await request(user, 'POST', `/invitations/${invited.json().invitation.id}/respond`, { decision: 'accept' })).statusCode, 200);
  }
  const project = { ...createValidationProject(), id: 'engineering-project', name: 'Research test', projectType: 'research' };
  project.context = { ...project.context, teamId: team.id, teamName: team.name, sectors: [{ id: 'avionics', name: 'Aviônica' }, { id: 'structures', name: 'Estruturas' }], folders: [{ id: 'references', name: 'Referências', parentId: 'avionics' }], assignments: [{ memberId: captain.memberId, roleId: 'captain', sectorId: '' }, { memberId: manager.memberId, roleId: 'manager', sectorId: 'avionics' }, { memberId: member.memberId, roleId: 'member', sectorId: 'avionics' }] };
  const created = await request(captain, 'POST', '/projects', project);
  assert.equal(created.statusCode, 201, created.body);
  return { get app() { return app; }, request, owner, captain, manager, member, outsider, project: created.json().project, storeFile, async restart() { await app.close(); app = await buildApp({ storeFile, logger: false }); } };
}
const file = (project, folderId, extra = {}) => ({ kind: 'document', label: 'Engineering notes', scope: 'project', ownerId: project.id, folderId, documentText: '# Objective\n\n## Test\n\n| Item | Result |\n| --- | --- |\n| Sensor | OK |\n\n## References\n[Manual](https://example.test/manual)', ...extra });

for (const postgres of [false, true]) test(`project creation, sector writes, PDF and persistence (${postgres ? 'PostgreSQL' : 'JSON'})`, async t => {
  const f = await fixture(t, postgres), { request, captain, manager, member, outsider, owner } = f;
  let project = f.project;
  assert.equal((await request(captain, 'GET', '/projects')).json().projects.some(p => p.id === project.id), true);
  assert.equal((await request(captain, 'POST', '/projects', project)).statusCode, 409);
  assert.equal((await request(captain, 'POST', '/projects', { ...project, id: 'empty-name', name: ' ' })).statusCode, 400);
  assert.equal((await request(outsider, 'POST', '/projects', { ...project, id: 'wrong-team' })).statusCode, 403);
  assert.equal((await request(outsider, 'GET', `/projects/${project.id}`)).statusCode, 403);
  const uploaded = await request(member, 'POST', '/artifacts', file(project, 'references'));
  assert.equal(uploaded.statusCode, 201, uploaded.body);
  const artifact = uploaded.json().artifact;
  project = (await request(captain, 'GET', `/projects/${project.id}`)).json().project;
  assert.ok(project.context.projectArtifactIds.includes(artifact.id), 'upload and memory link commit together');
  assert.equal((await request(member, 'POST', '/artifacts', file(project, 'structures'))).statusCode, 403);
  assert.equal((await request(member, 'POST', '/artifacts', file(project, 'missing'))).statusCode, 400);
  assert.equal((await request(member, 'POST', '/artifacts', file(project, null))).statusCode, 403);
  assert.equal((await request(outsider, 'POST', '/artifacts', file(project, 'references'))).statusCode, 403);
  assert.equal((await request(member, 'PATCH', `/artifacts/${artifact.id}`, { folderId: 'structures' })).statusCode, 403);
  assert.equal((await request(member, 'PATCH', `/artifacts/${artifact.id}`, { ownerId: 'another-project' })).statusCode, 400);
  assert.equal((await request(manager, 'PATCH', `/artifacts/${artifact.id}`, { documentText: '# Updated engineering document' })).statusCode, 200);
  const foreign = await request(captain, 'POST', '/artifacts', file(project, 'structures'));
  assert.equal((await request(member, 'DELETE', `/artifacts/${foreign.json().artifact.id}`)).statusCode, 403);
  assert.equal((await request(member, 'GET', `/artifacts/${foreign.json().artifact.id}/pdf`)).statusCode, 200, 'project reading stays collaborative');
  assert.equal((await request(outsider, 'GET', `/artifacts/${artifact.id}/pdf`)).statusCode, 404);
  assert.equal((await request(outsider, 'GET', `/artifacts/${artifact.id}/content`)).statusCode, 404);
  for (const suffix of ['/pdf', '/pdf?download=1']) {
    const pdf = await request(member, 'GET', `/artifacts/${artifact.id}${suffix}`);
    assert.equal(pdf.statusCode, 200, pdf.body);
    assert.equal(pdf.headers['content-type'], 'application/pdf');
    assert.equal(pdf.rawPayload.subarray(0, 5).toString(), '%PDF-');
    assert.match(pdf.headers['content-disposition'], suffix.includes('download') ? /attachment/ : /inline/);
  }
  const cadBytes = Buffer.from('ISO-10303-21;\nCAD native bytes\nEND-ISO-10303-21;');
  const cad = await request(member, 'POST', '/artifacts', { kind: 'document', label: 'Mechanical CAD', scope: 'project', ownerId: project.id, folderId: 'references', fileName: 'part.step', mimeType: 'application/octet-stream', size: cadBytes.length, url: `data:application/octet-stream;base64,${cadBytes.toString('base64')}` });
  assert.equal(cad.statusCode, 201, cad.body);
  assert.deepEqual((await request(member, 'GET', `/artifacts/${cad.json().artifact.id}/content`)).rawPayload, cadBytes);
  assert.equal((await request(member, 'GET', `/artifacts/${cad.json().artifact.id}/pdf`)).statusCode, 400);
  const pdfBytes = await renderArtifactPdf({ label: 'Imported PDF', documentText: 'PDF uploaded by a user.' });
  const imported = await request(member, 'POST', '/artifacts', { kind: 'document', label: 'Uploaded PDF', scope: 'project', ownerId: project.id, folderId: 'references', fileName: 'source.pdf', mimeType: 'application/pdf', size: pdfBytes.length, url: `data:application/pdf;base64,${pdfBytes.toString('base64')}` });
  assert.equal(imported.statusCode, 201, imported.body);
  assert.deepEqual((await request(member, 'GET', `/artifacts/${imported.json().artifact.id}/content`)).rawPayload, pdfBytes);
  assert.match((await request(member, 'GET', `/artifacts/${imported.json().artifact.id}/content`)).headers['content-disposition'], /inline/);
  assert.equal((await request(member, 'DELETE', `/projects/${project.id}`)).statusCode, 403);
  assert.equal((await request(manager, 'DELETE', `/projects/${project.id}`)).statusCode, 403);
  assert.equal((await request(owner, 'GET', `/projects/${project.id}`)).statusCode, 403, 'platform account role never bypasses another team');
  if (!postgres) {
    await f.restart();
    const restored = await request(captain, 'GET', `/projects/${project.id}`);
    assert.equal(restored.json().project.projectType, 'research');
    assert.ok(restored.json().project.context.projectArtifactIds.includes(artifact.id));
    assert.equal((await request(member, 'PATCH', `/artifacts/${artifact.id}`, { label: 'After restart' })).statusCode, 200);
    const saved = JSON.parse(await readFile(f.storeFile, 'utf8'));
    assert.ok(saved.artifacts.find(a => a.id === artifact.id).documentText.includes('Updated'));
  } else {
    await f.app.missionStore.refresh();
    assert.ok(f.app.missionStore.read().artifacts.some(a => a.id === artifact.id && a.documentText.includes('Updated')));
  }
});

test('manager delegation, multiple sectors and all alternate write routes enforce persisted grants', async t => {
  const f = await fixture(t), { request, captain, manager, member, outsider } = f;
  let project = f.project;
  const save = async (actor, edit, expected) => {
    project = (await request(captain, 'GET', `/projects/${project.id}`)).json().project;
    const next = structuredClone(project); edit(next);
    const response = await request(actor, 'PUT', `/projects/${project.id}`, next);
    assert.equal(response.statusCode, expected, response.body);
    return next;
  };
  await save(member, p => { p.context.assignments.find(a => a.memberId === member.memberId).roleId = 'captain'; }, 403);
  await save(manager, p => { p.context.assignments.find(a => a.memberId === member.memberId).sectorRoles = [{ sectorId: 'avionics', role: 'manager' }]; }, 403);
  await save(manager, p => { p.context.assignments.find(a => a.memberId === member.memberId).sectorRoles = [{ sectorId: 'structures', role: 'member' }]; }, 403);
  await save(manager, p => { p.context.assignments.find(a => a.memberId === member.memberId).sectorRoles = [{ sectorId: 'avionics', role: 'viewer' }]; }, 200);
  assert.equal((await request(member, 'POST', '/artifacts', file(project, 'avionics'))).statusCode, 403);
  await save(manager, p => { p.context.assignments.find(a => a.memberId === member.memberId).sectorRoles = [{ sectorId: 'avionics', role: 'member' }]; }, 200);
  await save(captain, p => { p.context.assignments.find(a => a.memberId === member.memberId).sectorRoles = [{ sectorId: 'avionics', role: 'member' }, { sectorId: 'structures', role: 'member' }]; }, 200);
  const artifact = (await request(member, 'POST', '/artifacts', file(project, 'avionics'))).json().artifact;
  assert.equal((await request(member, 'PATCH', `/artifacts/${artifact.id}`, { folderId: 'structures' })).statusCode, 200);
  await save(manager, p => { p.context.folders.push({ id: 'tests', name: 'Tests', parentId: 'avionics' }); }, 200);
  await save(manager, p => { p.context.folders.find(f => f.id === 'tests').parentId = 'structures'; }, 403);
  await save(member, p => { p.context.folders.push({ id: 'unauthorized', name: 'Tests', parentId: 'avionics' }); }, 403);
  const forbidden = structuredClone(project); forbidden.context.assignments[1].roleId = 'captain';
  assert.equal((await request(manager, 'PUT', '/workspace/project', forbidden)).statusCode, 403);
  assert.equal((await request(outsider, 'GET', '/workspace/project')).statusCode, 403);
  assert.equal((await request(outsider, 'PUT', `/workspace/labs/${project.id}`, { schemaVersion: 1, nodes: [], links: [] })).statusCode, 403);
  await request(member, 'POST', '/auth/logout');
  const loggedIn = await f.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: member.email, password: 'a long test passphrase for engineering' } });
  member.headers = { cookie: loggedIn.headers['set-cookie'].split(';')[0], 'x-csrf-token': loggedIn.json().csrfToken };
  assert.equal((await request(member, 'PATCH', `/artifacts/${artifact.id}`, { label: 'After login' })).statusCode, 200);
  // Being last editor does not retain access after removal.
  await save(captain, p => { p.context.assignments = p.context.assignments.filter(a => a.memberId !== member.memberId); }, 200);
  assert.equal((await request(member, 'PATCH', `/artifacts/${artifact.id}`, { label: 'Revoked' })).statusCode, 403);
});

test('folders prevent cycles, orphaned children and loss of existing content', async t => {
  const f = await fixture(t), { request, captain } = f;
  let project = f.project;
  const artifact = (await request(captain, 'POST', '/artifacts', file(project, 'references'))).json().artifact;
  project = (await request(captain, 'GET', `/projects/${project.id}`)).json().project;
  assert.equal((await request(captain, 'PUT', `/projects/${project.id}`, { ...project, context: { ...project.context, folders: [] } })).statusCode, 409);
  const cycle = structuredClone(project); cycle.context.folders[0].parentId = 'references';
  assert.equal((await request(captain, 'PUT', `/projects/${project.id}`, cycle)).statusCode, 400);
  assert.equal((await request(captain, 'GET', '/artifacts')).json().artifacts.find(a => a.id === artifact.id).folderId, 'references');
  assert.equal((await request(captain, 'PATCH', `/artifacts/${artifact.id}`, { folderId: 'structures' })).statusCode, 200);
  assert.equal((await request(captain, 'PUT', `/projects/${project.id}`, { ...project, context: { ...project.context, folders: [] } })).statusCode, 200);
});

test('presence expires without deployment, logout closes only that session and users remain admin-only', async t => {
  const f = await fixture(t), { request, owner, captain, member } = f;
  assert.equal((await request(member, 'GET', '/admin/users')).statusCode, 403);
  assert.equal((await request(member, 'GET', `/projects/${f.project.id}/activity`)).statusCode, 403);
  assert.equal((await request(captain, 'GET', `/projects/${f.project.id}/activity`)).json().users.length, 3);
  const adminList = (await request(owner, 'GET', '/admin/users')).json().users;
  assert.equal(adminList.some(u => u.id === member.id), false);
  let list = (await request(captain, 'GET', '/directory/members')).json().members;
  assert.equal(list.find(u => u.id === member.id).presence, 'online');
  assert.doesNotMatch(JSON.stringify(list), /passwordHash|tokenHash|csrfToken|invitationCode/);
  await f.app.missionStore.update(data => { for (const session of data.sessions.filter(s => s.userId === member.id)) session.lastSeenAt = new Date(Date.now() - 91_000).toISOString(); });
  list = (await request(captain, 'GET', '/directory/members')).json().members;
  assert.equal(list.find(u => u.id === member.id).presence, 'offline');
  assert.equal((await request(member, 'POST', '/auth/heartbeat')).statusCode, 200);
  assert.equal((await request(captain, 'GET', '/directory/members')).json().members.find(u => u.id === member.id).presence, 'online');
  await request(member, 'POST', '/auth/logout');
  const offline = (await request(captain, 'GET', '/directory/members')).json().members.find(u => u.id === member.id);
  assert.equal(offline.presence, 'offline'); assert.ok(offline.lastSeenAt);
  assert.equal((await request(member, 'POST', '/auth/heartbeat')).statusCode, 401);
});

test('typed hierarchy and user-defined folder context constrain Gemini without creating sectors as hardware', async () => {
  const project = createValidationProject(); project.context.sectors = [{ id: 'sector', name: 'Engenharia' }];
  project.context.folders = [{ id: 'system', name: 'Test system', parentId: 'sector', technicalKind: 'system' }, { id: 'subsystem', name: 'Test subsystem', parentId: 'system', technicalKind: 'subsystem' }, { id: 'component', name: 'Radio', parentId: 'subsystem', technicalKind: 'component' }];
  assert.equal(organizationError(project), null);
  assert.match(buildSystemPrompt(project, []), /technicalStructure/);
  assert.match(buildSystemPrompt(project, []), /NEVER automatic hardware systems/);
  const entities = [{ id: 'system', name: 'Test system', kind: 'system' }, { id: 'subsystem', name: 'Test subsystem', kind: 'subsystem', parentId: 'system' }, { id: 'component', name: 'Radio', kind: 'component', parentId: 'subsystem' }];
  assert.equal(technicalHierarchyError({ entities, relations: [] }), null);
  assert.match(technicalHierarchyError({ entities: entities.map(e => e.id === 'component' ? { ...e, parentId: 'system' } : e), relations: [] }), /must belong to a subsystem/);
  assert.match(respectsTechnicalFolders(project, { entities: entities.map(e => e.id === 'component' ? { ...e, kind: 'system' } : e) }), /Radio/);
  const invalid = entities.map(e => ({ ...e, description: '', properties: [], source: 'inferred', confidence: .5, evidenceRefs: [], ...(e.id === 'component' ? { parentId: 'system' } : {}) }));
  const artifact = { id: 'source', scope: 'project', ownerId: project.id, label: 'Source', url: `data:text/plain;base64,${Buffer.from('A test system contains a subsystem and a radio.').toString('base64')}` };
  project.context.projectArtifactIds = ['source'];
  const service = createSystemAiService({ apiKey: 'test', retryWait: async () => {}, fetch: async () => new Response(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify({ entities: invalid, relations: [], evidence: [], requirements: [] }) }] } }] })) });
  await assert.rejects(service.generate(project, [artifact]), error => error.code === 'SYSTEM_HIERARCHY_INVALID');
  assert.equal(suggestedSectors('competition').length, 6);
  assert.notDeepEqual(suggestedSectors('research'), suggestedSectors('competition'));
});

test('PDF lays out headings, tables, references and embedded images over multiple pages', async () => {
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF1sAAAAASUVORK5CYII=';
  const pdf = await renderArtifactPdf({ label: 'Revisão técnica', documentText: `# Referências\n\n## Ensaios\n\n| Item | Resultado |\n| --- | --- |\n| Rádio | Correto |\n\n![Figura](data:image/png;base64,${png})\n\n[Manual](https://example.test/manual)\n\n${'Documentação de engenharia.\n'.repeat(200)}` });
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.match(pdf.toString('latin1'), /\/Subtype \/Image/);
  assert.ok((pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length > 1);
});

test('migration retains existing sector assignments, bytes and custom roles', () => {
  const project = createValidationProject(); project.context.roles.push({ id: 'custom', name: 'Designer' });
  project.context.assignments = [{ memberId: 'm', roleId: 'custom', sectorId: 'a' }]; project.context.sectors = [{ id: 'a', name: 'Área' }];
  const data = { schemaVersion: 8, users: [], members: [], artifacts: [{ id: 'old', url: 'data:text/plain;base64,dGVzdA==', scope: 'project', ownerId: project.id }], sessions: [], teams: [], workspace: { project: { document: project, createdBy: 'owner' }, projects: {}, labs: {} } };
  const next = normalizeStoredData(data);
  assert.equal(next.schemaVersion, 10); assert.deepEqual(next.workspace.projects[project.id].document.context.assignments, project.context.assignments);
  assert.deepEqual(next.workspace.projects[project.id].document.context.roles, project.context.roles);
  assert.equal(next.artifacts[0].url, data.artifacts[0].url);
  assert.equal(next.workspace.projects[project.id].document.creatorId, 'owner');
});

test('stale organization saves cannot silently replace newer responsibilities', async t => {
  const f = await fixture(t), { request, captain } = f;
  const first = structuredClone(f.project), stale = structuredClone(f.project);
  first.context.sectors[0].name = 'Aviônica revisada';
  assert.equal((await request(captain, 'PUT', `/projects/${first.id}`, first)).statusCode, 200);
  stale.context.sectors[1].name = 'Estruturas antigas';
  const rejected = await request(captain, 'PUT', `/projects/${stale.id}`, stale);
  assert.equal(rejected.statusCode, 409); assert.equal(rejected.json().error, 'ORGANIZATION_CHANGED');
  assert.equal((await request(captain, 'GET', `/projects/${first.id}`)).json().project.context.sectors[0].name, 'Aviônica revisada');
});

test('team references have per-project folders without duplicated content or permission bypass', async t => {
  const f = await fixture(t), { request, captain, manager } = f;
  const shared = (await request(captain, 'POST', '/artifacts', { kind: 'document', label: 'Shared manual', url: 'https://example.test/manual', scope: 'team', ownerId: f.project.context.teamId })).json().artifact;
  let project = structuredClone(f.project);
  project.context.teamArtifactIds = [shared.id]; project.context.teamArtifactFolders = { [shared.id]: 'references' };
  let response = await request(captain, 'PUT', `/projects/${project.id}`, project);
  assert.equal(response.statusCode, 200, response.body); project = response.json().project;
  const outside = structuredClone(project); outside.context.teamArtifactFolders[shared.id] = 'structures';
  assert.equal((await request(manager, 'PUT', `/projects/${project.id}`, outside)).statusCode, 403);
  const removed = structuredClone(project); removed.context.folders = [];
  assert.equal((await request(captain, 'PUT', `/projects/${project.id}`, removed)).statusCode, 409);
  project.context.teamArtifactFolders[shared.id] = 'avionics';
  response = await request(manager, 'PUT', `/projects/${project.id}`, project);
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(f.app.missionStore.read().artifacts.filter(a => a.id === shared.id).length, 1);
  assert.equal(f.app.missionStore.read().artifacts.find(a => a.id === shared.id).ownerId, project.context.teamId);
});

test('sector responsibility does not grant administration of global profiles or teams', async t => {
  const f = await fixture(t), { request, captain, manager, member, outsider } = f;
  assert.equal((await request(manager, 'PATCH', `/team/members/${member.memberId}`, { missionRole: 'captain' })).statusCode, 403);
  assert.equal((await request(manager, 'POST', '/team/members', { email: 'unauthorized@example.test' })).statusCode, 410);
  assert.equal((await request(captain, 'PATCH', `/team/members/${outsider.memberId}`, { displayName: 'Wrong team' })).statusCode, 403);
  assert.equal((await request(captain, 'PATCH', `/team/members/${member.memberId}`, { displayName: 'Engineering member' })).statusCode, 200);
});

test('document templates preserve sector ACL including anonymous, advisor and manager boundaries', async t => {
  const { applyDocumentFolderTemplate } = await import('../shared/workspace-templates.mjs');
  const f = await fixture(t), { request, captain, manager, member, outsider } = f;
  const project = f.project;
  const organized = applyDocumentFolderTemplate(project, 'avionics', 'engineering');
  let response = await request(manager, 'PUT', `/projects/${project.id}`, organized);
  assert.equal(response.statusCode, 200, response.body);
  const stored = response.json().project;
  assert.equal(stored.context.folders.some(folder => folder.technicalKind), false, 'document categories do not assert hardware');
  const datasheet = stored.context.folders.find(folder => folder.name === 'Datasheets');
  assert.ok(datasheet);
  const uploaded = await request(member, 'POST', '/artifacts', file(stored, datasheet.id));
  assert.equal(uploaded.statusCode, 201, uploaded.body);
  assert.equal((await request(outsider, 'GET', `/artifacts/${uploaded.json().artifact.id}/pdf`)).statusCode, 404);
  assert.equal((await f.app.inject({ method: 'GET', url: `/api/artifacts/${uploaded.json().artifact.id}/pdf` })).statusCode, 401);
  const current = (await request(captain, 'GET', `/projects/${project.id}`)).json().project;
  assert.equal((await request(manager, 'PUT', `/projects/${project.id}`, applyDocumentFolderTemplate(current, 'structures', 'simple'))).statusCode, 403);
  assert.equal((await request(member, 'PUT', `/projects/${project.id}`, applyDocumentFolderTemplate(current, 'avionics', 'simple'))).statusCode, 403);
  await f.app.missionStore.update(data => { data.users.find(u => u.id === member.id).accessRole = 'advisor'; });
  assert.equal((await request(member, 'PATCH', `/artifacts/${uploaded.json().artifact.id}`, { label: 'Forbidden advisor edit' })).statusCode, 403);
});

test('program references point to authorized original artifacts, survive reload and clean up on deletion', async t => {
  const f = await fixture(t), { request, captain, manager, member, outsider } = f;
  const { ensureProgramReferenceFolder } = await import('../shared/workspace-templates.mjs');
  const pdf = await renderArtifactPdf({ label: 'Mission brief', documentText: '# Mission brief\n\nRequirements for the engineering mission.' });
  const uploaded = await request(captain, 'POST', '/artifacts', file(f.project, 'references', { documentText: undefined, label: 'Mission brief', url: `data:application/pdf;base64,${pdf.toString('base64')}`, fileName: 'mission.pdf', mimeType: 'application/pdf', size: pdf.length }));
  assert.equal(uploaded.statusCode, 201, uploaded.body);
  const id = uploaded.json().artifact.id;
  let project = ensureProgramReferenceFolder((await request(captain, 'GET', `/projects/${f.project.id}`)).json().project, 'pt');
  project.context.programArtifactIds = [id];
  assert.equal((await request(manager, 'PUT', `/projects/${project.id}`, project)).statusCode, 403);
  const saved = await request(captain, 'PUT', `/projects/${project.id}`, project);
  assert.equal(saved.statusCode, 200, saved.body); project = saved.json().project;
  assert.equal(f.app.missionStore.read().artifacts.filter(artifact => artifact.id === id).length, 1);
  assert.equal(f.app.missionStore.read().artifacts.find(artifact => artifact.id === id).folderId, 'references');
  assert.deepEqual((await request(member, 'GET', `/artifacts/${id}/content`)).rawPayload, pdf);
  assert.equal((await request(outsider, 'GET', `/artifacts/${id}/content`)).statusCode, 404);
  const unlinked = structuredClone(project); unlinked.context.programArtifactIds = ['foreign-artifact'];
  assert.equal((await request(captain, 'PUT', `/projects/${project.id}`, unlinked)).statusCode, 400);
  const missing = structuredClone(project); missing.context.programFolderId = 'missing-folder';
  assert.equal((await request(captain, 'PUT', `/projects/${project.id}`, missing)).statusCode, 400);
  await f.restart();
  assert.deepEqual((await request(captain, 'GET', `/projects/${project.id}`)).json().project.context.programArtifactIds, [id]);
  assert.equal((await request(captain, 'DELETE', `/artifacts/${id}`)).statusCode, 204);
  const final = (await request(captain, 'GET', `/projects/${project.id}`)).json().project;
  assert.deepEqual(final.context.programArtifactIds, []);
  assert.ok(!final.context.projectArtifactIds.includes(id));
});
