import test from 'node:test';
import assert from 'node:assert/strict';
import { geminiConfig, geminiStatus } from './gemini-config.mjs';
import { geminiGenerate } from './gemini-transport.mjs';

test('requirements configuration reaches REST without changing the selected model or thinking budget', async () => {
  const env = { GEMINI_MODEL: 'gemini-3.8-flash', GEMINI_THINKING_LEVEL: 'high', GEMINI_REQUIREMENTS_THINKING_LEVEL: 'low', GEMINI_REQUIREMENTS_MAX_OUTPUT_TOKENS: '4000' };
  const config = geminiConfig({ env }, 'requirements');
  let captured;
  await geminiGenerate({ apiKey: 'test', model: config.model, body: { contents: [{ parts: [{ text: 'Fixture requirement' }] }], generationConfig: config }, fetchImpl: async (url, init) => {
    captured = { url, body: JSON.parse(init.body) };
    return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{}' }] } }] }));
  } });
  assert.equal(captured.body.generationConfig.thinkingConfig.thinkingLevel, 'LOW');
  assert.equal(captured.body.generationConfig.maxOutputTokens, 4000);
  assert.ok(captured.url.endsWith('gemini-3.8-flash:generateContent'));
});

test('invalid model, budget and thinking settings fail without silently choosing another model', () => {
  for (const env of [
    { GEMINI_MODEL: 'models/gemini-3.8-flash' }, { GEMINI_MODEL: '' },
    { GEMINI_MODEL: 'gemini-2.5-flash', GEMINI_THINKING_LEVEL: 'high' },
    { GEMINI_MODEL: 'gemini-3.8-flash', GEMINI_THINKING_LEVEL: 'minimal' },
    { GEMINI_THINKING_LEVEL: 'typo' }, { GEMINI_REQUIREMENTS_MAX_OUTPUT_TOKENS: 'NaN' }
  ]) {
    assert.throws(() => geminiConfig({ env }, 'requirements'), { code: 'GEMINI_CONFIG_INVALID' });
    assert.equal(geminiStatus('key', { env }, 'requirements').configurationError, 'GEMINI_CONFIG_INVALID');
  }
});

test('default configuration leaves thinking to the provider and supports a requirements override', () => {
  const config = geminiConfig({ env: { GEMINI_MODEL: 'gemini-3.8-flash', GEMINI_REQUIREMENTS_MODEL: 'gemini-3.5-flash-lite' } });
  assert.equal(config.model, 'gemini-3.5-flash-lite');
  assert.equal(config.maxOutputTokens, 6000);
  assert.equal(config.thinkingConfig, undefined);
});
