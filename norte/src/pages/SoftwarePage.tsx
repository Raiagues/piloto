import { useEffect, useMemo, useRef, useState } from "react";
import { FolderGit2, Pencil, Check, RotateCcw } from "lucide-react";
import { ProjectAreaShell } from "../components/ProjectAreaShell";
import type { RailNavigation } from "../components/ProjectHeader";
import type { MissionProject } from "../lib/projectStore";
import type { Language } from "../lib/types";

type Placement = Record<string, { x: number; y: number }>;
const APP_WIDTH = 148, APP_HEIGHT = 62, APP_GAP = 12;

/** Core services every flight system runs, whatever its apps are. */
const CORE = [
  { id: "bus", pt: "Barramento", en: "Software bus", ptRole: "Troca de mensagens entre apps", enRole: "Message exchange between apps", wide: true },
  { id: "exec", pt: "Execução", en: "Executive", ptRole: "Inicialização e modos", enRole: "Startup and modes", wide: false },
  { id: "events", pt: "Eventos", en: "Events", ptRole: "Registro e alarmes", enRole: "Logging and alarms", wide: false },
  { id: "tables", pt: "Tabelas", en: "Tables", ptRole: "Parâmetros e configuração", enRole: "Parameters and configuration", wide: false },
  { id: "time", pt: "Tempo", en: "Time", ptRole: "Relógio e sincronismo", enRole: "Clock and synchronisation", wide: false }
];

/** Each app is named after a real part of this project's architecture. */
const APP_HINTS: Array<{ id: string; pt: string; en: string; hints: string[] }> = [
  { id: "obc", pt: "OBC", en: "OBC", hints: ["computer", "obc", "on-board"] },
  { id: "adcs", pt: "ADCS", en: "ADCS", hints: ["wheel", "magnetorquer", "adcs", "attitude", "imu", "magnet"] },
  { id: "eps", pt: "EPS", en: "EPS", hints: ["battery", "eps", "solar", "power", "regulator", "cell"] },
  { id: "com", pt: "COM", en: "COM", hints: ["radio", "antenna", "transceiver", "communication"] },
  { id: "pay", pt: "PAY", en: "PAY", hints: ["camera", "payload", "optics", "instrument"] },
  { id: "thm", pt: "THM", en: "THM", hints: ["thermal", "radiator", "enclosure", "heater"] },
  { id: "str", pt: "STR", en: "STR", hints: ["structure", "chassis", "frame", "deployment"] },
  { id: "sto", pt: "STO", en: "STO", hints: ["storage", "memory", "buffer"] },
  { id: "gnd", pt: "GND", en: "GND", hints: [] }
];

export function SoftwarePage({ language, project, onProjectChange, navigation }: { language: Language; project: MissionProject; onProjectChange: (project: MissionProject) => void; navigation: RailNavigation }) {
  const pt = language === "pt";
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  // Blocks are placed and dragged inside the panel, never past its edges.
  const [frameWidth, setFrameWidth] = useState(0);
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const measure = () => setFrameWidth(frame.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);
  const columns = Math.max(2, Math.floor((frameWidth + APP_GAP) / (APP_WIDTH + APP_GAP)) || 4);
  const clamp = (x: number, y: number, rowCount: number) => ({
    x: Math.max(0, Math.min(x, Math.max(0, frameWidth - APP_WIDTH))),
    y: Math.max(0, Math.min(y, Math.max(0, rowCount * (APP_HEIGHT + APP_GAP) - APP_HEIGHT)))
  });
  const dragRef = useRef<{ pointer: number; id: string; x: number; y: number; originX: number; originY: number; moved: boolean } | null>(null);
  const saved = project.navigation.systemLayouts?.software ?? {};
  const [placement, setPlacement] = useState<Placement>(saved);
  const placementRef = useRef(placement);
  placementRef.current = placement;

  const entities = useMemo(() => project.engineeringSystem?.entities.filter((entity) => !["system", "subsystem"].includes(entity.kind)) ?? [], [project.engineeringSystem]);
  const requirements = project.engineeringSystem?.requirements ?? [];
  const apps = useMemo(() => APP_HINTS.map((app) => {
    const parts = entities.filter((entity) => app.hints.some((hint) => `${entity.id} ${entity.name}`.toLowerCase().includes(hint)));
    const linked = requirements.filter((requirement) => requirement.relatedEntityIds.some((id) => parts.some((part) => part.id === id)));
    return { ...app, parts, linked };
  }).filter((app) => app.id === "gnd" || app.parts.length), [entities, requirements]);

  function persist(next: Placement) {
    placementRef.current = next; setPlacement(next);
    onProjectChange({ ...project, navigation: { ...project.navigation, systemLayouts: { ...project.navigation.systemLayouts, software: next } } });
  }
  const rows = Math.max(1, Math.ceil(apps.length / columns));
  const spot = (id: string, index: number) => {
    const fallback = { x: (index % columns) * (APP_WIDTH + APP_GAP), y: Math.floor(index / columns) * (APP_HEIGHT + APP_GAP) };
    const stored = placement[id];
    return stored ? clamp(stored.x, stored.y, rows) : fallback;
  };
  const detail = apps.find((app) => app.id === selected);

  const c = pt
    ? { title: "Software", repo: "Conectar repositório GitHub", soon: "Em breve", apps: "Apps do projeto", core: "Núcleo de voo", edit: "Editar", done: "Concluir edição", reset: "Restaurar posições", hint: "Arraste os blocos para organizar.", pick: "Clique num bloco para ver o que ele controla.", controls: "Controla", requirements: "Requisitos", none: "Sem elemento vinculado" }
    : { title: "Software", repo: "Connect GitHub repository", soon: "Coming soon", apps: "Project apps", core: "Flight core", edit: "Edit", done: "Finish editing", reset: "Reset positions", hint: "Drag the blocks to arrange them.", pick: "Click a block to see what it controls.", controls: "Controls", requirements: "Requirements", none: "No linked element" };

  return <ProjectAreaShell language={language} project={project} area="software" navigation={navigation} counter={`${apps.length} apps`}
    actions={<>
      <button type="button" className={editing ? "software-edit editing" : "software-edit"} aria-pressed={editing} onClick={() => setEditing(!editing)}>{editing ? <Check aria-hidden="true" /> : <Pencil aria-hidden="true" />}{editing ? c.done : c.edit}</button>
      <button type="button" className="area-repo-action" disabled title={c.soon}><FolderGit2 aria-hidden="true" />{c.repo}<small>{c.soon}</small></button>
    </>}>
    <div className="software-canvas">
      <section className="software-panel">
        <header>{c.apps}{editing && <button type="button" className="software-reset" onClick={() => persist({})}><RotateCcw aria-hidden="true" />{c.reset}</button>}</header>
        <div className="software-apps" ref={frameRef} style={{ height: rows * (APP_HEIGHT + APP_GAP) }}>
          {apps.map((app, index) => {
            const position = spot(app.id, index);
            return <button type="button" key={app.id} className={`software-app${selected === app.id ? " selected" : ""}${editing ? " editable" : ""}`} style={{ left: position.x, top: position.y, width: APP_WIDTH, height: APP_HEIGHT }}
              onClick={() => { if (!dragRef.current?.moved) setSelected(selected === app.id ? null : app.id); }}
              onPointerDown={(event) => {
                if (!editing || event.button !== 0) return;
                event.currentTarget.setPointerCapture(event.pointerId);
                dragRef.current = { pointer: event.pointerId, id: app.id, x: event.clientX, y: event.clientY, originX: position.x, originY: position.y, moved: false };
              }}
              onPointerMove={(event) => {
                const drag = dragRef.current;
                if (!drag || drag.pointer !== event.pointerId || drag.id !== app.id) return;
                const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
                if (!drag.moved && Math.hypot(dx, dy) < 4) return;
                drag.moved = true;
                const next = { ...placementRef.current, [app.id]: clamp(drag.originX + dx, drag.originY + dy, rows) };
                placementRef.current = next; setPlacement(next);
              }}
              onPointerUp={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
                if (dragRef.current?.id === app.id && dragRef.current.moved) persist(placementRef.current);
                setTimeout(() => { dragRef.current = null; }, 0);
              }}>
              <strong>{pt ? app.pt : app.en}</strong>
              <small>{app.parts.length ? `${app.parts.length} ${app.parts.length === 1 ? pt ? "elemento" : "element" : pt ? "elementos" : "elements"}` : "—"}{app.linked.length ? ` · ${app.linked.length} req` : ""}</small>
            </button>;
          })}
        </div>
      </section>

      <section className="software-panel">
        <header>{c.core}</header>
        <div className="software-core">
          {CORE.map((service) => <article className={service.wide ? "software-service bus" : "software-service"} key={service.id}>
            <strong>{pt ? service.pt : service.en}</strong>
            <small>{pt ? service.ptRole : service.enRole}</small>
          </article>)}
        </div>
      </section>

      <aside className="software-inspector" aria-live="polite">
        {detail ? <>
          <strong>{pt ? detail.pt : detail.en}</strong>
          <div><small>{c.controls}</small>{detail.parts.length ? <ul>{detail.parts.map((part) => <li key={part.id}>{part.name}</li>)}</ul> : <em>{c.none}</em>}</div>
          {detail.linked.length > 0 && <div><small>{c.requirements}</small><ul>{detail.linked.map((requirement) => <li key={requirement.id}>{requirement.id}</li>)}</ul></div>}
        </> : <p>{editing ? c.hint : c.pick}</p>}
      </aside>
    </div>
  </ProjectAreaShell>;
}
