/* The Norte account owns this meeting. Legacy UI requests remain on this
 * origin and pass through its authenticated, per-meeting gateway. */
(function (root, factory) {
  'use strict';
  const library = factory();
  if (typeof module === 'object' && module.exports) module.exports = library;
  if (root.NORTE_MEETING_BOOTSTRAP) root.NorteMeetingBridge = library.create(root, root.NORTE_MEETING_BOOTSTRAP);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const INDEX = 'norte.meeting-room.index.v2';
  const sessionKey = id => 'norte.meeting-room.session.v2.' + id;
  const ID = /^[A-Za-z0-9_.:-]{1,160}$/;
  function configuration(boot) {
    if (!boot || !ID.test(boot.meeting?.id || '') || !boot.user?.id || !boot.csrfToken) throw Error('A reunião não possui uma sessão válida.');
    const meeting = boot.meeting;
    return { meeting, user: boot.user, csrfToken: boot.csrfToken, apiBase: '/api/meetings/' + encodeURIComponent(meeting.id) + '/legacy',
      host: meeting.ownerId === boot.user.id && !meeting.example, returnUrl: typeof boot.returnUrl === 'string' && /^\/(?!\/)/.test(boot.returnUrl) && !/[\\\u0000-\u001f]/.test(boot.returnUrl) ? boot.returnUrl : '/#/meetings' };
  }
  function legacyURL(value, origin, apiBase) {
    const url = new URL(typeof value === 'string' ? value : value.url, origin);
    if (url.origin !== origin || !/^\/api\//.test(url.pathname) || /^\/api\/meetings(?:\/|$)/.test(url.pathname) || /^\/api\/meeting-invitations(?:\/|$)/.test(url.pathname)) return null;
    return apiBase + url.pathname.slice(4) + url.search;
  }
  function contributionId(row) { return 'contribution:' + row.id; }
  function wasContributed(run, row) { return (run.transcript || []).some(entry => entry.segmentId === contributionId(row)); }
  function readView(run, meetingId) {
    if (!run || run.readonly_projection !== 'norte.meeting-view.v1' || run.id !== meetingId || !['meeting_events', 'meeting_threads', 'meeting_relations', 'records', 'transcript'].every(key => Array.isArray(run[key]))) throw Error('A visualização compartilhada da reunião é inválida.');
    return JSON.parse(JSON.stringify(run));
  }
  function create(root, boot) {
    const config = configuration(boot), nativeFetch = root.fetch.bind(root), document = root.document;
    let hooks = null, timer = null, polling = false, stopped = false, conflict = false, cursor = 0, displayCursor = 0, lastHeartbeat = 0, captureActive = false, lastCaptureHeartbeat = 0;
    const displayed = new Map();
    let captureTail = Promise.resolve();
    const versions = new Map();
    let tail = Promise.resolve();
    const enqueue = task => { const next = tail.catch(() => {}).then(task); tail = next; return next; };
    async function request(path, options = {}) {
      const headers = new root.Headers(options.headers);
      if (!['GET', 'HEAD'].includes((options.method || 'GET').toUpperCase())) headers.set('x-csrf-token', config.csrfToken);
      if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
      const response = await nativeFetch(path, { ...options, headers, credentials: 'same-origin', cache: 'no-store' });
      return response;
    }
    async function body(response) {
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw Object.assign(Error(data.message || (typeof data.error === 'string' && !/^[A-Z_]+$/.test(data.error) ? data.error : '') || (response.status === 401 ? 'Sua sessão terminou. Entre novamente no Norte.' : 'Não foi possível acessar esta reunião.')), { status: response.status, code: data.code || data.error });
      return data;
    }
    function locked() { return Error('A reunião foi alterada em outra aba. O processamento foi interrompido para preservar os dois registros. Recarregue a página antes de continuar.'); }
    const storage = {
      read(key) { return enqueue(async () => {
        if (key === INDEX) return JSON.stringify([{ id: config.meeting.id, title: config.meeting.title, date: config.meeting.createdAt, status: config.meeting.status, room_kind: config.meeting.roomKind, points: 0 }]);
        if (key !== sessionKey(config.meeting.id)) throw Error('Esta página só pode abrir a reunião selecionada.');
        const result = await body(await request(config.apiBase + '/records?key=' + encodeURIComponent(key)));
        versions.set(key, result.version || 0); return result.value;
      }); },
      write(key, value) { return enqueue(async () => {
        if (!config.host) throw Error('Somente o anfitrião pode atualizar a reunião.');
        if (conflict) throw locked();
        if (key !== sessionKey(config.meeting.id)) throw Error('Registro fora desta reunião.');
        const run = JSON.parse(value); if (run.id !== config.meeting.id) throw Error('Identificador da reunião inválido.');
        if (!versions.has(key)) throw Error('Carregue a versão salva antes de atualizar a reunião.');
        const response = await request(config.apiBase + '/records', { method: 'POST', body: JSON.stringify({ key, value, expected_version: versions.get(key) }) });
        if (response.status === 409) { conflict = true; root.dispatchEvent(new root.CustomEvent('norte:meeting-conflict')); throw locked(); }
        const result = await body(response); versions.set(key, result.version);
        config.meeting.title = run.title; config.meeting.status = run.status;
      }); },
      // The library belongs to the Norte application; the embedded UI owns no index.
      change(key, mutator) { if (key !== INDEX) return Promise.reject(Error('Registro fora desta reunião.')); return storage.read(INDEX).then(raw => mutator(raw).result); },
      subscribe() { return () => {}; }, close() {}
    };
    root.fetch = function (input, init = {}) {
      const mapped = legacyURL(input, root.location.origin, config.apiBase);
      if (!mapped) return nativeFetch(input, init);
      const method = String(init.method || input?.method || 'GET').toUpperCase();
      // All write permissions are also checked by the gateway. Do not make an
      // ordinary participant pay for duplicate classification/editor requests.
      if (!config.host && method !== 'GET') return Promise.resolve(new root.Response(JSON.stringify({ error: 'Somente o anfitrião processa esta reunião.', code: 'MEETING_HOST_REQUIRED' }), { status: 403, headers: { 'Content-Type': 'application/json' } }));
      return request(mapped, init);
    };
    document.body.dataset.auth = 'on'; document.body.dataset.role = config.user.role === 'admin' ? 'admin' : 'user'; document.body.dataset.integratedMeeting = 'true'; document.body.dataset.meetingRole = config.host ? 'host' : 'participant';
    const target = new URL(root.location.href); target.searchParams.set('meeting', config.meeting.id); target.hash = '#reuniao'; root.history.replaceState(null, '', target);
    document.body.dataset.page = 'meeting';
    const style = document.createElement('style');
    style.textContent = 'body[data-integrated-meeting]{--sidebar-width:0px}body[data-integrated-meeting]>.sidebar,body[data-integrated-meeting]>#sidebarOverlay,body[data-integrated-meeting] #roomBack,body[data-integrated-meeting] #roomNew,body[data-integrated-meeting] .account-menu{display:none!important}body[data-integrated-meeting]>.app-shell{width:100%;margin-left:0;padding:0 14px 14px}body[data-meeting-role="participant"] #roomImport,body[data-meeting-role="participant"] #roomFinish,body[data-meeting-role="participant"] #roomStop,body[data-meeting-role="participant"] .room-node-review,body[data-meeting-role="participant"] .room-topic-rename{display:none!important}';
    document.head.append(style);
    // The embedded room follows the parent theme without reloading or stopping
    // a recording. Only known CSS tokens are copied; no account data is shared.
    if (root.parent && root.parent !== root && typeof root.getComputedStyle === 'function') {
      const syncTheme = () => {
        try {
          const parentRoot = root.parent.document.documentElement, parentStyle = root.getComputedStyle(parentRoot);
          document.documentElement.dataset.theme = parentRoot.dataset.theme === 'dark' ? 'dark' : 'light';
          for (const name of ['bg', 'surface', 'surface-muted', 'surface-raised', 'text', 'text-secondary', 'text-muted', 'border', 'border-strong', 'accent', 'accent-hover', 'accent-soft', 'on-accent', 'link', 'success', 'warning', 'danger', 'overlay', 'shadow', 'radius', 'radius-panel']) {
            const value = parentStyle.getPropertyValue('--norte-' + name).trim();
            if (value) document.documentElement.style.setProperty('--norte-' + name, value);
          }
        } catch { /* A standalone room keeps its own palette. */ }
      };
      syncTheme(); root.parent.addEventListener('norte:theme-change', syncTheme);
      root.addEventListener('pagehide', () => root.parent.removeEventListener('norte:theme-change', syncTheme), { once: true });
    }
    root.addEventListener('norte:meeting-running', event => {
      if (root.parent !== root) root.parent.postMessage({ type: 'norte:meeting-running', meetingId: config.meeting.id, running: !!event.detail.running }, root.location.origin);
    });
    function updateCapture() {
      if (!config.host) return Promise.resolve();
      captureTail = captureTail.catch(() => {}).then(async () => {
        await body(await request('/api/meetings/' + encodeURIComponent(config.meeting.id) + '/audio/capture', { method: 'POST', body: JSON.stringify({ active: captureActive }) }));
        lastCaptureHeartbeat = Date.now();
      });
      return captureTail;
    }
    root.addEventListener('norte:meeting-capture', event => {
      captureActive = event.detail?.recording === true;
      void updateCapture().catch(error => hooks?.notice(error.message));
    });
    root.addEventListener('message', event => {
      if (event.origin !== root.location.origin || event.source !== root.parent || event.data?.meetingId !== config.meeting.id) return;
      if (event.data.type === 'norte:meeting-title' && config.host && typeof event.data.title === 'string' && event.data.title.trim() && event.data.title.length <= 160) {
        config.meeting.title = event.data.title.trim(); hooks?.title?.(config.meeting.title);
      }
      if (event.data.type === 'norte:meeting-audio-mute' && config.host) hooks?.audioMute?.(event.data.muted === true);
    });
    async function poll() {
      if (polling || stopped || !hooks) return; polling = true;
      try {
        if (config.host && captureActive && Date.now() - lastCaptureHeartbeat > 8000) await updateCapture();
        if (Date.now() - lastHeartbeat > 25_000) { await body(await request('/api/meetings/' + encodeURIComponent(config.meeting.id) + '/presence', { method: 'POST', body: '{}' })); lastHeartbeat = Date.now(); }
        const visible = await body(await request('/api/meetings/' + encodeURIComponent(config.meeting.id) + '/contributions?after=' + displayCursor));
        for (const row of visible.contributions || []) displayed.set(row.id, row);
        displayCursor = visible.cursor; hooks.pending?.([...displayed.values()]);
        if (!config.host) {
          const raw = await storage.read(sessionKey(config.meeting.id)); if (raw) hooks.remote(JSON.parse(raw));
        } else if (!conflict && hooks.accepting()) {
          const result = await body(await request('/api/meetings/' + encodeURIComponent(config.meeting.id) + '/contributions?after=' + cursor));
          for (const row of result.contributions || []) {
            if (!hooks.accepting()) break;
            if (!wasContributed(hooks.snapshot(), row)) await hooks.contribute(row, contributionId(row));
            // Advance only after the contribution is saved. A page reload uses
            // the persisted segment id to avoid classifying the same input twice.
            if (!await hooks.save()) break;
            cursor = row.sequence;
          }
        }
      } catch (error) { hooks.notice(error.message); }
      finally { polling = false; }
    }
    function attach(value) { hooks = value; void poll(); timer = root.setInterval(poll, 2500); }
    async function contribute(text, clientId) {
      const result = await body(await request('/api/meetings/' + encodeURIComponent(config.meeting.id) + '/contributions', { method: 'POST', body: JSON.stringify({ text, clientId }) }));
      displayed.set(result.contribution.id, result.contribution); hooks?.pending?.([...displayed.values()]); void poll(); return result.contribution;
    }
    root.addEventListener('pagehide', () => { stopped = true; root.clearInterval(timer); if (config.host && captureActive) void request('/api/meetings/' + encodeURIComponent(config.meeting.id) + '/audio/capture', { method: 'POST', body: '{"active":false}', keepalive: true }).catch(() => {}); });
    return { ...config, storage, attach, contribute, view: run => { if (config.host && !config.meeting.copiedFromExample) throw Error('O anfitrião deve usar seu estado completo de retomada.'); return readView(run, config.meeting.id); }, canWrite: () => config.host && !conflict, returnToNorte: () => { root.top.location.assign(config.returnUrl); } };
  }
  return { configuration, legacyURL, contributionId, wasContributed, readView, create };
});
