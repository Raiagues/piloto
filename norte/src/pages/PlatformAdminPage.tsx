import { useCallback, useEffect, useRef, useState } from 'react';
import { ShieldCheck, RefreshCw, MessageSquare } from 'lucide-react';
import { useAuth } from '../lib/auth';
import type { PlatformPerson } from './PeoplePage';
import type { Language } from '../lib/types';
type Security = { configured: boolean; enrolled: boolean; elevatedUntil: number };
type Analytics = {
  consentedSessions: number; events: number; averageActiveSeconds: number; countryConfigured: boolean;
  accounts: { total: number; createdLast30Days: number };
  pages: { page: string; views: number; visitors: number; averageActiveSeconds: number }[];
  clicks: { action: string; count: number }[];
  regions: { country: string | null; region: string | null; visitors: number; source: string }[];
  recent: { id: string; firstAt: string; lastAt: string; lastPage: string; activeSeconds: number }[];
  limitations: string;
};
export function PlatformAdminPage({ language }: { language: Language }) {
  const { api, user } = useAuth(), pt = language === 'pt'; const [tab, setTab] = useState<'people' | 'analytics' | 'technical'>('people'), [security, setSecurity] = useState<Security | null>(null), [secret, setSecret] = useState(''), [password, setPassword] = useState(''), [code, setCode] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false), [people, setPeople] = useState<PlatformPerson[]>([]), [totals, setTotals] = useState({ total: 0, online: 0 }), [analytics, setAnalytics] = useState<Analytics | null>(null), [technical, setTechnical] = useState<Record<string, number> | null>(null), [filter, setFilter] = useState('');
  const [peoplePage, setPeoplePage] = useState(0), [peopleMatched, setPeopleMatched] = useState(0);
  const loadSequence = useRef(0);
  const unlocked = Boolean(security?.enrolled && security.elevatedUntil > Date.now());
  const loadSecurity = useCallback(async () => setSecurity(await api<Security>('/platform/admin/security')), [api]);
  const load = useCallback(async () => {
    if (!unlocked) return;
    const sequence = ++loadSequence.current;
    const result = await api<{ users: PlatformPerson[]; total: number; online: number; matched: number }>(`/platform/admin/people?q=${encodeURIComponent(tab === 'people' ? filter : '')}&offset=${tab === 'people' ? peoplePage * 100 : 0}`);
    if (sequence !== loadSequence.current) return;
    setPeople(result.users); setTotals(result); setPeopleMatched(result.matched);
    if (tab === 'analytics') setAnalytics(await api<Analytics>('/platform/admin/analytics'));
    if (tab === 'technical') { const result = await api<{ metrics: Record<string, number> }>('/platform/admin/technical'); setTechnical(result.metrics); }
  }, [api, tab, unlocked, filter, peoplePage]);
  const failed = useCallback((reason: unknown) => { setError(reason instanceof Error ? reason.message : 'Falha'); void loadSecurity().catch(() => undefined); }, [loadSecurity]);
  useEffect(() => { void loadSecurity().catch(reason => setError(reason.message)); }, [loadSecurity]);
  useEffect(() => { void load().catch(failed); const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void load().catch(failed); }, 30000); return () => { loadSequence.current++; window.clearInterval(timer); }; }, [load, failed]);
  async function enroll() { setBusy(true); setError(''); try { const result = await api<{ secret: string }>('/platform/admin/security/enroll', { method: 'POST', body: JSON.stringify({ password }) }); setSecret(result.secret); setPassword(''); } catch (reason) { failed(reason); } finally { setBusy(false); } }
  async function verify() { setBusy(true); setError(''); try { await api('/platform/admin/security/verify', { method: 'POST', body: JSON.stringify({ code }) }); setCode(''); setSecret(''); await loadSecurity(); } catch (reason) { failed(reason); } finally { setBusy(false); } }
  const labels: Record<string, string> = pt ? {
    landing: 'Apresentação', home: 'Projetos', login: 'Entrar', register: 'Cadastro',
    requirements: 'Requisitos', verification: 'Verificação', schedule: 'Cronograma', documents: 'Documentos',
    meetings: 'Reuniões', newProject: 'Novo projeto', people: 'Contatos', messages: 'Mensagens', teams: 'Equipes',
    privacy: 'Privacidade', terms: 'Termos', admin: 'Administração',
    'requirements.analyze': 'Analisar requisitos', 'requirements.create': 'Criar requisito',
    'verification.suggest': 'Sugerir verificações', 'schedule.template': 'Abrir modelo de cronograma',
    'documents.preview': 'Visualizar documento', 'documents.generate': 'Gerar documento', 'chat.send': 'Enviar mensagem',
    'meeting.create': 'Criar reunião', 'team.create': 'Criar equipe', 'project.create': 'Criar projeto',
  } : {};
  const duration = (seconds: number) => seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}min ${seconds % 60}s`;
  if (user?.accessRole !== 'owner_admin' || user.demoAccount) return <main className="platform-page"><p>{pt ? 'Acesso restrito à administração.' : 'Administrator access only.'}</p></main>;
  return <main className="platform-page platform-admin"><header className="platform-page-head"><div><h1>{pt ? 'Administração' : 'Administration'}</h1></div>{unlocked && <button aria-label={pt ? 'Atualizar administração' : 'Refresh administration'} onClick={() => void load().catch(failed)}><RefreshCw size={17} /></button>}</header>{error && <p className="platform-error" role="alert">{error}</p>}
    {!unlocked ? <section className="platform-card admin-mfa"><ShieldCheck size={25} /><h2>{pt ? 'Confirmar acesso administrativo' : 'Confirm administrative access'}</h2><p>{pt ? 'Os controles administrativos exigem um código do autenticador. A confirmação vale por 10 minutos nesta sessão.' : 'Administrative controls require an authenticator code. Confirmation lasts 10 minutes in this session.'}</p>{security && !security.configured ? <p role="alert">{pt ? 'Configure uma chave persistente da administração no servidor para habilitar este acesso.' : 'Configure a persistent administration key on the server to enable access.'}</p> : security?.enrolled || secret ? <form onSubmit={event => { event.preventDefault(); void verify(); }}>{secret && <><p>{pt ? 'Adicione uma conta no seu aplicativo autenticador com esta chave. Guarde o acesso ao autenticador antes de confirmar.' : 'Add an account to your authenticator app using this key. Keep access to the authenticator before confirming.'}</p><code>{secret}</code></>}<label>{pt ? 'Código de seis dígitos' : 'Six-digit code'}<input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={event => setCode(event.target.value.replace(/\D/g, ''))} /></label><button className="platform-primary" disabled={busy || code.length !== 6}>{pt ? 'Confirmar código' : 'Confirm code'}</button></form> : <form onSubmit={event => { event.preventDefault(); void enroll(); }}><label>{pt ? 'Sua senha atual' : 'Your current password'}<input type="password" autoComplete="current-password" required value={password} maxLength={128} onChange={event => setPassword(event.target.value)} /></label><button className="platform-primary" disabled={busy || !password}>{pt ? 'Configurar autenticador' : 'Set up authenticator'}</button></form>}</section> : <>
    <nav className="platform-tabs" aria-label={pt ? 'Áreas administrativas' : 'Administration areas'}>{(['people', 'analytics', 'technical'] as const).map((value, index) => <button key={value} aria-pressed={tab === value} onClick={() => { setTab(value); setError(''); }}>{(pt ? ['Contas', 'Uso', 'IA e reuniões'] : ['Accounts', 'Usage', 'JEV / AI analysis'])[index]}</button>)}</nav>
    {tab === 'people' && <><div className="platform-stat-grid"><div className="platform-stat"><small>{pt ? 'Contas na plataforma' : 'Platform accounts'}</small><strong>{totals.total}</strong></div><div className="platform-stat"><small>Online</small><strong>{totals.online}</strong></div><div className="platform-stat"><small>Offline</small><strong>{totals.total - totals.online}</strong></div></div><label>{pt ? 'Buscar pessoa' : 'Find a person'}<input value={filter} onChange={event => { setPeoplePage(0); setFilter(event.target.value); }} /></label><section className="platform-card admin-scroll"><h2>{pt ? 'Usuários da plataforma' : 'Platform users'}</h2><table><thead><tr><th>{pt ? 'Pessoa' : 'Person'}</th><th>E-mail</th><th>Status</th><th>{pt ? 'Último acesso' : 'Last active'}</th><th /></tr></thead><tbody>{people.map(person => <tr key={person.id}><td><strong>{person.name}</strong><small>@{person.nickname}{person.demoAccount ? ' · demo' : ''}</small></td><td>{person.email}</td><td><span className={`platform-presence ${person.presence}`}>{person.presence}</span></td><td>{person.lastSeenAt ? new Date(person.lastSeenAt).toLocaleString() : '—'}</td><td>{!person.demoAccount && person.id !== user.id && <a className="platform-secondary" href={`#/messages?with=${person.id}`}><MessageSquare size={15} />{pt ? 'Conversar' : 'Message'}</a>}</td></tr>)}</tbody></table><div className="platform-row"><span>{peopleMatched ? `${peoplePage * 100 + 1}–${Math.min((peoplePage + 1) * 100, peopleMatched)} / ${peopleMatched}` : (pt ? 'Nenhuma pessoa encontrada' : 'No people found')}</span><div><button disabled={peoplePage === 0} onClick={() => setPeoplePage(previous => previous - 1)}>{pt ? 'Anterior' : 'Previous'}</button><button disabled={(peoplePage + 1) * 100 >= peopleMatched} onClick={() => setPeoplePage(previous => previous + 1)}>{pt ? 'Próxima' : 'Next'}</button></div></div></section></>}
    {tab === 'analytics' && analytics && <>
      <div className="platform-stat-grid">
        <div className="platform-stat"><small>{pt ? 'Contas criadas · 30 dias' : 'Accounts created · 30 days'}</small><strong>{analytics.accounts.createdLast30Days}</strong></div>
        <div className="platform-stat"><small>{pt ? 'Sessões autorizadas' : 'Consented sessions'}</small><strong>{analytics.consentedSessions}</strong></div>
        <div className="platform-stat"><small>{pt ? 'Tempo ativo médio' : 'Average active time'}</small><strong>{duration(analytics.averageActiveSeconds)}</strong></div>
      </div>
      <section className="platform-card admin-scroll"><h2>{pt ? 'Telas e tempo ativo' : 'Pages and active time'}</h2>
        <table><thead><tr><th>{pt ? 'Tela' : 'Page'}</th><th>{pt ? 'Visitas' : 'Views'}</th><th>{pt ? 'Sessões' : 'Sessions'}</th><th>{pt ? 'Tempo médio' : 'Average time'}</th></tr></thead>
          <tbody>{analytics.pages.map(row => <tr key={row.page}><td>{labels[row.page] || row.page}</td><td>{row.views}</td><td>{row.visitors}</td><td>{duration(row.averageActiveSeconds)}</td></tr>)}</tbody></table>
        {!analytics.pages.length && <p>{pt ? 'Ainda não há métricas autorizadas.' : 'No consented metrics yet.'}</p>}
      </section>
      <section className="platform-card admin-scroll"><h2>{pt ? 'Funções mais acessadas' : 'Most used features'}</h2>
        {analytics.clicks.length ? <table><thead><tr><th>{pt ? 'Função' : 'Feature'}</th><th>{pt ? 'Cliques' : 'Clicks'}</th></tr></thead><tbody>{analytics.clicks.map(row => <tr key={row.action}><td>{labels[row.action] || row.action}</td><td>{row.count}</td></tr>)}</tbody></table> : <p>{pt ? 'Ainda não há cliques registrados.' : 'No recorded clicks yet.'}</p>}
      </section>
      <section className="platform-card admin-scroll"><h2>{pt ? 'Origem aproximada' : 'Approximate location'}</h2>
        {!analytics.countryConfigured && <p>{pt ? 'O servidor ainda não tem uma origem confiável de localização configurada.' : 'A trusted location source is not configured on the server.'}</p>}
        <table><thead><tr><th>{pt ? 'País / região' : 'Country / region'}</th><th>{pt ? 'Sessões' : 'Sessions'}</th></tr></thead><tbody>{analytics.regions.map(row => <tr key={`${row.country}:${row.region}`}><td>{row.country ? [new Intl.DisplayNames([pt ? 'pt-BR' : 'en'], { type: 'region' }).of(row.country), row.region].filter(Boolean).join(' · ') : (pt ? 'Não disponível' : 'Unavailable')}</td><td>{row.visitors}</td></tr>)}</tbody></table>
      </section>
      <details className="platform-card admin-scroll"><summary>{pt ? 'Sessões recentes' : 'Recent sessions'}</summary><table><thead><tr><th>{pt ? 'Início' : 'Started'}</th><th>{pt ? 'Última tela' : 'Last page'}</th><th>{pt ? 'Tempo ativo' : 'Active time'}</th></tr></thead><tbody>{analytics.recent.map(session => <tr key={session.id}><td>{new Date(session.firstAt).toLocaleString()}</td><td>{labels[session.lastPage] || session.lastPage}</td><td>{duration(session.activeSeconds)}</td></tr>)}</tbody></table></details>
      <p className="platform-muted">{analytics.limitations}</p>
    </>}
    {tab === 'technical' && <section className="platform-card"><h2>{pt ? 'IA e reuniões' : 'AI and meetings'}</h2><a className="platform-secondary" href="#/admin/meetings">{pt ? 'Diagnóstico de reuniões' : 'Meeting diagnostics'}</a><p>{pt ? 'Contadores operacionais agregados. As fontes e os registros privados continuam exigindo acesso ao projeto.' : 'Aggregated operational counters. Private sources and records still require project access.'}</p><div className="platform-stat-grid">{Object.entries(technical || {}).filter(([, value]) => typeof value === 'number').map(([name, value]) => <div className="platform-stat" key={name}><small>{({ jevCalls: 'Tentativas JEV', llmCalls: 'Tentativas LLM', cacheHits: 'Reusos', providerFailures: 'Falhas do provedor', reportedInputTokens: 'Tokens de entrada', reportedOutputTokens: 'Tokens de saída', feedback: 'Avaliações' } as Record<string, string>)[name] || name}</small><strong>{value}</strong></div>)}</div><p className="platform-muted">{pt ? 'Tentativas incluem repetições e falhas. Tokens são somente os informados pelo provedor; estes dados não comprovam melhora de qualidade ou queda de custo.' : 'Attempts include retries and failures. Tokens are provider-reported only; these metrics do not establish quality gains or lower costs.'}</p></section>}
    </>}
  </main>;
}
