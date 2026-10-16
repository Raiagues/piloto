import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import type { Language } from '../lib/types';

type ActivityUser = { id: string; name: string; email?: string; accessRole?: string; presence: 'online' | 'offline'; lastSeenAt: string | null };
export function UserActivity({ language, projectId }: { language: Language; projectId?: string }) {
  const { api } = useAuth(), pt = language === 'pt';
  const [users, setUsers] = useState<ActivityUser[]>([]), [error, setError] = useState('');
  const load = useCallback(async () => {
    try { const result = await api<{ users: ActivityUser[] }>(projectId ? `/projects/${projectId}/activity` : '/admin/users'); setUsers(result.users); setError(''); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Falha ao carregar usuários.'); }
  }, [api, projectId]);
  useEffect(() => { void load(); const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 30_000); return () => window.clearInterval(timer); }, [load]);
  return <section className="organization-panel"><h2>{projectId ? (pt ? 'Atividade dos participantes' : 'Participant activity') : (pt ? 'Usuários da plataforma' : 'Platform users')}</h2>
    <p>{pt ? 'Online indica atividade recente em uma sessão aberta. O status é atualizado automaticamente.' : 'Online indicates recent activity in an open session. Status updates automatically.'}</p>
    {error && <p role="alert">{error}</p>}
    <div className="activity-scroll"><table><thead><tr><th>{pt ? 'Pessoa' : 'Person'}</th>{!projectId && <th>E-mail</th>}<th>Status</th><th>{pt ? 'Último acesso' : 'Last active'}</th></tr></thead><tbody>{users.map(user => <tr key={user.id}><td>{user.name}</td>{!projectId && <td>{user.email}</td>}<td><span className={`presence-${user.presence}`}>{user.presence === 'online' ? '● Online' : '○ Offline'}</span></td><td>{user.lastSeenAt ? new Date(user.lastSeenAt).toLocaleString(pt ? 'pt-BR' : 'en-GB') : (pt ? 'Ainda não acessou' : 'No activity yet')}</td></tr>)}</tbody></table></div>
  </section>;
}
