(function (root) {
  'use strict';
  const clone = value => JSON.parse(JSON.stringify(value));
  const key = token => token.toLocaleLowerCase().replace(/[.,!?;:]+$/u, '');

  // Continuous native recognition already confirms each phrase at a natural
  // pause, without stopping. Stopping on a timer cut speakers mid-word and left
  // the microphone deaf while it restarted (about 1 s per stop), so a boundary is
  // requested only when unconfirmed speech stays pending longer than
  // maxPendingMs. stop() asks the browser for its final correction; onend is the
  // only restart point. This clock is separate from Cutter (audio laboratory).
  class CaptureWindow {
    constructor({ onBoundary, now = () => performance.now(), schedule = (fn, ms) => setTimeout(fn, ms), cancel = id => clearTimeout(id), maxPendingMs = 15000 } = {}) {
      if (typeof onBoundary !== 'function' || !(maxPendingMs >= 5000 && maxPendingMs <= 30000)) throw Error('Janela de captura inválida.');
      Object.assign(this, { onBoundary, now, schedule, cancel, maxPendingMs });
      this.timer = null; this.startedAt = null; this.pendingSince = null; this.requested = false; this.reason = null;
    }
    start() {
      this.end(); this.requested = false; this.reason = null; this.startedAt = this.now();
    }
    // pending: the recognizer currently shows unconfirmed (interim) speech.
    activity(pending) {
      if (this.startedAt === null || this.requested) return;
      if (!pending) { this.cancel(this.timer); this.timer = null; this.pendingSince = null; return; }
      if (this.timer !== null) return;
      this.pendingSince = this.now();
      this.timer = this.schedule(() => this.request('limit'), this.maxPendingMs);
    }
    request(reason = 'manual') {
      if (this.requested) return false;
      this.requested = true; this.reason = reason; this.cancel(this.timer); this.timer = null;
      this.onBoundary(reason); return true;
    }
    end() { this.cancel(this.timer); this.timer = null; this.startedAt = null; this.pendingSince = null; }
  }

  // Event-based word estimates. Final corrections inherit the old word's window.
  function alignWords(text, previous = [], firstMs, nowMs) {
    const words = [...text.matchAll(/\S+/gu)].map(match => ({ text: match[0], offset: match.index, atMs: nowMs }));
    if (!previous.length) return words.map(word => ({ ...word, atMs: firstMs }));
    let prefix = 0;
    while (prefix < Math.min(words.length, previous.length) && key(words[prefix].text) === key(previous[prefix].text)) {
      words[prefix].atMs = previous[prefix].atMs; prefix++;
    }
    let suffix = 0;
    while (suffix < Math.min(words.length, previous.length) - prefix && key(words.at(-1 - suffix).text) === key(previous.at(-1 - suffix).text)) {
      words[words.length - 1 - suffix].atMs = previous[previous.length - 1 - suffix].atMs; suffix++;
    }
    for (let i = prefix; i < words.length - suffix; i++) {
      if (i < previous.length - suffix) words[i].atMs = previous[i].atMs;
      else if (suffix) words[i].atMs = words[words.length - suffix].atMs;
    }
    return words;
  }

  class Cutter {
    constructor(saved = null) {
      this.windows = clone(saved?.windows || []);
      this.sequence = saved?.sequence || this.windows.length;
      this.takeId = saved?.takeId || 1;
      this.takeOffsetMs = saved?.takeOffsetMs || 0;
      this.active = null;
      this.speaking = false;
      this.silentSince = null;
      for (const window of this.windows) {
        if (window.endMs === null) { window.endMs = saved.lastMs; window.reason = 'reload'; }
      }
      this.lastMs = saved?.lastMs || 0;
    }
    open(atMs) {
      this.active = { id: `window-${++this.sequence}`, takeId: this.takeId, takeOffsetMs: this.takeOffsetMs, startMs: atMs, endMs: null, reason: null };
      this.windows.push(this.active);
      this.silentSince = null;
    }
    voice(speaking, atMs) {
      this.tick(atMs);
      this.speaking = speaking;
      if (speaking) {
        if (!this.active) this.open(atMs);
        this.silentSince = null;
      } else if (this.active && this.silentSince === null) this.silentSince = atMs;
    }
    ensure(atMs) {
      // Fallback when a browser does not report speech-start / audio levels.
      if (!this.active && !this.windows.some(w => (w.takeId || 1) === this.takeId && atMs >= w.startMs && atMs < w.endMs)) this.open(atMs);
    }
    close(atMs, reason) {
      if (!this.active) return;
      this.active.endMs = Math.max(this.active.startMs, atMs);
      this.active.reason = reason;
      this.active = null;
      this.silentSince = null;
    }
    tick(atMs) {
      this.lastMs = atMs;
      while (this.active) {
        const deadline = this.active.startMs + 15000;
        const pauseAt = this.silentSince === null ? Infinity : Math.max(this.active.startMs + 5000, this.silentSince + 650);
        if (pauseAt <= atMs && pauseAt <= deadline) { this.close(pauseAt, 'pause'); break; }
        if (deadline > atMs) break;
        this.close(deadline, 'limit');
        if (this.speaking) this.open(deadline);
      }
    }
    flush(atMs, reason = 'manual') {
      this.tick(atMs); this.close(atMs, reason); this.speaking = false;
    }
    view(records) {
      const packets = this.windows.map(window => ({ ...window, sources: [], text: '', status: 'confirmed', context: 'none' }));
      for (const record of records) {
        const words = record.wordMarks || [];
        let group = null;
        words.forEach((word, index) => {
          const sameTake = window => (window.takeId || 1) === (record.takeId || 1);
          const owner = packets.findIndex(window => sameTake(window) && word.atMs >= window.startMs && (window.endMs === null || word.atMs < window.endMs));
          // A final result delivered exactly at a manual stop belongs to that last window.
          let slot = owner >= 0 ? owner : packets.findLastIndex(window => sameTake(window) && word.atMs === window.endMs);
          // Delayed hypotheses can arrive in a VAD gap. Keep their source text, never drop it.
          if (slot < 0) slot = packets.findLastIndex(window => sameTake(window) && window.startMs <= word.atMs);
          if (slot < 0) slot = packets.findIndex(sameTake);
          if (slot < 0) { group = null; return; }
          const start = index ? word.offset : 0;
          const end = words[index + 1]?.offset ?? record.text.length;
          if (group?.slot === slot) { group.source.charEnd = end; group.source.text = record.text.slice(group.source.charStart, end); }
          else {
            const source = { sourceId: record.id, charStart: start, charEnd: end, text: record.text.slice(start, end), status: record.status };
            packets[slot].sources.push(source); group = { slot, source };
          }
        });
      }
      return packets.map(packet => {
        packet.text = packet.sources.map(source => source.text.trim()).filter(Boolean).join(' ');
        packet.status = packet.sources.every(source => source.status === 'final') ? 'confirmed' : 'provisional';
        packet.revision = JSON.stringify([packet.text, packet.status]);
        return packet;
      });
    }
    classificationView(records) {
      const byId = new Map(records.map(record => [record.id, record]));
      return this.view(records).map(packet => {
        const inputs = new Map();
        let contextTruncated = false;
        for (const source of packet.sources) {
          const record = byId.get(source.sourceId);
          if (!record) continue;
          // Restore only the unfinished sentence from THIS recognition result.
          // No preceding speaker turn, unrelated sentence or future suffix is included.
          let start = 0;
          for (const match of record.text.slice(0, source.charStart).matchAll(/[.!?…]["'”’)]*\s+/gu)) start = match.index + match[0].length;
          const prefix = record.text.slice(start, source.charStart);
          const words = [...prefix.matchAll(/\S+/gu)];
          const bounded = Math.max(start, source.charStart - 4000, words.length > 160 ? start + words[words.length - 160].index : start);
          if (bounded > start) {
            const boundary = record.text.indexOf(' ', bounded);
            start = boundary >= 0 && boundary < source.charStart ? boundary + 1 : source.charStart;
            contextTruncated = true;
          }
          const previous = inputs.get(record.id);
          const charStart = Math.min(start, previous?.charStart ?? start);
          const charEnd = Math.max(source.charEnd, previous?.charEnd ?? source.charEnd);
          inputs.set(record.id, { sourceId: record.id, charStart, charEnd, windowCharStart: Math.min(source.charStart, previous?.windowCharStart ?? source.charStart), text: record.text.slice(charStart, charEnd), status: record.status });
        }
        const inputSources = [...inputs.values()];
        const hasPrefix = inputSources.some(source => source.charStart < source.windowCharStart);
        const text = inputSources.map(source => source.text.trim()).filter(Boolean).join(' ');
        const inputStartMs = Math.min(packet.startMs, ...inputSources.map(source => {
          const record = byId.get(source.sourceId);
          return record.wordMarks?.find(word => word.offset >= source.charStart)?.atMs ?? record.startMs;
        }));
        return { ...packet, windowText: packet.text, text, inputSources, inputStartMs, context: hasPrefix ? 'same-utterance-prefix' : 'none', contextTruncated, revision: JSON.stringify([text, packet.status]) };
      });
    }
    snapshot() { return clone({ windows: this.windows, sequence: this.sequence, lastMs: this.lastMs, takeId: this.takeId, takeOffsetMs: this.takeOffsetMs }); }
  }
  root.NorteWindows = { Cutter, alignWords, CaptureWindow };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.NorteWindows;
})(globalThis);
