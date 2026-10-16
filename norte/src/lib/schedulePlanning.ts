import { LIFE_PHASES, lifecycleMilestones, lifecycleRanges } from '../../shared/delivery-lifecycle.mjs';
import type { LifecycleRange } from '../../shared/delivery-lifecycle.mjs';
import type { DeliveryLifecycle, DeliveryState, DeliveryTask } from './projectDelivery';

export type ScheduleTask = DeliveryTask & { manual?: boolean; excluded?: boolean; previewOnly?: boolean };
export type ScheduleGroup<T extends ScheduleTask = ScheduleTask> = {
  id: string;
  phase: LifecycleRange | null;
  title: string;
  tasks: T[];
};

const normalizeName = (value: string) => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR');

/** Explicit phase assignments win. Dates never determine ownership of an activity. */
export function buildScheduleGroups<T extends ScheduleTask>(
  tasks: readonly T[],
  ranges: readonly LifecycleRange[],
): ScheduleGroup<T>[] {
  const groups: ScheduleGroup<T>[] = ranges.map(phase => ({ id: `phase:${phase.id}`, phase, title: phase.name, tasks: [] }));
  const unassigned: ScheduleGroup<T> = { id: 'unassigned', phase: null, title: 'Sem fase', tasks: [] };
  for (const task of tasks) {
    if (task.archived) continue;
    let group: ScheduleGroup<T> | undefined;
    if (task.phaseId !== undefined) {
      // An empty or stale explicit ID must not silently reassign a removed phase.
      group = groups.find(candidate => candidate.phase?.id === task.phaseId);
    } else if (normalizeName(task.phase || '')) {
      const matches = groups.filter(candidate => normalizeName(candidate.title) === normalizeName(task.phase));
      if (matches.length === 1) group = matches[0];
    } else if (task.lifecycleProfile && Number.isInteger(task.phaseIndex) && task.phaseIndex! >= 0) {
      const code = LIFE_PHASES[task.lifecycleProfile]?.[task.phaseIndex!]?.[0];
      // Index alone is ambiguous across standards and reordered custom phases.
      if (code) group = groups.find(candidate => candidate.phase?.id === `${task.lifecycleProfile}-${code}`);
    }
    (group || unassigned).tasks.push(task);
  }
  return unassigned.tasks.length ? [...groups, unassigned] : groups;
}

type PreviewSource = Pick<DeliveryState, 'tasks' | 'lifecycleRanges'> & { lifecycleTasks?: ScheduleTask[] };

/** Mirrors lifecycle.configure without mutating the loaded records or their linked evidence. */
export function previewScheduleTasks(data: PreviewSource, preview: DeliveryLifecycle): ScheduleTask[] {
  const ranges = lifecycleRanges(preview);
  const definitions = lifecycleMilestones(preview);
  const definitionByCode = new Map(definitions.map(definition => [definition.id, definition]));
  const selected = new Set(preview.selectedReviews);
  const known = data.lifecycleTasks || data.tasks;
  const profileTasks = known.filter(task => task.lifecycleProfile === preview.profile);
  const source: ScheduleTask[] = [...data.tasks.filter(task => !task.lifecycleProfile), ...profileTasks];
  const result: ScheduleTask[] = [];

  for (const original of source) {
    if (original.archived) continue;
    const task: ScheduleTask = { ...original, canEdit: false };
    if (task.lifecycleProfile && !Object.hasOwn(task, 'phaseId')) {
      task.phaseId = data.lifecycleRanges[task.phaseIndex ?? -1]?.id || '';
    }
    const assignedPhase = ranges.find(phase => phase.id === task.phaseId);
    if (task.phaseId && !assignedPhase) {
      task.phaseId = '';
      task.phase = '';
      task.manual = true;
    } else if (assignedPhase) {
      task.phase = assignedPhase.name;
    }

    const definition = task.lifecycleProfile && task.reviewCode ? definitionByCode.get(task.reviewCode) : undefined;
    if (definition) {
      if (!selected.has(definition.id)) continue;
      task.excluded = false;
      task.phaseId = definition.phaseId;
      task.phase = definition.phaseName;
      if (!task.manual) task.startDate = task.dueDate = definition.date;
    } else if (task.excluded) {
      continue;
    }
    result.push(task);
  }

  for (const definition of definitions) {
    if (!selected.has(definition.id) || profileTasks.some(task => task.reviewCode === definition.id)) continue;
    result.push({
      id: `preview-${preview.profile}-${definition.id}`,
      reviewCode: definition.id,
      lifecycleProfile: preview.profile,
      phaseId: definition.phaseId,
      phaseIndex: definition.phase,
      phase: definition.phaseName,
      lane: definition.lane,
      title: `${definition.id} · ${definition.title}`,
      description: definition.focus,
      kind: 'review',
      startDate: definition.date,
      dueDate: definition.date,
      prepDays: 10,
      closeDays: 7,
      status: 'planned',
      sectorId: '',
      ownerId: '',
      dependencyIds: [],
      requirementIds: [],
      testIds: [],
      inputArtifactIds: [],
      outputArtifactIds: [],
      documentOptions: [],
      archived: false,
      overdue: false,
      blockedBy: [],
      dateConflicts: [],
      canEdit: false,
      manual: false,
      previewOnly: true,
    });
  }
  return result;
}

const DAY = 86_400_000;
function calendarTime(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const time = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? time : null;
}

/** UTC boundaries with breathing room at both ends; pass today's date for an empty schedule. */
export function timelineWindow(
  tasks: readonly ScheduleTask[],
  ranges: readonly LifecycleRange[],
  anchorDate = '1970-01-01',
): { start: number; end: number; span: number } {
  const dates = [
    ...tasks.filter(task => !task.archived).flatMap(task => [task.startDate, task.dueDate]),
    ...ranges.flatMap(phase => [phase.start, phase.end]),
  ].map(calendarTime).filter((value): value is number => value !== null);
  const first = dates.length ? Math.min(...dates) : calendarTime(anchorDate) ?? 0;
  const last = dates.length ? Math.max(...dates) : first;
  const minimumExtra = Math.max(0, 7 * DAY - (last - first));
  const padding = Math.max(DAY, Math.ceil((last - first) * 0.04 / DAY) * DAY);
  const start = first - Math.ceil(minimumExtra / DAY / 2) * DAY - padding;
  const end = last + Math.floor(minimumExtra / DAY / 2) * DAY + padding;
  return { start, end, span: end - start };
}
