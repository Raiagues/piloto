import { describe, expect, it } from 'vitest';
import { meetingFolders, requirementGroups, reviewEntries, shortDate } from '../src/lib/sidebarTree';
import type { DeliveryState } from '../src/lib/projectDelivery';
import type { MeetingSummary } from '../src/lib/meetings';

const option = (id: string) => ({ id, code: id, title: id, flow: 'input', kind: '', maturity: '', reference: null });
const review = (id: string, dueDate: string, patch: Record<string, unknown> = {}) => ({
  id,
  kind: 'review',
  reviewCode: id.toUpperCase(),
  title: `${id.toUpperCase()} · Review ${id}`,
  dueDate,
  status: 'planned',
  archived: false,
  overdue: false,
  documentOptions: [option('A'), option('B')],
  ...patch,
});
const meeting = (id: string, patch: Partial<MeetingSummary> = {}) =>
  ({
    id,
    title: `Meeting ${id}`,
    projectId: 'p',
    scope: 'team',
    status: 'done',
    createdAt: '2026-10-20T10:00:00Z',
    participants: [],
    ...patch,
  }) as MeetingSummary;

describe('schedule tree', () => {
  it('orders reviews by date, marks the next one and counts prepared and approved documents', () => {
    const data = {
      tasks: [
        review('cdr', '2027-03-01'),
        review('mdr', '2026-10-01', { status: 'done' }),
        review('srr', '2026-11-20'),
        review('old', '2026-10-10'),
        review('gone', '2026-12-01', { archived: true }),
        { id: 'task', kind: 'task', title: 'Task', dueDate: '2026-11-01', archived: false, documentOptions: [] },
      ],
      documents: [
        { id: 'd1', taskId: 'srr', templateId: 'A', code: 'A', title: 'A', status: 'approved', version: 1 },
        { id: 'd2', taskId: 'srr', templateId: 'B', code: 'B', title: 'B', status: 'draft', version: 3 },
        { id: 'd3', taskId: 'srr', templateId: 'extra', code: 'X', title: 'Extra', status: 'approved', version: 1 },
      ],
    } as unknown as DeliveryState;
    const entries = reviewEntries(data, '2026-10-27');
    expect(entries.map(entry => entry.code)).toEqual(['MDR', 'OLD', 'SRR', 'CDR']);
    expect(entries.map(entry => entry.state)).toEqual(['done', 'overdue', 'next', 'planned']);
    const srr = entries.find(entry => entry.code === 'SRR')!;
    expect([srr.prepared, srr.planned, srr.approved]).toEqual([2, 2, 1]);
    expect(srr.label).toBe('Review srr');
    expect(srr.documents.map(document => document.id)).toEqual(['d1', 'd2', 'd3']);
  });

  it('groups active requirements by sector and keeps unassigned ones under the system', () => {
    const data = {
      requirements: [
        { id: 'R1', sectorId: '' },
        { id: 'R2', sectorId: 's1' },
        { id: 'R3', sectorId: 's1', archived: true },
      ],
      sectors: [
        { id: 's1', name: 'Propulsion' },
        { id: 's2', name: 'Empty' },
      ],
    } as unknown as DeliveryState;
    expect(requirementGroups(data, 'pt')).toEqual([
      { id: '__system', name: 'Sistema', count: 1 },
      { id: 's1', name: 'Propulsion', count: 1 },
    ]);
  });
});

describe('meeting folders', () => {
  const sectors = [
    { id: 'prop', name: 'Propulsão' },
    { id: 'aero', name: 'Aerodinâmica' },
  ];
  it('shows the team folder, every sector in project order and invitation-only meetings last', () => {
    const folders = meetingFolders(
      [
        meeting('1'),
        meeting('2', { scope: 'sector', sectorId: 'aero', sectorName: 'Aerodinâmica' }),
        meeting('3', { scope: 'private' }),
        meeting('4', { projectId: 'other' }),
      ],
      'p',
      sectors,
      'pt',
    );
    expect(folders.map(folder => [folder.label, folder.meetings.length])).toEqual([
      ['Geral da equipe', 1],
      ['Propulsão', 0],
      ['Aerodinâmica', 1],
      ['Por convite', 1],
    ]);
  });
  it('sorts by date and splits a long folder by month', () => {
    const many = Array.from({ length: 8 }, (_, index) =>
      meeting(String(index), { createdAt: `2026-${index < 4 ? '09' : '10'}-1${index}T10:00:00Z` }),
    );
    const [team] = meetingFolders(many, 'p', [], 'pt');
    expect(team.meetings[0].id).toBe('7');
    expect(team.months.map(month => [month.key, month.meetings.length])).toEqual([
      ['2026-10', 4],
      ['2026-09', 4],
    ]);
  });
  it('lists nothing without an open project', () => {
    expect(meetingFolders([meeting('1')], '', sectors, 'pt')).toEqual([]);
  });
  it('writes short, aligned dates', () => {
    const now = new Date('2026-10-27T12:00:00');
    expect(shortDate('2026-10-05T10:00:00', 'pt', now)).toBe('05/10');
    expect(shortDate('2025-03-09T10:00:00', 'pt', now)).toBe('09/03/25');
    expect(shortDate('', 'pt', now)).toBe('—');
  });
});
