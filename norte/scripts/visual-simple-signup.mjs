/* global window, document */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { buildApp } from '../server/app.mjs';

// A disposable production-mode API proves that ordinary public registration
// needs no setup credential and never grants initial administration.
const directory = await mkdtemp(join(tmpdir(), 'norte-simple-signup-'));
const appRoot = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(appRoot, '../.runtime/validation');
const port = 5299, origin = `http://127.0.0.1:${port}`;
const suffix = randomBytes(4).toString('hex');
const name = `Pessoa Teste ${suffix}`, username = `Pessoa-${suffix}`, email = `legacy-${suffix}@example.test`, password = '12345678';
const legacyNickname = `legacy_${suffix}`;
assert.equal(password.length, 8);
const checks = [], errors = [], externalRequests = [], apiErrors = [], submittedFields = [];
const previousOrigins = process.env.NORTE_ALLOWED_ORIGINS, previousEnvironment = process.env.NODE_ENV;
let app, vite, browser, page, sentMail = 0;
const redact = value => [password, email, username].reduce((text, privateValue) => text.replaceAll(privateValue, '[redacted]'), String(value));
async function stop(child) {
  if (!child || child.exitCode !== null) return;
  await new Promise(done => { const timer = setTimeout(() => { child.kill('SIGKILL'); done(); }, 4000); child.once('exit', () => { clearTimeout(timer); done(); }); child.kill('SIGTERM'); });
}
async function screenshot(label) {
  const path = join(output, `simple-signup-${label}.png`);
  const mask = [page.locator('.account-menu-head span')];
  for (const field of await page.locator('input[name=password],input[name=login],input[name=email],.profile-fields input[readonly]').all()) if (await field.inputValue()) mask.push(field);
  await page.screenshot({ path, fullPage: true, mask });
  console.log(`SCREENSHOT ${path}`);
}
async function fits(label) {
  const size = await page.locator('.auth-form').evaluate(element => ({ left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right, viewport: window.innerWidth, document: document.documentElement.scrollWidth }));
  assert(size.left >= 0 && size.right <= size.viewport + 1 && size.document <= size.viewport + 1, `${label}: auth form must fit the viewport`);
  checks.push(`${label} fits viewport`);
}
try {
  await mkdir(output, { recursive: true, mode: 0o700 });
  process.env.NORTE_ALLOWED_ORIGINS = origin;
  process.env.NODE_ENV = 'production';
  try {
    app = await buildApp({ storeFile: join(directory, 'state.json'), databaseUrl: '', serveStatic: false, logger: false, demoAccount: false, bootstrapToken: '', ai: { apiKey: '' }, systemAi: { apiKey: '' }, platform: { encryptionKey: 'isolated-signup-test-only-encryption-key' }, mailer: { configured: false, publicUrl: origin, send: async () => { sentMail++; throw new Error('External mail is forbidden in this fixture'); } } });
  } finally { if (previousEnvironment === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousEnvironment; }
  await app.listen({ host: '127.0.0.1', port: 0 });
  const config = join(directory, 'vite.config.mjs');
  await writeFile(config, `export default ${JSON.stringify({ root: appRoot, base: '/norte/', server: { hmr: false, watch: null, proxy: { '/api': { target: `http://127.0.0.1:${app.server.address().port}`, changeOrigin: false } } } })};\n`);
  vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--config', config, '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: appRoot, env: { ...process.env, VITE_DEMO_MODE: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((done, reject) => {
    const timer = setTimeout(() => reject(new Error('Vite timeout')), 25000); let diagnostics = '';
    vite.stdout.on('data', chunk => { if (String(chunk).includes('Local:')) { clearTimeout(timer); done(); } });
    vite.stderr.on('data', chunk => { diagnostics += String(chunk); });
    vite.once('exit', code => { clearTimeout(timer); reject(new Error(`Vite exited ${code}: ${redact(diagnostics)}`)); });
  });
  browser = await chromium.launch({ executablePath: '/opt/google/chrome/chrome', headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
  await context.route('**/*', route => {
    const request = route.request(), url = request.url();
    if (!url.startsWith(origin + '/') && !url.startsWith('data:') && !url.startsWith('blob:')) { externalRequests.push(new URL(url).origin); return route.abort(); }
    if (url.endsWith('/api/auth/register')) submittedFields.push(Object.keys(request.postDataJSON()).sort());
    return route.continue();
  });
  await context.addInitScript(() => { if (/^https?:$/.test(window.location.protocol)) { window.localStorage.setItem('norte-language', 'pt'); if (!window.localStorage.getItem('norte-theme')) window.localStorage.setItem('norte-theme', 'dark'); } });
  page = await context.newPage(); page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(redact(error.message)));
  page.on('console', message => { if (message.type() === 'error') errors.push(redact(message.text())); });
  page.on('response', response => { if (response.url().startsWith(origin + '/api/') && response.status() >= 400) apiErrors.push({ path: new URL(response.url()).pathname, status: response.status() }); });
  const form = page.locator('.auth-form'), input = field => form.locator(`input[name=${field}]`);
  const button = label => page.getByRole('button', { name: label, exact: true });
  await page.goto(origin + '/norte/#/register'); await input('name').waitFor();
  assert.deepEqual(await form.locator('input').evaluateAll(elements => elements.map(element => element.name).sort()), ['login', 'name', 'password']);
  assert.equal(await input('login').getAttribute('autocomplete'), 'username');
  assert.equal(await input('login').getAttribute('maxlength'), '30');
  assert.equal(await form.locator('input[type=email],input[name=email]').count(), 0);
  assert.equal(await input('password').getAttribute('minlength'), '8');
  assert.equal(await input('password').getAttribute('autocomplete'), 'new-password');
  assert.equal(await page.locator('.auth-context,.auth-owner-note,input[name=bootstrapToken],input[name=nickname]').count(), 0);
  const copy = await form.innerText(); assert.doesNotMatch(copy, /primeira conta|configuração inicial|initial administration|nickname/iu);
  await screenshot('desktop-dark'); await fits('Dark desktop signup');
  await button('Usar tema claro').click(); await screenshot('desktop-light'); await fits('Light desktop signup');
  await page.setViewportSize({ width: 390, height: 844 }); await screenshot('mobile-light'); await fits('Light mobile signup');
  await button('Usar tema escuro').click(); await screenshot('mobile-dark'); await fits('Dark mobile signup');
  checks.push('Signup has exactly Name, Login and Password; no email input, public setup code or administration copy');

  await page.goto(origin + `/norte/#/invitations?invite=isolated-invite&token=isolated-token&email=${encodeURIComponent(email)}`);
  await button('Criar conta').click();
  const invitationEmail = form.getByLabel('E-mail do convite', { exact: true });
  await invitationEmail.waitFor();
  assert.equal(await invitationEmail.inputValue(), email);
  assert.equal(await invitationEmail.getAttribute('readonly'), '');
  assert.equal(await input('invitationEmail').count(), 0);
  await page.goto(origin + '/norte/#/invitations?invite=isolated-invite&token=isolated-token');
  await button('Criar conta').click();
  await input('invitationEmail').waitFor();
  assert.equal(await input('invitationEmail').getAttribute('required'), '');
  assert.equal(await input('invitationEmail').getAttribute('readonly'), null);
  await input('name').fill('Pessoa convidada'); await input('login').fill('convidada'); await input('password').fill(password);
  assert.equal(await form.evaluate(element => element.checkValidity()), false, 'Old invitation links require the mailbox only in their dedicated signup');
  await input('invitationEmail').fill(email);
  assert.equal(await form.evaluate(element => element.checkValidity()), true);
  await page.goto(origin + '/norte/#/join?invite=isolated-invite&token=isolated-token'); await page.reload();
  await input('invitationEmail').waitFor(); assert.equal(await input('invitationEmail').getAttribute('required'), '');
  await page.goto(origin + '/norte/#/register'); await page.reload(); await input('name').waitFor();
  assert.equal(await form.locator('input[type=email]').count(), 0);
  checks.push('Email invitation links retain their mailbox; old invitation and join links offer a required invitation-only email field; ordinary signup remains email-free');

  await input('name').fill(name); await input('login').fill(username); await input('password').fill(password.slice(0, 7));
  assert.equal(await input('password').evaluate(element => element.validity.tooShort), true);
  await input('password').fill(password);
  assert.equal(await form.evaluate(element => element.checkValidity()), true);
  await button('Mostrar senha').click(); assert.equal(await input('password').getAttribute('type'), 'text'); assert.equal(await input('password').inputValue(), password);
  await button('Ocultar senha').click(); assert.equal(await input('password').getAttribute('type'), 'password');
  const registered = page.waitForResponse(response => response.url().endsWith('/api/auth/register') && response.request().method() === 'POST');
  await form.locator('button[type=submit]').click();
  const registration = await registered; assert.equal(registration.status(), 201, 'An eight-character public signup must succeed without a setup credential');
  const result = await registration.json();
  assert.equal(result.user.login, username); assert.equal(result.user.email, '');
  assert.equal(app.missionStore.read(data => data.users.find(user => user.id === result.user.id).email), '');
  assert.equal(result.user.accessRole, 'member'); assert.equal(result.user.demoAccount, false); assert.match(result.user.nickname, /^[a-z][a-z0-9_]{2,29}$/u);
  assert.deepEqual(submittedFields, [['login', 'name', 'password']]);
  assert.equal(app.missionStore.read(data => data.users.filter(user => user.accessRole === 'owner_admin').length), 0);
  assert.equal(app.missionStore.read(data => Boolean(data.authBootstrap?.completedAt)), false);
  const cookies = await context.cookies();
  const sessionCookie = cookies.find(item => item.name === '__Host-norte_session'); assert(sessionCookie?.secure); assert(sessionCookie?.httpOnly);
  checks.push('Production public signup with eight characters creates a member with an automatic nickname and Secure HttpOnly cookie');
  await page.setViewportSize({ width: 1440, height: 900 });
  // The team view avoids dismissing or changing onboarding preferences.
  await page.goto(origin + '/norte/#/teams'); await page.locator('.app-header').waitFor();
  // Chrome treats loopback as a secure context; APIRequest's cookie transport
  // does not. Read through the browser that actually owns this Secure session.
  const readSession = () => page.evaluate(async () => { const response = await window.fetch('/api/auth/session', { credentials: 'same-origin' }); return { status: response.status, body: await response.json() }; });
  const session = await readSession(); assert.equal(session.status, 200);
  assert.equal(session.body.user?.id, result.user.id);
  assert.equal(session.body.user?.login, username);
  await page.locator('.account-badge-trigger').click();
  await button('Ver e editar perfil').click();
  const profile = page.getByRole('dialog', { name: 'Seu perfil' });
  await profile.getByLabel('Login', { exact: true }).waitFor();
  assert.equal(await profile.getByLabel('Login', { exact: true }).inputValue(), username);
  assert.equal(await profile.getByLabel('Login', { exact: true }).getAttribute('readonly'), '');
  assert.equal(await profile.getByLabel('E-mail', { exact: true }).count(), 0);
  await screenshot('profile');
  await profile.getByRole('button', { name: 'Fechar', exact: true }).click();
  checks.push('Profile displays the saved login as read-only and omits empty email');
  await page.goto(origin + '/norte/#/invitations'); await page.locator('.invitation-inbox').waitFor();
  assert.equal(await page.getByRole('heading', { name: 'Seu email', exact: true }).count(), 0);
  assert.equal(await button('Enviar verificação de email').count(), 0);
  checks.push('Invitation inbox does not ask email-free accounts to verify a missing mailbox');
  await page.locator('.account-badge-trigger').click();
  assert.equal(await button('Administrar usuários').count(), 0);
  const loggedOut = page.waitForResponse(response => response.url().endsWith('/api/auth/logout') && response.request().method() === 'POST');
  await button('Sair').click(); assert.equal((await loggedOut).status(), 204);
  await page.goto(origin + '/norte/#/login'); await input('login').waitFor();
  assert.equal(await input('name').count(), 0);
  assert.equal(await input('password').getAttribute('autocomplete'), 'current-password');
  await screenshot('login');
  assert.equal(await input('login').getAttribute('autocomplete'), 'username');
  assert.equal(await form.locator('input[type=email],input[name=email]').count(), 0);
  await input('login').fill(username.toUpperCase()); await input('password').fill(password);
  await button('Mostrar senha').click(); assert.equal(await input('password').getAttribute('type'), 'text'); await button('Ocultar senha').click();
  const loggedIn = page.waitForResponse(response => response.url().endsWith('/api/auth/login') && response.request().method() === 'POST');
  await form.locator('button[type=submit]').click(); const login = await loggedIn; assert.equal(login.status(), 200); assert.equal((await login.json()).user.id, result.user.id);
  await page.goto(origin + '/norte/#/teams'); await page.locator('.app-header').waitFor();
  await page.reload(); await page.locator('.app-header').waitFor();
  const restored = await readSession(); assert.equal(restored.body.user?.id, result.user.id);
  checks.push('Logout, case-insensitive login and reload preserve the email-free account; password visibility works in both forms');

  const legacy = await app.inject({ method: 'POST', url: '/api/auth/register', remoteAddress: '127.0.2.1', payload: { name: 'Pessoa legada', email, nickname: legacyNickname, password } });
  assert.equal(legacy.statusCode, 201, legacy.body);
  await app.missionStore.update(data => { delete data.users.find(user => user.id === legacy.json().user.id).login; });
  for (const identifier of [legacyNickname, email]) {
    await page.locator('.account-badge-trigger').click();
    const signedOut = page.waitForResponse(response => response.url().endsWith('/api/auth/logout') && response.request().method() === 'POST');
    await button('Sair').click(); assert.equal((await signedOut).status(), 204);
    await page.goto(origin + '/norte/#/login'); await input('login').waitFor();
    await input('login').fill(identifier); await input('password').fill(password);
    assert.equal(await form.evaluate(element => element.checkValidity()), true, 'Login form accepts legacy nicknames and email addresses');
    const legacyLogin = page.waitForResponse(response => response.url().endsWith('/api/auth/login') && response.request().method() === 'POST');
    await form.locator('button[type=submit]').click();
    const signedIn = await legacyLogin; assert.equal(signedIn.status(), 200); assert.equal((await signedIn.json()).user.id, legacy.json().user.id);
    await page.goto(origin + '/norte/#/teams'); await page.locator('.app-header').waitFor();
  }
  checks.push('Existing accounts continue signing in with their nickname or email in the same Login field');
  assert.equal(sentMail, 0); assert.deepEqual(externalRequests, []); assert.deepEqual(errors, []); assert.deepEqual(apiErrors, []);
  const report = { passed: true, isolated: true, productionMode: true, fields: 3, passwordLength: password.length, publicRole: result.user.accessRole, nicknameGenerated: Boolean(result.user.nickname), usernameOnly: true, emailAbsent: result.user.email === '', legacyLoginCompatible: true, secureSessionCookie: true, noPublicAdministration: true, externalModelCalls: 0, externalMailCalls: sentMail, checks, secretsRecorded: false, generatedAt: new Date().toISOString() };
  await writeFile(join(output, 'simple-signup-browser.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  console.log('PASS: isolated username signup, simple password, read-only profile, themes, mobile and legacy login compatibility. No external service calls.');
} catch (error) {
  await screenshot('failure').catch(() => {});
  const message = redact(error instanceof Error ? error.message : error);
  await writeFile(join(output, 'simple-signup-browser.json'), JSON.stringify({ passed: false, error: message, checks, errors, apiErrors, externalRequests, secretsRecorded: false, generatedAt: new Date().toISOString() }, null, 2) + '\n', { mode: 0o600 }).catch(() => {});
  // eslint-disable-next-line preserve-caught-error -- The original Playwright error may contain a private form value.
  throw new Error(message);
} finally {
  await browser?.close(); await stop(vite); await app?.close(); await rm(directory, { recursive: true, force: true });
  if (previousOrigins === undefined) delete process.env.NORTE_ALLOWED_ORIGINS; else process.env.NORTE_ALLOWED_ORIGINS = previousOrigins;
  if (previousEnvironment === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousEnvironment;
}
