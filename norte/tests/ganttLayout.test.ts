import { describe, expect, it } from 'vitest';
import { DAY, axisTiers, fitLanes, layoutLanes, utcTime } from '../src/lib/ganttLayout';
import type { ScheduleGroup, ScheduleTask } from '../src/lib/schedulePlanning';

const task = (id: string, patch: Partial<ScheduleTask>) =>
  ({
    id,
    title: id,
    kind: 'task',
    startDate: '',
    dueDate: '',
    status: 'planned',
    archived: false,
    ...patch,
  }) as ScheduleTask;
const window = (start: string, end: string) => {
  const from = utcTime(start)!,
    to = utcTime(end)!;
  return { start: from, end: to, span: to - from };
};

describe('Gantt lanes', () => {
  it('stacks overlapping activities on separate rows and keeps reviews above them', () => {
    const group = {
      id: 'phase:a',
      phase: null,
      title: 'A',
      tasks: [
        task('one', { startDate: '2026-01-01', dueDate: '2026-01-20' }),
        task('two', { startDate: '2026-01-10', dueDate: '2026-01-30' }),
        task('three', { startDate: '2026-03-01', dueDate: '2026-03-20' }),
        task('gate', { kind: 'review', reviewCode: 'SRR', dueDate: '2026-02-01' }),
        task('undated', {}),
        task('later', { startDate: '2027-01-01', dueDate: '2027-01-02' }),
      ],
    } as ScheduleGroup;
    const [lane] = layoutLanes([group], window('2026-01-01', '2026-06-30'), 1200);
    const level = (id: string) => lane.activities.find(item => item.task.id === id)!.level;
    expect([level('one'), level('two'), level('three')]).toEqual([0, 1, 0]);
    expect(lane.reviews.map(item => item.task.id)).toEqual(['gate']);
    expect([lane.reviewLevels, lane.activityLevels]).toEqual([1, 2]);
    expect(lane.undated.map(item => item.id)).toEqual(['undated']);
    expect(lane.outside).toBe(1);
  });

  it('moves a label outside a bar too short to hold it', () => {
    const group = {
      id: 'g',
      phase: null,
      title: 'G',
      tasks: [task('Verificar o relatório de massa', { startDate: '2026-01-01', dueDate: '2026-01-02' })],
    } as ScheduleGroup;
    const [lane] = layoutLanes([group], window('2026-01-01', '2026-12-31'), 900);
    expect(lane.activities[0].labelOutside).toBe(true);
  });
});

describe('fitting the page', () => {
  it('shares spare height equally up to the cap and never shrinks a lane', () => {
    expect(fitLanes([54, 54, 54], 300)).toEqual([100, 100, 100]);
    expect(fitLanes([54, 54], 1000, 150)).toEqual([150, 150]);
    expect(fitLanes([54, 200], 360, 150)).toEqual([150, 200]);
    expect(fitLanes([80, 80], 100)).toEqual([80, 80]);
  });
});

describe('time axis', () => {
  it('shows years over months for a multi-year project and drops labels that would not fit', () => {
    const axis = axisTiers(window('2026-10-20', '2029-04-30'), 860, 'pt');
    expect(axis.unit).toBe('months');
    expect(axis.top.map(item => item.label)).toEqual(['2026', '2027', '2028', '2029']);
    expect(axis.bottom[0].label).toBe('');
    expect(axis.bottom.some(item => item.label === 'J')).toBe(true);
  });
  it('switches to weeks when a quarter fills the width', () => {
    const axis = axisTiers(window('2026-10-12', '2027-01-11'), 1100, 'pt');
    expect(axis.unit).toBe('weeks');
    expect(axis.top[1].label).toMatch(/novembro/);
    expect(
      axis.bottom.every(item => item.width <= ((7 * DAY) / window('2026-10-12', '2027-01-11').span) * 100 + 1e-9),
    ).toBe(true);
  });
});
