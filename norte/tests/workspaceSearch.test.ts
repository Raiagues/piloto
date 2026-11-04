import { describe, expect, it } from 'vitest';
import { normalize, parseQuery, searchWorkspace, stem } from '../src/lib/workspaceSearch';
import type { SearchItem } from '../src/lib/workspaceSearch';

const now = new Date('2026-10-27T15:00:00');
const items: SearchItem[] = [
  {
    id: 'review:mdr',
    kind: 'review',
    code: 'MDR',
    title: 'MDR · Definição da missão',
    subtitle: '0 · Análise da missão · 0/3 documentos',
    date: '2026-11-23',
    statuses: ['planned'],
    href: '#mdr',
  },
  {
    id: 'review:srr',
    kind: 'review',
    code: 'SRR',
    title: 'SRR · Requisitos do sistema',
    subtitle: 'B · Definição preliminar · 2/7 documentos',
    date: '2027-01-25',
    statuses: ['planned'],
    href: '#srr',
  },
  {
    id: 'req:3',
    kind: 'requirement',
    code: 'LYLE-003',
    title: 'Propulsão dos estágios superiores',
    text: 'Os estágios superiores devem usar propulsão líquida.',
    tags: ['Propulsão'],
    statuses: ['draft', 'findings'],
    href: '#req3',
  },
  {
    id: 'req:1',
    kind: 'requirement',
    code: 'LYLE-001',
    title: 'Capacidade da missão',
    text: 'O sistema deve colocar a carga útil em órbita.',
    tags: ['Missão'],
    statuses: ['draft', 'findings'],
    href: '#req1',
  },
  {
    id: 'doc:ts',
    kind: 'document',
    code: 'TS',
    title: 'Especificação de requisitos',
    subtitle: 'SRR · Requisitos do sistema · v1 · Rascunho',
    text: '# Especificação\nA matriz de rastreabilidade acompanha cada requisito.',
    date: '2026-10-27T12:20:20Z',
    statuses: ['draft'],
    href: '#ts',
  },
  {
    id: 'meeting:decisions',
    kind: 'meeting',
    title: 'LYLE · Revisão e decisões pendentes',
    subtitle: 'Equipe LYLE · Geral',
    date: '2026-10-27T12:20:21Z',
    statuses: ['done'],
    href: '#m1',
  },
  {
    id: 'meeting:old',
    kind: 'meeting',
    title: 'Alinhamento de estruturas',
    subtitle: 'Estruturas',
    date: '2026-09-02T10:00:00Z',
    statuses: ['done'],
    href: '#m2',
  },
];
const ids = (query: string) => searchWorkspace(items, query, { now }).results.map(result => result.id);

describe('workspace search language', () => {
  it('folds accents and Portuguese plurals', () => {
    expect(normalize('Revisão')).toBe('revisao');
    expect(stem('revisoes')).toBe('revisao');
    expect(stem('requisitos')).toBe('requisito');
    expect(stem('reunioes')).toBe('reuniao');
  });

  it('reads months, relative dates and day-month dates without inventing a year', () => {
    expect(parseQuery('reunião de outubro', { now }).intent.range?.label).toBe('outubro de 2026');
    expect(parseQuery('ata 27/10', { now }).intent.range?.label).toBe('27 de outubro');
    expect(parseQuery('ontem', { now }).intent.range?.label).toBe('ontem');
    expect(parseQuery('set de documentos', { now }).intent.range).toBeNull();
    expect(parseQuery('revisões em 2027', { now }).intent.range?.label).toBe('2027');
  });

  it('names what it understood as chips', () => {
    const { intent } = parseQuery('documentos em rascunho', { now });
    expect(intent.kinds).toContain('document');
    expect(intent.statuses).toContain('draft');
    expect(intent.chips.map(chip => chip.label)).toEqual(expect.arrayContaining(['Documentos', 'Rascunho']));
  });
});

describe('workspace search ranking', () => {
  it('puts the review first for its acronym', () => {
    expect(ids('mdr')[0]).toBe('review:mdr');
    expect(ids('SRR')[0]).toBe('review:srr');
  });

  it('finds a requirement by a short number and by the project code', () => {
    expect(ids('req 3')[0]).toBe('req:3');
    expect(ids('lyle-001')[0]).toBe('req:1');
  });

  it('keeps kind words as ordinary words, so titles that contain them still match', () => {
    expect(ids('requisitos do sistema')).toContain('review:srr');
    expect(ids('decisões pendentes')[0]).toBe('meeting:decisions');
  });

  it('tolerates typos and accents', () => {
    expect(ids('propulsao')[0]).toBe('req:3');
    expect(ids('especificaçao')).toContain('doc:ts');
    expect(ids('especifcação')).toContain('doc:ts');
  });

  it('filters by date words and kind words together', () => {
    expect(ids('reunião de outubro')).toEqual(['meeting:decisions']);
    expect(ids('ata setembro')).toEqual(['meeting:old']);
  });

  it('uses states as filters and shows the matching passage of long text', () => {
    const outcome = searchWorkspace(items, 'rascunho rastreabilidade', { now });
    expect(outcome.results.map(result => result.id)).toEqual(['doc:ts']);
    expect(outcome.results[0].snippet?.some(part => part.hit && /rastreabilidade/i.test(part.text))).toBe(true);
  });

  it('offers approximate results instead of nothing when one word has no match', () => {
    const outcome = searchWorkspace(items, 'missão xyzw', { now });
    expect(outcome.approximate).toBe(true);
    expect(outcome.results.map(result => result.id)).toContain('review:mdr');
  });

  it('returns nothing for an empty query', () => {
    expect(searchWorkspace(items, '   ', { now }).results).toEqual([]);
  });
});
