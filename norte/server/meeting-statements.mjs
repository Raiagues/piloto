/** Decisions and requirements of a team's earlier meetings, read by the alert monitor of the next meeting. */
const KINDS = new Set(['decision', 'requirement']);
const MEETINGS = 8,
  PER_MEETING = 40,
  MAX_TEXT = 600;

// A quote only reaches this room when everyone here could already open the meeting it came from.
function shareable(meeting, other) {
  if (other.id === meeting.id || other.projectId !== meeting.projectId || other.teamId !== meeting.teamId) return false;
  if (other.status !== 'done' || other.blockedParticipantIds?.length) return false;
  if (other.scope === 'team') return ['team', 'sector'].includes(meeting.scope);
  return other.scope === 'sector' && meeting.scope === 'sector' && other.sectorId === meeting.sectorId;
}

export function statementsOf(run, meetingTitle) {
  const spoken = new Map((run.transcript || []).map(entry => [entry.chunk_id || entry.id, entry]));
  return (run.meeting_events || [])
    .filter(event => KINDS.has(event.type) && event.status !== 'superseded' && typeof event.text === 'string')
    .slice(-PER_MEETING)
    .map(event => {
      const line = spoken.get(event.chunk_id);
      return {
        id: event.event_id,
        meeting: meetingTitle,
        speaker: line?.speaker || '',
        offsetMs: line?.offsetMs ?? 0,
        text: event.text.slice(0, MAX_TEXT),
      };
    });
}

export function registerMeetingStatements(app, { store, requireAuth, access, readEngine }) {
  const room = request => access.requireMeeting(store.read(), request.auth.user, request.params.id, true);
  function earlierMeetings(request, meeting) {
    const data = store.read();
    return Object.values(data.meetings || {})
      .filter(other => shareable(meeting, other) && access.accessible(data, request.auth.user, other))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, MEETINGS);
  }
  app.get('/api/meetings/:id/project-statements', { preHandler: [requireAuth] }, async request => {
    const read = [];
    for (const other of earlierMeetings(request, room(request))) {
      const key = encodeURIComponent('norte.meeting-room.session.v2.' + other.id),
        saved = await readEngine(request, other, '/api/records?key=' + key);
      if (saved.value) read.push({ other, run: JSON.parse(saved.value) });
    }
    // Access can change while the records are read.
    await store.refresh?.();
    const still = new Set(earlierMeetings(request, room(request)).map(other => other.id));
    return {
      statements: read
        .filter(({ other, run }) => still.has(other.id) && run.id === other.id)
        .flatMap(({ other, run }) => statementsOf(run, other.title)),
    };
  });
}
