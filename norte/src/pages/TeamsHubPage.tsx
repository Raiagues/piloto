import { useCallback, useEffect, useRef, useState } from 'react';
import { Search, ArrowRight, Check, FolderKanban, LayoutGrid, LoaderCircle, Network, RefreshCw, Pencil, Plus, Trash2, UsersRound, X } from 'lucide-react';
import { OrganizationTree, PersonAvatar } from '../components/OrganizationTree';
import { TeamInvitations } from '../components/TeamInvitations';
import { teamOrganization } from '../../shared/organization-tree.mjs';
import { useAuth } from '../lib/auth';
import { canRetainReadCache, teamProjectCacheKey } from '../lib/projectLoading';
import { memberColor, memberInitials, projectTypeLabel } from '../lib/team';
import type { TeamMember, TeamProjectSummary, TeamRecord } from '../lib/team';
import type { Language } from '../lib/types';
import '../styles/features/teams.css';
type Props = { language: Language; initialTeamId?: string; onTeamsChanged?: () => void; onOpenProject: (id: string) => void };
export function TeamsHubPage({ language, initialTeamId = '', onTeamsChanged, onOpenProject }: Props) {
  const { api } = useAuth(), pt = language === 'pt';
  const [professionalEditor, setProfessionalEditor] = useState<TeamMember | null>(null);
  const [teams, setTeams] = useState<TeamRecord[]>([]), [members, setMembers] = useState<TeamMember[]>([]);
  const [projectCache, setProjectCache] = useState<Record<string, TeamProjectSummary[]>>({});
  const [projectLoad, setProjectLoad] = useState<{ teamId: string; status: 'loading' | 'ready' | 'error' | 'denied' }>({ teamId: '', status: 'loading' });
  const [projectRetry, setProjectRetry] = useState(0), [directoryError, setDirectoryError] = useState(false), [membersError, setMembersError] = useState(false), [membersLoading, setMembersLoading] = useState(true);
  const directoryController = useRef<AbortController | null>(null);
  const [selectedId, setSelectedId] = useState(initialTeamId), [projectView, setProjectView] = useState<'list' | 'hierarchy'>('list');
  useEffect(() => { const navigate = () => { const id = new URLSearchParams(window.location.hash.split('?')[1] || '').get('team'); if (id) setSelectedId(id); }; navigate(); window.addEventListener('hashchange', navigate); return () => window.removeEventListener('hashchange', navigate); }, []);
  const [teamArea, setTeamArea] = useState<'projects' | 'people' | 'invitations'>('projects'), [teamQuery, setTeamQuery] = useState('');
  const [dialog, setDialog] = useState<'create-team' | 'edit-team' | null>(null), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [feedback, setFeedback] = useState('');
  const load = useCallback(async () => {
    directoryController.current?.abort(); const controller = new AbortController(); directoryController.current = controller;
    setLoading(true); setMembersLoading(true); setDirectoryError(false); setMembersError(false);
    // A slow people directory must not delay teams or their project cards.
    void api<{ members: TeamMember[] }>('/team/members', { signal: controller.signal }).then(result => {
      if (!controller.signal.aborted) setMembers(result.members.filter(member => Boolean(member.accountId) && member.accountStatus === 'active'));
    }).catch(reason => {
      if (!controller.signal.aborted) { setMembersError(true); if (!canRetainReadCache(reason)) setMembers([]); }
    }).finally(() => { if (!controller.signal.aborted) setMembersLoading(false); });
    try {
      const result = await api<{ teams: TeamRecord[] }>('/teams', { signal: controller.signal });
      if (!controller.signal.aborted) setTeams(result.teams);
    } catch (reason) {
      if (!controller.signal.aborted) { setDirectoryError(true); if (!canRetainReadCache(reason)) { setTeams([]); setProjectCache({}); } }
    } finally { if (!controller.signal.aborted) setLoading(false); }
  }, [api]);
  useEffect(() => { document.body.classList.add('teams-window-scroll'); void load(); return () => { directoryController.current?.abort(); document.body.classList.remove('teams-window-scroll'); }; }, [load]);
  useEffect(() => { const refresh = () => { void load(); setProjectRetry(value => value + 1); }; window.addEventListener('norte-membership-changed', refresh); return () => window.removeEventListener('norte-membership-changed', refresh); }, [load]);
  const teamList = teams.filter(team => (team.membership === 'member' || team.canManage) && team.name.toLocaleLowerCase().includes(teamQuery.trim().toLocaleLowerCase()));
  const selected = teamList.find(team => team.id === selectedId) || teamList[0] || null;
  const selectedTeamId = selected?.id, internal = selected?.membership === 'member' || selected?.canManage;
  const projects = selectedTeamId ? projectCache[teamProjectCacheKey(selectedTeamId, Boolean(internal))] || [] : [];
  const projectsLoading = Boolean(selectedTeamId && (projectLoad.teamId !== selectedTeamId || projectLoad.status === 'loading'));
  const projectsFailed = Boolean(selectedTeamId && projectLoad.teamId === selectedTeamId && ['error', 'denied'].includes(projectLoad.status));
  const selectedMembers = members.filter(m => selected?.memberIds.includes(m.id));
  useEffect(() => {
    if (!selectedTeamId) return;
    const controller = new AbortController(), cacheKey = teamProjectCacheKey(selectedTeamId, Boolean(internal)); setProjectLoad({ teamId: selectedTeamId, status: 'loading' });
    void api<{ projects: TeamProjectSummary[] }>(`/teams/${selectedTeamId}/projects`, { signal: controller.signal }).then(r => {
      if (controller.signal.aborted) return;
      setProjectCache(cache => ({ ...cache, [cacheKey]: r.projects })); setProjectLoad({ teamId: selectedTeamId, status: 'ready' });
    }).catch(reason => { if (!controller.signal.aborted) { setProjectLoad({ teamId: selectedTeamId, status: canRetainReadCache(reason) ? 'error' : 'denied' }); if (!canRetainReadCache(reason)) setProjectCache(cache => { const next = { ...cache }; delete next[cacheKey]; return next; }); } });
    if (!internal) void api(`/teams/${selectedTeamId}/visit`, { method: 'POST' }).catch(() => undefined);
    return () => controller.abort();
  }, [api, selectedTeamId, internal, projectRetry]);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget); setBusy(true); setFeedback('');
    try {
      const body = { name: String(data.get('name') || ''), description: String(data.get('description') || ''), ...(dialog === 'edit-team' && data.get('captainMemberId') ? { captainMemberId: data.get('captainMemberId') } : {}) };
      const r = await api<{ team: TeamRecord }>(dialog === 'create-team' ? '/teams' : `/teams/${selected?.id}`, { method: dialog === 'create-team' ? 'POST' : 'PATCH', body: JSON.stringify(body) });
      setSelectedId(r.team.id); setDialog(null); await load(); onTeamsChanged?.();
    } catch (e) { setFeedback(e instanceof Error ? e.message : 'Falha ao salvar.'); } finally { setBusy(false); }
  }
  async function deleteTeam() {
    if (!selected || !window.confirm(pt ? 'Excluir esta equipe? Equipes com projetos ou documentos preservados não podem ser excluídas.' : 'Delete this team? Teams with projects or archived files cannot be deleted.')) return;
    setBusy(true); try { await api(`/teams/${selected.id}`, { method: 'DELETE' }); await load(); onTeamsChanged?.(); } catch (e) { setFeedback(e instanceof Error ? e.message : 'Falha ao excluir.'); } finally { setBusy(false); }
  }
  const captain = selectedMembers.find(m => m.id === selected?.captainMemberId);
  const projectTypes = Object.fromEntries(projects.map(p => [p.id, p.projectType || undefined]));
  const projectsOf = (memberId: string) => projects.filter(p => p.participants.some(x => x.memberId === memberId));
  async function saveProfessionalProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selected || !professionalEditor) return;
    const data = new FormData(event.currentTarget); setBusy(true); setFeedback('');
    try {
      await api(`/teams/${selected.id}/members/${professionalEditor.id}/professional-profile`, { method: 'PATCH', body: JSON.stringify({ roleName: String(data.get('roleName') || ''), functionName: String(data.get('functionName') || ''), expectedVersion: selected.professionalProfiles?.[professionalEditor.id]?.version || 0 }) });
      setProfessionalEditor(null); await load(); window.dispatchEvent(new Event('norte-membership-changed'));
    } catch (e) { setFeedback(e instanceof Error ? e.message : 'Falha ao salvar.'); } finally { setBusy(false); }
  }
  async function removeMember(m: TeamMember) {
    if (!selected || !window.confirm(`${pt ? 'Remover' : 'Remove'} ${m.displayName}?`)) return;
    try { await api(`/teams/${selected.id}/members/${m.id}`, { method: 'DELETE' }); await load(); setProjectRetry(value => value + 1); }
    catch (e) { setFeedback(e instanceof Error ? e.message : 'Falha ao remover.'); }
  }
  return <div className="teams-hub-shell">
    <main className="teams-hub-main" aria-label={pt ? 'Equipes' : 'Teams'}><header className="teams-hub-heading teams-hub-toolbar"><button type="button" onClick={() => setDialog('create-team')}><Plus />{pt ? 'Criar equipe' : 'Create team'}</button></header>
      {feedback && <p className="teams-hub-feedback" role="status">{feedback}<button type="button" onClick={() => setFeedback('')} aria-label={pt ? 'Fechar' : 'Close'}><X /></button></p>}
      {(directoryError || membersError) && <div className="team-project-load" role="alert"><p>{directoryError ? pt ? 'Não foi possível atualizar as equipes agora.' : 'Teams could not be refreshed right now.' : pt ? 'A lista de pessoas não carregou. Os projetos continuam disponíveis.' : 'People could not be loaded. Projects remain available.'}</p><button type="button" disabled={loading} onClick={() => void load()}>{pt ? 'Recarregar equipes e pessoas' : 'Reload teams and people'}</button></div>}
      <div className="teams-hub-layout">
        {teams.length > 1 && <nav className="teams-hub-list" aria-label={pt ? 'Selecionar equipe' : 'Select team'}>
          {teams.length > 4 && <label className="teams-directory-search"><Search size={15} /><input type="search" aria-label={pt ? 'Buscar equipes' : 'Find teams'} value={teamQuery} onChange={event => setTeamQuery(event.target.value)} placeholder={pt ? 'Buscar equipe' : 'Find a team'} /></label>}
          <section>{teamList.map(team => <button type="button" key={team.id} aria-current={team.id === selected?.id ? 'page' : undefined} className={team.id === selected?.id ? 'active' : ''} onClick={() => { setSelectedId(team.id); setTeamArea('projects'); }}><UsersRound size={16}/><strong>{team.name}</strong></button>)}</section>
        </nav>}
        <section className="teams-hub-detail">{!selected ? <p>{loading ? pt ? 'Carregando equipes…' : 'Loading teams…' : directoryError ? pt ? 'A lista de equipes está indisponível. Tente carregar novamente.' : 'The team list is unavailable. Try loading again.' : pt ? 'Nenhuma equipe por aqui ainda.' : 'No teams here yet.'}</p> : <><header className="team-overview-head"><span className="team-mark large" style={{ '--accent': memberColor(selected.id) } as React.CSSProperties}>{memberInitials(selected.name)}</span><div><h2>{selected.name}</h2><div className="team-meta"><span><UsersRound size={14} />{selectedMembers.length} {pt ? (selectedMembers.length === 1 ? 'integrante' : 'integrantes') : (selectedMembers.length === 1 ? 'member' : 'members')}</span><span><FolderKanban size={14} />{projects.length || selected.projectCount || 0} {pt ? ((projects.length || selected.projectCount) === 1 ? 'projeto' : 'projetos') : ((projects.length || selected.projectCount) === 1 ? 'project' : 'projects')}</span>{captain && <span className="team-meta-captain"><PersonAvatar name={captain.displayName} id={captain.id} size={20} />{captain.displayName} · {pt ? 'gestor' : 'manager'}</span>}</div>{selected.description && <p>{selected.description}</p>}</div>{selected.canManage && <div className="teams-detail-actions"><button className="icon-only" type="button" aria-label={pt ? 'Editar equipe' : 'Edit team'} onClick={() => setDialog('edit-team')}><Pencil /></button><button className="icon-only danger" type="button" aria-label={pt ? 'Excluir equipe' : 'Delete team'} disabled={busy} onClick={() => void deleteTeam()}><Trash2 /></button></div>}</header>
          {internal ? <>
            <nav className="workspace-section-tabs" aria-label={pt ? 'Áreas da equipe' : 'Team areas'}><button type="button" aria-current={teamArea === 'projects' ? 'page' : undefined} onClick={() => setTeamArea('projects')}>{pt ? 'Projetos' : 'Projects'}</button><button type="button" aria-current={teamArea === 'people' ? 'page' : undefined} onClick={() => setTeamArea('people')}>{pt ? 'Integrantes' : 'Members'}</button>{selected.canManage && <button type="button" aria-current={teamArea === 'invitations' ? 'page' : undefined} onClick={() => setTeamArea('invitations')}>{pt ? 'Convites' : 'Invitations'}</button>}</nav>
            {teamArea === 'projects' && <section className="teams-projects-section"><div className="teams-hub-section-title"><div className="teams-view-toggle"><button type="button" className={projectView === 'list' ? 'active' : ''} onClick={() => setProjectView('list')}><LayoutGrid />{pt ? 'Blocos' : 'Cards'}</button><button type="button" className={projectView === 'hierarchy' ? 'active' : ''} onClick={() => setProjectView('hierarchy')}><Network />{pt ? 'Organograma' : 'Chart'}</button></div><div className="teams-project-actions"><button className="icon-only" type="button" onClick={() => setProjectRetry(value => value + 1)} disabled={projectsLoading} aria-label={pt ? 'Atualizar projetos' : 'Refresh projects'} title={pt ? 'Atualizar projetos' : 'Refresh projects'}><RefreshCw size={16}/></button><button type="button" onClick={() => { window.localStorage.setItem('norte-default-team-v1', selected.id); window.location.hash = '#/new-project'; }}><Plus size={16}/>{pt ? 'Novo projeto' : 'New project'}</button></div></div>
              {projectsLoading && <div className="team-project-load" role="status"><LoaderCircle size={16}/>{pt ? 'Carregando projetos da equipe…' : 'Loading team projects…'}</div>}
              {projectsFailed && <div className="team-project-load" role="alert"><p>{projectLoad.status === 'denied' ? pt ? 'Os projetos não estão disponíveis para seu acesso atual. Confira sua participação na equipe.' : 'Projects are unavailable with your current access. Check your team membership.' : pt ? 'Não foi possível carregar os projetos desta equipe. Tente novamente; eles não foram removidos por esta falha de conexão.' : 'Team projects could not be loaded. Retry; this connection failure did not remove them.'}</p><button type="button" onClick={() => setProjectRetry(value => value + 1)}>{pt ? 'Recarregar projetos' : 'Reload projects'}</button></div>}
              {!projectsLoading && !projectsFailed && !projects.length && <p>{pt ? 'Esta equipe ainda não tem projetos.' : 'This team has no projects yet.'}</p>}
              {projectView === 'hierarchy' ? <OrganizationTree tree={teamOrganization(selected, selectedMembers, projects)} view="hierarchy" language={language} onOpenProject={onOpenProject} projectTypes={projectTypes} collapseSectors />
                : <div className="project-card-grid">{projects.map(p => {
                  const lead = p.participants.find(x => x.roleId === 'captain');
                  const others = p.participants.filter(x => x.memberId !== lead?.memberId);
                  return <button type="button" className="project-card" data-type={p.projectType || 'custom'} key={p.id} onClick={() => onOpenProject(p.id)}>
                    <span className="project-card-type">{projectTypeLabel(p.projectType || undefined, language)}{p.hasSystem && <i className="project-card-system" title={pt ? 'Projeto com requisitos' : 'Project with requirements'} />}</span>
                    <strong>{p.name}</strong>
                    <span className="project-card-lead">{lead ? <><PersonAvatar name={lead.displayName} id={lead.memberId} size={24} /><span>{lead.displayName}</span></> : <span className="muted">{pt ? 'Sem responsável' : 'No lead'}</span>}</span>
                    <span className="project-card-foot"><span className="avatar-stack">{others.slice(0, 4).map(x => <PersonAvatar key={x.memberId} name={x.displayName} id={x.memberId} size={22} />)}{others.length > 4 && <span className="avatar-more">+{others.length - 4}</span>}</span><span className="project-card-stats">{p.sectorCount ? `${p.sectorCount} ${pt ? 'setores' : 'sectors'}` : ''}</span><ArrowRight size={16} /></span>
                  </button>;
                })}</div>}
            </section>}
            {teamArea === 'people' && <section className="teams-people-section">
              {membersLoading && <p role="status">{pt ? 'Carregando pessoas…' : 'Loading people…'}</p>}
              <div className="people-grid">{selectedMembers.map(m => { const mine = projectsOf(m.id); const isCaptain = m.id === selected.captainMemberId; const professional = selected.professionalProfiles?.[m.id]; return <article key={m.id} className="person-card">
                <PersonAvatar name={m.displayName} id={m.id} size={44} />
                <div><strong>{m.displayName}</strong>{m.nickname && <span>@{m.nickname}</span>}<span className="person-professional-role">{professional?.roleName || (isCaptain ? (pt ? 'Gestor da equipe' : 'Team manager') : (pt ? 'Integrante' : 'Member'))}</span>{professional?.functionName && <p className="person-professional-function">{professional.functionName}</p>}<span className="person-card-chips">{isCaptain && <em className="chip captain">{pt ? 'Gestor' : 'Manager'}</em>}{mine.length > 0 && <em className="chip">{mine.length} {pt ? (mine.length === 1 ? 'projeto' : 'projetos') : (mine.length === 1 ? 'project' : 'projects')}</em>}</span></div>
                {selected.canManage && <button type="button" className="person-edit-role" onClick={() => { setFeedback(''); setProfessionalEditor(m); }}><Pencil size={13}/>{pt ? 'Cargo e função' : 'Role and responsibilities'}</button>}
                {selected.canManage && !isCaptain && <button type="button" className="person-remove" title={pt ? 'Remover da equipe' : 'Remove from team'} aria-label={pt ? 'Remover da equipe' : 'Remove from team'} onClick={() => void removeMember(m)}><X size={14} /></button>}
              </article>; })}</div>
            </section>}
            {teamArea === 'invitations' && selected.canManage && <TeamInvitations key={selected.id} teamId={selected.id} language={language} />}
          </> : <><p>{pt ? 'A participação acontece por convite. Compartilhe seu nickname com a equipe para que ela possa encontrar seu perfil.' : 'Membership is by invitation. Share your nickname so the team can find your profile.'}</p><h3>{pt ? 'Projetos públicos' : 'Public projects'}</h3>{projectsLoading && <p role="status">{pt ? 'Carregando resumos públicos…' : 'Loading public summaries…'}</p>}{projectsFailed && <div className="team-project-load" role="alert"><p>{pt ? 'Os resumos públicos não estão disponíveis agora.' : 'Public summaries are unavailable right now.'}</p><button type="button" onClick={() => setProjectRetry(value => value + 1)}>{pt ? 'Recarregar projetos' : 'Reload projects'}</button></div>}{projects.map(p => <article className="public-project-summary" key={p.id}><Network size={18} /><strong>{p.name}</strong></article>)}{!projectsLoading && !projectsFailed && !projects.length && <p>{pt ? 'Esta equipe ainda não publicou resumos de projetos.' : 'This team has not published project summaries yet.'}</p>}<p>{pt ? 'Pessoas, documentos e estatísticas internas têm acesso restrito.' : 'People, files and internal insights have restricted access.'}</p></>}
        </>}</section>
      </div>
    </main>
    {professionalEditor && selected && <div className="teams-dialog-backdrop" role="presentation" onPointerDown={() => setProfessionalEditor(null)}><form className="teams-dialog" role="dialog" aria-modal="true" aria-label={pt ? 'Cargo e função' : 'Role and responsibilities'} onSubmit={event => void saveProfessionalProfile(event)} onPointerDown={event => event.stopPropagation()}><header><h2>{professionalEditor.displayName}</h2><button type="button" onClick={() => setProfessionalEditor(null)} aria-label={pt ? 'Fechar' : 'Close'}><X/></button></header><label>{pt ? 'Cargo na equipe' : 'Team role'}<input name="roleName" required maxLength={100} defaultValue={selected.professionalProfiles?.[professionalEditor.id]?.roleName || ''}/></label><label>{pt ? 'Função e responsabilidades' : 'Responsibilities'}<textarea name="functionName" maxLength={500} rows={4} defaultValue={selected.professionalProfiles?.[professionalEditor.id]?.functionName || ''}/></label><small>{pt ? 'Informações do perfil. As permissões de acesso permanecem separadas.' : 'Profile information. Access permissions are managed separately.'}</small>{feedback && <p role="alert">{feedback}</p>}<footer><button type="button" onClick={() => setProfessionalEditor(null)}>{pt ? 'Cancelar' : 'Cancel'}</button><button className="primary" type="submit" disabled={busy}>{pt ? 'Salvar' : 'Save'}</button></footer></form></div>}
    {dialog && <div className="teams-dialog-backdrop" role="presentation" onPointerDown={() => setDialog(null)}><form className="teams-dialog" role="dialog" aria-modal="true" aria-label={dialog === 'create-team' ? (pt ? 'Criar equipe' : 'Create team') : (pt ? 'Editar equipe' : 'Edit team')} onSubmit={e => void submit(e)} onPointerDown={e => e.stopPropagation()}><header><h2>{dialog === 'create-team' ? (pt ? 'Criar equipe' : 'Create team') : (pt ? 'Editar equipe' : 'Edit team')}</h2><button type="button" onClick={() => setDialog(null)} aria-label={pt ? 'Fechar' : 'Close'}><X /></button></header><label>{pt ? 'Nome da equipe' : 'Team name'}<input name="name" required minLength={2} maxLength={100} defaultValue={dialog === 'edit-team' ? selected?.name : ''} /></label><label>{pt ? 'Descrição' : 'Description'}<textarea name="description" maxLength={300} defaultValue={dialog === 'edit-team' ? selected?.description : ''} /></label>{dialog === 'edit-team' && <label>{pt ? 'Gestor da equipe' : 'Team manager'}<select name="captainMemberId" defaultValue={selected?.captainMemberId || ''}><option value="" disabled>{pt ? 'Selecione' : 'Select'}</option>{selectedMembers.map(m => <option key={m.id} value={m.id}>{m.displayName}</option>)}</select></label>}{feedback && <p role="alert">{feedback}</p>}<footer><button type="button" onClick={() => setDialog(null)}>{pt ? 'Cancelar' : 'Cancel'}</button><button data-usage-action={dialog === 'create-team' ? 'team.create' : undefined} className="primary" type="submit" disabled={busy}><Check />{pt ? 'Salvar' : 'Save'}</button></footer></form></div>}
  </div>;
}
