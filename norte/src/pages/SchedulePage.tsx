import { LifecycleBoard, LifecycleSettings } from '../components/delivery/LifecycleBoard';
import { ReviewTree } from '../components/delivery/ReviewTree';
import { ScheduleTaskPanel } from '../components/delivery/ScheduleTaskPanel';
import { useState } from 'react';
import { Plus, CalendarDays, Check, ListChecks, Undo2, X } from 'lucide-react';
import { ProjectAreaShell } from '../components/ProjectAreaShell';
import type { RailNavigation } from '../components/ProjectHeader';
import type { MissionProject } from '../lib/projectStore';
import type { Language } from '../lib/types';
import { useProjectDelivery, deliveryStatus, selectedDeliveryRecord } from '../lib/projectDelivery';
import type { DeliveryState, DeliveryTask, DeliveryLifecycle } from '../lib/projectDelivery';
import { describeScheduleMove, resolveScheduleDraft, scheduleMoveUndo } from '../lib/scheduleEditing';
import type { ScheduleMove, ScheduleQuickDraft } from '../lib/scheduleEditing';
import { DeliveryAlert, DeliveryModal, DeliveryOwner, DeliverySector, DeliverySelect, DeliveryStandards } from '../components/delivery/DeliveryShared';
type Draft = Pick<DeliveryTask, 'title' | 'description' | 'phaseId' | 'phase' | 'kind' | 'startDate' | 'dueDate' | 'prepDays' | 'closeDays' | 'status' | 'sectorId' | 'ownerId' | 'dependencyIds' | 'requirementIds' | 'testIds' | 'inputArtifactIds' | 'outputArtifactIds'>;
function TaskEditor({ data, original, busy, error, pt, onClose, onSave, mutate, initialPhaseId = '' }: { initialPhaseId?: string; data: DeliveryState; original: DeliveryTask | null; busy: boolean; error: string; pt: boolean; onClose: () => void; onSave: (draft: Draft) => Promise<void>; mutate:(action:string,payload:Record<string,unknown>)=>Promise<boolean> }) {
  const [draft, setDraft] = useState<Draft>(original || { title: '', description: '', phaseId: initialPhaseId, phase: data.lifecycleRanges.find(phase => phase.id === initialPhaseId)?.name || '', kind: 'task', startDate: '', dueDate: '', prepDays: 0, closeDays: 0, status: 'planned', sectorId: data.permissions.manage ? '' : data.permissions.editableSectorIds[0] || '', ownerId: '', dependencyIds: [], requirementIds: [], testIds: [], inputArtifactIds: [], outputArtifactIds: [] });
  const [managePhases,setManagePhases]=useState(false);
  const patch = (value: Partial<Draft>) => setDraft(d => ({ ...d, ...value }));
  return <DeliveryModal title={pt ? original ? 'Editar atividade' : 'Nova atividade ou revisão' : original ? 'Edit activity' : 'New activity or review'} onClose={onClose}><form onSubmit={e => { e.preventDefault(); void onSave({...draft,phase: data.lifecycleRanges.find(p=>p.id===draft.phaseId)?.name||draft.phase}); }}><label>{pt ? 'Título' : 'Title'}<input autoFocus required maxLength={200} value={draft.title} onChange={e => patch({ title: e.target.value })} /></label><div className="delivery-form-grid"><label>{pt ? 'Tipo' : 'Type'}<select value={draft.kind} onChange={e => patch({ kind: e.target.value })}><option value="task">{pt ? 'Atividade' : 'Activity'}</option><option value="review">{pt ? 'Marco de revisão' : 'Review milestone'}</option></select></label><label>{pt ? 'Fase / etapa' : 'Phase / stage'}<select value={draft.phaseId||''} onChange={e=>patch({phaseId:e.target.value,phase:data.lifecycleRanges.find(p=>p.id===e.target.value)?.name||''})}><option value="">{draft.phase&&!draft.phaseId?draft.phase:pt?'Sem fase':'No phase'}</option>{data.lifecycleRanges.map(p=><option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select>{data.permissions.manage&&<button type="button" onClick={()=>setManagePhases(true)}>{pt?'Adicionar ou editar fases':'Add or edit phases'}</button>}</label><label>{pt ? 'Início' : 'Start'}<input type="date" value={draft.startDate} onChange={e => patch({ startDate: e.target.value })} /></label><label>{pt ? 'Prazo / data da revisão' : 'Due / review date'}<input type="date" min={draft.startDate || undefined} value={draft.dueDate} onChange={e => patch({ dueDate: e.target.value })} /></label><DeliveryOwner data={data} value={draft.ownerId} onChange={ownerId => patch({ ownerId })} pt={pt} /><DeliverySector data={data} value={draft.sectorId} onChange={sectorId => patch({ sectorId })} pt={pt} /><label>{pt ? 'Situação' : 'Status'}<select value={draft.status} onChange={e => patch({ status: e.target.value })}>{['planned', 'in_progress', 'blocked', 'done'].map(status => <option key={status} value={status}>{deliveryStatus(status, pt)}</option>)}</select></label></div>
    {draft.kind === 'review' && <div className="delivery-form-grid"><label>{pt ? 'Preparação (dias antes)' : 'Preparation (days before)'}<input type="number" min={0} max={365} value={draft.prepDays} onChange={e => patch({ prepDays: Number(e.target.value) })} /></label><label>{pt ? 'Fechamento (dias depois)' : 'Closeout (days after)'}<input type="number" min={0} max={365} value={draft.closeDays} onChange={e => patch({ closeDays: Number(e.target.value) })} /></label></div>}
    <label>{pt ? 'Objetivo e critérios de conclusão' : 'Objective and completion criteria'}<textarea maxLength={8000} value={draft.description} onChange={e => patch({ description: e.target.value })} /></label>
    <DeliverySelect label={pt ? 'Depende da conclusão de' : 'Depends on completion of'} choices={data.tasks.filter(t => !t.archived && t.id !== original?.id).map(t => ({ id: t.id, label: t.title }))} selected={draft.dependencyIds} onChange={dependencyIds => patch({ dependencyIds })} />
    <details><summary>{pt ? 'Requisitos, verificações e entregas' : 'Requirements, verifications and deliverables'}</summary><div className="delivery-detail"><DeliverySelect label={pt ? 'Requisitos' : 'Requirements'} choices={data.requirements.filter(r => !r.archived).map(r => ({ id: r.id, label: `${r.id} · ${r.title}` }))} selected={draft.requirementIds} onChange={requirementIds => patch({ requirementIds })} /><DeliverySelect label={pt ? 'Verificações' : 'Verifications'} choices={data.tests.filter(t => !t.archived).map(t => ({ id: t.id, label: t.title }))} selected={draft.testIds} onChange={testIds => patch({ testIds })} /><DeliverySelect label={pt ? 'Documentos de entrada' : 'Input documents'} choices={data.artifacts.map(a => ({ id: a.id, label: a.label }))} selected={draft.inputArtifactIds} onChange={inputArtifactIds => patch({ inputArtifactIds })} /><DeliverySelect label={pt ? 'Registros de saída' : 'Output records'} choices={data.artifacts.map(a => ({ id: a.id, label: a.label }))} selected={draft.outputArtifactIds} onChange={outputArtifactIds => patch({ outputArtifactIds })} /></div></details>
    {error && <p role="alert" className="delivery-inline-error">{error}</p>}<footer><button type="button" onClick={onClose}>{pt ? 'Cancelar' : 'Cancel'}</button><button type="submit" className="primary" disabled={busy}>{pt ? 'Salvar atividade' : 'Save activity'}</button></footer></form>{managePhases&&<DeliveryModal title={pt?'Fases do projeto':'Project phases'} onClose={()=>setManagePhases(false)}><LifecycleSettings data={data} busy={busy} error={error} mutate={mutate} pt={pt} onClose={()=>setManagePhases(false)}/></DeliveryModal>}</DeliveryModal>;
}
export function SchedulePage({ language, project, navigation }: { language: Language; project: MissionProject; navigation: RailNavigation }) {
  const pt = language === 'pt', { data, error, busy, refresh, mutate } = useProjectDelivery(project.id);
  const [mode, setMode] = useState<'gantt' | 'reviews'>('gantt');
  const [selectedId, setSelectedId] = useState(selectedDeliveryRecord), [editing, setEditing] = useState<string | null>(null);
  const [template, setTemplate] = useState(false), [preview, setPreview] = useState<DeliveryLifecycle | null>(null), [focusPhase, setFocusPhase] = useState('');
  const [creationPhase, setCreationPhase] = useState('');
  const [drafts, setDrafts] = useState<Record<string, Record<string, ScheduleQuickDraft>>>({});
  const [moveNotice, setMoveNotice] = useState<(ScheduleMove & { projectId: string }) | null>(null);
  const selected = data?.tasks.find(task => task.id === selectedId);
  const projectDrafts = drafts[project.id] || {};
  const updateDraft = (id: string, draft: ScheduleQuickDraft | null) => setDrafts(current => {
    const next = { ...current[project.id] };
    if (draft) next[id] = draft; else delete next[id];
    return { ...current, [project.id]: next };
  });
  const closeTemplate = () => { setTemplate(false); setPreview(null); setFocusPhase(''); };
  const configure = (phase = '') => { setFocusPhase(phase); setSelectedId(''); setMode('gantt'); setTemplate(true); };
  const selectTask = (id: string) => { closeTemplate(); setSelectedId(id); };
  const editTask = (id: string) => {
    const task = data?.tasks.find(item => item.id === id);
    if (!task?.canEdit || busy) return;
    if (resolveScheduleDraft(task, projectDrafts[id] || null).conflicts.length) { selectTask(id); return; }
    setEditing(id);
  };
  const create = (phase = '') => { setCreationPhase(phase); setEditing('new'); };
  const moveTask = async (id: string, dueDate: string) => {
    const task = data?.tasks.find(item => item.id === id); if (!task || busy) return;
    const move = describeScheduleMove(task, dueDate);
    if (await mutate('task.reschedule', { id, dueDate })) setMoveNotice({ ...move, projectId: project.id });
  };
  const undoItem = moveNotice?.projectId === project.id ? scheduleMoveUndo(data?.tasks.find(task => task.id === moveNotice.id), moveNotice) : null;
  const editingTask = data?.tasks.find(task => task.id === editing);
  const editingOriginal = editingTask ? resolveScheduleDraft(editingTask, projectDrafts[editingTask.id] || null).item : null;
  const reviews = data?.tasks.filter(task => !task.archived && task.kind === 'review').length || 0;
  return <ProjectAreaShell language={language} project={project} area="schedule" navigation={navigation}>
    <div className="delivery-workspace planning-workspace">
      <DeliveryAlert error={error} refresh={refresh} pt={pt}/>
      {!data ? <p className="delivery-loading">{pt ? 'Carregando cronograma…' : 'Loading schedule…'}</p> : <>
        <div className="planning-toolbar"><div className="planning-tabs" aria-label={pt ? 'Visualizações do cronograma' : 'Schedule views'}>
          <button aria-pressed={mode === 'gantt'} onClick={() => setMode('gantt')}><CalendarDays size={16}/>{pt ? 'Planejamento' : 'Planning'}</button>
          <button aria-label={pt ? 'Revisões' : 'Reviews'} aria-pressed={mode === 'reviews'} onClick={() => { closeTemplate(); setMode('reviews'); }}><ListChecks size={16}/>{pt ? 'Revisões' : 'Reviews'}<small>{reviews}</small></button>
        </div><div className="planning-controls"><DeliveryStandards data={data} busy={busy} mutate={mutate} pt={pt} error={error}/>
          {data.permissions.manage && <button disabled={busy} aria-label={pt ? 'Modelo de ciclo de vida' : 'Lifecycle template'} aria-expanded={template} onClick={() => template ? closeTemplate() : configure()}><CalendarDays size={15}/>{pt ? 'Planejar fases' : 'Plan phases'}</button>}
          {(data.permissions.manage || data.permissions.editableSectorIds.length > 0) && <button className="primary" onClick={() => create()}><Plus size={15}/>{pt ? 'Nova atividade' : 'New activity'}</button>}
        </div></div>
        {moveNotice && undoItem && <div className="schedule-save-status" role="status"><Check size={15}/><span>{pt ? 'Data atualizada' : 'Date updated'}</span><button disabled={busy} onClick={async () => { if (!busy && await mutate('task.save', { id: undoItem.id, item: undoItem })) setMoveNotice(null); }}><Undo2 size={13}/>{pt ? 'Desfazer' : 'Undo'}</button><button aria-label={pt ? 'Fechar confirmação' : 'Dismiss confirmation'} onClick={() => setMoveNotice(null)}><X size={14}/></button></div>}
        <div className={`planning-layout${template ? ' with-settings' : selected && editing === null ? ' with-detail' : ''}`}>
          <div className="planning-main">{mode === 'gantt' ? <LifecycleBoard data={data} pt={pt} onSelect={selectTask} selectedId={selectedId} onConfigure={data.permissions.manage ? () => configure() : undefined} onEditPhase={data.permissions.manage ? configure : undefined} onCreate={data.permissions.manage || data.permissions.editableSectorIds.length > 0 ? create : undefined} busy={busy} preview={preview} onMove={moveTask}/> : <ReviewTree projectId={project.id} data={data} pt={pt} busy={busy} mutate={mutate} onSelect={selectTask} onEdit={editTask} error={error}/>}</div>
          {template && <LifecycleSettings data={data} busy={busy} mutate={mutate} pt={pt} onClose={closeTemplate} onPreview={setPreview} focusPhase={focusPhase} error={error}/>}
          {!template && selected && editing === null && <ScheduleTaskPanel key={`${project.id}:${selected.id}`} projectId={project.id} data={data} task={selected} draft={projectDrafts[selected.id] || null} onDraftChange={draft => updateDraft(selected.id, draft)} pt={pt} busy={busy} error={error} mutate={mutate} onClose={() => setSelectedId('')} onEdit={() => editTask(selected.id)} onSelect={selectTask}/>}
        </div>
      </>}
    </div>
    {data && editing !== null && <TaskEditor key={`${project.id}:${editing}`} initialPhaseId={creationPhase} data={data} original={editingOriginal} busy={busy} error={error} pt={pt} mutate={mutate} onClose={() => setEditing(null)} onSave={async item => { if (!busy && await mutate('task.save', { ...(editing !== 'new' ? { id: editing } : {}), item })) { if (editing !== 'new') updateDraft(editing, null); setEditing(null); } }}/>}
  </ProjectAreaShell>;
}
