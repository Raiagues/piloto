import { useEffect, useRef, useState } from 'react';
import { Archive, ArrowUpRight, CalendarDays, Check, Diamond, Pencil, X } from 'lucide-react';
import type { DeliveryState, DeliveryTask } from '../../lib/projectDelivery';
import { deliveryStatus, openDeliveryRecord } from '../../lib/projectDelivery';
import { acceptCurrentScheduleFields, patchScheduleDraft, resolveScheduleDraft } from '../../lib/scheduleEditing';
import type { ScheduleQuickDraft, ScheduleQuickFields } from '../../lib/scheduleEditing';
import { ScheduleApproval } from './ScheduleApproval';
import { ReviewDocuments } from './ReviewDocuments';
import '../../styles/schedule-task-panel.css';

type Props = { editingEnabled?: boolean; projectId: string; data: DeliveryState; task: DeliveryTask; draft: ScheduleQuickDraft | null; onDraftChange: (draft: ScheduleQuickDraft | null) => void; pt: boolean; busy: boolean; error: string; mutate: (action: string, payload: Record<string, unknown>) => Promise<boolean>; onClose: () => void; onEdit: () => void; onSelect: (id: string) => void };
export function ScheduleTaskPanel({ editingEnabled = false, projectId, data, task, draft, onDraftChange, pt, busy, error, mutate, onClose, onEdit, onSelect }: Props) {
  const [saved, setSaved] = useState(false);
  const panel = useRef<HTMLElement>(null), heading = useRef<HTMLHeadingElement>(null);
  const { item: fields, dirty, conflicts } = resolveScheduleDraft(task, draft);
  const editable = editingEnabled && task.canEdit && !task.archived;
  const patch = (value: Partial<ScheduleQuickFields>) => { setSaved(false); onDraftChange(patchScheduleDraft(task, draft, value)); };
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const element = panel.current;
    heading.current?.focus({ preventScroll: true });
    return () => {
      if (previous?.isConnected && (element?.contains(document.activeElement) || document.activeElement === document.body)) previous.focus({ preventScroll: true });
    };
  }, []);
  const problem = task.reviewNeedsRevalidation ? (pt ? 'Os critérios vinculados mudaram. Confira as evidências antes de concluir a revisão.' : 'Linked criteria changed. Check the evidence before completing the review.') : task.dateConflicts.length ? (pt ? 'Esta atividade começa antes de uma dependência terminar.' : 'This activity starts before a dependency ends.') : task.blockedBy.length ? (pt ? 'Há atividades anteriores ainda não concluídas.' : 'Some preceding activities are still open.') : '';
  return <aside ref={panel} className="schedule-task-panel" aria-label={pt ? 'Detalhes da entrega' : 'Deliverable details'} onKeyDown={event => { if (event.key === 'Escape' && !event.defaultPrevented) { event.stopPropagation(); onClose(); } }}>
    <header><span>{task.kind === 'review' ? <Diamond size={14}/> : <CalendarDays size={14}/>} {pt ? task.kind === 'review' ? 'Revisão' : 'Atividade' : task.kind === 'review' ? 'Review' : 'Activity'}</span><button onClick={onClose} aria-label={pt ? 'Fechar detalhes' : 'Close details'}><X size={18}/></button></header>
    <div className="schedule-task-content"><div className="schedule-task-title"><h2 ref={heading} tabIndex={-1}>{task.title}</h2><span className={`delivery-badge ${task.archived ? 'archived' : task.status}`}>{deliveryStatus(task.archived ? 'archived' : task.status, pt)}</span>{task.phase && <small>{task.phase}</small>}{dirty && <small role="status">{pt ? 'Alterações ainda não salvas' : 'Unsaved changes'}</small>}</div>
      {problem && <p className="schedule-task-notice">{problem}</p>}
      {conflicts.length > 0 && <div className="schedule-task-notice" role="alert"><p>{pt ? 'Um campo que você está editando mudou. Confira os valores atuais antes de salvar.' : 'A field you are editing changed. Check the current values before saving.'}</p><button disabled={busy} onClick={() => onDraftChange(acceptCurrentScheduleFields(draft, conflicts))}>{pt ? 'Usar valores atuais' : 'Use current values'}</button></div>}
      <form onSubmit={async event => { event.preventDefault(); if (editable && !busy && dirty && !conflicts.length && await mutate('task.save', { id: task.id, item: fields })) { onDraftChange(null); setSaved(true); } }}>
        <fieldset disabled={!editable || busy}><div className="schedule-quick-dates"><label>{pt ? 'Início' : 'Start'}<input type="date" value={fields.startDate} onChange={event => patch({ startDate: event.target.value })}/></label><label>{pt ? task.kind === 'review' ? 'Data da revisão' : 'Prazo' : task.kind === 'review' ? 'Review date' : 'Due date'}<input type="date" min={fields.startDate || undefined} value={fields.dueDate} onChange={event => patch({ dueDate: event.target.value })}/></label></div>
          <label>{pt ? 'Responsável' : 'Owner'}<select value={fields.ownerId} onChange={event => patch({ ownerId: event.target.value })}><option value="">{pt ? 'Atribuir responsável' : 'Assign owner'}</option>{data.members.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
          <label>{pt ? 'Situação' : 'Status'}<select value={fields.status} onChange={event => patch({ status: event.target.value })}>{['planned', 'in_progress', 'blocked', 'done'].map(status => <option key={status} value={status}>{deliveryStatus(status, pt)}</option>)}</select></label>
          {editable && <div className="schedule-quick-save"><button type="submit" className="primary" disabled={!dirty || busy || conflicts.length > 0}>{busy ? (pt ? 'Salvando…' : 'Saving…') : (pt ? 'Salvar alterações' : 'Save changes')}</button>{dirty && <button type="button" onClick={() => onDraftChange(null)}>{pt ? 'Cancelar' : 'Cancel'}</button>}{saved && !dirty && <span role="status"><Check size={14}/>{pt ? 'Salvo' : 'Saved'}</span>}</div>}
        </fieldset>
      </form>
      {error && <p className="delivery-inline-error" role="alert">{error}</p>}
      <ScheduleApproval data={data} task={task} pt={pt} busy={busy} mutate={mutate}/>
      {task.description && <section className="schedule-task-objective"><h3>{pt ? 'Objetivo' : 'Objective'}</h3><p>{task.description}</p></section>}
      {(task.parentId||data.tasks.some(item=>!item.archived&&item.parentId===task.id))&&<section><h3>{pt?'Estrutura da atividade':'Activity structure'}</h3><div className="schedule-task-links">{task.parentId&&<button onClick={()=>onSelect(task.parentId!)}>{data.tasks.find(item=>item.id===task.parentId)?.title||task.parentId}<ArrowUpRight size={14}/></button>}{data.tasks.filter(item=>!item.archived&&item.parentId===task.id).map(item=><button key={item.id} onClick={()=>onSelect(item.id)}><span>↳ {item.title}<small>{deliveryStatus(item.status,pt)}</small></span><ArrowUpRight size={14}/></button>)}</div></section>}
      {task.dependencyIds.length > 0 && <section><h3>{pt ? 'Depende de' : 'Depends on'}</h3><div className="schedule-task-links">{task.dependencyIds.map(id => { const dependency = data.tasks.find(item => item.id === id); return <button key={id} onClick={() => onSelect(id)}><span>{dependency?.title || id}<small>{deliveryStatus(dependency?.status || 'pending', pt)}</small></span><ArrowUpRight size={14}/></button>; })}</div></section>}
      <details className="schedule-task-section"><summary>{pt ? 'Requisitos vinculados' : 'Linked requirements'}<span>{task.requirementIds.length}</span></summary><div className="schedule-task-links">{task.requirementIds.map(id => <button key={id} onClick={() => openDeliveryRecord('requirements', id)}><span>{data.requirements.find(item => item.id === id)?.title || id}<small>{id}</small></span><ArrowUpRight size={14}/></button>)}{!task.requirementIds.length && <p>{pt ? 'Nenhum critério vinculado.' : 'No linked criteria.'}</p>}{editable && <button disabled={busy || conflicts.length > 0} onClick={onEdit}><Pencil size={13}/>{pt ? 'Editar vínculos' : 'Edit links'}</button>}</div></details>
      {task.kind === 'review' && <details className="schedule-task-section"><summary>{pt ? 'Documentos da revisão' : 'Review documents'}<span>{data.documents.filter(document => document.taskId === task.id).length}/{task.documentOptions.length}</span></summary><ReviewDocuments compact projectId={projectId} data={data} task={task} busy={busy} mutate={mutate} pt={pt} error={error}/></details>}
      {(task.inputArtifactIds.length > 0 || task.outputArtifactIds.length > 0) && <details className="schedule-task-section"><summary>{pt ? 'Arquivos vinculados' : 'Linked files'}<span>{task.inputArtifactIds.length + task.outputArtifactIds.length}</span></summary>{[...new Set([...task.inputArtifactIds, ...task.outputArtifactIds])].map(id => <p key={id}>{data.artifacts.find(artifact => artifact.id === id)?.label || id}</p>)}</details>}
    </div>
    <footer>{editable && <button disabled={busy || conflicts.length > 0} onClick={onEdit}><Pencil size={14}/>{pt ? 'Editar todos os campos' : 'Edit all fields'}</button>}{editingEnabled && task.canEdit && <button className="schedule-archive" disabled={busy} aria-label={task.archived ? (pt ? 'Restaurar atividade' : 'Restore activity') : (pt ? 'Arquivar atividade' : 'Archive activity')} onClick={() => { if (!busy) { setSaved(false); void mutate(task.archived ? 'task.restore' : 'task.archive', { id: task.id }); } }}><Archive size={15}/>{task.archived && (pt ? 'Restaurar' : 'Restore')}</button>}</footer>
  </aside>;
}
