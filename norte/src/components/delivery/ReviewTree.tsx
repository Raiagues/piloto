import { useEffect, useId, useMemo, useRef } from 'react';
import type { CSSProperties } from 'react';
import { AlertCircle, ArrowUpRight, ChevronDown, Milestone, Pencil, UserRound } from 'lucide-react';
import type { DeliveryState, DeliveryTask } from '../../lib/projectDelivery';
import { deliveryStatus, openDeliveryRecord } from '../../lib/projectDelivery';
import { buildScheduleGroups } from '../../lib/schedulePlanning';
import type { ScheduleQuickDraft } from '../../lib/scheduleEditing';
import { countdown, reviewEntries } from '../../lib/sidebarTree';
import type { ReviewEntry } from '../../lib/sidebarTree';
import { ReviewDocuments } from './ReviewDocuments';
import { ScheduleApproval } from './ScheduleApproval';
import { ScheduleQuickForm } from './ScheduleTaskPanel';
import '../../styles/schedule-task-panel.css';
import '../../styles/schedule-reviews.css';

type Mutate = (action: string, payload: Record<string, unknown>) => Promise<boolean>;
type ReviewTreeProps = {
  editingEnabled?: boolean;
  projectId: string;
  data: DeliveryState;
  pt: boolean;
  busy: boolean;
  error: string;
  today: string;
  expanded: string[];
  focus?: { id: string };
  onToggle: (id: string) => void;
  onEdit: (id: string) => void;
  onOpenDocument: (id: string) => void;
  onOpenTemplate: (taskId: string, templateId: string) => void;
  drafts: Record<string, ScheduleQuickDraft>;
  onDraftChange: (id: string, draft: ScheduleQuickDraft | null) => void;
  mutate: Mutate;
};

function reviewDate(value: string, pt: boolean) {
  if (!value) return pt ? 'Sem data' : 'No date';
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date
        .toLocaleDateString(pt ? 'pt-BR' : 'en-US', { day: '2-digit', month: 'short', year: 'numeric' })
        .replace('.', '');
}
const meter = (value: number, total: number) =>
  ({ '--value': `${total ? Math.round((value / total) * 100) : 0}%` }) as CSSProperties;

function Criteria({
  data,
  task,
  pt,
  editable,
  busy,
  onEdit,
}: {
  data: DeliveryState;
  task: DeliveryTask;
  pt: boolean;
  editable: boolean;
  busy: boolean;
  onEdit: () => void;
}) {
  // Verifications have no screen of their own any more, so only requirements link out.
  const items = [
    ...task.requirementIds.map(id => {
      const record = data.requirements.find(item => item.id === id && !item.archived);
      return {
        id,
        link: Boolean(record),
        kind: pt ? 'Requisito' : 'Requirement',
        title: record?.title,
        status: record?.status,
        met: record?.status === 'approved',
      };
    }),
    ...task.testIds.map(id => {
      const record = data.tests.find(item => item.id === id && !item.archived);
      return {
        id,
        link: false,
        kind: pt ? 'Verificação' : 'Verification',
        title: record?.title,
        status: record?.status,
        met: record?.status === 'passed',
      };
    }),
  ];
  const met = items.filter(item => item.met).length;
  return (
    <section className="review-criteria" aria-label={pt ? 'Critérios da revisão' : 'Review criteria'}>
      <header>
        <h3>{pt ? 'Critérios' : 'Criteria'}</h3>
        <p>
          {items.length
            ? pt
              ? `${met} de ${items.length} atendidos`
              : `${met} of ${items.length} met`
            : pt
              ? 'Nenhum critério vinculado'
              : 'No criteria linked'}
        </p>
      </header>
      {items.length > 0 && (
        <ul>
          {items.map(item => {
            const content = (
              <>
                <i aria-hidden="true" />
                <b>{item.id}</b>
                <span>
                  {item.title || (pt ? 'Registro indisponível' : 'Record unavailable')}
                  <small>
                    {item.kind} · {item.status ? deliveryStatus(item.status, pt) : pt ? 'indisponível' : 'unavailable'}
                  </small>
                </span>
                {item.link && <ArrowUpRight size={13} aria-hidden="true" />}
              </>
            );
            return (
              <li key={item.id} className={item.met ? 'is-met' : ''}>
                {item.link ? (
                  <button type="button" onClick={() => openDeliveryRecord('requirements', item.id)}>
                    {content}
                  </button>
                ) : (
                  <div>{content}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {!items.length && (
        <p className="review-criteria-empty">
          {pt
            ? 'Vincule os requisitos e verificações que esta revisão precisa encerrar.'
            : 'Link the requirements and verifications this review must close.'}
        </p>
      )}
      {editable && (
        <button type="button" className="review-criteria-link" disabled={busy} onClick={onEdit}>
          {pt ? 'Vincular critérios' : 'Link criteria'}
        </button>
      )}
    </section>
  );
}

/** Reviews by phase. A row opens downward with its owner, document package, criteria and approval. */
export function ReviewTree({
  editingEnabled = false,
  projectId,
  data,
  pt,
  busy,
  error,
  today,
  expanded,
  focus,
  onToggle,
  onEdit,
  onOpenDocument,
  onOpenTemplate,
  drafts,
  onDraftChange,
  mutate,
}: ReviewTreeProps) {
  const treeId = useId(),
    list = useRef<HTMLElement>(null);
  const entries = useMemo(() => new Map(reviewEntries(data, today).map(entry => [entry.id, entry])), [data, today]);
  const reviews = data.tasks
    .filter(task => !task.archived && task.kind === 'review')
    .sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));
  const groups = buildScheduleGroups(reviews, data.lifecycleRanges).filter(group => group.tasks.length);
  useEffect(() => {
    if (!focus) return;
    const row = list.current?.querySelector<HTMLElement>(`[data-review-id="${CSS.escape(focus.id)}"]`);
    row?.scrollIntoView({
      block: 'start',
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
    row?.querySelector<HTMLElement>('.schedule-review-toggle')?.focus({ preventScroll: true });
  }, [focus]);

  if (!reviews.length)
    return (
      <div className="schedule-reviews-empty">
        <Milestone size={28} aria-hidden="true" />
        <h2>{pt ? 'As revisões aparecem aqui' : 'Your reviews will appear here'}</h2>
        <p>
          {pt
            ? 'Crie uma revisão em “Nova atividade” ou escolha as revisões em “Planejar fases”. Depois, reúna os critérios e documentos de cada encontro.'
            : 'Create a review using “New activity” or choose reviews in “Plan phases”. Then bring together the criteria and documents for each meeting.'}
        </p>
      </div>
    );

  return (
    <section
      ref={list}
      className="schedule-reviews"
      aria-label={pt ? 'Revisões e documentos' : 'Reviews and documents'}
    >
      {groups.map((group, groupIndex) => {
        const done = group.tasks.filter(task => task.status === 'done').length;
        return (
          <section className="schedule-review-phase" key={group.id} aria-labelledby={`${treeId}-phase-${groupIndex}`}>
            <header className="schedule-review-phase-heading">
              <h2 id={`${treeId}-phase-${groupIndex}`}>
                {group.phase?.code && <b>{group.phase.code}</b>}
                {group.phase?.name || (pt ? 'Sem fase definida' : 'No phase assigned')}
              </h2>
              <small>
                {pt
                  ? `${done} de ${group.tasks.length} ${group.tasks.length === 1 ? 'revisão concluída' : 'revisões concluídas'}`
                  : `${done} of ${group.tasks.length} ${group.tasks.length === 1 ? 'review' : 'reviews'} done`}
              </small>
            </header>
            <div className="schedule-review-phase-items">
              {group.tasks.map(task => (
                <ReviewRow
                  key={task.id}
                  task={task}
                  entry={entries.get(task.id)}
                  open={expanded.includes(task.id)}
                  detailsId={`${treeId}-review-${task.id}`}
                  {...{
                    editingEnabled,
                    projectId,
                    data,
                    pt,
                    busy,
                    error,
                    today,
                    onToggle,
                    onEdit,
                    onOpenDocument,
                    onOpenTemplate,
                    mutate,
                  }}
                  draft={drafts[task.id] || null}
                  onDraftChange={draft => onDraftChange(task.id, draft)}
                />
              ))}
            </div>
          </section>
        );
      })}
    </section>
  );
}

type RowProps = Pick<
  ReviewTreeProps,
  | 'editingEnabled'
  | 'projectId'
  | 'data'
  | 'pt'
  | 'busy'
  | 'error'
  | 'today'
  | 'onToggle'
  | 'onEdit'
  | 'onOpenDocument'
  | 'onOpenTemplate'
  | 'mutate'
> & {
  task: DeliveryTask;
  entry?: ReviewEntry;
  open: boolean;
  detailsId: string;
  draft: ScheduleQuickDraft | null;
  onDraftChange: (draft: ScheduleQuickDraft | null) => void;
};
function ReviewRow({
  editingEnabled = false,
  projectId,
  data,
  pt,
  busy,
  error,
  today,
  onToggle,
  onEdit,
  onOpenDocument,
  onOpenTemplate,
  mutate,
  task,
  entry,
  open,
  detailsId,
  draft,
  onDraftChange,
}: RowProps) {
  const criteria = [
    ...task.requirementIds.map(
      id => data.requirements.find(item => item.id === id && !item.archived)?.status === 'approved',
    ),
    ...task.testIds.map(id => data.tests.find(item => item.id === id && !item.archived)?.status === 'passed'),
  ];
  const met = criteria.filter(Boolean).length,
    owner = data.members.find(member => member.id === task.ownerId);
  const state = task.reviewNeedsRevalidation ? 'stale' : entry?.state || (task.status === 'done' ? 'done' : 'planned');
  const code = entry?.code || task.reviewCode || '',
    label = entry?.label || task.title;
  const editable = editingEnabled && task.canEdit && !task.archived;
  const when = task.status === 'done' ? '' : countdown(task.dueDate, today, pt);
  return (
    <article className={`schedule-review state-${state}${open ? ' is-open' : ''}`} data-review-id={task.id}>
      <div className="schedule-review-row">
        <button
          type="button"
          className="schedule-review-toggle"
          aria-expanded={open}
          aria-controls={detailsId}
          onClick={() => onToggle(task.id)}
        >
          <i className="schedule-review-diamond" aria-hidden="true" />
          <b className="schedule-review-code">{code || '—'}</b>
          <span className="schedule-review-title">
            <strong>{label}</strong>
            <small>
              <time dateTime={task.dueDate || undefined}>{reviewDate(task.dueDate, pt)}</time>
              {when && <em className={state === 'overdue' ? 'is-late' : ''}>{when}</em>}
              {owner && <span>{owner.name}</span>}
            </small>
          </span>
          <span
            className={`delivery-badge schedule-review-status ${task.reviewNeedsRevalidation ? 'stale' : task.status}`}
          >
            {task.reviewNeedsRevalidation ? (pt ? 'Revalidar' : 'Revalidate') : deliveryStatus(task.status, pt)}
          </span>
          <span className="schedule-review-meter" title={pt ? 'Critérios atendidos' : 'Criteria met'}>
            <small>{pt ? 'Critérios' : 'Criteria'}</small>
            <span className="review-meter" style={meter(met, criteria.length)} aria-hidden="true">
              <i />
            </span>
            <strong>{criteria.length ? `${met}/${criteria.length}` : '—'}</strong>
          </span>
          <span className="schedule-review-meter is-docs" title={pt ? 'Documentos preparados' : 'Documents prepared'}>
            <small>{pt ? 'Documentos' : 'Documents'}</small>
            <span className="review-meter" style={meter(entry?.prepared || 0, entry?.planned || 0)} aria-hidden="true">
              <i />
            </span>
            <strong>{entry?.planned ? `${entry.prepared}/${entry.planned}` : '—'}</strong>
          </span>
          <ChevronDown className="schedule-review-chevron" size={16} aria-hidden="true" />
        </button>
        {editable ? (
          <button
            type="button"
            className="schedule-review-edit"
            disabled={busy}
            aria-label={`${pt ? 'Editar' : 'Edit'} ${task.title}`}
            title={pt ? 'Editar revisão' : 'Edit review'}
            onClick={() => onEdit(task.id)}
          >
            <Pencil size={14} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {open && (
        <div className="schedule-review-details" id={detailsId}>
          {task.reviewNeedsRevalidation && (
            <p className="schedule-review-revalidation">
              <AlertCircle size={15} aria-hidden="true" />
              {pt
                ? 'Os critérios mudaram desde a última revisão. Confira os registros antes de concluir.'
                : 'The criteria changed since the last review. Check the records before completing it.'}
            </p>
          )}
          {editable ? (
            <div className="schedule-review-summary">
              <ScheduleQuickForm
                data={data}
                task={task}
                draft={draft}
                onDraftChange={onDraftChange}
                pt={pt}
                busy={busy}
                mutate={mutate}
              />
            </div>
          ) : (
            <p className={`schedule-review-owner${owner ? '' : ' is-missing'}`}>
              <UserRound size={13} aria-hidden="true" />
              <span>{pt ? 'Responsável' : 'Owner'}</span>
              <strong>{owner?.name || (pt ? 'A definir' : 'Unassigned')}</strong>
            </p>
          )}
          <div className="schedule-review-columns">
            <ReviewDocuments
              projectId={projectId}
              data={data}
              task={task}
              pt={pt}
              busy={busy}
              mutate={mutate}
              error={error}
              onOpenDocument={onOpenDocument}
              onOpenTemplate={onOpenTemplate}
            />
            <Criteria data={data} task={task} pt={pt} editable={editable} busy={busy} onEdit={() => onEdit(task.id)} />
          </div>
          <ScheduleApproval data={data} task={task} pt={pt} busy={busy} mutate={mutate} />
        </div>
      )}
    </article>
  );
}
