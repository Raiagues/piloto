import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import {
  AlertCircle,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  GanttChart,
  ListChecks,
  Lock,
  Pencil,
  Plus,
  Search,
  Undo2,
  X,
} from 'lucide-react';
import { lifecycleRanges } from '../../shared/delivery-lifecycle.mjs';
import { LifecycleBoard, LifecycleSettings, needsAttention } from '../components/delivery/LifecycleBoard';
import { ReviewTree } from '../components/delivery/ReviewTree';
import { ScheduleTaskPanel } from '../components/delivery/ScheduleTaskPanel';
import { DocumentWorkspace, documentLocation, templateLocation } from '../components/delivery/DocumentWorkspace';
import { DocumentTemplatePage } from '../components/delivery/DocumentTemplatePage';
import { ProjectAreaShell } from '../components/ProjectAreaShell';
import type { RailNavigation } from '../components/ProjectAreaShell';
import type { MissionProject } from '../lib/projectStore';
import type { Language } from '../lib/types';
import { useProjectDelivery, deliveryStatus } from '../lib/projectDelivery';
import type { DeliveryState, DeliveryTask, DeliveryLifecycle } from '../lib/projectDelivery';
import { describeScheduleMove, resolveScheduleDraft, scheduleMoveUndo } from '../lib/scheduleEditing';
import type { ScheduleMove, ScheduleQuickDraft } from '../lib/scheduleEditing';
import { previewScheduleTasks, timelineWindow } from '../lib/schedulePlanning';
import { countdown, reviewEntries } from '../lib/sidebarTree';
import { rememberWorkspace } from '../lib/workspaceHistory';
import {
  DeliveryAlert,
  DeliveryModal,
  DeliveryOwner,
  DeliverySector,
  DeliverySelect,
} from '../components/delivery/DeliveryShared';
type Draft = Pick<
  DeliveryTask,
  | 'parentId'
  | 'title'
  | 'description'
  | 'phaseId'
  | 'phase'
  | 'kind'
  | 'startDate'
  | 'dueDate'
  | 'prepDays'
  | 'closeDays'
  | 'status'
  | 'sectorId'
  | 'ownerId'
  | 'dependencyIds'
  | 'requirementIds'
  | 'testIds'
  | 'inputArtifactIds'
  | 'outputArtifactIds'
>;
function TaskEditor({
  data,
  original,
  busy,
  error,
  pt,
  onClose,
  onSave,
  mutate,
  initialPhaseId = '',
}: {
  initialPhaseId?: string;
  data: DeliveryState;
  original: DeliveryTask | null;
  busy: boolean;
  error: string;
  pt: boolean;
  onClose: () => void;
  onSave: (draft: Draft) => Promise<void>;
  mutate: (action: string, payload: Record<string, unknown>) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState<Draft>(
    original || {
      parentId: '',
      title: '',
      description: '',
      phaseId: initialPhaseId,
      phase: data.lifecycleRanges.find(phase => phase.id === initialPhaseId)?.name || '',
      kind: 'task',
      startDate: '',
      dueDate: '',
      prepDays: 0,
      closeDays: 0,
      status: 'planned',
      sectorId: data.permissions.manage ? '' : data.permissions.editableSectorIds[0] || '',
      ownerId: '',
      dependencyIds: [],
      requirementIds: [],
      testIds: [],
      inputArtifactIds: [],
      outputArtifactIds: [],
    },
  );
  const [managePhases, setManagePhases] = useState(false);
  const patch = (value: Partial<Draft>) => setDraft(d => ({ ...d, ...value }));
  return (
    <DeliveryModal
      title={
        pt
          ? original
            ? 'Editar atividade'
            : 'Nova atividade ou revisão'
          : original
            ? 'Edit activity'
            : 'New activity or review'
      }
      onClose={onClose}
    >
      <form
        onSubmit={e => {
          e.preventDefault();
          void onSave({ ...draft, phase: data.lifecycleRanges.find(p => p.id === draft.phaseId)?.name || draft.phase });
        }}
      >
        <label>
          {pt ? 'Título' : 'Title'}
          <input
            autoFocus
            required
            maxLength={200}
            value={draft.title}
            onChange={e => patch({ title: e.target.value })}
          />
        </label>
        <div className="delivery-form-grid">
          <label>
            {pt ? 'Tipo' : 'Type'}
            <select value={draft.kind} onChange={e => patch({ kind: e.target.value })}>
              <option value="task">{pt ? 'Atividade' : 'Activity'}</option>
              <option value="review">{pt ? 'Marco de revisão' : 'Review milestone'}</option>
            </select>
          </label>
          <label>
            {pt ? 'Fase / etapa' : 'Phase / stage'}
            <select
              value={draft.phaseId || ''}
              onChange={e =>
                patch({
                  phaseId: e.target.value,
                  phase: data.lifecycleRanges.find(p => p.id === e.target.value)?.name || '',
                })
              }
            >
              <option value="">{draft.phase && !draft.phaseId ? draft.phase : pt ? 'Sem fase' : 'No phase'}</option>
              {data.lifecycleRanges.map(p => (
                <option key={p.id} value={p.id}>
                  {p.code} · {p.name}
                </option>
              ))}
            </select>
            {data.permissions.manage && (
              <button type="button" onClick={() => setManagePhases(true)}>
                {pt ? 'Adicionar ou editar fases' : 'Add or edit phases'}
              </button>
            )}
          </label>
          <label>
            {pt ? 'Início' : 'Start'}
            <input type="date" value={draft.startDate} onChange={e => patch({ startDate: e.target.value })} />
          </label>
          <label>
            {pt ? 'Prazo / data da revisão' : 'Due / review date'}
            <input
              type="date"
              min={draft.startDate || undefined}
              value={draft.dueDate}
              onChange={e => patch({ dueDate: e.target.value })}
            />
          </label>
          <DeliveryOwner data={data} value={draft.ownerId} onChange={ownerId => patch({ ownerId })} pt={pt} />
          <DeliverySector data={data} value={draft.sectorId} onChange={sectorId => patch({ sectorId })} pt={pt} />
          <label>
            {pt ? 'Situação' : 'Status'}
            <select value={draft.status} onChange={e => patch({ status: e.target.value })}>
              {['planned', 'in_progress', 'blocked', 'done'].map(status => (
                <option key={status} value={status}>
                  {deliveryStatus(status, pt)}
                </option>
              ))}
            </select>
          </label>
        </div>
        {draft.kind === 'review' && (
          <div className="delivery-form-grid">
            <label>
              {pt ? 'Preparação (dias antes)' : 'Preparation (days before)'}
              <input
                type="number"
                min={0}
                max={365}
                value={draft.prepDays}
                onChange={e => patch({ prepDays: Number(e.target.value) })}
              />
            </label>
            <label>
              {pt ? 'Fechamento (dias depois)' : 'Closeout (days after)'}
              <input
                type="number"
                min={0}
                max={365}
                value={draft.closeDays}
                onChange={e => patch({ closeDays: Number(e.target.value) })}
              />
            </label>
          </div>
        )}
        <label>
          {pt ? 'Descrição' : 'Description'}
          <textarea maxLength={8000} value={draft.description} onChange={e => patch({ description: e.target.value })} />
        </label>
        <label>
          {pt ? 'Atividade superior' : 'Parent activity'}
          <select value={draft.parentId || ''} onChange={event => patch({ parentId: event.target.value })}>
            <option value="">{pt ? 'Atividade independente' : 'Independent activity'}</option>
            {data.tasks
              .filter(task => !task.archived && task.id !== original?.id && task.kind !== 'review')
              .map(task => (
                <option key={task.id} value={task.id}>
                  {task.title}
                </option>
              ))}
          </select>
        </label>
        <DeliverySelect
          label={pt ? 'Depende da conclusão de' : 'Depends on completion of'}
          choices={data.tasks
            .filter(t => !t.archived && t.id !== original?.id)
            .map(t => ({ id: t.id, label: t.title }))}
          selected={draft.dependencyIds}
          onChange={dependencyIds => patch({ dependencyIds })}
        />
        <details>
          <summary>
            {pt ? 'Requisitos, verificações e entregas' : 'Requirements, verifications and deliverables'}
          </summary>
          <div className="delivery-detail">
            <DeliverySelect
              label={pt ? 'Requisitos' : 'Requirements'}
              choices={data.requirements
                .filter(r => !r.archived)
                .map(r => ({ id: r.id, label: `${r.id} · ${r.title}` }))}
              selected={draft.requirementIds}
              onChange={requirementIds => patch({ requirementIds })}
            />
            <DeliverySelect
              label={pt ? 'Verificações' : 'Verifications'}
              choices={data.tests.filter(t => !t.archived).map(t => ({ id: t.id, label: t.title }))}
              selected={draft.testIds}
              onChange={testIds => patch({ testIds })}
            />
            <DeliverySelect
              label={pt ? 'Documentos de entrada' : 'Input documents'}
              choices={data.artifacts.map(a => ({ id: a.id, label: a.label }))}
              selected={draft.inputArtifactIds}
              onChange={inputArtifactIds => patch({ inputArtifactIds })}
            />
            <DeliverySelect
              label={pt ? 'Registros de saída' : 'Output records'}
              choices={data.artifacts.map(a => ({ id: a.id, label: a.label }))}
              selected={draft.outputArtifactIds}
              onChange={outputArtifactIds => patch({ outputArtifactIds })}
            />
          </div>
        </details>
        {error && (
          <p role="alert" className="delivery-inline-error">
            {error}
          </p>
        )}
        <footer>
          <button type="button" onClick={onClose}>
            {pt ? 'Cancelar' : 'Cancel'}
          </button>
          <button type="submit" className="primary" disabled={busy}>
            {pt ? 'Salvar atividade' : 'Save activity'}
          </button>
        </footer>
      </form>
      {managePhases && (
        <DeliveryModal title={pt ? 'Fases do projeto' : 'Project phases'} onClose={() => setManagePhases(false)}>
          <LifecycleSettings
            data={data}
            busy={busy}
            error={error}
            mutate={mutate}
            pt={pt}
            onClose={() => setManagePhases(false)}
          />
        </DeliveryModal>
      )}
    </DeliveryModal>
  );
}
type Mode = 'gantt' | 'reviews';
type Scale = 'all' | 'year' | 'quarter';
type ScheduleLocation = { review: string; document: string; template: string; record: string; quiet: boolean };
const DAY = 86_400_000;
const readLocation = (quiet = false): ScheduleLocation => {
  const params = new URL(window.location.href).searchParams;
  return {
    review: params.get('review') || '',
    document: params.get('document') || '',
    template: params.get('template') || '',
    record: params.get('delivery-record') || '',
    quiet,
  };
};

/** Fixed next to the clicked bar; below it when there is room, otherwise above. Small screens get a bottom sheet from CSS. */
function ActivityPopover({ taskId, onClose, children }: { taskId: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null),
    [style, setStyle] = useState<CSSProperties>({ visibility: 'hidden' });
  useLayoutEffect(() => {
    const place = () => {
      if (window.matchMedia('(max-width: 760px)').matches) {
        setStyle({});
        return;
      }
      const anchor = document.querySelector<HTMLElement>(`.schedule-gantt [data-task-id="${CSS.escape(taskId)}"]`);
      const width = Math.min(380, window.innerWidth - 24);
      if (!anchor) {
        setStyle({ right: 16, top: 120, width, maxHeight: 'min(560px, calc(100dvh - 136px))' });
        return;
      }
      const rect = anchor.getBoundingClientRect(),
        left = Math.min(Math.max(12, rect.left), window.innerWidth - width - 12);
      const ceiling = document.querySelector('.app-header')?.getBoundingClientRect().bottom ?? 0;
      const below = window.innerHeight - rect.bottom - 16,
        above = rect.top - ceiling - 16;
      setStyle(
        below >= 360 || below >= above
          ? { left, width, top: rect.bottom + 8, maxHeight: Math.min(560, below) }
          : { left, width, bottom: window.innerHeight - rect.top + 8, maxHeight: Math.min(560, above) },
      );
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [taskId]);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (
        !target ||
        ref.current?.contains(target) ||
        target.closest('.schedule-gantt [data-task-id], .delivery-dialog, [role="dialog"]')
      )
        return;
      onClose();
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [onClose]);
  return (
    <div ref={ref} className="schedule-popover" style={style}>
      {children}
    </div>
  );
}

export function SchedulePage({
  language,
  project,
  navigation,
}: {
  language: Language;
  project: MissionProject;
  navigation: RailNavigation;
}) {
  const pt = language === 'pt',
    { data, error, busy, refresh, mutate } = useProjectDelivery(project.id);
  const today = new Date().toISOString().slice(0, 10),
    todayTime = Date.parse(`${today}T00:00:00Z`);
  const [location, setLocation] = useState(() => readLocation());
  const quiet = useRef(''),
    workspace = useRef<HTMLDivElement>(null);
  // A document opens at its top, not at the scroll position of the review list.
  useLayoutEffect(() => {
    if (location.document || location.template) workspace.current?.closest('.project-area-body')?.scrollTo({ top: 0 });
  }, [location.document, location.template]);
  useEffect(() => {
    const update = () => {
      const own = quiet.current === window.location.search;
      quiet.current = '';
      setLocation(readLocation(own));
    };
    window.addEventListener('popstate', update);
    return () => window.removeEventListener('popstate', update);
  }, []);
  /** Keeps the address in step with what is open, without scrolling or reopening anything. */
  const writeLocation = (patch: Record<string, string>) => {
    const url = new URL(window.location.href);
    for (const [key, value] of Object.entries(patch)) {
      if (value) url.searchParams.set(key, value);
      else url.searchParams.delete(key);
    }
    url.searchParams.set('project', project.id);
    quiet.current = url.search;
    window.history.replaceState(null, '', url);
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  const [editMode, setEditMode] = useState(false);
  const [mode, setMode] = useState<Mode>(() => (location.review ? 'reviews' : 'gantt'));
  const [expanded, setExpanded] = useState<string[]>(() => (location.review ? [location.review] : []));
  const [focus, setFocus] = useState<{ id: string } | undefined>(() =>
    location.review ? { id: location.review } : undefined,
  );
  const [selectedId, setSelectedId] = useState(''),
    [editing, setEditing] = useState<string | null>(null);
  const [template, setTemplate] = useState(false),
    [preview, setPreview] = useState<DeliveryLifecycle | null>(null),
    [focusPhase, setFocusPhase] = useState('');
  const [creationPhase, setCreationPhase] = useState('');
  const [drafts, setDrafts] = useState<Record<string, Record<string, ScheduleQuickDraft>>>({});
  const [moveNotice, setMoveNotice] = useState<(ScheduleMove & { projectId: string }) | null>(null);
  const [query, setQuery] = useState(''),
    [onlyAttention, setOnlyAttention] = useState(false);
  const [scale, setScale] = useState<Scale>('all'),
    [cursor, setCursor] = useState<number | null>(null);

  const openReview = useCallback((id: string, scroll = true) => {
    setMode('reviews');
    setSelectedId('');
    setExpanded(current => (current.includes(id) ? current : [...current, id]));
    if (scroll) setFocus({ id });
  }, []);
  // Links from the sidebar, search and history: a review opens in place, an activity opens over the Gantt.
  const recordKnown = Boolean(location.record && data?.tasks.some(task => task.id === location.record));
  useEffect(() => {
    if (location.quiet || location.document || location.template) return;
    const record = location.record ? data?.tasks.find(task => task.id === location.record) : undefined;
    if (location.review) openReview(location.review);
    else if (record?.kind === 'review') openReview(record.id);
    else if (record) {
      setMode('gantt');
      setSelectedId(record.id);
    }
  }, [location, recordKnown, openReview]);

  const remember = (task: DeliveryTask) =>
    rememberWorkspace(task.title, {
      kind: 'review',
      context: project.name,
      detail: task.dueDate
        ? new Date(`${task.dueDate}T12:00:00`).toLocaleDateString(pt ? 'pt-BR' : 'en', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
          })
        : '',
    });
  const toggleReview = (id: string) => {
    const open = expanded.includes(id),
      next = open ? expanded.filter(item => item !== id) : [...expanded, id];
    setExpanded(next);
    writeLocation({
      review: open ? next[next.length - 1] || '' : id,
      document: '',
      template: '',
      'delivery-record': '',
    });
    const task = data?.tasks.find(item => item.id === id);
    if (!open && task) remember(task);
  };
  const showReview = (id: string) => {
    openReview(id);
    writeLocation({ review: id, document: '', template: '', 'delivery-record': '' });
    const task = data?.tasks.find(item => item.id === id);
    if (task) remember(task);
  };
  const chooseMode = (next: Mode) => {
    setMode(next);
    setSelectedId('');
    if (next === 'gantt') writeLocation({ review: '', document: '', template: '', 'delivery-record': '' });
    else if (expanded.length) writeLocation({ review: expanded[expanded.length - 1], 'delivery-record': '' });
  };
  const openDocument = (id: string) =>
    documentLocation(project.id, id, data?.documents.find(item => item.id === id)?.taskId);
  const openTemplate = (taskId: string, templateId: string) => templateLocation(project.id, taskId, templateId);

  const selected = data?.tasks.find(task => task.id === selectedId);
  const projectDrafts = drafts[project.id] || {};
  const updateDraft = (id: string, draft: ScheduleQuickDraft | null) =>
    setDrafts(current => {
      const next = { ...current[project.id] };
      if (draft) next[id] = draft;
      else delete next[id];
      return { ...current, [project.id]: next };
    });
  const closeTemplate = () => {
    setTemplate(false);
    setPreview(null);
    setFocusPhase('');
  };
  const configure = (phase = '') => {
    setEditMode(true);
    setFocusPhase(phase);
    setSelectedId('');
    setMode('gantt');
    setTemplate(true);
  };
  const closeActivity = useCallback(() => {
    setSelectedId('');
    if (new URL(window.location.href).searchParams.has('delivery-record')) writeLocation({ 'delivery-record': '' });
  }, [project.id]);
  const selectTask = (id: string) => {
    const task = data?.tasks.find(item => item.id === id);
    if (task?.kind === 'review') {
      showReview(id);
      return;
    }
    closeTemplate();
    setSelectedId(id);
  };
  const editTask = (id: string) => {
    const task = data?.tasks.find(item => item.id === id);
    if (!editMode || !task?.canEdit || busy) return;
    if (resolveScheduleDraft(task, projectDrafts[id] || null).conflicts.length) {
      if (task.kind === 'review') showReview(id);
      else selectTask(id);
      return;
    }
    setEditing(id);
  };
  const create = (phase = '') => {
    setEditMode(true);
    setCreationPhase(phase);
    setEditing('new');
  };
  const moveTask = async (id: string, dueDate: string) => {
    const task = data?.tasks.find(item => item.id === id);
    if (!editMode || !task || busy) return;
    const move = describeScheduleMove(task, dueDate);
    if (await mutate('task.reschedule', { id, dueDate })) setMoveNotice({ ...move, projectId: project.id });
  };

  const lifecycle = preview || data?.lifecycle;
  const ranges = useMemo(() => (lifecycle ? lifecycleRanges(lifecycle) : []), [lifecycle]);
  const tasks = useMemo(
    () => (!data ? [] : preview ? previewScheduleTasks(data, preview) : data.tasks.filter(task => !task.archived)),
    [data, preview],
  );
  const full = useMemo(() => timelineWindow(tasks, ranges, today), [tasks, ranges, today]);
  const span = scale === 'all' ? full.span : (scale === 'quarter' ? 91 : 365) * DAY;
  const start =
    scale === 'all'
      ? full.start
      : (cursor ?? (todayTime >= full.start && todayTime <= full.end ? todayTime - 14 * DAY : full.start));
  const view = useMemo(() => ({ start, end: start + span, span }), [start, span]);
  const entries = useMemo(() => (data ? reviewEntries(data, today) : []), [data, today]);
  const upcoming = entries.find(entry => entry.state === 'overdue') || entries.find(entry => entry.state === 'next');
  const attentionCount = preview ? 0 : tasks.filter(needsAttention).length;

  const undoItem =
    moveNotice?.projectId === project.id
      ? scheduleMoveUndo(
          data?.tasks.find(task => task.id === moveNotice.id),
          moveNotice,
        )
      : null;
  const editingTask = data?.tasks.find(task => task.id === editing);
  const editingOriginal = editingTask
    ? resolveScheduleDraft(editingTask, projectDrafts[editingTask.id] || null).item
    : null;
  const hasSchedule = Boolean(data?.tasks.some(task => !task.archived) || data?.lifecycleRanges.length);
  const canEdit = Boolean(data?.permissions.manage || data?.permissions.editableSectorIds.length);
  const reviews = data?.tasks.filter(task => !task.archived && task.kind === 'review').length || 0;
  const activeDocument = location.document ? data?.documents.find(item => item.id === location.document) : undefined;
  const documentReview = data?.tasks.find(task => task.id === (activeDocument?.taskId || location.review));
  const backToReview = () => documentLocation(project.id, '', documentReview?.id);
  const scaleLabel = (
    pt
      ? { all: 'Projeto inteiro', year: '12 meses', quarter: '3 meses' }
      : { all: 'Whole project', year: '12 months', quarter: '3 months' }
  )[scale];

  const templateReview = location.template
    ? data?.tasks.find(task => task.id === location.review && task.kind === 'review' && !task.archived)
    : undefined;
  if (data && location.template && !location.document)
    return (
      <ProjectAreaShell language={language} project={project} area="schedule" navigation={navigation}>
        <div ref={workspace} className="delivery-workspace planning-workspace schedule-document-view">
          <DeliveryAlert error={error} refresh={refresh} pt={pt} />
          {templateReview ? (
            <DocumentTemplatePage
              key={`${templateReview.id}:${location.template}`}
              projectId={project.id}
              data={data}
              task={templateReview}
              templateId={location.template}
              busy={busy}
              error={error}
              mutate={mutate}
              pt={pt}
              onClose={() => documentLocation(project.id, '', templateReview.id)}
              onOpenDocument={openDocument}
            />
          ) : (
            <div className="schedule-reviews-empty">
              <h2>{pt ? 'Revisão indisponível' : 'Review unavailable'}</h2>
              <p>
                {pt
                  ? 'Ela pode ter sido removida ou você não tem mais acesso.'
                  : 'It may have been removed or you no longer have access.'}
              </p>
            </div>
          )}
        </div>
      </ProjectAreaShell>
    );

  if (data && location.document)
    return (
      <ProjectAreaShell language={language} project={project} area="schedule" navigation={navigation}>
        <div ref={workspace} className="delivery-workspace planning-workspace schedule-document-view">
          <DeliveryAlert error={error} refresh={refresh} pt={pt} />
          {activeDocument ? (
            <DocumentWorkspace
              projectId={project.id}
              context={documentReview?.reviewCode || ''}
              data={data}
              activeId={activeDocument.id}
              onSelect={openDocument}
              onClose={backToReview}
              busy={busy}
              error={error}
              mutate={mutate}
              pt={pt}
            />
          ) : (
            <div className="schedule-reviews-empty">
              <h2>{pt ? 'Documento indisponível' : 'Document unavailable'}</h2>
              <p>
                {pt
                  ? 'Ele pode ter sido removido ou você não tem mais acesso.'
                  : 'It may have been removed or you no longer have access.'}
              </p>
            </div>
          )}
        </div>
      </ProjectAreaShell>
    );

  return (
    <ProjectAreaShell language={language} project={project} area="schedule" navigation={navigation}>
      <div className={`delivery-workspace planning-workspace is-${mode}`}>
        <DeliveryAlert error={error} refresh={refresh} pt={pt} />
        {!data ? (
          <p className="delivery-loading">{pt ? 'Carregando cronograma…' : 'Loading schedule…'}</p>
        ) : (
          <>
            <div className="planning-toolbar">
              <div className="planning-tabs" aria-label={pt ? 'Visualizações do cronograma' : 'Schedule views'}>
                <button aria-pressed={mode === 'gantt'} onClick={() => chooseMode('gantt')}>
                  <GanttChart size={15} aria-hidden="true" />
                  Gantt
                </button>
                <button
                  aria-label={pt ? 'Revisões' : 'Reviews'}
                  aria-pressed={mode === 'reviews'}
                  onClick={() => {
                    closeTemplate();
                    chooseMode('reviews');
                  }}
                >
                  <ListChecks size={15} aria-hidden="true" />
                  {pt ? 'Revisões' : 'Reviews'}
                  <small>{reviews}</small>
                </button>
              </div>
              {upcoming && !preview && (
                <button
                  type="button"
                  className={`schedule-next-review state-${upcoming.state}`}
                  onClick={() => showReview(upcoming.id)}
                >
                  <i aria-hidden="true" />
                  <span>{upcoming.state === 'overdue' ? (pt ? 'Atrasada' : 'Overdue') : pt ? 'Próxima' : 'Next'}</span>
                  <b>{upcoming.code}</b>
                  <em>{countdown(upcoming.dueDate, today, pt)}</em>
                  {upcoming.planned > 0 && (
                    <small>
                      {upcoming.prepared}/{upcoming.planned} {pt ? 'docs' : 'docs'}
                    </small>
                  )}
                </button>
              )}
              {mode === 'gantt' && hasSchedule && (
                <div className="schedule-tools">
                  <label className="schedule-search">
                    <Search size={14} aria-hidden="true" />
                    <input
                      type="search"
                      aria-label={pt ? 'Filtrar o cronograma' : 'Filter the schedule'}
                      placeholder={pt ? 'Filtrar' : 'Filter'}
                      value={query}
                      onChange={event => setQuery(event.target.value)}
                    />
                  </label>
                  {attentionCount > 0 && (
                    <button
                      type="button"
                      className={`schedule-attention-toggle${onlyAttention ? ' active' : ''}`}
                      aria-pressed={onlyAttention}
                      title={pt ? 'Destacar o que precisa de atenção' : 'Highlight what needs attention'}
                      onClick={() => setOnlyAttention(value => !value)}
                    >
                      <AlertCircle size={14} aria-hidden="true" />
                      {attentionCount}
                      <span>{pt ? 'pendências' : 'need attention'}</span>
                    </button>
                  )}
                  <div className="schedule-scale" role="group" aria-label={pt ? 'Período exibido' : 'Visible period'}>
                    {scale !== 'all' && (
                      <button
                        type="button"
                        aria-label={pt ? 'Período anterior' : 'Previous period'}
                        onClick={() => setCursor(start - span / 2)}
                      >
                        <ChevronLeft size={15} />
                      </button>
                    )}
                    <select
                      aria-label={pt ? 'Escala do cronograma' : 'Schedule scale'}
                      value={scale}
                      title={scaleLabel}
                      onChange={event => {
                        setScale(event.target.value as Scale);
                        setCursor(null);
                      }}
                    >
                      <option value="all">{pt ? 'Projeto inteiro' : 'Whole project'}</option>
                      <option value="year">{pt ? '12 meses' : '12 months'}</option>
                      <option value="quarter">{pt ? '3 meses' : '3 months'}</option>
                    </select>
                    {scale !== 'all' && (
                      <button
                        type="button"
                        aria-label={pt ? 'Próximo período' : 'Next period'}
                        onClick={() => setCursor(start + span / 2)}
                      >
                        <ChevronRight size={15} />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        if (scale === 'all') setScale('quarter');
                        setCursor(todayTime - 14 * DAY);
                      }}
                    >
                      {pt ? 'Hoje' : 'Today'}
                    </button>
                  </div>
                </div>
              )}
              <div className="planning-controls">
                {canEdit && (
                  <button
                    className={editMode ? 'primary' : ''}
                    aria-pressed={editMode}
                    disabled={busy}
                    onClick={() => {
                      setEditMode(value => !value);
                      closeTemplate();
                    }}
                  >
                    {editMode ? <CheckCheck size={15} /> : <Pencil size={15} />}
                    {editMode ? (pt ? 'Sair da edição' : 'Exit editing') : pt ? 'Editar planejamento' : 'Edit planning'}
                  </button>
                )}
                {editMode && data.permissions.manage && (
                  <button
                    data-usage-action="schedule.template"
                    disabled={busy}
                    aria-label={pt ? 'Modelo de ciclo de vida' : 'Lifecycle template'}
                    aria-expanded={template}
                    onClick={() => (template ? closeTemplate() : configure())}
                  >
                    <CalendarDays size={15} />
                    {pt ? 'Planejar fases' : 'Plan phases'}
                  </button>
                )}
                {editMode && canEdit && (
                  <button onClick={() => create()}>
                    <Plus size={15} />
                    {pt ? 'Nova atividade' : 'New activity'}
                  </button>
                )}
              </div>
            </div>
            {data.permissions.readOnly && (
              <p className="delivery-readonly" role="note">
                <Lock size={14} aria-hidden="true" />
                <span>
                  <strong>{pt ? 'Somente leitura nesta versão de teste.' : 'Read only in this test version.'}</strong>{' '}
                  {pt
                    ? 'Consulte o cronograma e as revisões, abra os documentos e modelos, baixe PDF ou LaTeX e envie ao Overleaf. Datas, rascunhos e revisões não podem ser alterados.'
                    : 'Browse the schedule and reviews, open documents and templates, download PDF or LaTeX and send to Overleaf. Dates, drafts and reviews cannot be changed.'}
                </span>
              </p>
            )}
            {moveNotice && undoItem && (
              <div className="schedule-save-status" role="status">
                <Check size={15} />
                <span>{pt ? 'Planejamento atualizado' : 'Planning updated'}</span>
                <button
                  disabled={busy}
                  onClick={async () => {
                    if (!busy && (await mutate('task.undo_reschedule', { id: undoItem.id }))) setMoveNotice(null);
                  }}
                >
                  <Undo2 size={13} />
                  {pt ? 'Desfazer' : 'Undo'}
                </button>
                <button
                  aria-label={pt ? 'Fechar confirmação' : 'Dismiss confirmation'}
                  onClick={() => setMoveNotice(null)}
                >
                  <X size={14} />
                </button>
              </div>
            )}
            <div className={`planning-layout${template ? ' with-settings' : ''}`}>
              <div className="planning-main">
                {mode === 'gantt' ? (
                  <LifecycleBoard
                    data={data}
                    language={language}
                    tasks={tasks}
                    ranges={ranges}
                    window={view}
                    today={today}
                    query={query}
                    attention={onlyAttention}
                    selectedId={selectedId}
                    busy={busy}
                    preview={preview}
                    onSelect={selectTask}
                    onOpenReview={showReview}
                    onConfigure={data.permissions.manage && (editMode || !hasSchedule) ? () => configure() : undefined}
                    onEditPhase={editMode && data.permissions.manage ? configure : undefined}
                    onCreate={canEdit && (editMode || !hasSchedule) ? create : undefined}
                    onMove={editMode ? moveTask : undefined}
                  />
                ) : (
                  <ReviewTree
                    editingEnabled={editMode}
                    projectId={project.id}
                    data={data}
                    pt={pt}
                    busy={busy}
                    error={error}
                    today={today}
                    expanded={expanded}
                    focus={focus}
                    onToggle={toggleReview}
                    onEdit={editTask}
                    onOpenDocument={openDocument}
                    onOpenTemplate={openTemplate}
                    drafts={projectDrafts}
                    onDraftChange={updateDraft}
                    mutate={mutate}
                  />
                )}
              </div>
              {template && (
                <LifecycleSettings
                  data={data}
                  busy={busy}
                  mutate={mutate}
                  pt={pt}
                  onClose={closeTemplate}
                  onPreview={setPreview}
                  focusPhase={focusPhase}
                  error={error}
                />
              )}
            </div>
            {mode === 'gantt' && !template && selected && selected.kind !== 'review' && editing === null && (
              <ActivityPopover key={selected.id} taskId={selected.id} onClose={closeActivity}>
                <ScheduleTaskPanel
                  editingEnabled={editMode}
                  key={`${project.id}:${selected.id}`}
                  projectId={project.id}
                  data={data}
                  task={selected}
                  draft={projectDrafts[selected.id] || null}
                  onDraftChange={draft => updateDraft(selected.id, draft)}
                  pt={pt}
                  busy={busy}
                  error={error}
                  mutate={mutate}
                  onClose={closeActivity}
                  onEdit={() => editTask(selected.id)}
                  onSelect={selectTask}
                />
              </ActivityPopover>
            )}
          </>
        )}
      </div>
      {data && editing !== null && (
        <TaskEditor
          key={`${project.id}:${editing}`}
          initialPhaseId={creationPhase}
          data={data}
          original={editingOriginal}
          busy={busy}
          error={error}
          pt={pt}
          mutate={mutate}
          onClose={() => setEditing(null)}
          onSave={async item => {
            if (!busy && (await mutate('task.save', { ...(editing !== 'new' ? { id: editing } : {}), item }))) {
              if (editing !== 'new') updateDraft(editing, null);
              setEditing(null);
            }
          }}
        />
      )}
    </ProjectAreaShell>
  );
}
