/* Alert highlights. Every sentence goes through the questions in prompts/jev/questions.js; a flagged sentence gets a
   second request that finds the exact fragment and the earlier statement that proves it.
   Findings have the shape of the requirement findings: offsets are UTF-16 positions inside the turn. */
(function (root) {
  const Q =
    typeof module !== 'undefined' && module.exports
      ? require('../../prompts/jev/questions.js')
      : root.NorteJevQuestions;
  const MODEL = 'jev-latest',
    THRESHOLD = 0.6,
    EVIDENCE_THRESHOLD = 0.4,
    EARLIER = 11,
    HISTORY = 4,
    MAX_FRAGMENTS = 10;
  const BREAKS = /[,;:]\s+|\s+(?=(?:mas|porém|porque|pois|enquanto|que|e|no|na|nos|nas|depois|antes)\s)/giu;
  const CONNECTOR = /^(?:mas|porém|porque|pois|enquanto|que|e|então)\s+/iu;
  const SENTENCE = /\S.*?(?:[.!?…]+(?=\s|$)|$)/gsu;

  const clock = ms =>
    Number.isFinite(ms)
      ? `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`
      : '';
  const fill = (text, values) =>
    Object.entries(values).reduce((out, [key, value]) => out.replaceAll(`{{${key}}}`, value), text);
  const said = sentence => ({
    speaker: sentence.speaker || '',
    time: clock(sentence.offsetMs),
    text: sentence.text,
    ...(sentence.meeting ? { meeting: sentence.meeting } : {}),
  });
  const words = text =>
    new Set((text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}.,-]*/gu) || []).filter(w => w.length > 3 || /\d/.test(w)));

  /** The decisions of earlier meetings that talk about the same thing as this sentence. */
  function relevantHistory(sentence, history) {
    const own = words(sentence.text);
    return history
      .map(item => ({ item, shared: [...words(item.text)].filter(word => own.has(word)).length }))
      .filter(row => row.shared >= 2)
      .sort((a, b) => b.shared - a.shared)
      .slice(0, HISTORY)
      .map(row => row.item);
  }

  /** What a sentence is compared with: related earlier meetings, then the latest sentences of this meeting. */
  function contextOf(list, index, history = []) {
    const past = relevantHistory(list[index], history);
    return [...past, ...list.slice(Math.max(0, index - (EARLIER - past.length)), index)];
  }

  function sentences(turns) {
    return turns.flatMap(turn =>
      [...turn.text.matchAll(SENTENCE)].map((match, position) => ({
        id: `${turn.key}#${position + 1}`,
        turnKey: turn.key,
        speaker: turn.speaker,
        offsetMs: turn.offsetMs,
        text: match[0],
        start: match.index,
        end: match.index + match[0].length,
      })),
    );
  }

  function fragments(sentence) {
    const cuts = [
      0,
      ...[...sentence.text.matchAll(BREAKS)].map(match => match.index + match[0].length),
      sentence.text.length,
    ];
    const pieces = cuts
      .slice(0, -1)
      .map((cut, index) => {
        const raw = sentence.text.slice(cut, cuts[index + 1]),
          lead = raw.match(CONNECTOR)?.[0].length || 0;
        const text = raw.slice(lead).replace(/[\s,;:]+$/u, '');
        return {
          id: `F${index + 1}`,
          text,
          start: sentence.start + cut + lead,
          end: sentence.start + cut + lead + text.length,
        };
      })
      .filter(piece => piece.text);
    return pieces.length > MAX_FRAGMENTS
      ? [{ id: 'F1', text: sentence.text, start: sentence.start, end: sentence.end }]
      : pieces;
  }

  const sentenceRequest = (sentence, earlier) => ({
    model: MODEL,
    state: { current_sentence: sentence.text, speaker: sentence.speaker || '', earlier_statements: earlier.map(said) },
    questions: Q.highlights,
  });

  function locateRequest(sentence, earlier, ruleId) {
    const problem = Q.highlightRules[ruleId].problem,
      pieces = fragments(sentence),
      questions = {};
    for (const piece of pieces) {
      const values = { problem, fragment_id: piece.id };
      questions[`fragment__${piece.id}`] = {
        type: 'noul',
        instructions: fill(Q.highlightFragment.instructions, values),
        criteria: {
          true: fill(Q.highlightFragment.criteria.true, values),
          false: fill(Q.highlightFragment.criteria.false, values),
        },
      };
    }
    if (earlier.length)
      questions.evidence = {
        type: 'choice',
        instructions: fill(Q.highlightEvidence.instructions, { problem }),
        criteria: {
          ...Object.fromEntries(earlier.map((item, index) => [`S${index + 1}`, item.text.slice(0, 780)])),
          none: Q.highlightEvidence.none,
        },
      };
    return {
      model: MODEL,
      state: {
        current_sentence: sentence.text,
        fragments: Object.fromEntries(pieces.map(piece => [piece.id, piece.text])),
        earlier_statements: earlier.map(said),
      },
      questions,
    };
  }

  // One alert per sentence, the strongest: several rules on the same words would only repeat the warning.
  const strongest = answers =>
    Object.keys(Q.highlights)
      .filter(id => answers[id]?.noul >= THRESHOLD)
      .sort((a, b) => answers[b].noul - answers[a].noul)[0];

  // The strongest fragment plus the neighbours that also carry the problem, so the mark stays one continuous span.
  function span(sentence, answers) {
    const pieces = fragments(sentence),
      score = piece => answers[`fragment__${piece.id}`]?.noul ?? 0;
    const best = pieces.reduce((top, piece, index) => (score(piece) > score(pieces[top]) ? index : top), 0);
    if (score(pieces[best]) < THRESHOLD) return { start: sentence.start, end: sentence.end };
    let first = best,
      last = best;
    while (first > 0 && score(pieces[first - 1]) >= THRESHOLD) first--;
    while (last < pieces.length - 1 && score(pieces[last + 1]) >= THRESHOLD) last++;
    return { start: pieces[first].start, end: pieces[last].end };
  }

  function proof(earlier, answers) {
    const answer = answers.evidence,
      position = /^S(\d+)$/u.exec(answer?.choice || '');
    if (!position || answer.confidence < EVIDENCE_THRESHOLD) return [];
    const item = earlier[Number(position[1]) - 1];
    return item
      ? [
          {
            sentenceId: item.id,
            turnKey: item.turnKey,
            speaker: item.speaker || '',
            time: clock(item.offsetMs),
            quote: item.text,
            ...(item.meeting ? { meeting: item.meeting } : {}),
          },
        ]
      : [];
  }

  function finding(sentence, earlier, ruleId, confidence, answers, referenceFor) {
    const rule = Q.highlightRules[ruleId],
      { start, end } = span(sentence, answers),
      context = [sentence, ...earlier].map(item => item.text).join('\n');
    return {
      id: `${sentence.id}:${ruleId}`,
      ruleId,
      severity: rule.severity,
      title: rule.title,
      explanation: rule.explanation,
      suggestion: rule.suggestion,
      reference: rule.reference ? referenceFor?.(context) || rule.reference : null,
      start,
      end,
      affectedText: sentence.text.slice(start - sentence.start, end - sentence.start),
      origin: 'jev',
      confidence,
      turnKey: sentence.turnKey,
      speaker: sentence.speaker || '',
      time: clock(sentence.offsetMs),
      offsetMs: sentence.offsetMs,
      evidence: proof(earlier, answers),
    };
  }

  /** One sentence: `send` is one JEV request. Returns the alert, if any, and what the provider answered. */
  async function review(sentence, earlier, send, referenceFor) {
    const output = await send(sentenceRequest(sentence, earlier)),
      answers = output.response.answers,
      ruleId = strongest(answers),
      step = {
        sentenceId: sentence.id,
        scores: Object.fromEntries(Object.keys(Q.highlights).map(id => [id, answers[id]?.noul ?? null])),
      };
    if (!ruleId) return { calls: 1, step, finding: null };
    const located = await send(locateRequest(sentence, earlier, ruleId));
    step.located = located.response.answers;
    return {
      calls: 2,
      step,
      finding: finding(sentence, earlier, ruleId, answers[ruleId].noul, located.response.answers, referenceFor),
    };
  }

  /** A whole transcript at once, after a person asks: every sentence costs one provider call. */
  async function analyze(turns, send, onProgress = () => {}, { history = [], referenceFor } = {}) {
    const list = sentences(turns),
      findings = [],
      trace = [];
    let calls = 0;
    for (const [index, sentence] of list.entries()) {
      onProgress({ done: index, total: list.length });
      const result = await review(sentence, contextOf(list, index, history), send, referenceFor);
      calls += result.calls;
      trace.push(result.step);
      if (result.finding) findings.push(result.finding);
    }
    onProgress({ done: list.length, total: list.length });
    return { version: Q.highlightVersion, sentences: list.length, calls, findings, trace };
  }

  /** Marks of one turn as text pieces. Overlapping findings stay together on the same piece. */
  function segments(text, findings) {
    const cuts = [...new Set([0, text.length, ...findings.flatMap(item => [item.start, item.end])])]
      .filter(cut => cut >= 0 && cut <= text.length)
      .sort((a, b) => a - b);
    return cuts
      .slice(0, -1)
      .map((start, index) => {
        const end = cuts[index + 1];
        return {
          text: text.slice(start, end),
          findings: findings.filter(item => item.start <= start && item.end >= end),
        };
      })
      .filter(piece => piece.text);
  }

  const api = { analyze, review, contextOf, relevantHistory, sentences, fragments, locateRequest, segments, THRESHOLD };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NorteMeetingHighlights = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
