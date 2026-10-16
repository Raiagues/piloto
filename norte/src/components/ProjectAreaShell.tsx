import type { ReactNode } from "react";
import { ProjectHeader } from "./ProjectHeader";
import type { RailNavigation } from "./ProjectHeader";
import type { RailKey } from "../lib/projectRail";
import type { MissionProject } from "../lib/projectStore";
import type { Language } from "../lib/types";

type Props = {
  language: Language; project: MissionProject; area: RailKey;
  navigation: RailNavigation; counter?: string; actions?: ReactNode; children: ReactNode;
};

export function ProjectAreaShell({ language, project, area, navigation, counter, actions, children }: Props) {
  return <section className="project-area">
    <ProjectHeader language={language} current={area} projectName={project.name} navigation={navigation}
      extra={<>{counter && <span className="project-area-counter">{counter}</span>}{actions}</>} />
    <div className="project-area-body">{children}</div>
  </section>;
}
