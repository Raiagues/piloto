import { describe, expect, it, vi } from 'vitest';
import { homeOverview } from '../src/lib/homeOverview';
import { countdown } from '../src/lib/sidebarTree';
import type { DeliveryState } from '../src/lib/projectDelivery';
import type { MeetingSummary } from '../src/lib/meetings';

// Links are built from the current address; the overview is computed while the suite is collected.
vi.stubGlobal('window', { location: { href: 'http://norte.local/norte/#/' } });

const option = (id: string) => ({ id, code: id, title: id, flow: 'input', kind: '', maturity: '', reference: null });
const task = (id: string, patch: Record<string, unknown> = {}) => ({
  id,
  kind: 'task',
  title: id,
  startDate: '',
  dueDate: '',
  status: 'planned',
  archived: false,
  overdue: false,
  blockedBy: [],
  dateConflicts: [],
  requirementIds: [],
  testIds: [],
  documentOptions: [],
  ...patch,
});
const data = {
  lifecycleRanges: [
    { id: 'p0', code: '0', name: 'Missão', start: '2026-10-01', end: '2026-11-30' },
    { id: 'pa', code: 'A', name: 'Viabilidade', start: '2026-12-01', end: '2027-03-31' },
  ],
  tasks: [
    task('mdr', {
      kind: 'review',
      reviewCode: 'MDR',
      title: 'MDR · Definição da missão',
      dueDate: '2026-11-05',
      prepDays: 10,
      documentOptions: [option('A'), option('B')],
      requirementIds: ['R1', 'R2'],
    }),
    task('srr', { kind: 'review', reviewCode: 'SRR', title: 'SRR · Requisitos do sistema', dueDate: '2027-02-01' }),
    task('late', { title: 'Relatório de massa', dueDate: '2026-10-20' }),
    task('stuck', { title: 'Ensaio de vibração', dueDate: '2026-12-10', blockedBy: ['late'] }),
    task('closed', { title: 'Feito', dueDate: '2026-10-01', status: 'done' }),
  ],
  documents: [
    {
      id: 'd1',
      taskId: 'mdr',
      templateId: 'A',
      code: 'A',
      title: 'A',
      status: 'changes_requested',
      version: 2,
      updatedAt: '2026-10-25T10:00:00Z',
    },
  ],
  requirements: [
    { id: 'R1', title: 'Carga útil', status: 'approved', archived: false, analysis: { findings: [] } },
    { id: 'R2', title: 'Alcance', status: 'in_review', archived: false, analysis: { findings: [{}, {}] } },
    { id: 'R3', title: 'Antigo', status: 'draft', archived: true, analysis: { findings: [{}] } },
  ],
  tests: [],
} as unknown as DeliveryState;

describe('home overview', () => {
  const today = '2026-10-27';
  const overview = homeOverview(
    data,
    [
      { id: 'm1', title: 'Antiga', projectId: 'p', status: 'done', updatedAt: '2026-10-01T10:00:00Z' },
      { id: 'm2', title: 'Recente', projectId: 'p', status: 'running', updatedAt: '2026-10-26T10:00:00Z' },
      { id: 'x', title: 'Outro projeto', projectId: 'q', status: 'done', updatedAt: '2026-10-26T12:00:00Z' },
    ] as MeetingSummary[],
    'p',
    today,
    true,
  );

  it('places today in the current phase window', () => {
    expect(overview.phase).toMatchObject({ code: '0', state: 'current', daysLeft: 34 });
    expect(overview.phase!.elapsed).toBeCloseTo(27 / 61, 5);
    expect(overview.timeline!.phases.map(phase => phase.current)).toEqual([true, false]);
  });

  it('picks the next review with its package date and criteria', () => {
    expect(overview.next).toMatchObject({
      code: 'MDR',
      prepared: 1,
      planned: 2,
      criteriaMet: 1,
      criteriaTotal: 2,
      packBy: '2026-10-26',
    });
    expect(overview.openReviews).toBe(2);
  });

  it('lists late work first, then blocked work, packages, requested changes and findings', () => {
    expect(overview.attention.map(item => item.kind)).toEqual(['overdue', 'package', 'changes', 'blocked', 'findings']);
    expect(overview.attention[0]).toMatchObject({
      title: 'Relatório de massa',
      detail: 'venceu há 7 dias',
      tone: 'danger',
    });
    expect(overview.attention.find(item => item.kind === 'findings')!.code).toBe('R2');
  });

  it('counts active requirements only and keeps meetings of this project, newest first', () => {
    expect(overview.requirements).toEqual({ total: 2, approved: 1, inReview: 1, withFindings: 1, findings: 2 });
    expect(overview.documents).toEqual({ planned: 2, prepared: 1, approved: 0 });
    expect(overview.meetings.map(meeting => meeting.id)).toEqual(['m2', 'm1']);
  });

  it('stays empty without project data', () => {
    expect(homeOverview(null, null, 'p', today, true)).toMatchObject({
      phase: null,
      next: null,
      openReviews: 0,
      attention: [],
      meetings: [],
    });
  });
});

describe('countdown', () => {
  it('speaks in days relative to today', () => {
    expect(countdown('2026-11-23', '2026-10-27', true)).toBe('em 27 dias');
    expect(countdown('2026-10-28', '2026-10-27', true)).toBe('amanhã');
    expect(countdown('2026-10-27', '2026-10-27', false)).toBe('today');
    expect(countdown('2026-10-24', '2026-10-27', true)).toBe('há 3 dias');
    expect(countdown('', '2026-10-27', true)).toBe('');
  });
});
