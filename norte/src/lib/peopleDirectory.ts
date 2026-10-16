import type { PlatformPerson } from '../pages/PeoplePage';
export type PeopleDirectoryPage = { users: PlatformPerson[]; total: number };
export const PEOPLE_PAGE_SIZE = 100;
/** A refresh replaces the loaded window, never just its first page. */
export function combinePeoplePages(pages: PeopleDirectoryPage[]) {
  const users = new Map<string, PlatformPerson>();
  for (const page of pages) for (const person of page.users) users.set(person.id, person);
  return { users: [...users.values()], total: Math.max(0, pages[0]?.total || 0) };
}
