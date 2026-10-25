import type { Language } from './types';

export function getStoredLanguage(): Language {
  if (typeof window === 'undefined') return 'pt';
  return window.localStorage.getItem('norte-language') === 'en' ? 'en' : 'pt';
}

export function setStoredLanguage(language: Language): void {
  window.localStorage.setItem('norte-language', language);
}
