/** Read-only meeting archives. This module never imports the retired evidence pipeline. */
import PDFDocument from 'pdfkit';
import { fileURLToPath } from 'node:url';

const hidden = /^(?:authorization|headers|api_?key|token|secret|password|filePath|path|project_memory|project_memory_mode)$/iu;
export function archivePublicValue(value) {
  if (Array.isArray(value)) return value.map(archivePublicValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !hidden.test(key)).map(([key, child]) => [key, archivePublicValue(child)]));
}
function contentLines(value, depth = 0) {
  if (value === null || value === undefined) return [];
  if (typeof value !== 'object') return [String(value)];
  if (Array.isArray(value)) return value.flatMap(item => contentLines(item, depth));
  return Object.entries(value).flatMap(([key, child]) => [`${'  '.repeat(Math.min(depth, 6))}${key}:`, ...contentLines(child, depth + 1)]);
}
/** Lossless originals are stored separately from the readable projection. No AI runs here. */
export function createMeetingArchive(meeting, { review = null, transcripts = [], events = [], minutes = [], run = null } = {}, at = new Date().toISOString()) {
  const original = structuredClone({ review, transcripts, events, minutes, run });
  const lines = [meeting.title, 'Arquivo de reunião · somente leitura', `Reunião: ${meeting.id}`, ''];
  for (const transcript of transcripts) {
    lines.push(`Transcrição · versão ${transcript.version || 1}`, `Origem dos tempos: ${transcript.timesOrigin || 'não informada'}`, '');
    for (const turn of transcript.turns || []) lines.push(`${turn.id || ''}${turn.typedTime ? ` · ${turn.typedTime}` : Number.isFinite(turn.start) ? ` · ${turn.start}s` : ''} · ${turn.speaker?.label || 'Falante não identificado'}`, String(turn.text || ''), '');
  }
  if (run) {
    lines.push('Transcrição original', '');
    for (const speech of run.transcript || run.speech_ledger || []) lines.push(String(speech.text || speech.raw_text || ''), '');
    lines.push('Registro preservado', ...contentLines(archivePublicValue({ events: run.meeting_events || [], edits: run.block_edits || {}, minutes: run.minutes_document?.doc || run.minutes || run.meeting_minutes || null })), '');
  }
  if (events.length) lines.push('Registros e decisões', ...events.flatMap(event => [`${event.id} · ${(event.types || []).join(', ')}`, event.summary || '', `Falas: ${(event.turnIds || []).join(', ')}`, '']));
  for (const minute of minutes) lines.push(`Ata · versão ${minute.version} · ${minute.status}`, ...contentLines(archivePublicValue(minute.content)), 'Histórico da ata', ...contentLines(archivePublicValue(minute.history)), '');
  if (!transcripts.length && !events.length && !minutes.length && !run) lines.push('Não havia transcrição, ata ou blocos registrados nesta reunião.');
  return { schema: 'norte.meeting-archive.v1', meetingId: meeting.id, originalRoomKind: meeting.roomKind, archivedAt: at, archiveText: lines.join('\n'), original };
}
export function publicMeetingArchive(meeting) {
  const archive = meeting.archive;
  if (!archive || archive.schema !== 'norte.meeting-archive.v1' || archive.meetingId !== meeting.id) return null;
  return { ...archivePublicValue(archive), title: meeting.title, readonly: true };
}
export async function archivePdf(archive) {
  const document = new PDFDocument({ size: 'A4', margin: 48, info: { Title: archive.title, Subject: 'Arquivo de reunião · somente leitura' } });
  document.registerFont('Body', fileURLToPath(new URL('./fonts/DejaVuSans.ttf', import.meta.url)));
  const chunks = [], ready = new Promise((resolve, reject) => { document.on('data', chunk => chunks.push(chunk)); document.on('end', () => resolve(Buffer.concat(chunks))); document.on('error', reject); });
  document.font('Body').fontSize(10).text(archive.archiveText, { lineGap: 4 }); document.end(); return ready;
}
export function registerMeetingArchives(app, { store, requireAuth, access }) {
  const get = request => {
    const meeting = access.requireMeeting(store.read(), request.auth.user, request.params.id);
    const archive = publicMeetingArchive(meeting);
    if (!archive) throw Object.assign(new Error('Este arquivo de reunião ainda não está disponível.'), { statusCode: 404, code: 'MEETING_ARCHIVE_NOT_FOUND' });
    return archive;
  };
  app.get('/api/meetings/:id/archive', { preHandler: [requireAuth] }, async (request, reply) => reply.header('cache-control', 'no-store').send({ archive: get(request) }));
  app.get('/api/meetings/:id/archive/export', { preHandler: [requireAuth] }, async (request, reply) => {
    const archive = get(request), format = request.query.format || 'txt';
    if (!['txt', 'json', 'pdf'].includes(format)) throw Object.assign(new Error('Formato inválido.'), { statusCode: 400 });
    const content = format === 'pdf' ? await archivePdf(archive) : format === 'json' ? JSON.stringify(archive, null, 2) : archive.archiveText;
    await store.refresh?.(); access.requireMeeting(store.read(), request.auth.user, request.params.id);
    return reply.header('cache-control', 'no-store').header('content-disposition', `${format === 'pdf' ? 'inline' : 'attachment'}; filename="meeting-archive.${format}"`).type(format === 'pdf' ? 'application/pdf' : format === 'json' ? 'application/json' : 'text/plain; charset=utf-8').send(content);
  });
}
