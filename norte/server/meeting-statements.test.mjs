import assert from 'node:assert/strict';
import { test } from 'node:test';
import Fastify from 'fastify';
import { createMeetingAccess } from './meeting-service.mjs';
import { registerMeetingStatements, statementsOf } from './meeting-statements.mjs';

const run = id => ({
  id,
  transcript: [{ id: 'S1', chunk_id: 'C1', speaker: 'Lia', offsetMs: 44000 }],
  meeting_events: [
    { event_id: 'E1', chunk_id: 'C1', type: 'decision', text: 'Decisão de ' + id },
    { event_id: 'E2', chunk_id: 'C1', type: 'decision', status: 'superseded', text: 'Antiga' },
    { event_id: 'E3', chunk_id: 'C1', type: 'observation', text: 'Comentário' },
  ],
});
function fixture(meetings) {
  const data = {
    users: [
      { id: 'host', active: true, memberId: 'M1' },
      { id: 'guest', active: true, memberId: 'M2' },
    ],
    teams: [{ id: 'T1', memberIds: ['M1', 'M2'] }],
    workspace: { projects: {} },
    meetings: Object.fromEntries(
      meetings.map(item => [
        item.id,
        { teamId: 'T1', participantIds: [], ownerId: 'host', roomKind: 'meeting', status: 'done', ...item },
      ]),
    ),
  };
  return data;
}
async function statements(data, hooks = {}) {
  const app = Fastify(),
    reads = [];
  registerMeetingStatements(app, {
    store: { read: () => data },
    access: createMeetingAccess({ canAccessProject: () => true }),
    requireAuth: async request => {
      request.auth = { user: data.users.find(user => user.id === request.headers.actor) };
    },
    readEngine: async (_request, meeting) => {
      reads.push(meeting.id);
      hooks.onRead?.();
      return { value: JSON.stringify(run(meeting.id)) };
    },
  });
  try {
    const response = await app.inject({
      url: '/api/meetings/now/project-statements',
      headers: { actor: hooks.actor || 'host' },
    });
    return { status: response.statusCode, list: response.json().statements, reads };
  } finally {
    await app.close();
  }
}

test('only current decisions and requirements are read, with who said them and when', () => {
  assert.deepEqual(statementsOf(run('A'), 'Reunião A'), [
    { id: 'E1', meeting: 'Reunião A', speaker: 'Lia', offsetMs: 44000, text: 'Decisão de A' },
  ]);
});

test('a team meeting sees earlier team meetings of the same project and nothing else', async () => {
  const { list, reads } = await statements(
    fixture([
      { id: 'now', title: 'Agora', scope: 'team', status: 'running' },
      { id: 'team', title: 'Equipe', scope: 'team' },
      { id: 'sector', title: 'Setor', scope: 'sector', sectorId: 'S1' },
      { id: 'private', title: 'Privada', scope: 'private' },
      { id: 'open', title: 'Em andamento', scope: 'team', status: 'running' },
      { id: 'blocked', title: 'Com bloqueio', scope: 'team', blockedParticipantIds: ['guest'] },
      { id: 'other', title: 'Outro projeto', scope: 'team', projectId: 'P2' },
    ]),
  );
  assert.deepEqual(reads, ['team']);
  assert.deepEqual(
    list.map(item => item.meeting),
    ['Equipe'],
  );
});

test('a private meeting compares with no other meeting', async () => {
  const { status, reads } = await statements(
    fixture([
      { id: 'now', title: 'Agora', scope: 'private' },
      { id: 'team', title: 'Equipe', scope: 'team' },
    ]),
  );
  assert.equal(status, 200);
  assert.deepEqual(reads, []);
});

test('only the host can ask for the statements', async () => {
  const data = fixture([
    { id: 'now', title: 'Agora', scope: 'team' },
    { id: 'team', title: 'Equipe', scope: 'team' },
  ]);
  const { status, reads } = await statements(data, { actor: 'guest' });
  assert.equal(status, 403);
  assert.deepEqual(reads, []);
});

test('a meeting closed to the host while it is read is left out', async () => {
  const data = fixture([
    { id: 'now', title: 'Agora', scope: 'team' },
    { id: 'team', title: 'Equipe', scope: 'team' },
  ]);
  const { list } = await statements(data, {
    onRead: () => {
      data.meetings.team.blockedParticipantIds = ['host'];
    },
  });
  assert.deepEqual(list, []);
});
