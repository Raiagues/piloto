/* Lossless browser-recognition records. Temporal classification windows live in speech-windows.js. */
(function (root) {
  'use strict';

  const DEFAULTS = Object.freeze({ segmentWords: 60 });
  const clone = value => JSON.parse(JSON.stringify(value));

  // Offsets always refer to the untouched source text. A size cut is not a sentence end.
  function splitText(text, limit) {
    const ranges = [];
    const tokens = [...text.matchAll(/\S+/gu)];
    let start = 0;
    let count = 0;
    tokens.forEach((token, index) => {
      count++;
      const punctuation = /[.!?…]["'”’)]*$/u.test(token[0]);
      const last = index === tokens.length - 1;
      if (punctuation || count >= limit || last) {
        const end = last ? text.length : tokens[index + 1].index;
        ranges.push({ start, end, boundary: punctuation ? 'punctuation' : count >= limit && !last ? 'readability-limit' : 'recognizer-final' });
        start = end;
        count = 0;
      }
    });
    return ranges;
  }

  class Ledger {
    constructor(saved = null, options = {}) {
      this.options = { ...DEFAULTS, ...options };
      this.sessionId = saved?.sessionId || (root.crypto?.randomUUID?.() || `meeting-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      this.createdAt = saved?.createdAt || new Date().toISOString();
      this.records = clone(saved?.records || []);
      this.sequence = saved?.sequence || 0;
      this.runId = null;
      this.speechAt = null;
      this.revision = saved?.revision || 0;
      // A reload cannot confirm an outstanding recognition hypothesis.
      this.records.forEach(record => { if (record.status === 'interim') record.status = 'unconfirmed'; });
    }

    beginRun() {
      this.runId = `run-${++this.sequence}`;
      this.speechAt = null;
      return this.runId;
    }

    speechStart(atMs) { this.speechAt = atMs; }

    ingest(results, resultIndex, atMs, language) {
      if (!this.runId) this.beginRun();
      // Interim hypotheses can be removed from the result list as well as revised.
      this.records = this.records.filter(record => !(record.runId === this.runId && record.status === 'interim' && record.resultIndex >= results.length));
      for (let i = resultIndex; i < results.length; i++) {
        const result = results[i];
        const sourceId = `${this.runId}:${i}`;
        let record = this.records.find(item => item.id === sourceId);
        if (record?.status === 'final') continue; // Replayed final results never duplicate text.
        const text = result[0]?.transcript || '';
        if (!text.trim() && !record) continue;
        if (!record) {
          const previous = this.records.at(-1);
          record = {
            id: sourceId, runId: this.runId, resultIndex: i,
            startMs: Math.min(atMs, Math.max(previous?.endMs || 0, this.speechAt ?? atMs)),
            timing: this.speechAt === null ? 'first-result-event-estimate' : 'speech-event-estimate',
            speaker: 'Você', speakerId: 'local-microphone', language,
          };
          this.records.push(record);
          this.speechAt = null;
        }
        const windowTools = root.NorteWindows || (typeof require === 'function' ? require('./speech-windows.js') : null);
        if (windowTools) record.wordMarks = windowTools.alignWords(text, record.wordMarks, record.startMs, atMs);
        record.text = text;
        record.endMs = Math.max(record.startMs, atMs);
        record.status = result.isFinal ? 'final' : 'interim';
        record.confidence = Number.isFinite(result[0]?.confidence) ? result[0].confidence : null;
      }
      this.revision++;
    }

    finishRun() {
      this.records.forEach(record => {
        if (record.runId === this.runId && record.status === 'interim') record.status = 'unconfirmed';
      });
      this.speechAt = null;
      this.revision++;
    }

    segments() {
      return this.records.flatMap(record => splitText(record.text, this.options.segmentWords).map((range, i) => ({
        id: `${record.id}/s${i + 1}`, sourceId: record.id,
        text: record.text.slice(range.start, range.end), charStart: range.start, charEnd: range.end,
        startMs: record.startMs, endMs: record.endMs, timing: record.timing,
        // All slices of one recognition result share its estimated time range. No invented word timing.
        status: record.status, language: record.language, speaker: record.speaker, speakerId: record.speakerId,
        boundary: range.boundary, continuesFrom: i ? `${record.id}/s${i}` : null,
      })));
    }

    snapshot() {
      return clone({ schemaVersion: 1, sessionId: this.sessionId, createdAt: this.createdAt, sequence: this.sequence, revision: this.revision, records: this.records });
    }

    export() {
      return {
        ...this.snapshot(), segments: this.segments(),
        fullText: this.records.filter(record => record.status === 'final').map(record => record.text).join(' '),
      };
    }
  }

  root.NorteTranscript = { Ledger, splitText, DEFAULTS };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.NorteTranscript;
})(typeof globalThis !== 'undefined' ? globalThis : window);
