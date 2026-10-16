import { useAuth } from "../lib/auth";
import { isProjectAdmin } from "../../shared/project-organization.mjs";
import { useMemo, useState } from "react";
import { ArrowLeft, Bookmark, Check, FileCheck2, Network, X, PanelLeftClose, PanelLeftOpen, Plus, ClipboardCheck } from "lucide-react";
import type { EngineeringAnalysis, EngineeringRelation, EngineeringRequirement, EngineeringSystemModel } from "../lib/engineeringSystem";
import { engineeringAncestors, engineeringParentId, engineeringLabel, projectEngineeringScenario, requirementTrace, systemVisibleEntities } from "../lib/engineeringUi";
import type { MissionProject } from "../lib/projectStore";
import type { Language } from "../lib/types";
import { EngineeringDialog, EngineeringEntityInfo, EngineeringRelationInfo, EngineeringRequirementInfo, EngineeringRequirements } from "../components/EngineeringDetails";
import { EngineeringExplorer } from "../components/EngineeringExplorer";
import { SystemGraph } from "../components/SystemGraph";
import { EngineeringArchitectureView } from "../components/EngineeringArchitectureView";
import { EngineeringArchitectureEditor } from "../components/EngineeringArchitectureEditor";
import { architectureIssues, createManualEngineeringSystem, mergeEngineeringAliases } from "../lib/engineeringArchitecture";
import { architectureAliasCandidates } from "../../shared/engineering-architecture.mjs";
import "../engineering-system.css";
import "../engineering-architecture.css";

type Inspection = { kind: "entity"; id: string } | { kind: "relation"; relation: EngineeringRelation } | { kind: "requirement"; id: string } | null;

export function EngineeringScenario({ language, model, analysis, onClear, onSave, saved = false }: { language: Language; model: EngineeringSystemModel; analysis: EngineeringAnalysis; onClear: () => void; onSave?: () => void; saved?: boolean }) {
  const [selectedId, setSelectedId] = useState<string | null>(analysis.changedEntityId);
  const [inspection, setInspection] = useState<Inspection>(null);
  const [trace, setTrace] = useState<EngineeringRequirement | null>(null);
  const [requirementsOpen, setRequirementsOpen] = useState(false);
  const pt = language === "pt";
  const scenarioModel = useMemo(() => projectEngineeringScenario(model, analysis), [model, analysis]);
  const relevantIds = useMemo(() => new Set(analysis.impacts.filter((impact) => impact.status !== "unaffected").flatMap((impact) => [impact.entityId, ...impact.path])), [analysis]);
  const entities = useMemo(() => systemVisibleEntities(scenarioModel, null, relevantIds), [scenarioModel, relevantIds]);
  const requirementPriority = (id: string) => ({ critical: 0, review: 1, changed: 2, valid: 3, unaffected: 4 })[analysis.impacts.find((impact) => impact.entityId === id)?.status ?? "unaffected"];
  const affectedRequirements = scenarioModel.requirements.filter((requirement) => analysis.impacts.some((impact) => impact.entityId === requirement.id && impact.status !== "unaffected")).sort((first, second) => requirementPriority(first.id) - requirementPriority(second.id));
  const highlighted = trace ? requirementTrace(scenarioModel, trace) : null;
  const entity = inspection?.kind === "entity" ? scenarioModel.entities.find((item) => item.id === inspection.id) : undefined;
  const requirement = inspection?.kind === "requirement" ? scenarioModel.requirements.find((item) => item.id === inspection.id) : undefined;
  function traceRequirement(next: EngineeringRequirement) { setTrace(next); setInspection(null); }
  return <section className="engineering-workspace engineering-scenario">
    <header className="engineering-workspace-bar"><div className="engineering-scenario-title"><small>{pt ? "Cenário · baseline preservado" : "Scenario · baseline preserved"}</small><strong>{analysis.change.description}</strong></div><div className="engineering-bar-actions">{onSave && <button type="button" disabled={saved} onClick={onSave}>{saved ? <Check aria-hidden="true" /> : <Bookmark aria-hidden="true" />}{saved ? pt ? "Salvo" : "Saved" : pt ? "Salvar cenário" : "Save scenario"}</button>}<button type="button" onClick={onClear}><X aria-hidden="true" />{pt ? "Limpar análise" : "Clear analysis"}</button></div></header>
    <div className="engineering-workspace-body"><div className="engineering-canvas-shell">
      <SystemGraph key={analysis.id} language={language} model={scenarioModel} entities={entities} selectedId={selectedId} highlightIds={highlighted?.entities} highlightRelationIds={highlighted?.relations} analysis={analysis} onSelect={(item) => setSelectedId(item.id)} onInfo={(item) => setInspection({ kind: "entity", id: item.id })} onRelation={(relation) => setInspection({ kind: "relation", relation })} />
      {trace && <div className="engineering-trace-bar"><FileCheck2 aria-hidden="true" /><strong>{trace.title}</strong><span>{trace.statement}</span><button type="button" onClick={() => setTrace(null)} aria-label={pt ? "Limpar destaque do requisito" : "Clear requirement highlight"}><X aria-hidden="true" /></button></div>}
      {affectedRequirements.length > 0 && <div className="engineering-scenario-requirements"><button type="button" className="engineering-requirements-trigger" onClick={() => setRequirementsOpen(!requirementsOpen)}><FileCheck2 aria-hidden="true" />{affectedRequirements.length} {pt ? affectedRequirements.length === 1 ? "requisito afetado" : "requisitos afetados" : affectedRequirements.length === 1 ? "requirement affected" : "requirements affected"}</button>{affectedRequirements.slice(0, 3).map((item) => <button type="button" key={item.id} className={`engineering-requirement-impact status-${analysis.impacts.find((impact) => impact.entityId === item.id)?.status}`} onClick={() => setInspection({ kind: "requirement", id: item.id })}>{item.title}<span>{engineeringLabel(analysis.impacts.find((impact) => impact.entityId === item.id)?.status ?? "review", language)}</span></button>)}</div>}
      {analysis.unresolvedQuestions.length > 0 && <details className="engineering-missing-information"><summary>{pt ? "Informação necessária" : "Information needed"} · {analysis.unresolvedQuestions.length}</summary><ul>{analysis.unresolvedQuestions.map((question, index) => <li key={index}>{question}</li>)}</ul></details>}
    </div>
    {requirementsOpen && <EngineeringRequirements docked language={language} model={{ ...scenarioModel, requirements: affectedRequirements }} impacts={analysis.impacts} onClose={() => setRequirementsOpen(false)} onTrace={traceRequirement} onEdit={(item) => setInspection({ kind: "requirement", id: item.id })} />}</div>
    {entity && <EngineeringEntityInfo language={language} model={scenarioModel} entity={entity} impact={analysis.impacts.find((impact) => impact.entityId === entity.id)} onClose={() => setInspection(null)} onRelation={(relation) => setInspection({ kind: "relation", relation })} />}
    {inspection?.kind === "relation" && <EngineeringRelationInfo language={language} model={scenarioModel} relation={inspection.relation} onClose={() => setInspection(null)} />}
    {requirement && <EngineeringRequirementInfo language={language} model={scenarioModel} requirement={requirement} impact={analysis.impacts.find((impact) => impact.entityId === requirement.id)} onClose={() => setInspection(null)} onTrace={() => traceRequirement(requirement)} />}
  </section>;
}

export function SystemWorkspace({ language, project, onProjectChange, onBackSetup }: { language: Language; project: MissionProject; onProjectChange: (project: MissionProject) => void; onBackSetup: () => void }) {
  const { user } = useAuth();
  const canEdit = isProjectAdmin(project, user);
  const model = project.engineeringSystem;
  const [treeOpen, setTreeOpen] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(model?.entities.filter(entity => !engineeringParentId(model, entity)).map(entity => entity.id)));
  const [scopeId, setScopeId] = useState<string | null>(null);
  const [inspection, setInspection] = useState<Inspection>(null);
  const [adding, setAdding] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [reviewError, setReviewError] = useState("");
  const pt = language === "pt";
  const aliases = useMemo(() => model ? architectureAliasCandidates(model) : [], [model]);
  const issues = useMemo(() => model ? architectureIssues(model) : [], [model]);
  const entity = inspection?.kind === "entity" ? model?.entities.find(item => item.id === inspection.id) : undefined;
  function updateModel(next: EngineeringSystemModel) { onProjectChange({ ...project, engineeringSystem: next, phaseProgress: { highestUnlockedStep: Math.max(1, project.phaseProgress.highestUnlockedStep) as 1 | 2 } }); }
  function selectScope(id: string | null) {
    if (!model) return;
    if (id) setExpanded(current => new Set([...current, ...engineeringAncestors(model, id).map(item => item.id)]));
    setScopeId(id);
  }
  if (!model || !model.entities.length) return <section className="engineering-workspace engineering-empty architecture-start"><Network aria-hidden="true" /><small>{pt ? "ARQUITETURA DO PRODUTO" : "PRODUCT ARCHITECTURE"}</small><h2>{pt ? "Comece pelo seu sistema" : "Start with your system"}</h2><p>{pt ? "Descreva a estrutura do projeto mesmo sem documentos. Adicione subsistemas, componentes e interfaces à medida que as decisões forem tomadas." : "Describe your project even without documents. Add subsystems, components and interfaces as design decisions are made."}</p><div>{canEdit && <button type="button" className="architecture-primary" onClick={() => updateModel(createManualEngineeringSystem(project.name || (pt ? "Novo sistema" : "New system"), project.memoryRevision))}><Plus />{pt ? "Criar arquitetura manualmente" : "Create architecture manually"}</button>}<button type="button" onClick={onBackSetup}><ArrowLeft aria-hidden="true" />{pt ? "Adicionar documentos" : "Add documents"}</button></div></section>;
  const outline = { ...model, entities: model.entities.filter(item => ["system", "subsystem"].includes(item.kind)) };
  return <section className="engineering-workspace architecture-workspace">
    <header className="engineering-workspace-bar"><div className="engineering-model-title"><Network /><strong>{project.name}</strong><small>{model.entities.length} {pt ? "elementos" : "elements"}</small></div><div className="engineering-bar-actions">{aliases.length + issues.length > 0 && <button type="button" className="architecture-review-trigger" onClick={() => setReviewing(true)}><ClipboardCheck />{pt ? "Revisar estrutura" : "Review structure"}<span>{aliases.length + issues.length}</span></button>}{canEdit && <button type="button" className="architecture-primary" onClick={() => setAdding(true)}><Plus />{pt ? "Adicionar elemento" : "Add element"}</button>}</div></header>
    <div className="engineering-workspace-body">
      <div className={`engineering-hierarchy-panel ${treeOpen ? "open" : "closed"}`}><button type="button" className="engineering-hierarchy-toggle" aria-label={pt ? treeOpen ? "Recolher hierarquia" : "Expandir hierarquia" : treeOpen ? "Collapse hierarchy" : "Expand hierarchy"} aria-expanded={treeOpen} onClick={() => setTreeOpen(!treeOpen)}>{treeOpen ? <PanelLeftClose /> : <PanelLeftOpen />}{treeOpen && <span>{pt ? "Navegar pelo sistema" : "Browse system"}</span>}</button>{treeOpen && <EngineeringExplorer model={outline} language={language} selectedId={scopeId} expandedIds={expanded} onToggle={id => setExpanded(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; })} onSelect={selectScope} onOverview={() => selectScope(null)} />}</div>
      <EngineeringArchitectureView key={model.id} model={{ ...model, name: project.name }} language={language} scopeId={scopeId} onScope={selectScope} onInfo={item => setInspection({ kind: "entity", id: item.id })} onRelation={relation => setInspection({ kind: "relation", relation })} />
    </div>
    {adding && <EngineeringArchitectureEditor model={model} language={language} parentId={scopeId ?? model.entities.find(item => item.kind === "system")?.id} onSave={updateModel} onClose={() => setAdding(false)} />}
    {reviewing && <EngineeringDialog title={pt ? "Revisão da estrutura" : "Structure review"} language={language} onClose={() => setReviewing(false)}><p>{pt ? "Consolide registros duplicados e confira o nível de cada elemento. Cada correção preserva as fontes e o histórico." : "Consolidate duplicate records and review each element's level. Every correction preserves sources and history."}</p>{aliases.map(group => <article className="architecture-review-item" key={group.canonicalId}><strong>{pt ? "Possíveis nomes equivalentes" : "Possible equivalent names"}</strong><ul>{group.entityIds.map((id: string) => <li key={id}><button type="button" onClick={() => { setReviewing(false); setInspection({ kind: "entity", id }); }}>{model.entities.find(item => item.id === id)?.name}</button></li>)}</ul>{group.conflicts.length > 0 && <p>{pt ? "Valores conflitantes: " : "Conflicting values: "}{group.conflicts.join(", ")}</p>}{canEdit && <button type="button" disabled={group.conflicts.length > 0 || !group.descriptionFits} onClick={() => { try { updateModel(mergeEngineeringAliases(model, group.entityIds, { project: { projectId: project.id, projectName: project.name } })); setReviewError(""); } catch (error) { setReviewError(error instanceof Error ? error.message : "Unable to merge"); } }}>{pt ? "Consolidar registros e referências" : "Consolidate records and references"}</button>}</article>)}{issues.map(item => <article key={item.id} className="architecture-review-item"><strong>{item.name}</strong><p>{item.kind === "component" ? pt ? "Componente sem subsistema definido." : "Component without a defined subsystem." : pt ? "Este nome sugere uma peça ou montagem. Confira se deve ser componente de um subsistema." : "This name suggests a part or assembly. Review whether it belongs inside a subsystem."}</p><button type="button" onClick={() => { setReviewing(false); setInspection({ kind: "entity", id: item.id }); }}>{pt ? "Revisar classificação e fontes" : "Review classification and sources"}</button></article>)}{!aliases.length && !issues.length && <p>{pt ? "Nenhuma inconsistência estrutural automática pendente. A revisão técnica da equipe continua necessária." : "No automatic structural issues remain. Team engineering review is still needed."}</p>}{reviewError && <p role="alert" className="engineering-error">{reviewError}</p>}</EngineeringDialog>}
    {entity && <EngineeringEntityInfo language={language} model={model} entity={entity} onClose={() => setInspection(null)} {...(canEdit ? { onModelChange: updateModel } : {})} onRelation={relation => setInspection({ kind: "relation", relation })} correctionContext={{ projectId: project.id, projectName: project.name }} />}
    {inspection?.kind === "relation" && <EngineeringRelationInfo language={language} model={model} relation={inspection.relation} onClose={() => setInspection(null)} {...(canEdit ? { onModelChange: updateModel } : {})} correctionContext={{ projectId: project.id, projectName: project.name }} />}
  </section>;
}
