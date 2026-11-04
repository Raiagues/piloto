import { openWorkspace } from './workspaceHistory';

const SELECTIONS = ['meeting', 'event', 'view', 'document', 'artifact', 'review', 'delivery-record', 'subsystem'];

/** An address inside the app: the project stays, selections from other screens do not. */
export function workspaceLink(hash: string, params: Record<string, string | undefined> = {}, projectId = '') {
  const url = new URL(window.location.href);
  for (const key of SELECTIONS) url.searchParams.delete(key);
  if (projectId) url.searchParams.set('project', projectId);
  for (const [key, value] of Object.entries(params)) if (value) url.searchParams.set(key, value);
  url.hash = hash.replace(/^#/, '');
  return url.pathname + url.search + url.hash;
}

export const reviewLink = (projectId: string, reviewId: string, documentId = '') =>
  workspaceLink('#/schedule', { review: reviewId, document: documentId }, projectId);
export const activityLink = (projectId: string, taskId: string) =>
  workspaceLink('#/schedule', { 'delivery-record': taskId }, projectId);
export const requirementLink = (projectId: string, requirementId: string) =>
  workspaceLink('#/requirements', { 'delivery-record': requirementId }, projectId);
export const sourceLink = (projectId: string, artifactId: string) =>
  workspaceLink('#/project', { artifact: artifactId }, projectId);
export const meetingLink = (meetingId: string, minutes = false) =>
  workspaceLink('#/meetings', { meeting: meetingId, view: minutes ? 'minutes' : undefined });

export const openLink = (href: string) => openWorkspace(href);
