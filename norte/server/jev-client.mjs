import { createHash, createHmac } from 'node:crypto';

export function bridgeHeaders({ method, path, actorId, scope = `user:${actorId}`, role = 'user', body = '', secret, now = Date.now() }) {
  const time = String(Math.floor(now / 1000));
  const message = [method, path, actorId, scope, role, time, createHash('sha256').update(body).digest('hex')].join('\n');
  return { 'Content-Type': 'application/json', 'X-Norte-Bridge-User': actorId, 'X-Norte-Bridge-Scope': scope,
    'X-Norte-Bridge-Role': role, 'X-Norte-Bridge-Time': time,
    'X-Norte-Bridge-Signature': createHmac('sha256', secret).update(message).digest('hex') };
}

/** Uses the existing official/local Jev configuration through the private worker. */
export function createJevClient(options = {}) {
  const env = options.env ?? process.env, fetchImpl = options.fetch ?? fetch;
  const origin = env.NORTE_MEETING_BACKEND_URL || 'http://127.0.0.1:8790';
  const secret = env.NORTE_MEETING_BRIDGE_SECRET || '';
  let base;
  try { base = new URL(origin); } catch { /* unavailable, never redirect to arbitrary hosts */ }
  const enabled = secret.length >= 32 && base?.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) && !base.username && !base.password;
  return {
    enabled,
    async classify(actorId, state, questions) {
      if (!enabled || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/u.test(actorId || '')) return null;
      if (JSON.stringify(state).length > 15_500) throw new Error('O contexto selecionado excedeu o limite do Jev.');
      const body = JSON.stringify({ model: 'jev-latest', state, questions });
      const path = '/api/classify';
      const response = await fetchImpl(new URL(path, base), { method: 'POST', body,
        headers: bridgeHeaders({ method: 'POST', path, actorId, body, secret }), redirect: 'error', signal: AbortSignal.timeout(32_000) });
      if (!response.ok) throw Object.assign(new Error('O Jev não está disponível para esta consulta.'), { code: 'JEV_UNAVAILABLE', statusCode: response.status });
      const output = await response.json();
      return { answers: output.response?.answers || {}, latencyMs: output.latencyMs, model: output.response?.model || 'jev-latest' };
    }
  };
}

export function confidentChoice(answer, allowed, threshold = 0.8) {
  if (answer?.type !== 'choice' || !allowed.includes(answer.choice) || !Number.isFinite(answer.confidence) || answer.confidence < threshold) return null;
  const entries = Object.entries(answer.probabilities || {});
  if (entries.length !== allowed.length || entries.some(([key, probability]) => !allowed.includes(key) || !Number.isFinite(probability) || probability < 0 || probability > 1) || Math.abs(entries.reduce((sum, [, probability]) => sum + probability, 0) - 1) > .02) return null;
  const values = entries.sort((a, b) => b[1] - a[1]);
  if (values[0]?.[0] !== answer.choice || values[0][1] < threshold || values[0][1] - (values[1]?.[1] || 0) < 0.25) return null;
  return answer.choice;
}
