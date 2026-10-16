/** Exact matching after typographic normalization; never guesses missing quotes. */
export function normalizeEvidenceText(text: string) {
  let normalized = ''; const offsets: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const value = text[index].normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[‐‑–—]/g, '-');
    for (const char of value) { if (/\s|\u00ad/.test(char)) continue; normalized += char; offsets.push(index); }
  }
  return { text: normalized, offsets };
}
export function evidenceRanges(text: string, excerpt: string): { start: number; end: number }[] {
  const source = normalizeEvidenceText(text), quote = normalizeEvidenceText(excerpt).text;
  if (quote.length < 8) return [];
  const ranges: { start: number; end: number }[] = [];
  let start = source.text.indexOf(quote);
  while (start >= 0 && ranges.length < 30) {
    ranges.push({ start: source.offsets[start], end: source.offsets[start + quote.length - 1] + 1 });
    start = source.text.indexOf(quote, start + quote.length);
  }
  return ranges;
}
