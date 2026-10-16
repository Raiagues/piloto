import { describe, expect, it } from 'vitest';
import { evidenceRanges } from '../src/lib/evidenceHighlight';
describe('evidence anchors in original PDF text', () => {
  it('maps typographic variants and line wrapping back to source offsets', () => {
    const text = 'Introdução. A tensão “nominal” é 3,3 V.\nFim.';
    const ranges = evidenceRanges(text, 'A tensão "nominal" é\n3,3 V.');
    expect(ranges).toHaveLength(1);
    expect(text.slice(ranges[0].start, ranges[0].end)).toBe('A tensão “nominal” é 3,3 V.');
  });
  it('locates multiple occurrences without including adjacent claims', () => {
    const text = 'A corrente máxima é 2 A. Outra medida. A corrente máxima é 2 A.';
    const ranges = evidenceRanges(text, 'A corrente máxima é 2 A.');
    expect(ranges.map(range => text.slice(range.start, range.end))).toEqual(['A corrente máxima é 2 A.', 'A corrente máxima é 2 A.']);
  });
  it('does not highlight a similar claim with a different value', () => {
    expect(evidenceRanges('A tensão nominal é 3,3 V.', 'A tensão nominal é 3,0 V.')).toEqual([]);
    expect(evidenceRanges('documento sem essa afirmação', 'EPS')).toEqual([]);
  });
});
