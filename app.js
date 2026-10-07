const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const micBtn = document.querySelector('#micBtn');
const transcript = document.querySelector('#transcript');
const buttonLabel = document.querySelector('#buttonLabel');
const language = document.querySelector('#language');
const timer = document.querySelector('#timer');
const toast = document.querySelector('#toast');
const exportBtn = document.querySelector('#exportBtn');
const transcriptPanel = document.querySelector('#panel-transcription');
const meetingName = document.querySelector('#meetingName');
const meetingStarted = document.querySelector('#meetingStarted');
const restartAudio = document.querySelector('#restartAudio');
const STORAGE_KEY = 'norte.transcription.v1';
let saved = null;
try {
  const candidate = JSON.parse(sessionStorage.getItem(STORAGE_KEY));
  if (candidate?.ledger?.schemaVersion === 1 && Array.isArray(candidate.ledger.records)) saved = candidate;
} catch (_) { /* Storage is optional; capture still works without it. */ }
const ledger = new NorteTranscript.Ledger(saved?.ledger);
const cutter = new NorteWindows.Cutter(saved?.windows);
const meeting = { name: saved?.meeting?.name || 'Reunião de requisitos', startedAt: saved?.meeting?.startedAt || null };
const takes = saved?.takes?.length ? saved.takes : [{ id: 1, startOffsetMs: 0, startedAt: null }];
let currentTake = takes.at(-1);
let pendingAudioRestart = false;
if (saved?.language) language.value = saved.language;

let elapsedMs = Number(saved?.elapsedMs) || 0;
let activeSince = null;
let desiredListening = false;
let recognition = null;
let phase = 'idle';
let restartTimer;
let watchdog;
let fastEnds = 0;
let toastTimer;
let storageWarning = false;
let micStream = null;
let audioContext = null;
let vadTimer = null;
let microphoneGeneration = 0;
const rows = new Map();
let inputRevision = '', classifierInputs = [];
const clock = {
  now: () => Math.round(elapsedMs + (activeSince === null ? 0 : performance.now() - activeSince)),
  resume() { if (activeSince === null) activeSince = performance.now(); },
  pause() { elapsedMs = this.now(); activeSince = null; },
};

function formatTime(ms) {
  const seconds = Math.floor(ms / 1000);
  const hh = Math.floor(seconds / 3600);
  const mm = Math.floor(seconds / 60) % 60;
  return (hh ? String(hh).padStart(2, '0') + ':' : '') +
    String(mm).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0');
}
function showToast(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add('show');
  toastTimer = setTimeout(() => toast.classList.remove('show'), 4500);
}
function renderMeeting() {
  meetingName.value = meeting.name;
  if (document.body.dataset.page === 'live') document.title = 'Norte · ' + meeting.name;
  document.querySelector('.canvas-caption').textContent = meeting.name.toLocaleUpperCase('pt-BR');
  const date = meeting.startedAt && new Date(meeting.startedAt);
  meetingStarted.textContent = date ? date.toLocaleDateString('pt-BR') + ' · ' + date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : 'Ainda não iniciada';
  if (date) { meetingStarted.dateTime = date.toISOString(); meetingStarted.title = 'Início da reunião · ' + date.toLocaleString('pt-BR'); }
}
meetingName.addEventListener('change', () => {
  meeting.name = meetingName.value.trim().slice(0, 80) || meeting.name;
  renderMeeting(); persist();
});
meetingName.addEventListener('keydown', event => {
  if (event.key === 'Enter') { event.preventDefault(); meetingName.blur(); }
  if (event.key === 'Escape') { meetingName.value = meeting.name; meetingName.blur(); }
});
function takeTime() { return Math.max(0, clock.now() - currentTake.startOffsetMs); }
function persist() {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ ledger: ledger.snapshot(), windows: cutter.snapshot(), classification: NorteClassifier.snapshot(), elapsedMs: clock.now(), language: language.value, meeting, takes }));
  } catch (_) {
    if (!storageWarning && ledger.records.length) {
      storageWarning = true;
      showToast('Não foi possível salvar nesta aba. Baixe a transcrição para guardá-la.');
    }
  }
}
function updateControls() {
  const isActive = desiredListening && phase === 'listening';
  micBtn.classList.toggle('active', isActive);
  micBtn.setAttribute('aria-pressed', String(desiredListening));
  micBtn.disabled = phase === 'starting' || phase === 'stopping';
  language.disabled = phase !== 'idle';
  const labels = { starting: 'Conectando…', stopping: 'Pausando…', listening: 'Pausar reunião', reconnecting: 'Reconectando…' };
  buttonLabel.textContent = labels[phase] || (clock.now() || ledger.records.length ? 'Retomar reunião' : 'Iniciar reunião');
  timer.textContent = formatTime(takeTime());
  timer.title = 'Tomada ' + currentTake.id + ' · tempo de escuta';
  restartAudio.disabled = !SpeechRecognition || !meeting.startedAt || phase === 'starting' || phase === 'stopping';
  exportBtn.disabled = !ledger.records.length;
}
function render() {
  const follow = transcriptPanel.scrollHeight - transcriptPanel.scrollTop - transcriptPanel.clientHeight < 48;
  const segments = ledger.segments();
  if (!segments.length) {
    transcript.replaceChildren(Object.assign(document.createElement('p'), { className: 'placeholder', textContent: 'A transcrição aparecerá aqui' }));
    rows.clear();
    return;
  }
  transcript.querySelector('.placeholder')?.remove();
  const current = new Set(segments.map(segment => segment.id));
  for (const [id, row] of rows) {
    if (!current.has(id)) { row.remove(); rows.delete(id); }
  }
  segments.forEach(segment => {
    let row = rows.get(segment.id);
    if (!row) {
      row = document.createElement('div');
      row.className = 'transcript-entry';
      row.innerHTML = '<time class="transcript-time"></time><div><div class="transcript-meta"></div><p class="transcript-text"></p></div>';
      rows.set(segment.id, row);
      transcript.append(row);
    }
    row.dataset.status = segment.status;
    row.dataset.segmentId = segment.id;
    const timestamp = row.querySelector('time');
    const source = ledger.records.find(record => record.id === segment.sourceId);
    const take = takes.find(item => item.id === source?.takeId) || takes[0];
    timestamp.textContent = formatTime(Math.max(0, segment.startMs - take.startOffsetMs));
    timestamp.dateTime = 'PT' + (segment.startMs / 1000).toFixed(3) + 'S';
    timestamp.title = 'Tempo de escuta aproximado: ' + formatTime(segment.startMs) + '–' + formatTime(segment.endMs);
    row.querySelector('.transcript-meta').textContent = segment.speaker + (takes.length > 1 ? ' · Tomada ' + take.id : '') + (segment.status === 'unconfirmed' ? ' · Não confirmado' : '');
    const body = row.querySelector('.transcript-text');
    if (body.textContent !== segment.text.trim()) body.textContent = segment.text.trim();
  });
  // Revised interim hypotheses may split or merge; restore source order without replacing rows.
  segments.forEach((segment, index) => {
    const row = rows.get(segment.id);
    if (transcript.children[index] !== row) transcript.insertBefore(row, transcript.children[index] || null);
  });
  if (follow) transcriptPanel.scrollTop = transcriptPanel.scrollHeight;
  updateControls();
}
function updateWindows() {
  cutter.tick(clock.now());
  const revision = [ledger.revision, cutter.sequence, cutter.windows.at(-1)?.endMs].join(':');
  if (revision !== inputRevision) {
    inputRevision = revision;
    classifierInputs = cutter.classificationView(ledger.records);
  }
  NorteClassifier.update(classifierInputs, clock.now());
}
async function startPauseDetection() {
  const generation = ++microphoneGeneration;
  if (!navigator.mediaDevices?.getUserMedia) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    if (generation !== microphoneGeneration || !desiredListening) { stream.getTracks().forEach(track => track.stop()); return; }
    micStream = stream;
    audioContext = new AudioContext();
    await audioContext.resume();
    if (generation !== microphoneGeneration) return;
    const analyser = audioContext.createAnalyser(); analyser.fftSize = 1024;
    audioContext.createMediaStreamSource(stream).connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    vadTimer = setInterval(() => {
      if (phase !== 'listening') return;
      analyser.getFloatTimeDomainData(samples);
      const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
      cutter.voice(rms > .015, clock.now());
      updateWindows();
    }, 100);
  } catch (_) {
    // Browsers without a second audio stream still provide speech-start/end signals.
    if (generation === microphoneGeneration) stopPauseDetection();
  }
}
function stopPauseDetection() {
  microphoneGeneration++;
  clearInterval(vadTimer); vadTimer = null;
  micStream?.getTracks().forEach(track => track.stop()); micStream = null;
  if (audioContext) { audioContext.close().catch(() => {}); audioContext = null; }
}
function finishRun(engine) {
  if (recognition !== engine) return;
  clearTimeout(watchdog);
  clock.pause();
  ledger.finishRun();
  if (!desiredListening) { cutter.flush(clock.now(), 'manual'); stopPauseDetection(); }
  else cutter.voice(false, clock.now());
  recognition = null;
  updateWindows();
  persist();
  render();
  if (pendingAudioRestart) { beginNewTake(); return; }
  if (desiredListening) {
    phase = 'reconnecting';
    updateControls();
    restartTimer = setTimeout(startRun, 500);
  } else {
    phase = 'idle';
    updateControls();
  }
}
function fail(engine, message) {
  if (recognition !== engine) return;
  desiredListening = false;
  pendingAudioRestart = false;
  try { engine.abort(); } catch (_) {}
  finishRun(engine);
  showToast(message);
}
function startRun() {
  if (!desiredListening || recognition) return;
  const engine = new SpeechRecognition();
  recognition = engine;
  ledger.beginRun();
  phase = 'starting';
  updateControls();
  engine.continuous = true;
  engine.interimResults = true;
  engine.lang = language.value;
  const requestedAt = performance.now();
  engine.onstart = () => {
    if (recognition !== engine) return;
    clearTimeout(watchdog);
    if (!desiredListening) { engine.stop(); return; }
    clock.resume();
    const startedAt = new Date().toISOString();
    meeting.startedAt ||= startedAt;
    currentTake.startedAt ||= startedAt;
    renderMeeting(); persist();
    phase = 'listening';
    updateControls();
  };
  engine.onspeechstart = () => {
    if (recognition === engine) { ledger.speechStart(clock.now()); cutter.voice(true, clock.now()); }
  };
  engine.onspeechend = () => { if (recognition === engine) cutter.voice(false, clock.now()); };
  engine.onresult = event => {
    if (recognition !== engine) return;
    fastEnds = 0;
    ledger.ingest(event.results, event.resultIndex, clock.now(), engine.lang);
    const recent = ledger.records.filter(record => record.runId === ledger.runId && record.resultIndex >= event.resultIndex);
    for (const record of recent) {
      record.takeId ??= currentTake.id;
      for (const word of record.wordMarks || []) cutter.ensure(word.atMs);
    }
    // If level detection is unavailable, final recognition is a best-effort pause signal.
    if (!vadTimer && recent.length && recent.every(record => record.status === 'final')) cutter.voice(false, clock.now());
    updateWindows();
    render();
    persist();
  };
  engine.onerror = event => {
    if (event.error === 'no-speech') return;
    if (event.error === 'aborted' && !desiredListening) { finishRun(engine); return; }
    const messages = {
      'not-allowed': 'Permita o acesso ao microfone para iniciar.',
      'service-not-allowed': 'O navegador bloqueou o serviço de transcrição.',
      'audio-capture': 'Não foi possível acessar o microfone.',
      'network': 'A conexão com o serviço de transcrição falhou. Você pode retomar.',
    };
    fail(engine, messages[event.error] || 'A transcrição foi interrompida. Você pode retomar.');
  };
  engine.onend = () => {
    if (recognition !== engine) return;
    fastEnds = performance.now() - requestedAt < 1500 ? fastEnds + 1 : 0;
    if (desiredListening && fastEnds >= 3) {
      desiredListening = false;
      showToast('O serviço de voz está encerrando a conexão. Tente retomar.');
    }
    finishRun(engine);
  };
  watchdog = setTimeout(() => fail(engine, 'O microfone demorou para responder. Confira a permissão e tente novamente.'), 12000);
  try { engine.start(); }
  catch (_) { fail(engine, 'Não foi possível iniciar o microfone.'); }
}
function pauseCapture() {
  desiredListening = false;
  clearTimeout(restartTimer);
  clock.pause();
  stopPauseDetection();
  if (!recognition) {
    cutter.flush(clock.now(), 'manual'); updateWindows(); phase = 'idle'; updateControls(); persist();
    if (pendingAudioRestart) beginNewTake();
    return;
  }
  const engine = recognition;
  phase = 'stopping';
  updateControls();
  clearTimeout(watchdog);
  // stop() still allows the browser to send a late final result.
  watchdog = setTimeout(() => {
    try { engine.abort(); } catch (_) {}
    finishRun(engine);
  }, 4000);
  try { engine.stop(); } catch (_) { finishRun(engine); }
}
function beginNewTake() {
  pendingAudioRestart = false;
  currentTake = { id: currentTake.id + 1, startOffsetMs: clock.now(), startedAt: null };
  takes.push(currentTake);
  cutter.takeId = currentTake.id;
  cutter.takeOffsetMs = currentTake.startOffsetMs;
  NorteClassifier.beginTake(cutter.sequence + 1);
  render(); persist();
  desiredListening = true; fastEnds = 0;
  startPauseDetection(); startRun();
}
micBtn.addEventListener('click', () => {
  if (!SpeechRecognition) { showToast('A transcrição não está disponível neste navegador. Tente o Chrome.'); return; }
  if (!desiredListening) {
    desiredListening = true; fastEnds = 0;
    startPauseDetection(); startRun();
  } else pauseCapture();
});
restartAudio.addEventListener('click', () => {
  if (restartAudio.disabled) return;
  pendingAudioRestart = true;
  pauseCapture();
});
language.addEventListener('change', persist);
window.addEventListener('norte:page-changing', event => {
  if (!event.detail.manual) return;
  pendingAudioRestart = false;
  if (desiredListening) { pauseCapture(); showToast('Áudio pausado ao mudar de página.'); }
});
window.addEventListener('norte:notice', event => showToast(event.detail));
setInterval(() => { timer.textContent = formatTime(takeTime()); updateWindows(); }, 100);
setInterval(() => { if (activeSince !== null) persist(); }, 2000);
window.addEventListener('pagehide', persist);

// Read-only export includes immutable source records, takes and actual model responses.
window.norteSession = Object.freeze({
  getSnapshot: () => ({ ...ledger.snapshot(), schemaVersion: 2, meeting: { ...meeting }, takes: takes.map(take => ({ ...take })), currentTakeElapsedMs: takeTime(), segments: ledger.segments(), fullText: ledger.records.filter(record => record.status === 'final').map(record => record.text).join(' '), packets: cutter.view(ledger.records), classifierInputs: cutter.classificationView(ledger.records), classification: NorteClassifier.snapshot(), contextPolicy: 'same-utterance-prefix', timestampPrecision: 'browser-event-estimate', audioStored: false, elapsedMs: clock.now() }),
  getPackets: () => cutter.view(ledger.records),
  getClassifierInputs: () => cutter.classificationView(ledger.records),
});
exportBtn.addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(window.norteSession.getSnapshot(), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'norte-transcricao-' + ledger.sessionId + '.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

document.querySelector('#shareBtn').addEventListener('click', async () => {
  if (['localhost', '127.0.0.1', ''].includes(location.hostname)) {
    showToast('Esta reunião é local. Compartilhamento online ainda não está disponível.');
    return;
  }
  try { await navigator.clipboard.writeText(location.href); showToast('Link copiado'); }
  catch (_) { showToast('Não foi possível copiar o link.'); }
});
renderMeeting();
render();
updateControls();
updateWindows();
NorteClassifier.init(saved?.classification, persist);
