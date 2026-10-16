/* Sign in or create an account. The server sets an HttpOnly session cookie. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const USERNAME = /^[a-z0-9][a-z0-9._-]{2,31}$/;
  // Capture before switching the sign-in/sign-up tab changes the fragment.
  // The HTTP redirect preserves the PDF's #reuniao or #simulacao fragment.
  const returnTo = (() => {
    const value = new URLSearchParams(location.search).get('next');
    if (!value || value.length > 1000 || /[\\\u0000-\u001f]/.test(value) || !value.startsWith('/') || value.startsWith('//')) return '/';
    try {
      const target = new URL(value, location.origin), id = /^[A-Za-z0-9_.:-]{1,160}$/;
      if (target.origin !== location.origin || !['/', '/index.html'].includes(target.pathname)) return '/';
      const meeting = target.searchParams.get('meeting'), event = target.searchParams.get('event');
      if (!id.test(meeting || '') || event && !id.test(event)) return '/';
      const query = new URLSearchParams({ meeting }); if (event) query.set('event', event);
      const fragment = ['#reuniao', '#simulacao'].includes(target.hash) ? target.hash : ['#reuniao', '#simulacao'].includes(location.hash) ? location.hash : '#reuniao';
      return '/?' + query + fragment;
    } catch (_) { return '/'; }
  })();
  let mode = 'login', busy = false, codeRequired = false;

  function render() {
    const signup = mode === 'signup';
    $('tabLogin').setAttribute('aria-selected', String(!signup));
    $('tabSignup').setAttribute('aria-selected', String(signup));
    $('authForm').setAttribute('aria-labelledby', signup ? 'tabSignup' : 'tabLogin');
    $('signupFields').hidden = !signup;
    $('usernameHint').hidden = !signup;
    $('codeField').hidden = !signup || !codeRequired;
    $('password').autocomplete = signup ? 'new-password' : 'current-password';
    $('authSubmit').textContent = busy ? (signup ? 'Criando conta…' : 'Entrando…') : signup ? 'Criar conta' : 'Entrar';
    $('authSubmit').disabled = busy;
  }
  function setMode(next) {
    mode = next; error('');
    history.replaceState(null, '', location.pathname + location.search + (next === 'signup' ? '#criar-conta' : ''));
    render(); $('username').focus();
  }
  function error(message, field) {
    $('authError').textContent = message;
    for (const id of ['username', 'password', 'confirm', 'code']) $(id).removeAttribute('aria-invalid');
    if (field) { $(field).setAttribute('aria-invalid', 'true'); $(field).focus(); }
  }
  function check(username, password) {
    if (!username) return ['Informe o usuário.', 'username'];
    if (!password) return ['Informe a senha.', 'password'];
    if (mode !== 'signup') return null;
    if (!USERNAME.test(username)) return ['Use de 3 a 32 caracteres: letras minúsculas, números, ponto, hífen ou sublinhado.', 'username'];
    if (password.length < 8) return ['A senha precisa ter pelo menos 8 caracteres.', 'password'];
    if (password !== $('confirm').value) return ['As senhas não conferem.', 'confirm'];
    if (codeRequired && !$('code').value.trim()) return ['Informe o código de convite.', 'code'];
    return null;
  }

  $('tabLogin').addEventListener('click', () => setMode('login'));
  $('tabSignup').addEventListener('click', () => setMode('signup'));
  for (const tab of [$('tabLogin'), $('tabSignup')]) tab.addEventListener('keydown', event => {
    if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); setMode(mode === 'login' ? 'signup' : 'login'); $(mode === 'login' ? 'tabLogin' : 'tabSignup').focus(); }
  });
  $('authForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (busy) return;
    const username = $('username').value.trim().toLowerCase(), password = $('password').value;
    const problem = check(username, password);
    if (problem) return error(...problem);
    busy = true; error(''); render();
    try {
      const body = { username, password };
      if (mode === 'signup' && codeRequired) body.code = $('code').value.trim();
      const response = await fetch('/api/auth/' + mode, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw Object.assign(Error(result.error || 'Não foi possível entrar agora. Tente novamente.'), { field: response.status === 409 ? 'username' : mode === 'signup' && response.status === 403 ? 'code' : 'password' });
      location.replace(returnTo);
    } catch (failure) {
      busy = false; render();
      error(failure.name === 'TimeoutError' || failure.name === 'TypeError' ? 'O servidor não respondeu. Confira a conexão e tente novamente.' : failure.message, failure.field || 'password');
    }
  });
  fetch('/api/auth/config').then(response => response.json()).then(config => { codeRequired = !!config.signup_code_required; render(); }).catch(() => {});
  if (location.hash === '#criar-conta') mode = 'signup';
  render();
  $('username').focus();
})();
