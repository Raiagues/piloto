import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { ChevronDown, ChevronRight, Info, Maximize2, Minus, Plus, RotateCcw } from "lucide-react";
import type { EngineeringAnalysis, EngineeringEntity, EngineeringRelation, EngineeringSystemModel } from "../lib/engineeringSystem";
import { ENGINEERING_NODE_HEIGHT, ENGINEERING_NODE_WIDTH, engineeringCurve, engineeringInterfaceCurve, engineeringInitialScale, engineeringParentId, engineeringLabel, engineeringRelationDirectionLabel, formatEngineeringValue, layoutEngineeringGraph } from "../lib/engineeringUi";
import type { GraphPositions } from "../lib/engineeringUi";
import type { Language } from "../lib/types";

const MINIMAP_WIDTH = 172, MINIMAP_HEIGHT = 116;

type Props = {
  language: Language; model: EngineeringSystemModel; entities: EngineeringEntity[];
  selectedId?: string | null; highlightIds?: Set<string>; highlightRelationIds?: Set<string>; analysis?: EngineeringAnalysis | null;
  onSelect: (entity: EngineeringEntity) => void; onInfo: (entity: EngineeringEntity) => void;
  onToggleChildren?: (entity: EngineeringEntity) => void; expandedIds?: Set<string>; onClearSelection?: () => void;
  positions?: GraphPositions; onPositionsChange?: (positions: GraphPositions) => void;
  /** Layout is only rearranged in edit mode; reading the map never moves it. */
  editable?: boolean;

  onRelation: (relation: EngineeringRelation) => void;
};

export function SystemGraph({ language, model, entities, selectedId, highlightIds, highlightRelationIds, analysis, onSelect, onInfo, onToggleChildren, expandedIds, onClearSelection, onRelation, positions = {}, onPositionsChange, editable = false }: Props) {
  const graph = useMemo(() => layoutEngineeringGraph(model, entities, analysis), [model, entities, analysis]);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ width: 1000, height: 600 });
  const [navigation, setNavigation] = useState({ scale: 1, x: 30, y: 30 });
  const [manual, setManual] = useState<GraphPositions>(positions);
  const panRef = useRef<{ pointer: number; x: number; y: number; originX: number; originY: number } | null>(null);
  const dragRef = useRef<{ pointer: number; id: string; x: number; y: number; originX: number; originY: number; moved: boolean } | null>(null);
  const manualRef = useRef(manual);
  manualRef.current = manual;
  const markerId = useId().replaceAll(":", "");
  const { scale, x, y } = navigation;
  const nodes = graph.nodes.map((node) => ({ ...node, ...(manual[node.entity.id] ?? {}) }));
  const byId = new Map(nodes.map((node) => [node.entity.id, node]));
  const viewKey = entities.map((entity) => entity.id).join("|");
  function fit(fitNodes = nodes, initial = false) {
    if (!fitNodes.length) return;
    const left = Math.min(...fitNodes.map((node) => node.x)), top = Math.min(...fitNodes.map((node) => node.y));
    const width = Math.max(...fitNodes.map((node) => node.x)) - left + ENGINEERING_NODE_WIDTH;
    const height = Math.max(...fitNodes.map((node) => node.y)) - top + ENGINEERING_NODE_HEIGHT;
    const fitted = engineeringInitialScale(viewport, { width, height }, !initial);
    setNavigation({ scale: fitted, x: (viewport.width - width * fitted) / 2 - left * fitted, y: (viewport.height - height * fitted) / 2 - top * fitted });
  }
  useEffect(() => { fit(nodes, true); }, [viewKey, viewport.width, viewport.height]);
  useEffect(() => {
    if (!selectedId || analysis) return;
    const selected = nodes.find((node) => node.entity.id === selectedId);
    if (!selected) return;
    setNavigation((current) => {
      const left = current.x + selected.x * current.scale, top = current.y + selected.y * current.scale;
      if (left >= 16 && left + ENGINEERING_NODE_WIDTH * current.scale <= viewport.width - 16 && top >= 16 && top + ENGINEERING_NODE_HEIGHT * current.scale <= viewport.height - 60) return current;
      return { ...current, x: viewport.width / 2 - (selected.x + ENGINEERING_NODE_WIDTH / 2) * current.scale, y: viewport.height / 2 - (selected.y + ENGINEERING_NODE_HEIGHT / 2) * current.scale };
    });
  }, [selectedId, viewKey]);
  const statuses = new Map(analysis?.impacts.map((impact) => [impact.entityId, impact]));
  const pt = language === "pt";

  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return;
    const resize = () => setViewport({ width: node.clientWidth, height: node.clientHeight });
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  function zoom(factor: number, anchor?: { x: number; y: number }) {
    setNavigation((current) => {
      const next = Math.min(2.5, Math.max(.2, current.scale * factor));
      const pivotX = anchor?.x ?? viewport.width / 2, pivotY = anchor?.y ?? viewport.height / 2;
      return { scale: next, x: pivotX - (pivotX - current.x) * next / current.scale, y: pivotY - (pivotY - current.y) * next / current.scale };
    });
  }

  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = node.getBoundingClientRect();
      if (event.shiftKey) { setNavigation((current) => ({ ...current, x: current.x - event.deltaX - event.deltaY })); return; }
      const step = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaMode === 2 ? event.deltaY * rect.height : event.deltaY;
      zoom(Math.exp(-Math.max(-240, Math.min(240, step)) * .0022), { x: event.clientX - rect.left, y: event.clientY - rect.top });
    };
    node.addEventListener("wheel", wheel, { passive: false });
    return () => node.removeEventListener("wheel", wheel);
  }, [viewport.width, viewport.height]);

  function revealKeyboardFocus(target: HTMLElement, rect: { x: number; y: number; width: number; height: number }) {
    if (!target.matches(":focus-visible") || panRef.current || dragRef.current?.moved) return;
    const left = x + rect.x * scale; const right = left + rect.width * scale;
    const top = y + rect.y * scale; const bottom = top + rect.height * scale;
    const deltaX = left < 16 ? 16 - left : right > viewport.width - 16 ? viewport.width - 16 - right : 0;
    const deltaY = top < 50 ? 50 - top : bottom > viewport.height - 70 ? viewport.height - 70 - bottom : 0;
    if (deltaX || deltaY) setNavigation((current) => ({ ...current, x: current.x + deltaX, y: current.y + deltaY }));
  }

  const minimap = (() => {
    if (nodes.length < 2) return null;
    const worldLeft = -x / scale, worldTop = -y / scale;
    const left = Math.min(...nodes.map((node) => node.x), worldLeft) - 40, top = Math.min(...nodes.map((node) => node.y), worldTop) - 40;
    const right = Math.max(...nodes.map((node) => node.x + ENGINEERING_NODE_WIDTH), worldLeft + viewport.width / scale) + 40;
    const bottom = Math.max(...nodes.map((node) => node.y + ENGINEERING_NODE_HEIGHT), worldTop + viewport.height / scale) + 40;
    const ratio = Math.min(MINIMAP_WIDTH / (right - left), MINIMAP_HEIGHT / (bottom - top));
    return { left, top, ratio, offsetX: (MINIMAP_WIDTH - (right - left) * ratio) / 2, offsetY: (MINIMAP_HEIGHT - (bottom - top) * ratio) / 2 };
  })();
  const minimapRef = useRef(minimap);
  minimapRef.current = minimap;
  const minimapDragRef = useRef<{ pointer: number; map: NonNullable<typeof minimap> } | null>(null);

  function centerFromMinimap(event: ReactPointerEvent<HTMLDivElement>) {
    const map = minimapDragRef.current?.map ?? minimapRef.current;
    if (!map) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const worldX = map.left + (event.clientX - rect.left - map.offsetX) / map.ratio, worldY = map.top + (event.clientY - rect.top - map.offsetY) / map.ratio;
    setNavigation((current) => ({ ...current, x: viewport.width / 2 - worldX * current.scale, y: viewport.height / 2 - worldY * current.scale }));
  }

  return <div className="engineering-graph" ref={viewportRef} aria-label={pt ? "Arquitetura do sistema" : "System architecture"}
    onPointerDown={(event) => {
      if (event.button !== 0 || (event.target as HTMLElement).closest("button, a, [data-graph-control]")) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      panRef.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, originX: navigation.x, originY: navigation.y };
    }}
    onPointerMove={(event) => {
      const pan = panRef.current;
      if (pan?.pointer === event.pointerId) setNavigation((current) => ({ ...current, x: pan.originX + event.clientX - pan.x, y: pan.originY + event.clientY - pan.y }));
    }}
    onPointerUp={(event) => { const pan = panRef.current; if (pan && Math.hypot(event.clientX - pan.x, event.clientY - pan.y) < 4) onClearSelection?.(); panRef.current = null; }} onPointerCancel={() => { panRef.current = null; }}>
    <div className="engineering-world" style={{ width: Math.max(graph.width, ...nodes.map((node) => node.x + ENGINEERING_NODE_WIDTH + 100)), height: Math.max(graph.height, ...nodes.map((node) => node.y + ENGINEERING_NODE_HEIGHT + 100)), transform: `translate(${x}px, ${y}px) scale(${scale})` }}>
      <svg className="engineering-edges" width="100%" height="100%" aria-label={pt ? "Relações técnicas" : "Technical relationships"}>
        <defs><marker id={markerId} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="currentColor" /></marker></defs>
        {[...graph.containments.map((edge) => ({ id: edge.id, from: engineeringParentId(model, byId.get(edge.id)!.entity)!, to: edge.id })), ...graph.edges.filter((edge) => edge.relation.kind === "contains").map(({ relation }) => ({ id: relation.id, from: relation.from, to: relation.to }))].map(({ id, from, to }) => {
          const start = byId.get(from), end = byId.get(to);
          return start && end ? <g className={`engineering-edge structural ${highlightIds && (!highlightIds.has(from) || !highlightIds.has(to)) ? "dimmed" : ""}`} key={`parent:${id}`}><path d={engineeringCurve(start, end, 0, true).path} /></g> : null;
        })}
        {graph.edges.filter((edge) => edge.relation.kind !== "contains").map(({ relation, reversed }) => {
          const start = byId.get(reversed ? relation.to : relation.from)!, end = byId.get(reversed ? relation.from : relation.to)!;
          const peers = graph.edges.filter((edge) => edge.relation.kind !== "contains" && [relation.from, relation.to].includes(edge.relation.from) && [relation.from, relation.to].includes(edge.relation.to));
          const route = engineeringInterfaceCurve(start, end, peers.length > 1 ? Math.max(-40, Math.min(40, (peers.findIndex((edge) => edge.relation.id === relation.id) - (peers.length - 1) / 2) * 28)) : 0, nodes.filter((node) => node.entity.id !== start.entity.id && node.entity.id !== end.entity.id));
          const middle = route.label;
          const dim = highlightIds && !(highlightRelationIds?.has(relation.id) || highlightIds.has(relation.from) && highlightIds.has(relation.to));
          const targetStatus = statuses.get(reversed ? relation.from : relation.to)?.status;
          return <g key={relation.id} className={`engineering-edge ${relation.source === "inferred" ? "inferred" : ""} ${dim ? "dimmed" : ""} ${targetStatus ? `status-${targetStatus}` : ""}`}>
            <path d={route.path} markerEnd={`url(#${markerId})`} />
            <foreignObject x={middle.x - 72} y={middle.y - 12} width="144" height="24">
              <button type="button" className="engineering-edge-label" onFocus={(event) => revealKeyboardFocus(event.currentTarget, { x: middle.x - 72, y: middle.y - 12, width: 144, height: 24 })} onClick={() => onRelation(relation)} title={`${engineeringLabel(relation.kind, language)} · ${engineeringLabel(relation.source, language)}`} aria-label={`${pt ? "Inspecionar relação" : "Inspect relationship"}: ${model.entities.find((entity) => entity.id === relation.from)?.name} → ${model.entities.find((entity) => entity.id === relation.to)?.name}, ${engineeringLabel(relation.kind, language)}`}>
                {engineeringRelationDirectionLabel(relation.kind, reversed, language)}{relation.source === "inferred" ? " · ?" : ""}
              </button>
            </foreignObject>
          </g>;
        })}
      </svg>
      {nodes.map(({ entity, x: nodeX, y: nodeY }) => {
        const impact = statuses.get(entity.id);
        const changed = entity.id === analysis?.changedEntityId;
        const properties = entity.properties.filter((property) => property.key !== "formula").sort((first, second) => changed ? Number(analysis.change.newValues.some((property) => property.key === second.key)) - Number(analysis.change.newValues.some((property) => property.key === first.key)) : Number(second.source === "calculated") - Number(first.source === "calculated"));
        const childCount = model.entities.filter((child) => engineeringParentId(model, child) === entity.id).length;
        const hasChildren = childCount > 0;
        const name = changed && analysis.change.replacementName ? analysis.change.replacementName : entity.name;
        return <article className={`engineering-node kind-${entity.kind} ${editable ? "editable" : ""} ${selectedId === entity.id ? "selected" : selectedId && !analysis ? "context-node" : ""} ${impact ? `status-${impact.status}` : ""} ${highlightIds && !highlightIds.has(entity.id) ? "dimmed" : ""}`} key={entity.id} style={{ left: nodeX, top: nodeY, width: ENGINEERING_NODE_WIDTH, height: ENGINEERING_NODE_HEIGHT }} data-entity-id={entity.id}
          onPointerDown={(event) => {
            if (!editable || event.button !== 0 || (event.target as HTMLElement).closest(".engineering-node-info,.engineering-node-expand")) return;
            event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId);
            dragRef.current = { pointer: event.pointerId, id: entity.id, x: event.clientX, y: event.clientY, originX: nodeX, originY: nodeY, moved: false };
          }}
          onPointerMove={(event) => {
            const drag = dragRef.current;
            if (!drag || drag.pointer !== event.pointerId || drag.id !== entity.id) return;
            const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
            if (!drag.moved && Math.hypot(dx, dy) < 4) return;
            drag.moved = true;
            const next = { ...manualRef.current, [entity.id]: { x: Math.max(0, drag.originX + dx / scale), y: Math.max(0, drag.originY + dy / scale) } };
            manualRef.current = next; setManual(next);
          }}
          onPointerUp={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
            if (dragRef.current?.id === entity.id) { if (dragRef.current.moved) onPositionsChange?.(manualRef.current); onSelect(entity); dragRef.current = null; }
          }}
          onPointerCancel={() => { if (dragRef.current?.moved) onPositionsChange?.(manualRef.current); dragRef.current = null; }}
          onKeyDown={(event) => {
            if (!editable || !event.altKey || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
            event.preventDefault();
            const next = { ...manualRef.current, [entity.id]: { x: Math.max(0, nodeX + (event.key === "ArrowRight" ? 20 : event.key === "ArrowLeft" ? -20 : 0)), y: Math.max(0, nodeY + (event.key === "ArrowDown" ? 20 : event.key === "ArrowUp" ? -20 : 0)) } };
            setManual(next); onPositionsChange?.(next);
          }} onFocusCapture={(event) => revealKeyboardFocus(event.target as HTMLElement, { x: nodeX, y: nodeY, width: ENGINEERING_NODE_WIDTH, height: ENGINEERING_NODE_HEIGHT })}>
          <button className="engineering-node-main" type="button" aria-pressed={selectedId === entity.id} onClick={() => { if (!dragRef.current?.moved) onSelect(entity); }} title={editable ? pt ? "Arraste para mover. Alt + setas também move." : "Drag to move. Alt + arrows also moves." : undefined}>
            <span className="engineering-node-kind">{engineeringLabel(entity.kind, language)}{impact && <em>{engineeringLabel(impact.status, language)}</em>}</span>
            <strong>{name}</strong>
            <span className="engineering-node-values">{properties.slice(0, impact?.calculation ? 1 : 2).map((property) => <span key={property.key} title={`${property.name}: ${formatEngineeringValue(property)}`}>{!property.unit && typeof property.value === "number" ? `${property.name}: ` : ""}{formatEngineeringValue({ ...property, value: typeof property.value === "number" ? Number(property.value.toPrecision(5)) : property.value })}</span>)}{!properties.length && !hasChildren && <span>{entity.properties.some((property) => property.key === "formula") ? pt ? "Cálculo a avaliar" : "Calculation to evaluate" : pt ? "Dados a confirmar" : "Data to confirm"}</span>}</span>
            {impact?.calculation && <span className="engineering-node-equation" title={impact.calculation.expression}>{impact.calculation.expression}</span>}
          </button>
          {hasChildren && onToggleChildren && <button type="button" className="engineering-node-expand" onClick={() => onToggleChildren(entity)} aria-expanded={expandedIds?.has(entity.id) ?? false} aria-label={`${expandedIds?.has(entity.id) ? pt ? "Recolher" : "Collapse" : pt ? "Expandir" : "Expand"} ${entity.name}`}>{expandedIds?.has(entity.id) ? <ChevronDown /> : <ChevronRight />}<span>{childCount} {pt ? "elementos" : "elements"}</span></button>}
          <button type="button" className="engineering-node-info" aria-label={`${pt ? "Informações de" : "Information about"} ${entity.name}`} onClick={() => onInfo(entity)}><Info aria-hidden="true" /></button>
        </article>;
      })}
    </div>
    {!entities.length && <div className="engineering-graph-empty">{pt ? "Nenhuma entidade vinculada a este recorte." : "No entities are linked to this view."}</div>}
    {minimap && <div className="engineering-minimap" data-graph-control aria-hidden="true" style={{ width: MINIMAP_WIDTH, height: MINIMAP_HEIGHT }} title={pt ? "Mapa da arquitetura. Clique ou arraste para navegar." : "Architecture map. Click or drag to navigate."}
      onPointerDown={(event) => { if (event.button !== 0) return; event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); minimapDragRef.current = { pointer: event.pointerId, map: minimap }; centerFromMinimap(event); }}
      onPointerMove={(event) => { if (minimapDragRef.current?.pointer === event.pointerId) centerFromMinimap(event); }}
      onPointerUp={() => { minimapDragRef.current = null; }} onPointerCancel={() => { minimapDragRef.current = null; }}>
      {nodes.map(({ entity, x: nodeX, y: nodeY }) => <i key={entity.id} className={`kind-${entity.kind}${selectedId === entity.id ? " selected" : ""}`} style={{ left: minimap.offsetX + (nodeX - minimap.left) * minimap.ratio, top: minimap.offsetY + (nodeY - minimap.top) * minimap.ratio, width: Math.max(4, ENGINEERING_NODE_WIDTH * minimap.ratio), height: Math.max(3, ENGINEERING_NODE_HEIGHT * minimap.ratio) }} />)}
      <span style={{ left: minimap.offsetX + (-x / scale - minimap.left) * minimap.ratio, top: minimap.offsetY + (-y / scale - minimap.top) * minimap.ratio, width: viewport.width / scale * minimap.ratio, height: viewport.height / scale * minimap.ratio }} />
    </div>}
    <div className="engineering-navigation" data-graph-control role="group" aria-label={pt ? "Navegação do grafo" : "Graph navigation"}>
      <button type="button" aria-label={pt ? "Afastar" : "Zoom out"} onClick={() => zoom(1 / 1.2)}><Minus aria-hidden="true" /></button>
      <output>{Math.round(scale * 100)}%</output>
      <button type="button" aria-label={pt ? "Aproximar" : "Zoom in"} onClick={() => zoom(1.2)}><Plus aria-hidden="true" /></button>
      <button type="button" aria-label={pt ? "Enquadrar sistema" : "Fit system"} onClick={() => fit()}><Maximize2 aria-hidden="true" /></button>
      {editable && <button type="button" aria-label={pt ? "Restaurar organização" : "Reset layout"} onClick={() => { setManual({}); manualRef.current = {}; onPositionsChange?.({}); fit(graph.nodes); }}><RotateCcw aria-hidden="true" /></button>}
    </div>
    {analysis && <div className="engineering-legend" aria-label={pt ? "Legenda de impacto" : "Impact legend"}>{["changed", "valid", "review", "critical"].map((status) => <span key={status} className={`status-${status}`}><i />{engineeringLabel(status, language)}</span>)}</div>}
  </div>;
}
