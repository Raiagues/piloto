import { useEffect, useState } from 'react';
import { ArrowLeft, Settings2 } from 'lucide-react';
import { useAuth } from '../lib/auth';
import type { MissionProject } from '../lib/projectStore';
import type { TeamMember } from '../lib/team';
import type { Language } from '../lib/types';
import { OrganizationTree } from '../components/OrganizationTree';
import { ViewToggle } from '../components/ViewToggle';
import '../collaboration-workspace.css';
import { projectOrganization } from '../../shared/organization-tree.mjs';

type Props = { language: Language; project: MissionProject; t: (path: string) => string; onLanguageChange: (language: Language) => void; onBack: () => void; onProjectSetup: () => void };
export function TeamPage({ language, project, onBack, onProjectSetup }: Props) {
  const { api } = useAuth(), pt = language === 'pt';
  const [members, setMembers] = useState<TeamMember[]>([]), [view, setView] = useState<'list' | 'hierarchy'>('list'), [error, setError] = useState('');
  useEffect(() => { void api<{ members: TeamMember[] }>('/team/members').then(r => setMembers(r.members)).catch(e => setError(e.message)); }, [api]);
  return <main className="project-team-page collaboration-page"><header className="workspace-heading"><div><span className="workspace-eyebrow">{project.name}</span><h1>{pt ? 'Equipe do projeto' : 'Project team'}</h1><p>{pt ? 'Pessoas, setores e responsabilidades deste projeto.' : 'People, sectors and responsibilities for this project.'}</p></div><button type="button" className="workspace-action" onClick={onProjectSetup}><Settings2 size={16} />{pt ? 'Configurar equipe' : 'Configure team'}</button></header><div className="collaboration-toolbar"><button type="button" className="workspace-text-button" onClick={onBack}><ArrowLeft size={15} />{pt ? 'Voltar à memória' : 'Back to memory'}</button><ViewToggle value={view} onChange={setView} language={language} /></div>{error && <p role="alert">{error}</p>}<section className="collaboration-panel"><OrganizationTree tree={projectOrganization(project, members)} view={view} language={language} /></section></main>;
}
