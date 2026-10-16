import { useCallback, useEffect, useState } from 'react';
import '../collaboration-workspace.css';
import { useAuth } from '../lib/auth';
import type { Language } from '../lib/types';
export type Invitation = { id: string; teamId: string; teamName: string; nickname: string | null; displayName: string | null; email: string; status: string; channel: 'email' | 'nickname'; delivery: string; expiresAt: string };
type FoundUser = { id: string; nickname: string; displayName: string; institution: string; avatarUrl: string };
const message = (e: unknown) => e instanceof Error ? e.message : 'Não foi possível concluir.';
export function TeamInvitations({ teamId, language }: { teamId: string; language: Language }) {
  const { api, user } = useAuth(), pt = language === 'pt';
  const [invitations, setInvitations] = useState<Invitation[]>([]), [configured, setConfigured] = useState(false);
  const [channel, setChannel] = useState<'nickname' | 'email'>('nickname'), [query, setQuery] = useState(''), [found, setFound] = useState<FoundUser | null>(null);
  const [feedback, setFeedback] = useState(''), [busy, setBusy] = useState(false);
  const load = useCallback(async () => { const r = await api<{ invitations: Invitation[]; emailConfigured: boolean }>(`/teams/${teamId}/invitations`); setInvitations(r.invitations); setConfigured(r.emailConfigured); }, [api, teamId]);
  useEffect(() => { void load().catch(e => setFeedback(message(e))); }, [load]);
  async function find() { setBusy(true); setFeedback(''); setFound(null); try { setFound((await api<{ user: FoundUser }>(`/directory/nickname/${encodeURIComponent(query.replace(/^@/, '').trim())}`)).user); } catch (e) { setFeedback(message(e)); } finally { setBusy(false); } }
  async function invite(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setFeedback('');
    try { await api(`/teams/${teamId}/invitations`, { method: 'POST', body: JSON.stringify(channel === 'nickname' ? { nickname: found?.nickname } : { email: query }) }); setFeedback(pt ? 'Convite enviado. A entrada depende do aceite da pessoa.' : 'Invitation sent. Membership requires acceptance.'); setFound(null); setQuery(''); await load(); } catch (e) { setFeedback(message(e)); } finally { setBusy(false); }
  }
  const statusLabel: Record<string, string> = pt ? { pending: 'Pendente', accepted: 'Aceito', declined: 'Recusado', cancelled: 'Cancelado', expired: 'Expirado', failed: 'Falha no envio' } : {};
  return <section className="team-invitations organization-panel"><h3>{pt ? 'Convidar pessoas' : 'Invite people'}</h3>
    <form onSubmit={e => void invite(e)}><label>{pt ? 'Como convidar' : 'Invite by'}<select value={channel} onChange={e => { setChannel(e.target.value as typeof channel); setQuery(''); setFound(null); }}><option value="nickname">Nickname</option><option value="email">Email</option></select></label>
      <label>{channel === 'nickname' ? 'Nickname' : 'Email'}<input required type={channel === 'email' ? 'email' : 'text'} maxLength={channel === 'email' ? 254 : 31} value={query} onChange={e => { setQuery(e.target.value); setFound(null); }} placeholder={channel === 'nickname' ? '@nickname' : 'pessoa@exemplo.com'} /></label>
      {channel === 'nickname' && <button type="button" disabled={busy || !query.trim()} onClick={() => void find()}>{pt ? 'Buscar pessoa' : 'Find person'}</button>}
      {found && <div className="invite-person"><strong>{found.displayName}</strong><span>@{found.nickname}</span><small>{found.institution}</small><p>{pt ? 'Confirme o nome e o identificador antes de enviar.' : 'Confirm the name and identifier before sending.'}</p></div>}
      {channel === 'email' && <p>{!configured ? (pt ? 'O administrador precisa configurar o envio de emails neste ambiente.' : 'Email delivery must be configured by the administrator.') : !user?.emailVerifiedAt ? (pt ? 'Verifique seu email na página de Convites antes de enviar.' : 'Verify your email on the Invitations page first.') : (pt ? 'O destinatário precisará verificar este email e aceitar o convite. Expira em 7 dias.' : 'The recipient must verify this email and accept. Expires in 7 days.')}</p>}
      <button className="primary" type="submit" disabled={busy || (channel === 'nickname' ? !found : !configured || !user?.emailVerifiedAt)}>{pt ? 'Enviar convite' : 'Send invitation'}</button>
    </form>
    {feedback && <p role="status">{feedback}</p>}
    <h4>{pt ? 'Convites enviados' : 'Sent invitations'}</h4>{invitations.length === 0 && <p>{pt ? 'Nenhum convite enviado.' : 'No invitations sent.'}</p>}
    <div className="invitation-list">{invitations.map(i => <article key={i.id}><div><strong>{i.nickname ? `@${i.nickname}` : i.email}</strong><small>{statusLabel[i.status] || i.status} · {pt ? 'Validade' : 'Expires'}: {new Date(i.expiresAt).toLocaleDateString(pt ? 'pt-BR' : 'en-GB')}</small></div>{i.status === 'pending' && <button type="button" disabled={busy} onClick={async () => { setBusy(true); try { await api(`/teams/${teamId}/invitations/${i.id}`, { method: 'DELETE' }); await load(); } catch (e) { setFeedback(message(e)); } finally { setBusy(false); } }}>{pt ? 'Cancelar convite' : 'Cancel invitation'}</button>}</article>)}</div>
  </section>;
}
export function InvitationInbox({ language, onBack }: { language: Language; onBack: () => void }) {
  const { api, user, refresh } = useAuth(), pt = language === 'pt';
  const [params, setParams] = useState(() => new URLSearchParams(window.location.hash.split('?')[1] || ''));
  const [items, setItems] = useState<Invitation[]>([]), [busy, setBusy] = useState(false), [feedback, setFeedback] = useState('');
  const load = useCallback(async () => { setItems((await api<{ invitations: Invitation[] }>('/invitations')).invitations); window.dispatchEvent(new Event('norte-invitations-changed')); }, [api]);
  useEffect(() => {
    const clearLink = () => window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/invitations`);
    const readLink = () => { if (window.location.hash.startsWith('#/invitations?')) { setParams(new URLSearchParams(window.location.hash.split('?')[1])); clearLink(); } };
    clearLink(); void load().catch(e => setFeedback(message(e)));
    window.addEventListener('hashchange', readLink); return () => window.removeEventListener('hashchange', readLink);
  }, [load]);
  async function run(action: () => Promise<unknown>) { setBusy(true); setFeedback(''); try { await action(); await load(); await refresh(); } catch (e) { setFeedback(message(e)); } finally { setBusy(false); } }
  return <main className="collaboration-page invitation-inbox"><header className="workspace-heading"><div><span className="workspace-eyebrow">{pt ? 'COLABORAÇÃO' : 'COLLABORATION'}</span><h1>{pt ? 'Convites' : 'Invitations'}</h1><p>{pt ? 'Gerencie sua participação nas equipes.' : 'Manage your team memberships.'}</p></div><button type="button" className="workspace-action" onClick={onBack}>{pt ? 'Voltar ao início' : 'Back to home'}</button></header>
    <section className="organization-panel"><h2>{pt ? 'Seu email' : 'Your email'}</h2><p>{user?.email} · {user?.emailVerifiedAt ? (pt ? 'Verificado' : 'Verified') : (pt ? 'Ainda não verificado' : 'Not verified')}</p>
      {!user?.emailVerifiedAt && <button type="button" disabled={busy} onClick={() => void run(async () => { await api('/auth/email-verification', { method: 'POST' }); setFeedback(pt ? 'Verificação enviada. Abra o link recebido no seu email.' : 'Verification sent. Open the link in your email.'); })}>{pt ? 'Enviar verificação de email' : 'Send email verification'}</button>}
      {params.get('verification') && <button type="button" disabled={busy || Boolean(user?.emailVerifiedAt)} onClick={() => void run(async () => { await api('/auth/email-verification/confirm', { method: 'POST', body: JSON.stringify({ token: params.get('verification') }) }); setFeedback(pt ? 'Email verificado. Agora você pode aceitar o convite.' : 'Email verified. You can now accept the invitation.'); })}>{pt ? 'Confirmar meu email' : 'Confirm my email'}</button>}
    </section>
    {feedback && <p role="status">{feedback}</p>}
    {params.get('invite') && !items.some(i => i.id === params.get('invite')) && <p>{pt ? 'Este convite não está pendente para esta conta. Confira o email utilizado ou peça um novo convite se ele expirou.' : 'This invitation is not pending for this account. Check your email or request a new invitation if expired.'}</p>}
    <div className="invitation-list">{items.map(i => <article key={i.id}><div><strong>{i.teamName}</strong><span>{pt ? 'Convidou você para participar' : 'Invited you to join'}</span><small>{pt ? 'Expira em' : 'Expires'} {new Date(i.expiresAt).toLocaleDateString(pt ? 'pt-BR' : 'en-GB')}</small>{i.channel === 'email' && !user?.emailVerifiedAt && <small>{pt ? 'Verifique seu email antes de aceitar.' : 'Verify your email before accepting.'}</small>}</div><button disabled={busy || (i.channel === 'email' && !user?.emailVerifiedAt)} type="button" onClick={() => void run(async () => { await api(`/invitations/${i.id}/respond`, { method: 'POST', body: JSON.stringify({ decision: 'accept', ...(params.get('invite') === i.id && params.get('token') ? { token: params.get('token') } : {}) }) }); window.dispatchEvent(new Event('norte-membership-changed')); setFeedback(pt ? 'Convite aceito. A equipe está disponível em Minhas equipes.' : 'Invitation accepted. The team is available in My teams.'); })}>{pt ? 'Aceitar convite' : 'Accept invitation'}</button><button disabled={busy} type="button" onClick={() => void run(() => api(`/invitations/${i.id}/respond`, { method: 'POST', body: JSON.stringify({ decision: 'decline' }) }))}>{pt ? 'Recusar' : 'Decline'}</button></article>)}</div>
    {!items.length && <p>{pt ? 'Nenhum convite pendente.' : 'No pending invitations.'}</p>}
  </main>;
}
