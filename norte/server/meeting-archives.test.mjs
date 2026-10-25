import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { archiveLegacyMeetings, main } from '../scripts/archive-legacy-meetings.mjs';
import { createMeetingArchive, registerMeetingArchives, archivePdf } from './meeting-archives.mjs';
import { createMeetingAccess } from './meeting-service.mjs';

function fixture() {
  const db = new DatabaseSync(':memory:');
  for (const name of ['review_meetings', 'transcripts', 'meeting_events', 'minutes']) db.exec(`CREATE TABLE ${name} (meeting_id TEXT, created_at TEXT, data TEXT)`);
  const put = (name, row) => db.prepare(`INSERT INTO ${name} VALUES (?,?,?)`).run('meeting1', '2026-10-24', JSON.stringify(row));
  put('review_meetings', { agenda: [{ requirementId: 'REQ-1', text: 'Texto original' }] });
  put('transcripts', { id: 'T1', version: 1, timesOrigin: 'typed_in_text', turns: [{ id: 'F1', text: 'A medida foi 2 mm.', typedTime: '00:20', speaker: { label: 'Participante' } }] });
  put('minutes', { id: 'M1', version: 1, status: 'approved', content: { decisions: ['Repetir a medição.'] }, history: [{ action: 'approve', actorId: 'guest' }] });
  put('meeting_events', { id: 'E1', types: ['decision'], summary: 'Repetir a medição.', turnIds: ['F1'] });
  const meeting = { id: 'meeting1', title: 'Revisão real', roomKind: 'review', memoryMode: 'project', projectId: 'p1', ownerId: 'host', participantIds: ['guest'], revision: 1 };
  return { db, data: { meetings: { meeting1: meeting } }, meeting };
}
test('archives every transcript and minute version without modifying the original rows', () => {
  const f = fixture();
  const before = JSON.stringify(f.data), result = archiveLegacyMeetings(f.data, { evidenceDb: f.db, at: '2026-10-24' });
  assert.equal(JSON.stringify(f.data), before); assert.equal(result.migrated.length, 1);
  const archived = result.data.meetings.meeting1;
  assert.equal(archived.roomKind, 'archive'); assert.equal(archived.projectAccessRequired, true); assert.equal(archived.memoryMode, undefined);
  assert.match(archived.archive.archiveText, /A medida foi 2 mm\./); assert.match(archived.archive.archiveText, /aprov|approved/);
  assert.equal(archived.archive.original.minutes[0].history[0].actorId, 'guest'); assert.equal(f.db.prepare('SELECT COUNT(*) n FROM transcripts').get().n, 1);
  assert.equal(archiveLegacyMeetings(result.data, { evidenceDb: f.db }).migrated.length, 0); f.db.close();
});
test('dry run leaves store and directory unchanged; apply creates a backup', () => {
  const dir = mkdtempSync(join(tmpdir(), 'meeting-archive-'));
  try {
    const path = join(dir, 'store.json'), original = JSON.stringify({ meetings: {} }); writeFileSync(path, original);
    main(['--store', path]); assert.equal(readFileSync(path, 'utf8'), original); assert.deepEqual(readdirSync(dir), ['store.json']);
    main(['--store', path, '--apply']); assert.equal(readdirSync(dir).filter(name => name.includes('.bak')).length, 1);
  } finally { rmSync(dir, { recursive: true }); }
});
test('archives retain meeting ACL and project revocation, including platform admins', async () => {
  const f = fixture(); const data = archiveLegacyMeetings(f.data, { evidenceDb: f.db }).data; f.db.close();
  data.users = ['host', 'guest', 'admin'].map(id => ({ id, active: true, accessRole: id === 'admin' ? 'owner_admin' : 'user' })); data.workspace = { projects: { p1: { document: { id: 'p1' } } } };
  let projectAccess = true;
  const access = createMeetingAccess({ canAccessProject: () => projectAccess }), app = Fastify();
  registerMeetingArchives(app, { store: { read: () => data }, access, requireAuth: async request => { request.auth = { user: data.users.find(user => user.id === request.headers.actor) }; } });
  try {
    assert.equal((await app.inject({ url: '/api/meetings/meeting1/archive', headers: { actor: 'guest' } })).statusCode, 200);
    assert.equal((await app.inject({ url: '/api/meetings/meeting1/archive', headers: { actor: 'admin' } })).statusCode, 404);
    projectAccess = false; assert.equal((await app.inject({ url: '/api/meetings/meeting1/archive/export?format=json', headers: { actor: 'guest' } })).statusCode, 404);
  } finally { await app.close(); }
});
test('archive export renders PDF without asserting fresh approval', async () => {
  const archive = createMeetingArchive({ id: 'm', title: 'Arquivo', roomKind: 'beam' }, { run: { id: 'm', transcript: [{ text: 'Resultado preservado.' }] } });
  const pdf = await archivePdf({ ...archive, title: 'Arquivo' }); assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
});
