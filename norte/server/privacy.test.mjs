import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { privacyNotice, registerPrivacy } from './privacy.mjs';

test('privacy notice is public, configurable and never exposes credentials', async t => {
  const env = { NORTE_PRIVACY_CONTROLLER: 'Responsável independente', NORTE_PRIVACY_EMAIL: 'contato@example.test', GOOGLE_API_KEY: 'secret-google-key', TYPESAFE_API_KEY: 'secret-jev-key' };
  const app = Fastify(); registerPrivacy(app, { env }); t.after(() => app.close());
  const response = await app.inject('/api/platform/privacy');
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['cache-control'], 'no-store');
  const notice = response.json();
  assert.equal(notice.controller, env.NORTE_PRIVACY_CONTROLLER);
  assert.equal(notice.contact, env.NORTE_PRIVACY_EMAIL);
  assert.equal(notice.providers.find(provider => provider.name === 'Google Gemini').configured, true);
  assert.doesNotMatch(response.body, /secret-google-key|secret-jev-key/);
});

test('an unused provider credential is not advertised as the selected editorial provider', () => {
  const notice = privacyNotice({ AI_AGENT_PROVIDER: 'gemini', OPENAI_API_KEY: 'not-selected' });
  assert.equal(notice.providers.find(provider => provider.name === 'OpenAI').configured, false);
  assert.equal(notice.metricsRetentionDays, 90);
});
