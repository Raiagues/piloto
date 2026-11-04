import type { Language } from '../lib/types';

/** The event types of the meeting room classifier, in the room's order. */
export const MEETING_TYPES = [
  'observation',
  'hypothesis',
  'test_proposal',
  'test_result',
  'decision',
  'requirement',
  'other',
] as const;
export type MeetingType = (typeof MEETING_TYPES)[number];

export type ScriptLine = {
  speaker: string;
  time: string;
  text: string;
  /** null: meeting logistics, kept only in the transcript. */
  type: MeetingType | null;
  topic?: number;
  note?: string;
  relation?: string;
  state?: string;
};

/** Labels as the room shows them on canvas blocks. */
export const TYPE_LABELS: Record<Language, Record<MeetingType, string>> = {
  pt: {
    observation: 'Problema',
    hypothesis: 'Hipótese',
    test_proposal: 'Teste proposto',
    test_result: 'Resultado de teste',
    decision: 'Decisão',
    requirement: 'Requisito',
    other: 'Tarefa ou outro ponto',
  },
  en: {
    observation: 'Problem',
    hypothesis: 'Hypothesis',
    test_proposal: 'Proposed test',
    test_result: 'Test result',
    decision: 'Decision',
    requirement: 'Requirement',
    other: 'Task or other point',
  },
};

/** Minutes sections, following the room's minutes order. */
export const MINUTES_SECTIONS: Record<Language, [string, MeetingType[]][]> = {
  pt: [
    ['Observações', ['observation']],
    ['Hipóteses em investigação', ['hypothesis']],
    ['Decisões registradas', ['decision']],
    ['Requisitos e critérios', ['requirement']],
    ['Testes e resultados', ['test_result']],
    ['Pendências e próximos passos', ['test_proposal', 'other']],
  ],
  en: [
    ['Observations', ['observation']],
    ['Hypotheses under investigation', ['hypothesis']],
    ['Recorded decisions', ['decision']],
    ['Requirements and criteria', ['requirement']],
    ['Tests and results', ['test_result']],
    ['Follow-ups and open items', ['test_proposal', 'other']],
  ],
};

/** Illustrative meeting with roles instead of people. It is not taken from any project. */
export const MEETING_SCRIPT: Record<Language, { title: string; topics: string[]; lines: ScriptLine[] }> = {
  pt: {
    title: 'Revisão do ensaio de vibração',
    topics: ['Deformação do suporte da antena', 'Prazo do conector'],
    lines: [
      {
        speaker: 'Coordenação',
        time: '00:04',
        text: 'Bom dia, pessoal. Vou compartilhar a tela com o relatório do ensaio.',
        type: null,
      },
      {
        speaker: 'Estruturas',
        time: '00:12',
        text: 'No ensaio de vibração, o suporte da antena deformou mais do que o previsto.',
        type: 'observation',
        topic: 0,
        note: 'O suporte da antena deformou acima do previsto no ensaio de vibração.',
        state: 'Em aberto',
      },
      {
        speaker: 'Ensaios',
        time: '00:21',
        text: 'Pode ser ressonância. O pico do ensaio fica perto de 80 hertz.',
        type: 'hypothesis',
        topic: 0,
        note: 'Possível ressonância perto de 80 Hz, no pico do ensaio.',
        relation: 'aborda o problema',
        state: 'Em aberto',
      },
      {
        speaker: 'Estruturas',
        time: '00:30',
        text: 'Proponho repetir o ensaio com o suporte reforçado e acelerômetros nos dois lados.',
        type: 'test_proposal',
        topic: 0,
        note: 'Repetir o ensaio com o suporte reforçado e acelerômetros nos dois lados.',
        relation: 'investiga a hipótese',
        state: 'Em aberto',
      },
      {
        speaker: 'Ensaios',
        time: '00:41',
        text: 'A análise modal do suporte reforçado já mostra a primeira frequência em 140 hertz.',
        type: 'test_result',
        topic: 0,
        note: 'Análise modal do suporte reforçado: primeira frequência em 140 Hz.',
        relation: 'dá suporte à hipótese',
        state: 'Registrado',
      },
      {
        speaker: 'Coordenação',
        time: '00:52',
        text: 'Então está decidido: adotamos o suporte reforçado na próxima revisão.',
        type: 'decision',
        topic: 0,
        note: 'Adotar o suporte reforçado na próxima revisão do projeto.',
        state: 'Registrado',
      },
      {
        speaker: 'Sistemas',
        time: '01:01',
        text: 'O requisito continua: a primeira frequência do suporte precisa ficar acima de 100 hertz.',
        type: 'requirement',
        topic: 0,
        note: 'A primeira frequência do suporte deve ficar acima de 100 Hz.',
        state: 'Registrado',
      },
      {
        speaker: 'Coordenação',
        time: '01:12',
        text: 'Outro assunto: o fornecedor do conector ainda não confirmou o prazo de entrega.',
        type: 'observation',
        topic: 1,
        note: 'O fornecedor do conector ainda não confirmou o prazo de entrega.',
        state: 'Em aberto',
      },
      {
        speaker: 'Sistemas',
        time: '01:20',
        text: 'Eu falo com o fornecedor até quinta-feira e trago a resposta.',
        type: 'other',
        topic: 1,
        note: 'Sistemas confirma o prazo com o fornecedor até quinta-feira.',
        state: 'Registrado',
      },
    ],
  },
  en: {
    title: 'Vibration test review',
    topics: ['Antenna bracket deformation', 'Connector delivery date'],
    lines: [
      {
        speaker: 'Coordination',
        time: '00:04',
        text: 'Morning, everyone. I will share my screen with the test report.',
        type: null,
      },
      {
        speaker: 'Structures',
        time: '00:12',
        text: 'In the vibration test, the antenna bracket deformed more than predicted.',
        type: 'observation',
        topic: 0,
        note: 'The antenna bracket deformed more than predicted in the vibration test.',
        state: 'Open',
      },
      {
        speaker: 'Testing',
        time: '00:21',
        text: 'It could be resonance. The test peak is close to 80 hertz.',
        type: 'hypothesis',
        topic: 0,
        note: 'Possible resonance near 80 Hz, at the test peak.',
        relation: 'addresses the problem',
        state: 'Open',
      },
      {
        speaker: 'Structures',
        time: '00:30',
        text: 'I propose repeating the test with the reinforced bracket and accelerometers on both sides.',
        type: 'test_proposal',
        topic: 0,
        note: 'Repeat the test with the reinforced bracket and accelerometers on both sides.',
        relation: 'investigates the hypothesis',
        state: 'Open',
      },
      {
        speaker: 'Testing',
        time: '00:41',
        text: 'The modal analysis of the reinforced bracket already puts the first frequency at 140 hertz.',
        type: 'test_result',
        topic: 0,
        note: 'Modal analysis of the reinforced bracket: first frequency at 140 Hz.',
        relation: 'supports the hypothesis',
        state: 'Recorded',
      },
      {
        speaker: 'Coordination',
        time: '00:52',
        text: 'So it is decided: we adopt the reinforced bracket in the next revision.',
        type: 'decision',
        topic: 0,
        note: 'Adopt the reinforced bracket in the next design revision.',
        state: 'Recorded',
      },
      {
        speaker: 'Systems',
        time: '01:01',
        text: "The requirement still holds: the bracket's first frequency must stay above 100 hertz.",
        type: 'requirement',
        topic: 0,
        note: "The bracket's first frequency must stay above 100 Hz.",
        state: 'Recorded',
      },
      {
        speaker: 'Coordination',
        time: '01:12',
        text: 'Another topic: the connector supplier still has not confirmed the delivery date.',
        type: 'observation',
        topic: 1,
        note: 'The connector supplier has not confirmed the delivery date.',
        state: 'Open',
      },
      {
        speaker: 'Systems',
        time: '01:20',
        text: 'I will call the supplier by Thursday and report back.',
        type: 'other',
        topic: 1,
        note: 'Systems confirms the date with the supplier by Thursday.',
        state: 'Recorded',
      },
    ],
  },
};
