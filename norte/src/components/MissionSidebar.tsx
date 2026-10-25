import { Brand } from "./Brand";
import { FolderKanban, Home, UsersRound, MessageSquare } from "lucide-react";
import { PROJECT_RAIL, railLabel } from "../lib/projectRail";
import type { ProjectSummary } from "../lib/team";
import type { Language } from "../lib/types";

type Props = {
  language: Language;
  expanded: boolean;
  homeLabel: string;
  teamLabel: string;
  homeActive: boolean;
  teamActive: boolean;
  meetingsActive?: boolean;
  onMeetings?: () => void;
  projects: ProjectSummary[];
  projectTeamName: string;
  activeProjectId: string;
  loadingProjects?: boolean;
  projectLoadFailed?: boolean;
  onToggle: () => void;
  onHome: () => void;
  onTeam: () => void;
  onProjectSelect: (projectId: string) => void;
  activeArea: string | null;
  onAreaSelect: (area: "documents" | "requirements" | "verification" | "schedule") => void;
};

function LockIcon() {
  return <svg viewBox="0 0 12 12" aria-hidden="true"><rect x="2.2" y="5.1" width="7.6" height="5.1" rx="1" /><path d="M3.8 5.1V3.7a2.2 2.2 0 0 1 4.4 0v1.4" /></svg>;
}

export function MissionSidebar({ language, expanded, homeLabel, teamLabel, homeActive, teamActive, meetingsActive, onMeetings, projects, projectTeamName, activeProjectId, loadingProjects = false, projectLoadFailed = false, onToggle, onHome, onTeam, onProjectSelect, activeArea, onAreaSelect }: Props) {
  const stateWords = language === "pt" ? { complete: "Concluída", current: "Fase atual", available: "Disponível", locked: "Ainda não disponível" } : { complete: "Complete", current: "Current phase", available: "Available", locked: "Not available yet" };
  const contextWords = language === "pt" ? { project: "Projeto ativo", team: "Equipe", noneProject: "Nenhum projeto", noneTeam: "Nenhuma equipe", switcher: "Trocar projeto" } : { project: "Active project", team: "Team", noneProject: "No project", noneTeam: "No team", switcher: "Switch project" };

  return (
    <>
      <aside className={expanded ? "mission-sidebar expanded" : "mission-sidebar collapsed"} aria-label={language === "pt" ? "Navegação da missão" : "Mission navigation"}>
        <div className="mission-sidebar-header">
          <Brand />
          <button className="mission-sidebar-toggle" type="button" onClick={onToggle} aria-label={expanded ? (language === "pt" ? "Recolher barra lateral" : "Collapse sidebar") : (language === "pt" ? "Expandir barra lateral" : "Expand sidebar")} aria-expanded={expanded}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d={expanded ? "m12.5 5-5 5 5 5" : "m7.5 5 5 5-5 5"} /></svg>
          </button>
        </div>

        <button className={homeActive ? "mission-sidebar-home active" : "mission-sidebar-home"} type="button" onClick={onHome} title={!expanded ? homeLabel : undefined}>
          <span className="mission-sidebar-home-icon"><Home aria-hidden="true" /></span>
          <span className="mission-sidebar-home-label">{homeLabel}</span>
        </button>

        <button className={teamActive ? "mission-sidebar-home mission-sidebar-team active" : "mission-sidebar-home mission-sidebar-team"} type="button" onClick={onTeam} title={!expanded ? teamLabel : undefined}>
          <span className="mission-sidebar-home-icon"><UsersRound aria-hidden="true" /></span>
          <span className="mission-sidebar-home-label">{teamLabel}</span>
        </button>

        <div className="mission-sidebar-divider" />

        {onMeetings && <button className={meetingsActive ? "mission-sidebar-home active" : "mission-sidebar-home"} type="button" onClick={onMeetings} title={language === "pt" ? "Reuniões" : "Meetings"} aria-current={meetingsActive ? "page" : undefined}>
          <span className="mission-sidebar-home-icon"><MessageSquare aria-hidden="true" /></span>
          <span className="mission-sidebar-home-label">{language === "pt" ? "Reuniões" : "Meetings"}</span>
        </button>}

        {expanded ? <section className="mission-context-switcher" aria-label={contextWords.switcher}>
          <label><span>{contextWords.project}</span><select value={activeProjectId} onChange={(event) => event.target.value && onProjectSelect(event.target.value)} aria-busy={loadingProjects}><option value="">{loadingProjects ? language === 'pt' ? 'Carregando projetos…' : 'Loading projects…' : projectLoadFailed ? language === 'pt' ? 'Carregamento pendente' : 'Loading incomplete' : projects.length ? language === 'pt' ? 'Escolha um projeto' : 'Choose a project' : contextWords.noneProject}</option>{projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}</select></label>
          <div className="mission-project-team"><span>{contextWords.team}</span><strong>{projectTeamName || contextWords.noneTeam}</strong></div>
        </section> : <button className="mission-context-compact" type="button" onClick={onToggle} title={contextWords.switcher} aria-label={contextWords.switcher}><FolderKanban aria-hidden="true" /></button>}

        <div className="mission-sidebar-divider context-divider" />

        <nav className="mission-pipeline" aria-label={language === "pt" ? "Navegação do projeto" : "Project navigation"}>
          {PROJECT_RAIL.map((item) => {
            const label = railLabel(item, language);
            const locked = !activeProjectId;
            const current = !locked && activeArea === item.area;
            const state = current ? "current" : locked ? "locked" : "available";
            const stateLabel = stateWords[state];
            return (
              <button className={`mission-phase ${state}`} key={item.key} type="button" aria-current={current ? "page" : undefined} disabled={locked} aria-disabled={locked || current} tabIndex={locked ? -1 : 0}
                onClick={() => { if (locked || current) return; onAreaSelect(item.area); }}
                title={label} aria-label={`${label} · ${stateLabel}`}>
                <span className="mission-phase-rail" />
                <span className="mission-phase-icon">
                  <item.Icon aria-hidden="true" />
                  {locked && <span className="mission-phase-lock"><LockIcon /></span>}
                </span>
                <span className="mission-phase-copy">
                  <span>{label}</span>
                </span>
              </button>
            );
          })}
        </nav>

      </aside>
      <button className={expanded ? "mission-sidebar-overlay visible" : "mission-sidebar-overlay"} type="button" aria-label={language === "pt" ? "Recolher barra lateral" : "Collapse sidebar"} onClick={onToggle} />
    </>
  );
}
