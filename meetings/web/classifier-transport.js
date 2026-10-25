/* Transport only: no laboratory DOM or account state. */
(function (root) {
  'use strict';
  const lanes = new Map();
  async function request(path, value, provider = 'official') {
    if (!value || typeof value !== 'object' || !value.questions) throw Error('Requisição de classificação inválida.');
    root.NorteExperiments.validateState(value.state);
    const previous = lanes.get(path) || Promise.resolve();
    const next = previous.catch(() => {}).then(async () => {
      const response = await fetch('/api/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Norte-Provider': provider }, body: JSON.stringify(value), signal: AbortSignal.timeout(35000) });
      const output = await response.json();
      if (!response.ok) throw Object.assign(Error(output.error || 'Falha no processamento'), { stopBatch: [401, 402, 403, 409, 429, 503, 504].includes(response.status) });
      if (output.provider !== provider) throw Object.assign(Error('O provedor retornado não corresponde ao solicitado.'), { stopBatch: true });
      return output;
    });
    lanes.set(path, next); try { return await next; } finally { if (lanes.get(path) === next) lanes.delete(path); }
  }
  root.NorteClassifier = { requestTest: (body, provider) => request('classify', body, provider), requestRelation: (body, provider) => request('relations', body, provider), requestTypedRelation: (body, provider) => request('typed-relations', body, provider) };
})(globalThis);
