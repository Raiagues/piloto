/* global window, document */
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { buildApp } from '../server/app.mjs';
import { totp } from '../server/platform-security.mjs';
const directory = await mkdtemp(join(tmpdir(), 'norte-platform-flow-'));
const port = 5329, origin = `http://127.0.0.1:${port}`, output = resolve('../.runtime/validation');
const app = await buildApp({ storeFile: join(directory, 'data.json'), logger: false, demoAccount: false, ai: { apiKey: '' }, systemAi: { apiKey: '' }, platform: { encryptionKey: randomBytes(32).toString('hex') } });
let vite, browser, page; const errors = [];
try {
  process.env.NORTE_ALLOWED_ORIGINS = origin;
  await app.listen({ host: '127.0.0.1', port: 0 });
  process.env.VITE_DEMO_MODE = 'false'; process.env.VITE_BASE_PATH = '/'; process.env.VITE_API_PROXY_TARGET = `http://127.0.0.1:${app.server.address().port}`;
  vite = await createServer({ server: { host: '127.0.0.1', port, strictPort: true, hmr: false } }); await vite.listen();
  browser = await chromium.launch({ executablePath: '/opt/google/chrome/chrome', headless: true, args: ['--no-sandbox'] });
  const context = async () => { const result = await browser.newContext({ viewport: { width: 1440, height: 1000 } }); await result.addInitScript(() => window.localStorage.setItem('norte-language', 'pt')); return result; };
  const adminContext = await context(); page = await adminContext.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + '/'); await page.getByRole('heading', { name: /Dê continuidade/ }).waitFor();
  await page.screenshot({ path: '/tmp/norte-public-landing-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: '/tmp/norte-public-landing-mobile.png', fullPage: true }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)); await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'Usar tema claro', exact: true }).click();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
  await page.screenshot({ path: '/tmp/norte-public-landing-light.png', fullPage: true });
  await page.reload(); assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
  await page.getByRole('button', { name: 'Usar tema escuro', exact: true }).click();
  await page.getByRole('link', { name: 'Criar conta', exact: true }).click();
  await page.locator('input[name=name]').fill('Admin Local'); await page.locator('input[name=nickname]').fill('admin_local'); await page.locator('input[name=email]').fill('admin-platform@example.test'); const password = 'local platform browser passphrase'; await page.locator('input[name=password]').fill(password); await page.locator('.auth-submit').click(); await page.locator('.app-header').waitFor();
  await page.getByRole('dialog', { name: 'Boas-vindas ao Norte' }).waitFor(); await page.getByRole('button', { name: 'Explorar por conta própria', exact: true }).click(); await page.getByRole('dialog', { name: 'Boas-vindas ao Norte' }).waitFor({ state: 'hidden' });
  await page.goto(origin + '/#/admin/users'); await page.getByRole('heading', { name: 'Confirmar acesso administrativo' }).waitFor();
  await page.getByLabel('Sua senha atual').fill(password); await page.getByRole('button', { name: 'Configurar autenticador' }).click(); const secret = await page.locator('.admin-mfa code').textContent(); assert.ok(secret); await page.getByLabel('Código de seis dígitos').fill(totp(secret, Math.floor(Date.now() / 30000))); await page.getByRole('button', { name: 'Confirmar código' }).click(); await page.getByRole('heading', { name: 'Usuários da plataforma' }).waitFor();
  const customer = await context(), registration = await customer.request.post(origin + '/api/auth/register', { data: { name: 'Engenheira Cliente', nickname: 'engineer_client', email: 'customer-platform@example.test', password: 'customer browser test passphrase' } }); assert.equal(registration.status(), 201); const actor = await registration.json();
  const customerPage = await customer.newPage(); customerPage.on('pageerror', error => errors.push(error.message)); await customerPage.goto(origin + '/#/people'); await customerPage.getByRole('row').filter({ hasText: 'Admin Local' }).getByRole('link', { name: 'Conversar' }).click(); await customerPage.getByLabel('Mensagem', { exact: true }).fill('Gostaria de revisar o escopo do plano com reuniões e memória.'); await customerPage.getByRole('button', { name: 'Enviar mensagem', exact: true }).click(); await customerPage.locator('.chat-log').getByText('Gostaria de revisar o escopo do plano com reuniões e memória.').waitFor();
  const read = await customer.request.get(origin + '/api/platform/conversations').then(response => response.json());
  await page.goto(origin + '/#/messages'); await page.locator('.conversation-list button').first().click(); await page.locator('.chat-log').getByText('Gostaria de revisar o escopo do plano com reuniões e memória.').waitFor(); await page.getByLabel('Mensagem', { exact: true }).fill('Podemos revisar o escopo nesta conversa.'); await page.getByRole('button', { name: 'Enviar mensagem', exact: true }).click(); await customerPage.locator('.chat-log').getByText('Podemos revisar o escopo nesta conversa.').waitFor(); await page.screenshot({ path: '/tmp/norte-platform-messages.png', fullPage: true });
  const outsider = await context(); assert.equal((await outsider.request.post(origin + '/api/auth/register', { data: { name: 'Outro Engenheiro', nickname: 'other_engineer', email: 'other-platform@example.test', password: 'other browser test passphrase' } })).status(), 201); assert.equal((await outsider.request.get(origin + `/api/platform/conversations/${read.conversations[0].id}`)).status(), 404);
  await customerPage.goto(origin + '/#/plans'); await customerPage.getByLabel('Compartilhar métricas de navegação para melhorar o Norte').check(); await customerPage.getByRole('button', { name: 'Equipe / empresa', exact: true }).click(); await customerPage.getByLabel('Equipe ou empresa').fill('Equipe Aurora'); await customerPage.getByLabel('Editores', { exact: true }).fill('2'); await customerPage.getByLabel('Revisores', { exact: true }).fill('1'); await customerPage.getByLabel('Autorizo contato sobre esta contratação.').check();
  // A new server price must be shown before a customer can confirm it.
  await page.goto(origin + '/#/admin/users'); await page.getByRole('button', { name: 'Solicitações e preços', exact: true }).click(); await page.getByLabel('Equipe', { exact: true }).fill('169');
  await Promise.all([page.waitForResponse(response => response.url().endsWith('/api/platform/admin/plans/catalog') && response.ok()), page.getByRole('button', { name: 'Salvar catálogo', exact: true }).click()]);
  await Promise.all([customerPage.waitForResponse(response => response.url().endsWith('/api/platform/plans/quote') && response.ok()), customerPage.getByLabel('Leitores', { exact: true }).fill('1')]);
  await customerPage.waitForFunction(() => document.querySelector('.plan-summary h2')?.textContent.includes('266,00'));
  assert.equal(await customerPage.getByLabel('Autorizo contato sobre esta contratação.').isChecked(), false, 'A changed quote requires renewed consent');
  assert.equal(await customerPage.getByRole('button', { name: 'Solicitar contratação', exact: true }).isDisabled(), true);
  await customerPage.getByLabel('Autorizo contato sobre esta contratação.').check(); let interruptedRequest = false;
  await customerPage.route('**/api/platform/plans/requests', async route => {
    if (route.request().method() !== 'POST' || interruptedRequest) return route.continue();
    interruptedRequest = true; const committed = await route.fetch(); assert.ok(committed.ok());
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Resposta interrompida: tente novamente.' }) });
  });
  await customerPage.getByRole('button', { name: 'Solicitar contratação', exact: true }).click();
  await customerPage.getByRole('alert').filter({ hasText: 'Resposta interrompida' }).waitFor();
  await customerPage.getByRole('button', { name: 'Solicitar contratação', exact: true }).click(); await customerPage.getByRole('status').filter({ hasText: 'Solicitação registrada' }).waitFor(); await customerPage.screenshot({ path: '/tmp/norte-platform-plans.png', fullPage: true });
  assert.equal(app.missionStore.read().platform.planRequests.length, 1, 'Retry after a lost response creates only one subscription request');
  assert.equal(app.missionStore.read().platform.planRequests[0].quote.monthlyCents, 26600, 'Persisted amount matches the displayed and reconfirmed quote');
  await page.goto(origin + '/#/admin/users'); await page.getByRole('button', { name: 'Solicitações e preços', exact: true }).click(); await page.getByLabel('Aprovar estes valores para contratação').check(); await page.getByRole('button', { name: 'Salvar catálogo', exact: true }).click(); await page.getByRole('button', { name: 'Confirmar contratação', exact: true }).waitFor(); page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: 'Confirmar contratação', exact: true }).click(); await page.getByText('confirmed', { exact: true }).waitFor(); assert.ok(app.missionStore.read().platform.entitlements[actor.user.id].until);
  await page.getByRole('button', { name: 'Uso e contratação', exact: true }).click(); await page.getByRole('heading', { name: /Caminho até a contratação/ }).waitFor(); await page.screenshot({ path: '/tmp/norte-platform-admin-analytics.png', fullPage: true }); assert.ok(app.missionStore.read().telemetry.events.some(event => event.name === 'request_submitted')); await page.getByRole('button', { name: 'Análises JEV / IA', exact: true }).click(); await page.getByRole('heading', { name: 'Análises JEV e IA' }).waitFor();
  await customerPage.setViewportSize({ width: 390, height: 844 }); await customerPage.goto(origin + '/#/people'); await customerPage.getByRole('heading', { name: 'Encontre quem está no Norte.' }).waitFor(); await customerPage.getByRole('row').filter({ hasText: 'Admin Local' }).waitFor(); await customerPage.screenshot({ path: '/tmp/norte-platform-people-mobile.png', fullPage: true }); assert.ok(await customerPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await customerPage.getByRole('button', { name: 'Ativar tema claro', exact: true }).click();
  await customerPage.screenshot({ path: '/tmp/norte-platform-people-light-mobile.png', fullPage: true });
  assert.ok(await customerPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await customerPage.setViewportSize({ width: 1440, height: 1000 });
  for (const [route, selector] of [['', '.home-recent, .home-action-grid'], ['plans', '.plan-summary'], ['messages', '.chat-thread'], ['meetings', '.meetings-page']]) {
    await customerPage.goto(origin + '/#/' + route); await customerPage.locator(selector).first().waitFor();
    if (!route) { await customerPage.getByRole('dialog', { name: 'Boas-vindas ao Norte' }).waitFor(); await customerPage.getByRole('button', { name: 'Explorar por conta própria', exact: true }).click(); await customerPage.getByRole('dialog', { name: 'Boas-vindas ao Norte' }).waitFor({ state: 'hidden' }); }
    assert.equal(await customerPage.locator('html').getAttribute('data-theme'), 'light');
    await customerPage.screenshot({ path: '/tmp/norte-platform-' + (route || 'home') + '-light.png', fullPage: true });
  }
  await customerPage.goto(origin + '/#/plans');
  await Promise.all([customerPage.waitForResponse(response => response.url().endsWith('/api/platform/privacy/erase-usage') && response.ok()), customerPage.getByLabel('Compartilhar métricas de navegação para melhorar o Norte').uncheck()]);
  assert.ok(!app.missionStore.read().telemetry.events.some(event => event.userId === actor.user.id), 'Withdrawing consent erases account usage events');
  assert.equal((await customer.request.get(origin + '/api/platform/admin/analytics')).status(), 403); assert.deepEqual(errors, []);
  await mkdir(output, { recursive: true }); await writeFile(join(output, 'platform-browser.json'), JSON.stringify({ passed: true, externalCalls: 0, isolated: true, checks: ['landing_desktop_mobile', 'ui_registration', 'admin_totp_enrollment', 'presence_directory', 'two_account_private_messages', 'third_party_message_denial', 'server_quote_and_request', 'manual_admin_confirmation', 'consented_funnel_events', 'admin_only_analytics', 'responsive_people', 'persistent_light_dark_themes', 'retry_after_lost_response', 'changed_server_price_displayed_and_reconfirmed', 'withdraw_consent_erases_usage'], generatedAt: new Date().toISOString() }, null, 2), { mode: 0o600 }); console.log('PASS: public presentation, registration, MFA, private messages, plans, manual confirmation, analytics and mobile; isolated local services, no external calls.');
} catch (error) { if (page && await page.locator('.app-header').count()) await page.screenshot({ path: '/tmp/norte-platform-browser-failure.png', fullPage: true, mask: [page.locator('input[type=password], .admin-mfa code')] }).catch(() => {}); console.error('Browser errors:', errors); throw error; }
finally { await browser?.close(); await vite?.close(); await app.close(); await rm(directory, { recursive: true, force: true }); }
