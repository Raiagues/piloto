import type { Language } from './types';

export function getStoredLanguage(): Language {
  if (typeof window === 'undefined') return 'pt';
  try { return window.localStorage.getItem('norte-language') === 'en' ? 'en' : 'pt'; } catch { return 'pt'; }
}

/** One preference for every page, including the embedded meeting room. */
export function setStoredLanguage(language: Language): void {
  try { window.localStorage.setItem('norte-language', language); } catch { /* The current page still switches. */ }
  document.documentElement.lang = language === 'pt' ? 'pt-BR' : 'en';
  window.dispatchEvent(new CustomEvent('norte:language-change', { detail: { language } }));
}

/** Short relative time for recent activity: "agora", "há 5 minutos", "ontem", then a short date. */
export function timeAgo(value: string | null | undefined, language: Language): string {
  const at = Date.parse(value || ''); if (!Number.isFinite(at)) return '';
  const locale = language === 'pt' ? 'pt-BR' : 'en', minutes = Math.round((Date.now() - at) / 60000), format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (minutes < 1) return language === 'pt' ? 'agora' : 'now';
  if (minutes < 60) return format.format(-minutes, 'minute');
  if (minutes < 1440) return format.format(-Math.round(minutes / 60), 'hour');
  const days = Math.round(minutes / 1440), date = new Date(at);
  if (days < 7) return format.format(-days, 'day');
  return date.toLocaleDateString(locale, { day: 'numeric', month: 'short', ...(date.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' as const } : {}) });
}
