import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { CalendarDays, Pencil, Plus } from 'lucide-react';
import type { LifecycleRange } from '../../../shared/delivery-lifecycle.mjs';
import { shiftDate } from '../../../shared/delivery-lifecycle.mjs';
import type { DeliveryLifecycle, DeliveryState, DeliveryTask } from '../../lib/projectDelivery';
import { deliveryStatus } from '../../lib/projectDelivery';
import { buildScheduleGroups } from '../../lib/schedulePlanning';
import type { ScheduleTask } from '../../lib/schedulePlanning';
import { DAY, LANE_ROW, axisTiers, fitLanes, layoutLanes, reviewCode, utcTime } from '../../lib/ganttLayout';
import type { GanttPlacement, GanttWindow } from '../../lib/ganttLayout';
import { reviewEntries } from '../../lib/sidebarTree';
import type { Language } from '../../lib/types';
import '../../styles/delivery-planning.css';
import '../../styles/schedule-canvas.css';
export { LifecycleSettings } from './LifecycleSettings';

type Drag = { id: string; startX: number; width: number; date: string; days: number; moved: boolean };
type Props = {
  data: DeliveryState;
  language: Language;
  tasks: ScheduleTask[];
  ranges: LifecycleRange[];
  window: GanttWindow;
  today: string;
  query?: string;
  attention?: boolean;
  selectedId?: string;
  busy?: boolean;
  preview?: DeliveryLifecycle | null;
  onSelect: (id: string, anchor: HTMLElement | null) => void;
  onOpenReview: (id: string) => void;
  onConfigure?: () => void;
  onEditPhase?: (id: string) => void;
  onCreate?: (phaseId?: string) => void;
  onMove?: (id: string, date: string) => Promise<unknown>;
};
export const needsAttention = (task: DeliveryTask) =>
  task.status !== 'done' &&
  (task.overdue || task.status === 'blocked' || task.blockedBy.length > 0 || task.dateConflicts.length > 0);
const shortDate = (time: number, pt: boolean, year = false) =>
  new Date(time)
    .toLocaleDateString(pt ? 'pt-BR' : 'en', {
      day: '2-digit',
      month: 'short',
      ...(year ? { year: 'numeric' } : {}),
      timeZone: 'UTC',
    })
    .replace('.', '');

/** The project on one screen: a lane per phase, its review milestones and activities, today and the phase windows. */
export function LifecycleBoard({
  data,
  language,
  tasks,
  ranges,
  window: view,
  today,
  query = '',
  attention = false,
  selectedId,
  busy = false,
  preview,
  onSelect,
  onOpenReview,
  onConfigure,
  onEditPhase,
  onCreate,
  onMove,
}: Props) {
  const pt = language === 'pt';
  const bodyRef = useRef<HTMLDivElement>(null),
    axisRef = useRef<HTMLDivElement>(null),
    drag = useRef<Drag | null>(null),
    suppressClick = useRef(false);
  const [width, setWidth] = useState(900),
    [available, setAvailable] = useState(0),
    [dragDate, setDragDate] = useState<{ id: string; date: string } | null>(null);
  useLayoutEffect(() => {
    const body = bodyRef.current,
      axis = axisRef.current;
    if (!body || !axis) return;
    const measure = () => {
      setWidth(Math.max(200, axis.getBoundingClientRect().width));
      setAvailable(Math.max(0, body.clientHeight - (axis.parentElement?.offsetHeight || 0)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(body);
    observer.observe(axis);
    return () => observer.disconnect();
  }, [tasks.length, ranges.length]);
  const groups = useMemo(() => buildScheduleGroups(tasks, ranges), [tasks, ranges]);
  const lanes = useMemo(() => layoutLanes(groups, view, width), [groups, view, width]);
  const rows = useMemo(
    () =>
      fitLanes(
        lanes.map(lane => lane.height),
        available,
      ),
    [lanes, available],
  );
  const axis = useMemo(() => axisTiers(view, width, language), [view, width, language]);
  const entries = useMemo(() => new Map(reviewEntries(data, today).map(entry => [entry.id, entry])), [data, today]);
  const todayTime = utcTime(today)!,
    todayIn = todayTime >= view.start && todayTime <= view.end;
  const percent = (time: number) => ((time - view.start) / view.span) * 100;
  const search = query.trim().toLocaleLowerCase(pt ? 'pt-BR' : 'en');
  const member = (id: string) => data.members.find(person => person.id === id)?.name || '';
  const dimmed = (task: ScheduleTask, lane: string) =>
    (attention && !preview && !needsAttention(task)) ||
    (search &&
      !`${task.title} ${task.reviewCode || ''} ${member(task.ownerId)} ${lane}`
        .toLocaleLowerCase(pt ? 'pt-BR' : 'en')
        .includes(search));

  if (!tasks.length && !ranges.length)
    return (
      <div className="schedule-empty-start">
        <CalendarDays size={30} />
        <h2>{pt ? 'Dê uma sequência ao projeto' : 'Give your project a sequence'}</h2>
        <p>
          {pt
            ? 'Comece com as fases e revisões de um modelo, ou planeje uma atividade.'
            : 'Start with the phases and reviews of a template, or plan an activity.'}
        </p>
        <div>
          {onConfigure && (
            <button className="primary" onClick={onConfigure}>
              {pt ? 'Escolher fases do projeto' : 'Choose project phases'}
            </button>
          )}
          {onCreate && <button onClick={() => onCreate()}>{pt ? 'Adicionar uma atividade' : 'Add an activity'}</button>}
        </div>
      </div>
    );

  const movable = (task: ScheduleTask) => task.canEdit && !busy && !preview && Boolean(onMove);
  const dragHandlers = (task: ScheduleTask, date: string) => ({
    onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => {
      suppressClick.current = false;
      if (!movable(task) || event.button !== 0) return;
      drag.current = {
        id: task.id,
        startX: event.clientX,
        width: axisRef.current?.getBoundingClientRect().width || width,
        date,
        days: 0,
        moved: false,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => {
      const state = drag.current;
      if (!state || state.id !== task.id) return;
      const distance = event.clientX - state.startX;
      state.moved ||= Math.abs(distance) > 5;
      if (!state.moved) return;
      state.days = Math.round(((distance / state.width) * view.span) / DAY);
      setDragDate({ id: task.id, date: shiftDate(state.date, state.days) });
    },
    onPointerUp: () => {
      const state = drag.current;
      drag.current = null;
      setDragDate(null);
      if (state?.moved) {
        suppressClick.current = true;
        if (state.days) void onMove?.(task.id, shiftDate(state.date, state.days));
      }
    },
    onPointerCancel: () => {
      drag.current = null;
      setDragDate(null);
      suppressClick.current = true;
    },
    onKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => {
      if (event.key === 'Escape' && drag.current) {
        drag.current = null;
        setDragDate(null);
        suppressClick.current = true;
      }
      if (movable(task) && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
        event.preventDefault();
        void onMove?.(task.id, shiftDate(date, (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 7 : 1)));
      }
    },
  });
  const moveHint = pt
    ? 'Arraste para mover a data; as setas movem um dia, Shift move sete.'
    : 'Drag to move the date; arrows move one day, Shift moves seven.';
  const shift = (placement: GanttPlacement) =>
    dragDate?.id === placement.task.id
      ? utcTime(dragDate.date)! - utcTime(placement.task.dueDate || placement.task.startDate)!
      : 0;

  const review = (placement: GanttPlacement, lane: string) => {
    const task = placement.task,
      entry = entries.get(task.id),
      at = placement.from + shift(placement),
      code = reviewCode(task);
    const state = entry?.state || (task.status === 'done' ? 'done' : 'planned');
    const date = task.dueDate || task.startDate,
      canMove = movable(task);
    const docs =
      entry && entry.planned
        ? pt
          ? `${entry.prepared} de ${entry.planned} documentos preparados`
          : `${entry.prepared} of ${entry.planned} documents prepared`
        : '';
    const prep = (task.prepDays || 0) * DAY,
      close = (task.closeDays || 0) * DAY;
    return (
      <div key={task.id} className="gantt-review-slot" style={{ top: `${placement.level * LANE_ROW}px` }}>
        {(prep > 0 || close > 0) && (
          <i
            className="gantt-prep"
            style={{
              left: `${Math.max(0, percent(at - prep))}%`,
              width: `${Math.max(0, Math.min(100, percent(at + close)) - Math.max(0, percent(at - prep)))}%`,
            }}
            aria-hidden="true"
          />
        )}
        <button
          type="button"
          data-task-id={task.id}
          className={`gantt-review state-${state}${selectedId === task.id ? ' is-selected' : ''}${canMove ? ' is-movable' : ''}${dimmed(task, lane) ? ' is-dimmed' : ''}${needsAttention(task) && !preview ? ' needs-attention' : ''}`}
          style={{ left: `${percent(at)}%` }}
          disabled={Boolean(preview)}
          aria-label={`${task.title}, ${shortDate(at, pt, true)}${docs ? `, ${docs}` : ''}`}
          aria-description={canMove ? moveHint : undefined}
          title={`${task.title}\n${shortDate(at, pt, true)} · ${deliveryStatus(task.status, pt)}${docs ? `\n${docs}` : ''}${task.ownerId ? `\n${member(task.ownerId)}` : ''}`}
          {...dragHandlers(task, date)}
          onClick={() => {
            if (!suppressClick.current) onOpenReview(task.id);
            suppressClick.current = false;
          }}
        >
          <i className="gantt-diamond" aria-hidden="true" />
          <b>{code}</b>
          {entry && entry.planned > 0 && (
            <small className="gantt-docs" aria-hidden="true">
              <i
                style={
                  {
                    '--ready': `${Math.round((entry.prepared / entry.planned) * 100)}%`,
                    '--done': `${Math.round((entry.approved / entry.planned) * 100)}%`,
                  } as CSSProperties
                }
              />
              {entry.prepared}/{entry.planned}
            </small>
          )}
          {dragDate?.id === task.id && <em>{shortDate(at, pt, true)}</em>}
        </button>
      </div>
    );
  };
  const activity = (placement: GanttPlacement, lane: string, offset: number) => {
    const task = placement.task,
      delta = shift(placement),
      from = placement.from + delta,
      to = placement.to + delta,
      canMove = movable(task);
    const late = task.status !== 'done' && (task.overdue || Boolean(task.dueDate && task.dueDate < today));
    const left = Math.max(0, percent(from)),
      right = Math.min(100, percent(to));
    return (
      <button
        type="button"
        key={task.id}
        data-task-id={task.id}
        className={`gantt-bar status-${task.status}${late ? ' is-late' : ''}${placement.labelOutside ? ' label-outside' : ''}${selectedId === task.id ? ' is-selected' : ''}${canMove ? ' is-movable' : ''}${dimmed(task, lane) ? ' is-dimmed' : ''}${needsAttention(task) && !preview ? ' needs-attention' : ''}`}
        style={{
          left: `${left}%`,
          width: `max(8px, ${Math.max(0, right - left)}%)`,
          top: `${offset + placement.level * LANE_ROW}px`,
        }}
        disabled={Boolean(preview)}
        aria-label={`${task.title}, ${task.startDate ? `${shortDate(placement.from + delta, pt)} — ` : ''}${shortDate(to - DAY, pt, true)}`}
        aria-description={canMove ? moveHint : undefined}
        title={`${task.title}\n${task.startDate ? `${shortDate(from, pt)} — ` : ''}${shortDate(to - DAY, pt, true)} · ${deliveryStatus(task.status, pt)}${late ? ` · ${pt ? 'em atraso' : 'overdue'}` : ''}${task.ownerId ? `\n${member(task.ownerId)}` : ''}`}
        {...dragHandlers(task, task.dueDate || task.startDate)}
        onClick={event => {
          if (!suppressClick.current) onSelect(task.id, event.currentTarget);
          suppressClick.current = false;
        }}
      >
        <span>{task.title}</span>
        {dragDate?.id === task.id && <em>{shortDate(to - DAY, pt, true)}</em>}
      </button>
    );
  };

  return (
    <section
      className={`schedule-gantt${preview ? ' is-preview' : ''}`}
      aria-label={pt ? 'Cronograma do projeto' : 'Project schedule'}
    >
      <div className="gantt-body" ref={bodyRef}>
        <div className="gantt-head">
          <div className="gantt-corner">
            {preview ? (
              <strong className="gantt-preview">
                {pt ? 'Prévia · alterações não salvas' : 'Preview · unsaved changes'}
              </strong>
            ) : (
              <>
                <span>
                  <i className="gantt-legend-diamond" />
                  {pt ? 'Revisão' : 'Review'}
                </span>
                <span>
                  <i className="gantt-legend-bar" />
                  {pt ? 'Atividade' : 'Activity'}
                </span>
                <span>
                  <i className="gantt-legend-today" />
                  {pt ? 'Hoje' : 'Today'}
                </span>
              </>
            )}
          </div>
          <div className="gantt-axis" ref={axisRef}>
            <div className="gantt-tier is-top">
              {axis.top.map(item => (
                <span key={item.key} style={{ left: `${item.left}%`, width: `${item.width}%` }}>
                  <b>{item.label}</b>
                </span>
              ))}
            </div>
            <div className={`gantt-tier is-bottom unit-${axis.unit}`}>
              {axis.bottom.map(item => (
                <span key={item.key} style={{ left: `${item.left}%`, width: `${item.width}%` }}>
                  {item.label}
                </span>
              ))}
            </div>
            {todayIn && (
              <span className="gantt-today-flag" style={{ left: `${percent(todayTime)}%` }}>
                {pt ? 'Hoje' : 'Today'}
              </span>
            )}
          </div>
        </div>
        <div className="gantt-canvas" style={{ gridTemplateRows: rows.map(row => `${row}px`).join(' ') }}>
          <div className="gantt-lines" aria-hidden="true">
            {axis.bottom.map(item => (
              <i key={item.key} style={{ left: `${item.left}%` }} />
            ))}
            {axis.top.map(item => (
              <i key={item.key} className="is-major" style={{ left: `${item.left}%` }} />
            ))}
            {todayIn && <i className="is-today" style={{ left: `${percent(todayTime)}%` }} />}
          </div>
          {lanes.map(lane => {
            const phase = lane.phase,
              phaseStart = phase ? utcTime(phase.start) : null,
              phaseEnd = phase ? utcTime(phase.end) : null;
            const current =
              phaseStart !== null && phaseEnd !== null && todayTime >= phaseStart && todayTime <= phaseEnd + DAY;
            const left = phaseStart !== null ? Math.max(0, percent(phaseStart)) : 0,
              right = phaseEnd !== null ? Math.min(100, percent(phaseEnd + DAY)) : 0;
            const elapsed =
              phaseStart !== null && phaseEnd !== null
                ? Math.max(0, Math.min(1, (todayTime - phaseStart) / Math.max(DAY, phaseEnd + DAY - phaseStart)))
                : 0;
            const activityOffset = lane.reviewLevels * LANE_ROW + (lane.reviewLevels && lane.activityLevels ? 4 : 0);
            const content = activityOffset + lane.activityLevels * LANE_ROW;
            const allDimmed = lane.tasks.length > 0 && lane.tasks.every(task => dimmed(task, lane.title));
            const done = lane.tasks.filter(task => task.status === 'done').length;
            return (
              <div
                key={lane.id}
                className={`gantt-lane${current ? ' is-current' : ''}${allDimmed || (search && !lane.tasks.length) ? ' is-dimmed' : ''}`}
              >
                <div className="gantt-lane-label">
                  <b className={`gantt-code${phase ? '' : ' is-none'}`}>{phase ? phase.code : '—'}</b>
                  <span className="gantt-lane-copy">
                    <strong title={phase ? phase.name : undefined}>
                      {phase ? lane.title : pt ? 'Sem fase' : 'No phase'}
                    </strong>
                    <small>
                      {phase && phaseStart !== null && phaseEnd !== null
                        ? `${shortDate(phaseStart, pt)} — ${shortDate(phaseEnd, pt, true)}`
                        : pt
                          ? `${lane.tasks.length} ${lane.tasks.length === 1 ? 'atividade' : 'atividades'}`
                          : `${lane.tasks.length} ${lane.tasks.length === 1 ? 'activity' : 'activities'}`}
                      {current && <em>{pt ? 'fase atual' : 'current'}</em>}
                      {lane.tasks.length > 0 && done === lane.tasks.length && (
                        <em className="is-done">{pt ? 'concluída' : 'done'}</em>
                      )}
                    </small>
                    {(lane.undated.length > 0 || lane.outside > 0) && (
                      <span className="gantt-lane-notes">
                        {lane.undated.length > 0 && (
                          <button
                            type="button"
                            onClick={event => onSelect(lane.undated[0].id, event.currentTarget)}
                            title={lane.undated.map(task => task.title).join('\n')}
                          >
                            {lane.undated.length} {pt ? 'sem data' : 'undated'}
                          </button>
                        )}
                        {lane.outside > 0 && (
                          <small>
                            {lane.outside} {pt ? 'fora do período' : 'outside this period'}
                          </small>
                        )}
                      </span>
                    )}
                  </span>
                  {((phase && onEditPhase) || (onCreate && !preview)) && (
                    <span className="gantt-lane-actions">
                      {phase && onEditPhase && (
                        <button
                          type="button"
                          className="gantt-lane-action"
                          disabled={busy}
                          aria-label={`${pt ? 'Editar fase' : 'Edit phase'} ${phase.code}`}
                          title={pt ? 'Editar fase' : 'Edit phase'}
                          onClick={() => onEditPhase(phase.id)}
                        >
                          <Pencil size={13} aria-hidden="true" />
                        </button>
                      )}
                      {onCreate && !preview && (
                        <button
                          type="button"
                          className="gantt-lane-action"
                          disabled={busy}
                          aria-label={`${pt ? 'Adicionar atividade em' : 'Add activity to'} ${phase ? phase.code : pt ? 'sem fase' : 'no phase'}`}
                          title={pt ? 'Adicionar atividade' : 'Add activity'}
                          onClick={() => onCreate(phase?.id)}
                        >
                          <Plus size={14} aria-hidden="true" />
                        </button>
                      )}
                    </span>
                  )}
                </div>
                <div className="gantt-track">
                  {phase && right > left && (
                    <div
                      className="gantt-phase"
                      style={{ left: `${left}%`, width: `${right - left}%` }}
                      title={`${phase.code} · ${phase.name}: ${shortDate(phaseStart!, pt, true)} — ${shortDate(phaseEnd!, pt, true)}`}
                    >
                      <i style={{ width: `${elapsed * 100}%` }} />
                    </div>
                  )}
                  {content > 0 && (
                    <div className="gantt-items" style={{ height: `${content}px`, marginTop: `${-content / 2}px` }}>
                      {lane.reviews.map(placement => review(placement, lane.title))}
                      {lane.activities.map(placement => activity(placement, lane.title, activityOffset))}
                    </div>
                  )}
                  {!content && !phase && (
                    <span className="gantt-lane-empty">
                      {pt ? 'Defina datas para posicionar as atividades' : 'Set dates to place activities'}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
