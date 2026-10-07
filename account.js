/* Signed-in account inside the app: sign-out entry in the rail and an expired-session notice.
 * The server adds this script and body[data-role] when it serves index.html.
 */
(function () {
  'use strict';
  const body = document.body, username = body.dataset.username || '';
  const sidebar = document.getElementById('sidebar'), footer = sidebar?.querySelector('.sidebar-footer');
  if (!sidebar) return;

  const rail = document.createElement('div');
  rail.className = 'account-rail';
  const logout = document.createElement('button');
  logout.type = 'button'; logout.id = 'accountLogout'; logout.className = 'nav-item account-logout';
  logout.title = 'Sair da conta ' + username;
  logout.innerHTML = '<span class="nav-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 16l-4-4 4-4M6 12h10"/></svg></span><span class="sidebar-label account-label"><span>Sair</span><small></small></span>';
  logout.querySelector('small').textContent = username + (body.dataset.role === 'admin' ? ' · admin' : '');
  logout.setAttribute('aria-label', 'Sair da conta ' + username);
  rail.append(logout);
  sidebar.insertBefore(rail, footer || null);

  logout.addEventListener('click', async () => {
    if (window.NorteMeetingRoom?.isRunning?.() && !confirm('Há uma reunião em andamento. Sair mesmo assim? O que já foi registrado fica salvo na sua conta.')) return;
    logout.disabled = true;
    try { await window.NorteMeetingRoom?.flushStorage?.(); } catch (_) { /* Sign-out proceeds; the notice already reported it. */ }
    try { await fetch('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); } catch (_) { /* The cookie expires on its own. */ }
    location.replace('/login');
  });

  // A session can end while a meeting stays open: say so instead of failing silently.
  const notice = document.createElement('div');
  notice.className = 'account-expired'; notice.setAttribute('role', 'alert'); notice.hidden = true;
  notice.innerHTML = '<span>Sua sessão terminou. Entre novamente para continuar salvando.</span> <a href="/login" target="_blank" rel="noopener">Entrar em nova aba</a>';
  body.append(notice);
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async function (input, init) {
    const response = await nativeFetch(input, init);
    try {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.href);
      if (url.origin === location.origin && url.pathname.startsWith('/api/') && !url.pathname.startsWith('/api/auth/')) {
        if (response.status === 401) notice.hidden = false;
        else if (response.ok) notice.hidden = true;
      }
    } catch (_) { /* Never interfere with the response itself. */ }
    return response;
  };
})();
