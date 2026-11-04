import { useEffect, useSyncExternalStore } from 'react';
import { ApiError, useAuth } from './auth';
import type { DeliveryState } from './projectDelivery';
import type { MeetingSummary } from './meetings';

type Api = <T>(path: string, init?: RequestInit) => Promise<T>;

/** Read-only snapshots for the sidebar, search and home. Pages keep their own loading, writes and conflict checks. */
const deliveries = new Map<string, DeliveryState>();
const pending = new Map<string, Promise<unknown>>();
let owner = '',
  meetings: MeetingSummary[] | null = null;
const listeners = new Set<() => void>();
const emit = () => {
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const once = <T>(key: string, request: () => Promise<T>) => {
  const running = pending.get(key) as Promise<T> | undefined;
  if (running) return running;
  const next = request().finally(() => pending.delete(key));
  pending.set(key, next);
  return next;
};
// Each account in this tab sees only its own records.
function bindOwner(userId: string) {
  if (owner === userId) return;
  owner = userId;
  deliveries.clear();
  pending.clear();
  meetings = null;
}
// A revoked or removed project must disappear from navigation instead of showing a stale copy.
const lostAccess = (reason: unknown) => reason instanceof ApiError && [401, 403, 404].includes(reason.status);

export const deliveryKey = (userId: string | undefined, projectId: string) =>
  userId && projectId ? `${userId}:${projectId}` : '';
export function publishDelivery(key: string, value: DeliveryState | null) {
  if (!key || !key.startsWith(`${owner}:`)) return;
  const previous = deliveries.get(key);
  if (value ? previous === value || (previous && value.revision < previous.revision) : !previous) return;
  if (value) deliveries.set(key, value);
  else deliveries.delete(key);
  emit();
}
/** Readers that start together share one request; later refreshes always fetch again. */
export function loadDelivery(api: Api, key: string, projectId: string, shared = true) {
  const request = () => api<DeliveryState>(`/projects/${encodeURIComponent(projectId)}/delivery`);
  return shared ? once(`delivery:${key}`, request) : request();
}
export function forgetDeliveryOnFailure(key: string, reason: unknown) {
  if (lostAccess(reason)) publishDelivery(key, null);
}

export function useDeliverySnapshot(projectId: string) {
  const { api, user } = useAuth(),
    userId = user?.id || '',
    key = deliveryKey(userId, projectId);
  bindOwner(userId);
  const value = useSyncExternalStore(
    subscribe,
    () => (key && deliveries.get(key)) || null,
    () => null,
  );
  useEffect(() => {
    if (!key || deliveries.has(key)) return;
    loadDelivery(api, key, projectId).then(
      data => publishDelivery(key, data),
      reason => forgetDeliveryOnFailure(key, reason),
    );
  }, [api, key, projectId]);
  return value;
}

export function publishMeetings(userId: string, list: MeetingSummary[]) {
  if (!userId || userId !== owner) return;
  meetings = list;
  emit();
}
export function useMeetingsSnapshot() {
  const { api, user } = useAuth(),
    userId = user?.id || '';
  bindOwner(userId);
  const value = useSyncExternalStore(
    subscribe,
    () => (userId && userId === owner ? meetings : null),
    () => null,
  );
  useEffect(() => {
    if (!userId) return;
    const load = () => {
      once(`meetings:${userId}`, () => api<{ meetings: MeetingSummary[] }>('/meetings')).then(
        response => publishMeetings(userId, response.meetings),
        () => {
          /* Navigation works without the meeting list. */
        },
      );
    };
    if (!meetings) load();
    window.addEventListener('norte:meetings-changed', load);
    return () => window.removeEventListener('norte:meetings-changed', load);
  }, [api, userId]);
  return value;
}
