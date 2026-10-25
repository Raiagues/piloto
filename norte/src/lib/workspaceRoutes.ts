export const PROJECT_AREAS = {
  requirements: '#/requirements', verification: '#/verification', schedule: '#/schedule', documents: '#/documents'
} as const;

export type ProjectArea = keyof typeof PROJECT_AREAS;
export type WorkspaceRoute = ProjectArea | 'people' | 'messages' | 'invitations' | 'meetings' | 'newProject' | 'admin' | 'meetingObservability' | 'home' | 'teams';

const routes: Record<string, WorkspaceRoute> = {
  '#/people': 'people', '#/messages': 'messages', '#/invitations': 'invitations', '#/join': 'invitations',
  '#/meetings': 'meetings', '#/new-project': 'newProject', '#/admin': 'admin', '#/admin/users': 'admin',
  '#/admin/meetings': 'meetingObservability', '#/teams': 'teams', '#/': 'home'
};

export function workspaceRoute(hash: string): WorkspaceRoute {
  const path = hash.split('?')[0];
  return Object.entries(PROJECT_AREAS).find(([, value]) => value === path)?.[0] as ProjectArea || routes[path] || 'home';
}

/** Preserve old bookmarks without mounting retired workspaces. */
export function workspaceRedirect(hash: string): string | undefined {
  const path = hash.split('?')[0];
  if (['#/study-setup', '#/project-setup', '#/brainstorming', '#/preliminary-design', '#/ideas', '#/ai-comparison', '#/software'].includes(path)) return '#/requirements';
  if (['#/team', '#/project-team'].includes(path)) return '#/teams';
  if (['#/dashboard', '#/guide', '#/plans'].includes(path)) return '#/';
}
