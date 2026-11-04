/* Checks JEV requests and responses, and reads the answer of each question. */
(function (root) {
  'use strict';
  const clone = value => JSON.parse(JSON.stringify(value));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const request = input => clone({ model: input.config.model, state: input.state, questions: input.config.questions });
  function validateState(state) {
    if (typeof state === 'string') {
      if (!state.trim() || state.length > 16000) throw Error('Escreva um State de até 16.000 caracteres.');
      return;
    }
    if (!state || typeof state !== 'object' || !Object.keys(state).length)
      throw Error('State deve ser texto, objeto ou lista JSON não vazios.');
    function visit(value, depth) {
      if (depth > 16) throw Error('State excede 16 níveis de profundidade.');
      if (
        value === null ||
        typeof value === 'string' ||
        typeof value === 'boolean' ||
        (typeof value === 'number' && Number.isFinite(value))
      )
        return;
      if (
        typeof value !== 'object' ||
        (!Array.isArray(value) &&
          Object.getPrototypeOf(value) !== Object.prototype &&
          Object.getPrototypeOf(value) !== null)
      )
        throw Error('State contém um valor inválido.');
      Object.values(value).forEach(child => visit(child, depth + 1));
    }
    visit(state, 0);
    if (JSON.stringify(state).length > 16000) throw Error('State JSON excede 16.000 caracteres.');
  }
  function validateConfig(config) {
    if (
      !config ||
      config.model !== 'jev-latest' ||
      !config.questions ||
      typeof config.questions !== 'object' ||
      Array.isArray(config.questions)
    )
      throw Error('Configuração de perguntas inválida.');
    const entries = Object.entries(config.questions);
    if (!entries.length || entries.length > 32) throw Error('Use de 1 a 32 perguntas.');
    for (const [id, q] of entries) {
      if (
        !id ||
        id.length > 80 ||
        !q ||
        !['choice', 'score', 'noul'].includes(q.type) ||
        typeof q.instructions !== 'string' ||
        !q.instructions.trim() ||
        q.instructions.length > 1500
      )
        throw Error('Pergunta inválida.');
      if (Object.keys(q).some(k => !['type', 'instructions', 'criteria'].includes(k)))
        throw Error('Campo de pergunta desconhecido.');
      if (
        q.type === 'choice' &&
        (!q.criteria ||
          typeof q.criteria !== 'object' ||
          Array.isArray(q.criteria) ||
          Object.keys(q.criteria).length < 2 ||
          Object.keys(q.criteria).length > 12 ||
          Object.keys(q.criteria).some(k => !k))
      )
        throw Error('Choice precisa de 2 a 12 opções.');
      if (q.type === 'score' && (!Array.isArray(q.criteria) || q.criteria.length < 2 || q.criteria.length > 5))
        throw Error('Score precisa de 2 a 5 níveis.');
      if (
        q.type === 'noul' &&
        q.criteria != null &&
        (typeof q.criteria !== 'object' ||
          Array.isArray(q.criteria) ||
          !Object.keys(q.criteria).length ||
          Object.keys(q.criteria).some(key => !['true', 'false'].includes(key)))
      )
        throw Error('Noul aceita critérios true e/ou false.');
      if (q.criteria && Object.values(q.criteria).some(v => typeof v !== 'string' || v.length > 800))
        throw Error('Critério inválido.');
    }
  }
  function predicted(answer) {
    if (answer.type === 'choice') return answer.choice;
    if (answer.type === 'noul') return answer.noul >= 0.5;
    const ranked = Object.entries(answer.probabilities).sort((a, b) => b[1] - a[1]);
    return Math.abs(ranked[0][1] - ranked[1][1]) < 1e-12 ? null : Number(ranked[0][0]);
  }
  function probabilityOf(answer, value) {
    if (value === null || value === undefined) return null;
    return answer.type === 'noul' ? (value ? answer.noul : 1 - answer.noul) : answer.probabilities[value];
  }
  function validateOutput(output, input) {
    if (
      !output ||
      !same(output.request, request(input)) ||
      !output.response ||
      typeof output.response.model !== 'string' ||
      !Number.isFinite(output.latencyMs) ||
      output.latencyMs < 0
    )
      throw Error('Resultado não corresponde ao teste.');
    const answers = output.response.answers;
    if (!answers || Object.keys(answers).length !== Object.keys(input.config.questions).length)
      throw Error('Respostas incompletas.');
    const probability = n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1;
    for (const [id, q] of Object.entries(input.config.questions)) {
      const a = answers[id];
      if (!a || a.type !== q.type) throw Error('Tipo de resposta inválido.');
      if (q.type === 'noul') {
        if (!probability(a.noul)) throw Error('Probabilidade inválida.');
        continue;
      }
      const keys = Object.keys(q.criteria);
      if (
        !a.probabilities ||
        Object.keys(a.probabilities).length !== keys.length ||
        keys.some(k => !probability(a.probabilities[k])) ||
        Math.abs(Object.values(a.probabilities).reduce((s, v) => s + v, 0) - 1) > 0.02 ||
        !probability(a.confidence)
      )
        throw Error('Distribuição inválida.');
      if (q.type === 'choice' && !keys.includes(a.choice)) throw Error('Classe inválida.');
      if (q.type === 'score' && (!Number.isFinite(a.score) || a.score < 0 || a.score > keys.length - 1))
        throw Error('Score inválido.');
    }
  }
  root.NorteJevAnswers = { clone, validateConfig, validateState, validateOutput, predicted, probabilityOf };
  if (typeof module !== 'undefined') module.exports = root.NorteJevAnswers;
})(globalThis);
