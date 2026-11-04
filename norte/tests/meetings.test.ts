import { describe, expect, it } from 'vitest';
import { meetingFrameURL, participantIsPresent } from '../src/lib/meetings';

describe('meeting client', () => {
  it('builds authenticated meeting links without interpolating user paths', () => {
    expect(meetingFrameURL('meeting-1', 'archive')).toBe('/meeting/meeting-1?meeting=meeting-1#reuniao');
    expect(meetingFrameURL('../other', 'meeting')).toContain('/meeting/..%2Fother?');
  });
  it('presence expires and invalid or future clocks never claim someone is online', () => {
    const person = { userId: 'a', nickname: 'a', name: 'A', role: 'host' as const, lastSeenAt: '2026-01-01T00:00:00Z' };
    const now = Date.parse(person.lastSeenAt);
    expect(participantIsPresent(person, now + 30_000)).toBe(true);
    expect(participantIsPresent(person, now + 90_000)).toBe(false);
    expect(participantIsPresent({ ...person, lastSeenAt: 'invalid' }, now)).toBe(false);
    expect(participantIsPresent(person, now - 1)).toBe(false);
  });
});
