/** Offline conversion. Stop services and back up their databases before --apply.
 * Default is dry run: no files, schemas or source rows are changed.
 */
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, copyFileSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createMeetingArchive } from '../server/meeting-archives.mjs';

const hash = text => createHash('sha256').update(text).digest('hex');
const decode = row => ({ ...JSON.parse(row.data), ...Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'data').map(([key, value]) => [key.replace(/_([a-z])/gu, (_, char) => char.toUpperCase()), value])) });
function rows(database, table, id) {
  if (!database || !database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table)) return [];
  return database.prepare(`SELECT * FROM ${table} WHERE meeting_id=? ORDER BY created_at`).all(id).map(decode);
}
export function archiveLegacyMeetings(data, { evidenceDb, meetingDb, at = new Date().toISOString() } = {}) {
  const result = structuredClone(data), migrated = [];
  for (const meeting of Object.values(result.meetings || {})) {
    if (!['review', 'beam'].includes(meeting.roomKind)) continue;
    if (meeting.archive) throw new Error(`Arquivo preexistente inesperado: ${meeting.id}`);
    let payload;
    if (meeting.roomKind === 'review') {
      if (!evidenceDb) throw new Error('Informe --evidence-db para preservar reuniões de revisão.');
      payload = { review: rows(evidenceDb, 'review_meetings', meeting.id)[0] || null, transcripts: rows(evidenceDb, 'transcripts', meeting.id), events: rows(evidenceDb, 'meeting_events', meeting.id), minutes: rows(evidenceDb, 'minutes', meeting.id) };
    } else {
      if (!meetingDb) throw new Error('Informe --meeting-db para preservar reuniões de simulação.');
      const username = 'bridge.' + hash('meeting:' + meeting.id).slice(0, 25);
      const row = meetingDb.prepare('SELECT r.value FROM norte_records r JOIN norte_users u ON u.id=r.user_id WHERE u.username=? AND r.key=?').get(username, 'norte.meeting-room.session.v2.' + meeting.id);
      payload = { run: row?.value ? JSON.parse(row.value) : meeting.initialSnapshot || meeting.exampleSnapshot || null };
      if (payload.run && payload.run.id !== meeting.id) throw new Error(`Registro divergente: ${meeting.id}`);
    }
    meeting.archive = createMeetingArchive(meeting, payload, at);
    meeting.roomKind = 'archive'; meeting.status = 'archived'; meeting.revision = (meeting.revision || 0) + 1; meeting.updatedAt = at;
    migrated.push({ id: meeting.id, kind: meeting.archive.originalRoomKind, transcripts: payload.transcripts?.length || 0, minutes: payload.minutes?.length || 0, events: payload.events?.length || payload.run?.meeting_events?.length || 0 });
  }
  // Project access remains mandatory for previously linked meetings; memory itself is removed.
  for (const meeting of Object.values(result.meetings || {})) {
    if (meeting.memoryMode === 'project') meeting.projectAccessRequired = true;
    delete meeting.memoryMode; delete meeting.memoryRevision;
  }
  return { data: result, migrated };
}
export function main(args) {
  const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
  const path = option('--store'); if (!path) throw new Error('Uso: --store arquivo.json [--evidence-db arquivo.sqlite3] [--meeting-db arquivo.sqlite3] [--apply]');
  const original = readFileSync(path, 'utf8'), databases = [];
  const open = value => { if (!value) return; const db = new DatabaseSync(value, { readOnly: true }); databases.push(db); return db; };
  try {
    const result = archiveLegacyMeetings(JSON.parse(original), { evidenceDb: open(option('--evidence-db')), meetingDb: open(option('--meeting-db')) });
    if (args.includes('--apply')) {
      if (readFileSync(path, 'utf8') !== original) throw new Error('O arquivo mudou durante a conversão; nenhuma alteração aplicada.');
      const backup = `${path}.before-meeting-archive-${Date.now()}.bak`;
      copyFileSync(path, backup); const pending = `${path}.archive-pending-${process.pid}`;
      writeFileSync(pending, JSON.stringify(result.data, null, 2), { mode: 0o600, flag: 'wx' }); renameSync(pending, path);
      console.log(JSON.stringify({ applied: true, backup, migrated: result.migrated }));
    } else console.log(JSON.stringify({ applied: false, sourceHash: hash(original), migrated: result.migrated }));
    return result;
  } finally { for (const database of databases) database.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main(process.argv.slice(2));
