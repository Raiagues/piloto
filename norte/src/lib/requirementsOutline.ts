import { useSyncExternalStore } from 'react';

export type OutlineGroup = { id: string; name: string; count: number };
export type RequirementsOutline = { projectId: string; total: number; groups: OutlineGroup[] };

/** The requirements page publishes its subsystem tree; the sidebar shows it under Requirements. */
let outline: RequirementsOutline | null = null;
const listeners = new Set<() => void>();
export function publishRequirementsOutline(value: RequirementsOutline | null) {
  if (JSON.stringify(value) === JSON.stringify(outline)) return;
  outline = value; for (const listener of listeners) listener();
}
export function useRequirementsOutline() {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener); }, () => outline, () => outline);
}
export function selectedSubsystem() {
  return typeof window === 'undefined' ? '' : new URL(window.location.href).searchParams.get('subsystem') || '';
}
export function selectSubsystem(id: string) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set('subsystem', id); else url.searchParams.delete('subsystem');
  url.searchParams.delete('delivery-record');
  if (url.hash.split('?')[0] === '#/requirements') { window.history.replaceState(window.history.state, '', url); window.dispatchEvent(new PopStateEvent('popstate')); return; }
  url.hash = '/requirements'; window.history.pushState(null, '', url);
  window.dispatchEvent(new PopStateEvent('popstate')); window.dispatchEvent(new HashChangeEvent('hashchange'));
}
