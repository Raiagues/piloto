import { useEffect, useState } from "react";
import { ArrowRight, FolderOpen, LoaderCircle, MessageSquare, Plus, Trash2, UsersRound, X } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useRecentWork } from "../lib/workspaceHistory";
import { RecentList } from "../components/RecentWork";
import type { ProjectSummary } from "../lib/team";
import type { Language } from "../lib/types";
import '../styles/features/home.css';
import '../styles/recent-work.css';
type Props = {
  language: Language;
  projects?: ProjectSummary[];
  teams?: { id: string; name: string }[];
  loadingProjects?: boolean;
  onOpenProject?: (projectId: string) => void;
  onDeleteProject?: (projectId: string) => Promise<void> | void;
  onCreateProject?: () => void;
  onOpenTeams?: () => void;
};

export function HomePage({ language, projects = [], teams = [], loadingProjects = false, onOpenProject, onDeleteProject, onOpenTeams, onCreateProject }: Props) {
  const { user } = useAuth(), recent = useRecentWork(), pt = language === "pt";
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [deletingId, setDeletingId] = useState("");
  const c = pt ? {
    teams: "Equipes", create: "Novo projeto", open: "Abrir projeto", meetings: "Reuniões", chooseProject: "Escolha um projeto",
    empty: "Nenhum projeto criado ainda.", emptyHint: "Crie um projeto ou peça um convite para a equipe.", loading: "Carregando projetos", untitled: "Projeto sem nome",
    noTeam: "Sem equipe", member: "pessoa", members: "pessoas", updated: "Atualizado", delete: "Excluir projeto",
    deleteConfirm: "Excluir este projeto permanentemente? A equipe e seus artefatos permanentes não serão apagados.", close: "Fechar"
  } : {
    teams: "Teams", create: "New project", open: "Open project", meetings: "Meetings", chooseProject: "Choose a project",
    empty: "No projects have been created yet.", emptyHint: "Create a project or ask a team for an invitation.", loading: "Loading projects", untitled: "Untitled project",
    noTeam: "No team", member: "person", members: "people", updated: "Updated", delete: "Delete project",
    deleteConfirm: "Delete this project permanently? The team and its permanent artifacts will not be deleted.", close: "Close"
  };
  useEffect(() => {
    if (!projectPickerOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setProjectPickerOpen(false); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [projectPickerOpen]);
  async function deleteProject(projectId: string) {
    if (!window.confirm(c.deleteConfirm)) return;
    setDeletingId(projectId);
    try { await onDeleteProject?.(projectId); } finally { setDeletingId(""); }
  }
  const teamName = (project: ProjectSummary) => teams.find(team => team.id === project.teamId)?.name || c.noTeam;
  const date = (value: string) => new Intl.DateTimeFormat(pt ? "pt-BR" : "en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));
  const ordered = [...projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const firstName = (user?.name || "").trim().split(/\s+/u)[0];
  const actions = [
    { key: "open", label: c.open, hint: pt ? "Continue um projeto existente" : "Continue an existing project", Icon: FolderOpen, onClick: () => setProjectPickerOpen(true) },
    { key: "create", label: c.create, hint: pt ? "Requisitos, cronograma e documentos" : "Requirements, schedule and documents", Icon: Plus, onClick: onCreateProject },
    { key: "meetings", label: c.meetings, hint: pt ? "Grave ou importe uma reunião" : "Record or import a meeting", Icon: MessageSquare, onClick: () => { window.location.hash = "#/meetings"; } },
    { key: "teams", label: c.teams, hint: pt ? "Setores, pessoas e alocação" : "Sectors, people and allocation", Icon: UsersRound, onClick: onOpenTeams }
  ];

  return (
    <div className="home-shell home-landing-shell">
      <main className="home-main">
        <section className="home-landing" aria-labelledby="norte-home-title">
          <header className="home-workspace-heading"><h1 id="norte-home-title">{firstName ? (pt ? `Olá, ${firstName}` : `Hello, ${firstName}`) : (pt ? "Seu espaço de trabalho" : "Your workspace")}</h1><span>{pt ? "Escolha onde continuar. Cada projeto reúne requisitos, cronograma, documentos e reuniões." : "Choose where to continue. Each project gathers requirements, schedule, documents and meetings."}</span></header>
          <div className="home-action-grid" aria-label={pt ? "Ações principais" : "Primary actions"}>
            {actions.map(action => <button key={action.key} className={`home-action-card accent-${action.key}`} type="button" onClick={action.onClick}>
              <span className="home-card-icon"><action.Icon aria-hidden="true" /></span>
              <span className="home-card-copy"><strong>{action.label}</strong><small>{action.hint}</small></span>
              <ArrowRight className="home-card-arrow" aria-hidden="true" />
            </button>)}
          </div>
          <div className="home-columns">
            <section className="home-panel home-recent" aria-labelledby="home-recent-title">
              <header><h2 id="home-recent-title">{pt ? "Projetos" : "Projects"}</h2><span>{projects.length} {pt ? projects.length === 1 ? "projeto" : "projetos" : projects.length === 1 ? "project" : "projects"}</span></header>
              {loadingProjects && !projects.length ? <p className="home-panel-empty"><LoaderCircle className="home-spin" size={16} aria-hidden="true" />{c.loading}</p> : !projects.length ? <div className="home-panel-empty"><strong>{c.empty}</strong><span>{c.emptyHint}</span><button type="button" onClick={onCreateProject}><Plus size={15} aria-hidden="true" />{c.create}</button></div>
                : <ul>{ordered.slice(0, 6).map(project => <li key={project.id}><button type="button" onClick={() => onOpenProject?.(project.id)}><span className="home-project-symbol"><FolderOpen size={18} aria-hidden="true" /></span><span className="home-project-copy"><strong>{project.name || c.untitled}</strong><small>{teamName(project)} · {c.updated} {date(project.updatedAt)}</small></span><ArrowRight size={16} aria-hidden="true" /></button></li>)}</ul>}
            </section>
            <section className="home-panel" aria-labelledby="home-continue-title">
              <header><h2 id="home-continue-title">{pt ? "Continuar de onde parou" : "Pick up where you left off"}</h2></header>
              {recent.length ? <RecentList items={recent} language={language} /> : <p className="home-panel-empty">{pt ? "Reuniões, atas, requisitos e documentos abertos nesta sessão aparecem aqui, com o tipo e a situação de cada um." : "Meetings, minutes, requirements and documents opened in this session appear here with their type and status."}</p>}
            </section>
          </div>
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
            ) : ordered.map((project) => <article className="home-project-picker-row" key={project.id}>
              <button className="home-project-open" type="button" onClick={() => { setProjectPickerOpen(false); onOpenProject?.(project.id); }}>
                <span className="home-project-symbol"><FolderOpen aria-hidden="true" /></span>
                <span className="home-project-copy"><strong>{project.name || c.untitled}</strong><small>{teamName(project)}</small></span>
                <span className="home-project-meta"><small>{project.memberCount} {project.memberCount === 1 ? c.member : c.members}</small><small>{c.updated} {date(project.updatedAt)}</small></span>
                <ArrowRight aria-hidden="true" />
              </button>
              <button className="home-project-delete" type="button" disabled={deletingId === project.id} onClick={() => void deleteProject(project.id)} title={c.delete} aria-label={`${c.delete}: ${project.name || c.untitled}`}>
                {deletingId === project.id ? <LoaderCircle className="home-spin" aria-hidden="true" /> : <Trash2 aria-hidden="true" />}
              </button>
            </article>)}
          </div>
        </section>
      </div>}
    </div>
  );
}
