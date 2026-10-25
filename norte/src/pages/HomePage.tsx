import { useEffect, useState } from "react";
import { ArrowRight, FolderOpen, LoaderCircle, Plus, Trash2, UsersRound, X } from "lucide-react";
import type { ProjectSummary } from "../lib/team";
import type { Language } from "../lib/types";
import '../styles/features/home.css';
type Props = {
  language: Language;
  projects?: ProjectSummary[];
  loadingProjects?: boolean;
  onOpenProject?: (projectId: string) => void;
  onDeleteProject?: (projectId: string) => Promise<void> | void;
  onCreateProject?: () => void;
  onOpenTeams?: () => void;
};

export function HomePage({
  language,
  projects = [],
  loadingProjects = false,
  onOpenProject,
  onDeleteProject,
  onOpenTeams, onCreateProject
}: Props) {
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [deletingId, setDeletingId] = useState("");

  const c = language === "pt" ? {
    teams: "Equipes",
    create: "Novo projeto",
    open: "Abrir projeto",
    chooseProject: "Escolha um projeto",
    empty: "Nenhum projeto criado ainda.",
    emptyHint: "Crie um projeto para começar.",
    loading: "Carregando projetos",
    untitled: "Projeto sem nome",
    noProgram: "Projeto de engenharia",
    member: "membro",
    members: "membros",
    updated: "Atualizado",
    delete: "Excluir projeto",
    deleteConfirm: "Excluir este projeto permanentemente? A equipe e seus artefatos permanentes não serão apagados.",
    close: "Fechar"
  } : {
    teams: "Teams",
    create: "New project",
    open: "Open project",
    chooseProject: "Choose a project",
    empty: "No projects have been created yet.",
    emptyHint: "Create a project to get started.",
    loading: "Loading projects",
    untitled: "Untitled project",
    noProgram: "Engineering project",
    member: "member",
    members: "members",
    updated: "Updated",
    delete: "Delete project",
    deleteConfirm: "Delete this project permanently? The team and its permanent artifacts will not be deleted.",
    close: "Close"
  };

  useEffect(() => {
    if (!projectPickerOpen) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setProjectPickerOpen(false);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [projectPickerOpen]);

  async function deleteProject(projectId: string) {
    if (!window.confirm(c.deleteConfirm)) return;
    setDeletingId(projectId);
    try {
      await onDeleteProject?.(projectId);
    } finally {
      setDeletingId("");
    }
  }

  return (
    <div className="home-shell home-landing-shell">
      <main className="home-main">


        <section className="home-landing" aria-labelledby="norte-home-title">
          <header className="home-workspace-heading"><h1 id="norte-home-title">{language === "pt" ? "Seu espaço de trabalho" : "Your workspace"}</h1></header>
          <div className="home-action-grid" aria-label={language === "pt" ? "Ações principais" : "Primary actions"}>
            <button className="home-action-card accent-open" type="button" onClick={() => setProjectPickerOpen(true)}>
              <span className="home-card-icon"><FolderOpen aria-hidden="true" /></span>
              <strong>{c.open}</strong>
              <ArrowRight className="home-card-arrow" aria-hidden="true" />
            </button>
            <button className="home-action-card accent-create" type="button" onClick={onCreateProject}>
              <span className="home-card-icon"><Plus aria-hidden="true" /></span>
              <strong>{c.create}</strong>
              <ArrowRight className="home-card-arrow" aria-hidden="true" />
            </button>
            <button className="home-action-card accent-team" type="button" onClick={onOpenTeams}>
              <span className="home-card-icon"><UsersRound aria-hidden="true" /></span>
              <strong>{c.teams}</strong>
              <ArrowRight className="home-card-arrow" aria-hidden="true" />
            </button>
          </div>
          {projects.length > 0 && <section className="home-recent" aria-labelledby="home-recent-title"><header><h2 id="home-recent-title">{language === "pt" ? "Projetos recentes" : "Recent projects"}</h2><span>{projects.length} {language === "pt" ? projects.length === 1 ? "projeto" : "projetos" : projects.length === 1 ? "project" : "projects"}</span></header>{[...projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 5).map(project => <button key={project.id} type="button" onClick={() => onOpenProject?.(project.id)}><FolderOpen size={20} /><span><strong>{project.name || c.untitled}</strong><small>{c.updated} {new Date(project.updatedAt).toLocaleDateString(language === "pt" ? "pt-BR" : "en-GB")}</small></span><ArrowRight size={17} /></button>)}</section>}
        </section>
      </main>

      {projectPickerOpen && <div className="home-project-dialog-backdrop" role="presentation" onPointerDown={() => setProjectPickerOpen(false)}>
        <section className="home-project-dialog" role="dialog" aria-modal="true" aria-labelledby="home-project-dialog-title" onPointerDown={(event) => event.stopPropagation()}>
          <header>
            <div><span>{c.open}</span><h2 id="home-project-dialog-title">{c.chooseProject}</h2></div>
            <button className="home-dialog-close" type="button" onClick={() => setProjectPickerOpen(false)} aria-label={c.close}><X aria-hidden="true" /></button>
          </header>
          <div className="home-project-picker-list">
            {loadingProjects ? <div className="home-project-dialog-empty"><LoaderCircle className="home-spin" aria-hidden="true" />{c.loading}</div> : projects.length === 0 ? (
              <div className="home-project-dialog-empty"><FolderOpen aria-hidden="true" /><strong>{c.empty}</strong><span>{c.emptyHint}</span><button type="button" onClick={onCreateProject}><Plus aria-hidden="true" />{c.create}</button></div>
            ) : projects.map((project) => {
              const date = new Intl.DateTimeFormat(language === "pt" ? "pt-BR" : "en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(project.updatedAt));
              return <article className="home-project-picker-row" key={project.id}>
                <button className="home-project-open" type="button" onClick={() => { setProjectPickerOpen(false); onOpenProject?.(project.id); }}>
                  <span className="home-project-symbol"><FolderOpen aria-hidden="true" /></span>
                  <span className="home-project-copy"><strong>{project.name || c.untitled}</strong><small>{c.noProgram}</small></span>
                  <span className="home-project-meta"><small>{project.memberCount} {project.memberCount === 1 ? c.member : c.members}</small><small>{c.updated} {date}</small></span>
                  <ArrowRight aria-hidden="true" />
                </button>
                <button className="home-project-delete" type="button" disabled={deletingId === project.id} onClick={() => void deleteProject(project.id)} title={c.delete} aria-label={`${c.delete}: ${project.name || c.untitled}`}>
                  {deletingId === project.id ? <LoaderCircle className="home-spin" aria-hidden="true" /> : <Trash2 aria-hidden="true" />}
                </button>
              </article>;
            })}
          </div>
        </section>
      </div>}
    </div>
  );
}
