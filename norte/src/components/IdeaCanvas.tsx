import { useMemo, useState } from 'react';
import { ArrowUpLeft, Link2, Plus, Search } from 'lucide-react';
import { SystemGraph } from './SystemGraph';
import { EngineeringArchitectureEditor } from './EngineeringArchitectureEditor';
import { EngineeringEntityInfo, EngineeringRelationInfo } from './EngineeringDetails';
import { engineeringParentId, type GraphPositions } from '../lib/engineeringUi';
import type { EngineeringAnalysis, EngineeringEntity, EngineeringRelation, EngineeringSystemModel } from '../lib/engineeringSystem';
import type { Language } from '../lib/types';

export function IdeaCanvas({ model, language, analysis, editable, positions, onChange, onPositionsChange }: {
  model: EngineeringSystemModel; language: Language; analysis?: EngineeringAnalysis | null; editable: boolean;
  positions: GraphPositions; onChange: (model: EngineeringSystemModel) => void; onPositionsChange: (positions: GraphPositions) => void;
}) {
  const pt = language === 'pt';
  const [selected, setSelected] = useState<string | null>(null), [entity, setEntity] = useState<EngineeringEntity | null>(null), [relation, setRelation] = useState<EngineeringRelation | null>(null), [adding, setAdding] = useState(false), [query, setQuery] = useState(''), [scope, setScope] = useState<string | null>(null), [showAll, setShowAll] = useState(false);
  const root = model.entities.find(e => e.id === scope) || model.entities.find(e => e.kind === 'system');
  const impactIds = useMemo(() => new Set(analysis?.impacts.filter(i => i.status !== 'unaffected').flatMap(i => [i.entityId, ...i.path]) || []), [analysis]);
  const entities = useMemo(() => {
    if (showAll || model.entities.length <= 12) return model.entities;
    const ids = new Set(model.entities.filter(e => e.id === root?.id || engineeringParentId(model, e) === root?.id || impactIds.has(e.id)).map(e => e.id));
    if (selected) ids.add(selected);
    return model.entities.filter(e => ids.has(e.id));
  }, [model, root?.id, showAll, impactIds, selected]);
  return <div className="idea-canvas engineering-workspace">
    <div className="idea-canvas-toolbar"><div className="idea-canvas-search"><Search size={15}/><input aria-label={pt ? 'Localizar elemento' : 'Find element'} placeholder={pt ? 'Localizar no mapa…' : 'Find on map…'} value={query} onChange={e => setQuery(e.target.value)}/>{query && <div role="listbox">{model.entities.filter(e => e.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())).slice(0, 12).map(e => <button key={e.id} onClick={() => { setSelected(e.id); setScope(e.parentId || null); setQuery(''); }}>{e.name}</button>)}</div>}</div><button aria-pressed={showAll} onClick={() => setShowAll(v => !v)}>{showAll ? (pt ? 'Visão por subsistema' : 'Subsystem view') : (pt ? 'Ver mapa completo' : 'Full map')}</button>{editable && <><button onClick={() => setAdding(true)}><Plus size={15}/>{pt ? 'Elemento' : 'Element'}</button><button onClick={() => setRelation({ id: '', from: selected || root?.id || '', to: '', kind: 'depends_on', label: '', source: 'user', evidenceRefs: [], confidence: 1 })}><Link2 size={15}/>{pt ? 'Conexão' : 'Connection'}</button></>}</div>
    {scope && <button className="idea-canvas-up" onClick={() => { setScope(root?.parentId || null); setSelected(null); }}><ArrowUpLeft size={14}/>{pt ? 'Subir um nível' : 'Up one level'}</button>}
    <SystemGraph language={language} model={model} entities={entities} selectedId={selected} highlightIds={impactIds.size ? impactIds : undefined} analysis={analysis} onSelect={e => { setSelected(e.id); if (model.entities.some(child => engineeringParentId(model, child) === e.id)) setScope(e.id); else setEntity(e); }} onInfo={setEntity} onRelation={setRelation} onClearSelection={() => setSelected(null)} positions={positions} onPositionsChange={editable ? onPositionsChange : undefined} editable={editable}/>
    <div className="idea-canvas-caption">{pt ? 'Clique para explorar · abra os detalhes para editar' : 'Click to explore · open details to edit'}{editable && <span>{pt ? 'Arraste para organizar a cópia' : 'Drag to arrange this copy'}</span>}</div>
    {entity && <EngineeringEntityInfo key={entity.id} language={language} model={model} entity={model.entities.find(e => e.id === entity.id) || entity} impact={analysis?.impacts.find(i => i.entityId === entity.id)} onClose={() => setEntity(null)} onModelChange={editable ? onChange : undefined} onRelation={value => { setEntity(null); setRelation(value); }}/>} 
    {relation && <EngineeringRelationInfo key={relation.id} language={language} model={model} relation={relation} onClose={() => setRelation(null)} onModelChange={editable ? onChange : undefined}/>}
    {adding && <EngineeringArchitectureEditor language={language} model={model} parentId={selected || root?.id} onClose={() => setAdding(false)} onSave={onChange}/>}
  </div>;
}
