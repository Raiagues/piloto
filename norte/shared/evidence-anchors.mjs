/** Evidence anchoring shared by the server and the browser.
 *
 * Offsets are UTF-16 code units (JavaScript string indices), start inclusive,
 * end exclusive. Normalization keeps the original text: it returns a
 * map from every normalized character back to its original offset, so a match
 * found in normalized text is always reported against the literal source.
 */
const ZERO_WIDTH = new Set(['​', '‌', '‍', '⁠', '﻿', '­']);
const DASHES = /[‐‑‒–—−]/u;
const QUOTES = {
  '‘': "'",
  '’': "'",
  '‚': "'",
  '‛': "'",
  '“': '"',
  '”': '"',
  '„': '"',
  '«': '"',
  '»': '"',
  '′': "'",
  '″': '"',
};

/** strict: whitespace/zero-width/hyphenation/quote-style only. loose: also case and diacritics (OCR linking only). */
export function normalizeWithMap(text, mode = 'strict') {
  const out = [],
    map = [],
    mapEnd = [];
  let pendingSpace = false;
  for (let i = 0; i < text.length; ) {
    const code = text.codePointAt(i),
      ch = String.fromCodePoint(code),
      width = ch.length;
    if (ZERO_WIDTH.has(ch)) {
      i += width;
      continue;
    }
    // End-of-line hyphenation: "propu-\nlsão" -> "propulsão" (only between letters).
    if (
      ch === '-' &&
      text[i + 1] === '\n' &&
      out.length &&
      /\p{L}/u.test(out[out.length - 1]) &&
      /\p{L}/u.test(text[i + 2] || '')
    ) {
      i += 2;
      continue;
    }
    if (/\s/u.test(ch)) {
      pendingSpace = out.length > 0;
      i += width;
      continue;
    }
    let value = QUOTES[ch] || (DASHES.test(ch) ? '-' : ch);
    if (mode === 'loose') value = value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR');
    else value = value.normalize('NFC');
    if (pendingSpace) {
      out.push(' ');
      map.push(i);
      mapEnd.push(i);
      pendingSpace = false;
    }
    // One entry per UTF-16 unit so indices in the joined string align with the maps.
    for (let k = 0; k < value.length; k++) {
      out.push(value[k]);
      map.push(i);
      mapEnd.push(i + width);
    }
    i += width;
  }
  return { text: out.join(''), map, mapEnd, length: text.length };
}

function toOriginal(normalized, start, end) {
  return { start: normalized.map[start], end: normalized.mapEnd[end - 1] };
}

export function findOccurrences(source, quote, mode = 'strict') {
  const a = normalizeWithMap(source, mode),
    q = normalizeWithMap(quote, mode).text;
  if (!q) return [];
  const result = [];
  for (let from = 0; ; ) {
    const index = a.text.indexOf(q, from);
    if (index < 0) break;
    result.push(toOriginal(a, index, index + q.length));
    from = index + 1;
  }
  return result;
}

/** Split [0,length) into segments; each segment lists every highlight covering it, so
 * overlapping relations are combined visually without dropping any of them. */
export function segmentHighlights(length, highlights) {
  const valid = highlights.filter(
    h => Number.isInteger(h.start) && Number.isInteger(h.end) && h.start >= 0 && h.end <= length && h.end > h.start,
  );
  const points = new Set([0, length]);
  for (const h of valid) {
    points.add(h.start);
    points.add(h.end);
  }
  const ordered = [...points].sort((a, b) => a - b),
    segments = [];
  for (let k = 0; k < ordered.length - 1; k++) {
    const start = ordered[k],
      end = ordered[k + 1];
    segments.push({ start, end, ids: valid.filter(h => h.start <= start && h.end >= end).map(h => h.id) });
  }
  return segments;
}
