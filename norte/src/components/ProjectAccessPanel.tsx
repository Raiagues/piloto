import { ArrowRight, FolderKanban, LoaderCircle, Plus, RefreshCw } from 'lucide-react';
import type { ProjectSummary } from '../lib/team';
import type { Language } from '../lib/types';
import '../styles/features/teams.css';
export function ProjectAccessPanel({ language, loading, error, projects, opening, onRetry, onSelect, onCreate }: {
  language: Language; loading: boolean; error: string; projects: ProjectSummary[]; opening: string;
  onRetry: () => void; onSelect: (id: string) => void; onCreate: () => void;
}) {
  const pt = language === 'pt';
  return <section className="project-access-panel" aria-busy={loading || Boolean(opening)}>
    <FolderKanban size={26}/><h1>{pt ? 'Abra um projeto' : 'Open a project'}</h1>
    <p>{pt ? 'Escolha um projeto para continuar de onde parou.' : 'Choose a project to continue where you left off.'}</p>
    {loading && <p role="status"><LoaderCircle size={16}/>{pt ? 'Carregando seus projetos…' : 'Loading your projects…'}</p>}
    {error && <div className="project-access-error" role="alert"><p>{error}</p><button type="button" disabled={loading || Boolean(opening)} onClick={onRetry}><RefreshCw size={15}/>{pt ? 'Tentar carregar novamente' : 'Retry loading'}</button></div>}
    <div className="project-access-options">{projects.map(project => <button type="button" key={project.id} disabled={Boolean(opening)} onClick={() => onSelect(project.id)}><span>{project.name}</span>{opening === project.id ? <LoaderCircle size={16}/> : <ArrowRight size={16}/>}</button>)}</div>
    {!loading && !error && !projects.length && <p>{pt ? 'Você ainda não tem um projeto disponível nesta conta. Crie um ou aceite o convite da sua equipe.' : 'No project is available in this account yet. Create one or accept your team invitation.'}</p>}
    <footer><button type="button" onClick={onCreate}><Plus size={15}/>{pt ? 'Criar projeto' : 'Create project'}</button><a href="#/teams">{pt ? 'Ver minhas equipes' : 'View my teams'}</a></footer>
  </section>;
}
