import { useEffect, useState } from 'react';
import { FileText, X } from 'lucide-react';
import { openWorkspace } from '../lib/workspaceHistory';
import type { WorkspaceItem } from '../lib/workspaceHistory';
import type { Language } from '../lib/types';
import '../styles/recent-work.css';

export function RecentWork({ userId, language }: { userId: string; language: Language }) {
  const key = `norte:recent-work:${userId}`, pt = language === 'pt';
  const [items, setItems] = useState<WorkspaceItem[]>(() => {
    try { return JSON.parse(sessionStorage.getItem(key) || '[]'); } catch { return []; }
  });
  useEffect(() => {
    const remember = (event: Event) => {
      const item = (event as CustomEvent<WorkspaceItem>).detail;
      if (!item?.label || !item.href?.startsWith('/')) return;
      setItems(previous => {
        const next = [...previous.filter(value => value.href !== item.href), item].slice(-8);
        sessionStorage.setItem(key, JSON.stringify(next));
        return next;
      });
    };
    window.addEventListener('norte:workspace-item', remember);
    return () => window.removeEventListener('norte:workspace-item', remember);
  }, [key]);
  if (!items.length) return null;
  return <nav className="recent-work" aria-label={pt ? 'Trabalho recente' : 'Recent work'}><span>{pt ? 'Recentes' : 'Recent'}</span>{items.map(item => <div key={item.href}>
    <button title={item.label} onClick={() => openWorkspace(item.href)}><FileText size={13}/><span>{item.label}</span></button>
    <button aria-label={`${pt ? 'Remover dos recentes' : 'Remove from recent'}: ${item.label}`} onClick={() => setItems(previous => {
      const next = previous.filter(value => value.href !== item.href); sessionStorage.setItem(key, JSON.stringify(next)); return next;
    })}><X size={12}/></button>
  </div>)}</nav>;
}
