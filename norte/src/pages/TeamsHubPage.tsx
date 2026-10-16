import { useCallback, useEffect, useState } from 'react';
import { Search, ArrowRight, Check, FolderKanban, Globe2, LayoutGrid, LoaderCircle, Network, Pencil, Plus, ShieldCheck, Trash2, UsersRound, X } from 'lucide-react';
import { OrganizationTree, PersonAvatar } from '../components/OrganizationTree';
import { InfoTip } from '../components/InfoTip';
import { TeamInvitations } from '../components/TeamInvitations';
import { teamOrganization } from '../../shared/organization-tree.mjs';
import { useAuth } from '../lib/auth';
import { memberColor, memberInitials, projectTypeLabel } from '../lib/team';
import type { TeamMember, TeamProjectSummary, TeamRecord } from '../lib/team';
import type { Language } from '../lib/types';
import '../teams-hub.css';
import '../collaboration-workspace.css';
type Props = { language: Language; t: (path: string) => string; onLanguageChange: (language: Language) => void; onBack: () => void; initialTeamId?: string; onTeamsChanged?: () => void; onOpenProject: (id: string) => void };
export function TeamsHubPage({ language, initialTeamId = '', onTeamsChanged, onOpenProject }: Props) {
  const { api } = useAuth(), pt = language === 'pt';
  const [teams, setTeams] = useState<TeamRecord[]>([]), [members, setMembers] = useState<TeamMember[]>([]), [projects, setProjects] = useState<TeamProjectSummary[]>([]);
  const [selectedId, setSelectedId] = useState(initialTeamId), [view, setView] = useState<'mine' | 'community'>('mine'), [projectView, setProjectView] = useState<'list' | 'hierarchy'>('list');
  const [teamArea, setTeamArea] = useState<'projects' | 'people' | 'invitations'>('projects'), [teamQuery, setTeamQuery] = useState('');
  const [dialog, setDialog] = useState<'create-team' | 'edit-team' | null>(null), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [feedback, setFeedback] = useState('');
  const load = useCallback(async () => {
    try { const [ts, ms] = await Promise.all([api<{ teams: TeamRecord[] }>('/teams'), api<{ members: TeamMember[] }>('/team/members')]); setTeams(ts.teams); setMembers(ms.members); }
    catch (e) { setFeedback(e instanceof Error ? e.message : 'Falha ao carregar.'); } finally { setLoading(false); }
  }, [api]);
  useEffect(() => { document.body.classList.add('teams-window-scroll'); void load(); return () => document.body.classList.remove('teams-window-scroll'); }, [load]);
  const teamList = teams.filter(team => (view === 'mine' ? team.membership === 'member' || team.canManage : team.membership !== 'member' && !team.canManage) && team.name.toLocaleLowerCase().includes(teamQuery.trim().toLocaleLowerCase()));
  const selected = teamList.find(team => team.id === selectedId) || teamList[0] || null;
  const selectedTeamId = selected?.id, internal = selected?.membership === 'member' || selected?.canManage;
  const selectedMembers = members.filter(m => selected?.memberIds.includes(m.id));
  useEffect(() => {
    if (!selectedTeamId) { setProjects([]); return; }
    let active = true; setProjects([]);
    void api<{ projects: TeamProjectSummary[] }>(`/teams/${selectedTeamId}/projects`).then(r => { if (active) setProjects(r.projects); }).catch(e => { if (active) setFeedback(e.message); });
    if (!internal) void api(`/teams/${selectedTeamId}/visit`, { method: 'POST' }).catch(() => undefined);
    return () => { active = false; };
  }, [api, selectedTeamId, internal]);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget); setBusy(true); setFeedback('');
    try {
      const body = { name: String(data.get('name') || ''), description: String(data.get('description') || ''), ...(dialog === 'edit-team' && data.get('captainMemberId') ? { captainMemberId: data.get('captainMemberId') } : {}) };
      const r = await api<{ team: TeamRecord }>(dialog === 'create-team' ? '/teams' : `/teams/${selected?.id}`, { method: dialog === 'create-team' ? 'POST' : 'PATCH', body: JSON.stringify(body) });
      setSelectedId(r.team.id); setView('mine'); setDialog(null); await load(); onTeamsChanged?.();
    } catch (e) { setFeedback(e instanceof Error ? e.message : 'Falha ao salvar.'); } finally { setBusy(false); }
  }
  async function deleteTeam() {
    if (!selected || !window.confirm(pt ? 'Excluir esta equipe? Equipes com projetos ou documentos preservados não podem ser excluídas.' : 'Delete this team? Teams with projects or archived files cannot be deleted.')) return;
    setBusy(true); try { await api(`/teams/${selected.id}`, { method: 'DELETE' }); await load(); onTeamsChanged?.(); } catch (e) { setFeedback(e instanceof Error ? e.message : 'Falha ao excluir.'); } finally { setBusy(false); }
  }
  const captain = selectedMembers.find(m => m.id === selected?.captainMemberId);
  const projectTypes = Object.fromEntries(projects.map(p => [p.id, p.projectType || undefined]));
  const projectsOf = (memberId: string) => projects.filter(p => p.participants.some(x => x.memberId === memberId));
  async function removeMember(m: TeamMember) {
    if (!selected || !window.confirm(`${pt ? 'Remover' : 'Remove'} ${m.displayName}?`)) return;
    try { await api(`/teams/${selected.id}/members/${m.id}`, { method: 'DELETE' }); await load(); setProjects((await api<{ projects: TeamProjectSummary[] }>(`/teams/${selected.id}/projects`)).projects); }
    catch (e) { setFeedback(e instanceof Error ? e.message : 'Falha ao remover.'); }
  }
  return <div className="teams-hub-shell">
    <main className="teams-hub-main"><header className="teams-hub-heading"><div><span className="workspace-eyebrow">{pt ? 'COLABORAÇÃO' : 'COLLABORATION'}</span><h1>{pt ? 'Equipes' : 'Teams'}</h1><p>{pt ? 'Projetos, pessoas e responsabilidades em um só lugar.' : 'Projects, people and responsibilities in one place.'}</p></div><button type="button" onClick={() => setDialog('create-team')}><Plus />{pt ? 'Criar equipe' : 'Create team'}</button></header>
      <nav className="teams-hub-tabs"><button type="button" className={view === 'mine' ? 'active mine' : 'mine'} onClick={() => { setView('mine'); setTeamQuery(''); }}><ShieldCheck />{pt ? 'Minhas equipes' : 'My teams'}</button><button type="button" className={view === 'community' ? 'active community' : 'community'} onClick={() => { setView('community'); setTeamQuery(''); }}><Globe2 />{pt ? 'Comunidade' : 'Community'}</button></nav>
      {feedback && <p className="teams-hub-feedback" role="status">{feedback}<button type="button" onClick={() => setFeedback('')} aria-label={pt ? 'Fechar' : 'Close'}><X /></button></p>}
      <div className="teams-hub-layout"><aside className="teams-hub-list"><header>{pt ? 'Equipes' : 'Teams'}</header><label className="teams-directory-search"><Search size={15} /><input type="search" aria-label={pt ? 'Buscar equipes' : 'Find teams'} value={teamQuery} onChange={event => setTeamQuery(event.target.value)} placeholder={pt ? 'Buscar equipe' : 'Find a team'} /></label>{loading ? <LoaderCircle /> : <section>{teamList.map(team => <button type="button" key={team.id} className={team.id === selected?.id ? 'active' : ''} onClick={() => { setSelectedId(team.id); setTeamArea('projects'); }}><span className="team-mark" style={{ '--accent': memberColor(team.id) } as React.CSSProperties}>{memberInitials(team.name)}</span><span><strong>{team.name}</strong><small>{team.memberCount ?? team.memberIds.length} {pt ? 'pessoas' : 'people'} · {team.projectCount || 0} {pt ? 'projetos' : 'projects'}</small></span><ArrowRight /></button>)}</section>}</aside>
        <section className="teams-hub-detail">{!selected ? <p>{pt ? 'Nenhuma equipe por aqui ainda.' : 'No teams here yet.'}</p> : <><header className="team-overview-head"><span className="team-mark large" style={{ '--accent': memberColor(selected.id) } as React.CSSProperties}>{memberInitials(selected.name)}</span><div><h2>{selected.name}</h2><div className="team-meta"><span><UsersRound size={14} />{selected.memberCount ?? selected.memberIds.length} {pt ? 'pessoas' : 'people'}</span><span><FolderKanban size={14} />{projects.length || selected.projectCount || 0} {pt ? 'projetos' : 'projects'}</span>{captain && <span className="team-meta-captain"><PersonAvatar name={captain.displayName} id={captain.id} size={20} />{captain.displayName} · {pt ? 'capitão' : 'captain'}</span>}</div>{selected.description && <p>{selected.description}</p>}</div>{selected.canManage && <div className="teams-detail-actions"><button className="icon-only" type="button" aria-label={pt ? 'Editar equipe' : 'Edit team'} onClick={() => setDialog('edit-team')}><Pencil /></button><button className="icon-only danger" type="button" aria-label={pt ? 'Excluir equipe' : 'Delete team'} disabled={busy} onClick={() => void deleteTeam()}><Trash2 /></button></div>}</header>
          {internal ? <>
            <nav className="workspace-section-tabs" aria-label={pt ? 'Áreas da equipe' : 'Team areas'}><button type="button" aria-current={teamArea === 'projects' ? 'page' : undefined} onClick={() => setTeamArea('projects')}>{pt ? 'Projetos' : 'Projects'}</button><button type="button" aria-current={teamArea === 'people' ? 'page' : undefined} onClick={() => setTeamArea('people')}>{pt ? 'Pessoas' : 'People'}</button>{selected.canManage && <button type="button" aria-current={teamArea === 'invitations' ? 'page' : undefined} onClick={() => setTeamArea('invitations')}>{pt ? 'Convites' : 'Invitations'}</button>}</nav>
            {teamArea === 'projects' && <section className="teams-projects-section"><div className="teams-hub-section-title"><h3>{pt ? 'Projetos' : 'Projects'}</h3><div className="teams-view-toggle"><button type="button" className={projectView === 'list' ? 'active' : ''} onClick={() => setProjectView('list')}><LayoutGrid />{pt ? 'Lista' : 'List'}</button><button type="button" className={projectView === 'hierarchy' ? 'active' : ''} onClick={() => setProjectView('hierarchy')}><Network />{pt ? 'Organograma' : 'Chart'}</button></div></div>
              {projectView === 'hierarchy' ? <OrganizationTree tree={teamOrganization(selected, selectedMembers, projects)} view="hierarchy" language={language} onOpenProject={onOpenProject} projectTypes={projectTypes} collapseSectors />
                : <div className="project-card-grid">{projects.map(p => {
                  const lead = p.participants.find(x => x.roleId === 'captain');
                  const others = p.participants.filter(x => x.memberId !== lead?.memberId);
                  return <button type="button" className="project-card" data-type={p.projectType || 'custom'} key={p.id} onClick={() => onOpenProject(p.id)}>
                    <span className="project-card-type">{projectTypeLabel(p.projectType || undefined, language)}{p.hasSystem && <i className="project-card-system" title={pt ? 'Sistema de engenharia gerado' : 'Engineering system generated'} />}</span>
                    <strong>{p.name}</strong>
                    <span className="project-card-lead">{lead ? <><PersonAvatar name={lead.displayName} id={lead.memberId} size={24} /><span>{lead.displayName}</span></> : <span className="muted">{pt ? 'Sem responsável' : 'No lead'}</span>}</span>
                    <span className="project-card-foot"><span className="avatar-stack">{others.slice(0, 4).map(x => <PersonAvatar key={x.memberId} name={x.displayName} id={x.memberId} size={22} />)}{others.length > 4 && <span className="avatar-more">+{others.length - 4}</span>}</span><span className="project-card-stats">{p.sectorCount ? `${p.sectorCount} ${pt ? 'setores' : 'sectors'}` : ''}</span><ArrowRight size={16} /></span>
                  </button>;
                })}<button type="button" className="project-card new" onClick={() => { window.localStorage.setItem('norte-default-team-v1', selected.id); window.location.hash = '#/new-project'; }}><Plus size={22} /><span>{pt ? 'Novo projeto' : 'New project'}</span></button></div>}
            </section>}
            {teamArea === 'people' && <section className="teams-people-section"><div className="teams-hub-section-title"><h3>{pt ? 'Pessoas' : 'People'}<InfoTip label={pt ? 'Sobre a atividade' : 'About activity'}>{pt ? 'Responsáveis autorizados veem último acesso e resumos de participação nos projetos por 30 dias. Não são registrados cliques, documentos abertos nem horas de produtividade.' : 'Authorized leaders see last access and 30-day participation summaries. Clicks, opened documents and productivity hours are not recorded.'}</InfoTip></h3></div>
              <div className="people-grid">{selectedMembers.map(m => { const mine = projectsOf(m.id); const isCaptain = m.id === selected.captainMemberId; return <article key={m.id} className="person-card">
                <PersonAvatar name={m.displayName} id={m.id} size={44} />
                <div><strong>{m.displayName}</strong><span>{m.nickname ? `@${m.nickname}` : (pt ? 'perfil preservado' : 'preserved profile')}</span><span className="person-card-chips">{isCaptain && <em className="chip captain">{pt ? 'Capitão' : 'Captain'}</em>}{mine.length > 0 && <em className="chip">{mine.length} {pt ? (mine.length === 1 ? 'projeto' : 'projetos') : (mine.length === 1 ? 'project' : 'projects')}</em>}</span></div>
                {selected.canManage && !isCaptain && <button type="button" className="person-remove" title={pt ? 'Remover da equipe' : 'Remove from team'} aria-label={pt ? 'Remover da equipe' : 'Remove from team'} onClick={() => void removeMember(m)}><X size={14} /></button>}
              </article>; })}</div>
            </section>}
            {teamArea === 'invitations' && selected.canManage && <TeamInvitations key={selected.id} teamId={selected.id} language={language} />}
          </> : <><p>{pt ? 'A participação acontece por convite. Compartilhe seu nickname com a equipe para que ela possa encontrar seu perfil.' : 'Membership is by invitation. Share your nickname so the team can find your profile.'}</p><h3>{pt ? 'Projetos públicos' : 'Public projects'}</h3>{projects.map(p => <article className="public-project-summary" key={p.id}><Network size={18} /><strong>{p.name}</strong></article>)}{!projects.length && <p>{pt ? 'Esta equipe ainda não publicou resumos de projetos.' : 'This team has not published project summaries yet.'}</p>}<p>{pt ? 'Pessoas, documentos e estatísticas internas têm acesso restrito.' : 'People, files and internal insights have restricted access.'}</p></>}
        </>}</section>
      </div>
    </main>
    {dialog && <div className="teams-dialog-backdrop" role="presentation" onPointerDown={() => setDialog(null)}><form className="teams-dialog" role="dialog" aria-modal="true" aria-label={dialog === 'create-team' ? (pt ? 'Criar equipe' : 'Create team') : (pt ? 'Editar equipe' : 'Edit team')} onSubmit={e => void submit(e)} onPointerDown={e => e.stopPropagation()}><header><h2>{dialog === 'create-team' ? (pt ? 'Criar equipe' : 'Create team') : (pt ? 'Editar equipe' : 'Edit team')}</h2><button type="button" onClick={() => setDialog(null)} aria-label={pt ? 'Fechar' : 'Close'}><X /></button></header><label>{pt ? 'Nome da equipe' : 'Team name'}<input name="name" required minLength={2} maxLength={100} defaultValue={dialog === 'edit-team' ? selected?.name : ''} /></label><label>{pt ? 'Descrição' : 'Description'}<textarea name="description" maxLength={300} defaultValue={dialog === 'edit-team' ? selected?.description : ''} /></label>{dialog === 'edit-team' && <label>{pt ? 'Capitão da equipe' : 'Team captain'}<select name="captainMemberId" defaultValue={selected?.captainMemberId || ''}><option value="" disabled>{pt ? 'Selecione' : 'Select'}</option>{selectedMembers.map(m => <option key={m.id} value={m.id}>{m.displayName}</option>)}</select></label>}{feedback && <p role="alert">{feedback}</p>}<footer><button type="button" onClick={() => setDialog(null)}>{pt ? 'Cancelar' : 'Cancel'}</button><button className="primary" type="submit" disabled={busy}><Check />{pt ? 'Salvar' : 'Save'}</button></footer></form></div>}
  </div>;
}
