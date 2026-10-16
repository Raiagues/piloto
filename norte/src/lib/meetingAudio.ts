export type AudioPeer = { userId: string; sessionId: string; muted: boolean; forcedMuted: boolean };
export type MeetingAudioState = { joined: boolean; joining: boolean; muted: boolean; forcedMuted: boolean; recording: boolean; peers: AudioPeer[]; connected: string[]; relayConfigured: boolean; transcriptionAvailable: boolean };
type Signal = { from: string; fromSessionId: string; description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };
type Connection = { pc: RTCPeerConnection; sessionId: string; audio: HTMLAudioElement; candidates: RTCIceCandidateInit[]; makingOffer: boolean; retries: number };
type Api = <T>(path: string, init?: RequestInit) => Promise<T>;
type Recognition = { lang: string; continuous: boolean; interimResults: boolean; onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null; onerror: ((event: { error: string }) => void) | null; onend: (() => void) | null; start(): void; abort(): void };
type SpeechWindow = { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
export const emptyAudioState = (): MeetingAudioState => ({ joined: false, joining: false, muted: true, forcedMuted: false, recording: false, peers: [], connected: [], relayConfigured: false, transcriptionAvailable: typeof window !== "undefined" && !!((window as unknown as SpeechWindow).SpeechRecognition || (window as unknown as SpeechWindow).webkitSpeechRecognition) });

/** Small audio-only mesh. There is no recording transport: consenting members
 * hear each other directly, and final speech text is sent while capture is on. */
export function createMeetingAudio({ api, meetingId, userId, host, onState, onError }: { api: Api; meetingId: string; userId: string; host: boolean; onState: (value: MeetingAudioState) => void; onError: (message: string) => void }) {
  const base = `/meetings/${encodeURIComponent(meetingId)}/audio`;
  let state = emptyAudioState(), stream: MediaStream | null = null, sessionId = "", cursor = 0, timer = 0, generation = 0, disposed = false, polling = false, recording = false, failures = 0;
  let iceServers: RTCIceServer[] = [], speech: Recognition | null = null, speechTimer = 0, iceRefreshAt = 0;
  const connections = new Map<string, Connection>();
  const publish = (patch: Partial<MeetingAudioState> = {}) => { state = { ...state, ...patch, connected: [...connections].filter(([, connection]) => connection.pc.connectionState === "connected").map(([id]) => id) }; if (!disposed) onState({ ...state }); };
  const post = <T>(path: string, value: object = {}) => api<T>(base + path, { method: "POST", body: JSON.stringify(value) });
  const shouldTranscribe = () => !host && state.joined && recording && !state.muted && !state.forcedMuted;
  function stopSpeech() { window.clearTimeout(speechTimer); const old = speech; speech = null; if (old) { old.onend = null; old.abort(); } }
  function syncSpeech() {
    if (!shouldTranscribe()) { stopSpeech(); return; }
    if (speech || !state.transcriptionAvailable) return;
    const Constructor = (window as unknown as SpeechWindow).SpeechRecognition || (window as unknown as SpeechWindow).webkitSpeechRecognition;
    if (!Constructor) return;
    const recognition = new Constructor(); speech = recognition; recognition.lang = "pt-BR"; recognition.continuous = true; recognition.interimResults = false;
    recognition.onresult = event => {
      if (!shouldTranscribe()) return;
      for (let index = event.resultIndex; index < event.results.length; index++) {
        const result = event.results[index], text = result.isFinal ? result[0].transcript.trim() : "";
        if (text) void api(`/meetings/${encodeURIComponent(meetingId)}/contributions`, { method: "POST", body: JSON.stringify({ text: text.slice(0, 10000), clientId: "audio:" + sessionId + ":" + crypto.randomUUID(), kind: "speech", audioSessionId: sessionId }) }).catch(error => { if (shouldTranscribe()) onError(error instanceof Error ? error.message : "Não foi possível registrar esta fala. Você pode escrevê-la na transcrição."); });
      }
    };
    recognition.onerror = event => { if (["not-allowed", "service-not-allowed", "audio-capture"].includes(event.error)) { publish({ transcriptionAvailable: false }); stopSpeech(); onError("Seu áudio continua disponível; a transcrição de voz não está disponível neste navegador. Use o campo de mensagem."); } };
    recognition.onend = () => { if (speech === recognition) speech = null; if (shouldTranscribe()) speechTimer = window.setTimeout(syncSpeech, 350); };
    try { recognition.start(); } catch { speech = null; publish({ transcriptionAvailable: false }); }
  }
  function closePeer(id: string) { const connection = connections.get(id); if (!connection) return; connection.pc.onconnectionstatechange = null; connection.pc.close(); connection.audio.srcObject = null; connection.audio.remove(); connections.delete(id); }
  async function send(peer: AudioPeer, content: { description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit }) {
    if (!sessionId || disposed) return;
    try { await post("/signal", { sessionId, to: peer.userId, toSessionId: peer.sessionId, ...content }); } catch (error) { if (state.joined && connections.get(peer.userId)?.sessionId === peer.sessionId) onError(error instanceof Error ? error.message : "O áudio está tentando reconectar."); }
  }
  function connectionFor(peer: AudioPeer): Connection {
    const old = connections.get(peer.userId); if (old?.sessionId === peer.sessionId) return old;
    closePeer(peer.userId);
    const pc = new RTCPeerConnection({ iceServers }), audio = document.createElement("audio"); audio.autoplay = true; audio.hidden = true; audio.dataset.meetingAudioPeer = peer.userId; audio.muted = peer.muted; document.body.append(audio);
    const connection: Connection = { pc, sessionId: peer.sessionId, audio, candidates: [], makingOffer: false, retries: 0 }; connections.set(peer.userId, connection);
    for (const track of stream?.getAudioTracks() || []) pc.addTrack(track, stream!);
    pc.onicecandidate = event => { if (event.candidate) void send(peer, { candidate: event.candidate.toJSON() }); };
    pc.ontrack = event => { audio.srcObject = event.streams[0] || new MediaStream([event.track]); void audio.play().catch(() => onError("Toque em Ativar som para ouvir os participantes.")); };
    // Exactly one side initiates each pair. Muting toggles tracks, so it does
    // not renegotiate or silently request a new microphone permission.
    pc.onnegotiationneeded = async () => {
      if (userId > peer.userId || connection.makingOffer || pc.signalingState !== "stable") return;
      connection.makingOffer = true;
      try { await pc.setLocalDescription(); if (pc.localDescription) await send(peer, { description: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } }); }
      catch { if (state.joined) onError("Não foi possível conectar o áudio. Saia e entre novamente no áudio."); }
      finally { connection.makingOffer = false; }
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" && connection.retries++ < 2 && userId < peer.userId) pc.restartIce();
      else if (pc.connectionState === "failed") onError("Não foi possível conectar o áudio nesta rede. Tente reconectar ou use as mensagens.");
      publish();
    };
    return connection;
  }
  function syncPeers(peers: AudioPeer[]) {
    const own = peers.find(peer => peer.userId === userId);
    // Releasing a host mute never turns on the microphone automatically.
    if (own?.forcedMuted) { for (const track of stream?.getAudioTracks() || []) track.enabled = false; state.muted = true; }
    for (const peer of peers.filter(peer => peer.userId !== userId)) { const connection = connectionFor(peer); connection.audio.muted = peer.muted || peer.forcedMuted; }
    for (const [id, connection] of connections) if (!peers.some(peer => peer.userId === id && peer.sessionId === connection.sessionId)) closePeer(id);
    publish({ peers, forcedMuted: !!own?.forcedMuted }); syncSpeech();
  }
  async function receive(signal: Signal) {
    const peer = state.peers.find(item => item.userId === signal.from && item.sessionId === signal.fromSessionId); if (!peer || peer.userId === userId) return;
    const connection = connectionFor(peer), pc = connection.pc;
    if (signal.description) {
      await pc.setRemoteDescription(signal.description);
      for (const candidate of connection.candidates.splice(0)) await pc.addIceCandidate(candidate);
      if (signal.description.type === "offer") { await pc.setLocalDescription(); if (pc.localDescription) await send(peer, { description: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } }); }
    } else if (signal.candidate) { if (pc.remoteDescription) await pc.addIceCandidate(signal.candidate); else connection.candidates.push(signal.candidate); }
  }
  async function poll() {
    if (polling || !sessionId || disposed) return; polling = true; const activeSession = sessionId;
    try {
      const result = await post<{ peers: AudioPeer[]; signals: Signal[]; cursor: number; recording: boolean }>("/poll", { sessionId, after: cursor });
      if (sessionId !== activeSession) return;
      recording = result.recording; state.recording = recording; syncPeers(result.peers);
      for (const signal of result.signals) { try { await receive(signal); } catch { onError("Uma conexão de áudio está sendo refeita. Se persistir, saia e entre no áudio."); } }
      cursor = result.cursor; failures = 0;
      if (Date.now() >= iceRefreshAt) {
        const renewed = await post<{ iceServers: RTCIceServer[]; relayConfigured: boolean }>("/config", { sessionId });
        if (sessionId !== activeSession) return;
        iceServers = renewed.iceServers; iceRefreshAt = Date.now() + 30 * 60_000;
        for (const { pc } of connections.values()) pc.setConfiguration({ iceServers });
        publish({ relayConfigured: renewed.relayConfigured });
      }
    } catch (error) { const { status, code } = error as { status?: number; code?: string }; if (status && [401, 403, 404, 409].includes(status) || ++failures >= 5) { await leave(); if (code !== "MEETING_ENDED") onError(error instanceof Error ? error.message : "A conexão de áudio terminou. Entre novamente."); } }
    finally { polling = false; }
  }
  async function leave() {
    generation++; const previous = sessionId; sessionId = ""; window.clearInterval(timer); stopSpeech(); recording = false;
    for (const track of stream?.getTracks() || []) track.stop(); stream = null;
    for (const id of [...connections.keys()]) closePeer(id);
    publish({ joined: false, joining: false, muted: true, forcedMuted: false, recording: false, peers: [] });
    if (previous) await post("/leave", { sessionId: previous }).catch(() => {});
  }
  async function join() {
    if (state.joined || state.joining || disposed) return;
    const ticket = ++generation; publish({ joining: true });
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) throw Error("O áudio requer HTTPS e um navegador com suporte a chamadas. Você pode usar as mensagens.");
      const media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      if (ticket !== generation || disposed) { media.getTracks().forEach(track => track.stop()); return; }
      stream = media;
      const joined = await post<{ sessionId: string; peers: AudioPeer[]; cursor: number; iceServers: RTCIceServer[]; relayConfigured: boolean }>("/join");
      if (ticket !== generation || disposed) { media.getTracks().forEach(track => track.stop()); await post("/leave", { sessionId: joined.sessionId }); return; }
      sessionId = joined.sessionId; iceServers = joined.iceServers; cursor = joined.cursor; failures = 0; iceRefreshAt = Date.now() + 30 * 60_000;
      publish({ joined: true, joining: false, muted: false, relayConfigured: joined.relayConfigured }); syncPeers(joined.peers);
      timer = window.setInterval(() => void poll(), 1000); void poll();
    } catch (error) { await leave(); if (!disposed) onError(error instanceof Error ? error.message : "Não foi possível acessar o microfone."); }
  }
  async function setMuted(muted: boolean) {
    if (!state.joined || !muted && state.forcedMuted) return;
    // Silence immediately, even if the network is unavailable.
    if (muted) { stream?.getAudioTracks().forEach(track => { track.enabled = false; }); publish({ muted: true }); syncSpeech(); }
    try { const result = await post<{ peers: AudioPeer[] }>("/mute", { sessionId, muted }); if (!muted) { stream?.getAudioTracks().forEach(track => { track.enabled = true; }); publish({ muted: false }); } syncPeers(result.peers); }
    catch (error) { onError(error instanceof Error ? error.message : "Não foi possível atualizar o microfone."); }
  }
  async function activateSound() { for (const connection of connections.values()) await connection.audio.play(); }
  return { join, leave, setMuted, activateSound, moderate: (target: string, muted: boolean) => post("/moderate", { userId: target, muted }), snapshot: () => ({ ...state }), dispose: () => { disposed = true; void leave(); } };
}
