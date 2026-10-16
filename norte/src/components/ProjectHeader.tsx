import type { ReactNode } from "react";
import { ArrowLeft, ArrowRight, Lock, Waypoints } from "lucide-react";
import { PROJECT_RAIL, railLabel, railNeighbour } from "../lib/projectRail";
import type { RailKey } from "../lib/projectRail";
import type { Language } from "../lib/types";

export type RailNavigation = { onOpen: (key: RailKey) => void; onOpenDiscovery: () => void; discoveryOpen: boolean };

/**
 * The same head on every project page: where you are, where the project came
 * from, where it goes next — in the rail's own order — and the tool that reads
 * a change against all of it.
 */
export function ProjectHeader({ language, current, projectName, extra, navigation }: {
  language: Language; current: RailKey; projectName: string; extra?: ReactNode; navigation: RailNavigation;
}) {
  const pt = language === "pt";
  const title = railLabel(PROJECT_RAIL.find((stop) => stop.key === current)!, language);
  const previous = railNeighbour(current, -1);
  const next = railNeighbour(current, 1);
  const c = pt
    ? { previous: "Fase anterior", next: "Próxima fase", soon: "Em breve", explore: "Testar ideias" }
    : { previous: "Previous phase", next: "Next phase", soon: "Coming soon", explore: "Test ideas" };

  return <header className="project-head">
    <div className="project-head-titles">
      <div className="project-head-breadcrumb"><span>{projectName}</span><span>›</span><strong>{title}</strong></div>
      <h1>{title}</h1>
    </div>
    <div className="project-head-actions">
      {extra}
      {previous && <button type="button" className="phase-step" onClick={() => navigation.onOpen(previous.key)}>
        <ArrowLeft aria-hidden="true" /><span><small>{c.previous}</small>{railLabel(previous, language)}</span>
      </button>}
      {next && (next.upcoming
        ? <button type="button" className="phase-step disabled" disabled title={c.soon}><span><small>{c.next}</small>{railLabel(next, language)}</span><em>{c.soon}</em><Lock aria-hidden="true" /></button>
        : <button type="button" className="phase-step" onClick={() => navigation.onOpen(next.key)}>
          <span><small>{c.next}</small>{railLabel(next, language)}</span><ArrowRight aria-hidden="true" />
        </button>)}
      <button type="button" className={`explore-impact-action${navigation.discoveryOpen ? " open" : ""}`} onClick={navigation.onOpenDiscovery} aria-pressed={navigation.discoveryOpen} title={c.explore}>
        <Waypoints aria-hidden="true" />{c.explore}
      </button>
    </div>
  </header>;
}
