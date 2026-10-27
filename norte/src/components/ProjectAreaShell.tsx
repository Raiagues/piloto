import type { ReactNode } from "react";
import type { MissionProject } from "../lib/projectStore";
import type { RailKey } from "../lib/projectRail";
import type { Language } from "../lib/types";

export type RailNavigation = { onOpen: (key: RailKey) => void };
type Props = { language: Language; project: MissionProject; area: RailKey; navigation: RailNavigation; children: ReactNode };

/** The application header already names team, project and area; the page starts with its work. */
export function ProjectAreaShell({ area, children }: Props) {
  return <section className={`project-area project-area-${area}`}><div className="project-area-body">{children}</div></section>;
}
