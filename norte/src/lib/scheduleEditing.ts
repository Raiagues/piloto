import { shiftDate } from '../../shared/delivery-lifecycle.mjs';
import type { DeliveryTask } from './projectDelivery';

export type ScheduleQuickFields = Pick<DeliveryTask, 'startDate' | 'dueDate' | 'ownerId' | 'status'>;
export type ScheduleQuickField = keyof ScheduleQuickFields;
export type ScheduleQuickDraft = { values: Partial<ScheduleQuickFields>; baseline: Partial<ScheduleQuickFields> };
const QUICK_FIELDS: ScheduleQuickField[] = ['startDate', 'dueDate', 'ownerId', 'status'];

export function patchScheduleDraft(task: DeliveryTask, draft: ScheduleQuickDraft | null, patch: Partial<ScheduleQuickFields>): ScheduleQuickDraft | null {
  const next: ScheduleQuickDraft = { values: { ...draft?.values }, baseline: { ...draft?.baseline } };
  for (const field of QUICK_FIELDS) {
    const value = patch[field];
    if (value === undefined) continue;
    if (value === task[field]) {
      delete next.values[field];
      delete next.baseline[field];
    } else {
      if (!Object.hasOwn(next.values, field)) next.baseline[field] = task[field];
      next.values[field] = value;
    }
  }
  return Object.keys(next.values).length ? next : null;
}

export function resolveScheduleDraft(task: DeliveryTask, draft: ScheduleQuickDraft | null) {
  const conflicts = QUICK_FIELDS.filter(field => draft && Object.hasOwn(draft.values, field)
    && draft.values[field] !== task[field] && draft.baseline[field] !== task[field]);
  const item: DeliveryTask = { ...task, ...draft?.values };
  const dirty = QUICK_FIELDS.some(field => item[field] !== task[field]);
  return { item, dirty, conflicts };
}

export function acceptCurrentScheduleFields(draft: ScheduleQuickDraft | null, fields: readonly ScheduleQuickField[]): ScheduleQuickDraft | null {
  if (!draft) return null;
  const next = { values: { ...draft.values }, baseline: { ...draft.baseline } };
  for (const field of fields) { delete next.values[field]; delete next.baseline[field]; }
  return Object.keys(next.values).length ? next : null;
}

export type ScheduleMove = {
  id: string;
  before: Pick<DeliveryTask, 'startDate' | 'dueDate'>;
  after: Pick<DeliveryTask, 'startDate' | 'dueDate'>;
};
export function describeScheduleMove(task: DeliveryTask, dueDate: string): ScheduleMove {
  const previous = task.dueDate || task.startDate || dueDate;
  const days = Math.round((Date.parse(dueDate) - Date.parse(previous)) / 86_400_000);
  return {
    id: task.id,
    before: { startDate: task.startDate, dueDate: task.dueDate },
    after: { startDate: task.startDate ? shiftDate(task.startDate, days) : dueDate, dueDate },
  };
}

/** Only dates are reversed; unrelated edits made since the move remain intact. */
export function scheduleMoveUndo(task: DeliveryTask | undefined, move: ScheduleMove): DeliveryTask | null {
  if (!task || task.id !== move.id || task.archived || !task.canEdit
    || task.startDate !== move.after.startDate || task.dueDate !== move.after.dueDate) return null;
  return { ...task, ...move.before };
}
