import { useState } from 'react';
import { ArrowRight, FolderKanban, UsersRound } from 'lucide-react';
import { PROJECT_TYPES } from '../../shared/project-organization.mjs';
import type { ProjectType } from '../../shared/project-organization.mjs';
import { createEmptyProject } from '../lib/projectStore';
import type { MissionProject } from '../lib/projectStore';
import type { TeamRecord } from '../lib/team';
import type { Language } from '../lib/types';
import { useAuth } from '../lib/auth';
import '../styles/features/project.css';
type Props = { language: Language; teams: TeamRecord[]; onCreate: (project: MissionProject) => Promise<void>; onHome: () => void; onTeams: () => void };
export function ProjectSetupPage({ language, teams, onCreate, onHome, onTeams }: Props) {
  const auth = useAuth(), pt = language === 'pt';
  const [type, setType] = useState<ProjectType>('product'), [name, setName] = useState('');
  const [createdTeam, setCreatedTeam] = useState<TeamRecord | null>(null);
  const eligible = teams.filter(t => t.membership === 'member' || t.memberIds.includes(auth.user?.memberId || ''));
  const [teamId, setTeamId] = useState(() => eligible.find(t => t.id === window.localStorage.getItem('norte-default-team-v1'))?.id || eligible[0]?.id || '');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const team = eligible.find(t => t.id === teamId) || eligible[0] || createdTeam;
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth.user || !name.trim() || busy) return;
    setBusy(true); setError('');
    try {
      const available = team ? [] : (await auth.api<{ teams: TeamRecord[] }>('/teams')).teams.filter(item => item.membership === 'member' || item.memberIds.includes(auth.user!.memberId));
      const selectedTeam = team || available[0] || (await auth.api<{ team: TeamRecord }>('/teams', { method: 'POST', body: JSON.stringify({ name: `${name.trim().slice(0, 80)} · ${pt ? 'Equipe' : 'Team'}` }) })).team;
      if (!team) setCreatedTeam(selectedTeam);
      const project = createEmptyProject(language);
      project.name = name.trim(); project.projectType = type;
      project.context = { ...project.context, configured: true, referenceProgram: 'independent', programId: null, modalityId: null, categoryId: null, teamId: selectedTeam.id, teamName: selectedTeam.name, sectors: [], folders: [], assignments: selectedTeam.memberIds.includes(auth.user.memberId) ? [{ memberId: auth.user.memberId, roleId: 'captain', sectorId: '' }] : [] };
      await onCreate(project);
    } catch (reason) { setError(reason instanceof Error ? reason.message : (pt ? 'Não foi possível criar o projeto.' : 'Could not create the project.')); }
    finally { setBusy(false); }
  }
  return <main className="project-create project-create-simple"><form onSubmit={event => void submit(event)}>
    <header className="workspace-heading"><div><h1>{pt ? 'Novo projeto' : 'New project'}</h1></div></header>
    <section className="workspace-card project-basics"><span className="project-create-symbol"><FolderKanban size={24} /></span>
      <label className="workspace-field"><span>{pt ? 'Nome do projeto' : 'Project name'}</span><input name="name" required maxLength={120} autoFocus placeholder={pt ? 'Ex.: Sistema de navegação Aurora' : 'E.g. Aurora navigation system'} value={name} onChange={e => setName(e.target.value)} /></label>
      <p className="project-create-team"><UsersRound size={16} />{team?.name || (pt ? 'Um espaço de equipe será criado somente com você.' : 'A team workspace will be created with only you.')}</p>
      <details className="project-create-options"><summary>{pt ? 'Tipo de projeto e equipe' : 'Project type and team'} <span>{pt ? 'opcional' : 'optional'}</span></summary><div>
        <label className="workspace-field"><span>{pt ? 'Tipo de projeto' : 'Project type'}</span><select aria-label={pt ? 'Tipo de projeto' : 'Project type'} value={type} onChange={e => setType(e.target.value as ProjectType)}>{Object.entries(PROJECT_TYPES).map(([key, value]) => <option value={key} key={key}>{key === 'product' ? (pt ? 'Engenharia / produto' : 'Engineering / product') : value[language]}</option>)}</select></label>
        {eligible.length > 0 && <label className="workspace-field"><span>{pt ? 'Equipe' : 'Team'}</span><select aria-label={pt ? 'Equipe' : 'Team'} value={team?.id || ''} onChange={e => setTeamId(e.target.value)}>{eligible.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
        <p>{pt ? 'Setores, permissões e programas de referência podem ser configurados depois.' : 'Sectors, permissions and reference programs can be configured later.'}</p>
        <button className="workspace-text-button" type="button" onClick={onTeams}>{pt ? 'Gerenciar equipes' : 'Manage teams'}<ArrowRight size={14} /></button>
      </div></details>
      <footer className="project-create-footer"><button type="button" onClick={onHome}>{pt ? 'Cancelar' : 'Cancel'}</button><button data-usage-action="project.create" className="primary" type="submit" disabled={busy || !name.trim() || auth.user?.accessRole === 'advisor'}>{busy ? (pt ? 'Criando…' : 'Creating…') : (pt ? 'Criar projeto' : 'Create project')}<ArrowRight size={16} /></button></footer>
      {error && <p className="workspace-error" role="alert">{error}</p>}
    </section>
  </form></main>;
}
