import { describe, expect, it } from 'vitest';
import { LIFE_DURATIONS, lifecycleRanges } from '../shared/delivery-lifecycle.mjs';
import type { LifecycleRange } from '../shared/delivery-lifecycle.mjs';
import type { DeliveryLifecycle } from '../src/lib/projectDelivery';
import { buildScheduleGroups, previewScheduleTasks, timelineWindow } from '../src/lib/schedulePlanning';
import type { ScheduleTask } from '../src/lib/schedulePlanning';

const task = (id: string, patch: Partial<ScheduleTask> = {}): ScheduleTask => ({
  id, title: id, description: '', phase: '', kind: 'task', startDate: '', dueDate: '',
  prepDays: 0, closeDays: 0, status: 'planned', sectorId: '', ownerId: '',
  dependencyIds: [], requirementIds: [], testIds: [], inputArtifactIds: [], outputArtifactIds: [],
  documentOptions: [], archived: false, overdue: false, blockedBy: [], dateConflicts: [], canEdit: true,
  ...patch,
});
const phase = (id: string, name: string, index = 0): LifecycleRange => ({
  id, name, index, code: id, start: '2026-01-01', end: '2026-02-01',
});
const nasa = (patch: Partial<DeliveryLifecycle> = {}): DeliveryLifecycle => ({
  profile: 'nasa', startDate: '2026-01-01', durations: LIFE_DURATIONS.nasa,
  selectedReviews: ['MCR', 'SRR'], ...patch,
});
const time = (date: string) => Date.parse(`${date}T00:00:00Z`);
const DAY = 86_400_000;

describe('schedule phase ownership', () => {
  it('keeps explicit assignments, preserves every active task once and puts unassigned work last', () => {
    const ranges = [phase('first', 'Concepção'), phase('second', 'Verificação', 1)];
    const tasks = [task('b', { phaseId: 'second' }), task('a', { phaseId: 'first' }), task('undated'), task('old', { archived: true })];
    const groups = buildScheduleGroups(tasks, ranges);
    expect(groups.map(group => group.id)).toEqual(['phase:first', 'phase:second', 'unassigned']);
    expect(groups.map(group => group.tasks.map(item => item.id))).toEqual([['a'], ['b'], ['undated']]);
    expect(groups.flatMap(group => group.tasks)).toHaveLength(3);
    expect(groups[1].tasks[0]).toBe(tasks[0]);
  });

  it('does not silently reassign removed phases or infer ownership from matching dates', () => {
    const ranges = [phase('current', 'Concepção')];
    const tasks = [
      task('removed', { phaseId: 'old', phase: 'Concepção' }),
      task('cleared', { phaseId: '', phase: 'Concepção' }),
      task('date-only', { startDate: '2026-01-15', dueDate: '2026-01-30' }),
    ];
    const groups = buildScheduleGroups(tasks, ranges);
    expect(groups[0].tasks).toEqual([]);
    expect(groups.at(-1)?.tasks.map(item => item.id)).toEqual(['removed', 'cleared', 'date-only']);
  });

  it('recovers an unambiguous legacy phase name without matching partial or ambiguous names', () => {
    const ranges = [phase('one', '  Verificação  do sistema '), phase('two', 'Entrega'), phase('three', 'Entrega')];
    const tasks = [task('legacy', { phase: 'VERIFICAÇÃO DO SISTEMA' }), task('partial', { phase: 'Verificação' }), task('ambiguous', { phase: 'Entrega' })];
    const groups = buildScheduleGroups(tasks, ranges);
    expect(groups[0].tasks.map(item => item.id)).toEqual(['legacy']);
    expect(groups.at(-1)?.tasks.map(item => item.id)).toEqual(['partial', 'ambiguous']);
  });

  it('uses legacy phase indexes only when the original profile identity can be established', () => {
    const ranges = [phase('ecss-A', 'Viabilidade'), phase('nasa-A', 'Conceito e tecnologia', 1)];
    const groups = buildScheduleGroups([
      task('nasa', { lifecycleProfile: 'nasa', phaseIndex: 1 }),
      task('unknown-profile', { phaseIndex: 1 }),
      task('different-standard', { lifecycleProfile: 'custom', phaseIndex: 1 }),
    ], ranges);
    expect(groups[1].tasks.map(item => item.id)).toEqual(['nasa']);
    expect(groups.at(-1)?.tasks.map(item => item.id)).toEqual(['unknown-profile', 'different-standard']);
  });
});

describe('lifecycle draft preview', () => {
  it('removes deselected milestones and keeps manual dates, titles, status and linked evidence', () => {
    const lifecycle = nasa();
    const source = {
      lifecycleRanges: lifecycleRanges(lifecycle),
      tasks: [
        task('concept', { kind: 'review', lifecycleProfile: 'nasa', reviewCode: 'MCR', phaseId: 'nasa-Pré-A', manual: true, title: 'Revisão com a equipe', startDate: '2026-02-10', dueDate: '2026-02-12', status: 'blocked', ownerId: 'ana', requirementIds: ['REQ-1'], inputArtifactIds: ['DOC-1'] }),
        task('requirements', { kind: 'review', lifecycleProfile: 'nasa', reviewCode: 'SRR', phaseId: 'nasa-A' }),
      ],
    };
    const before = structuredClone(source);
    const result = previewScheduleTasks(source, nasa({ startDate: '2027-01-01', selectedReviews: ['MCR'] }));
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 'concept', startDate: '2026-02-10', dueDate: '2026-02-12', title: 'Revisão com a equipe', status: 'blocked', ownerId: 'ana', requirementIds: ['REQ-1'], inputArtifactIds: ['DOC-1'], canEdit: false });
    expect(source).toEqual(before);
  });

  it('moves only model-controlled dates while preserving the saved review content', () => {
    const source = { lifecycleRanges: lifecycleRanges(nasa()), tasks: [task('concept', { lifecycleProfile: 'nasa', reviewCode: 'MCR', phaseId: 'nasa-Pré-A', title: 'Conceito revisado', startDate: '2026-02-26', dueDate: '2026-02-26', manual: false })] };
    const result = previewScheduleTasks(source, nasa({ startDate: '2027-01-01', selectedReviews: ['MCR'] }));
    expect(result[0]).toMatchObject({ id: 'concept', title: 'Conceito revisado', startDate: '2027-02-26', dueDate: '2027-02-26' });
  });

  it('keeps user activities and existing review records when their phase is removed', () => {
    const ranges = lifecycleRanges(nasa());
    const source = {
      lifecycleRanges: ranges,
      tasks: [
        task('user-work', { phaseId: 'nasa-Pré-A', phase: 'Estudos de conceito', ownerId: 'ana', dueDate: '2026-02-12', outputArtifactIds: ['DOC-2'] }),
        task('concept', { kind: 'review', lifecycleProfile: 'nasa', reviewCode: 'MCR', phaseId: 'nasa-Pré-A', dueDate: '2026-02-26' }),
      ],
    };
    const result = previewScheduleTasks(source, nasa({ phases: ranges.slice(1), selectedReviews: [] }));
    expect(result.map(item => item.id)).toEqual(['user-work', 'concept']);
    expect(result.every(item => item.phaseId === '' && item.phase === '')).toBe(true);
    expect(result[0]).toMatchObject({ dueDate: '2026-02-12', ownerId: 'ana', outputArtifactIds: ['DOC-2'] });
    expect(result[1].dueDate).toBe('2026-02-26');
  });

  it('previews reactivated hidden milestones using their existing manual dates and records', () => {
    const ranges = lifecycleRanges(nasa());
    const hidden = task('hidden-concept', { kind: 'review', lifecycleProfile: 'nasa', reviewCode: 'MCR', phaseId: 'nasa-Pré-A', manual: true, excluded: true, dueDate: '2028-04-02', status: 'done', testIds: ['VER-2'] });
    const source = { lifecycleRanges: ranges, tasks: [], lifecycleTasks: [hidden] };
    const result = previewScheduleTasks(source, nasa({ selectedReviews: ['MCR'] }));
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 'hidden-concept', dueDate: '2028-04-02', status: 'done', testIds: ['VER-2'], excluded: false });
    expect(result[0].previewOnly).toBeUndefined();
    expect(hidden.excluded).toBe(true);
  });

  it('does not resurrect archived milestones or excluded records outside the remaining template', () => {
    const ranges = lifecycleRanges(nasa());
    const source = {
      lifecycleRanges: ranges, tasks: [], lifecycleTasks: [
        task('archived', { lifecycleProfile: 'nasa', reviewCode: 'MCR', archived: true }),
        task('excluded', { lifecycleProfile: 'nasa', reviewCode: 'OLD', excluded: true }),
      ],
    };
    expect(previewScheduleTasks(source, nasa({ selectedReviews: ['MCR'] }))).toEqual([]);
  });

  it('switches profiles without losing independent tasks or inventing replacement records for known reviews', () => {
    const ecss: DeliveryLifecycle = { profile: 'ecss', startDate: '2026-01-01', durations: LIFE_DURATIONS.ecss, selectedReviews: ['MDR'] };
    const source = {
      lifecycleRanges: lifecycleRanges(nasa()),
      tasks: [task('independent'), task('nasa-mcr', { lifecycleProfile: 'nasa', reviewCode: 'MCR' })],
      lifecycleTasks: [task('saved-ecss', { lifecycleProfile: 'ecss', reviewCode: 'MDR', phaseId: 'ecss-0', manual: true, dueDate: '2027-05-06', ownerId: 'joao' })],
    };
    const result = previewScheduleTasks(source, ecss);
    expect(result.map(item => item.id)).toEqual(['independent', 'saved-ecss']);
    expect(result[1]).toMatchObject({ dueDate: '2027-05-06', ownerId: 'joao' });
  });

  it('marks newly proposed milestones as unsaved and never invents evidence or completion', () => {
    const result = previewScheduleTasks({ tasks: [], lifecycleRanges: [] }, nasa({ selectedReviews: ['MCR'] }));
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ reviewCode: 'MCR', previewOnly: true, canEdit: false, status: 'planned', requirementIds: [], testIds: [], inputArtifactIds: [], outputArtifactIds: [] });
  });
});

describe('schedule timeline bounds', () => {
  it('includes dates on and before the Unix epoch with visible space on both ends', () => {
    const window = timelineWindow([task('old', { startDate: '1969-12-20', dueDate: '1970-01-01' })], []);
    expect(window.start).toBeLessThan(time('1969-12-20'));
    expect(window.end).toBeGreaterThan(0);
    expect(window.span).toBe(window.end - window.start);
  });

  it('gives a same-day milestone at least a week of context without placing it against an edge', () => {
    const window = timelineWindow([task('milestone', { startDate: '2026-03-20', dueDate: '2026-03-20' })], []);
    expect(window.span).toBeGreaterThanOrEqual(7 * DAY);
    expect(window.start).toBeLessThan(time('2026-03-20'));
    expect(window.end).toBeGreaterThan(time('2026-03-20'));
  });

  it('ignores invalid calendar dates and archived outliers while including phase dates', () => {
    const window = timelineWindow([
      task('invalid', { startDate: '2026-02-30', dueDate: 'not-a-date' }),
      task('archived', { archived: true, dueDate: '2099-01-01' }),
    ], [phase('active', 'Ativa')]);
    expect(window.start).toBeLessThan(time('2026-01-01'));
    expect(window.end).toBeGreaterThan(time('2026-02-01'));
    expect(window.end).toBeLessThan(time('2026-02-10'));
  });

  it('uses a deterministic caller-provided anchor for a schedule without dates', () => {
    const window = timelineWindow([task('unplanned')], [], '2026-10-16');
    expect(window.start).toBeLessThan(time('2026-10-16'));
    expect(window.end).toBeGreaterThan(time('2026-10-16'));
    expect(window.span).toBeGreaterThanOrEqual(7 * DAY);
    expect(timelineWindow([], [], 'invalid')).toEqual(timelineWindow([], [], '1970-01-01'));
  });
});
