import { ExternalLink } from "lucide-react";
import type { EngineeringSystemModel } from "../lib/engineeringSystem";
import type { ExtractionReport } from "../lib/extractionJobs";
import type { Language } from "../lib/types";

function property(value: unknown): { name?: string; value?: number | string; unit?: string; evidenceRefs?: string[] } {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function CurrentExtractionReport({ report, model, language }: { report: ExtractionReport; model?: EngineeringSystemModel; language: Language }) {
  const pt = language === "pt", documents = report.documents || [], omissions = report.omissions || [], conflicts = report.conflicts || [];
  const total = report.progress?.totalChunks ?? documents.reduce((sum, item) => sum + (item.totalChunks || 0), 0);
  const completed = report.progress?.completedChunks ?? documents.reduce((sum, item) => sum + (item.completedChunks || 0), 0);
  const coverage = total > 0 ? Math.round(100 * completed / total) : null;
  const sources = new Map(documents.map(item => [item.artifactId, item.label]));
  const names: Record<string, string> = pt ? { entity: "Objeto técnico", property: "Propriedade", relation: "Relação", requirement: "Requisito", evidence: "Citação" } : { entity: "Technical object", property: "Property", relation: "Relationship", requirement: "Requirement", evidence: "Citation" };
  const sourceLink = (artifactId: string) => sources.has(artifactId) ? <a href={`/api/artifacts/${encodeURIComponent(artifactId)}/content`} target="_blank" rel="noreferrer">{sources.get(artifactId)}<ExternalLink size={12} /></a> : <small>{pt ? "Consulte o documento de origem na memória do projeto." : "Consult the original document in Project Memory."}</small>;
  const valueText = (value: unknown) => {
    const item = property(value);
    if (typeof item.value !== "string" && typeof item.value !== "number") return "—";
    const text = String(item.value), unit = typeof item.unit === "string" ? item.unit : "";
    return unit && !text.trim().endsWith(unit) ? `${text} ${unit}` : text;
  };
  const valueSources = (value: unknown) => [...new Set((property(value).evidenceRefs || []).flatMap(id => {
    const evidence = model?.evidence.find(item => item.id === id);
    return evidence ? [evidence.artifactId] : [];
  }))];
  return <section className="current-extraction-report" aria-label={pt ? "Relatório da leitura atual" : "Current extraction report"}>
    <h3>{pt ? "Relatório da leitura atual" : "Current extraction report"}</h3>
    <p className="extraction-report-coverage">{coverage === null ? (pt ? "Cobertura de leitura não informada." : "Reading coverage was not reported.") : (pt ? `Cobertura de leitura: ${coverage}% · ${completed}/${total} trechos processados em ${documents.length} documentos.` : `Reading coverage: ${coverage}% · ${completed}/${total} segments processed across ${documents.length} documents.`)}</p>
    <p>{pt ? "Cobertura indica o que foi processado. Não garante interpretação perfeita nem elimina pendências de revisão." : "Coverage measures what was processed. It does not guarantee perfect interpretation or resolve review items."}</p>
    {report.needsReview && <p className="extraction-proposal-warning">{pt ? "Este mapa contém pontos que precisam de conferência humana. As informações omitidas não foram incorporadas como fatos ao mapa." : "This map includes points requiring human review. Omitted information was not added to the map as fact."}</p>}
    {report.warnings?.map((warning, index) => <p className="extraction-proposal-note" key={index}>{warning}</p>)}
    <details open className="extraction-current-omissions"><summary>{pt ? "Pendências de revisão" : "Review items"} ({omissions.length})</summary>
      {omissions.length ? <div className="extraction-proposal-items">{omissions.map((item, index) => <article className="extraction-omission" key={index}><small>{names[item.kind] || (pt ? "Informação" : "Information")}</small><strong>{pt ? "Pendente de validação: " : "Pending validation: "}{item.name || names[item.kind] || (pt ? "Informação sem comprovação suficiente" : "Information without sufficient evidence")}</strong><p>{item.reason}</p>{sourceLink(item.artifactId)}</article>)}</div> : <p>{pt ? "Nenhuma omissão registrada nesta leitura. Confira também divergências e limitações abaixo." : "No omissions were recorded in this extraction. Also review the conflicts and limitations below."}</p>}
    </details>
    {!!conflicts.length && <details className="extraction-current-conflicts"><summary>{pt ? "Divergências entre fontes" : "Source conflicts"} ({conflicts.length})</summary><div className="extraction-proposal-items">{conflicts.map((item, index) => {
      const objectName = model?.entities.find(entity => entity.id === item.entityId)?.name;
      const field = property(item.kept).name || property(item.candidate).name || (pt ? "Informação em revisão" : "Information under review");
      return <article key={index}><strong>{objectName ? `${objectName} · ` : ""}{field}</strong><p>{item.reason || (pt ? "Confira revisão, unidade e condição de operação nos documentos." : "Check revision, unit and operating conditions in the documents.")}</p>{Boolean(item.kept || item.candidate) && <table><thead><tr><th>{pt ? "No mapa" : "In the map"}</th><th>{pt ? "Alternativa encontrada" : "Alternative found"}</th></tr></thead><tbody><tr><td>{valueText(item.kept)}{valueSources(item.kept).map(id => <div key={id}>{sourceLink(id)}</div>)}</td><td>{valueText(item.candidate)}{valueSources(item.candidate).map(id => <div key={id}>{sourceLink(id)}</div>)}</td></tr></tbody></table>}</article>;
    })}</div></details>}
    {!!documents.length && <details className="extraction-current-documents"><summary>{pt ? "Fontes, cobertura e limitações" : "Sources, coverage and limitations"} ({documents.length})</summary><div className="extraction-proposal-items">{documents.map(item => <article key={item.artifactId}>{sourceLink(item.artifactId)}<p>{item.totalChunks !== undefined ? `${item.completedChunks || 0}/${item.totalChunks} ${pt ? "trechos processados" : "segments processed"}` : (item.complete ? (pt ? "Leitura concluída" : "Reading completed") : (pt ? "Confira a cobertura desta fonte" : "Check this source's coverage"))}{item.totalPages ? ` · ${item.totalPages} ${pt ? "páginas" : "pages"}` : ""}</p>{item.missingPages?.length ? <p>{pt ? "Páginas sem texto suficiente: " : "Pages with insufficient text: "}{item.missingPages.join(", ")}</p> : null}{item.reason && <p>{item.reason}</p>}{item.limitations?.map((limitation, index) => <p className="extraction-proposal-warning" key={index}>{limitation}</p>)}</article>)}</div></details>}
  </section>;
}
