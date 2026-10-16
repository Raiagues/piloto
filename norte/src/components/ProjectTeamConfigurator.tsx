import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, MoreHorizontal, Plus, Search, Undo2 } from 'lucide-react';
import { isProjectAdmin, sectorRole } from '../../shared/project-organization.mjs';
import { projectOrganization } from '../../shared/organization-tree.mjs';
import { useAuth } from '../lib/auth';
import { memberInitials } from '../lib/team';
import type { MissionProject, ProjectContext, ProjectMemberAssignment } from '../lib/projectStore';
import type { TeamMember, TeamRecord } from '../lib/team';
import type { Language } from '../lib/types';
import { ViewToggle } from './ViewToggle';
import type { OrganizationView } from './ViewToggle';
import { SectorsEditor } from './SectorsEditor';
import { InfoTip } from './InfoTip';
import { EditorPopup } from './EditorPopup';

type Draft = Pick<ProjectContext, 'roles' | 'sectors' | 'assignments'>;
type Props = { language: Language; context: ProjectContext; project: MissionProject; team: TeamRecord; members: TeamMember[]; onSave: (patch: Draft) => void | Promise<void>; onClose: () => void };
export function ProjectTeamConfigurator({ language, context, project, team, members, onSave, onClose }: Props) {
  const { user } = useAuth(), pt = language === 'pt', admin = isProjectAdmin(project, user);
  const [draft, setDraft] = useState<Draft>(() => structuredClone({ roles: context.roles, sectors: context.sectors, assignments: context.assignments }));
  const [history, setHistory] = useState<Draft[]>([]), [tab, setTab] = useState<'sectors' | 'members'>('sectors');
  const [view, setView] = useState<OrganizationView>('list'), [search, setSearch] = useState(''), [page, setPage] = useState(0);
  const [error, setError] = useState(''), [saving, setSaving] = useState(false), [newRole, setNewRole] = useState('');
  const [editingId, setEditingId] = useState(''), [addingRole, setAddingRole] = useState(false);
  const [pageSize, setPageSize] = useState(window.innerWidth <= 760 ? 3 : 4);
  useEffect(() => { const update = () => setPageSize(window.innerWidth <= 760 ? 3 : 4); window.addEventListener('resize', update); return () => window.removeEventListener('resize', update); }, []);
  const teamMembers = members.filter(m => team.memberIds.includes(m.id));
  const tree = useMemo(() => projectOrganization({ ...project, context: { ...context, ...draft } }, members), [project, context, draft, members]);
  const roleName = (id: string, name: string) => ({ captain: pt ? 'Responsável pelo projeto' : 'Project lead', manager: pt ? 'Gerente de setor' : 'Sector manager', member: pt ? 'Membro' : 'Member', advisor: pt ? 'Orientador' : 'Advisor' })[id] || name;
  const filtered = teamMembers.filter(m => `${m.displayName} ${m.nickname || ''}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize)), currentPage = Math.min(page, pageCount - 1);
  const editing = teamMembers.find(m => m.id === editingId), a = draft.assignments.find(item => item.memberId === editingId);
  function change(next: Draft) { setHistory(h => [...h.slice(-19), structuredClone(draft)]); setDraft(next); }
  function assignment(memberId: string, patch: Partial<ProjectMemberAssignment>) { change({ ...draft, assignments: draft.assignments.map(a => a.memberId === memberId ? { ...a, ...patch } : a) }); }
  function removeSector(id: string) {
    if (!window.confirm(pt ? 'Remover este setor? Pastas ou documentos vinculados impedem a remoção.' : 'Remove this sector? Linked files and folders prevent removal.')) return;
    change({ ...draft, sectors: draft.sectors.filter(s => s.id !== id), assignments: draft.assignments.map(a => ({ ...a, sectorId: a.sectorId === id ? '' : a.sectorId, ...(a.sectorRoles ? { sectorRoles: a.sectorRoles.filter(g => g.sectorId !== id) } : {}) })) });
  }
  return <section className="team-configurator">
    <div className="team-config-toolbar"><div className="team-config-tabs" role="tablist" aria-label={pt ? 'Equipe do projeto' : 'Project team'}><button role="tab" aria-selected={tab === 'sectors'} type="button" onClick={() => setTab('sectors')}>{pt ? 'Setores' : 'Sectors'}<span aria-hidden="true">{draft.sectors.length}</span></button><button role="tab" aria-selected={tab === 'members'} type="button" onClick={() => setTab('members')}>{pt ? 'Cargos e membros' : 'Roles and members'}<span aria-hidden="true">{draft.assignments.length}</span></button></div><InfoTip label={pt ? 'Sobre os participantes' : 'About participants'}>{pt ? 'Selecione membros que já aceitaram o convite da equipe. O botão de opções permite definir o cargo e os acessos de cada pessoa por setor.' : 'Select members who have accepted a team invitation. Use the options button to set each person’s role and sector access.'}</InfoTip><div className="team-config-view"><ViewToggle value={view} onChange={setView} language={language} /><button className="undo-button" type="button" aria-label={pt ? 'Desfazer' : 'Undo'} disabled={!history.length} onClick={() => { const previous = history.at(-1); if (previous) { setDraft(previous); setHistory(h => h.slice(0, -1)); } }}><Undo2 size={16} /></button></div></div>
    <div className="team-config-content">
      {tab === 'sectors' || view === 'hierarchy' ? <SectorsEditor sectors={draft.sectors} onChange={sectors => change({ ...draft, sectors })} language={language} view={view} projectName={project.name} disabled={!admin} onRemove={removeSector} tree={tree} onEditMember={setEditingId} /> : <div className="member-editor">
        <label className="member-search"><Search size={16} /><input type="search" aria-label={pt ? 'Pesquisar membros' : 'Search members'} value={search} placeholder={pt ? 'Pesquisar nome ou nickname' : 'Search name or nickname'} onChange={e => { setSearch(e.target.value); setPage(0); }} /></label>
        <div className="member-rows">{filtered.slice(currentPage * pageSize, currentPage * pageSize + pageSize).map(member => {
          const assigned = draft.assignments.find(item => item.memberId === member.id);
          return <article className="member-row" key={member.id}><label className="participant-select"><input type="checkbox" aria-label={`${pt ? 'Selecionar' : 'Select'} ${member.displayName}`} checked={Boolean(assigned)} disabled={!admin} onChange={() => change({ ...draft, assignments: assigned ? draft.assignments.filter(item => item.memberId !== member.id) : [...draft.assignments, { memberId: member.id, roleId: 'member', sectorId: '' }] })} /><span className="member-avatar">{memberInitials(member.displayName)}</span><span><strong>{member.displayName}</strong><small>{member.nickname ? `@${member.nickname}` : ''}</small></span></label><span className="member-role">{assigned ? roleName(assigned.roleId, draft.roles.find(r => r.id === assigned.roleId)?.name || '') : (pt ? 'Fora do projeto' : 'Not in project')}</span><button type="button" className="member-options" disabled={!assigned} aria-label={`${pt ? 'Opções de' : 'Options for'} ${member.displayName}`} onClick={() => { setEditingId(member.id); setAddingRole(false); }}><MoreHorizontal size={20} /></button></article>;
        })}{!filtered.length && <p className="workspace-empty">{pt ? 'Nenhum membro encontrado.' : 'No members found.'}</p>}</div>
        {pageCount > 1 && <nav className="member-pagination" aria-label={pt ? 'Páginas de membros' : 'Member pages'}><button type="button" aria-label={pt ? 'Anterior' : 'Previous'} disabled={!currentPage} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={16} /></button><span>{currentPage + 1} / {pageCount}</span><button type="button" aria-label={pt ? 'Próxima' : 'Next'} disabled={currentPage + 1 >= pageCount} onClick={() => setPage(currentPage + 1)}><ChevronRight size={16} /></button></nav>}
      </div>}
    </div>
    {error && <p className="workspace-error" role="alert">{error}</p>}
    <footer className="team-config-footer"><span>{draft.assignments.length} {pt ? 'membros' : 'members'} · {draft.sectors.length} {pt ? 'setores' : 'sectors'}</span><button type="button" onClick={onClose}>{pt ? 'Cancelar' : 'Cancel'}</button><button className="primary" type="button" disabled={saving} onClick={async () => { setSaving(true); setError(''); try { await onSave(draft); } catch (e) { setError(e instanceof Error ? e.message : (pt ? 'Falha ao salvar' : 'Could not save')); } finally { setSaving(false); } }}><Check size={16} />{saving ? (pt ? 'Salvando…' : 'Saving…') : (pt ? 'Salvar configuração' : 'Save configuration')}</button></footer>
    {editing && a && <EditorPopup title={editing.displayName} closeLabel={pt ? 'Fechar opções' : 'Close options'} onClose={() => setEditingId('')}><div className="editor-popup-body"><label className="workspace-field"><span>{pt ? 'Responsabilidade no projeto' : 'Project responsibility'}</span><select aria-label={pt ? "Responsabilidade no projeto" : "Project responsibility"} disabled={!admin} value={a.roleId} onChange={e => assignment(editing.id, { roleId: e.target.value })}>{draft.roles.map(r => <option key={r.id} value={r.id}>{roleName(r.id, r.name)}</option>)}</select></label>
      {admin && <><button type="button" className="workspace-text-button" onClick={() => setAddingRole(v => !v)}><Plus size={14} />{pt ? 'Criar cargo' : 'Create role'}</button>{addingRole && <div className="custom-role-field"><input aria-label={pt ? 'Nome do cargo' : 'Role name'} value={newRole} maxLength={100} onChange={e => setNewRole(e.target.value)} /><button type="button" disabled={!newRole.trim() || draft.roles.length >= 100} onClick={() => { const id = crypto.randomUUID(); change({ ...draft, roles: [...draft.roles, { id, name: newRole.trim() }], assignments: draft.assignments.map(item => item.memberId === editing.id ? { ...item, roleId: id } : item) }); setNewRole(''); setAddingRole(false); }}>{pt ? 'Adicionar cargo' : 'Add role'}</button></div>}</>}
      <h4>{pt ? 'Acesso por setor' : 'Sector access'}</h4><div className="member-sector-options">{draft.sectors.map(sector => {
        const current = a.sectorRoles?.find(g => g.sectorId === sector.id)?.role || (a.sectorId === sector.id ? a.roleId === 'manager' ? 'manager' : 'member' : '');
        const canDelegate = sectorRole(project, user, sector.id) === 'manager' && editing.id !== user?.memberId && current !== 'manager' && !['captain', 'advisor'].includes(a.roleId);
        return <label key={sector.id}><span>{sector.name}</span><select aria-label={`${editing.displayName} · ${sector.name}`} disabled={!admin && !canDelegate} value={current} onChange={e => { const value = e.target.value as 'manager' | 'member' | 'viewer' | ''; assignment(editing.id, { ...(admin && !value && a.sectorId === sector.id ? { sectorId: '' } : {}), sectorRoles: [...(a.sectorRoles || []).filter(g => g.sectorId !== sector.id), ...(value ? [{ sectorId: sector.id, role: value }] : [])] }); }}><option value="" disabled={!admin}>{pt ? 'Leitura geral' : 'General read access'}</option><option value="viewer">{pt ? 'Participante · leitura' : 'Participant · read'}</option><option value="member">{pt ? 'Membro · edição' : 'Member · edit'}</option><option value="manager" disabled={!admin}>{pt ? 'Gerente do setor' : 'Sector manager'}</option></select></label>;
      })}</div></div><footer><button className="primary" type="button" onClick={() => setEditingId('')}>{pt ? 'Pronto' : 'Done'}</button></footer></EditorPopup>}
  </section>;
}
