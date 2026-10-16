import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/lib/apiClient';
import { canRetainReadCache, teamProjectCacheKey } from '../src/lib/projectLoading';

describe('project read cache boundaries', () => {
  it('keeps loaded data during temporary transport and server outages', () => {
    for (const status of [408, 429, 500, 502, 503, 504]) expect(canRetainReadCache(new ApiError(status, 'READ_FAILED', 'Fixture'))).toBe(true);
    expect(canRetainReadCache(new TypeError('Failed to fetch'))).toBe(true);
  });
  it('discards cached access on unauthorized, forbidden, missing and unexpected failures', () => {
    for (const status of [400, 401, 403, 404, 409]) expect(canRetainReadCache(new ApiError(status, 'READ_FAILED', 'Fixture'))).toBe(false);
    expect(canRetainReadCache(new Error('Unexpected response'))).toBe(false);
  });
  it('never reuses an internal team list for a public audience or another team', () => {
    expect(teamProjectCacheKey('team-a', true)).not.toBe(teamProjectCacheKey('team-a', false));
    expect(teamProjectCacheKey('team-a', true)).not.toBe(teamProjectCacheKey('team-b', true));
  });
});
