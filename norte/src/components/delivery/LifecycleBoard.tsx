import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ArrowRight, CalendarDays, ChevronDown, ChevronLeft, ChevronRight, ChevronsDownUp, ChevronsUpDown, CircleHelp, Diamond, ListChecks, Pencil, Search, X } from 'lucide-react';
import { lifecycleRanges, shiftDate } from '../../../shared/delivery-lifecycle.mjs';
import type { DeliveryLifecycle, DeliveryState, DeliveryTask } from '../../lib/projectDelivery';
import { deliveryStatus } from '../../lib/projectDelivery';
import { buildScheduleGroups, previewScheduleTasks, timelineWindow } from '../../lib/schedulePlanning';
import '../../styles/delivery-planning.css';
import '../../styles/schedule-canvas.css';
export { LifecycleSettings } from './LifecycleSettings';

const DAY = 86400000;
type Drag = { id: string; startX: number; width: number; date: string; days: number; moved: boolean };
type Props = {
  data: DeliveryState; pt: boolean; onSelect: (id: string) => void; selectedId?: string;
  onConfigure?: () => void; onEditPhase?: (id: string) => void; onCreate?: (phaseId?: string) => void;
  onMove?: (id: string, date: string) => Promise<unknown>; busy?: boolean; preview?: DeliveryLifecycle | null;
};
const iso = (date: number) => new Date(date).toISOString().slice(0, 10);
const attention = (task: DeliveryTask) => task.status !== 'done' && (task.overdue || task.status === 'blocked' || task.blockedBy.length > 0 || task.dateConflicts.length > 0);

export function LifecycleBoard({ data, pt, onSelect, selectedId, onConfigure, onEditPhase, onCreate, onMove, busy = false, preview }: Props) {
  const board = useRef<HTMLElement>(null), drag = useRef<Drag | null>(null), suppressClick = useRef(false);
  const [trackWidth, setTrackWidth] = useState(700), [availableHeight, setAvailableHeight] = useState(700), [dragDate, setDragDate] = useState<{ id: string; date: string } | null>(null);
  const [expanded, setExpanded] = useState<string[]>([]), [query, setQuery] = useState(''), [onlyAttention, setOnlyAttention] = useState(false);
  const [scale, setScale] = useState('all'), [cursor, setCursor] = useState<number | null>(null), [help, setHelp] = useState(false);
  const today = new Date().toISOString().slice(0, 10), todayTime = Date.parse(today);
  const lifecycle = preview || data.lifecycle;
  const ranges = useMemo(() => lifecycle ? lifecycleRanges(lifecycle) : [], [lifecycle]);
  const tasks = useMemo(() => preview ? previewScheduleTasks(data, preview) : data.tasks.filter(task => !task.archived), [data, preview]);
  const groups = useMemo(() => buildScheduleGroups(tasks, ranges), [tasks, ranges]);
  function parentDepth(task:DeliveryTask){let depth=0,parent=task.parentId;const visited=new Set([task.id]);while(parent&&!visited.has(parent)){visited.add(parent);depth++;parent=tasks.find(item=>item.id===parent)?.parentId;}return Math.min(5,depth);}
  function hierarchy(items:DeliveryTask[]){const ids=new Set(items.map(item=>item.id)),result:DeliveryTask[]=[],seen=new Set<string>();const add=(task:DeliveryTask)=>{if(seen.has(task.id))return;seen.add(task.id);result.push(task);items.filter(item=>item.parentId===task.id).forEach(add);};items.filter(item=>!item.parentId||!ids.has(item.parentId)).forEach(add);items.forEach(add);return result;}
  const fullWindow = timelineWindow(tasks, ranges, today);
  const zoomSpan = (scale === 'quarter' ? 90 : 365) * DAY;
  const start = scale === 'all' ? fullWindow.start : cursor ?? (todayTime >= fullWindow.start && todayTime <= fullWindow.end ? todayTime - 14 * DAY : fullWindow.start);
  const span = scale === 'all' ? fullWindow.span : zoomSpan, end = start + span;
  const ticks = Math.max(2, Math.min(7, Math.floor(trackWidth / 125) + 1));
  const position = (date: string) => (Date.parse(date) - start) / span * 100;
  const dateLabel = (date: string, year = false) => date ? new Date(`${date}T12:00:00`).toLocaleDateString(pt ? 'pt-BR' : 'en', { day: '2-digit', month: 'short', ...(year ? { year: 'numeric' } : {}) }) : pt ? 'Sem data' : 'Undated';
  const period = new Intl.DateTimeFormat(pt ? 'pt-BR' : 'en', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  const nextReview = [...tasks].filter(task => task.kind === 'review' && task.status !== 'done' && task.dueDate).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const next = nextReview.find(task => task.dueDate >= today) || nextReview[0];
  const needsAttention = (task: DeliveryTask) => !preview && attention(task);
  const attentionCount = tasks.filter(needsAttention).length;
  const search = query.toLocaleLowerCase().trim();
  const shown = groups.map(group => ({ ...group, tasks: group.tasks.filter(task => (!onlyAttention || Boolean(preview) || needsAttention(task)) && (!search || `${group.title} ${group.phase?.code || ''} ${task.title} ${data.members.find(member => member.id === task.ownerId)?.name || ''}`.toLocaleLowerCase().includes(search))) }))
    .filter(group => group.tasks.length || ((!onlyAttention || preview) && !search && group.phase));
  const allExpanded = shown.every(group => expanded.includes(group.id));
  const toggle = (id: string) => setExpanded(value => value.includes(id) ? value.filter(item => item !== id) : [...value, id]);

  useEffect(() => {
    const element = board.current;
    if (!element) return;
    const measure = () => { setTrackWidth(element.querySelector('.schedule-track')?.getBoundingClientRect().width || 700); setAvailableHeight(Math.max(300, window.innerHeight - element.getBoundingClientRect().top - 70)); };
    measure(); const observer = new ResizeObserver(measure); observer.observe(element); window.addEventListener('resize', measure);
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); };
  }, [groups.length]);

  const grid = () => <><div className="schedule-grid-lines" aria-hidden="true">{Array.from({ length: ticks }, (_, index) => <i key={index} style={{ left: `${index / (ticks - 1) * 100}%` }} />)}</div>{todayTime >= start && todayTime <= end && <i className="schedule-today-line" style={{ left: `${position(today)}%` }} aria-hidden="true" />}</>;
  const marker = (task: DeliveryTask, level = 0, summary = false) => {
    const date = dragDate?.id === task.id ? dragDate.date : task.dueDate || task.startDate;
    if (!date) return null;
    const point = position(date), outside = point < 0 || point > 100;
    const isReview = task.kind === 'review';
    const movingStart = task.startDate && dragDate?.id === task.id ? shiftDate(task.startDate, Math.round((Date.parse(date) - Date.parse(task.dueDate || task.startDate)) / DAY)) : task.startDate;
    const crossesWindow = !isReview && movingStart && Date.parse(movingStart) <= end && Date.parse(date) >= start;
    if (outside && !crossesWindow && dragDate?.id !== task.id) return null;
    const canMove = task.canEdit && !busy && !preview && Boolean(onMove);
    const left = !isReview && movingStart ? Math.max(0, position(movingStart)) : Math.max(0, Math.min(100, point));
    const width = !isReview && movingStart ? Math.max(0, Math.min(100, point) - left) : 0;
    const owner = data.members.find(member => member.id === task.ownerId)?.name;
    const shortCode = task.reviewCode || task.title.split(/[·:]/)[0].trim();
    return <button key={task.id} type="button" className={`schedule-marker planning-marker ${isReview ? 'review' : 'activity'} ${task.status}${selectedId === task.id ? ' is-selected' : ''}${needsAttention(task) ? ' needs-attention' : ''}${summary ? ' in-summary' : ''}${canMove ? ' is-movable' : ''}`}
      style={{ left: `${left}%`, top: `${summary ? 24 + level * 28 : 11}px`, ...(!isReview ? { width: `max(28px, ${width}%)` } : {}) }}
      aria-label={task.title} aria-description={canMove ? (pt ? 'Clique para editar. Arraste para mover a data; setas movem um dia, Shift move sete.' : 'Click to edit. Drag to move the date; arrows move one day, Shift moves seven.') : undefined}
      title={`${task.title}\n${dateLabel(date, true)} · ${deliveryStatus(task.status, pt)}${owner ? `\n${owner}` : ''}`}
      disabled={Boolean(preview)}
      onPointerDown={event => {
        suppressClick.current = false;
        if (!canMove || event.button !== 0) return;
        const width = event.currentTarget.parentElement!.getBoundingClientRect().width;
        drag.current = { id: task.id, startX: event.clientX, width, date, days: 0, moved: false };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={event => {
        const state = drag.current; if (!state || state.id !== task.id) return;
        const distance = event.clientX - state.startX;
        state.moved ||= Math.abs(distance) > 5; if (!state.moved) return;
        state.days = Math.round(distance / state.width * span / DAY);
        setDragDate({ id: task.id, date: shiftDate(state.date, state.days) });
      }}
      onPointerUp={() => {
        const state = drag.current; drag.current = null; setDragDate(null);
        if (state?.moved) { suppressClick.current = true; if (state.days) void onMove?.(task.id, shiftDate(state.date, state.days)); }
      }}
      onPointerCancel={() => { drag.current = null; setDragDate(null); suppressClick.current = true; }}
      onKeyDown={event => {
        if (event.key === 'Escape' && drag.current) { drag.current = null; setDragDate(null); suppressClick.current = true; }
        if (canMove && ['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); void onMove?.(task.id, shiftDate(date, (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 7 : 1))); }
      }}
      onClick={() => { if (!suppressClick.current) onSelect(task.id); suppressClick.current = false; }}>
      {isReview && <Diamond size={11} fill="currentColor" aria-hidden="true" />}<span>{isReview ? shortCode : ''}</span>
      {dragDate?.id === task.id && <em>{dateLabel(dragDate.date, true)}</em>}
    </button>;
  };

  if (!tasks.length && !ranges.length) return <div className="schedule-empty-start"><CalendarDays size={30}/><h2>{pt ? 'Dê uma sequência ao projeto' : 'Give your project a sequence'}</h2><p>{pt ? 'Comece com as fases e revisões de um modelo, ou planeje uma atividade.' : 'Start with the phases and reviews of a template, or plan an activity.'}</p><div>{onConfigure && <button className="primary" onClick={onConfigure}>{pt ? 'Escolher fases do projeto' : 'Choose project phases'}</button>}{onCreate && <button onClick={() => onCreate()}>{pt ? 'Adicionar uma atividade' : 'Add an activity'}</button>}</div></div>;

  return <section ref={board} className="schedule-board" style={{ maxHeight: `${availableHeight}px` }} aria-label={pt ? 'Cronograma do projeto' : 'Project schedule'}>
    <header className="schedule-board-heading"><div><span className="schedule-eyebrow">{pt ? 'Ciclo de vida' : 'Lifecycle'}{lifecycle && !['none', 'custom'].includes(lifecycle.profile) ? ` · ${lifecycle.profile.toUpperCase()}` : ''}</span><h2>{period.format(fullWindow.start)} <span>—</span> {period.format(fullWindow.end)}</h2></div>
      {preview ? <span className="schedule-preview-label">{pt ? 'Prévia · alterações não salvas' : 'Preview · unsaved changes'}</span> : next && <button className="schedule-next-review" onClick={() => onSelect(next.id)}><span><small>{next.dueDate < today ? (pt ? 'Revisão pendente' : 'Pending review') : (pt ? 'Próxima revisão' : 'Next review')} <b>{dateLabel(next.dueDate)}</b></small><strong>{next.title}</strong></span><ArrowRight size={17}/></button>}
    </header>
    <div className="schedule-board-tools"><label className="schedule-search"><Search size={15}/><input type="search" aria-label={pt ? 'Buscar no cronograma' : 'Search schedule'} placeholder={pt ? 'Buscar atividade ou revisão' : 'Find activity or review'} value={query} onChange={event => setQuery(event.target.value)}/></label>
      {attentionCount > 0 && <button className={`schedule-attention-toggle${onlyAttention ? ' active' : ''}`} aria-pressed={onlyAttention} onClick={() => setOnlyAttention(value => !value)}><AlertCircle size={14}/>{attentionCount}<span>{pt ? 'pendências' : 'need attention'}</span></button>}
      <div className="schedule-scale-controls">{scale !== 'all' && <button aria-label={pt ? 'Período anterior' : 'Previous period'} onClick={() => setCursor(start - span)}><ChevronLeft size={15}/></button>}<select aria-label={pt ? 'Escala do cronograma' : 'Schedule scale'} value={scale} onChange={event => { setScale(event.target.value); setCursor(null); }}><option value="all">{pt ? 'Projeto inteiro' : 'Whole project'}</option><option value="year">{pt ? '12 meses' : '12 months'}</option><option value="quarter">{pt ? '3 meses' : '3 months'}</option></select>{scale !== 'all' && <button aria-label={pt ? 'Próximo período' : 'Next period'} onClick={() => setCursor(start + span)}><ChevronRight size={15}/></button>}<button onClick={() => { setScale('quarter'); setCursor(todayTime - 14 * DAY); }}>{pt ? 'Hoje' : 'Today'}</button></div>
    </div>
    <div className="schedule-gantt-scroll">
      <div className="schedule-axis"><div className="schedule-axis-label"><span>{pt ? 'Fases e entregas' : 'Phases and deliverables'}</span><button onClick={() => setExpanded(allExpanded ? [] : shown.map(group => group.id))} aria-label={allExpanded ? (pt ? 'Recolher fases' : 'Collapse phases') : (pt ? 'Expandir fases' : 'Expand phases')}>{allExpanded ? <ChevronsDownUp size={15}/> : <ChevronsUpDown size={15}/>}</button></div><div className="schedule-track"><div className="schedule-axis-ticks">{Array.from({ length: ticks }, (_, index) => { const time = start + span * index / (ticks - 1); return <span key={index} style={{ left: `${index / (ticks - 1) * 100}%` }}>{span > 200 * DAY ? period.format(time) : dateLabel(iso(time))}</span>; })}</div>{todayTime >= start && todayTime <= end && <span className="schedule-today-label" style={{ left: `${position(today)}%` }}>{pt ? 'Hoje' : 'Today'}</span>}</div></div>
      {shown.map(group => {
        const open = Boolean(query) || onlyAttention || expanded.includes(group.id), phase = group.phase;
        const dated = group.tasks.filter(task => task.dueDate || task.startDate).sort((a, b) => (a.dueDate || a.startDate).localeCompare(b.dueDate || b.startDate));
        const levels: number[] = [];
        const markers = dated.map(task => {
          const x = position(task.dueDate || task.startDate) / 100 * trackWidth;
          const code = task.reviewCode || task.title.split(/[·:]/)[0].trim();
          const width = task.kind === 'review' ? Math.max(40, Math.min(94, code.length * 6 + 24)) : Math.max(28, (Date.parse(task.dueDate || task.startDate) - Date.parse(task.startDate || task.dueDate)) / span * trackWidth);
          const left = task.kind === 'review' ? x - width / 2 : x - width;
          let level = levels.findIndex(right => left - right > 5);
          if (level < 0) level = levels.length;
          levels[level] = task.kind === 'review' ? x + width / 2 : x;
          return { task, level };
        });
        const completed = group.tasks.filter(task => task.status === 'done').length;
        const undated = group.tasks.filter(task => !task.dueDate && !task.startDate).length;
        const phaseLeft = phase ? Math.max(0, position(phase.start)) : 0, phaseRight = phase ? Math.min(100, position(phase.end)) : 0;
        return <Fragment key={group.id}><div className={`schedule-phase-row${open ? ' is-open' : ''}${phase && phase.start <= today && phase.end >= today ? ' is-current' : ''}`} style={{ minHeight: `${open ? 56 : Math.max(52, levels.length * 28 + 22)}px` }}>
          <div className="schedule-phase-label"><button className="schedule-phase-toggle" aria-expanded={open} onClick={() => toggle(group.id)}><span className="schedule-chevron">{open ? <ChevronDown size={15}/> : <ChevronRight size={15}/>}</span><span className="schedule-phase-copy"><strong>{phase && <b>{phase.code}</b>}{phase ? group.title : pt ? 'Sem fase' : 'Unassigned'}</strong><small>{group.tasks.length ? `${group.tasks.length} ${pt ? group.tasks.length === 1 ? 'entrega' : 'entregas' : group.tasks.length === 1 ? 'item' : 'items'}${completed ? ` · ${completed} ${pt ? 'concluídas' : 'done'}` : ''}${undated ? ` · ${undated} ${pt ? 'sem data' : 'undated'}` : ''}` : pt ? 'Nenhuma atividade' : 'No activities'}</small></span></button>{phase && onEditPhase && <button className="schedule-phase-edit" disabled={busy} aria-label={`${pt ? 'Editar fase' : 'Edit phase'} ${phase.code}`} onClick={() => onEditPhase(phase.id)}><Pencil size={13}/></button>}</div>
          <div className="schedule-track">{grid()}{phase && phaseRight >= phaseLeft && <button className="schedule-phase-band" style={{ left: `${phaseLeft}%`, width: `${Math.max(.4, phaseRight - phaseLeft)}%` }} disabled={!onEditPhase || busy} onClick={() => onEditPhase?.(phase.id)} aria-label={`${pt ? 'Datas da fase' : 'Phase dates'} ${phase.code}: ${dateLabel(phase.start, true)} — ${dateLabel(phase.end, true)}`} title={`${phase.name}: ${dateLabel(phase.start, true)} — ${dateLabel(phase.end, true)}`}><span>{phase.code}</span></button>}{!open && markers.map(({ task, level }) => marker(task, level, true))}{open && phase && <span className="schedule-phase-period">{dateLabel(phase.start)} — {dateLabel(phase.end, true)}</span>}{!phase && !dated.length && <span className="schedule-no-date">{pt ? 'Defina as datas para posicionar as entregas' : 'Set dates to place deliverables'}</span>}</div>
        </div>
        {open && hierarchy(group.tasks).map(task => { const owner = data.members.find(member => member.id === task.ownerId), due = task.dueDate || task.startDate, outside = due && (position(due) < 0 || position(due) > 100) && !(task.kind !== 'review' && task.startDate && Date.parse(task.startDate) <= end && Date.parse(due) >= start); return <div className={`schedule-task-row${selectedId === task.id ? ' is-selected' : ''}`} key={task.id}><button className="schedule-task-label" style={{paddingLeft:24+parentDepth(task)*16}} disabled={Boolean(preview)} onClick={() => onSelect(task.id)}><span className={`schedule-status-dot ${task.status}${needsAttention(task) ? ' attention' : ''}`} title={deliveryStatus(task.status, pt)}/><span><strong>{task.parentId && <span aria-label={pt?'Subatividade':'Subactivity'}>↳ </span>}{task.title}</strong><small>{owner?.name || (pt ? 'Sem responsável' : 'Unassigned')} <span>· {dateLabel(due)}</span>{needsAttention(task) && <b>{task.overdue ? (pt ? 'Em atraso' : 'Overdue') : (pt ? 'Requer atenção' : 'Needs attention')}</b>}</small></span></button><div className="schedule-track">{grid()}{marker(task)}{!due && <button className="schedule-set-date" disabled={Boolean(preview)} onClick={() => onSelect(task.id)}><CalendarDays size={13}/>{pt ? 'Definir data' : 'Set date'}</button>}{outside && <button className="schedule-outside" disabled={Boolean(preview)} onClick={() => { setScale('quarter'); setCursor(Date.parse(due) - 30 * DAY); }}>{dateLabel(due)} <ArrowRight size={12}/></button>}</div></div>; })}
        {open && onCreate && !preview && <div className="schedule-add-row"><button onClick={() => onCreate(phase?.id)}><span>+</span>{pt ? 'Adicionar atividade' : 'Add activity'}</button></div>}
        </Fragment>;
      })}
      {!shown.length && <div className="schedule-no-results"><Search size={20}/><p>{pt ? 'Nenhuma atividade encontrada.' : 'No matching activities.'}</p><button onClick={() => { setQuery(''); setOnlyAttention(false); }}>{pt ? 'Limpar filtros' : 'Clear filters'}</button></div>}
    </div>
    <footer className="schedule-board-footer"><div className="schedule-legend"><span><Diamond size={11}/>{pt ? 'Revisão' : 'Review'}</span><span><i className="schedule-legend-bar"/>{pt ? 'Atividade' : 'Activity'}</span><span><i className="schedule-status-dot done"/>{pt ? 'Concluído' : 'Done'}</span></div><button aria-expanded={help} onClick={() => setHelp(value => !value)}><CircleHelp size={15}/>{pt ? 'Como editar' : 'How to edit'}</button>{help && <div className="schedule-help"><button aria-label={pt ? 'Fechar ajuda' : 'Close help'} onClick={() => setHelp(false)}><X size={15}/></button><strong>{pt ? 'Planeje direto no cronograma' : 'Plan on the schedule'}</strong><p><ListChecks size={15}/>{pt ? 'Expanda uma fase para ver as atividades.' : 'Expand a phase to see its activities.'}</p><p><Pencil size={15}/>{pt ? 'Clique em uma entrega para editar datas e responsável.' : 'Click an item to edit its dates and owner.'}</p><p><CalendarDays size={15}/>{pt ? 'Arraste um marco para mover a data. As setas do teclado também funcionam.' : 'Drag a milestone to move its date. Keyboard arrows work too.'}</p></div>}</footer>
  </section>;
}
