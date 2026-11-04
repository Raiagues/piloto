import type { Language } from './types';

export type SearchKind =
  | 'review'
  | 'requirement'
  | 'document'
  | 'meeting'
  | 'task'
  | 'phase'
  | 'source'
  | 'project'
  | 'page';
export type SearchItem = {
  id: string;
  kind: SearchKind;
  title: string;
  href: string;
  code?: string;
  subtitle?: string;
  text?: string;
  tags?: string[];
  /** ISO date or date-time used by date words such as "outubro" or "ontem". */
  date?: string;
  /** Normalized states: draft, in_review, approved, changes_requested, planned, in_progress, done, overdue, findings, running. */
  statuses?: string[];
  /** Ranking prior, e.g. the next review or a recent meeting. */
  boost?: number;
};
export type Segment = { text: string; hit: boolean };
export type SearchResult = SearchItem & { score: number; titleParts: Segment[]; snippet: Segment[] | null };
export type SearchChip = { key: string; label: string };
export type SearchIntent = {
  kinds: SearchKind[];
  statuses: string[];
  range: { from: number; to: number; label: string } | null;
  minutes: boolean;
  chips: SearchChip[];
};
export type SearchOutcome = { intent: SearchIntent; results: SearchResult[]; approximate: boolean };

/** Lowercase, without accents: "Revisão" and "revisao" are the same word. */
export const normalize = (value: string) =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
/** Light Portuguese/English plural folding: "revisões" → "revisao", "requisitos" → "requisito". */
export function stem(word: string) {
  if (word.length <= 3 || /\d/.test(word)) return word;
  if (/[oa]es$/.test(word)) return word.slice(0, -3) + 'ao';
  if (word.endsWith('ais')) return word.slice(0, -3) + 'al';
  if (word.endsWith('eis')) return word.slice(0, -3) + 'el';
  if (word.endsWith('ns')) return word.slice(0, -2) + 'm';
  if (/(?:r|z)es$/.test(word) && word.length > 5) return word.slice(0, -2);
  return word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word;
}
const tokens = (value: string) =>
  normalize(value)
    .split(/[^\p{L}\p{N}-]+/u)
    .flatMap(part => (part.includes('-') ? [part, ...part.split('-')] : [part]))
    .filter(Boolean);

const STOP = new Set([
  'a',
  'o',
  'as',
  'os',
  'de',
  'da',
  'do',
  'das',
  'dos',
  'e',
  'em',
  'no',
  'na',
  'nos',
  'nas',
  'um',
  'uma',
  'para',
  'pra',
  'por',
  'com',
  'sem',
  'que',
  'ao',
  'aos',
  'meu',
  'minha',
  'meus',
  'minhas',
  'the',
  'of',
  'for',
  'and',
  'in',
  'on',
  'to',
  'with',
  'my',
  'an',
  'at',
  'is',
]);
/** Words that name a kind of record; they also stay ordinary words, so "requisitos do sistema" still finds the SRR. */
const KIND_WORDS: Record<string, SearchKind[]> = {
  revisao: ['review'],
  review: ['review'],
  marco: ['review'],
  milestone: ['review'],
  gate: ['review'],
  requisito: ['requirement'],
  req: ['requirement'],
  requirement: ['requirement'],
  rf: ['requirement'],
  rnf: ['requirement'],
  documento: ['document'],
  doc: ['document'],
  document: ['document'],
  entregavel: ['document'],
  deliverable: ['document'],
  reuniao: ['meeting'],
  meeting: ['meeting'],
  call: ['meeting'],
  encontro: ['meeting'],
  conversa: ['meeting'],
  ata: ['meeting'],
  minute: ['meeting'],
  atividade: ['task'],
  tarefa: ['task'],
  task: ['task'],
  activity: ['task'],
  fase: ['phase'],
  phase: ['phase'],
  etapa: ['phase'],
  fonte: ['source'],
  origem: ['source'],
  source: ['source'],
  arquivo: ['source', 'document'],
  file: ['source', 'document'],
  anexo: ['source'],
  pdf: ['source'],
  docx: ['source'],
  projeto: ['project'],
  project: ['project'],
};
const STATUS_WORDS: Record<string, string> = {
  rascunho: 'draft',
  draft: 'draft',
  aprovado: 'approved',
  aprovada: 'approved',
  approved: 'approved',
  final: 'approved',
  alteracao: 'changes_requested',
  ajuste: 'changes_requested',
  change: 'changes_requested',
  atrasado: 'overdue',
  atrasada: 'overdue',
  atraso: 'overdue',
  overdue: 'overdue',
  vencido: 'overdue',
  vencida: 'overdue',
  late: 'overdue',
  pendente: 'open',
  pending: 'open',
  aberto: 'open',
  aberta: 'open',
  open: 'open',
  concluido: 'done',
  concluida: 'done',
  done: 'done',
  finalizado: 'done',
  finalizada: 'done',
  finished: 'done',
  encerrada: 'done',
  encerrado: 'done',
  apontamento: 'findings',
  finding: 'findings',
  alerta: 'findings',
  alert: 'findings',
  andamento: 'running',
  live: 'running',
  running: 'running',
  planejado: 'planned',
  planejada: 'planned',
  planned: 'planned',
  bloqueado: 'blocked',
  bloqueada: 'blocked',
  blocked: 'blocked',
};
const PHRASES: [RegExp, { status?: string; kind?: SearchKind; minutes?: boolean }][] = [
  [/\bem revisao\b|\bin review\b|\baguardando revisao\b/g, { status: 'in_review' }],
  [/\balteracoes solicitadas\b|\bchanges requested\b/g, { status: 'changes_requested' }],
  [/\bao vivo\b|\bem andamento\b|\bin progress\b/g, { status: 'running' }],
];
/** Engineering vocabulary in both languages; a synonym counts a little less than the word itself. */
const SYNONYMS: string[][] = [
  ['verificacao', 'verification', 'teste', 'test', 'ensaio'],
  ['especificacao', 'specification', 'spec', 'ts'],
  ['rastreabilidade', 'traceability', 'rtm', 'matriz', 'matrix'],
  ['cronograma', 'schedule', 'gantt', 'planejamento', 'planning'],
  ['reuniao', 'meeting'],
  ['ata', 'minute'],
  ['revisao', 'review'],
  ['documento', 'document'],
  ['requisito', 'requirement'],
  ['missao', 'mission'],
  ['conceito', 'concept', 'con'],
  ['interface', 'icd'],
  ['risco', 'risk'],
  ['qualificacao', 'qualification', 'qr'],
  ['aceitacao', 'acceptance', 'ar'],
  ['projeto', 'project', 'design'],
  ['estrutura', 'structure', 'estruturas'],
  ['propulsao', 'propulsion'],
  ['controle', 'control'],
  ['navegacao', 'navigation'],
  ['aviônica', 'avionica', 'avionics'],
  ['equipe', 'team'],
  ['setor', 'sector', 'subsistema', 'subsystem'],
  ['fonte', 'source', 'origem'],
  ['visao', 'overview'],
].map(group => group.map(word => stem(normalize(word))));
const synonymsOf = (term: string) =>
  SYNONYMS.filter(group => group.includes(term))
    .flat()
    .filter(word => word !== term);

const MONTHS = [
  'janeiro',
  'fevereiro',
  'marco',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];
const MONTHS_EN = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];
/** Full names or five letters always count; "out", "set" or "dez" only next to a day or a year. */
const monthIndex = (word: string, nearNumber: boolean) => {
  for (const list of [MONTHS, MONTHS_EN]) {
    const index = list.findIndex(
      month =>
        month === word ||
        (word.length >= 5 && month.startsWith(word)) ||
        (nearNumber && word.length === 3 && month.startsWith(word)),
    );
    if (index >= 0) return index;
  }
  return -1;
};
const DAY = 86_400_000;
const startOfDay = (time: number) => {
  const date = new Date(time);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

/** Reads date words, kinds and states; returns what is left as ordinary search terms. */
export function parseQuery(
  query: string,
  { language = 'pt', now = new Date() }: { language?: Language; now?: Date } = {},
) {
  const pt = language === 'pt',
    today = startOfDay(now.getTime());
  let text = ` ${normalize(query)} `;
  const statuses = new Set<string>(),
    kinds = new Set<SearchKind>(),
    chips: SearchChip[] = [];
  let minutes = false,
    range: SearchIntent['range'] = null;
  const label = (time: number, options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(pt ? 'pt-BR' : 'en', options).format(time);
  const setRange = (from: number, to: number, text: string) => {
    if (!range) range = { from, to, label: text };
  };
  for (const [pattern, meaning] of PHRASES)
    if (pattern.test(text)) {
      text = text.replace(pattern, ' ');
      if (meaning.status) statuses.add(meaning.status);
    }
  // Relative dates first, so "semana passada" is not read as two unrelated words.
  const weekStart = (offset: number) => {
    const date = new Date(today);
    const day = (date.getDay() + 6) % 7;
    return date.getTime() - day * DAY + offset * 7 * DAY;
  };
  const relative: [RegExp, () => void][] = [
    [
      /\b(?:esta|essa|nesta|this) (?:semana|week)\b/,
      () => setRange(weekStart(0), weekStart(1) - 1, pt ? 'esta semana' : 'this week'),
    ],
    [
      /\bsemana passada\b|\blast week\b|\bultima semana\b/,
      () => setRange(weekStart(-1), weekStart(0) - 1, pt ? 'semana passada' : 'last week'),
    ],
    [
      /\bproxima semana\b|\bnext week\b/,
      () => setRange(weekStart(1), weekStart(2) - 1, pt ? 'próxima semana' : 'next week'),
    ],
    [
      /\b(?:este|esse|neste|this) (?:mes|month)\b/,
      () => {
        const date = new Date(today);
        setRange(
          new Date(date.getFullYear(), date.getMonth(), 1).getTime(),
          new Date(date.getFullYear(), date.getMonth() + 1, 1).getTime() - 1,
          pt ? 'este mês' : 'this month',
        );
      },
    ],
    [
      /\bmes passado\b|\blast month\b/,
      () => {
        const date = new Date(today);
        setRange(
          new Date(date.getFullYear(), date.getMonth() - 1, 1).getTime(),
          new Date(date.getFullYear(), date.getMonth(), 1).getTime() - 1,
          pt ? 'mês passado' : 'last month',
        );
      },
    ],
    [
      /\bproximo mes\b|\bnext month\b/,
      () => {
        const date = new Date(today);
        setRange(
          new Date(date.getFullYear(), date.getMonth() + 1, 1).getTime(),
          new Date(date.getFullYear(), date.getMonth() + 2, 1).getTime() - 1,
          pt ? 'próximo mês' : 'next month',
        );
      },
    ],
    [/\bhoje\b|\btoday\b/, () => setRange(today, today + DAY - 1, pt ? 'hoje' : 'today')],
    [/\bontem\b|\byesterday\b/, () => setRange(today - DAY, today - 1, pt ? 'ontem' : 'yesterday')],
    [/\bamanha\b|\btomorrow\b/, () => setRange(today + DAY, today + 2 * DAY - 1, pt ? 'amanhã' : 'tomorrow')],
  ];
  for (const [pattern, apply] of relative)
    if (pattern.test(text)) {
      apply();
      text = text.replace(pattern, ' ');
    }
  // "27/10", "27/10/2026", "27 de outubro", "outubro de 2027", "out 2026".
  const numeric = /\b(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?\b/.exec(text);
  if (numeric) {
    const day = Number(numeric[1]),
      month = Number(numeric[2]) - 1,
      year = numeric[3] ? Number(numeric[3].length === 2 ? `20${numeric[3]}` : numeric[3]) : now.getFullYear();
    if (month >= 0 && month < 12 && day >= 1 && day <= 31) {
      const from = new Date(year, month, day).getTime();
      setRange(
        from,
        from + DAY - 1,
        label(from, { day: 'numeric', month: 'long', year: numeric[3] ? 'numeric' : undefined }),
      );
      text = text.replace(numeric[0], ' ');
    }
  }
  const words = text.split(/\s+/).filter(Boolean);
  const joiner = (word?: string) => word === 'de' || word === 'of';
  for (let index = 0; index < words.length && !range; index++) {
    let first = index,
      last = index,
      day: number | null = null,
      year: number | null = null;
    if (/^\d{1,2}$/.test(words[index - 1] || '')) {
      day = Number(words[index - 1]);
      first = index - 1;
    } else if (joiner(words[index - 1]) && /^\d{1,2}$/.test(words[index - 2] || '')) {
      day = Number(words[index - 2]);
      first = index - 2;
    }
    if (/^\d{4}$/.test(words[index + 1] || '')) {
      year = Number(words[index + 1]);
      last = index + 1;
    } else if (joiner(words[index + 1]) && /^\d{4}$/.test(words[index + 2] || '')) {
      year = Number(words[index + 2]);
      last = index + 2;
    }
    const month = monthIndex(words[index], day !== null || year !== null);
    if (month < 0) continue;
    // A month without a year means this year's month.
    const chosenYear = year ?? now.getFullYear();
    if (day && day <= 31) {
      const from = new Date(chosenYear, month, day).getTime();
      setRange(
        from,
        from + DAY - 1,
        label(from, { day: 'numeric', month: 'long', ...(year ? { year: 'numeric' } : {}) }),
      );
    } else {
      const from = new Date(chosenYear, month, 1).getTime();
      setRange(from, new Date(chosenYear, month + 1, 1).getTime() - 1, label(from, { month: 'long', year: 'numeric' }));
    }
    words.splice(first, last - first + 1);
  }
  if (!range) {
    const yearIndex = words.findIndex(word => /^20\d{2}$/.test(word));
    if (yearIndex >= 0) {
      const year = Number(words[yearIndex]);
      setRange(new Date(year, 0, 1).getTime(), new Date(year + 1, 0, 1).getTime() - 1, String(year));
      words.splice(yearIndex, 1);
    }
  }
  const terms: string[] = [];
  for (const raw of words) {
    if (STOP.has(raw)) continue;
    const word = stem(raw);
    if (word === 'ata' || word === 'minute') minutes = true;
    for (const kind of KIND_WORDS[word] || []) kinds.add(kind);
    if (STATUS_WORDS[word]) statuses.add(STATUS_WORDS[word]);
    terms.push(word);
  }
  const kindLabels: Record<SearchKind, [string, string]> = {
    review: ['Revisões', 'Reviews'],
    requirement: ['Requisitos', 'Requirements'],
    document: ['Documentos', 'Documents'],
    meeting: [minutes ? 'Atas' : 'Reuniões', minutes ? 'Minutes' : 'Meetings'],
    task: ['Atividades', 'Activities'],
    phase: ['Fases', 'Phases'],
    source: ['Arquivos de origem', 'Source files'],
    project: ['Projetos', 'Projects'],
    page: ['Páginas', 'Pages'],
  };
  const statusLabels: Record<string, [string, string]> = {
    draft: ['Rascunho', 'Draft'],
    approved: ['Aprovado', 'Approved'],
    in_review: ['Em revisão', 'In review'],
    changes_requested: ['Alterações solicitadas', 'Changes requested'],
    overdue: ['Em atraso', 'Overdue'],
    open: ['Pendente', 'Open'],
    done: ['Concluído', 'Done'],
    findings: ['Com apontamentos', 'With findings'],
    running: ['Em andamento', 'In progress'],
    planned: ['Planejado', 'Planned'],
    blocked: ['Bloqueado', 'Blocked'],
  };
  for (const kind of kinds) chips.push({ key: `kind:${kind}`, label: kindLabels[kind][pt ? 0 : 1] });
  for (const status of statuses)
    chips.push({ key: `status:${status}`, label: statusLabels[status]?.[pt ? 0 : 1] || status });
  const chosen = range as SearchIntent['range'];
  if (chosen) chips.push({ key: 'date', label: chosen.label });
  return {
    intent: { kinds: [...kinds], statuses: [...statuses], range: chosen, minutes, chips } satisfies SearchIntent,
    terms,
  };
}

/** Edit distance with transpositions, stopping early above the allowed limit. */
function distance(a: string, b: string, limit: number) {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  const rows = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)] as number[]);
  for (let j = 1; j <= b.length; j++) rows[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let best = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1);
      best = Math.min(best, rows[i][j]);
    }
    if (best > limit) return limit + 1;
  }
  return rows[a.length][b.length];
}
/** How well one query word matches one indexed word (0 when it does not). Typos are tolerated only when asked. */
function wordScore(term: string, word: string, fuzzy = true) {
  if (word === term) return 1;
  const numeric = /^\d+$/.test(term) && /\d/.test(word) ? word.replace(/^\D*0*/, '') : null;
  if (numeric !== null && numeric === term.replace(/^0+/, '')) return 0.95;
  if (term.length >= 2 && word.startsWith(term)) return 0.85 - Math.min(0.2, (word.length - term.length) * 0.02);
  if (term.length >= 4 && word.includes(term)) return 0.6;
  if (fuzzy && term.length >= 4 && !/\d/.test(term)) {
    const limit = term.length >= 8 ? 2 : 1;
    if (
      distance(term, word, limit) <= limit ||
      (word.length > term.length && distance(term, word.slice(0, term.length), limit) <= limit)
    )
      return 0.55;
  }
  return 0;
}
type Field = { weight: number; words: string[]; fuzzy: boolean };
const FIELD_WEIGHTS = { code: 3, title: 2.4, tags: 1.4, subtitle: 1.1, text: 0.75 };
const indexCache = new WeakMap<SearchItem, Field[]>();
function fieldsOf(item: SearchItem) {
  let fields = indexCache.get(item);
  if (!fields) {
    const words = (value?: string) => [...new Set(tokens(value || '').map(stem))];
    // Long bodies are matched exactly or by prefix; typo tolerance stays on short, meaningful fields.
    fields = [
      { weight: FIELD_WEIGHTS.code, words: words(item.code), fuzzy: false },
      { weight: FIELD_WEIGHTS.title, words: words(item.title), fuzzy: true },
      { weight: FIELD_WEIGHTS.tags, words: words((item.tags || []).join(' ')), fuzzy: true },
      { weight: FIELD_WEIGHTS.subtitle, words: words(item.subtitle), fuzzy: true },
      { weight: FIELD_WEIGHTS.text, words: words(item.text?.slice(0, 20000)), fuzzy: false },
    ];
    indexCache.set(item, fields);
  }
  return fields;
}
function textMatch(term: string, item: SearchItem) {
  let best = 0;
  for (const field of fieldsOf(item))
    for (const word of field.words) {
      const score = wordScore(term, word, field.fuzzy) * field.weight;
      if (score > best) best = score;
    }
  for (const synonym of synonymsOf(term))
    for (const field of fieldsOf(item))
      for (const word of field.words) {
        if (word === synonym) best = Math.max(best, 0.8 * field.weight);
      }
  return best;
}
const inRange = (item: SearchItem, range: SearchIntent['range']) => {
  if (!range || !item.date) return false;
  const time = Date.parse(item.date.length === 10 ? `${item.date}T12:00:00` : item.date);
  return time >= range.from && time <= range.to;
};
const statusMatch = (item: SearchItem, status: string) =>
  (item.statuses || []).includes(status) ||
  (status === 'open' &&
    !(item.statuses || []).includes('done') &&
    ['review', 'task', 'document', 'requirement'].includes(item.kind));

/** Marks query words inside a text so the result shows why it matched. */
export function highlight(value: string, terms: string[]): Segment[] {
  if (!terms.length || !value) return [{ text: value, hit: false }];
  const normalized = normalize(value),
    marks = new Array(value.length).fill(false);
  for (const match of normalized.matchAll(/[\p{L}\p{N}]+/gu)) {
    const word = stem(match[0]);
    if (terms.some(term => wordScore(term, word) >= 0.55 || synonymsOf(term).includes(word)))
      for (let i = match.index!; i < match.index! + match[0].length; i++) marks[i] = true;
  }
  const parts: Segment[] = [];
  for (let i = 0; i < value.length; i++) {
    const last = parts[parts.length - 1];
    if (last && last.hit === marks[i]) last.text += value[i];
    else parts.push({ text: value[i], hit: marks[i] });
  }
  return parts;
}
function snippet(value: string, terms: string[]): Segment[] | null {
  const clean = value
    .replace(/[#*_>`|[\]]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const normalized = normalize(clean);
  let at = -1;
  for (const match of normalized.matchAll(/[\p{L}\p{N}]+/gu)) {
    if (terms.some(term => wordScore(term, stem(match[0])) >= 0.6)) {
      at = match.index!;
      break;
    }
  }
  if (at < 0) return null;
  const start = Math.max(0, clean.lastIndexOf(' ', Math.max(0, at - 48)) + 1),
    end = Math.min(clean.length, at + 110);
  const parts = highlight(clean.slice(start, end), terms);
  if (start > 0) parts.unshift({ text: '…', hit: false });
  if (end < clean.length) parts.push({ text: '…', hit: false });
  return parts;
}

/**
 * Every word must be explained by the record: by its text, by its kind ("ata", "requisito") or its state ("rascunho").
 * Date words filter by the record date. When nothing satisfies every word, the closest partial matches are returned.
 */
export function searchWorkspace(
  items: SearchItem[],
  query: string,
  options: { language?: Language; now?: Date; limit?: number } = {},
): SearchOutcome {
  const { intent, terms } = parseQuery(query, options);
  if (!terms.length && !intent.range && !intent.statuses.length) return { intent, results: [], approximate: false };
  const score = (item: SearchItem, strict: boolean) => {
    if (intent.range && !inRange(item, intent.range)) return 0;
    let total = intent.range ? 1.6 : 0,
      matched = 0;
    for (const status of intent.statuses) {
      if (statusMatch(item, status)) total += 1.4;
      else if (strict) return 0;
    }
    for (const term of terms) {
      const text = textMatch(term, item);
      const kind = (KIND_WORDS[term] || []).includes(item.kind) ? 1.5 : 0;
      const state = STATUS_WORDS[term] && statusMatch(item, STATUS_WORDS[term]) ? 1.4 : 0;
      const best = Math.max(text, kind, state);
      if (best > 0) {
        total += best;
        matched++;
      } else if (strict) return 0;
    }
    if (!strict && terms.length && matched === 0) return 0;
    return total * (strict ? 1 : matched / Math.max(1, terms.length)) + (item.boost || 0);
  };
  const rank = (strict: boolean) =>
    items
      .map(item => ({ item, value: score(item, strict) }))
      .filter(entry => entry.value > 0)
      .sort((a, b) => b.value - a.value);
  let ranked = rank(true),
    approximate = false;
  if (!ranked.length && terms.length > 1) {
    ranked = rank(false);
    approximate = ranked.length > 0;
  }
  const visibleTerms = terms.filter(term => !STATUS_WORDS[term] || !intent.statuses.includes(STATUS_WORDS[term]));
  const results = ranked.slice(0, options.limit ?? 40).map(({ item, value }) => {
    const titleParts = highlight(item.title, visibleTerms);
    const titleHit =
      titleParts.some(part => part.hit) ||
      highlight(`${item.code || ''} ${item.subtitle || ''}`, visibleTerms).some(part => part.hit);
    return {
      ...item,
      score: value,
      titleParts,
      snippet: !titleHit && item.text ? snippet(item.text, visibleTerms) : null,
    };
  });
  return { intent, results, approximate };
}
