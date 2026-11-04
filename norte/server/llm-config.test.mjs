import test from 'node:test';
import assert from 'node:assert/strict';
import { llmConfig, llmStatus, prompt } from './llm-config.mjs';

test('engineering analyses default to OpenAI with the model of the plan', () => {
  assert.deepEqual(llmConfig({ env: {} }), { provider: 'openai', model: 'gpt-6.1-sol', maxOutputTokens: 6000 });
});

test('the model of hard analyses is one variable away', () => {
  assert.equal(llmConfig({ env: { NORTE_ENGINEERING_MODEL: 'gpt-6-astra' } }).model, 'gpt-6-astra');
});

test('invalid settings fail without silently choosing another model', () => {
  for (const env of [
    { NORTE_ENGINEERING_MODEL: 'models/gpt' },
    { NORTE_ENGINEERING_MODEL: '' },
    { NORTE_LLM_PROVIDER: 'outro' },
    { NORTE_ENGINEERING_MAX_OUTPUT_TOKENS: 'NaN' },
  ]) {
    assert.throws(() => llmConfig({ env }), { code: 'LLM_CONFIG_INVALID' });
    assert.equal(llmStatus('key', { env }).configurationError, 'LLM_CONFIG_INVALID');
  }
});

test('status names the provider really selected and never the key', () => {
  assert.deepEqual(
    llmStatus('secret', { env: { NORTE_LLM_PROVIDER: 'gemini', NORTE_ENGINEERING_MODEL: 'gemini-x' } }),
    { configured: true, provider: 'gemini', model: 'gemini-x' },
  );
});

test('prompts are plain files in the prompts folder', () => {
  assert.match(prompt('requirement-review.md'), /untrusted data/);
  assert.match(prompt('engineering-assistant.md'), /PENDENTE/);
});
