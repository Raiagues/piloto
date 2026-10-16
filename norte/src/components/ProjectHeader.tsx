import type { ReactNode } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { PROJECT_RAIL, railLabel, railNeighbour } from '../lib/projectRail';
import type { RailKey } from '../lib/projectRail';
import type { Language } from '../lib/types';
export type RailNavigation = { onOpen: (key: RailKey) => void; onOpenDiscovery: () => void; discoveryOpen: boolean };
export function ProjectHeader({ language, current, extra, navigation }: {
  language: Language; current: RailKey; projectName: string; extra?: ReactNode; navigation: RailNavigation;
}) {
  const title=railLabel(PROJECT_RAIL.find(stop=>stop.key===current)!,language),previous=railNeighbour(current,-1),next=railNeighbour(current,1);
  return <header className="project-head compact-project-head"><h1>{title}</h1><div className="project-head-actions">{extra}
    {previous&&<button type="button" className="phase-step" onClick={()=>navigation.onOpen(previous.key)} title={railLabel(previous,language)} aria-label={`${language==='pt'?'Ir para':'Go to'} ${railLabel(previous,language)}`}><ArrowLeft size={16}/><span>{railLabel(previous,language)}</span></button>}
    {next&&!next.upcoming&&<button type="button" className="phase-step" onClick={()=>navigation.onOpen(next.key)} title={railLabel(next,language)} aria-label={`${language==='pt'?'Ir para':'Go to'} ${railLabel(next,language)}`}><span>{railLabel(next,language)}</span><ArrowRight size={16}/></button>}
  </div></header>;
}
