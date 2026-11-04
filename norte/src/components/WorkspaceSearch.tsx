import { useDeferredValue, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
  ArrowRight,
  CalendarDays,
  Clock3,
  CornerDownLeft,
  Diamond,
  FileText,
  FolderKanban,
  Layers,
  ListChecks,
  MessageSquare,
  Paperclip,
  PanelsTopLeft,
  Search,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { buildSearchIndex } from '../lib/searchIndex';
import { searchWorkspace } from '../lib/workspaceSearch';
import type { SearchKind, SearchResult, Segment } from '../lib/workspaceSearch';
import { useDeliverySnapshot, useMeetingsSnapshot } from '../lib/workspaceIndex';
import { useRecentWork } from '../lib/workspaceHistory';
import { countdown } from '../lib/sidebarTree';
import { deliveryStatus } from '../lib/projectDelivery';
import type { ProjectSummary } from '../lib/team';
import type { Language } from '../lib/types';
import '../styles/features/workspace-search.css';

type Props = {
  language: Language;
  projectId: string;
  projectName: string;
  projects: ProjectSummary[];
  teams: { id: string; name: string }[];
  onClose: () => void;
  onOpen: (href: string) => void;
  onProjectSelect: (id: string) => void;
};

const KINDS: Record<SearchKind, { pt: string; en: string; Icon: LucideIcon }> = {
  review: { pt: 'Revisões', en: 'Reviews', Icon: Diamond },
  requirement: { pt: 'Requisitos', en: 'Requirements', Icon: ListChecks },
  document: { pt: 'Documentos', en: 'Documents', Icon: FileText },
  meeting: { pt: 'Reuniões', en: 'Meetings', Icon: MessageSquare },
  task: { pt: 'Atividades', en: 'Activities', Icon: CalendarDays },
  phase: { pt: 'Fases', en: 'Phases', Icon: Layers },
  source: { pt: 'Arquivos de origem', en: 'Source files', Icon: Paperclip },
  project: { pt: 'Projetos', en: 'Projects', Icon: FolderKanban },
  page: { pt: 'Páginas', en: 'Pages', Icon: PanelsTopLeft },
};
const GROUP_LIMIT = 4;

function Marked({ parts }: { parts: Segment[] }) {
  return (
    <>
      {parts.map((part, index) =>
        part.hit ? <mark key={index}>{part.text}</mark> : <span key={index}>{part.text}</span>,
      )}
    </>
  );
}

function statusLabel(result: SearchResult, pt: boolean) {
  const status = result.statuses?.[0];
  if (!status) return '';
  if (result.kind === 'meeting')
    return status === 'running'
      ? pt
        ? 'Ao vivo'
        : 'Live'
      : status === 'done'
        ? pt
          ? 'Ata'
          : 'Minutes'
        : pt
          ? 'Não iniciada'
          : 'Not started';
  if (result.kind === 'phase') return status === 'running' ? (pt ? 'Fase atual' : 'Current phase') : '';
  return deliveryStatus(status, pt);
}

/** Local search over what the account can already open: reviews, requirements, documents, meetings and pages. */
export function WorkspaceSearch({
  language,
  projectId,
  projectName,
  projects,
  teams,
  onClose,
  onOpen,
  onProjectSelect,
}: Props) {
  const pt = language === 'pt',
    listId = useId();
  const delivery = useDeliverySnapshot(projectId),
    meetings = useMeetingsSnapshot(),
    recent = useRecentWork();
  const [query, setQuery] = useState(''),
    [tab, setTab] = useState<SearchKind | 'all'>('all'),
    [active, setActive] = useState(0);
  const deferred = useDeferredValue(query);
  const dialog = useRef<HTMLDivElement>(null),
    input = useRef<HTMLInputElement>(null),
    list = useRef<HTMLDivElement>(null);
  const items = useMemo(
    () => buildSearchIndex({ language, projectId, delivery, meetings, projects, teams }),
    [language, projectId, delivery, meetings, projects, teams],
  );
  const outcome = useMemo(() => searchWorkspace(items, deferred, { language, limit: 80 }), [items, deferred, language]);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    input.current?.focus();
    return () => {
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    setActive(0);
  }, [deferred, tab]);

  // Groups follow their best match, so the first row is always the strongest result.
  const groups = useMemo(() => {
    const byKind = new Map<SearchKind, SearchResult[]>();
    for (const result of outcome.results) byKind.set(result.kind, [...(byKind.get(result.kind) || []), result]);
    return [...byKind.entries()]
      .map(([kind, results]) => ({ kind, results }))
      .sort((a, b) => b.results[0].score - a.results[0].score);
  }, [outcome.results]);
  const tabKind = tab !== 'all' && groups.some(group => group.kind === tab) ? tab : 'all';
  const shownGroups =
    tabKind === 'all'
      ? groups.map(group => ({
          ...group,
          more: Math.max(0, group.results.length - GROUP_LIMIT),
          results: group.results.slice(0, GROUP_LIMIT),
        }))
      : groups.filter(group => group.kind === tabKind).map(group => ({ ...group, more: 0 }));

  const next = delivery
    ? items.filter(item => item.kind === 'review' && item.boost && item.boost >= 0.6)[0]
    : undefined;
  const suggestions = useMemo(() => {
    const month = new Date().toLocaleDateString(pt ? 'pt-BR' : 'en', { month: 'long' });
    const codes = items
      .filter(item => item.kind === 'review')
      .slice(0, 2)
      .map(item => item.code || '')
      .filter(Boolean);
    const requirement = items.find(item => item.kind === 'requirement')?.code;
    return [
      ...codes,
      ...(requirement ? [requirement] : []),
      pt ? 'documentos em rascunho' : 'draft documents',
      pt ? `reuniões de ${month}` : `meetings in ${month}`,
      pt ? 'requisitos com apontamentos' : 'requirements with findings',
      pt ? 'atividades atrasadas' : 'overdue activities',
    ];
  }, [items, pt]);
  const recentItems = [...recent].reverse().slice(0, 5);
  const flat = deferred.trim() ? shownGroups.flatMap(group => group.results) : [];

  const choose = (result: SearchResult) => {
    onClose();
    if (result.kind === 'project') {
      onProjectSelect(result.id.slice('project:'.length));
      return;
    }
    onOpen(result.href);
  };
  const go = (href: string) => {
    onClose();
    onOpen(href);
  };
  const focusActive = (index: number) => {
    setActive(index);
    requestAnimationFrame(() =>
      list.current?.querySelector<HTMLElement>(`[data-index="${index}"]`)?.scrollIntoView({ block: 'nearest' }),
    );
  };
  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key === 'Tab') {
      const focusable = [...(dialog.current?.querySelectorAll<HTMLElement>('input, button:not([disabled])') || [])];
      const index = focusable.indexOf(document.activeElement as HTMLElement);
      if (event.shiftKey && index <= 0) {
        event.preventDefault();
        focusable[focusable.length - 1]?.focus();
      } else if (!event.shiftKey && index === focusable.length - 1) {
        event.preventDefault();
        focusable[0]?.focus();
      }
      return;
    }
    if (document.activeElement !== input.current) return;
    if (event.key === 'ArrowDown' && flat.length) {
      event.preventDefault();
      focusActive((active + 1) % flat.length);
    }
    if (event.key === 'ArrowUp' && flat.length) {
      event.preventDefault();
      focusActive((active - 1 + flat.length) % flat.length);
    }
    // A click goes through the same guards as the sidebar, such as the one that protects a running meeting.
    if (event.key === 'Enter' && flat[active]) {
      event.preventDefault();
      list.current?.querySelector<HTMLButtonElement>(`[data-index="${active}"]`)?.click();
    }
  };

  let index = -1;
  return (
    <div
      className="workspace-search-backdrop"
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialog}
        className="workspace-search"
        role="dialog"
        aria-modal="true"
        aria-label={pt ? 'Buscar no Norte' : 'Search Norte'}
        onKeyDown={onKeyDown}
      >
        <div className="workspace-search-field">
          <Search size={18} aria-hidden="true" />
          <input
            ref={input}
            value={query}
            onChange={event => setQuery(event.target.value)}
            role="combobox"
            aria-expanded={flat.length > 0}
            aria-controls={listId}
            aria-activedescendant={flat[active] ? `${listId}-${active}` : undefined}
            aria-autocomplete="list"
            placeholder={
              pt ? 'Revisão, requisito, documento, reunião, data…' : 'Review, requirement, document, meeting, date…'
            }
            aria-label={pt ? 'O que você procura?' : 'What are you looking for?'}
            spellCheck={false}
          />
          {query && (
            <button
              type="button"
              className="workspace-search-clear"
              onClick={() => {
                setQuery('');
                input.current?.focus();
              }}
              aria-label={pt ? 'Limpar busca' : 'Clear search'}
            >
              <X size={15} aria-hidden="true" />
            </button>
          )}
          <kbd>Esc</kbd>
        </div>
        {deferred.trim() && outcome.intent.chips.length > 0 && (
          <div className="workspace-search-intent" aria-live="polite">
            <span>{pt ? 'Entendi' : 'Understood'}</span>
            {outcome.intent.chips.map(chip => (
              <b key={chip.key}>{chip.label}</b>
            ))}
          </div>
        )}
        {deferred.trim() && groups.length > 0 && (
          <div className="workspace-search-tabs" role="tablist" aria-label={pt ? 'Tipos de resultado' : 'Result types'}>
            <button type="button" role="tab" aria-selected={tabKind === 'all'} onClick={() => setTab('all')}>
              {pt ? 'Tudo' : 'All'}
              <small>{outcome.results.length}</small>
            </button>
            {groups.map(group => (
              <button
                type="button"
                role="tab"
                key={group.kind}
                aria-selected={tabKind === group.kind}
                onClick={() => setTab(group.kind)}
              >
                {pt ? KINDS[group.kind].pt : KINDS[group.kind].en}
                <small>{group.results.length}</small>
              </button>
            ))}
          </div>
        )}
        <div
          className="workspace-search-body"
          ref={list}
          id={listId}
          role={flat.length ? 'listbox' : undefined}
          aria-label={pt ? 'Resultados' : 'Results'}
        >
          {!deferred.trim() ? (
            <div className="workspace-search-start">
              {next && (
                <section>
                  <h3>{pt ? 'Próxima revisão' : 'Next review'}</h3>
                  <button type="button" className="workspace-search-next" onClick={() => go(next.href)}>
                    <Diamond size={15} aria-hidden="true" />
                    <span>
                      <b>{next.code}</b>
                      {next.title}
                      <small>
                        {[
                          next.date ? countdown(next.date, new Date().toISOString().slice(0, 10), pt) : '',
                          next.subtitle,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </small>
                    </span>
                    <ArrowRight size={15} aria-hidden="true" />
                  </button>
                </section>
              )}
              {recentItems.length > 0 && (
                <section>
                  <h3>{pt ? 'Abertos recentemente' : 'Recently opened'}</h3>
                  {recentItems.map(item => (
                    <button
                      type="button"
                      key={item.href}
                      className="workspace-search-recent"
                      onClick={() => go(item.href)}
                    >
                      <Clock3 size={14} aria-hidden="true" />
                      <span>{item.label}</span>
                      <small>{item.context || item.detail}</small>
                    </button>
                  ))}
                </section>
              )}
              <section>
                <h3>{pt ? 'Experimente buscar' : 'Try searching'}</h3>
                <div className="workspace-search-examples">
                  {suggestions.map(example => (
                    <button
                      type="button"
                      key={example}
                      onClick={() => {
                        setQuery(example);
                        input.current?.focus();
                      }}
                    >
                      {example}
                    </button>
                  ))}
                </div>
              </section>
              <p className="workspace-search-scope">
                {projectId
                  ? pt
                    ? `Busca em ${projectName || 'projeto aberto'}, nas suas reuniões e nas páginas do Norte. Entende siglas, códigos, datas e situações.`
                    : `Searches ${projectName || 'the open project'}, your meetings and Norte pages. Understands acronyms, codes, dates and states.`
                  : pt
                    ? 'Abra um projeto para buscar revisões, requisitos e documentos.'
                    : 'Open a project to search reviews, requirements and documents.'}
              </p>
            </div>
          ) : !outcome.results.length ? (
            <div className="workspace-search-empty">
              <Search size={22} aria-hidden="true" />
              <p>{pt ? `Nada encontrado para “${deferred.trim()}”.` : `Nothing found for “${deferred.trim()}”.`}</p>
              <small>
                {!delivery && projectId
                  ? pt
                    ? 'Os dados do projeto ainda estão carregando.'
                    : 'Project data is still loading.'
                  : pt
                    ? 'Tente uma sigla (SRR), um código (LYLE-003), um mês ou uma situação como “rascunho”.'
                    : 'Try an acronym (SRR), a code, a month or a state such as “draft”.'}
              </small>
            </div>
          ) : (
            <>
              {outcome.approximate && (
                <p className="workspace-search-approximate">
                  {pt
                    ? 'Nenhum resultado tem todas as palavras. Estes são os mais próximos.'
                    : 'No result has every word. These are the closest.'}
                </p>
              )}
              {shownGroups.map(group => {
                const meta = KINDS[group.kind];
                return (
                  <section
                    key={group.kind}
                    className="workspace-search-group"
                    role="group"
                    aria-label={pt ? meta.pt : meta.en}
                  >
                    {tabKind === 'all' && (
                      <h3>
                        <meta.Icon size={13} aria-hidden="true" />
                        {pt ? meta.pt : meta.en}
                      </h3>
                    )}
                    {group.results.map(result => {
                      index++;
                      const current = index === active,
                        label = statusLabel(result, pt);
                      return (
                        <button
                          type="button"
                          role="option"
                          id={`${listId}-${index}`}
                          data-index={index}
                          key={result.id}
                          aria-selected={current}
                          className={`workspace-search-result kind-${result.kind}${current ? ' is-active' : ''}`}
                          onMouseMove={(position => () => {
                            if (active !== position) setActive(position);
                          })(index)}
                          onClick={() => choose(result)}
                        >
                          <span className="workspace-search-icon" aria-hidden="true">
                            <meta.Icon size={15} />
                          </span>
                          <span className="workspace-search-copy">
                            <strong>
                              {result.code && result.code !== result.title.split(/\s*[·:]\s*/)[0] && (
                                <b>{result.code}</b>
                              )}
                              <Marked parts={result.titleParts} />
                            </strong>
                            {result.subtitle && <small>{result.subtitle}</small>}
                            {result.snippet && (
                              <em>
                                <Marked parts={result.snippet} />
                              </em>
                            )}
                          </span>
                          {label && (
                            <span className={`workspace-search-status status-${result.statuses?.[0]}`}>{label}</span>
                          )}
                          {current && (
                            <CornerDownLeft className="workspace-search-enter" size={14} aria-hidden="true" />
                          )}
                        </button>
                      );
                    })}
                    {group.more > 0 && (
                      <button type="button" className="workspace-search-more" onClick={() => setTab(group.kind)}>
                        {pt ? `Ver todos os ${group.more + GROUP_LIMIT}` : `See all ${group.more + GROUP_LIMIT}`}
                        <ArrowRight size={13} aria-hidden="true" />
                      </button>
                    )}
                  </section>
                );
              })}
            </>
          )}
        </div>
        <footer className="workspace-search-footer">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd>
            {pt ? 'navegar' : 'move'}
          </span>
          <span>
            <kbd>Enter</kbd>
            {pt ? 'abrir' : 'open'}
          </span>
          <span>
            <kbd>Esc</kbd>
            {pt ? 'fechar' : 'close'}
          </span>
          <span className="workspace-search-local">
            {pt ? 'Busca local, sem enviar seus dados' : 'Local search, nothing is sent'}
          </span>
        </footer>
      </div>
    </div>
  );
}
