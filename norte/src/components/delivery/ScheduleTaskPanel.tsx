import { useEffect, useRef, useState } from 'react';
import { Archive, ArrowUpRight, CalendarDays, Check, Diamond, Pencil, UserRound, X } from 'lucide-react';
import type { DeliveryState, DeliveryTask } from '../../lib/projectDelivery';
import { deliveryStatus, openDeliveryRecord } from '../../lib/projectDelivery';
import { acceptCurrentScheduleFields, patchScheduleDraft, resolveScheduleDraft } from '../../lib/scheduleEditing';
import type { ScheduleQuickDraft, ScheduleQuickFields } from '../../lib/scheduleEditing';
import { ScheduleApproval } from './ScheduleApproval';
import '../../styles/schedule-task-panel.css';

type Mutate = (action: string, payload: Record<string, unknown>) => Promise<boolean>;
const longDate = (value: string, pt: boolean) =>
  value
    ? new Date(`${value}T12:00:00`).toLocaleDateString(pt ? 'pt-BR' : 'en', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      })
    : pt
      ? 'Sem data'
      : 'No date';

/** Dates, owner and state of an activity as read-only facts; the quick form replaces them only while planning is being edited. */
export function ScheduleFacts({ data, task, pt }: { data: DeliveryState; task: DeliveryTask; pt: boolean }) {
  const owner = data.members.find(member => member.id === task.ownerId)?.name;
  return (
    <dl className="schedule-facts">
      <div>
        <dt>{pt ? 'Início' : 'Start'}</dt>
        <dd>{longDate(task.startDate, pt)}</dd>
      </div>
      <div>
        <dt>{pt ? 'Prazo' : 'Due'}</dt>
        <dd>{longDate(task.dueDate || task.startDate, pt)}</dd>
      </div>
      <div>
        <dt>{pt ? 'Responsável' : 'Owner'}</dt>
        <dd className={owner ? '' : 'is-missing'}>
          <UserRound size={13} aria-hidden="true" />
          {owner || (pt ? 'Sem responsável' : 'Unassigned')}
        </dd>
      </div>
      <div>
        <dt>{pt ? 'Situação' : 'Status'}</dt>
        <dd>
          <span className={`delivery-badge ${task.status}`}>{deliveryStatus(task.status, pt)}</span>
        </dd>
      </div>
    </dl>
  );
}

/** Quick edit of dates, owner and state. The draft survives closing the panel and reports fields changed by others. */
export function ScheduleQuickForm({
  data,
  task,
  draft,
  onDraftChange,
  pt,
  busy,
  mutate,
}: {
  data: DeliveryState;
  task: DeliveryTask;
  draft: ScheduleQuickDraft | null;
  onDraftChange: (draft: ScheduleQuickDraft | null) => void;
  pt: boolean;
  busy: boolean;
  mutate: Mutate;
}) {
  const [saved, setSaved] = useState(false);
  const { item: fields, dirty, conflicts } = resolveScheduleDraft(task, draft);
  const patch = (value: Partial<ScheduleQuickFields>) => {
    setSaved(false);
    onDraftChange(patchScheduleDraft(task, draft, value));
  };
  return (
    <>
      {conflicts.length > 0 && (
        <div className="schedule-task-notice" role="alert">
          <p>
            {pt
              ? 'Um campo que você está editando mudou. Confira os valores atuais antes de salvar.'
              : 'A field you are editing changed. Check the current values before saving.'}
          </p>
          <button disabled={busy} onClick={() => onDraftChange(acceptCurrentScheduleFields(draft, conflicts))}>
            {pt ? 'Usar valores atuais' : 'Use current values'}
          </button>
        </div>
      )}
      <form
        className="schedule-quick-form"
        onSubmit={async event => {
          event.preventDefault();
          if (!busy && dirty && !conflicts.length && (await mutate('task.save', { id: task.id, item: fields }))) {
            onDraftChange(null);
            setSaved(true);
          }
        }}
      >
        <fieldset disabled={busy}>
          <div className="schedule-quick-dates">
            {task.kind !== 'review' && (
              <label>
                {pt ? 'Início' : 'Start'}
                <input
                  type="date"
                  value={fields.startDate}
                  onChange={event => patch({ startDate: event.target.value })}
                />
              </label>
            )}
            <label>
              {pt
                ? task.kind === 'review'
                  ? 'Data da revisão'
                  : 'Prazo'
                : task.kind === 'review'
                  ? 'Review date'
                  : 'Due date'}
              <input
                type="date"
                min={fields.startDate || undefined}
                value={fields.dueDate}
                onChange={event => patch({ dueDate: event.target.value })}
              />
            </label>
          </div>
          <label>
            {pt ? 'Responsável' : 'Owner'}
            <select value={fields.ownerId} onChange={event => patch({ ownerId: event.target.value })}>
              <option value="">{pt ? 'Atribuir responsável' : 'Assign owner'}</option>
              {data.members.map(member => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {pt ? 'Situação' : 'Status'}
            <select value={fields.status} onChange={event => patch({ status: event.target.value })}>
              {['planned', 'in_progress', 'blocked', 'done'].map(status => (
                <option key={status} value={status}>
                  {deliveryStatus(status, pt)}
                </option>
              ))}
            </select>
          </label>
          <div className="schedule-quick-save">
            <button type="submit" className="primary" disabled={!dirty || busy || conflicts.length > 0}>
              {busy ? (pt ? 'Salvando…' : 'Saving…') : pt ? 'Salvar alterações' : 'Save changes'}
            </button>
            {dirty && (
              <button type="button" onClick={() => onDraftChange(null)}>
                {pt ? 'Cancelar' : 'Cancel'}
              </button>
            )}
            {dirty && <small role="status">{pt ? 'Alterações ainda não salvas' : 'Unsaved changes'}</small>}
            {saved && !dirty && (
              <span role="status">
                <Check size={14} />
                {pt ? 'Salvo' : 'Saved'}
              </span>
            )}
          </div>
        </fieldset>
      </form>
    </>
  );
}

type Props = {
  editingEnabled?: boolean;
  projectId: string;
  data: DeliveryState;
  task: DeliveryTask;
  draft: ScheduleQuickDraft | null;
  onDraftChange: (draft: ScheduleQuickDraft | null) => void;
  pt: boolean;
  busy: boolean;
  error: string;
  mutate: Mutate;
  onClose: () => void;
  onEdit: () => void;
  onSelect: (id: string) => void;
};
/** Details of one activity, opened over the Gantt next to the bar that was clicked. */
export function ScheduleTaskPanel({
  editingEnabled = false,
  data,
  task,
  draft,
  onDraftChange,
  pt,
  busy,
  error,
  mutate,
  onClose,
  onEdit,
  onSelect,
}: Props) {
  const panel = useRef<HTMLElement>(null),
    heading = useRef<HTMLHeadingElement>(null);
  const { conflicts } = resolveScheduleDraft(task, draft);
  const editable = editingEnabled && task.canEdit && !task.archived;
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const element = panel.current;
    heading.current?.focus({ preventScroll: true });
    return () => {
      if (
        previous?.isConnected &&
        (element?.contains(document.activeElement) || document.activeElement === document.body)
      )
        previous.focus({ preventScroll: true });
    };
  }, []);
  const phase = data.lifecycleRanges.find(item => item.id === task.phaseId);
  const problem = task.reviewNeedsRevalidation
    ? pt
      ? 'Os critérios vinculados mudaram. Confira as evidências antes de concluir a revisão.'
      : 'Linked criteria changed. Check the evidence before completing the review.'
    : task.dateConflicts.length
      ? pt
        ? 'Esta atividade começa antes de uma dependência terminar.'
        : 'This activity starts before a dependency ends.'
      : task.blockedBy.length
        ? pt
          ? 'Há atividades anteriores ainda não concluídas.'
          : 'Some preceding activities are still open.'
        : '';
  const children = data.tasks.filter(item => !item.archived && item.parentId === task.id);
  return (
    <aside
      ref={panel}
      className="schedule-task-panel"
      aria-label={pt ? 'Detalhes da atividade' : 'Activity details'}
      onKeyDown={event => {
        if (event.key === 'Escape' && !event.defaultPrevented) {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <header>
        <span>
          {task.kind === 'review' ? <Diamond size={13} /> : <CalendarDays size={13} />}
          {phase ? `${phase.code} · ${phase.name}` : pt ? 'Sem fase' : 'No phase'}
        </span>
        <button onClick={onClose} aria-label={pt ? 'Fechar detalhes' : 'Close details'}>
          <X size={16} />
        </button>
      </header>
      <div className="schedule-task-content">
        <h2 ref={heading} tabIndex={-1}>
          {task.title}
        </h2>
        {problem && <p className="schedule-task-notice">{problem}</p>}
        {editable ? (
          <ScheduleQuickForm
            data={data}
            task={task}
            draft={draft}
            onDraftChange={onDraftChange}
            pt={pt}
            busy={busy}
            mutate={mutate}
          />
        ) : (
          <ScheduleFacts data={data} task={task} pt={pt} />
        )}
        {error && (
          <p className="delivery-inline-error" role="alert">
            {error}
          </p>
        )}
        {task.description && (
          <section className="schedule-task-objective">
            <h3>{pt ? 'Descrição' : 'Description'}</h3>
            <p>{task.description}</p>
          </section>
        )}
        {(task.parentId || children.length > 0) && (
          <section>
            <h3>{pt ? 'Estrutura da atividade' : 'Activity structure'}</h3>
            <div className="schedule-task-links">
              {task.parentId && (
                <button onClick={() => onSelect(task.parentId!)}>
                  <span>
                    {data.tasks.find(item => item.id === task.parentId)?.title || task.parentId}
                    <small>{pt ? 'Atividade superior' : 'Parent activity'}</small>
                  </span>
                  <ArrowUpRight size={14} />
                </button>
              )}
              {children.map(item => (
                <button key={item.id} onClick={() => onSelect(item.id)}>
                  <span>
                    ↳ {item.title}
                    <small>{deliveryStatus(item.status, pt)}</small>
                  </span>
                  <ArrowUpRight size={14} />
                </button>
              ))}
            </div>
          </section>
        )}
        {task.dependencyIds.length > 0 && (
          <section>
            <h3>{pt ? 'Depende de' : 'Depends on'}</h3>
            <div className="schedule-task-links">
              {task.dependencyIds.map(id => {
                const dependency = data.tasks.find(item => item.id === id);
                return (
                  <button key={id} onClick={() => onSelect(id)}>
                    <span>
                      {dependency?.title || id}
                      <small>{deliveryStatus(dependency?.status || 'pending', pt)}</small>
                    </span>
                    <ArrowUpRight size={14} />
                  </button>
                );
              })}
            </div>
          </section>
        )}
        {task.requirementIds.length > 0 && (
          <section>
            <h3>{pt ? 'Requisitos vinculados' : 'Linked requirements'}</h3>
            <div className="schedule-task-links">
              {task.requirementIds.map(id => (
                <button key={id} onClick={() => openDeliveryRecord('requirements', id)}>
                  <span>
                    {data.requirements.find(item => item.id === id)?.title || id}
                    <small>{id}</small>
                  </span>
                  <ArrowUpRight size={14} />
                </button>
              ))}
            </div>
          </section>
        )}
        {(task.inputArtifactIds.length > 0 || task.outputArtifactIds.length > 0) && (
          <section>
            <h3>{pt ? 'Arquivos vinculados' : 'Linked files'}</h3>
            {[...new Set([...task.inputArtifactIds, ...task.outputArtifactIds])].map(id => (
              <p key={id}>{data.artifacts.find(artifact => artifact.id === id)?.label || id}</p>
            ))}
          </section>
        )}
        <ScheduleApproval data={data} task={task} pt={pt} busy={busy} mutate={mutate} />
      </div>
      {editingEnabled && task.canEdit && (
        <footer>
          {editable && (
            <button disabled={busy || conflicts.length > 0} onClick={onEdit}>
              <Pencil size={14} />
              {pt ? 'Editar todos os campos' : 'Edit all fields'}
            </button>
          )}
          <button
            className="schedule-archive"
            disabled={busy}
            aria-label={
              task.archived
                ? pt
                  ? 'Restaurar atividade'
                  : 'Restore activity'
                : pt
                  ? 'Arquivar atividade'
                  : 'Archive activity'
            }
            onClick={() => {
              if (!busy) void mutate(task.archived ? 'task.restore' : 'task.archive', { id: task.id });
            }}
          >
            <Archive size={15} />
            {task.archived && (pt ? 'Restaurar' : 'Restore')}
          </button>
        </footer>
      )}
    </aside>
  );
}
