import { useEffect, useState } from 'react';
import { UsersRound } from 'lucide-react';
import { useAuth } from '../lib/auth';
import type { Language } from '../lib/types';
type Viewer = { id: string; name: string; mode: 'viewing'|'editing'; self: boolean };
export function DocumentPresence({ artifactId, mode = 'viewing', language }: { artifactId: string; mode?: 'viewing'|'editing'; language: Language }) {
  const { api } = useAuth(), [people, setPeople] = useState<Viewer[]>([]), [clientId] = useState(() => window.crypto.randomUUID());
  useEffect(() => {
    let active = true; setPeople([]);
    const heartbeat = async () => { try { const result = await api<{ viewers: Viewer[] }>(`/artifacts/${encodeURIComponent(artifactId)}/viewers`, { method: 'POST', body: JSON.stringify({ clientId, mode: document.visibilityState === 'visible' ? mode : 'leave' }) }); if (active) setPeople(result.viewers); } catch { if (active) setPeople([]); } };
    void heartbeat(); const timer = window.setInterval(() => void heartbeat(), 20000); document.addEventListener('visibilitychange', heartbeat);
    return () => { active = false; window.clearInterval(timer); document.removeEventListener('visibilitychange', heartbeat); void api(`/artifacts/${encodeURIComponent(artifactId)}/viewers`, { method: 'POST', body: JSON.stringify({ clientId, mode: 'leave' }) }).catch(() => {}); };
  }, [api, artifactId, mode, clientId]);
  const other = people.filter(person => !person.self);
  return other.length ? <div className="document-presence" aria-live="polite"><UsersRound size={15} /><span>{other.map(person => `${person.name} · ${person.mode === 'editing' ? (language === 'pt' ? 'editando' : 'editing') : (language === 'pt' ? 'lendo' : 'reading')}`).join(' / ')}</span></div> : null;
}
