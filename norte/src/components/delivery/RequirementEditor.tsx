import { useState } from 'react';
import { Search } from 'lucide-react';
import { DeliveryOwner, DeliverySector } from './DeliveryShared';
import { deliveryMethods } from '../../lib/projectDelivery';
import type { DeliveryRequirement, DeliveryState } from '../../lib/projectDelivery';

type Draft = Pick<DeliveryRequirement, 'title' | 'statement' | 'sectorId' | 'method' | 'entityIds' | 'sourceRefs' | 'artifactIds' | 'parentIds' | 'rationale' | 'acceptanceCriteria' | 'condition' | 'ownerId' | 'level' | 'criticality' | 'sourceLocator'>;

function LinkPicker({ label, choices, selected, onChange, pt }: { label: string; choices: { id: string; label: string }[]; selected: string[]; onChange: (ids: string[]) => void; pt: boolean }) {
  const [query, setQuery] = useState('');
  if (!choices.length) return null;
  const matches = choices.filter(item => `${item.id} ${item.label}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  return <details className="requirement-link-picker"><summary>{label}<span>{selected.length}</span></summary>
    <label className="requirements-search"><Search size={15} /><input type="search" aria-label={`${pt ? 'Buscar' : 'Search'} ${label}`} placeholder={pt ? 'Buscar para vincular…' : 'Search to link…'} value={query} onChange={event => setQuery(event.target.value)} /></label>
    <div className="requirement-link-options">{matches.map(item => <label key={item.id}><input type="checkbox" checked={selected.includes(item.id)} onChange={event => onChange(event.target.checked ? [...selected, item.id] : selected.filter(id => id !== item.id))} /><span>{item.label}</span></label>)}{!matches.length && <p>{pt ? 'Nenhum resultado' : 'No results'}</p>}</div>
  </details>;
}

export function RequirementEditor({ data, original, busy, error, pt, onClose, onSave }: { data: DeliveryState; original: DeliveryRequirement | null; busy: boolean; error: string; pt: boolean; onClose: () => void; onSave: (draft: Draft) => Promise<void> }) {
  const [tab, setTab] = useState('statement');
  const [draft, setDraft] = useState<Draft>(original || { title: '', statement: '', sectorId: data.permissions.manage ? '' : data.permissions.editableSectorIds[0] || '', method: 'unspecified', entityIds: [], sourceRefs: [], artifactIds: [], parentIds: [] });
  const patch = (value: Partial<Draft>) => setDraft(current => ({ ...current, ...value }));
  return <form className="requirement-editor" onSubmit={event => { event.preventDefault(); void onSave(draft); }}>
    <nav className="requirement-tabs" aria-label={pt ? 'Edição do requisito' : 'Requirement editing'}>{[['statement', pt ? 'Requisito' : 'Requirement'], ['verification', pt ? 'Aceitação' : 'Acceptance'], ['links', pt ? 'Vínculos' : 'Links']].map(([id, title]) => <button type="button" key={id} aria-pressed={tab === id} onClick={() => setTab(id)}>{title}</button>)}</nav>
    <div hidden={tab !== 'statement'}>
      <label>{pt ? 'Título' : 'Title'}<input autoFocus required maxLength={160} value={draft.title} onChange={event => patch({ title: event.target.value })} /></label>
      <label>{pt ? 'Enunciado' : 'Statement'}<textarea required maxLength={1200} value={draft.statement} onChange={event => patch({ statement: event.target.value })} placeholder={pt ? 'O sistema deve…' : 'The system shall…'} /></label>
      <div className="delivery-form-grid"><DeliverySector data={data} value={draft.sectorId} onChange={sectorId => patch({ sectorId })} pt={pt} /><DeliveryOwner data={data} value={draft.ownerId || ''} onChange={ownerId => patch({ ownerId })} pt={pt} /></div>
      <label>{pt ? 'Nível de alocação' : 'Allocation level'}<select value={draft.level || 'system'} onChange={event => patch({ level: event.target.value })}><option value="system">{pt ? 'Sistema' : 'System'}</option><option value="subsystem">{pt ? 'Subsistema' : 'Subsystem'}</option><option value="component">{pt ? 'Componente' : 'Component'}</option></select></label>
      <label>{pt ? 'Justificativa' : 'Rationale'}<textarea value={draft.rationale || ''} onChange={event => patch({ rationale: event.target.value })} maxLength={4000} /></label>
    </div>
    <div hidden={tab !== 'verification'}>
      <label>{pt ? 'Método de verificação' : 'Verification method'}<select value={draft.method} onChange={event => patch({ method: event.target.value })}>{deliveryMethods.map(method => <option key={method.id} value={method.id}>{pt ? method.pt : method.en}</option>)}</select></label>
      <label>{pt ? 'Critério de aceitação' : 'Acceptance criterion'}<textarea value={draft.acceptanceCriteria || ''} onChange={event => patch({ acceptanceCriteria: event.target.value })} maxLength={4000} placeholder={pt ? 'Limite mensurável, unidade e resultado esperado.' : 'Measurable limit, unit and expected result.'} /></label>
      <label>{pt ? 'Condições e premissas' : 'Conditions and assumptions'}<textarea value={draft.condition || ''} onChange={event => patch({ condition: event.target.value })} maxLength={2000} /></label>
    </div>
    <div hidden={tab !== 'links'}>
      <label>{pt ? 'Localização no documento de origem' : 'Source document location'}<input value={draft.sourceLocator || ''} maxLength={500} placeholder={pt ? 'Ex.: § 3.2, requisito 04, página 12' : 'E.g. § 3.2, requirement 04, page 12'} onChange={event => patch({ sourceLocator: event.target.value })} /></label>
      <LinkPicker pt={pt} label={pt ? 'Documentos' : 'Documents'} choices={data.artifacts.map(item => ({ id: item.id, label: item.label }))} selected={draft.artifactIds} onChange={artifactIds => patch({ artifactIds })} />
      <LinkPicker pt={pt} label={pt ? 'Requisitos de origem' : 'Parent requirements'} choices={data.requirements.filter(item => !item.archived && item.id !== original?.id).map(item => ({ id: item.id, label: `${item.id} · ${item.title}` }))} selected={draft.parentIds} onChange={parentIds => patch({ parentIds })} />
      <LinkPicker pt={pt} label={pt ? 'Elementos da arquitetura' : 'Architecture elements'} choices={data.entities.map(item => ({ id: item.id, label: item.name }))} selected={draft.entityIds} onChange={entityIds => patch({ entityIds })} />
      <LinkPicker pt={pt} label={pt ? 'Trechos de origem' : 'Source excerpts'} choices={data.evidence.map(item => ({ id: item.id, label: `${item.artifactLabel} · ${item.locator || item.excerpt.slice(0, 80)}` }))} selected={draft.sourceRefs} onChange={sourceRefs => patch({ sourceRefs })} />
    </div>
    {original && <small className="delivery-note">{pt ? 'Salvar cria uma nova versão para revisão.' : 'Saving creates a new version for review.'}</small>}
    {error && <p className="delivery-inline-error" role="alert">{error}</p>}
    <footer><button type="button" onClick={onClose}>{pt ? 'Cancelar' : 'Cancel'}</button><button className="primary" disabled={busy || !draft.title.trim() || !draft.statement.trim()} type="submit">{pt ? 'Salvar versão' : 'Save version'}</button></footer>
  </form>;
}
