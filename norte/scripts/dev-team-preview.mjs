import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildApp } from '../server/app.mjs';
const storeFile = resolve(process.argv[2] || 'var/team-preview-data.json');
if (process.env.NODE_ENV === 'production' || process.env.RENDER || process.env.DATABASE_URL) throw new Error('Este servidor é exclusivo de teste local, sem banco remoto.');
const data = JSON.parse(await readFile(storeFile, 'utf8'));
if (data.environment !== 'team-preview-test') throw new Error('Use somente uma cópia preparada pelo seed-team-preview.');
const webPort = Number(process.env.NORTE_PREVIEW_PORT || 5291);
process.env.NORTE_ALLOWED_ORIGINS = `http://127.0.0.1:${webPort}`;
// Deliberately do not load .env files, SMTP or the paid AI provider here.
const app = await buildApp({ storeFile, cookieName: 'norte_preview_session', logger: false, databaseUrl: '', mailer: { configured: false }, ai: { apiKey: '' }, systemAi: { apiKey: '' } });
await app.listen({ host: '127.0.0.1', port: 0 });
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(webPort), '--strictPort'], { stdio: 'inherit', env: { ...process.env, VITE_DEMO_MODE: 'false', VITE_API_BASE_URL: '', VITE_API_PROXY_TARGET: `http://127.0.0.1:${app.server.address().port}` } });
console.log(`Ambiente isolado: http://127.0.0.1:${webPort}/norte/ — entre com a conta já existente na cópia. Email e Gemini desativados.`);
let stopping = false;
const stop = async () => { if (stopping) return; stopping = true; vite.kill('SIGTERM'); await app.close(); };
process.on('SIGINT', () => void stop()); process.on('SIGTERM', () => void stop()); vite.on('exit', () => void stop());
