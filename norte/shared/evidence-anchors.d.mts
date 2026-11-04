export type Span = { start: number; end: number };
export type Segment = { start: number; end: number; ids: string[] };
export function normalizeWithMap(
  text: string,
  mode?: 'strict' | 'loose',
): { text: string; map: number[]; mapEnd: number[]; length: number };
export function findOccurrences(source: string, quote: string, mode?: 'strict' | 'loose'): Span[];
export function segmentHighlights(length: number, highlights: ({ id: string } & Span)[]): Segment[];
