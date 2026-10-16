import { ProjectHeader } from "../components/ProjectHeader";
import type { RailNavigation } from "../components/ProjectHeader";
import { SystemWorkspace } from "./SystemWorkspace";
import type { MissionProject } from "../lib/projectStore";
import type { Language } from "../lib/types";

type Props = {
  language: Language; project: MissionProject; t: (path: string) => string;
  onLanguageChange: (language: Language) => void;
  onProjectChange: (project: MissionProject) => void; onHome: () => void; onBackSetup: () => void;
  navigation: RailNavigation;
};

export function BrainstormPage({ language, project, onProjectChange, onBackSetup, navigation }: Props) {
  return <div className="brain-shell brain-v2 engineering-conception">
    <main className="brain-main">

      <section className="brain-workspace">
        <ProjectHeader language={language} current="conception" projectName={project.name} navigation={navigation} />
        <div className="conception-workspace-content">
          {/* Remounting on a changed architecture re-derives which branches are open. */}
          <SystemWorkspace key={`${project.id}:${project.engineeringSystem?.id ?? "manual"}`} language={language} project={project} onProjectChange={onProjectChange} onBackSetup={onBackSetup} />
        </div>
      </section>
    </main>
  </div>;
}
