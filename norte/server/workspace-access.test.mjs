import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildApp } from './app.mjs';
import { createValidationProject } from './test-support/project.mjs';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'norte-workspace-access-'));
  const app = await buildApp({ storeFile: join(directory, 'store.json'), logger: false, ai: { apiKey: '' }, demoAccount: true, evidence: false });
  t.after(async () => { await app.close(); await rm(directory, { force: true, recursive: true }); });
  const request = (actor, method, path, payload) => app.inject({ method, url: `/api${path}`, headers: actor?.headers || {}, ...(payload === undefined ? {} : { payload }) });
  async function register(name) {
    const response = await request(null, 'POST', '/auth/register', { name, login: name.toLowerCase(), password: 'workspace isolated test password' });
    assert.equal(response.statusCode, 201, response.body);
    return { ...response.json().user, headers: { cookie: [response.headers['set-cookie']].flat().filter(Boolean).map(value => value.split(';')[0]).join('; '), 'x-csrf-token': response.json().csrfToken } };
  }
  const admin = await register('Admin'), manager = await register('Manager'), member = await register('Member'), outsider = await register('Outsider');
  const team = (await request(manager, 'POST', '/teams', { name: 'Equipe real' })).json().team;
  await app.missionStore.update(data => {
    data.teams.find(item => item.id === team.id).memberIds.push(member.memberId);
    // A global role alone never makes the outsider a manager of this team.
    data.users.find(item => item.id === outsider.id).accessRole = 'manager';
  });
  return { app, request, admin, manager, member, outsider, team };
}

test('retired areas are unavailable to every account while documents, delivery and meetings remain accessible', async t => {
  const { app, request, admin, member, team } = await fixture(t);
  const project = createValidationProject();
  project.id = 'workspace-access-project'; project.name = 'Projeto de acesso';
  project.context.teamId = team.id; project.context.assignments = [{ memberId: member.memberId, roleId: 'captain', sectorId: '' }];
  const created = await request(member, 'POST', '/projects', project);
  assert.equal(created.statusCode, 201, created.body);
  const ordinarySave = await request(member, 'PUT', '/projects/workspace-access-project', { ...created.json().project, name: 'Nome atualizado' });
  assert.equal(ordinarySave.statusCode, 200, ordinarySave.body);
  for (const path of ['/brainstorm-ai/status', '/system-ai/status', '/workspace/labs/workspace-access-project', '/projects/workspace-access-project/knowledge', '/projects/workspace-access-project/idea-sessions', '/projects/workspace-access-project/idea-starters/preview', '/projects/workspace-access-project/system-history']) {
    for (const actor of [member, admin]) { const denied = await request(actor, 'GET', path); assert.equal(denied.statusCode, 404, `${path}: ${denied.body}`); }
  }
  for (const path of ['/artifacts', '/projects/workspace-access-project/delivery', '/meetings']) {
    const available = await request(member, 'GET', path);
    assert.equal(available.statusCode, 200, `${path}: ${available.body}`);
  }
  assert.equal((await request(null, 'POST', '/auth/demo', {})).statusCode, 404);
  assert.ok(app.missionStore.read().workspace.projects[project.id]);
});

test('professional profiles are scoped to their team, manager controlled, versioned and cannot grant permissions', async t => {
  const { app, request, manager, member, outsider, team } = await fixture(t);
  const path = `/teams/${team.id}/members/${member.memberId}/professional-profile`;
  const body = { roleName: 'Engenheira de sistemas', functionName: 'Revisar requisitos e rastreabilidade.', expectedVersion: 0 };
  assert.equal((await request(member, 'PATCH', path, body)).statusCode, 403, 'people cannot edit their own corporate role');
  assert.equal((await request(outsider, 'PATCH', path, body)).statusCode, 403, 'a global manager role gives no cross-team authority');
  const saved = await request(manager, 'PATCH', path, body);
  assert.equal(saved.statusCode, 200, saved.body); assert.equal(saved.json().membership.version, 1);
  assert.equal((await request(manager, 'PATCH', path, body)).statusCode, 409, 'stale writes are rejected');
  const profile = (await request(member, 'GET', '/profile')).json();
  assert.equal(profile.memberships.find(item => item.teamId === team.id).roleName, body.roleName);
  assert.equal(app.missionStore.read().users.find(user => user.id === member.id).accessRole, 'member');
  assert.equal((await request(manager, 'PATCH', `/teams/${team.id}/members/${outsider.memberId}/professional-profile`, body)).statusCode, 404);
  await app.missionStore.update(data => { data.teams.find(item => item.id === team.id).captainMemberId = member.memberId; });
  assert.equal((await request(manager, 'PATCH', path, { ...body, expectedVersion: 1 })).statusCode, 403, 'former managers lose edit authority immediately');
});

test('directories, team counts and project participants omit fictional and unregistered profiles without deleting stored work', async t => {
  const { app, request, manager, team } = await fixture(t);
  await app.missionStore.update(data => {
    data.users.push({ id: 'fictitious-user', memberId: 'fictitious-member', name: 'Pessoa de exemplo', active: true, isFictionalProfile: true });
    data.members.push({ id: 'fictitious-member', accountId: 'fictitious-user', displayName: 'Pessoa de exemplo' }, { id: 'unregistered-member', accountId: null, displayName: 'Sem conta' });
    data.teams.find(item => item.id === team.id).memberIds.push('fictitious-member', 'unregistered-member');
  });
  const people = (await request(manager, 'GET', '/platform/people')).json().users;
  assert.equal(people.some(user => user.id === 'fictitious-user'), false);
  const members = (await request(manager, 'GET', '/team/members')).json().members;
  assert.equal(members.some(member => ['fictitious-member', 'unregistered-member'].includes(member.id)), false);
  const visible = (await request(manager, 'GET', '/teams')).json().teams.find(item => item.id === team.id);
  assert.equal(visible.memberCount, 2);
  assert.equal(visible.memberIds.includes('fictitious-member'), false);
  assert.equal(app.missionStore.read().members.some(member => member.id === 'fictitious-member'), true, 'historical data is preserved');
});
