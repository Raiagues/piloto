export type Span = { start: number; end: number };
export type Segment = { start: number; end: number; ids: string[] };
export function normalizeWithMap(text: string, mode?: 'strict' | 'loose'): { text: string; map: number[]; mapEnd: number[]; length: number };
export function findOccurrences(source: string, quote: string, mode?: 'strict' | 'loose'): Span[];
export function resolveQuote(blocks: { id: string; page: number | null; text: string }[], quote: string, options?: { blockIds?: string[] | null; contextBefore?: string; contextAfter?: string; mode?: 'strict' | 'loose' }): { status: 'resolved' | 'ambiguous' | 'not_found'; blockId?: string; page?: number | null; start?: number; end?: number; candidates: ({ blockId: string; page: number | null } & Span)[]; disambiguatedBy?: string };
export function segmentHighlights(length: number, highlights: ({ id: string } & Span)[]): Segment[];
export function extractQuantities(text: string): { literal: string; start: number; end: number; unit: string; operator: string | null; operatorText: string | null; conditionLiteral: string | null; conditionStart: number | null; normalized: { value: number; unit: string } | null }[];
