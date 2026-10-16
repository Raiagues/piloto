import { useState } from "react";
import { BookOpen, ExternalLink, Search } from "lucide-react";
import { useAuth } from "../lib/auth";
import type { Language } from "../lib/types";

type MemoryObject = { id: string; name: string; description?: string; properties?: { key: string; name?: string; value: unknown; unit?: string }[] };
type MemoryResult = {
  status?: "ready" | "no_baseline" | "stale_baseline" | "no_match" | "disabled"; method?: string; cached?: boolean; message?: string;
  context?: { entities: MemoryObject[]; requirements: { id: string; statement: string; status?: string }[]; evidence: { id: string; artifactId: string; artifactLabel?: string; locator?: string; excerpt: string }[] } | null;
};

/** Only the server selects sources visible to every member of this meeting. */
export function MeetingMemoryLookup({ meetingId, language }: { meetingId: string; language: Language }) {
  const auth = useAuth(), pt = language === "pt";
  const [query, setQuery] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [result, setResult] = useState<MemoryResult | null>(null);
  async function search() {
    setBusy(true); setError(""); setResult(null);
    try { setResult(await auth.api<MemoryResult>(`/meetings/${encodeURIComponent(meetingId)}/context`, { method: "POST", body: JSON.stringify({ query: query.trim() }) })); }
    catch (reason) { setError(reason instanceof Error ? reason.message : pt ? "Não foi possível consultar a memória." : "Could not search memory."); }
    finally { setBusy(false); }
  }
  return <details className="meeting-memory-lookup"><summary><BookOpen size={15} />{pt ? "Consultar memória do projeto" : "Search project memory"}</summary><p>{pt ? "Encontre os pontos do mapa e as fontes relacionadas ao assunto da reunião." : "Find map objects and sources related to this discussion."}</p><form onSubmit={event => { event.preventDefault(); void search(); }}><label>{pt ? "Assunto para consultar" : "Topic to search"}<input value={query} onChange={event => setQuery(event.target.value)} maxLength={3000} placeholder={pt ? "Ex.: consumo de energia" : "E.g. power consumption"} /></label><button type="submit" disabled={busy || !query.trim()}><Search size={14} />{busy ? (pt ? "Consultando…" : "Searching…") : (pt ? "Consultar fontes" : "Search sources")}</button></form>
    {error && <p role="alert">{error}</p>}{result && <div className="meeting-memory-result" aria-live="polite">{result.status === "no_baseline" ? <p>{pt ? "O mapa ainda não foi gerado. Abra a memória do projeto, leia os documentos e revise o mapa antes de consultá-lo aqui." : "The map has not been generated. Open project memory, read the documents and review the map before searching it here."}</p> : result.status === "stale_baseline" ? <p>{pt ? "Os documentos mudaram desde a geração do mapa. Abra a memória do projeto e use Atualizar mapa dos documentos; revise a proposta antes de substituir a versão atual." : "Documents changed after this map was generated. Open project memory, choose Update map from documents and review the proposal before replacing the current version."}</p> : result.status !== "ready" ? <p>{result.message || (pt ? "Nenhum ponto do mapa corresponde claramente à consulta. Tente um assunto mais específico." : "No map object clearly matches this query. Try a more specific topic.")}</p> : <>
      {result.context?.entities.map(item => <article key={item.id}><strong>{item.name}</strong>{item.description && <p>{item.description}</p>}{item.properties?.filter(property => ["string", "number", "boolean"].includes(typeof property.value)).slice(0, 5).map(property => <p key={property.key}><span>{property.name || property.key}: </span>{String(property.value)}{property.unit ? ` ${property.unit}` : ""}</p>)}</article>)}
      {result.context?.requirements.map(item => <article key={item.id}><strong>{pt ? "Requisito" : "Requirement"}</strong><p>{item.statement}</p></article>)}
      {!!result.context?.evidence.length && <h4>{pt ? "Fontes consultadas" : "Sources consulted"}</h4>}{result.context?.evidence.map(item => <article key={item.id}><a href={`/api/artifacts/${encodeURIComponent(item.artifactId)}/content`} target="_blank" rel="noreferrer">{item.artifactLabel || (pt ? "Documento do projeto" : "Project document")}<ExternalLink size={12} /></a>{item.locator && <small>{item.locator}</small>}<blockquote>{item.excerpt}</blockquote></article>)}
      <small>{result.cached ? (pt ? "Consulta reutilizada, sem nova classificação." : "Reused lookup, without a new classification.") : result.method === "jev" ? (pt ? "Seleção assistida por JEV; confira as fontes." : "JEV-assisted selection; check the sources.") : (pt ? "Seleção por termos relacionados; confira as fontes." : "Selection by related terms; check the sources.")}</small>
    </>}</div>}
  </details>;
}
