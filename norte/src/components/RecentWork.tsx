import { useEffect, useRef, useState } from 'react';
import { CalendarClock, ClipboardCheck, FilePen, History, LayoutDashboard, ListChecks, Paperclip, ScrollText, Video, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { bindRecentWork, forgetWorkspace, hasUnsavedDraft, openWorkspace, useRecentWork, workspaceKind } from '../lib/workspaceHistory';
import type { WorkspaceItem, WorkspaceKind } from '../lib/workspaceHistory';
import { timeAgo } from '../lib/i18n';
import type { Language } from '../lib/types';
import '../styles/recent-work.css';

const kinds: Record<WorkspaceKind, { Icon: LucideIcon; pt: string; en: string }> = {
  meeting: { Icon: Video, pt: 'Reunião', en: 'Meeting' },
  minutes: { Icon: ScrollText, pt: 'Ata de reunião', en: 'Meeting minutes' },
  requirement: { Icon: ListChecks, pt: 'Requisito', en: 'Requirement' },
  document: { Icon: FilePen, pt: 'Documento', en: 'Document' },
  source: { Icon: Paperclip, pt: 'Arquivo de origem', en: 'Source file' },
  review: { Icon: ClipboardCheck, pt: 'Pacote de revisão', en: 'Review package' },
  task: { Icon: CalendarClock, pt: 'Atividade do cronograma', en: 'Schedule activity' },
  page: { Icon: LayoutDashboard, pt: 'Página', en: 'Page' }
};
export function recentKind(item: WorkspaceItem, pt: boolean) { const kind = kinds[item.kind || workspaceKind(item.href)]; return { ...kind, label: pt ? kind.pt : kind.en }; }

/** One row per shortcut: what it is, where it belongs and whether it has unsaved work. */
export function RecentList({ items, language, onOpen }: { items: WorkspaceItem[]; language: Language; onOpen?: () => void }) {
  const pt = language === 'pt';
  return <ul className="recent-list">{[...items].reverse().map(item => {
    const kind = recentKind(item, pt), unsaved = hasUnsavedDraft(item);
    return <li key={item.href} data-kind={item.kind || workspaceKind(item.href)}>
      <button type="button" className="recent-open" onClick={() => { onOpen?.(); openWorkspace(item.href); }} title={item.label}>
        <span className="recent-icon"><kind.Icon size={16} aria-hidden="true" /></span>
        <span className="recent-copy"><strong>{item.label}</strong><small>{[kind.label, item.context, timeAgo(item.openedAt, language)].filter(Boolean).join(' · ')}</small></span>
        {unsaved ? <em className="recent-flag unsaved">{pt ? 'Não salvo' : 'Unsaved'}</em> : item.detail ? <em className="recent-flag">{item.detail}</em> : null}
      </button>
      <button type="button" className="recent-forget" aria-label={`${pt ? 'Remover dos recentes' : 'Remove from recent'}: ${item.label}`} onClick={() => forgetWorkspace(item.href)}><X size={13} /></button>
    </li>;
  })}</ul>;
}

export function RecentWork({ userId, language }: { userId: string; language: Language }) {
  const pt = language === 'pt', items = useRecentWork(), [open, setOpen] = useState(false), root = useRef<HTMLDivElement>(null);
  useEffect(() => bindRecentWork(userId), [userId]);
  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => { if (event instanceof KeyboardEvent ? event.key === 'Escape' : !root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', close);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', close); };
  }, [open]);
  return <div className="recent-work" ref={root}>
    <button type="button" className="header-icon-button" aria-expanded={open} aria-haspopup="dialog" aria-label={pt ? 'Abertos recentemente' : 'Recently opened'} title={pt ? 'Abertos recentemente' : 'Recently opened'} onClick={() => setOpen(value => !value)}>
      <History size={18} />{items.length > 0 && <span className="header-count">{items.length}</span>}
    </button>
    {open && <section className="recent-popover" role="dialog" aria-label={pt ? 'Abertos recentemente' : 'Recently opened'}>
      <header><strong>{pt ? 'Abertos recentemente' : 'Recently opened'}</strong>{items.length > 0 && <button type="button" onClick={() => forgetWorkspace()}>{pt ? 'Limpar' : 'Clear'}</button>}</header>
      {items.length ? <RecentList items={items} language={language} onOpen={() => setOpen(false)} /> : <p className="recent-empty">{pt ? 'Reuniões, atas, requisitos e documentos que você abrir aparecem aqui.' : 'Meetings, minutes, requirements and documents you open appear here.'}</p>}
    </section>}
  </div>;
}
