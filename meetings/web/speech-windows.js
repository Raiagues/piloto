/* Capture windows of the microphone: aligns what the browser recognised with the words already recorded. */
(function (root) {
  'use strict';
  const key = token => token.toLocaleLowerCase().replace(/[.,!?;:]+$/u, '');

  // Continuous native recognition already confirms each phrase at a natural
  // pause, without stopping. Stopping on a timer cut speakers mid-word and left
  // the microphone deaf while it restarted (about 1 s per stop), so a boundary is
  // requested only when unconfirmed speech stays pending longer than
  // maxPendingMs. stop() asks the browser for its final correction; onend is the
  // only restart point.
  class CaptureWindow {
    constructor({
      onBoundary,
      now = () => performance.now(),
      schedule = (fn, ms) => setTimeout(fn, ms),
      cancel = id => clearTimeout(id),
      maxPendingMs = 15000,
    } = {}) {
      if (typeof onBoundary !== 'function' || !(maxPendingMs >= 5000 && maxPendingMs <= 30000))
        throw Error('Janela de captura inválida.');
      Object.assign(this, { onBoundary, now, schedule, cancel, maxPendingMs });
      this.timer = null;
      this.startedAt = null;
      this.pendingSince = null;
      this.requested = false;
      this.reason = null;
    }
    start() {
      this.end();
      this.requested = false;
      this.reason = null;
      this.startedAt = this.now();
    }
    // pending: the recognizer currently shows unconfirmed (interim) speech.
    activity(pending) {
      if (this.startedAt === null || this.requested) return;
      if (!pending) {
        this.cancel(this.timer);
        this.timer = null;
        this.pendingSince = null;
        return;
      }
      if (this.timer !== null) return;
      this.pendingSince = this.now();
      this.timer = this.schedule(() => this.request('limit'), this.maxPendingMs);
    }
    request(reason = 'manual') {
      if (this.requested) return false;
      this.requested = true;
      this.reason = reason;
      this.cancel(this.timer);
      this.timer = null;
      this.onBoundary(reason);
      return true;
    }
    end() {
      this.cancel(this.timer);
      this.timer = null;
      this.startedAt = null;
      this.pendingSince = null;
    }
  }

  // Event-based word estimates. Final corrections inherit the old word's window.
  function alignWords(text, previous = [], firstMs, nowMs) {
    const words = [...text.matchAll(/\S+/gu)].map(match => ({ text: match[0], offset: match.index, atMs: nowMs }));
    if (!previous.length) return words.map(word => ({ ...word, atMs: firstMs }));
    let prefix = 0;
    while (prefix < Math.min(words.length, previous.length) && key(words[prefix].text) === key(previous[prefix].text)) {
      words[prefix].atMs = previous[prefix].atMs;
      prefix++;
    }
    let suffix = 0;
    while (
      suffix < Math.min(words.length, previous.length) - prefix &&
      key(words.at(-1 - suffix).text) === key(previous.at(-1 - suffix).text)
    ) {
      words[words.length - 1 - suffix].atMs = previous[previous.length - 1 - suffix].atMs;
      suffix++;
    }
    for (let i = prefix; i < words.length - suffix; i++) {
      if (i < previous.length - suffix) words[i].atMs = previous[i].atMs;
      else if (suffix) words[i].atMs = words[words.length - suffix].atMs;
    }
    return words;
  }
  root.NorteWindows = { alignWords, CaptureWindow };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.NorteWindows;
})(globalThis);
