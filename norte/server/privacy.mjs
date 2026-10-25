export const PRIVACY_VERSION = '2026-10-24';
export function privacyNotice(env = process.env) {
  const has = (...keys) => keys.some(key => Boolean(env[key]?.trim()));
  return {
    version: PRIVACY_VERSION,
    controller: env.NORTE_PRIVACY_CONTROLLER || 'Administração do Norte — projeto independente',
    contact: env.NORTE_PRIVACY_EMAIL || 'emillyraianerodrigues@gmail.com',
    hosting: env.NORTE_HOSTING_DESCRIPTION || (env.RENDER ? 'Render, conforme a região contratada pela responsável.' : 'Servidor desta instalação do Norte.'),
    metricsRetentionDays: 90,
    providers: [
      { name: 'JEV / Typesafe', destination: 'api.typesafe.ai', configured: has('TYPESAFE_API_KEY', 'JEV_API_KEY', 'JEV_KEY_API'), purpose: 'Trechos de fala, perguntas de classificação e exemplos corrigidos da própria reunião.' },
      { name: 'Google Gemini', destination: 'generativelanguage.googleapis.com', configured: has('GOOGLE_API_KEY', 'GEMINI_API_KEY'), purpose: 'Requisitos e referências selecionados nas análises solicitadas; conteúdo da reunião para atas ou organização de blocos, quando habilitada.' },
      { name: 'OpenAI', destination: 'api.openai.com', configured: env.AI_AGENT_PROVIDER === 'openai' && has('OPENAI_API_KEY'), purpose: 'Organização de blocos e correções da reunião, somente se esse provedor estiver selecionado e habilitado.' },
    ],
  };
}
export function registerPrivacy(app, { env = process.env } = {}) {
  app.get('/api/platform/privacy', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return privacyNotice(env);
  });
}
