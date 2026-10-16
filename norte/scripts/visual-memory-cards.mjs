/* global window */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
import { buildApp } from '../server/app.mjs';

// Real local corpus and authenticated UI; no model calls or persistent user data.
const directory = await mkdtemp(join(tmpdir(), 'norte-card-layout-'));
const previousProfile = process.env.NORTE_DEMO_PROFILE;
process.env.NORTE_DEMO_PROFILE = 'validation';
const port = Number(process.env.NORTE_CARDS_VISUAL_PORT || 5302), origin = `http://127.0.0.1:${port}`;
const app = await buildApp({ storeFile: join(directory, 'state.json'), logger: false, demoAccount: true, ai: { apiKey: '' }, systemAi: { apiKey: '' } });
let browser, vite, page;
const errors = [];
try {
  await app.listen({ host: '127.0.0.1', port: 0 });
  vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { env: { ...process.env, VITE_DEMO_MODE: 'false', VITE_API_PROXY_TARGET: `http://127.0.0.1:${app.server.address().port}` }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Vite timeout')), 25000); vite.stdout.on('data', chunk => { if (String(chunk).includes('Local:')) { clearTimeout(timer); resolve(); } }); vite.once('exit', code => { clearTimeout(timer); reject(new Error('Vite exited ' + code)); }); });
  browser = await chromium.launch({ executablePath: process.env.NORTE_CHROME || '/opt/google/chrome/chrome', headless: true, args: ['--no-sandbox'] });
  page = await browser.newPage({ viewport: { width: 1512, height: 1000 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => window.localStorage.setItem('norte-language', 'pt'));
  await page.goto(origin + '/norte/');
  await page.getByRole('button', { name: 'Explorar com conta de teste', exact: true }).click();
  await page.locator('.home-action-card.accent-open').click();
  await page.locator('.home-project-open').click();
  await page.locator('.pm-artifact-card').first().waitFor();
  assert.equal(await page.locator('.pm-artifact-card').count(), 17);
  const check = async () => {
    const cards = await page.locator('.pm-artifact-card').evaluateAll(elements => elements.map(element => {
      const bounds = element.getBoundingClientRect(), content = element.querySelector(':scope > a').getBoundingClientRect(), status = element.querySelector('.pm-artifact-status').getBoundingClientRect(), footer = element.querySelector('.pm-artifact-actions').getBoundingClientRect();
      const controls = [...element.querySelector('.pm-artifact-actions').children].map(control => { const rect = control.getBoundingClientRect(); return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }; });
      return { title: element.querySelector('strong').textContent, noTextOverlap: footer.top >= content.bottom - 1 && footer.top >= status.bottom - 1, insideCard: footer.bottom <= bounds.bottom + 1, controlsContained: controls.every(control => control.left >= bounds.left - 1 && control.right <= bounds.right + 1 && control.top >= footer.top - 1 && control.bottom <= footer.bottom + 1) };
    }));
    for (const card of cards) { assert.equal(card.noTextOverlap, true, card.title + ': footer overlaps text'); assert.equal(card.insideCard, true, card.title + ': footer outside card'); assert.equal(card.controlsContained, true, card.title + ': control outside footer'); }
  };
  await check();
  await page.screenshot({ path: '/tmp/norte-memory-card-footer.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.pm-artifact-card').first().scrollIntoViewIfNeeded();
  await check();
  const contentBox = await page.locator('.app-content').boundingBox(), feedbackBox = await page.locator('.project-learning-trigger').boundingBox();
  assert.ok(contentBox.y + contentBox.height <= feedbackBox.y, 'mobile feedback action has a reserved area below document content');
  await page.screenshot({ path: '/tmp/norte-memory-card-footer-mobile.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log('PASS: 17 real local Quetzal-1 source cards, desktop and mobile; footer follows content/status, actions remain inside each card. No provider calls.');
} catch (error) { await page?.screenshot({ path: '/tmp/norte-memory-card-footer-failure.png', fullPage: true }).catch(() => {}); throw error; }
finally {
  await browser?.close(); vite?.kill('SIGTERM'); await app.close();
  if (previousProfile === undefined) delete process.env.NORTE_DEMO_PROFILE; else process.env.NORTE_DEMO_PROFILE = previousProfile;
  await rm(directory, { recursive: true, force: true });
}
