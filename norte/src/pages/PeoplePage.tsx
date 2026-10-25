import '../styles/features/contacts.css';
import { useEffect, useRef, useState } from 'react';
import { MessageSquare, Search } from 'lucide-react';
import { combinePeoplePages, PEOPLE_PAGE_SIZE } from '../lib/peopleDirectory';
import type { PeopleDirectoryPage } from '../lib/peopleDirectory';
import { useAuth } from '../lib/auth';
import type { Language } from '../lib/types';
import '../styles/features/teams.css';
export type PlatformPerson = { id: string; name: string; nickname: string; institution?: string; presence: 'online' | 'offline'; lastSeenAt: string | null; email?: string; demoAccount?: boolean; active?: boolean };
export function PeoplePage({ language }: { language: Language }) {
  const { api, user } = useAuth(), pt = language === 'pt'; const [people, setPeople] = useState<PlatformPerson[]>([]), [query, setQuery] = useState(''), [error, setError] = useState(''), [total, setTotal] = useState(0);
  const [loading, setLoading] = useState<'initial' | 'more' | 'refresh' | null>('initial');
  const actions = useRef<{ more: () => void; retry: () => void }>({ more: () => {}, retry: () => {} });
  useEffect(() => {
    let disposed = false, busy = false, loadedPages = 1;
    let currentRequest: AbortController | null = null;
    setPeople([]); setTotal(0); setError(''); setLoading('initial');
    async function load(count: number, reason: 'initial' | 'more' | 'refresh') {
      if (disposed || busy) return;
      busy = true; const controller = new AbortController(); currentRequest = controller; setLoading(reason);
      try {
        const pages = await Promise.all(Array.from({ length: count }, (_, index) => api<PeopleDirectoryPage>(`/platform/people?q=${encodeURIComponent(query.trim())}&offset=${index * PEOPLE_PAGE_SIZE}`, { signal: controller.signal })));
        if (disposed || controller.signal.aborted) return;
        const result = combinePeoplePages(pages);
        loadedPages = Math.max(1, Math.min(count, Math.ceil(result.total / PEOPLE_PAGE_SIZE)));
        setPeople(result.users); setTotal(result.total); setError('');
      } catch (reason) {
        if (!disposed && !controller.signal.aborted) setError(reason instanceof Error ? reason.message : (pt ? 'Não foi possível carregar as pessoas.' : 'Could not load people.'));
      } finally { busy = false; if (!disposed) setLoading(null); }
    }
    actions.current = { more: () => void load(loadedPages + 1, 'more'), retry: () => void load(loadedPages, 'refresh') };
    const debounce = window.setTimeout(() => void load(1, 'initial'), 200);
    const interval = window.setInterval(() => { if (document.visibilityState === 'visible') void load(loadedPages, 'refresh'); }, 30000);
    return () => { disposed = true; currentRequest?.abort(); window.clearTimeout(debounce); window.clearInterval(interval); actions.current = { more: () => {}, retry: () => {} }; };
  }, [api, query, user?.id, pt]);
  return <main className="platform-page people-page contacts-page" aria-label={pt ? 'Contatos' : 'Contacts'}>
    <header className="contacts-toolbar"><label className="platform-search"><Search size={17} /><input aria-label={pt ? 'Buscar contatos' : 'Find contacts'} placeholder={pt ? 'Buscar por nome ou nickname' : 'Search name or nickname'} value={query} onChange={event => setQuery(event.target.value)} /></label></header>
    {error && <p role="alert">{error} <button className="platform-secondary" type="button" onClick={() => actions.current.retry()} disabled={Boolean(loading)}>{pt ? 'Tentar novamente' : 'Try again'}</button></p>}
    {loading === 'initial' && <p className="platform-muted" role="status">{pt ? 'Carregando contatos…' : 'Loading contacts…'}</p>}
    <section className="platform-card people-directory"><table><thead><tr><th>{pt ? 'Contato' : 'Contact'}</th><th>{pt ? 'Disponibilidade' : 'Availability'}</th><th>{pt ? 'Último acesso' : 'Last active'}</th><th /></tr></thead><tbody>{people.filter(person => person.active !== false).map(person => <tr key={person.id}>
      <td><div className="contact-identity"><span className="contact-avatar" aria-hidden="true">{person.name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase()}</span><span><strong>{person.name}</strong><small>@{person.nickname}</small></span></div></td>
      <td><span className={`platform-presence ${person.presence}`}>{person.presence === 'online' ? 'Online' : 'Offline'}</span></td>
      <td data-label={pt ? 'Último acesso' : 'Last active'}>{person.lastSeenAt ? new Date(person.lastSeenAt).toLocaleString(pt ? 'pt-BR' : 'en') : '—'}</td>
      <td>{person.id !== user?.id && <a className="platform-secondary" href={`#/messages?with=${encodeURIComponent(person.id)}`}><MessageSquare size={15} />{pt ? 'Conversar' : 'Message'}</a>}</td>
    </tr>)}</tbody></table>{!people.length && loading !== 'initial' && !error && <p className="platform-empty">{pt ? 'Nenhum contato encontrado.' : 'No contacts found.'}</p>}</section>
    {people.length < total && <div className="platform-directory-footer"><button className="platform-secondary" type="button" disabled={Boolean(loading)} onClick={() => actions.current.more()}>{loading === 'more' ? (pt ? 'Carregando…' : 'Loading…') : (pt ? 'Carregar mais' : 'Load more')}</button></div>}
  </main>;
}
