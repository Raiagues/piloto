import { useEffect, useState } from 'react';
import { API_ORIGIN, useAuth } from './auth';
import type { Language } from './types';
const key = 'norte-usage-consent-v1';
let token = '', pending: Promise<string> | null = null;
export const usageAllowed = () => window.localStorage.getItem(key) === 'yes';
async function session() {
  if (!usageAllowed()) return '';
  if (token) return token;
  pending ||= fetch(API_ORIGIN + '/api/platform/telemetry/session', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ consent: true }) }).then(async response => { if (!response.ok) return ''; const result = await response.json(); if (usageAllowed()) token = result.csrfToken; return result.csrfToken as string; }).catch(() => '').finally(() => { pending = null; });
  return pending;
}
export async function trackUsage(name: string, page: string, options: Record<string, string | number> = {}, activeSeconds = 0) {
  const csrf = await session(); if (!csrf || !usageAllowed()) return;
  await fetch(API_ORIGIN + '/api/platform/telemetry/events', { method: 'POST', credentials: 'include', keepalive: true, headers: { 'Content-Type': 'application/json', 'x-usage-token': csrf }, body: JSON.stringify({ name, page, options, activeSeconds, key: crypto.randomUUID() }) }).then(response => { if ([401, 403].includes(response.status)) token = ''; }).catch(() => undefined);
}
export function UsagePrivacyControl({ language }: { language: Language }) {
  const [allowed, setAllowed] = useState(usageAllowed), [busy, setBusy] = useState(false), [error, setError] = useState(''), { api, status } = useAuth();
  async function change(next: boolean) {
    if (busy) return;
    const previousToken = token, pendingSession = pending;
    setError(''); window.localStorage.setItem(key, next ? 'yes' : 'no'); setAllowed(next); window.dispatchEvent(new Event('norte-usage-consent-changed'));
    if (!next) {
      setBusy(true); token = '';
      const csrf = previousToken || await pendingSession;
      const results = await Promise.allSettled([
        csrf ? fetch(API_ORIGIN + '/api/platform/telemetry/session', { method: 'DELETE', credentials: 'include', headers: { 'x-usage-token': csrf } }).then(response => { if (!response.ok) throw new Error('Deletion failed'); }) : Promise.resolve(),
        status === 'authenticated' ? api('/platform/privacy/erase-usage', { method: 'POST' }) : Promise.resolve(),
      ]);
      if (results.some(result => result.status === 'rejected')) setError(language === 'pt' ? 'Coleta interrompida. Não foi possível confirmar a exclusão agora.' : 'Collection stopped. Deletion could not be confirmed now.');
      setBusy(false);
    }
  }
  return <div className="usage-privacy"><label><input type="checkbox" disabled={busy} checked={allowed} onChange={event => void change(event.target.checked)} />{language === 'pt' ? 'Compartilhar métricas de navegação para melhorar o Norte' : 'Share navigation metrics to improve Norte'}</label><small>{language === 'pt' ? 'Telas, tempo ativo, funções usadas e país/região quando disponíveis. Sem conteúdo de documentos ou mensagens. Desativar remove suas métricas de uso.' : 'Pages, active time, feature usage and country/region when available. No document or message content. Disabling removes your usage metrics.'}</small>{error && <p role="alert">{error}</p>}</div>;
}
export function UsageTelemetry() {
  const { user } = useAuth();
  useEffect(() => {
    token = ''; let activeAt = Date.now(), seconds = 0, page = '', consent = usageAllowed();
    const current = () => { const hash = window.location.hash.split('?')[0]; const mapping: Record<string, string> = { '#/': user ? 'home' : 'landing', '#/landing': 'landing', '#/home': 'home', '#/login': 'login', '#/register': 'register', '#/new-project': 'newProject' }; return mapping[hash] || (['requirements', 'verification', 'schedule', 'documents', 'meetings', 'teams', 'invitations', 'people', 'messages', 'privacy', 'terms', 'admin'].find(name => hash.startsWith('#/' + name))) || (user ? 'home' : 'landing'); };
    const flush = () => { if (seconds > 0 && page) void trackUsage('page_time', page, {}, seconds); seconds = 0; };
    const route = () => { flush(); const next = current(); if (page !== next) { page = next; activeAt = Date.now(); if (consent) void trackUsage('page_view', page); } };
    const interaction = () => { activeAt = Date.now(); };
    const click = (event: MouseEvent) => {
      const action = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-usage-action]')?.dataset.usageAction : undefined;
      if (consent && action) void trackUsage('feature_click', page, { action });
    };
    const change = () => { consent = usageAllowed(); token = ''; if (consent) { page = ''; route(); } else seconds = 0; };
    const visibility = () => { if (document.visibilityState !== 'visible') flush(); else activeAt = Date.now(); };
    const timer = window.setInterval(() => { if (consent && document.visibilityState === 'visible' && Date.now() - activeAt < 60000) seconds++; if (seconds >= 30) flush(); }, 1000);
    route(); window.addEventListener('click', click); window.addEventListener('hashchange', route); window.addEventListener('norte-usage-consent-changed', change); window.addEventListener('pointerdown', interaction); window.addEventListener('keydown', interaction); window.addEventListener('scroll', interaction, true); window.addEventListener('pagehide', flush); document.addEventListener('visibilitychange', visibility);
    return () => { flush(); window.clearInterval(timer); window.removeEventListener('click', click); window.removeEventListener('hashchange', route); window.removeEventListener('norte-usage-consent-changed', change); window.removeEventListener('pointerdown', interaction); window.removeEventListener('keydown', interaction); window.removeEventListener('scroll', interaction, true); window.removeEventListener('pagehide', flush); document.removeEventListener('visibilitychange', visibility); };
  }, [user?.id]);
  return null;
}
