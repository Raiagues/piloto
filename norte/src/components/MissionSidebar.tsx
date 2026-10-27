import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ChevronsLeft, ChevronsRight, ExternalLink, FolderKanban, FolderTree, Home, MessageSquare, Plus, UsersRound } from "lucide-react";
import { Brand } from "./Brand";
import { PROJECT_RAIL, railLabel } from "../lib/projectRail";
import type { ProjectArea } from "../lib/workspaceRoutes";
import type { RequirementsOutline } from "../lib/requirementsOutline";
import type { ProjectSummary } from "../lib/team";
import type { Language } from "../lib/types";

type Props = {
  language: Language;
  expanded: boolean;
  route: string;
  projects: ProjectSummary[];
  teams: { id: string; name: string }[];
  activeProjectId: string;
  activeProjectName: string;
  activeTeam: { id: string; name: string } | null;
  loadingProjects?: boolean;
  projectLoadFailed?: boolean;
  outline?: RequirementsOutline | null;
  subsystem?: string;
  onToggle: () => void;
  onNavigate: (hash: string) => void;
  onProjectSelect: (projectId: string) => void;
  onAreaSelect: (area: ProjectArea) => void;
  onSubsystemSelect: (id: string) => void;
};

/** Global places first, then one project context: its name is plain text until clicked. */
function ProjectSwitcher({ language, expanded, projects, teams, activeProjectId, activeProjectName, activeTeam, loadingProjects, projectLoadFailed, onExpand, onNavigate, onProjectSelect }: Pick<Props, "language" | "expanded" | "projects" | "teams" | "activeProjectId" | "activeProjectName" | "activeTeam" | "loadingProjects" | "projectLoadFailed" | "onNavigate" | "onProjectSelect"> & { onExpand: () => void }) {
  const pt = language === "pt", [open, setOpen] = useState(false), root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => { if (event instanceof KeyboardEvent ? event.key === "Escape" : !root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", close); document.addEventListener("keydown", close);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", close); };
  }, [open]);
  const groups = [...teams.filter(team => projects.some(project => project.teamId === team.id)).map(team => ({ id: team.id, name: team.name, projects: projects.filter(project => project.teamId === team.id) })),
    ...(projects.some(project => !project.teamId || !teams.some(team => team.id === project.teamId)) ? [{ id: "", name: pt ? "Outros projetos" : "Other projects", projects: projects.filter(project => !project.teamId || !teams.some(team => team.id === project.teamId)) }] : [])];
  const empty = loadingProjects ? (pt ? "Carregando projetos…" : "Loading projects…") : projectLoadFailed ? (pt ? "Projetos indisponíveis" : "Projects unavailable") : (pt ? "Nenhum projeto ainda" : "No projects yet");
  const label = pt ? "Trocar projeto" : "Switch project";
  return <div className="project-switcher" ref={root}>
    {expanded ? <button type="button" className="project-switcher-trigger" aria-haspopup="listbox" aria-expanded={open} aria-label={`${label}: ${activeProjectName || empty}`} onClick={() => setOpen(value => !value)}>
      <span className="project-switcher-copy"><strong>{activeProjectName || (projects.length ? (pt ? "Escolha um projeto" : "Choose a project") : empty)}</strong>{activeTeam && <small>{activeTeam.name}</small>}</span>
      <ChevronDown size={15} aria-hidden="true" />
    </button> : <button type="button" className="mission-nav-item" title={activeProjectName || label} aria-label={label} onClick={() => { onExpand(); setOpen(true); }}><span className="mission-nav-icon"><FolderKanban aria-hidden="true" /></span></button>}
    {open && expanded && <div className="project-switcher-menu" role="listbox" aria-label={label}>
      {groups.length ? groups.map(group => <section key={group.id || "other"}>
        <header><span>{group.name}</span>{group.id && <a href={`#/teams?team=${encodeURIComponent(group.id)}`} onClick={event => { event.preventDefault(); setOpen(false); onNavigate(`#/teams?team=${encodeURIComponent(group.id)}`); }} title={pt ? "Abrir página da equipe" : "Open team page"}><ExternalLink size={12} aria-hidden="true" />{pt ? "Equipe" : "Team"}</a>}</header>
        {group.projects.map(project => <button type="button" role="option" aria-selected={project.id === activeProjectId} key={project.id} onClick={() => { setOpen(false); if (project.id !== activeProjectId) onProjectSelect(project.id); else onNavigate("#/project"); }}>
          <FolderKanban size={15} aria-hidden="true" /><span>{project.name || (pt ? "Projeto sem nome" : "Untitled project")}</span>{project.id === activeProjectId && <Check size={14} aria-hidden="true" />}
        </button>)}
      </section>) : <p>{empty}</p>}
      <footer><button type="button" onClick={() => { setOpen(false); onNavigate("#/new-project"); }}><Plus size={14} aria-hidden="true" />{pt ? "Novo projeto" : "New project"}</button></footer>
    </div>}
  </div>;
}

export function MissionSidebar(props: Props) {
  const { language, expanded, route, activeProjectId, activeTeam, outline, subsystem = "", onToggle, onNavigate, onAreaSelect, onSubsystemSelect } = props;
  const pt = language === "pt";
  const global = [
    { key: "home", hash: "#/", label: pt ? "Início" : "Home", Icon: Home },
    { key: "teams", hash: activeTeam ? `#/teams?team=${encodeURIComponent(activeTeam.id)}` : "#/teams", label: pt ? "Equipes" : "Teams", Icon: UsersRound },
    { key: "meetings", hash: "#/meetings", label: pt ? "Reuniões" : "Meetings", Icon: MessageSquare }
  ];
  const showOutline = expanded && route === "requirements" && outline?.projectId === activeProjectId && outline.groups.length > 0;
  return (
    <>
      <aside className={expanded ? "mission-sidebar expanded" : "mission-sidebar collapsed"} aria-label={pt ? "Navegação principal" : "Main navigation"}>
        <div className="mission-sidebar-header">
          <Brand language={language} />
          <button className="mission-sidebar-toggle" type="button" onClick={onToggle} aria-label={expanded ? (pt ? "Recolher barra lateral" : "Collapse sidebar") : (pt ? "Expandir barra lateral" : "Expand sidebar")} aria-expanded={expanded}>
            {expanded ? <ChevronsLeft size={17} aria-hidden="true" /> : <ChevronsRight size={17} aria-hidden="true" />}
          </button>
        </div>
        <nav className="mission-sidebar-scroll" aria-label={pt ? "Áreas" : "Areas"}>
          <div className="mission-nav-group">
            {global.map(item => <button key={item.key} type="button" className={route === item.key ? "mission-nav-item active" : "mission-nav-item"} aria-current={route === item.key ? "page" : undefined} title={!expanded ? item.label : undefined} onClick={() => onNavigate(item.hash)}>
              <span className="mission-nav-icon"><item.Icon aria-hidden="true" /></span><span className="mission-nav-label">{item.label}</span>
            </button>)}
          </div>
          <div className="mission-nav-group mission-project-group">
            {expanded && <span className="mission-nav-heading">{pt ? "Projeto" : "Project"}</span>}
            <ProjectSwitcher {...props} onExpand={onToggle} />
            {PROJECT_RAIL.map(item => {
              const label = railLabel(item, language), locked = !activeProjectId, current = !locked && route === item.area;
              return <div key={item.key} className="mission-nav-branch">
                <button className={`mission-nav-item mission-phase${current ? " active current" : ""}${locked ? " locked" : ""}`} type="button" aria-current={current ? "page" : undefined} disabled={locked}
                  onClick={() => { if (item.area === "requirements" && current) onSubsystemSelect(""); else onAreaSelect(item.area); }} title={!expanded ? label : locked ? (pt ? "Escolha um projeto primeiro" : "Choose a project first") : undefined}>
                  <span className="mission-nav-icon"><item.Icon aria-hidden="true" /></span><span className="mission-nav-label">{label}</span>
                  {item.area === "requirements" && expanded && outline?.projectId === activeProjectId && <small className="mission-nav-count">{outline.total}</small>}
                </button>
                {item.area === "requirements" && showOutline && <div className="mission-outline" role="group" aria-label={pt ? "Requisitos por subsistema" : "Requirements by subsystem"}>
                  <button type="button" aria-current={!subsystem ? "true" : undefined} onClick={() => onSubsystemSelect("")}><FolderTree size={14} aria-hidden="true" /><span>{pt ? "Todos os requisitos" : "All requirements"}</span><small>{outline!.total}</small></button>
                  {outline!.groups.map(group => <button type="button" key={group.id} aria-current={subsystem === group.id ? "true" : undefined} onClick={() => onSubsystemSelect(group.id)}><span className="mission-outline-dot" aria-hidden="true" /><span>{group.name}</span><small>{group.count}</small></button>)}
                </div>}
              </div>;
            })}
          </div>
        </nav>
      </aside>
      <button className={expanded ? "mission-sidebar-overlay visible" : "mission-sidebar-overlay"} type="button" tabIndex={expanded ? 0 : -1} aria-label={pt ? "Fechar navegação" : "Close navigation"} onClick={onToggle} />
    </>
  );
}
