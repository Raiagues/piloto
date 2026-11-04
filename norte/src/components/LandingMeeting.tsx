import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import {
  Check,
  ChevronDown,
  FileText,
  LayoutGrid,
  Lock,
  Pause,
  Play,
  RotateCcw,
  Send,
  SkipForward,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { Language } from '../lib/types';
import { MEETING_SCRIPT, MEETING_TYPES, MINUTES_SECTIONS, TYPE_LABELS } from './landingMeetingScript';
import type { MeetingType } from './landingMeetingScript';

type Block = {
  id: string;
  ref: number;
  at: number;
  topic: number;
  note: string;
  type: MeetingType;
  original: MeetingType;
  relation?: string;
  state?: string;
  writing: boolean;
};
/** live: the line is still being revealed; speaking: and the example is playing. */
type Entry = {
  key: string;
  ref: number;
  speaker: string;
  time: string;
  text: string;
  tag?: string;
  live?: boolean;
  speaking?: boolean;
};
/** A personal note stays beside the line it was written after. */
type Note = { id: number; text: string; after: number };

const STAGE_MS = 420,
  GAP_MS = 650,
  LEAD_MS = 500;
const typingMs = (text: string) => Math.min(4200, Math.max(1400, text.length * 42));
const pad = (value: number) => String(value).padStart(2, '0');
const reducedMotion = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const synthesis = () => ('speechSynthesis' in window ? window.speechSynthesis : null);

const COPY = {
  pt: {
    region: 'Demonstração da sala de reunião',
    example: 'Exemplo ilustrativo',
    ready: 'Pronta',
    live: 'Ao vivo',
    paused: 'Pausada',
    finished: 'Concluída',
    listen: 'Ouvir reunião',
    pause: 'Pausar',
    resume: 'Continuar',
    again: 'Ouvir de novo',
    voiceOn: 'Ativar voz',
    voiceOff: 'Desativar voz',
    restart: 'Recomeçar',
    skip: 'Pular para a ata',
    transcript: 'Transcrição',
    lines: (n: number) => (n === 1 ? '1 fala' : `${n} falas`),
    emptyTranscript: 'A conversa aparece aqui, fala por fala.',
    view: 'Visualização',
    canvas: 'Canvas',
    minutes: 'Ata',
    topics: (n: number) => (n === 1 ? '1 assunto' : `${n} assuntos`),
    emptyBoard: 'Assuntos e notas aparecem aqui enquanto a reunião acontece.',
    untitled: (n: number) => `Assunto ${n}`,
    suggesting: 'sugerindo título…',
    writing: 'escrevendo nota…',
    filtered: 'Fora das notas · logística da reunião',
    typeMenu: 'Tipo do registro',
    corrected: 'corrigido',
    correctedNotice: 'Correção preservada, sem alterar a fala original.',
    locked: 'Durante a reunião, canvas e ata só acompanham a transcrição.',
    unlocked: 'Reunião encerrada: agora dá para corrigir os registros.',
    yourNote: 'Sua nota',
    noteInput: 'Nota pessoal',
    noteSend: 'Guardar nota',
    notePlaceholder: 'Nota pessoal para corrigir depois…',
    noteHint: 'Só você vê. A nota não entra na transcrição, no canvas, na ata nem no modelo.',
    notesLeft: (n: number) => (n === 1 ? '1 nota sua para revisar.' : `${n} notas suas para revisar.`),
    pipeline: 'Como o Norte processou a última fala',
    stages: ['Fala', 'Filtro', 'Classificação', 'Assunto e relações', 'Nota'],
    toNotes: 'Entra nas notas',
    transcriptOnly: 'Fica só na transcrição',
    newTopic: (n: string) => `Novo assunto ${n}`,
    sameTopic: (n: string) => `Assunto ${n}`,
    written: 'Escrita',
    done: 'Ata organizada por assunto, com a fala de origem de cada item.',
    seeMinutes: 'Ver ata',
    backToCanvas: 'Voltar ao canvas',
    minutesTitle: 'Ata da reunião',
    participants: 'Participantes',
    lineCount: 'Falas',
    outsideCount: 'Fora da ata',
    summary: 'Sumário',
    emptyMinutes: 'A ata se forma conforme as notas são escritas.',
    ref: (n: number) => `Ref. ${n}`,
    refLabel: (n: number) => `Mostrar a fala ${n} na transcrição`,
  },
  en: {
    region: 'Meeting room demo',
    example: 'Illustrative example',
    ready: 'Ready',
    live: 'Live',
    paused: 'Paused',
    finished: 'Finished',
    listen: 'Listen to meeting',
    pause: 'Pause',
    resume: 'Resume',
    again: 'Listen again',
    voiceOn: 'Turn on voice',
    voiceOff: 'Turn off voice',
    restart: 'Restart',
    skip: 'Skip to minutes',
    transcript: 'Transcript',
    lines: (n: number) => (n === 1 ? '1 line' : `${n} lines`),
    emptyTranscript: 'The conversation appears here, line by line.',
    view: 'View',
    canvas: 'Canvas',
    minutes: 'Minutes',
    topics: (n: number) => (n === 1 ? '1 topic' : `${n} topics`),
    emptyBoard: 'Topics and notes appear here while the meeting happens.',
    untitled: (n: number) => `Topic ${n}`,
    suggesting: 'suggesting a title…',
    writing: 'writing note…',
    filtered: 'Not in the notes · meeting logistics',
    typeMenu: 'Record type',
    corrected: 'corrected',
    correctedNotice: 'Correction kept, without changing the original words.',
    locked: 'During the meeting, canvas and minutes only follow the transcript.',
    unlocked: 'Meeting finished: records can now be corrected.',
    yourNote: 'Your note',
    noteInput: 'Personal note',
    noteSend: 'Save note',
    notePlaceholder: 'Personal note to fix later…',
    noteHint: 'Only you see it. The note stays out of the transcript, canvas, minutes and model.',
    notesLeft: (n: number) => (n === 1 ? '1 note of yours to review.' : `${n} notes of yours to review.`),
    pipeline: 'How Norte processed the latest line',
    stages: ['Speech', 'Filter', 'Classification', 'Topic and relations', 'Note'],
    toNotes: 'Goes to the notes',
    transcriptOnly: 'Transcript only',
    newTopic: (n: string) => `New topic ${n}`,
    sameTopic: (n: string) => `Topic ${n}`,
    written: 'Written',
    done: 'Minutes organized by topic, with the source line of every item.',
    seeMinutes: 'See minutes',
    backToCanvas: 'Back to canvas',
    minutesTitle: 'Meeting minutes',
    participants: 'Participants',
    lineCount: 'Lines',
    outsideCount: 'Outside the minutes',
    summary: 'Summary',
    emptyMinutes: 'The minutes take shape as notes are written.',
    ref: (n: number) => `Ref. ${n}`,
    refLabel: (n: number) => `Show line ${n} in the transcript`,
  },
};

/** Best voices of the page language. A natural voice next to a robotic fallback sounds worse than one voice at different pitches. */
function rankVoices(all: SpeechSynthesisVoice[], language: Language) {
  const preferred = language === 'pt' ? 'pt-br' : 'en-us';
  const score = (voice: SpeechSynthesisVoice) =>
    (voice.lang.toLowerCase().replace('_', '-') === preferred ? 4 : 0) +
    (/natural|neural|online|premium|enhanced|google/i.test(voice.name) ? 2 : 0) +
    (voice.localService ? 0 : 1);
  const ranked = all.filter(voice => voice.lang.toLowerCase().startsWith(language)).sort((a, b) => score(b) - score(a));
  return ranked.length ? ranked.filter(voice => score(voice) >= score(ranked[0]) - 1).slice(0, 4) : [];
}
function useVoices(language: Language) {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    const synth = synthesis();
    if (!synth) return;
    const load = () =>
      setVoices(old => {
        const next = rankVoices(synth.getVoices(), language);
        return next.map(voice => voice.voiceURI).join() === old.map(voice => voice.voiceURI).join() ? old : next;
      });
    load();
    synth.addEventListener?.('voiceschanged', load);
    return () => synth.removeEventListener?.('voiceschanged', load);
  }, [language]);
  return voices;
}
const Wave = () => (
  <span className="landing-wave" aria-hidden="true">
    <i />
    <i />
    <i />
    <i />
  </span>
);

/** Scripted, illustrative meeting. Nothing reaches the API and no model runs. */
export function LandingMeeting({ language, listenRequest }: { language: Language; listenRequest: number }) {
  const t = COPY[language],
    script = MEETING_SCRIPT[language],
    labels = TYPE_LABELS[language];
  const timeline = useMemo(() => {
    let at = LEAD_MS;
    return script.lines.map(line => {
      const start = at,
        spoken = start + typingMs(line.text);
      at = spoken + GAP_MS;
      return { start, spoken };
    });
  }, [script]);
  const total = timeline[timeline.length - 1].spoken + STAGE_MS * 4 + 400;
  const [clock, setClock] = useState(() => (reducedMotion() ? Number.MAX_SAFE_INTEGER : 0));
  const [playing, setPlaying] = useState(false),
    [sound, setSound] = useState(false),
    [view, setView] = useState<'canvas' | 'minutes'>('canvas');
  const [corrections, setCorrections] = useState<Record<number, MeetingType>>({});
  const [notes, setNotes] = useState<Note[]>([]),
    [draft, setDraft] = useState('');
  const [notice, setNotice] = useState(''),
    [highlight, setHighlight] = useState(0);
  const voices = useVoices(language);
  const root = useRef<HTMLElement>(null),
    transcriptRef = useRef<HTMLOListElement>(null),
    boardRef = useRef<HTMLDivElement>(null);
  const gate = useRef<number | null>(null),
    started = useRef(false),
    stick = useRef(true),
    noteCount = useRef(0);
  const now = Math.min(clock, total);
  const phase = playing ? 'playing' : now >= total ? 'done' : now > 0 ? 'paused' : 'idle';
  const speaking = timeline.findIndex(item => now >= item.start && now < item.spoken);
  const shown = timeline.filter(item => now >= item.start).length;
  const stageOf = (index: number) =>
    now < timeline[index].spoken ? -1 : Math.min(4, Math.floor((now - timeline[index].spoken) / STAGE_MS));
  const firstOfTopic = (topic: number) => script.lines.findIndex(line => line.topic === topic && line.type !== null);
  const topicTitle = (topic: number) => (stageOf(firstOfTopic(topic)) >= 4 ? script.topics[topic] : null);
  let latest = -1;
  timeline.forEach((item, index) => {
    if (now >= item.spoken) latest = index;
  });

  const blocks: Block[] = [];
  script.lines.forEach((line, index) => {
    const stage = stageOf(index);
    if (line.type === null || stage < 3) return;
    const type = corrections[index] ?? line.type;
    blocks.push({
      id: 's' + index,
      ref: index + 1,
      at: timeline[index].spoken,
      topic: line.topic ?? 0,
      note: line.note ?? line.text,
      type,
      original: line.type,
      relation: type === line.type ? line.relation : undefined,
      state: line.state,
      writing: stage < 4,
    });
  });
  blocks.sort((a, b) => a.at - b.at);
  const topics = [...new Set(blocks.map(block => block.topic))];

  const entries: Entry[] = script.lines.slice(0, shown).map((line, index) => {
    const live = index === speaking,
      words = line.text.split(' ');
    const text = live
      ? words
          .slice(
            0,
            Math.max(
              1,
              Math.ceil(
                (words.length * (now - timeline[index].start)) / (timeline[index].spoken - timeline[index].start),
              ),
            ),
          )
          .join(' ')
      : line.text;
    return {
      key: 's' + index,
      ref: index + 1,
      speaker: line.speaker,
      time: line.time,
      text,
      live,
      speaking: live && playing,
      tag: line.type === null && stageOf(index) >= 0 ? t.filtered : undefined,
    };
  });

  const written = blocks.filter(block => !block.writing);
  const minutes = topics
    .filter(topic => written.some(block => block.topic === topic))
    .map(topic => ({
      topic,
      title: topicTitle(topic) ?? t.untitled(topic + 1),
      sections: MINUTES_SECTIONS[language]
        .map(([title, types]) => ({
          title,
          items: written.filter(block => block.topic === topic && types.includes(block.type)),
        }))
        .filter(section => section.items.length),
    }));
  const participants = [...new Set(entries.map(entry => entry.speaker))];
  const outside = entries.filter(entry => entry.tag).length;

  const steps = t.stages.map((label, step) => {
    if (latest < 0) return { label, value: '', state: 'waiting' };
    const line = script.lines[latest],
      stage = stageOf(latest),
      filtered = line.type === null,
      topic = pad((line.topic ?? 0) + 1);
    const values = [
      `${line.speaker} · ${line.time}`,
      filtered ? t.transcriptOnly : t.toNotes,
      line.type ? labels[line.type] : '',
      (firstOfTopic(line.topic ?? 0) === latest ? t.newTopic(topic) : t.sameTopic(topic)) +
        (line.relation ? ` · ${line.relation}` : ''),
      t.written,
    ];
    if (filtered && step > 1) return { label, value: '—', state: 'skipped' };
    return step === 0 || stage >= step
      ? { label, value: values[step], state: 'done' }
      : { label, value: step === stage + 1 ? '…' : '', state: step === stage + 1 ? 'active' : 'waiting' };
  });
  const lastShown = shown ? script.lines[shown - 1].time : '00:00';
  const status =
    phase === 'playing'
      ? `${t.live} · ${lastShown}`
      : phase === 'paused'
        ? `${t.paused} · ${lastShown}`
        : phase === 'done'
          ? `${t.finished} · ${script.lines[script.lines.length - 1].time}`
          : t.ready;

  // The clock waits just before the end of a spoken line until the voice finishes it.
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    const timer = window.setInterval(() => {
      const at = performance.now(),
        step = Math.min(at - last, 200);
      last = at;
      setClock(value => Math.min(total, Math.max(value, Math.min(value + step, (gate.current ?? Infinity) - 1))));
    }, 50);
    return () => window.clearInterval(timer);
  }, [playing, total]);
  useEffect(() => {
    if (playing && clock >= total) setPlaying(false);
  }, [playing, clock, total]);

  useEffect(() => {
    const synth = synthesis();
    if (!playing || !sound || !synth || !voices.length || speaking < 0) return;
    const line = script.lines[speaking],
      speakers = [...new Set(script.lines.map(item => item.speaker))],
      who = speakers.indexOf(line.speaker);
    const utterance = new SpeechSynthesisUtterance(line.text);
    utterance.lang = language === 'pt' ? 'pt-BR' : 'en-US';
    utterance.voice = voices[who % voices.length];
    utterance.pitch = [1, 0.86, 1.14, 0.94][who % 4];
    utterance.rate = 1.04;
    const release = () => {
      gate.current = null;
    };
    utterance.onend = release;
    utterance.onerror = release;
    gate.current = timeline[speaking].spoken;
    // Chrome can drop a phrase spoken right after cancel(), and may never end one it lost.
    const begin = window.setTimeout(() => synth.speak(utterance), 40),
      fallback = window.setTimeout(release, typingMs(line.text) * 2 + 4000);
    return () => {
      window.clearTimeout(begin);
      window.clearTimeout(fallback);
      utterance.onend = utterance.onerror = null;
      release();
      synth.cancel();
    };
  }, [playing, sound, speaking, voices, script, timeline, language]);

  useEffect(() => {
    const node = root.current;
    if (!node || reducedMotion() || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      items => {
        if (items.some(item => item.isIntersecting) && !started.current) {
          started.current = true;
          setPlaying(true);
        }
      },
      { threshold: 0.2 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!listenRequest) return;
    root.current?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'center' });
    restart(true);
  }, [listenRequest]);
  useEffect(
    () => () => {
      synthesis()?.cancel();
    },
    [],
  );
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 6000);
    return () => window.clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (!highlight) return;
    const timer = window.setTimeout(() => setHighlight(0), 2400);
    return () => window.clearTimeout(timer);
  }, [highlight]);

  const tail = `${entries.length}:${entries[entries.length - 1]?.text.length ?? 0}:${notes.length}`;
  useEffect(() => {
    const list = transcriptRef.current;
    if (list && stick.current) list.scrollTop = list.scrollHeight;
  }, [tail]);
  const newest = blocks[blocks.length - 1]?.id;
  useEffect(() => {
    // Follows the meeting while it plays; a finished room opens at its first topic.
    const board = boardRef.current,
      item = newest && board?.querySelector<HTMLElement>(`[data-block="${newest}"]`);
    if (!board || !item || !playing) return;
    const area = board.getBoundingClientRect(),
      box = item.getBoundingClientRect();
    if (box.bottom > area.bottom) board.scrollBy({ top: box.bottom - area.bottom + 16, behavior: 'smooth' });
    else if (box.top < area.top) board.scrollBy({ top: box.top - area.top - 16, behavior: 'smooth' });
  }, [newest]);

  const lineStart = (value: number) => {
    const index = timeline.findIndex(item => value >= item.start && value < item.spoken);
    return index < 0 ? value : timeline[index].start;
  };
  // Voices may load after the click; the speech effect starts as soon as they arrive.
  function play(withVoice: boolean) {
    started.current = true;
    if (withVoice) setSound(true);
    setClock(value => (value >= total ? 0 : lineStart(value)));
    setPlaying(true);
  }
  function restart(withVoice = sound) {
    started.current = true;
    setCorrections({});
    setNotes([]);
    setView('canvas');
    setSound(withVoice);
    setClock(0);
    setPlaying(true);
    stick.current = true;
  }
  function skip() {
    started.current = true;
    setPlaying(false);
    setClock(total);
    setView('minutes');
  }
  function toggleVoice() {
    const next = !sound;
    setSound(next);
    if (next && playing) setClock(lineStart);
  }
  // A note leaves the meeting running and the example unchanged.
  function addNote(event: FormEvent) {
    event.preventDefault();
    const text = draft.replace(/\s+/g, ' ').trim().slice(0, 280);
    if (!text) return;
    stick.current = true;
    setDraft('');
    setNotes(list => [...list, { id: ++noteCount.current, text, after: shown }]);
  }
  function correct(block: Block, value: MeetingType) {
    const index = Number(block.id.slice(1));
    setCorrections(map => {
      const next = { ...map };
      if (value === block.original) delete next[index];
      else next[index] = value;
      return next;
    });
    setNotice(t.correctedNotice);
  }
  function showRef(ref: number) {
    const list = transcriptRef.current,
      item = list?.querySelector<HTMLElement>(`[data-ref="${ref}"]`);
    setHighlight(ref);
    if (list && item) {
      stick.current = false;
      list.scrollTo({ top: item.offsetTop - 12, behavior: 'smooth' });
    }
  }

  const canvas = topics.length ? (
    topics.map(topic => {
      const title = topicTitle(topic);
      return (
        <section className="landing-topic" key={topic}>
          <header>
            <span>{pad(topic + 1)}</span>
            {title ? (
              <h4>{title}</h4>
            ) : (
              <h4 className="is-pending">
                {t.untitled(topic + 1)} <small>{t.suggesting}</small>
              </h4>
            )}
          </header>
          <div className="landing-topic-blocks">
            {blocks
              .filter(block => block.topic === topic)
              .map(block => (
                <article
                  key={block.id}
                  data-block={block.id}
                  data-type={block.type}
                  className={`landing-block${block.writing ? ' is-writing' : ''}`}
                >
                  <header>
                    {/* Corrections open only after the meeting. The chip shows the type; a transparent native select over it keeps keyboard and screen reader use. */}
                    {phase === 'done' ? (
                      <label className="landing-block-type">
                        <span aria-hidden="true">{labels[block.type]}</span>
                        <ChevronDown size={11} aria-hidden="true" />
                        <select
                          aria-label={t.typeMenu}
                          value={block.type}
                          onChange={event => correct(block, event.target.value as MeetingType)}
                        >
                          {MEETING_TYPES.map(type => (
                            <option key={type} value={type}>
                              {labels[type]}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : (
                      <span className="landing-block-type">{labels[block.type]}</span>
                    )}
                    <span className="landing-block-state">
                      {block.type !== block.original ? t.corrected : block.state}
                    </span>
                  </header>
                  <p>{block.writing ? <span className="landing-writing">{t.writing}</span> : block.note}</p>
                  {block.relation && !block.writing && (
                    <small className="landing-block-relation">↳ {block.relation}</small>
                  )}
                </article>
              ))}
          </div>
        </section>
      );
    })
  ) : (
    <p className="landing-empty">{t.emptyBoard}</p>
  );

  const minutesView = (
    <article className="landing-minutes">
      <small>{t.minutesTitle}</small>
      <h4>{script.title}</h4>
      <dl>
        <div>
          <dt>{t.participants}</dt>
          <dd>{participants.join(', ') || '—'}</dd>
        </div>
        <div>
          <dt>{t.lineCount}</dt>
          <dd>{entries.length}</dd>
        </div>
        <div>
          <dt>{t.outsideCount}</dt>
          <dd>{outside}</dd>
        </div>
      </dl>
      {minutes.length ? (
        <>
          <nav aria-label={t.summary}>
            <strong>{t.summary}</strong>
            <ol>
              {minutes.map(item => (
                <li key={item.topic}>{item.title}</li>
              ))}
            </ol>
          </nav>
          {minutes.map((item, index) => (
            <section key={item.topic}>
              <h5>
                {index + 1}. {item.title}
              </h5>
              {item.sections.map(section => (
                <div key={section.title}>
                  <h6>{section.title}</h6>
                  <ul>
                    {section.items.map(block => (
                      <li key={block.id}>
                        {block.note}
                        {block.type !== block.original && <em>{t.corrected}</em>}
                        <button
                          type="button"
                          className="landing-ref"
                          aria-label={t.refLabel(block.ref)}
                          onClick={() => showRef(block.ref)}
                        >
                          {t.ref(block.ref)}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          ))}
        </>
      ) : (
        <p className="landing-empty">{t.emptyMinutes}</p>
      )}
    </article>
  );

  const noteCard = (note: Note) => (
    <aside key={note.id} className="landing-note">
      <small>{t.yourNote}</small>
      <p>{note.text}</p>
    </aside>
  );
  return (
    <section ref={root} className="landing-meeting" data-phase={phase} aria-label={t.region}>
      <header className="landing-meeting-header">
        <div className="landing-meeting-title">
          <h3>{script.title}</h3>
          <p>
            <span className="landing-meeting-status">
              <i aria-hidden="true" />
              {status}
            </span>
            <span>{t.example}</span>
          </p>
        </div>
        <div className="landing-meeting-controls">
          {phase === 'playing' && (
            <button type="button" className="landing-text-button" title={t.skip} onClick={skip}>
              <SkipForward size={15} />
              {t.skip}
            </button>
          )}
          {voices.length > 0 && (
            <button
              type="button"
              className={`landing-voice${sound ? ' is-on' : ''}`}
              title={sound ? t.voiceOff : t.voiceOn}
              onClick={toggleVoice}
            >
              {sound ? <Volume2 size={16} /> : <VolumeX size={16} />}
              <span className={sound ? 'sr-only' : undefined}>{sound ? t.voiceOff : t.voiceOn}</span>
            </button>
          )}
          {phase !== 'idle' && (
            <button
              type="button"
              className="landing-icon-button"
              aria-label={t.restart}
              title={t.restart}
              onClick={() => restart()}
            >
              <RotateCcw size={16} />
            </button>
          )}
          <button
            type="button"
            className="landing-meeting-play"
            onClick={() =>
              phase === 'playing' ? setPlaying(false) : phase === 'done' ? restart(true) : play(phase === 'idle')
            }
          >
            <span aria-hidden="true">{phase === 'playing' ? <Pause size={14} /> : <Play size={14} />}</span>
            {phase === 'playing' ? t.pause : phase === 'paused' ? t.resume : phase === 'done' ? t.again : t.listen}
          </button>
        </div>
      </header>
      <div className="landing-meeting-body">
        <div className="landing-transcript">
          <div className="landing-pane-heading">
            <strong>{t.transcript}</strong>
            <span>{t.lines(entries.length)}</span>
          </div>
          <ol
            ref={transcriptRef}
            className="landing-transcript-list"
            onScroll={event => {
              const list = event.currentTarget;
              stick.current = list.scrollHeight - list.scrollTop - list.clientHeight < 60;
            }}
          >
            {!entries.length && !notes.length && <li className="landing-empty">{t.emptyTranscript}</li>}
            {notes.some(note => !note.after) && (
              <li className="landing-line-group">{notes.filter(note => !note.after).map(noteCard)}</li>
            )}
            {entries.map(entry => (
              <li key={entry.key} data-ref={entry.ref} className="landing-line-group">
                <div
                  className={`landing-line${entry.live ? ' is-live' : ''}${entry.tag ? ' is-filtered' : ''}${highlight === entry.ref ? ' is-referenced' : ''}`}
                >
                  <time>{entry.time}</time>
                  <strong>
                    {entry.speaker}
                    {entry.speaking && <Wave />}
                  </strong>
                  <p>
                    {entry.text}
                    {entry.live && <span className="landing-caret" aria-hidden="true" />}
                  </p>
                  {entry.tag && <em>{entry.tag}</em>}
                </div>
                {notes.filter(note => note.after === entry.ref).map(noteCard)}
              </li>
            ))}
          </ol>
          <form className="landing-composer" onSubmit={addNote}>
            <input
              value={draft}
              onChange={event => setDraft(event.target.value)}
              placeholder={t.notePlaceholder}
              aria-label={t.noteInput}
              maxLength={280}
            />
            <button
              type="submit"
              className="landing-send"
              aria-label={t.noteSend}
              title={t.noteSend}
              disabled={!draft.trim()}
            >
              <Send size={15} />
            </button>
          </form>
          <p className="landing-privacy">{t.noteHint}</p>
        </div>
        <div className="landing-board">
          <div className="landing-pane-heading">
            <div className="landing-view-toggle" role="group" aria-label={t.view}>
              <button type="button" aria-pressed={view === 'canvas'} onClick={() => setView('canvas')}>
                <LayoutGrid size={14} />
                {t.canvas}
              </button>
              <button type="button" aria-pressed={view === 'minutes'} onClick={() => setView('minutes')}>
                <FileText size={14} />
                {t.minutes}
                {phase === 'done' && view === 'canvas' && <i className="landing-ready-dot" aria-hidden="true" />}
              </button>
            </div>
            <span className="landing-lock">
              {phase !== 'done' && <Lock size={12} aria-hidden="true" />}
              {phase === 'done' ? t.unlocked : t.locked}
            </span>
          </div>
          <div ref={boardRef} className="landing-board-view">
            {view === 'canvas' ? canvas : minutesView}
          </div>
        </div>
      </div>
      <p className="sr-only" aria-live="polite">
        {notice}
      </p>
      {/* The footer is the room's status line: a notice, the finished minutes, or the steps of the latest line. */}
      <footer className="landing-meeting-footer">
        {notice || phase === 'done' ? (
          <div className={`landing-meeting-done${notice ? ' is-notice' : ''}`}>
            <span>
              <Check size={16} aria-hidden="true" />
              {notice || (notes.length ? `${t.done} ${t.notesLeft(notes.length)}` : t.done)}
            </span>
            {phase === 'done' && (
              <button type="button" onClick={() => setView(view === 'minutes' ? 'canvas' : 'minutes')}>
                {view === 'minutes' ? t.backToCanvas : t.seeMinutes}
              </button>
            )}
          </div>
        ) : (
          <ol className="landing-pipeline" aria-label={t.pipeline}>
            {steps.map((step, index) => (
              <li key={step.label} data-state={step.state}>
                <span className="landing-step-dot">
                  {step.state === 'done' ? <Check size={12} aria-hidden="true" /> : index + 1}
                </span>
                <span className="landing-step-text">
                  <strong>{step.label}</strong>
                  <small>{step.value}</small>
                </span>
              </li>
            ))}
          </ol>
        )}
      </footer>
    </section>
  );
}
