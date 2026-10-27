import { useSyncExternalStore } from 'react';

export type WorkspaceKind = 'meeting' | 'minutes' | 'requirement' | 'document' | 'source' | 'review' | 'task' | 'page';
export type WorkspaceItem = { label: string; href: string; kind?: WorkspaceKind; detail?: string; context?: string; openedAt?: string };

/** The kind follows the link itself, so a requirement and a meeting with the same title stay distinct. */
export function workspaceKind(href: string): WorkspaceKind {
  const url = new URL(href, 'http://norte.local'), params = url.searchParams, hash = url.hash.split('?')[0];
  if (params.get('meeting')) return params.get('view') === 'minutes' ? 'minutes' : 'meeting';
  if (params.get('artifact')) return 'source';
  if (params.get('document')) return 'document';
  if (params.get('review')) return 'review';
  if (params.get('delivery-record')) return hash === '#/schedule' ? 'task' : 'requirement';
  return 'page';
}

export function rememberWorkspace(label: string, extra: Omit<WorkspaceItem, 'label' | 'href'> = {}) {
  window.dispatchEvent(new CustomEvent<WorkspaceItem>('norte:workspace-item', {
    detail: { ...extra, label, href: window.location.pathname + window.location.search + window.location.hash }
  }));
}

export function openWorkspace(href: string) {
  const url = new URL(href, window.location.origin);
  if (url.origin !== window.location.origin) return;
  window.history.pushState(null, '', url);
  window.dispatchEvent(new PopStateEvent('popstate'));
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

/** Up to eight shortcuts per account, kept for the browser session only. */
const LIMIT = 8;
let owner = '', items: WorkspaceItem[] = [];
const listeners = new Set<() => void>();
const storageKey = (userId: string) => `norte:recent-work:${userId}`;
function emit() { for (const listener of listeners) listener(); }
function persist() { try { sessionStorage.setItem(storageKey(owner), JSON.stringify(items)); } catch { /* Shortcuts remain for this page. */ } }
export function bindRecentWork(userId: string) {
  if (owner === userId) return;
  owner = userId;
  try { const saved = JSON.parse(sessionStorage.getItem(storageKey(userId)) || '[]'); items = Array.isArray(saved) ? saved.filter(item => typeof item?.label === 'string' && typeof item?.href === 'string' && item.href.startsWith('/')).slice(-LIMIT) : []; }
  catch { items = []; }
  emit();
}
function remember(event: Event) {
  const item = (event as CustomEvent<WorkspaceItem>).detail;
  if (!owner || !item?.label || !item.href?.startsWith('/')) return;
  const previous = items.find(value => value.href === item.href);
  items = [...items.filter(value => value.href !== item.href), { ...previous, ...item, kind: item.kind || workspaceKind(item.href), openedAt: new Date().toISOString() }].slice(-LIMIT);
  persist(); emit();
}
if (typeof window !== 'undefined') window.addEventListener('norte:workspace-item', remember);
export function forgetWorkspace(href?: string) { items = href ? items.filter(value => value.href !== href) : []; persist(); emit(); }
export function useRecentWork() {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener); }, () => items, () => items);
}
/** A document edited in this tab keeps an unsaved draft; show it before reopening. */
export function hasUnsavedDraft(item: WorkspaceItem) {
  if (item.kind !== 'document' || !owner) return false;
  const params = new URL(item.href, 'http://norte.local').searchParams;
  try { return Boolean(sessionStorage.getItem(`norte:document-draft:${owner}:${params.get('project')}:${params.get('document')}`)); } catch { return false; }
}
