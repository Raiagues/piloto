import { ChevronDown, ChevronRight, Component, Layers, Network } from "lucide-react";
import type { EngineeringSystemModel } from "../lib/engineeringSystem";
import { engineeringLabel, engineeringParentId } from "../lib/engineeringUi";
import type { Language } from "../lib/types";

export function EngineeringExplorer({ model, language, selectedId, expandedIds, onToggle, onSelect, onOverview }: {
  model: EngineeringSystemModel; language: Language; selectedId: string | null;
  expandedIds: Set<string>; onToggle: (id: string) => void;
  onSelect: (id: string) => void; onOverview: () => void;
}) {
  const pt = language === "pt";
  const entities = model.entities;
  function branch(parent: string | undefined, depth = 0, visited = new Set<string>()): React.ReactNode {
    return entities.filter((entity) => (engineeringParentId(model, entity) || undefined) === parent && !visited.has(entity.id)).map((entity) => {
      const children = entities.filter((child) => engineeringParentId(model, child) === entity.id);
      const open = expandedIds.has(entity.id);
      const Icon = entity.kind === "system" ? Network : entity.kind === "subsystem" ? Layers : Component;
      return <div className="engineering-tree-branch" key={entity.id}>
        <div className={`engineering-tree-row ${selectedId === entity.id ? "active" : ""}`} style={{ paddingLeft: 10 + depth * 14 }}>
          {children.length ? <button type="button" className="engineering-tree-toggle" aria-label={`${pt ? "Expandir ou recolher" : "Expand or collapse"} ${entity.name}`} aria-expanded={open} onClick={() => onToggle(entity.id)}>{open ? <ChevronDown /> : <ChevronRight />}</button> : <span className="engineering-tree-spacer" />}
          <button type="button" aria-current={selectedId === entity.id ? "true" : undefined} onClick={() => onSelect(entity.id)} title={entity.name}><Icon /><span><strong>{entity.name}</strong><small>{engineeringLabel(entity.kind, language)}</small></span>{children.length > 0 && <em>{children.length}</em>}</button>
        </div>
        {open && branch(entity.id, depth + 1, new Set([...visited, entity.id]))}
      </div>;
    });
  }
  return <aside className="engineering-explorer" aria-label={pt ? "Hierarquia do sistema" : "System hierarchy"}>
    <header><span>{pt ? "ARQUITETURA" : "ARCHITECTURE"}</span><small>{entities.length} {pt ? "elementos" : "elements"}</small></header>
    <button type="button" className="engineering-overview-link" onClick={onOverview}><Network />{pt ? "Visão geral" : "Overview"}</button>
    <nav>{branch(undefined)}</nav>
  </aside>;
}
