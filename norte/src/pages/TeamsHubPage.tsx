import { useCallback, useEffect, useRef, useState } from 'react';
import { Search, ArrowRight, Check, FolderKanban, Layers, LayoutList, LoaderCircle, Network, RefreshCw, Pencil, Plus, Trash2, UsersRound, X, Grid3x3, UserRound, Mail } from 'lucide-react';
import { OrganizationTree, PersonAvatar } from '../components/OrganizationTree';
import { TeamInvitations } from '../components/TeamInvitations';
import { teamOrganization } from '../../shared/organization-tree.mjs';
import type { OrganizationNode } from '../../shared/organization-tree.mjs';
import { useAuth } from '../lib/auth';
import { canRetainReadCache, teamProjectCacheKey } from '../lib/projectLoading';
import { memberColor, memberInitials, projectTypeLabel } from '../lib/team';
import type { TeamMember, TeamProjectSummary, TeamRecord } from '../lib/team';
import type { Language } from '../lib/types';
import '../styles/features/teams.css';
import '../styles/features/team-workspace.css';
type Props = { language: Language; initialTeamId?: string; onTeamsChanged?: () => void; onOpenProject: (id: string) => void };
type Area = 'projects' | 'people' | 'allocation' | 'invitations';
// Sectors (subsystems or disciplines) are nodes of each project's organization tree.
const sectorsOf = (project: TeamProjectSummary) => { const names: string[] = []; const visit = (node?: OrganizationNode) => { if (!node) return; if (node.kind === 'sector' && !String(node.id).endsWith(':unassigned')) names.push(node.name); for (const child of node.children || []) visit(child); }; visit(project.organization); return [...new Set(names)]; };

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
  const [teamArea, setTeamArea] = useState<Area>('projects'), [teamQuery, setTeamQuery] = useState(''), [peopleQuery, setPeopleQuery] = useState('');
  const [dialog, setDialog] = useState<'create-team' | 'edit-team' | null>(null), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [feedback, setFeedback] = useState('');
  const load = useCallback(async () => {
    directoryController.current?.abort(); const controller = new AbortController(); directoryController.current = controller;
    setLoading(true); setMembersLoading(true); setDirectoryError(false); setMembersError(false);
    // A slow people directory must not delay teams or their projects.
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
  useEffect(() => { void load(); return () => { directoryController.current?.abort(); }; }, [load]);
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
  const sectorTotal = new Set(projects.flatMap(project => sectorsOf(project).map(name => `${project.id}:${name}`))).size;
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
  const date = (value: string) => { const at = Date.parse(value); return Number.isFinite(at) ? new Intl.DateTimeFormat(pt ? 'pt-BR' : 'en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(at) : '—'; };
  const roleOf = (member: TeamMember) => selected?.professionalProfiles?.[member.id]?.roleName || (member.id === selected?.captainMemberId ? (pt ? 'Gestor da equipe' : 'Team manager') : (pt ? 'Integrante' : 'Member'));
  const visiblePeople = selectedMembers.filter(member => `${member.displayName} ${member.nickname || ''} ${roleOf(member)} ${selected?.professionalProfiles?.[member.id]?.functionName || ''}`.toLocaleLowerCase().includes(peopleQuery.trim().toLocaleLowerCase()));
  const areas: [Area, string, typeof FolderKanban, number | null][] = [['projects', pt ? 'Projetos' : 'Projects', FolderKanban, projects.length], ['people', pt ? 'Pessoas' : 'People', UsersRound, selectedMembers.length], ['allocation', pt ? 'Alocação' : 'Allocation', Grid3x3, null], ...(selected?.canManage ? [['invitations', pt ? 'Convites' : 'Invitations', Mail, null] as [Area, string, typeof FolderKanban, null]] : [])];

  return <div className="teams-hub-shell team-workspace">
    <main className="team-workspace-main" aria-label={pt ? 'Equipes' : 'Teams'}>
      {feedback && <p className="teams-hub-feedback" role="status">{feedback}<button type="button" onClick={() => setFeedback('')} aria-label={pt ? 'Fechar' : 'Close'}><X /></button></p>}
      {(directoryError || membersError) && <div className="team-project-load" role="alert"><p>{directoryError ? pt ? 'Não foi possível atualizar as equipes agora.' : 'Teams could not be refreshed right now.' : pt ? 'A lista de pessoas não carregou. Os projetos continuam disponíveis.' : 'People could not be loaded. Projects remain available.'}</p><button type="button" disabled={loading} onClick={() => void load()}>{pt ? 'Recarregar equipes e pessoas' : 'Reload teams and people'}</button></div>}
      <div className={`team-workspace-layout${teamList.length > 1 || teamQuery ? ' with-list' : ''}`}>
        {(teamList.length > 1 || teamQuery) && <nav className="team-directory" aria-label={pt ? 'Selecionar equipe' : 'Select team'}>
          <header><span>{pt ? 'Equipes' : 'Teams'}</span><button type="button" className="team-ghost-icon" onClick={() => setDialog('create-team')} aria-label={pt ? 'Criar equipe' : 'Create team'} title={pt ? 'Criar equipe' : 'Create team'}><Plus size={16} /></button></header>
          {teams.length > 5 && <label className="team-search"><Search size={14} /><input type="search" aria-label={pt ? 'Buscar equipes' : 'Find teams'} value={teamQuery} onChange={event => setTeamQuery(event.target.value)} placeholder={pt ? 'Buscar equipe' : 'Find a team'} /></label>}
          {teamList.map(team => <button type="button" key={team.id} aria-current={team.id === selected?.id ? 'page' : undefined} onClick={() => { setSelectedId(team.id); setTeamArea('projects'); }}><span className="team-mark small" style={{ '--accent': memberColor(team.id) } as React.CSSProperties}>{memberInitials(team.name)}</span><span><strong>{team.name}</strong><small>{team.projectCount ?? 0} {pt ? 'projetos' : 'projects'} · {team.memberIds.length} {pt ? 'pessoas' : 'people'}</small></span></button>)}
        </nav>}
        <section className="team-detail">{!selected ? <div className="team-empty"><UsersRound size={28} aria-hidden="true" /><strong>{loading ? pt ? 'Carregando equipes…' : 'Loading teams…' : directoryError ? pt ? 'A lista de equipes está indisponível.' : 'The team list is unavailable.' : pt ? 'Nenhuma equipe por aqui ainda.' : 'No teams here yet.'}</strong>{!loading && !directoryError && <><span>{pt ? 'Uma equipe reúne a empresa ou o grupo: seus projetos, setores e pessoas.' : 'A team gathers the company or group: its projects, sectors and people.'}</span><button type="button" className="team-primary" onClick={() => setDialog('create-team')}><Plus size={15} />{pt ? 'Criar equipe' : 'Create team'}</button></>}</div> : <>
          <header className="team-head">
            <span className="team-mark large" style={{ '--accent': memberColor(selected.id) } as React.CSSProperties}>{memberInitials(selected.name)}</span>
            <div className="team-head-copy"><h1>{selected.name}</h1>{selected.description && <p>{selected.description}</p>}
              <dl className="team-facts"><div><dt>{pt ? 'Projetos' : 'Projects'}</dt><dd>{projects.length || selected.projectCount || 0}</dd></div><div><dt>{pt ? 'Setores' : 'Sectors'}</dt><dd>{sectorTotal}</dd></div><div><dt>{pt ? 'Pessoas' : 'People'}</dt><dd>{selectedMembers.length || selected.memberIds.length}</dd></div>{captain && <div><dt>{pt ? 'Gestão' : 'Lead'}</dt><dd className="team-fact-person"><PersonAvatar name={captain.displayName} id={captain.id} size={20} />{captain.displayName}</dd></div>}</dl>
            </div>
            <div className="team-head-actions">
              {internal && <button type="button" className="team-primary" onClick={() => { window.localStorage.setItem('norte-default-team-v1', selected.id); window.location.hash = '#/new-project'; }}><Plus size={15} />{pt ? 'Novo projeto' : 'New project'}</button>}
              {teamList.length <= 1 && !teamQuery && <button type="button" className="team-secondary" onClick={() => setDialog('create-team')}><Plus size={15} />{pt ? 'Criar equipe' : 'Create team'}</button>}
              {selected.canManage && <><button className="team-ghost-icon" type="button" aria-label={pt ? 'Editar equipe' : 'Edit team'} title={pt ? 'Editar equipe' : 'Edit team'} onClick={() => setDialog('edit-team')}><Pencil size={16} /></button><button className="team-ghost-icon danger" type="button" aria-label={pt ? 'Excluir equipe' : 'Delete team'} title={pt ? 'Excluir equipe' : 'Delete team'} disabled={busy} onClick={() => void deleteTeam()}><Trash2 size={16} /></button></>}
            </div>
          </header>
          {internal ? <>
            <nav className="team-tabs" aria-label={pt ? 'Áreas da equipe' : 'Team areas'}>{areas.map(([id, label, Icon, total]) => <button type="button" key={id} aria-current={teamArea === id ? 'page' : undefined} onClick={() => setTeamArea(id)}><Icon size={15} aria-hidden="true" />{label}{total !== null && <small>{total}</small>}</button>)}</nav>
            {teamArea === 'projects' && <section className="team-panel" aria-label={pt ? 'Projetos da equipe' : 'Team projects'}>
              <div className="team-panel-tools"><div className="team-segmented" role="group" aria-label={pt ? 'Visualização' : 'View'}><button type="button" aria-pressed={projectView === 'list'} onClick={() => setProjectView('list')}><LayoutList size={15} />{pt ? 'Carteira' : 'Portfolio'}</button><button type="button" aria-pressed={projectView === 'hierarchy'} onClick={() => setProjectView('hierarchy')}><Network size={15} />{pt ? 'Organograma' : 'Org chart'}</button></div><button className="team-ghost-icon" type="button" onClick={() => setProjectRetry(value => value + 1)} disabled={projectsLoading} aria-label={pt ? 'Atualizar projetos' : 'Refresh projects'} title={pt ? 'Atualizar projetos' : 'Refresh projects'}><RefreshCw size={15} /></button></div>
              {projectsLoading && <div className="team-project-load" role="status"><LoaderCircle size={16} />{pt ? 'Carregando projetos da equipe…' : 'Loading team projects…'}</div>}
              {projectsFailed && <div className="team-project-load" role="alert"><p>{projectLoad.status === 'denied' ? pt ? 'Os projetos não estão disponíveis para seu acesso atual. Confira sua participação na equipe.' : 'Projects are unavailable with your current access. Check your team membership.' : pt ? 'Não foi possível carregar os projetos desta equipe. Tente novamente; eles não foram removidos por esta falha de conexão.' : 'Team projects could not be loaded. Retry; this connection failure did not remove them.'}</p><button type="button" onClick={() => setProjectRetry(value => value + 1)}>{pt ? 'Recarregar projetos' : 'Reload projects'}</button></div>}
              {!projectsLoading && !projectsFailed && !projects.length && <div className="team-empty compact"><FolderKanban size={24} aria-hidden="true" /><strong>{pt ? 'Esta equipe ainda não tem projetos.' : 'This team has no projects yet.'}</strong><span>{pt ? 'Cada projeto define seus setores (subsistemas ou disciplinas) e quem responde por eles.' : 'Each project defines its sectors (subsystems or disciplines) and who answers for them.'}</span></div>}
              {projectView === 'hierarchy' ? <OrganizationTree tree={teamOrganization(selected, selectedMembers, projects)} view="hierarchy" language={language} onOpenProject={onOpenProject} projectTypes={projectTypes} collapseSectors />
                : projects.length > 0 && <div className="team-table-wrap"><table className="team-table">
                  <thead><tr><th scope="col">{pt ? 'Projeto' : 'Project'}</th><th scope="col">{pt ? 'Responsável' : 'Lead'}</th><th scope="col">{pt ? 'Setores' : 'Sectors'}</th><th scope="col">{pt ? 'Equipe do projeto' : 'Project team'}</th><th scope="col">{pt ? 'Atualizado' : 'Updated'}</th><th scope="col"><span className="sr-only">{pt ? 'Abrir' : 'Open'}</span></th></tr></thead>
                  <tbody>{projects.map(p => {
                    const lead = p.participants.find(x => x.roleId === 'captain'), others = p.participants.filter(x => x.memberId !== lead?.memberId), sectors = sectorsOf(p);
                    return <tr key={p.id} tabIndex={0} className="team-project-row" onClick={() => onOpenProject(p.id)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpenProject(p.id); } }}>
                      <td><div className="team-project-cell"><span className="team-project-icon"><FolderKanban size={16} aria-hidden="true" /></span><span><strong>{p.name}</strong><small>{projectTypeLabel(p.projectType || undefined, language)}{p.hasSystem ? (pt ? ' · com requisitos' : ' · with requirements') : ''}</small></span></div></td>
                      <td>{lead ? <span className="team-person-inline"><PersonAvatar name={lead.displayName} id={lead.memberId} size={24} />{lead.displayName}</span> : <span className="team-muted">{pt ? 'Sem responsável' : 'No lead'}</span>}</td>
                      <td>{sectors.length ? <span className="team-chips">{sectors.slice(0, 3).map(name => <em key={name}>{name}</em>)}{sectors.length > 3 && <em className="more">+{sectors.length - 3}</em>}</span> : <span className="team-muted">—</span>}</td>
                      <td><span className="avatar-stack">{others.slice(0, others.length > 3 ? 2 : 3).map(x => <PersonAvatar key={x.memberId} name={x.displayName} id={x.memberId} size={24} />)}{others.length > 3 && <span className="team-more-bubble">…</span>}{!others.length && <span className="team-muted">{pt ? 'Somente o responsável' : 'Lead only'}</span>}</span></td>
                      <td className="team-date">{date(p.updatedAt)}</td><td><ArrowRight size={15} aria-hidden="true" /></td>
                    </tr>;
                  })}</tbody>
                </table></div>}
            </section>}
            {teamArea === 'people' && <section className="team-panel" aria-label={pt ? 'Pessoas da equipe' : 'Team people'}>
              <div className="team-panel-tools"><label className="team-search"><Search size={14} /><input type="search" value={peopleQuery} onChange={event => setPeopleQuery(event.target.value)} aria-label={pt ? 'Buscar pessoas' : 'Find people'} placeholder={pt ? 'Buscar nome, cargo ou função' : 'Find name, role or responsibility'} /></label></div>
              {membersLoading && <p role="status" className="team-muted">{pt ? 'Carregando pessoas…' : 'Loading people…'}</p>}
              <div className="team-table-wrap"><table className="team-table team-people">
                <thead><tr><th scope="col">{pt ? 'Pessoa' : 'Person'}</th><th scope="col">{pt ? 'Cargo e função' : 'Role and responsibilities'}</th><th scope="col">{pt ? 'Projetos e setores' : 'Projects and sectors'}</th>{selected.canManage && <th scope="col"><span className="sr-only">{pt ? 'Ações' : 'Actions'}</span></th>}</tr></thead>
                <tbody>{visiblePeople.map(m => {
                  const mine = projectsOf(m.id), isCaptain = m.id === selected.captainMemberId, professional = selected.professionalProfiles?.[m.id];
                  return <tr key={m.id} className="team-person-row">
                    <td><span className="team-person-inline"><PersonAvatar name={m.displayName} id={m.id} size={34} /><span><strong>{m.displayName}</strong>{m.nickname && <small>@{m.nickname}</small>}</span>{isCaptain && <em className="team-badge">{pt ? 'Gestão' : 'Lead'}</em>}</span></td>
                    <td><strong className="team-role">{roleOf(m)}</strong>{professional?.functionName && <p className="team-function">{professional.functionName}</p>}</td>
                    <td>{mine.length ? <span className="team-chips">{mine.map(project => { const assignment = project.participants.find(x => x.memberId === m.id); return <em key={project.id} title={`${project.name} · ${assignment?.roleName || ''}${assignment?.sectorName ? ` · ${assignment.sectorName}` : ''}`}>{project.name}{assignment?.sectorName ? ` · ${assignment.sectorName}` : ''}</em>; })}</span> : <span className="team-muted">{pt ? 'Sem alocação em projeto' : 'Not allocated to a project'}</span>}</td>
                    {selected.canManage && <td className="team-row-actions"><button type="button" className="team-secondary small" onClick={() => { setFeedback(''); setProfessionalEditor(m); }}><Pencil size={13} />{pt ? 'Cargo e função' : 'Role and responsibilities'}</button>{!isCaptain && <button type="button" className="team-ghost-icon danger" title={pt ? 'Remover da equipe' : 'Remove from team'} aria-label={pt ? 'Remover da equipe' : 'Remove from team'} onClick={() => void removeMember(m)}><X size={14} /></button>}</td>}
                  </tr>;
                })}</tbody>
              </table></div>
              {!membersLoading && !visiblePeople.length && <div className="team-empty compact"><UserRound size={24} aria-hidden="true" /><strong>{peopleQuery ? (pt ? 'Ninguém encontrado' : 'Nobody found') : (pt ? 'Nenhuma pessoa nesta equipe' : 'Nobody in this team')}</strong>{selected.canManage && !peopleQuery && <span>{pt ? 'Convide pelo nickname na aba Convites.' : 'Invite people by nickname in the Invitations tab.'}</span>}</div>}
            </section>}
            {teamArea === 'allocation' && <section className="team-panel" aria-label={pt ? 'Alocação de pessoas por projeto' : 'People allocation by project'}>
              <p className="team-panel-note"><Layers size={14} aria-hidden="true" />{pt ? 'Quem trabalha em cada projeto, com o papel e o setor atribuídos. As permissões seguem a configuração de cada projeto.' : 'Who works on each project, with the assigned role and sector. Permissions follow each project configuration.'}</p>
              {projects.length && selectedMembers.length ? <div className="team-table-wrap"><table className="team-table team-matrix">
                <thead><tr><th scope="col">{pt ? 'Pessoa' : 'Person'}</th>{projects.map(project => <th scope="col" key={project.id}><button type="button" onClick={() => onOpenProject(project.id)} title={pt ? 'Abrir projeto' : 'Open project'}>{project.name}</button></th>)}<th scope="col">{pt ? 'Projetos' : 'Projects'}</th></tr></thead>
                <tbody>{selectedMembers.map(member => <tr key={member.id}><th scope="row"><span className="team-person-inline"><PersonAvatar name={member.displayName} id={member.id} size={26} /><span><strong>{member.displayName}</strong><small>{roleOf(member)}</small></span></span></th>
                  {projects.map(project => { const assignment = project.participants.find(x => x.memberId === member.id); return <td key={project.id} className={assignment ? 'allocated' : ''}>{assignment ? <span className="team-allocation"><b>{assignment.roleName}</b>{assignment.sectorName && <small>{assignment.sectorName}</small>}</span> : <span className="team-muted">—</span>}</td>; })}
                  <td className="team-load"><b>{projectsOf(member.id).length}</b></td></tr>)}</tbody>
              </table></div> : <div className="team-empty compact"><Grid3x3 size={24} aria-hidden="true" /><strong>{pt ? 'Sem alocações para mostrar' : 'No allocations to show'}</strong><span>{pt ? 'A matriz aparece quando a equipe tem projetos e pessoas.' : 'The matrix appears once the team has projects and people.'}</span></div>}
            </section>}
            {teamArea === 'invitations' && selected.canManage && <section className="team-panel"><TeamInvitations key={selected.id} teamId={selected.id} language={language} /></section>}
          </> : <section className="team-panel"><p>{pt ? 'A participação acontece por convite. Compartilhe seu nickname com a equipe para que ela possa encontrar seu perfil.' : 'Membership is by invitation. Share your nickname so the team can find your profile.'}</p><h3>{pt ? 'Projetos públicos' : 'Public projects'}</h3>{projectsLoading && <p role="status">{pt ? 'Carregando resumos públicos…' : 'Loading public summaries…'}</p>}{projectsFailed && <div className="team-project-load" role="alert"><p>{pt ? 'Os resumos públicos não estão disponíveis agora.' : 'Public summaries are unavailable right now.'}</p><button type="button" onClick={() => setProjectRetry(value => value + 1)}>{pt ? 'Recarregar projetos' : 'Reload projects'}</button></div>}{projects.map(p => <article className="public-project-summary" key={p.id}><Network size={18} /><strong>{p.name}</strong></article>)}{!projectsLoading && !projectsFailed && !projects.length && <p>{pt ? 'Esta equipe ainda não publicou resumos de projetos.' : 'This team has not published project summaries yet.'}</p>}<p>{pt ? 'Pessoas, documentos e estatísticas internas têm acesso restrito.' : 'People, files and internal insights have restricted access.'}</p></section>}
        </>}</section>
      </div>
    </main>
    {professionalEditor && selected && <div className="teams-dialog-backdrop" role="presentation" onPointerDown={() => setProfessionalEditor(null)}><form className="teams-dialog" role="dialog" aria-modal="true" aria-label={pt ? 'Cargo e função' : 'Role and responsibilities'} onSubmit={event => void saveProfessionalProfile(event)} onPointerDown={event => event.stopPropagation()}><header><h2>{professionalEditor.displayName}</h2><button type="button" onClick={() => setProfessionalEditor(null)} aria-label={pt ? 'Fechar' : 'Close'}><X /></button></header><label>{pt ? 'Cargo na equipe' : 'Team role'}<input name="roleName" required maxLength={100} defaultValue={selected.professionalProfiles?.[professionalEditor.id]?.roleName || ''} placeholder={pt ? 'Ex.: Engenheira de sistemas' : 'e.g. Systems engineer'} /></label><label>{pt ? 'Função e responsabilidades' : 'Responsibilities'}<textarea name="functionName" maxLength={500} rows={4} defaultValue={selected.professionalProfiles?.[professionalEditor.id]?.functionName || ''} placeholder={pt ? 'Ex.: Coordenar requisitos e revisões do subsistema de propulsão.' : 'e.g. Coordinate requirements and reviews for propulsion.'} /></label><small>{pt ? 'Informações do perfil. As permissões de acesso permanecem separadas.' : 'Profile information. Access permissions are managed separately.'}</small>{feedback && <p role="alert">{feedback}</p>}<footer><button type="button" onClick={() => setProfessionalEditor(null)}>{pt ? 'Cancelar' : 'Cancel'}</button><button className="primary" type="submit" disabled={busy}>{pt ? 'Salvar' : 'Save'}</button></footer></form></div>}
    {dialog && <div className="teams-dialog-backdrop" role="presentation" onPointerDown={() => setDialog(null)}><form className="teams-dialog" role="dialog" aria-modal="true" aria-label={dialog === 'create-team' ? (pt ? 'Criar equipe' : 'Create team') : (pt ? 'Editar equipe' : 'Edit team')} onSubmit={e => void submit(e)} onPointerDown={e => e.stopPropagation()}><header><h2>{dialog === 'create-team' ? (pt ? 'Criar equipe' : 'Create team') : (pt ? 'Editar equipe' : 'Edit team')}</h2><button type="button" onClick={() => setDialog(null)} aria-label={pt ? 'Fechar' : 'Close'}><X /></button></header><label>{pt ? 'Nome da equipe ou empresa' : 'Team or company name'}<input name="name" required minLength={2} maxLength={100} defaultValue={dialog === 'edit-team' ? selected?.name : ''} /></label><label>{pt ? 'Descrição' : 'Description'}<textarea name="description" maxLength={300} defaultValue={dialog === 'edit-team' ? selected?.description : ''} placeholder={pt ? 'Área de atuação, programas ou clientes atendidos.' : 'Field, programs or clients served.'} /></label>{dialog === 'edit-team' && <label>{pt ? 'Gestor da equipe' : 'Team manager'}<select name="captainMemberId" defaultValue={selected?.captainMemberId || ''}><option value="" disabled>{pt ? 'Selecione' : 'Select'}</option>{selectedMembers.map(m => <option key={m.id} value={m.id}>{m.displayName}</option>)}</select></label>}{feedback && <p role="alert">{feedback}</p>}<footer><button type="button" onClick={() => setDialog(null)}>{pt ? 'Cancelar' : 'Cancel'}</button><button data-usage-action={dialog === 'create-team' ? 'team.create' : undefined} className="primary" type="submit" disabled={busy}><Check />{pt ? 'Salvar' : 'Save'}</button></footer></form></div>}
  </div>;
}
