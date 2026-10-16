import { expect, it } from 'vitest';
import { combinePeoplePages } from '../src/lib/peopleDirectory';
const person = (id: string, presence: 'online' | 'offline' = 'offline') => ({ id, name: id, nickname: id, presence, lastSeenAt: null });
it('combines all loaded pages, deduplicates moving entries and applies fresh presence', () => {
  const snapshot = combinePeoplePages([{ users: [person('a'), person('b')], total: 4 }, { users: [person('b', 'online'), person('c')], total: 4 }]);
  expect(snapshot.users.map(item => item.id)).toEqual(['a', 'b', 'c']);
  expect(snapshot.users.find(item => item.id === 'b')?.presence).toBe('online');
  expect(snapshot.total).toBe(4);
});
it('removes users no longer returned on a refresh instead of retaining stale permissions', () => {
  const snapshot = combinePeoplePages([{ users: [person('c')], total: 1 }, { users: [], total: 1 }]);
  expect(snapshot.users.map(item => item.id)).toEqual(['c']); expect(snapshot.total).toBe(1);
});
