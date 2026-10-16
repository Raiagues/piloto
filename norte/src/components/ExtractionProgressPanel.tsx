import { AlertCircle, ArrowUpRight, BookOpen, Check, ChevronUp, Circle, FileText, LoaderCircle, Minus } from "lucide-react";
import type { ExtractionTask } from "../lib/useExtractionTasks";
import type { Language } from "../lib/types";
import "./ExtractionProgressPanel.css";

export function ExtractionProgressPanel({ task, tasks, language, expanded, onExpanded, onSelect, onReview, onRetry, onOpenProject }: {
  task: ExtractionTask; tasks: ExtractionTask[]; language: Language; expanded: boolean;
  onExpanded: (expanded: boolean) => void; onSelect: (id: string) => void;
  onReview: () => void; onRetry: () => void; onOpenProject: () => void;
}) {
  const pt = language === "pt", job = task.job, progress = job.progress;
  const documents = job.report?.documents || [];
  const failed = job.status === "failed", completed = job.status === "completed", busy = !failed && !completed;
  const percent = Math.max(0, Math.min(100, Math.floor((progress?.coverage || 0) * 100)));
  const omissions = job.report?.omissionCount ?? job.report?.omissions?.length ?? 0, conflicts = job.report?.conflictCount ?? job.report?.conflicts?.length ?? 0;
  const title = task.error && !task.applied ? (pt ? "Acompanhamento indisponível" : "Progress unavailable") : task.applied ? (pt ? "Mapa salvo no projeto" : "Map saved to project") : completed ? (pt ? "Mapa pronto para revisão" : "Map ready for review") : failed ? (pt ? "Leitura precisa de atenção" : "Reading needs attention") : pt ? "Gerando mapa do projeto" : "Building the project map";
  const StateIcon = task.applied || completed ? Check : failed || task.error ? AlertCircle : LoaderCircle;
  const total = progress?.totalDocuments || documents.length;
  const read = progress?.processedDocuments || documents.filter(document => document.complete).length;
  if (!expanded) return <button className={`extraction-task-chip${completed ? " ready" : ""}`} type="button" onClick={() => onExpanded(true)} aria-label={pt ? "Acompanhar geração do mapa" : "Follow map generation"}>
    <span className="extraction-task-icon"><StateIcon size={17} className={busy && !task.error ? "extraction-spin" : undefined} /></span>
    <span><strong>{title}</strong><small>{task.projectName}{busy && progress ? ` · ${percent}%` : ""}</small></span><ChevronUp size={16} />
  </button>;
  return <aside className="extraction-task-panel" aria-label={pt ? "Geração do mapa" : "Map generation"}>
    <header><span className="extraction-task-icon"><BookOpen size={21} /></span><div><small>{pt ? "MEMÓRIA DO PROJETO" : "PROJECT MEMORY"}</small><h2>{title}</h2></div><button type="button" className="extraction-icon-button" onClick={() => onExpanded(false)} aria-label={pt ? "Minimizar acompanhamento" : "Minimize progress"} title={pt ? "Minimizar" : "Minimize"}><Minus size={19} /></button></header>
    {tasks.length > 1 ? <label className="extraction-project-picker"><span>{pt ? "Projeto" : "Project"}</span><select value={task.projectId} onChange={event => onSelect(event.target.value)}>{tasks.map(item => <option value={item.projectId} key={item.projectId}>{item.projectName}</option>)}</select></label> : <p className="extraction-project-name">{task.projectName}</p>}
    <div className="extraction-progress-summary"><span aria-live="polite">{task.applied ? (pt ? "Versão preservada na sua conta" : "Version saved in your account") : completed ? (pt ? "Leitura concluída" : "Reading complete") : progress ? `${read} ${pt ? "de" : "of"} ${total} ${pt ? "documentos lidos" : "documents read"}` : pt ? "Preparando os documentos…" : "Preparing documents…"}</span><strong>{percent}%</strong></div>
    <progress aria-label={pt ? "Progresso da leitura" : "Reading progress"} max={100} value={percent} />
    <div className="extraction-progress-details"><span>{progress ? `${progress.completedChunks} / ${progress.totalChunks} ${pt ? "trechos" : "segments"}` : pt ? "Organizando os trechos" : "Organizing segments"}</span><span>{progress?.cachedChunks || 0} {pt ? "reutilizados" : "reused"}</span></div>
    <p className="extraction-background-note">{task.restartRequired ? (pt ? "A memória mudou desde o início. Uma nova leitura usará os documentos atuais e reutilizará os trechos válidos." : "Memory changed after reading began. A new reading will use current documents and reuse valid segments.") : task.error ? (pt ? "Seus documentos continuam salvos. Reconecte para verificar o estado da leitura." : "Your documents remain saved. Reconnect to check the reading status.") : task.applied ? (pt ? "Documentos e mapa disponíveis na próxima vez que entrar." : "Documents and map will be available when you return.") : completed ? (pt ? "Confira a proposta quando quiser. Seu mapa só muda após sua confirmação." : "Review the proposal when you are ready. Your map changes only after confirmation.") : failed ? (pt ? "Os documentos e os trechos já lidos foram mantidos." : "Your documents and completed segments have been kept.") : (pt ? "Pode continuar usando a plataforma ou fechar esta página. A leitura segue em segundo plano." : "Keep using the platform or close this page. Reading continues in the background.")}</p>
    <section className="extraction-document-section" aria-label={pt ? "Documentos enviados" : "Uploaded documents"}><div className="extraction-document-heading"><h3>{pt ? "Documentos enviados" : "Uploaded documents"}</h3><span>{total}</span></div>
      <ul>{documents.map(document => {
        const done = document.complete || document.stage === "completed", reading = document.stage === "reading" || Boolean(document.activeChunks), error = document.stage === "failed";
        const Icon = done ? Check : reading ? LoaderCircle : error ? AlertCircle : Circle;
        const status = done ? (pt ? "Lido" : "Read") : reading ? (pt ? "Lendo" : "Reading") : error ? (pt ? "Revisar" : "Review") : (pt ? "Na fila" : "Queued");
        return <li key={document.artifactId} className={done ? "done" : reading ? "reading" : error ? "failed" : "queued"}><FileText className="extraction-document-icon" size={17} /><div className="extraction-document-copy"><strong title={document.label}>{document.label}</strong><small>{document.totalChunks ? `${document.completedChunks || 0} / ${document.totalChunks} ${pt ? "trechos" : "segments"}` : pt ? "Arquivo salvo" : "File saved"}{document.totalPages ? ` · ${document.totalPages} ${pt ? "páginas" : "pages"}` : ""}{document.cachedChunks ? ` · ${document.cachedChunks} ${pt ? "reutilizados" : "reused"}` : ""}</small></div><span className="extraction-document-status"><Icon size={12} className={reading ? "extraction-spin" : undefined} />{status}</span></li>;
      })}{!documents.length && <li className="extraction-document-placeholder">{pt ? "Carregando a lista dos arquivos salvos…" : "Loading the list of saved files…"}</li>}</ul>
    </section>
    {(omissions > 0 || conflicts > 0) && <p className="extraction-review-note"><AlertCircle size={15} /><span>{pt ? `${omissions} ${omissions === 1 ? "item sem comprovação" : "itens sem comprovação"}${conflicts ? ` · ${conflicts} divergências` : ""}. Você poderá conferir as fontes na revisão.` : `${omissions} unverified ${omissions === 1 ? "item" : "items"}${conflicts ? ` · ${conflicts} conflicts` : ""}. Check the sources during review.`}</span></p>}
    {(task.error || failed) && <p className="extraction-task-error" role="alert">{task.error || job.error?.message || (pt ? "Não foi possível concluir a leitura." : "Reading could not be completed.")}</p>}
    <footer><button className="extraction-secondary-button" type="button" onClick={onOpenProject}>{pt ? "Abrir memória" : "Open memory"}<ArrowUpRight size={14} /></button>{task.applied ? <span className="extraction-saved-label"><Check size={14} />{pt ? "Salvo" : "Saved"}</span> : completed ? <button className="extraction-primary-button" type="button" disabled={task.applying} onClick={onReview}>{task.applying ? (pt ? "Salvando…" : "Saving…") : (pt ? "Revisar proposta" : "Review proposal")}</button> : failed || task.error ? <button className="extraction-primary-button" type="button" onClick={onRetry}>{task.restartRequired ? (pt ? "Iniciar nova leitura" : "Start new reading") : failed ? (pt ? "Retomar leitura" : "Resume reading") : (pt ? "Reconectar" : "Reconnect")}</button> : <button className="extraction-secondary-button" type="button" onClick={() => onExpanded(false)}>{pt ? "Continuar navegando" : "Keep browsing"}</button>}</footer>
  </aside>;
}
