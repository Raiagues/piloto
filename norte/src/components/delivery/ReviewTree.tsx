import { useId, useState } from 'react';
import { AlertCircle, CalendarDays, ChevronDown, ChevronRight, FileText, ListChecks, Milestone, Pencil } from 'lucide-react';
import type { DeliveryState } from '../../lib/projectDelivery';
import { deliveryStatus, openDeliveryRecord } from '../../lib/projectDelivery';
import { buildScheduleGroups } from '../../lib/schedulePlanning';
import { ReviewDocuments } from './ReviewDocuments';
import '../../styles/schedule-reviews.css';

type ReviewTreeProps = {
  projectId: string;
  data: DeliveryState;
  pt: boolean;
  busy: boolean;
  mutate: (action: string, payload: Record<string, unknown>) => Promise<boolean>;
  onSelect: (id: string) => void;
  onEdit: (id: string) => void;
  error: string;
};

function reviewDate(value: string, pt: boolean) {
  if (!value) return pt ? 'Definir data' : 'Set date';
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(pt ? 'pt-BR' : 'en-US', { day: '2-digit', month: 'short', year: 'numeric' });
}

function ReviewProgress({ value, total, label, emptyLabel }: { value: number; total: number; label: string; emptyLabel: string }) {
  return <div className="schedule-review-progress">
    <span>{label}<strong>{total ? `${value}/${total}` : '—'}</strong></span>
    {total ? <progress max={total} value={value} aria-label={`${label}: ${value}/${total}`} /> : <small>{emptyLabel}</small>}
  </div>;
}

export function ReviewTree({ projectId, data, pt, busy, mutate, onSelect, onEdit, error }: ReviewTreeProps) {
  const [expanded, setExpanded] = useState<string[]>([]);
  const treeId = useId();
  const reviews = data.tasks.filter(task => !task.archived && task.kind === 'review')
    .sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));
  const groups = buildScheduleGroups(reviews, data.lifecycleRanges).filter(group => group.tasks.length);

  if (!reviews.length) return <div className="schedule-reviews-empty">
    <Milestone size={28} aria-hidden="true" />
    <h2>{pt ? 'As revisões aparecem aqui' : 'Your reviews will appear here'}</h2>
    <p>{pt ? 'Crie uma revisão em “Nova atividade” ou escolha as revisões em “Planejar fases”. Depois, reúna os critérios e documentos de cada encontro.' : 'Create a review using “New activity” or choose reviews in “Plan phases”. Then bring together the criteria and documents for each meeting.'}</p>
  </div>;

  return <section className="planning-review-tree schedule-reviews" aria-label={pt ? 'Revisões e documentos' : 'Reviews and documents'}>
    {groups.map((group, groupIndex) => <section className="schedule-review-phase" key={group.id} aria-labelledby={`${treeId}-phase-${groupIndex}`}>
      <header className="schedule-review-phase-heading">
        <h2 id={`${treeId}-phase-${groupIndex}`}>
          {group.phase?.code && <span>{group.phase.code}</span>}
          {group.phase?.name || (pt ? 'Sem fase definida' : 'No phase assigned')}
        </h2>
        <small>{group.tasks.length} {pt ? (group.tasks.length === 1 ? 'revisão' : 'revisões') : (group.tasks.length === 1 ? 'review' : 'reviews')}</small>
      </header>
      <div className="schedule-review-phase-items">
        {group.tasks.map(task => {
          const requirements = task.requirementIds.map(id => data.requirements.find(requirement => requirement.id === id && !requirement.archived));
          const tests = task.testIds.map(id => data.tests.find(test => test.id === id && !test.archived));
          const total = requirements.length + tests.length;
          const complete = requirements.filter(requirement => requirement?.status === 'approved').length + tests.filter(test => test?.status === 'passed').length;
          const options = task.documentOptions || [];
          const prepared = options.filter(option => data.documents.some(document => document.taskId === task.id && document.templateId === option.id)).length;
          const owner = data.members.find(member => member.id === task.ownerId);
          const open = expanded.includes(task.id);
          const detailsId = `${treeId}-documents-${task.id}`;

          return <article className={`schedule-review${open ? ' is-open' : ''}`} key={task.id}>
            <header className="schedule-review-row">
              <button className="schedule-review-title" onClick={() => onSelect(task.id)}>
                <Milestone size={18} aria-hidden="true" />
                <span>
                  <strong>{task.title}</strong>
                  <small><CalendarDays size={12} aria-hidden="true" /><time dateTime={task.dueDate || undefined}>{reviewDate(task.dueDate, pt)}</time>{owner && <><i aria-hidden="true">·</i>{owner.name}</>}</small>
                </span>
              </button>
              <span className={`delivery-badge schedule-review-status ${task.reviewNeedsRevalidation ? 'stale' : task.status}`}>
                {task.reviewNeedsRevalidation ? (pt ? 'Revalidar' : 'Revalidate') : deliveryStatus(task.status, pt)}
              </span>
              <ReviewProgress value={complete} total={total} label={pt ? 'Critérios atendidos' : 'Criteria met'} emptyLabel={pt ? 'Vincule critérios' : 'Link criteria'} />
              <ReviewProgress value={prepared} total={options.length} label={pt ? 'Rascunhos preparados' : 'Drafts prepared'} emptyLabel={pt ? 'Sem documentos previstos' : 'No documents planned'} />
              <button className="schedule-review-expand" aria-expanded={open} aria-controls={detailsId} aria-label={`${pt ? 'Documentos de' : 'Documents for'} ${task.title}`} onClick={() => setExpanded(current => current.includes(task.id) ? current.filter(id => id !== task.id) : [...current, task.id])}>
                <FileText size={14} aria-hidden="true" /><span>{pt ? 'Documentos' : 'Documents'}</span>{open ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
              </button>
              {task.canEdit ? <button className="schedule-review-edit" disabled={busy} aria-label={`${pt ? 'Editar' : 'Edit'} ${task.title}`} title={pt ? 'Editar revisão' : 'Edit review'} onClick={() => onEdit(task.id)}><Pencil size={15} aria-hidden="true" /></button> : <span className="schedule-review-edit-placeholder" />}
            </header>
            {open && <div className="schedule-review-details" id={detailsId}>
              {task.reviewNeedsRevalidation && <p className="schedule-review-revalidation"><AlertCircle size={16} aria-hidden="true" />{pt ? 'Os critérios mudaram desde a última revisão. Confira os registros antes de concluir.' : 'The criteria changed since the last review. Check the records before completing it.'}</p>}
              <section className="schedule-review-criteria" aria-label={pt ? 'Critérios da revisão' : 'Review criteria'}>
                <h3><ListChecks size={16} aria-hidden="true" />{pt ? 'Critérios da revisão' : 'Review criteria'}</h3>
                <div className="schedule-review-links">
                  {requirements.map((requirement, index) => <button key={task.requirementIds[index]} onClick={() => openDeliveryRecord('requirements', task.requirementIds[index])}>
                    <span><small>{pt ? 'Requisito' : 'Requirement'}</small>{requirement?.title || task.requirementIds[index]}</span>
                    <small>{requirement ? deliveryStatus(requirement.status, pt) : (pt ? 'Indisponível' : 'Unavailable')}<ChevronRight size={13} aria-hidden="true" /></small>
                  </button>)}
                  {tests.map((test, index) => <button key={task.testIds[index]} onClick={() => openDeliveryRecord('verification', task.testIds[index])}>
                    <span><small>{pt ? 'Verificação' : 'Verification'}</small>{test?.title || task.testIds[index]}</span>
                    <small>{test ? deliveryStatus(test.status, pt) : (pt ? 'Indisponível' : 'Unavailable')}<ChevronRight size={13} aria-hidden="true" /></small>
                  </button>)}
                  {!total && <p>{pt ? 'Ainda não há requisitos ou verificações vinculados.' : 'No requirements or verifications linked yet.'}</p>}
                </div>
                {task.canEdit && <button className="schedule-review-link-action" disabled={busy} onClick={() => onEdit(task.id)}>{pt ? 'Vincular critérios' : 'Link criteria'}<ChevronRight size={13} aria-hidden="true" /></button>}
              </section>
              <section className="schedule-review-package" aria-label={pt ? 'Documentos da revisão' : 'Review documents'}>
                <h3><FileText size={16} aria-hidden="true" />{pt ? 'Documentos da revisão' : 'Review documents'}</h3>
                {options.length ? <ReviewDocuments compact projectId={projectId} data={data} task={task} pt={pt} busy={busy} mutate={mutate} error={error} /> : <p>{pt ? 'Nenhum modelo de documento previsto para esta revisão.' : 'No document templates planned for this review.'}</p>}
              </section>
            </div>}
          </article>;
        })}
      </div>
    </section>)}
  </section>;
}
