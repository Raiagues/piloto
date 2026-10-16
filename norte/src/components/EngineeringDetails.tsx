import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, Check, Download, FileText, Pencil, Plus, SlidersHorizontal, Trash2, X } from "lucide-react";
import { ENGINEERING_RELATION_KINDS } from "../lib/engineeringSystem";
import type { EngineeringCorrection, EngineeringCorrectionProjectContext, EngineeringCorrectionSnapshot, EngineeringEntity, EngineeringImpact, EngineeringProperty, EngineeringRelation, EngineeringRequirement, EngineeringSystemModel } from "../lib/engineeringSystem";
import { correctEngineeringEntity, correctEngineeringRelation, correctEngineeringRequirement, engineeringLabel, engineeringParentCandidates, filterEngineeringRequirements, formatEngineeringValue, removeEngineeringRelation } from "../lib/engineeringUi";
import { downloadEngineeringCorrections } from "../lib/engineeringCorrections";
import type { RequirementFilters } from "../lib/engineeringUi";
import { DocumentEvidenceViewer } from "./DocumentEvidenceViewer";
import type { Language } from "../lib/types";

export function EngineeringDialog({ title, eyebrow, language, onClose, children, wide = false }: { title: string; eyebrow?: string; language: Language; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  const titleId = useId();
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = ref.current;
    element?.focus();
    function keydown(event: KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeRef.current(); }
      if (event.key !== "Tab" || !element) return;
      const focusable = Array.from(element.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], summary, [tabindex="0"]')).filter((item) => !item.hidden && item.getClientRects().length);
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (!first) { event.preventDefault(); return; }
      if (!element.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === element)) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && (document.activeElement === last || document.activeElement === element)) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", keydown);
    return () => { document.removeEventListener("keydown", keydown); if (previous?.isConnected) previous.focus(); };
  }, []);
  const content = <div className="engineering-dialog-backdrop" onPointerDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
    <section className={`engineering-dialog${wide ? " wide" : ""}`} ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
      <header><div>{eyebrow && <small>{eyebrow}</small>}<h2 id={titleId}>{title}</h2></div><button type="button" onClick={onClose} aria-label={language === "pt" ? "Fechar" : "Close"}><X aria-hidden="true" /></button></header>
      <div className="engineering-dialog-body">{children}</div>
    </section>
  </div>;
  return typeof document === "undefined" ? content : createPortal(content, document.body);
}

export function EngineeringEvidenceList({ language, model, refs }: { language: Language; model: EngineeringSystemModel; refs: string[] }) {
  const [opened, setOpened] = useState(false);
  const unique = [...new Set(refs)];
  const evidence = model.evidence.filter(item => unique.includes(item.id));
  if (!unique.length) return <p className="engineering-muted">{language === "pt" ? "Sem evidência documental vinculada." : "No documented evidence linked."}</p>;
  return <details className="engineering-evidence" onToggle={event => setOpened(event.currentTarget.open)}>
    <summary><FileText aria-hidden="true" />{language === "pt" ? "Ver evidências no documento" : "View evidence in document"}<span>{evidence.length}</span></summary>
    {opened && evidence.length > 0 && <DocumentEvidenceViewer language={language} evidence={evidence} />}
    {opened && evidence.length < unique.length && <p className="engineering-muted">{language === "pt" ? "Algumas referências não estão disponíveis neste modelo." : "Some references are unavailable in this model."}</p>}
  </details>;
}

export function EngineeringImpactDetails({ language, model, impact }: { language: Language; model: EngineeringSystemModel; impact: EngineeringImpact }) {
  const pt = language === "pt";
  const calculation = impact.calculation ?? impact.reasoning.calculation;
  return <div className="engineering-impact-details">
    <span className={`engineering-status status-${impact.status}`}>{engineeringLabel(impact.status, language)}</span>
    <p>{impact.shortExplanation}</p>
    <small>{engineeringLabel(impact.reasoning.type, language)}{impact.reasoning.type === "inference" && ` · ${Math.round(impact.confidence * 100)}%`}</small>
    {calculation && <div className="engineering-calculation"><strong>{calculation.expression}</strong><dl>{calculation.inputs.map((input, index) => <div key={`${input.entityId}:${input.propertyKey}:${index}`}><dt>{model.entities.find((entity) => entity.id === input.entityId)?.name ?? input.entityId} · {model.entities.find((entity) => entity.id === input.entityId)?.properties.find((property) => property.key === input.propertyKey)?.name ?? input.propertyKey}</dt><dd>{input.value} {input.unit}</dd></div>)}</dl><small>{pt ? "Regra" : "Rule"}: {calculation.ruleId}</small></div>}
    {impact.path.length > 1 && <div className="engineering-impact-path" aria-label={pt ? "Caminho de impacto" : "Impact path"}>{impact.path.map((id, index) => <span key={`${id}:${index}`}>{index > 0 && <ArrowRight aria-hidden="true" />}{model.entities.find((entity) => entity.id === id)?.name ?? model.requirements.find((requirement) => requirement.id === id)?.title ?? id}</span>)}</div>}
    {impact.traversedRelationIds.length > 0 && <details className="engineering-disclosure"><summary>{pt ? "Por que este caminho?" : "Why this path?"}</summary>{impact.traversedRelationIds.map((id) => {
      const relation = model.relations.find((item) => item.id === id);
      return relation ? <div className="engineering-path-step" key={id}><p>{model.entities.find((entity) => entity.id === relation.from)?.name ?? relation.from} <span>{engineeringLabel(relation.kind, language)}</span> {model.entities.find((entity) => entity.id === relation.to)?.name ?? relation.to}</p><small>{engineeringLabel(relation.source, language)}</small><EngineeringEvidenceList language={language} model={model} refs={relation.evidenceRefs} /></div> : null;
    })}</details>}
    <EngineeringEvidenceList language={language} model={model} refs={[...impact.evidenceRefs, ...impact.reasoning.sourceRefs, ...(calculation?.evidenceRefs ?? [])]} />
    {impact.reasoning.type === "inference" && <small className="engineering-muted">{impact.reasoning.model ?? model.model ?? "AI"} · {new Date(impact.reasoning.createdAt).toLocaleString(language === "pt" ? "pt-BR" : "en-GB")}</small>}
  </div>;
}

function CorrectionSources({ language, model, refs, onChange }: { language: Language; model: EngineeringSystemModel; refs: string[]; onChange: (refs: string[]) => void }) {
  if (!model.evidence.length) return null;
  return <details className="engineering-disclosure"><summary>{language === "pt" ? "Fontes usadas na correção" : "Sources used for this correction"}</summary><fieldset className="engineering-source-choices"><legend>{language === "pt" ? "Evidências" : "Evidence"}</legend>{model.evidence.map((source) => <label key={source.id} title={source.excerpt}><input type="checkbox" checked={refs.includes(source.id)} onChange={(event) => onChange(event.target.checked ? [...refs, source.id] : refs.filter((id) => id !== source.id))} />{source.artifactLabel}{source.locator ? ` · ${source.locator}` : ""}</label>)}</fieldset></details>;
}

function correctionError(reason: unknown, language: Language): string {
  const message = reason instanceof Error ? reason.message : "";
  if (message.includes("evidence limit")) return language === "pt" ? "A correção excederia o limite de evidências. Nenhum dado foi alterado." : message;
  if (message.includes("history limit")) return language === "pt" ? "O histórico de correções atingiu o limite. Os registros continuam disponíveis para exportação." : message;
  if (message.includes("Place components")) return language === "pt" ? "Escolha um subsistema como elemento superior deste componente." : message;
  if (message.includes("Place subsystems")) return language === "pt" ? "Um subsistema deve fazer parte de um sistema ou de outro subsistema." : message;
  if (message.includes("descendants")) return language === "pt" ? "Escolha um elemento superior que não esteja dentro deste elemento." : message;
  if (message.includes("cycle")) return language === "pt" ? "Esta relação criaria um ciclo na arquitetura." : message;
  if (message.includes("different") || message.includes("Containment")) return language === "pt" ? "Escolha dois elementos diferentes e uma relação compatível." : message;
  return language === "pt" ? "Não foi possível registrar a correção. Nenhum dado foi alterado." : "The correction could not be recorded. No data has been changed.";
}

function correctionSummary(snapshot: EngineeringCorrectionSnapshot | null, correction: EngineeringCorrection, language: Language): string {
  if (!snapshot) return language === "pt" ? "Ausente" : "Absent";
  if ("relation" in snapshot) {
    const relation = snapshot.relation;
    const name = (id: string) => correction.context.entities.find((entity) => entity.id === id)?.name ?? id;
    return `${name(relation.from)} · ${engineeringLabel(relation.kind, language)} · ${name(relation.to)}`;
  }
  if ("requirement" in snapshot) return `${snapshot.requirement.title} · ${snapshot.requirement.statement}`;
  return `${snapshot.entity.name}${snapshot.entity.properties.length ? ` · ${snapshot.entity.properties.map((property) => `${property.name}: ${formatEngineeringValue(property)}`).join("; ")}` : ""}${snapshot.entity.parentId ? ` · ${correction.context.entities.find((entity) => entity.id === snapshot.entity.parentId)?.name ?? snapshot.entity.parentId}` : ""}`;
}

export function EngineeringCorrectionHistory({ language, model, targetId }: { language: Language; model: EngineeringSystemModel; targetId?: string }) {
  const corrections = (model.corrections ?? []).filter((correction) => !targetId || correction.targetId === targetId);
  if (!corrections.length) return null;
  const pt = language === "pt";
  return <details className="engineering-disclosure"><summary>{pt ? "Correções" : "Corrections"} · {corrections.length}</summary>
    {corrections.slice(-5).reverse().map((correction) => <article className="engineering-source" key={correction.id}>
      <small>{engineeringLabel(correction.objectKind, language)} · {pt ? ({ create: "adicionado", update: "corrigido", delete: "removido" }[correction.operation]) : ({ create: "added", update: "corrected", delete: "removed" }[correction.operation])} · {new Date(correction.createdAt).toLocaleString(pt ? "pt-BR" : "en-GB")}</small>
      <p className="engineering-muted" title={correctionSummary(correction.previous, correction, language)}>{pt ? "Antes" : "Before"}: {correctionSummary(correction.previous, correction, language).slice(0, 220)}</p>
      <strong title={correctionSummary(correction.corrected, correction, language)}>{pt ? "Correção" : "Correction"}: {correctionSummary(correction.corrected, correction, language).slice(0, 220)}</strong>
      <EngineeringEvidenceList language={language} model={{ ...model, evidence: correction.correctedEvidence }} refs={correction.correctedEvidence.map((source) => source.id)} />
      <details className="engineering-disclosure"><summary>{pt ? "Sugestão original" : "Original suggestion"}</summary><p>{correctionSummary(correction.suggested, correction, language)}</p><EngineeringEvidenceList language={language} model={{ ...model, evidence: correction.suggestedEvidence }} refs={correction.suggestedEvidence.map((source) => source.id)} /></details>
    </article>)}
    {corrections.length > 5 && <p className="engineering-muted">{pt ? "Exibindo as cinco correções mais recentes." : "Showing the five most recent corrections."}</p>}
    <button type="button" className="engineering-text-button" onClick={() => downloadEngineeringCorrections(model, targetId)}><Download aria-hidden="true" />{pt ? "Exportar correções (JSON)" : "Export corrections (JSON)"}</button>
  </details>;
}

export function EngineeringEntityInfo({ language, model, entity, impact, onClose, onModelChange, onRelation, correctionContext }: { language: Language; model: EngineeringSystemModel; entity: EngineeringEntity; impact?: EngineeringImpact; onClose: () => void; onModelChange?: (model: EngineeringSystemModel) => void; onRelation: (relation: EngineeringRelation) => void; correctionContext?: EngineeringCorrectionProjectContext }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(entity);
  const [correctionRefs, setCorrectionRefs] = useState<string[]>([]);
  const [error, setError] = useState("");
  const pt = language === "pt";
  const relations = model.relations.filter((relation) => relation.from === entity.id || relation.to === entity.id);
  function save() { if (!draft.name.trim()) return; try { onModelChange?.(correctEngineeringEntity(model, entity, draft, new Date().toISOString(), { project: correctionContext, evidenceRefs: correctionRefs })); setEditing(false); setError(""); } catch (reason) { setError(correctionError(reason, language)); } }
  function updateProperty(index: number, value: string) {
    setDraft((current) => ({ ...current, properties: current.properties.map((property, item) => item === index ? { ...property, value: value.trim() !== "" && Number.isFinite(Number(value)) ? Number(value) : value, source: "user" } : property) }));
  }
  return <EngineeringDialog title={entity.name} eyebrow={engineeringLabel(entity.kind, language)} language={language} onClose={onClose}>
    {impact && <EngineeringImpactDetails language={language} model={model} impact={impact} />}
    {editing ? <form className="engineering-form" onSubmit={(event) => { event.preventDefault(); save(); }}>
      <label>{pt ? "Nome" : "Name"}<input value={draft.name} maxLength={140} required onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
      <label>{pt ? "Descrição" : "Description"}<textarea value={draft.description} maxLength={600} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
      {entity.kind !== "system" && <><label>{pt ? "Tipo do elemento" : "Element type"}<select value={draft.kind} onChange={event => { const kind = event.target.value as EngineeringEntity["kind"]; setDraft({ ...draft, kind, parentId: engineeringParentCandidates(model, entity.id, kind).some(item => item.id === draft.parentId) ? draft.parentId : undefined }); }}>{(["subsystem", "component", "interface", "parameter", "calculation", "performance"] as const).map(kind => <option key={kind} value={kind}>{engineeringLabel(kind, language)}</option>)}</select></label><label>{pt ? "Faz parte de" : "Part of"}<select required={draft.kind === "component" || draft.kind === "subsystem"} value={draft.parentId ?? ""} onChange={(event) => setDraft({ ...draft, parentId: event.target.value || undefined })}><option value="">{pt ? "Selecionar elemento superior" : "Select parent element"}</option>{engineeringParentCandidates(model, entity.id, draft.kind).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></>}
      {draft.properties.map((property, index) => <fieldset className="architecture-property-editor" key={property.key}><legend>{pt ? "Parâmetro" : "Parameter"} {index + 1}</legend><label>{pt ? "Nome" : "Name"}<input required maxLength={140} value={property.name} onChange={event => setDraft({ ...draft, properties: draft.properties.map((item, position) => position === index ? { ...item, name: event.target.value } : item) })} /></label><label>{pt ? "Valor" : "Value"}<input required value={String(property.value)} maxLength={500} onChange={(event) => updateProperty(index, event.target.value)} /></label><label>{pt ? "Unidade" : "Unit"}<input maxLength={30} value={property.unit ?? ""} onChange={event => setDraft({ ...draft, properties: draft.properties.map((item, position) => position === index ? { ...item, unit: event.target.value } : item) })} /></label><button type="button" aria-label={`${pt ? "Remover parâmetro" : "Remove parameter"} ${property.name}`} onClick={() => setDraft({ ...draft, properties: draft.properties.filter((_, position) => position !== index) })}><Trash2 /></button></fieldset>)}
      <button type="button" className="engineering-text-button" onClick={() => setDraft({ ...draft, properties: [...draft.properties, { key: `parameter-${crypto.randomUUID()}`, name: "", value: "", source: "user", evidenceRefs: [] }] })}><Plus />{pt ? "Adicionar parâmetro" : "Add parameter"}</button>
      <CorrectionSources language={language} model={model} refs={correctionRefs} onChange={setCorrectionRefs} />
      {error && <p className="engineering-error" role="alert">{error}</p>}
      <footer><button type="button" onClick={() => setEditing(false)}>{pt ? "Cancelar" : "Cancel"}</button><button type="submit" className="primary"><Check aria-hidden="true" />{pt ? "Salvar correção" : "Save correction"}</button></footer>
    </form> : <>
      {entity.description && <p>{entity.description}</p>}
      {entity.parentId && <p className="engineering-muted">{pt ? "Faz parte de" : "Part of"} · {model.entities.find((item) => item.id === entity.parentId)?.name}</p>}
      <dl className="engineering-properties">{entity.properties.map((property) => <div key={property.key}><dt>{property.name}<small>{engineeringLabel(property.source, language)}</small></dt><dd>{formatEngineeringValue(property)}</dd>{property.evidenceRefs.length > 0 && <EngineeringEvidenceList language={language} model={model} refs={property.evidenceRefs} />}</div>)}</dl>
      <div className="engineering-provenance"><small>{engineeringLabel(entity.source, language)}{entity.source === "inferred" && ` · ${Math.round(entity.confidence * 100)}%`}</small><EngineeringEvidenceList language={language} model={model} refs={entity.evidenceRefs} /></div>
      <details className="engineering-disclosure"><summary>{pt ? "Dependências diretas" : "Direct dependencies"} · {relations.length}</summary>{relations.map((relation) => <button key={relation.id} type="button" className="engineering-relation-row" onClick={() => onRelation(relation)}>{model.entities.find((item) => item.id === relation.from)?.name ?? relation.from}<span>{engineeringLabel(relation.kind, language)}</span>{model.entities.find((item) => item.id === relation.to)?.name ?? model.requirements.find((item) => item.id === relation.to)?.title ?? relation.to}</button>)}{onModelChange && <button type="button" className="engineering-text-button" onClick={() => onRelation({ id: "", from: entity.id, to: "", kind: "depends_on", label: "", source: "user", evidenceRefs: [], confidence: 1 })}><Plus aria-hidden="true" />{pt ? "Vincular elemento" : "Link an element"}</button>}</details>
      {!impact && <EngineeringCorrectionHistory language={language} model={model} targetId={entity.kind === "system" ? undefined : entity.id} />}
      {onModelChange && <footer className="engineering-dialog-actions"><button type="button" onClick={() => { setDraft(entity); setEditing(true); }}><Pencil aria-hidden="true" />{pt ? "Corrigir" : "Correct"}</button></footer>}
    </>}
  </EngineeringDialog>;
}

export function EngineeringRelationInfo({ language, model, relation, onClose, onModelChange, correctionContext }: { language: Language; model: EngineeringSystemModel; relation: EngineeringRelation; onClose: () => void; onModelChange?: (model: EngineeringSystemModel) => void; correctionContext?: EngineeringCorrectionProjectContext }) {
  const [draft, setDraft] = useState(relation);
  const pt = language === "pt";
  const [editing, setEditing] = useState(!relation.id);
  const [error, setError] = useState("");
  const targets = [...model.entities.map((entity) => ({ id: entity.id, name: entity.name })), ...model.requirements.map((requirement) => ({ id: requirement.id, name: requirement.title }))];
  const from = targets.find((item) => item.id === relation.from);
  const to = targets.find((item) => item.id === relation.to);
  function fail(reason: unknown) {
    setError(correctionError(reason, language));
  }
  return <EngineeringDialog language={language} title={pt ? "Relação técnica" : "Technical relationship"} onClose={onClose}>
    {editing ? <form className="engineering-form" onSubmit={(event) => {
      event.preventDefault();
      try { onModelChange?.(correctEngineeringRelation(model, relation.id ? relation : null, draft, new Date().toISOString(), { project: correctionContext })); onClose(); } catch (reason) { fail(reason); }
    }}>
      <label>{pt ? "Elemento de origem" : "Source element"}<select value={draft.from} required onChange={(event) => setDraft({ ...draft, from: event.target.value })}>{targets.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>{pt ? "Relação" : "Relationship"}<select value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value as EngineeringRelation["kind"] })}>{ENGINEERING_RELATION_KINDS.map((kind) => <option key={kind} value={kind}>{engineeringLabel(kind, language)}</option>)}</select></label>
      <label>{pt ? "Elemento de destino" : "Target element"}<select value={draft.to} required onChange={(event) => setDraft({ ...draft, to: event.target.value })}><option value="">{pt ? "Selecionar" : "Select"}</option>{targets.filter((item) => item.id !== draft.from).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>{pt ? "Nota curta" : "Short note"}<input value={draft.label} maxLength={160} onChange={(event) => setDraft({ ...draft, label: event.target.value })} /></label>
      <CorrectionSources language={language} model={model} refs={draft.evidenceRefs} onChange={(evidenceRefs) => setDraft({ ...draft, evidenceRefs })} />
      {error && <p className="engineering-error" role="alert">{error}</p>}
      <footer><button type="submit" className="primary">{pt ? "Salvar relação" : "Save relationship"}</button></footer>
    </form> : <>
      <p className="engineering-relation-description">{from?.name}<span>{engineeringLabel(relation.kind, language)}</span>{to?.name}</p>{relation.label && <p>{relation.label}</p>}<small>{engineeringLabel(relation.source, language)}{relation.source === "inferred" && ` · ${Math.round(relation.confidence * 100)}%`}</small><EngineeringEvidenceList language={language} model={model} refs={relation.evidenceRefs} />
      <EngineeringCorrectionHistory language={language} model={model} targetId={relation.id} />
      {error && <p className="engineering-error" role="alert">{error}</p>}
      {onModelChange && <footer className="engineering-dialog-actions"><button type="button" onClick={() => { try { onModelChange(removeEngineeringRelation(model, relation.id, { project: correctionContext })); onClose(); } catch (reason) { fail(reason); } }}><Trash2 aria-hidden="true" />{pt ? "Remover relação" : "Remove relationship"}</button><button type="button" onClick={() => setEditing(true)}><Pencil aria-hidden="true" />{pt ? "Corrigir" : "Correct"}</button></footer>}
    </>}
  </EngineeringDialog>;
}

export function EngineeringRequirements({ language, model, impacts = [], onClose, onTrace, onEdit, docked = false }: { language: Language; model: EngineeringSystemModel; impacts?: EngineeringImpact[]; docked?: boolean; onClose: () => void; onTrace: (requirement: EngineeringRequirement) => void; onEdit: (requirement: EngineeringRequirement) => void }) {
  const [filters, setFilters] = useState<RequirementFilters>({});
  const [facets, setFacets] = useState(false);
  const pt = language === "pt";
  const requirements = filterEngineeringRequirements(model.requirements, filters);
  const tags = [...new Set(model.requirements.flatMap((item) => [...item.subsystemTags, ...item.reviewTags, item.category ?? ""]).filter(Boolean))].sort();
  const sources = model.evidence.filter((item) => model.requirements.some((requirement) => requirement.sourceRefs.includes(item.id)));
  const filterCount = [filters.tag, filters.source, filters.status].filter(Boolean).length;
  const content = <>
    <div className="engineering-requirements-search"><label><span className="engineering-sr-only">{pt ? "Buscar requisitos" : "Search requirements"}</span><input type="search" value={filters.query ?? ""} placeholder={pt ? "Buscar texto, referência ou disciplina" : "Search text, reference or discipline"} onChange={(event) => setFilters({ ...filters, query: event.target.value })} /></label><button type="button" aria-expanded={facets} onClick={() => setFacets(!facets)}><SlidersHorizontal aria-hidden="true" />{pt ? "Filtrar" : "Filter"}{filterCount ? ` · ${filterCount}` : ""}</button></div>
    {facets && <div className="engineering-requirement-facets"><label>{pt ? "Disciplina / revisão" : "Discipline / review"}<select value={filters.tag ?? ""} onChange={(event) => setFilters({ ...filters, tag: event.target.value })}><option value="">{pt ? "Todas" : "All"}</option>{tags.map((tag) => <option key={tag} value={tag}>{tag}</option>)}</select></label><label>Status<select value={filters.status ?? ""} onChange={(event) => setFilters({ ...filters, status: event.target.value })}><option value="">{pt ? "Todos" : "All"}</option>{["unreviewed", "accepted", "review", "verified"].map((status) => <option value={status} key={status}>{engineeringLabel(status, language)}</option>)}</select></label><label>{pt ? "Fonte" : "Source"}<select value={filters.source ?? ""} onChange={(event) => setFilters({ ...filters, source: event.target.value })}><option value="">{pt ? "Todas" : "All"}</option>{sources.map((source) => <option key={source.id} value={source.id}>{source.artifactLabel}{source.locator ? ` · ${source.locator}` : ""}</option>)}</select></label>{filterCount > 0 && <button type="button" onClick={() => setFilters({ query: filters.query })}>{pt ? "Limpar filtros" : "Clear filters"}</button>}</div>}
    <div className="engineering-requirements-list">{requirements.map((requirement) => {
      const impact = impacts.find((item) => item.entityId === requirement.id);
      return <article key={requirement.id} className="engineering-requirement-row"><button type="button" className="engineering-requirement-main" onClick={() => onTrace(requirement)}><span><strong>{requirement.title}</strong><small className={impact ? `status-${impact.status}` : ""}>{engineeringLabel(impact?.status ?? requirement.status, language)}</small></span><p>{requirement.statement}</p><em>{[...requirement.subsystemTags, ...requirement.reviewTags].join(" · ")}</em></button><button className="engineering-text-button" type="button" onClick={() => onEdit(requirement)} aria-label={`${pt ? "Inspecionar e corrigir" : "Inspect and correct"} ${requirement.title}`}><Pencil aria-hidden="true" /></button></article>;
    })}</div>
    {!requirements.length && <p className="engineering-muted">{model.requirements.length ? pt ? "Nenhum requisito corresponde aos filtros." : "No requirements match these filters." : pt ? "A memória ainda não contém requisitos identificáveis." : "The memory does not contain identifiable requirements yet."}</p>}
    {requirements.length > 0 && <p className="engineering-muted">{pt ? "Selecione um requisito para ver o que ele restringe no sistema." : "Select a requirement to see what it constrains in the system."}</p>}
  </>;
  return docked ? <aside className="engineering-requirements-panel" aria-label={pt ? "Requisitos do sistema" : "System requirements"}>
    <header><strong>{pt ? "Requisitos" : "Requirements"} <small>{model.requirements.length}</small></strong><button type="button" onClick={onClose} aria-label={pt ? "Fechar requisitos" : "Close requirements"}><X /></button></header>{content}
  </aside> : <EngineeringDialog language={language} title={`${pt ? "Requisitos" : "Requirements"} · ${model.requirements.length}`} onClose={onClose} wide>{content}</EngineeringDialog>;
}

export function EngineeringRequirementInfo({ language, model, requirement, impact, onClose, onModelChange, onTrace, correctionContext }: { language: Language; model: EngineeringSystemModel; requirement: EngineeringRequirement; impact?: EngineeringImpact; onClose: () => void; onModelChange?: (model: EngineeringSystemModel) => void; onTrace: () => void; correctionContext?: EngineeringCorrectionProjectContext }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(requirement);
  const [error, setError] = useState("");
  const pt = language === "pt";
  function propertyValue(property: EngineeringProperty, value: string): EngineeringProperty { return { ...property, value: value.trim() && Number.isFinite(Number(value)) ? Number(value) : value, source: "user" }; }
  return <EngineeringDialog language={language} eyebrow={pt ? "Requisito" : "Requirement"} title={requirement.title} onClose={onClose}>
    {impact && <EngineeringImpactDetails language={language} model={model} impact={impact} />}
    {editing ? <form className="engineering-form" onSubmit={(event) => { event.preventDefault(); try { onModelChange?.(correctEngineeringRequirement(model, requirement, draft, new Date().toISOString(), { project: correctionContext })); setEditing(false); setError(""); } catch (reason) { setError(correctionError(reason, language)); } }}>
      <label>{pt ? "Título" : "Title"}<input value={draft.title} required maxLength={160} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
      <label>{pt ? "Enunciado revisado" : "Reviewed statement"}<textarea value={draft.statement} required maxLength={1200} onChange={(event) => setDraft({ ...draft, statement: event.target.value })} /></label>
      <label>{pt ? "Categoria" : "Category"}<input value={draft.category ?? ""} maxLength={100} onChange={(event) => setDraft({ ...draft, category: event.target.value })} /></label>
      <label>{pt ? "Disciplinas (separadas por vírgula)" : "Disciplines (comma separated)"}<input value={draft.subsystemTags.join(", ")} onChange={(event) => setDraft({ ...draft, subsystemTags: event.target.value.split(",").map((tag) => tag.trim()) })} /></label>
      <label>{pt ? "Revisões (separadas por vírgula)" : "Reviews (comma separated)"}<input value={draft.reviewTags.join(", ")} onChange={(event) => setDraft({ ...draft, reviewTags: event.target.value.split(",").map((tag) => tag.trim()) })} /></label>
      <label>Status<select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as EngineeringRequirement["status"] })}>{["unreviewed", "accepted", "review", "verified"].map((status) => <option key={status} value={status}>{engineeringLabel(status, language)}</option>)}</select></label>
      {draft.properties.map((property, index) => <label key={property.key}>{property.name} {property.unit}<input value={String(property.value)} maxLength={500} onChange={(event) => setDraft({ ...draft, properties: draft.properties.map((item, position) => position === index ? propertyValue(item, event.target.value) : item) })} /></label>)}
      <fieldset className="engineering-source-choices"><legend>{pt ? "Evidências vinculadas" : "Linked evidence"}</legend>{model.evidence.map((source) => <label key={source.id}><input type="checkbox" checked={draft.sourceRefs.includes(source.id)} onChange={(event) => setDraft({ ...draft, sourceRefs: event.target.checked ? [...draft.sourceRefs, source.id] : draft.sourceRefs.filter((id) => id !== source.id) })} />{source.artifactLabel}{source.locator ? ` · ${source.locator}` : ""}</label>)}</fieldset>
      {error && <p className="engineering-error" role="alert">{error}</p>}
      <footer><button type="button" onClick={() => setEditing(false)}>{pt ? "Cancelar" : "Cancel"}</button><button type="submit" className="primary">{pt ? "Salvar correção" : "Save correction"}</button></footer>
    </form> : <><p>{requirement.statement}</p><small>{engineeringLabel(requirement.status, language)}</small>{requirement.originalStatement && <details className="engineering-disclosure"><summary>{pt ? "Extração original" : "Original extraction"}</summary><blockquote>{requirement.originalStatement}</blockquote><EngineeringEvidenceList language={language} model={model} refs={requirement.originalSourceRefs ?? requirement.sourceRefs} /></details>}
      <dl className="engineering-properties">{requirement.properties.map((property) => <div key={property.key}><dt>{property.name}<small>{engineeringLabel(property.source, language)}</small></dt><dd>{formatEngineeringValue(property)}</dd></div>)}</dl>
      <p className="engineering-muted">{[requirement.category, ...requirement.subsystemTags, ...requirement.reviewTags].filter(Boolean).join(" · ")}{requirement.classificationSource && ` · ${engineeringLabel(requirement.classificationSource, language)}`}</p><EngineeringEvidenceList language={language} model={model} refs={requirement.sourceRefs} />
      {!impact && <EngineeringCorrectionHistory language={language} model={model} targetId={requirement.id} />}
      <footer className="engineering-dialog-actions">{onModelChange && <button type="button" onClick={() => { setDraft(requirement); setEditing(true); }}><Pencil aria-hidden="true" />{pt ? "Corrigir" : "Correct"}</button>}<button type="button" onClick={onTrace}>{pt ? "Ver no sistema" : "Trace in system"}</button></footer>
    </>}
  </EngineeringDialog>;
}
