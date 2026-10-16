/** Authenticated WebRTC signaling. Audio travels between authorized browsers,
 * optionally through TURN. SDP/candidates are short-lived and never persisted. */
import { createHmac, randomUUID } from 'node:crypto';

const fail = (statusCode, code, message) => { throw Object.assign(new Error(message), { statusCode, code }); };
const object = (properties, required = []) => ({ type: 'object', additionalProperties: false, properties, required });
const id = { type: 'string', minLength: 1, maxLength: 160 };
const ended = meeting => ['completed', 'ended', 'finished', 'done', 'interrupted', 'stopped'].includes(meeting.status);

export function meetingIceConfiguration(userId, env = process.env, now = Date.now()) {
  const urls = value => String(value || '').split(',').map(url => url.trim()).filter(Boolean);
  const stun = urls(env.NORTE_STUN_URLS || 'stun:stun.l.google.com:19302').filter(url => /^stuns?:[^\s/@]+$/u.test(url));
  const turn = urls(env.NORTE_TURN_URLS).filter(url => /^turns?:[^\s/@]+(?:\?transport=(?:udp|tcp))?$/u.test(url));
  const configured = turn.length > 0 && typeof env.NORTE_TURN_SECRET === 'string' && env.NORTE_TURN_SECRET.length >= 32;
  const iceServers = stun.length ? [{ urls: stun }] : [];
  if (configured) {
    const username = Math.floor(now / 1000 + 3600) + ':' + userId;
    const credential = createHmac('sha1', env.NORTE_TURN_SECRET).update(username).digest('base64');
    iceServers.push({ urls: turn, username, credential });
  }
  return { iceServers, relayConfigured: configured, expiresAt: new Date(now + 3600_000).toISOString() };
}

export function registerMeetingAudio(app, { store, requireAuth, requireCsrf, access }) {
  const rooms = new Map(), ttl = 40_000, signalTtl = 120_000, maxPeers = 12;
  const schema = body => ({ params: object({ id }, ['id']), body });
  const preHandler = [requireAuth, requireCsrf];
  const config = { rateLimit: { max: 600, timeWindow: '1 minute', keyGenerator: request => request.auth?.user.id || request.ip } };
  function roomFor(data, meeting) {
    const now = Date.now();
    for (const [key, value] of rooms) if (value.touched < now - signalTtl) rooms.delete(key);
    let room = rooms.get(meeting.id);
    if (!room) { room = { peers: new Map(), signals: [], sequence: 0, touched: now, captureUntil: 0 }; rooms.set(meeting.id, room); }
    room.touched = now;
    for (const [userId, peer] of room.peers) {
      const user = data.users.find(item => item.id === userId);
      if (peer.seen < now - ttl || !access.accessible(data, user, meeting)) room.peers.delete(userId);
    }
    room.signals = room.signals.filter(signal => signal.at > now - signalTtl && room.peers.get(signal.from)?.sessionId === signal.fromSessionId && room.peers.get(signal.to)?.sessionId === signal.toSessionId);
    return room;
  }
  function context(request, { live = true, session = true } = {}) {
    const data = store.read(), user = request.auth.user, meeting = access.requireMeeting(data, user, request.params.id);
    if (live && ended(meeting)) fail(409, 'MEETING_ENDED', 'Esta reunião já foi encerrada.');
    const room = roomFor(data, meeting), peer = room.peers.get(user.id);
    if (session && (!peer || peer.sessionId !== request.body.sessionId)) fail(409, 'AUDIO_SESSION_CHANGED', 'O áudio foi desconectado ou aberto em outra aba. Entre novamente.');
    return { data, user, meeting, room, peer };
  }
  function peers(room, meeting) {
    return [...room.peers].map(([userId, peer]) => ({ userId, sessionId: peer.sessionId, muted: peer.muted || (meeting.audioMutedUserIds || []).includes(userId), forcedMuted: (meeting.audioMutedUserIds || []).includes(userId) }));
  }
  // A live meeting can contain only typed messages. Recording is a separate,
  // host-controlled lease; a closed or disconnected host stops remote capture.
  app.post('/api/meetings/:id/audio/capture', { preHandler, config, schema: schema(object({ active: { type: 'boolean' } }, ['active'])) }, async request => {
    const data = store.read(), meeting = access.requireMeeting(data, request.auth.user, request.params.id, true), room = roomFor(data, meeting);
    room.captureUntil = request.body.active && !ended(meeting) ? Date.now() + 20_000 : 0;
    return { recording: room.captureUntil > Date.now() };
  });
  app.post('/api/meetings/:id/audio/join', { preHandler, config, schema: schema(object({})) }, async request => {
    const { user, meeting, room } = context(request, { session: false });
    if (!room.peers.has(user.id) && room.peers.size >= maxPeers) fail(409, 'AUDIO_FULL', 'O áudio comporta até 12 pessoas simultâneas. Você pode acompanhar e escrever na transcrição.');
    const sessionId = randomUUID(), muted = (meeting.audioMutedUserIds || []).includes(user.id);
    room.peers.set(user.id, { sessionId, muted, seen: Date.now() });
    return { sessionId, peers: peers(room, meeting), cursor: room.sequence, ...meetingIceConfiguration(user.id) };
  });
  app.post('/api/meetings/:id/audio/poll', { preHandler, config, schema: schema(object({ sessionId: id, after: { type: 'integer', minimum: 0 } }, ['sessionId', 'after'])) }, async request => {
    const { user, meeting, room, peer } = context(request); peer.seen = Date.now();
    const signals = room.signals.filter(signal => signal.to === user.id && signal.toSessionId === peer.sessionId && signal.sequence > request.body.after).map(signal => ({ sequence: signal.sequence, from: signal.from, fromSessionId: signal.fromSessionId, ...(signal.description ? { description: signal.description } : { candidate: signal.candidate }) }));
    return { peers: peers(room, meeting), signals, cursor: room.sequence, recording: meeting.status === 'running' && room.captureUntil > Date.now() };
  });
  app.post('/api/meetings/:id/audio/config', { preHandler, config, schema: schema(object({ sessionId: id }, ['sessionId'])) }, async request => {
    const { user } = context(request);
    return meetingIceConfiguration(user.id);
  });
  const candidate = object({ candidate: { type: 'string', maxLength: 2048 }, sdpMid: { anyOf: [{ type: 'string', maxLength: 128 }, { type: 'null' }] }, sdpMLineIndex: { anyOf: [{ type: 'integer', minimum: 0, maximum: 100 }, { type: 'null' }] }, usernameFragment: { anyOf: [{ type: 'string', maxLength: 256 }, { type: 'null' }] } }, ['candidate']);
  app.post('/api/meetings/:id/audio/signal', { preHandler, config, schema: schema(object({ sessionId: id, to: id, toSessionId: id, description: object({ type: { enum: ['offer', 'answer'] }, sdp: { type: 'string', minLength: 1, maxLength: 32768 } }, ['type', 'sdp']), candidate }, ['sessionId', 'to', 'toSessionId'])) }, async request => {
    const { user, room, peer } = context(request), target = room.peers.get(request.body.to);
    if (request.body.to === user.id || !target || target.sessionId !== request.body.toSessionId) fail(404, 'AUDIO_PEER_UNAVAILABLE', 'Essa pessoa não está mais no áudio.');
    if (Boolean(request.body.description) === Boolean(request.body.candidate)) fail(400, 'INVALID_AUDIO_SIGNAL', 'Sinalização de áudio inválida.');
    if (room.signals.length >= 3000) fail(429, 'AUDIO_SIGNAL_LIMIT', 'Aguarde um instante antes de reconectar o áudio.');
    peer.seen = Date.now();
    room.signals.push({ sequence: ++room.sequence, from: user.id, fromSessionId: peer.sessionId, to: request.body.to, toSessionId: target.sessionId, at: Date.now(), ...(request.body.description ? { description: request.body.description } : { candidate: request.body.candidate }) });
    return { sent: true };
  });
  app.post('/api/meetings/:id/audio/mute', { preHandler, config, schema: schema(object({ sessionId: id, muted: { type: 'boolean' } }, ['sessionId', 'muted'])) }, async request => {
    const { user, meeting, room, peer } = context(request);
    if (!request.body.muted && meeting.audioMutedUserIds?.includes(user.id)) fail(403, 'AUDIO_MUTED_BY_HOST', 'O anfitrião silenciou seu microfone. Aguarde a liberação.');
    peer.muted = request.body.muted; peer.seen = Date.now(); return { peers: peers(room, meeting) };
  });
  app.post('/api/meetings/:id/audio/moderate', { preHandler, config, schema: schema(object({ userId: id, muted: { type: 'boolean' } }, ['userId', 'muted'])) }, async request => store.update(data => {
    const meeting = access.requireMeeting(data, request.auth.user, request.params.id, true);
    if (request.body.userId === request.auth.user.id) fail(400, 'USE_SELF_MUTE', 'Use seu controle de microfone.');
    const target = data.users.find(user => user.id === request.body.userId);
    if (!access.accessible(data, target, meeting)) fail(404, 'AUDIO_PEER_UNAVAILABLE', 'Participante não disponível.');
    const muted = new Set(meeting.audioMutedUserIds || []);
    if (request.body.muted) muted.add(target.id); else muted.delete(target.id);
    meeting.audioMutedUserIds = [...muted];
    const peer = rooms.get(meeting.id)?.peers.get(target.id);
    // Releasing moderation only permits the person to unmute themselves.
    if (peer && request.body.muted) peer.muted = true;
    return { userId: target.id, forcedMuted: request.body.muted };
  }));
  app.post('/api/meetings/:id/audio/leave', { preHandler, config, schema: schema(object({ sessionId: id }, ['sessionId'])) }, async request => {
    const { room, user, peer } = context(request, { live: false, session: false });
    if (peer?.sessionId === request.body.sessionId) room.peers.delete(user.id);
    return { left: true };
  });
  app.addHook('onClose', async () => rooms.clear());
  return { assertCanSpeak(data, user, meeting, sessionId) {
    const room = roomFor(data, meeting), peer = room.peers.get(user.id);
    if (!peer || peer.sessionId !== sessionId || peer.muted || meeting.audioMutedUserIds?.includes(user.id) || meeting.status !== 'running' || room.captureUntil <= Date.now()) fail(403, 'AUDIO_NOT_RECORDING', 'Sua fala não está habilitada para transcrição nesta reunião.');
  } };
}
