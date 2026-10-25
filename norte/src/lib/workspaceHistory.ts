export type WorkspaceItem = { label: string; href: string };

export function rememberWorkspace(label: string) {
  window.dispatchEvent(new CustomEvent<WorkspaceItem>('norte:workspace-item', {
    detail: { label, href: window.location.pathname + window.location.search + window.location.hash }
  }));
}

export function openWorkspace(href: string) {
  const url = new URL(href, window.location.origin);
  if (url.origin !== window.location.origin) return;
  window.history.pushState(null, '', url);
  window.dispatchEvent(new PopStateEvent('popstate'));
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}
