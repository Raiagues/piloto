import { useState } from "react";
import { EngineeringDialog } from "./EngineeringDetails";
import type { EngineeringEntityKind, EngineeringSystemModel } from "../lib/engineeringSystem";
import { addEngineeringEntity } from "../lib/engineeringArchitecture";
import { engineeringLabel } from "../lib/engineeringUi";
import type { Language } from "../lib/types";

export function EngineeringArchitectureEditor({ model, language, parentId, onSave, onClose }: { model: EngineeringSystemModel; language: Language; parentId?: string; onSave: (model: EngineeringSystemModel) => void; onClose: () => void }) {
  const pt = language === "pt", initial = model.entities.find(entity => entity.id === parentId);
  const [kind, setKind] = useState<EngineeringEntityKind>(initial?.kind === "subsystem" || initial?.kind === "component" ? "component" : "subsystem");
  const [name, setName] = useState("");
  const [parent, setParent] = useState(initial?.id ?? model.entities[0]?.id ?? "");
  const [error, setError] = useState("");
  const parents = model.entities.filter(entity => ["system", "subsystem", "component"].includes(entity.kind) && (kind === "subsystem" ? entity.kind !== "component" : kind !== "component" || entity.kind === "subsystem"));
  return <EngineeringDialog title={pt ? "Adicionar elemento" : "Add element"} language={language} onClose={onClose}><form className="engineering-form" onSubmit={event => { event.preventDefault(); try { onSave(addEngineeringEntity(model, name, kind, parent)); onClose(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to save"); } }}><label>{pt ? "Nome" : "Name"}<input autoFocus required maxLength={140} value={name} onChange={event => setName(event.target.value)} placeholder={pt ? "Ex.: Sistema de potência" : "E.g. Electrical power system"} /></label><label>{pt ? "Tipo de elemento" : "Element type"}<select value={kind} onChange={event => setKind(event.target.value as EngineeringEntityKind)}>{(["subsystem", "component", "interface", "parameter", "calculation", "performance"] as const).map(type => <option key={type} value={type}>{engineeringLabel(type, language)}</option>)}</select></label><label>{pt ? "Faz parte de" : "Part of"}<select value={parents.some(entity => entity.id === parent) ? parent : ""} required onChange={event => setParent(event.target.value)}><option value="" disabled>{pt ? "Selecione o elemento superior" : "Select the parent element"}</option>{parents.map(entity => <option key={entity.id} value={entity.id}>{entity.name}</option>)}</select></label><p className="engineering-muted">{pt ? "Componentes ficam dentro de subsistemas. Você pode definir parâmetros, interfaces e referências depois." : "Components belong inside subsystems. You can define parameters, interfaces and references later."}</p>{error && <p className="engineering-error" role="alert">{error}</p>}<footer><button type="button" onClick={onClose}>{pt ? "Cancelar" : "Cancel"}</button><button type="submit" className="primary" disabled={!parents.some(entity => entity.id === parent)}>{pt ? "Adicionar" : "Add"}</button></footer></form></EngineeringDialog>;
}
