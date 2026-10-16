import { ApiError } from './apiClient';

/** Only temporary transport/server errors permit displaying a previously read list. */
export function canRetainReadCache(error: unknown): boolean {
  if (error instanceof ApiError) return error.status === 408 || error.status === 429 || error.status >= 500 && error.status <= 599;
  return error instanceof TypeError; // fetch network failure, never authorization
}

export function teamProjectCacheKey(teamId: string, internal: boolean): string {
  return `${teamId}:${internal ? 'internal' : 'public'}`;
}
