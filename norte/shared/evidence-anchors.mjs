/** Evidence anchoring shared by the server and the browser.
 *
 * Offsets are UTF-16 code units (JavaScript string indices), start inclusive,
 * end exclusive. Normalization never replaces the original text: it returns a
 * map from every normalized character back to its original offset, so a match
 * found in normalized text is always reported against the literal source.
 */
const ZERO_WIDTH = new Set(['​', '‌', '‍', '⁠', '﻿', '­']);
const DASHES = /[‐‑‒–—−]/u;
const QUOTES = { '‘': "'", '’': "'", '‚': "'", '‛': "'", '“': '"', '”': '"', '„': '"', '«': '"', '»': '"', '′': "'", '″': '"' };

/** strict: whitespace/zero-width/hyphenation/quote-style only. loose: also case and diacritics (OCR linking only). */
export function normalizeWithMap(text, mode = 'strict') {
  const out = [], map = [], mapEnd = [];
  let pendingSpace = false;
  for (let i = 0; i < text.length;) {
    const code = text.codePointAt(i), ch = String.fromCodePoint(code), width = ch.length;
    if (ZERO_WIDTH.has(ch)) { i += width; continue; }
    // End-of-line hyphenation: "propu-\nlsão" -> "propulsão" (only between letters).
    if (ch === '-' && text[i + 1] === '\n' && out.length && /\p{L}/u.test(out[out.length - 1]) && /\p{L}/u.test(text[i + 2] || '')) { i += 2; continue; }
    if (/\s/u.test(ch)) { pendingSpace = out.length > 0; i += width; continue; }
    let value = QUOTES[ch] || (DASHES.test(ch) ? '-' : ch);
    if (mode === 'loose') value = value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR');
    else value = value.normalize('NFC');
    if (pendingSpace) { out.push(' '); map.push(i); mapEnd.push(i); pendingSpace = false; }
    // One entry per UTF-16 unit so indices in the joined string align with the maps.
    for (let k = 0; k < value.length; k++) { out.push(value[k]); map.push(i); mapEnd.push(i + width); }
    i += width;
  }
  return { text: out.join(''), map, mapEnd, length: text.length };
}

function toOriginal(normalized, start, end) {
  return { start: normalized.map[start], end: normalized.mapEnd[end - 1] };
}

export function findOccurrences(source, quote, mode = 'strict') {
  const a = normalizeWithMap(source, mode), q = normalizeWithMap(quote, mode).text;
  if (!q) return [];
  const result = [];
  for (let from = 0; ;) {
    const index = a.text.indexOf(q, from);
    if (index < 0) break;
    result.push(toOriginal(a, index, index + q.length));
    from = index + 1;
  }
  return result;
}

/** Resolve a quoted excerpt against candidate blocks. Never picks the first of several
 * occurrences silently: ambiguity is returned for review unless context disambiguates. */
export function resolveQuote(blocks, quote, { blockIds = null, contextBefore = '', contextAfter = '', mode = 'strict' } = {}) {
  const pool = blockIds?.length ? blocks.filter(b => blockIds.includes(b.id)) : blocks;
  const hits = [];
  for (const block of pool) for (const occurrence of findOccurrences(block.text, quote, mode)) hits.push({ blockId: block.id, page: block.page, ...occurrence });
  if (hits.length === 1) return { status: 'resolved', ...hits[0], candidates: hits };
  if (!hits.length) return { status: 'not_found', candidates: [] };
  const scored = hits.map(hit => {
    const text = pool.find(b => b.id === hit.blockId).text;
    const before = normalizeWithMap(text.slice(Math.max(0, hit.start - 120), hit.start), mode).text;
    const after = normalizeWithMap(text.slice(hit.end, hit.end + 120), mode).text;
    const cb = normalizeWithMap(contextBefore, mode).text, ca = normalizeWithMap(contextAfter, mode).text;
    const score = (cb && before.endsWith(cb) ? 2 : cb && before.includes(cb) ? 1 : 0) + (ca && after.startsWith(ca) ? 2 : ca && after.includes(ca) ? 1 : 0);
    return { ...hit, score };
  });
  const best = Math.max(...scored.map(s => s.score));
  const top = scored.filter(s => s.score === best);
  if (best > 0 && top.length === 1) return { status: 'resolved', ...top[0], candidates: hits, disambiguatedBy: 'context' };
  return { status: 'ambiguous', candidates: hits };
}

/** Word spans of a block that intersect [start, end), grouped by visual line. */
export function rectsForSpan(block, page, start, end) {
  const words = new Map(page.words.map(w => [w.i, w]));
  const touched = block.words.filter(span => span.end > start && span.start < end);
  const rects = [];
  for (const line of block.lines) {
    const inLine = touched.filter(span => line.wordIds.includes(span.i));
    if (!inLine.length) continue;
    let x0 = Infinity, x1 = -Infinity, top = Infinity, bottom = -Infinity;
    for (const span of inLine) {
      const word = words.get(span.i); if (!word) continue;
      const n = word.norm, len = Math.max(1, span.end - span.start);
      // Proportional sub-word clipping when a quote starts/ends inside a token.
      const a = Math.max(0, start - span.start) / len, b = Math.min(len, end - span.start) / len;
      x0 = Math.min(x0, n.x0 + (n.x1 - n.x0) * a); x1 = Math.max(x1, n.x0 + (n.x1 - n.x0) * b);
      top = Math.min(top, n.top); bottom = Math.max(bottom, n.bottom);
    }
    if (Number.isFinite(x0)) rects.push({ x0: round(x0), top: round(top), x1: round(x1), bottom: round(bottom) });
  }
  return { rects, wordIds: touched.map(s => s.i) };
}
const round = value => Math.round(value * 100000) / 100000;

/** Split [0,length) into segments; each segment lists every highlight covering it, so
 * overlapping relations are combined visually without dropping any of them. */
export function segmentHighlights(length, highlights) {
  const valid = highlights.filter(h => Number.isInteger(h.start) && Number.isInteger(h.end) && h.start >= 0 && h.end <= length && h.end > h.start);
  const points = new Set([0, length]);
  for (const h of valid) { points.add(h.start); points.add(h.end); }
  const ordered = [...points].sort((a, b) => a - b), segments = [];
  for (let k = 0; k < ordered.length - 1; k++) {
    const start = ordered[k], end = ordered[k + 1];
    segments.push({ start, end, ids: valid.filter(h => h.start <= start && h.end >= end).map(h => h.id) });
  }
  return segments;
}

/** Numbers keep their literal spelling, unit and operator; the normalized value is separate.
 * Nothing is filled with zero: a quantity without a recognizable operator keeps operator=null. */
const TAIL = String.raw`\s*(?:(?:a|an|um|uma|de|of)\s+)?$`;
const OPERATORS = [
  ['>=', new RegExp(String.raw`(superior\s+ou\s+igual\s+a|igual\s+ou\s+superior\s+a|maior\s+ou\s+igual\s+a|pelo\s+menos|no\s+m[ií]nimo|at\s+least|equal\s+to\s+or\s+greater\s+than|not\s+less\s+than|≥|>=)` + TAIL, 'iu')],
  ['<=', new RegExp(String.raw`(inferior\s+ou\s+igual\s+a|igual\s+ou\s+inferior\s+a|menor\s+ou\s+igual\s+a|at[ée]|no\s+m[aá]ximo|at\s+most|equal\s+to\s+or\s+less\s+than|not\s+greater\s+than|≤|<=)` + TAIL, 'iu')],
  ['>', new RegExp(String.raw`(superior\s+a|maior\s+(?:do\s+)?que|more\s+than|greater\s+than|exceeding|acima\s+de|>)` + TAIL, 'iu')],
  ['<', new RegExp(String.raw`(inferior\s+a|menor\s+(?:do\s+)?que|less\s+than|below|abaixo\s+de|<)` + TAIL, 'iu')]
];
const UNIT = '(kg|g|t|km|m|cm|mm|µm|um|ms|s|min|h|kN|Ns|N|kPa|MPa|Pa|K|°C|%|kW|W|V|A|kHz|MHz|GHz|Hz|mesh)';
export function extractQuantities(text) {
  const result = [], pattern = new RegExp(String.raw`(?<![\p{L}\d])(\d+(?:[.,]\d+)*)\s*` + UNIT + String.raw`(?![\p{L}\d])`, 'gu');
  for (const match of text.matchAll(pattern)) {
    const before = text.slice(Math.max(0, match.index - 60), match.index);
    let operator = null, operatorText = null;
    for (const [op, regex] of OPERATORS) { const found = regex.exec(before); if (found) { operator = op; operatorText = found[1]; break; } }
    const raw = match[1], value = Number(/,\d{1,2}$/u.test(raw) ? raw.replace(/\./gu, '').replace(',', '.') : raw.replace(/,/gu, ''));
    const operatorStart = operatorText ? match.index - (before.length - before.toLowerCase().lastIndexOf(operatorText.toLowerCase())) : null;
    result.push({ literal: match[0], start: match.index, end: match.index + match[0].length, unit: match[2], operator, operatorText,
      conditionLiteral: operatorText ? text.slice(operatorStart, match.index + match[0].length) : null, conditionStart: operatorStart,
      normalized: Number.isFinite(value) ? { value, unit: match[2] } : null });
  }
  return result;
}
