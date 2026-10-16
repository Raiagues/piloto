import { useEffect, useRef, useState } from "react";
import { History, X } from "lucide-react";
import { useAuth } from "../lib/auth";
import type { EngineeringSystemModel } from "../lib/engineeringSystem";
import type { ExtractionReport } from "../lib/extractionJobs";
import type { Language } from "../lib/types";
import "./ExtractionProposalDialog.css";

type HistoricalMap = { id: string; archivedAt: string; engineeringSystem: EngineeringSystemModel };
export function ProjectMapHistory({ projectId, language }: { projectId: string; model?: EngineeringSystemModel; language: Language }) {
  const [open, setOpen] = useState(false), [versions, setVersions] = useState<HistoricalMap[]>([]), [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const auth = useAuth(), pt = language === "pt", dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!open) return;
    let alive = true; dialog.current?.showModal(); setError(""); setLoading(true);
    void auth.api<{ versions: HistoricalMap[]; extractionReport?: ExtractionReport | null }>(`/projects/${encodeURIComponent(projectId)}/system-history`).then(result => { if (alive) { setVersions(result.versions); } }).catch(reason => { if (alive) setError(reason instanceof Error ? reason.message : "Não foi possível ler o histórico."); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [open, auth.api, projectId]);
  return <><button type="button" className="pm-update-map" onClick={() => setOpen(true)}><History size={14} /> {pt ? "Versões anteriores do mapa" : "Previous map versions"}</button>{open && <dialog ref={dialog} className="extraction-proposal" aria-label={pt ? "Versões anteriores do mapa" : "Previous map versions"} onCancel={() => setOpen(false)}>
    <header><div><h2>{pt ? "Versões anteriores do mapa" : "Previous map versions"}</h2><p>{pt ? "Valores preservados antes de cada substituição. As pendências atuais estão em Conhecimento." : "Values preserved before each replacement. Current review items are in Knowledge."}</p></div><button type="button" onClick={() => setOpen(false)} aria-label={pt ? "Fechar versões" : "Close versions"}><X size={16} /></button></header>
    {loading && <p role="status">{pt ? "Carregando versões…" : "Loading versions…"}</p>}{error && <p role="alert">{error}</p>}
    {!loading && !error && <><section className="previous-map-versions"><h3>{pt ? "Versões anteriores preservadas" : "Preserved previous versions"}</h3>{!versions.length && <p>{pt ? "Ainda não há versões anteriores preservadas." : "There are no preserved previous versions yet."}</p>}{versions.map(version => <details key={version.id}><summary>{new Date(version.archivedAt).toLocaleString(pt ? "pt-BR" : "en-US")} · {version.engineeringSystem.name}</summary><p>{version.engineeringSystem.entities.length} {pt ? "objetos" : "objects"} · {version.engineeringSystem.requirements.length} {pt ? "requisitos" : "requirements"} · {version.engineeringSystem.corrections?.length || 0} {pt ? "correções registradas" : "recorded corrections"}</p><div className="extraction-proposal-items">{version.engineeringSystem.entities.map(item => <article key={item.id}><strong>{item.name}</strong><p>{item.description}</p>{item.properties?.map(property => <p key={property.key}>{property.name}: {property.value} {property.unit || ""}</p>)}</article>)}{version.engineeringSystem.requirements.map(item => <article key={item.id}><strong>{item.title}</strong><p>{item.statement}</p></article>)}</div></details>)}</section>
    </>}
  </dialog>}</>;
}
