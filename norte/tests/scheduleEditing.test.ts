import { describe, expect, it } from 'vitest';
import type { DeliveryTask } from '../src/lib/projectDelivery';
import { acceptCurrentScheduleFields, describeScheduleMove, patchScheduleDraft, resolveScheduleDraft, scheduleMoveUndo } from '../src/lib/scheduleEditing';

const task = (patch: Partial<DeliveryTask> = {}): DeliveryTask => ({
  id: 'test-activity', title: 'Integrar a placa', description: 'Conferir as interfaces', phase: '', kind: 'task',
  startDate: '2026-10-20', dueDate: '2026-10-25', prepDays: 0, closeDays: 0, status: 'planned',
  sectorId: 'avionics', ownerId: '', dependencyIds: [], requirementIds: ['REQ-1'], testIds: [],
  inputArtifactIds: ['DOC-1'], outputArtifactIds: [], documentOptions: [], archived: false,
  overdue: false, blockedBy: [], dateConflicts: [], canEdit: true, ...patch,
});

describe('schedule quick-edit drafts', () => {
  it('saves a pending owner change without reverting a later move or status update', () => {
    const original = task();
    const draft = patchScheduleDraft(original, null, { ownerId: 'ana' });
    const moved = { ...original, startDate: '2026-10-22', dueDate: '2026-10-27', status: 'blocked' };
    const resolved = resolveScheduleDraft(moved, draft);
    expect(resolved.conflicts).toEqual([]);
    expect(resolved.item).toMatchObject({ ownerId: 'ana', startDate: '2026-10-22', dueDate: '2026-10-27', status: 'blocked', requirementIds: ['REQ-1'], inputArtifactIds: ['DOC-1'] });
    expect(draft?.values).toEqual({ ownerId: 'ana' });
    expect(original.ownerId).toBe('');
  });

  it('detects a conflicting edit to the same field while keeping the local proposal available', () => {
    const original = task();
    const draft = patchScheduleDraft(original, null, { dueDate: '2026-10-30' });
    const current = { ...original, dueDate: '2026-11-05' };
    const resolved = resolveScheduleDraft(current, draft);
    expect(resolved.conflicts).toEqual(['dueDate']);
    expect(resolved.dirty).toBe(true);
    expect(resolved.item.dueDate).toBe('2026-10-30');
    expect(draft?.baseline.dueDate).toBe('2026-10-25');
  });

  it('accepts current conflicting values without discarding other pending edits', () => {
    const original = task();
    const draft = patchScheduleDraft(original, null, { dueDate: '2026-10-30', ownerId: 'ana' });
    const current = { ...original, dueDate: '2026-11-05' };
    const resolved = resolveScheduleDraft(current, draft);
    const reconciled = acceptCurrentScheduleFields(draft, resolved.conflicts);
    expect(resolveScheduleDraft(current, reconciled)).toMatchObject({ conflicts: [], dirty: true, item: { dueDate: '2026-11-05', ownerId: 'ana' } });
    expect(draft?.values.dueDate).toBe('2026-10-30');
  });

  it('does not flag an independently saved matching value and removes explicitly reverted changes', () => {
    const original = task();
    const draft = patchScheduleDraft(original, null, { ownerId: 'ana' });
    expect(resolveScheduleDraft({ ...original, ownerId: 'ana' }, draft)).toMatchObject({ conflicts: [], dirty: false });
    expect(patchScheduleDraft(original, draft, { ownerId: '' })).toBeNull();
  });

  it('can reopen a retained draft or pass it into the full editor without changing its original baseline', () => {
    const original = task();
    const draft = patchScheduleDraft(original, null, { dueDate: '2026-10-30' });
    const stored = structuredClone(draft);
    const reopened = resolveScheduleDraft({ ...original, title: 'Integrar placa revisada', ownerId: 'joao' }, stored);
    expect(reopened.item).toMatchObject({ title: 'Integrar placa revisada', ownerId: 'joao', dueDate: '2026-10-30' });
    expect(reopened.conflicts).toEqual([]);
    expect(stored).toEqual(draft);
  });
});

describe('exact schedule move undo', () => {
  it('restores an originally empty start date without losing later title or owner changes', () => {
    const original = task({ startDate: '' });
    const move = describeScheduleMove(original, '2026-10-28');
    expect(move.after).toEqual({ startDate: '2026-10-28', dueDate: '2026-10-28' });
    const current = { ...original, ...move.after, title: 'Título revisado', ownerId: 'ana' };
    const restored = scheduleMoveUndo(current, move);
    expect(restored).toMatchObject({ startDate: '', dueDate: '2026-10-25', title: 'Título revisado', ownerId: 'ana', requirementIds: ['REQ-1'], inputArtifactIds: ['DOC-1'] });
    expect(current.startDate).toBe('2026-10-28');
  });

  it('restores an originally empty due date and preserves the activity duration for dated moves', () => {
    const original = task({ dueDate: '' });
    const move = describeScheduleMove(original, '2026-10-23');
    expect(scheduleMoveUndo({ ...original, ...move.after }, move)).toMatchObject({ startDate: '2026-10-20', dueDate: '' });
    const dated = task();
    const datedMove = describeScheduleMove(dated, '2026-10-29');
    expect(datedMove.after).toEqual({ startDate: '2026-10-24', dueDate: '2026-10-29' });
    expect(scheduleMoveUndo({ ...dated, ...datedMove.after }, datedMove)).toEqual(dated);
  });

  it('refuses undo after either date changes, when archived or when editing is no longer allowed', () => {
    const original = task(), move = describeScheduleMove(original, '2026-10-28');
    const current = { ...original, ...move.after };
    expect(scheduleMoveUndo({ ...current, startDate: '2026-10-19' }, move)).toBeNull();
    expect(scheduleMoveUndo({ ...current, dueDate: '2026-10-29' }, move)).toBeNull();
    expect(scheduleMoveUndo({ ...current, archived: true }, move)).toBeNull();
    expect(scheduleMoveUndo({ ...current, canEdit: false }, move)).toBeNull();
    expect(scheduleMoveUndo({ ...current, id: 'another-activity' }, move)).toBeNull();
  });
});
