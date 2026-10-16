import { useCallback, useEffect, useRef, useState } from "react";
import { PanelRightClose, Waypoints } from "lucide-react";
import { IdeasPage } from "../pages/IdeasPage";
import type { MissionProject } from "../lib/projectStore";
import type { Language } from "../lib/types";

const WIDTH_KEY = "norte-discovery-panel-width-v1";
const OPEN_KEY = "norte-discovery-panel-open-v1";
export const DISCOVERY_MIN_WIDTH = 320;
export const DISCOVERY_MAX_WIDTH = 900;

const stored = (key: string) => { try { return window.localStorage.getItem(key) || ""; } catch { return ""; } };
const remember = (key: string, value: string) => { try { window.localStorage.setItem(key, value); } catch { /* private browsing keeps the session default */ } };

export function clampDiscoveryWidth(width: number, available = DISCOVERY_MAX_WIDTH) {
  return Math.max(DISCOVERY_MIN_WIDTH, Math.min(DISCOVERY_MAX_WIDTH, Math.min(width, Math.max(DISCOVERY_MIN_WIDTH, available))));
}

/** The panel remembers itself, so closing it is never the same as losing the work inside. */
export function useDiscoveryPanel() {
  const [open, setOpen] = useState(() => stored(OPEN_KEY) === "true");
  const [width, setWidth] = useState(() => clampDiscoveryWidth(Number(stored(WIDTH_KEY)) || 440));
  const toggle = useCallback(() => setOpen((current) => { remember(OPEN_KEY, String(!current)); return !current; }), []);
  const close = useCallback(() => { remember(OPEN_KEY, "false"); setOpen(false); }, []);
  const resize = useCallback((next: number) => {
    const clamped = clampDiscoveryWidth(next, typeof window === "undefined" ? DISCOVERY_MAX_WIDTH : window.innerWidth - 120);
    remember(WIDTH_KEY, String(clamped));
    setWidth(clamped);
  }, []);
  return { open, width, toggle, close, resize };
}

type Props = {
  language: Language; project: MissionProject; width: number;
  contextLabel: string; onClose: () => void; onResize: (width: number) => void;
  onProjectChange: (project: MissionProject) => void;
};

/**
 * Discovery, unchanged, floated over whatever page the user is on. The panel
 * owns only its own geometry; the exploration inside is the same board, on the
 * same project, saved the same way.
 */
export function DiscoveryPanel({ language, project, width, contextLabel, onClose, onResize, onProjectChange }: Props) {
  const dragRef = useRef<{ pointer: number; x: number; width: number } | null>(null);
  const pt = language === "pt";

  // Escape belongs to whatever is open inside the panel first — a composer, a
  // dialog — and only closes the panel when the work itself is not focused.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.key !== "Escape" || target?.closest(".discovery-panel-body")) return;
      onClose();
    };
    // Capture phase: by the time React has handled the key, the element that
    // received it may already be detached and no longer answer `closest`.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return <aside className="discovery-panel" style={{ width }} aria-label={pt ? "Testar ideias" : "Test ideas"}>
    <div className="discovery-panel-grip" role="separator" aria-label={pt ? "Ajustar largura do painel" : "Adjust panel width"} aria-orientation="vertical" aria-valuenow={width} aria-valuemin={DISCOVERY_MIN_WIDTH} aria-valuemax={DISCOVERY_MAX_WIDTH} tabIndex={0}
      onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); dragRef.current = { pointer: event.pointerId, x: event.clientX, width }; }}
      onPointerMove={(event) => { const drag = dragRef.current; if (drag?.pointer === event.pointerId) onResize(drag.width + drag.x - event.clientX); }}
      onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); dragRef.current = null; }}
      onKeyDown={(event) => {
        if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
        event.preventDefault();
        onResize(width + (event.key === "ArrowLeft" ? 40 : -40));
      }} />
    <header className="discovery-panel-bar">
      <span className="discovery-panel-title"><Waypoints aria-hidden="true" />{pt ? "Testar ideias" : "Test ideas"}<em>BETA</em></span>
      <span className="discovery-panel-context" title={contextLabel}>{contextLabel}</span>
      <button type="button" onClick={onClose} aria-label={pt ? "Fechar Testar ideias" : "Close Test ideas"}><PanelRightClose aria-hidden="true" /></button>
    </header>
    <div className="discovery-panel-body">
      <IdeasPage language={language} project={project} onProjectChange={onProjectChange} compact />
    </div>
  </aside>;
}
