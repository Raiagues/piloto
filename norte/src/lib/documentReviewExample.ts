// A worked example of a document review, built from the document's own text.
// The reviewers are labelled fictional profiles: nothing is stored, sent or counted as an approval.
// Suggested replacements use bracketed placeholders, without numbers.

export type ExampleReviewer = {
  id: string;
  name: string;
  role: string;
  decision: 'approve' | 'request_changes' | 'pending';
  comment: string;
};
export type ExampleSuggestion = { id: string; reviewerId: string; quote: string; replacement: string; comment: string };
export type ExampleReview = { reviewers: ExampleReviewer[]; suggestions: ExampleSuggestion[] };

const VAGUE =
  /\b(?:rapidamente|rápido|rápida|adequado|adequada|adequados|facilmente|suficiente|suficientes|robusto|robusta|eficiente|confiável|aproximadamente|quickly|rapidly|fast|adequate|sufficient|robust|user-friendly|approximately)\b/iu;
const OPEN = /\be\/ou\b|\band\/or\b|\betc\.|conforme necessário|as appropriate/iu;
const UNDEFINED = /\b(?:TBD|TBR|a definir|to be determined)\b/iu;

const once = (body: string, quote: string) => Boolean(quote) && body.split(quote).length === 2;

/** Builds the example from lines that occur exactly once, so each suggestion can be located and applied literally. */
export function exampleReview(body: string, pt = true): ExampleReview {
  const reviewers: ExampleReviewer[] = [
    {
      id: 'example-systems',
      name: pt ? 'Perfil fictício · Sistemas' : 'Fictional profile · Systems',
      role: pt ? 'Engenharia de sistemas' : 'Systems engineering',
      decision: 'request_changes',
      comment: '',
    },
    {
      id: 'example-assurance',
      name: pt ? 'Perfil fictício · Garantia' : 'Fictional profile · Assurance',
      role: pt ? 'Garantia do produto e verificação' : 'Product assurance and verification',
      decision: 'request_changes',
      comment: '',
    },
    {
      id: 'example-configuration',
      name: pt ? 'Perfil fictício · Configuração' : 'Fictional profile · Configuration',
      role: pt ? 'Gestão de configuração e documentação' : 'Configuration and documentation',
      decision: 'pending',
      comment: '',
    },
  ];
  const suggestions: ExampleSuggestion[] = [],
    used = new Set<string>();
  const add = (reviewerId: string, quote: string, replacement: string, comment: string) => {
    if (used.has(quote) || !once(body, quote) || suggestions.filter(item => item.reviewerId === reviewerId).length >= 4)
      return;
    used.add(quote);
    suggestions.push({ id: `example-${suggestions.length + 1}`, reviewerId, quote, replacement, comment });
  };
  const lines = body.split('\n');
  let statement = '';
  for (const [index, line] of lines.entries()) {
    const text = line.trim();
    if (!text) continue;
    // Requirement statements follow their "### ID · title" heading in Norte drafts.
    if (lines[index - 1]?.startsWith('### ')) statement = text;
    const vague = VAGUE.exec(text);
    if (vague && text === statement)
      add(
        'example-systems',
        text,
        text.replace(vague[0], pt ? '[valor e unidade verificáveis]' : '[verifiable value and unit]'),
        pt
          ? `“${vague[0]}” admite mais de uma leitura na verificação. Substitua por um critério observável acordado com a equipe.`
          : `“${vague[0]}” can be read in more than one way during verification. Replace it with an observable criterion agreed with the team.`,
      );
    const open = OPEN.exec(text);
    if (open && text === statement)
      add(
        'example-systems',
        text,
        '',
        pt
          ? `“${open[0]}” deixa o escopo aberto. Separe as obrigações em requisitos distintos ou liste as condições.`
          : `“${open[0]}” leaves the scope open. Split the obligations or list the conditions.`,
      );
    if (UNDEFINED.test(text) && text === statement)
      add(
        'example-systems',
        text,
        '',
        pt
          ? 'Há um valor a definir. Registre responsável e data de fechamento antes da linha de base.'
          : 'A value is still undefined. Record an owner and closing date before baselining.',
      );
    if (/^Critério: PENDENTE/u.test(text))
      add(
        'example-assurance',
        text,
        pt
          ? 'Critério: [condição observável e limite de aceitação definidos pela equipe]'
          : 'Criterion: [observable condition and acceptance limit set by the team]',
        pt
          ? 'Sem critério de aceitação o requisito não pode ser encerrado no controle de verificação.'
          : 'Without an acceptance criterion the requirement cannot be closed in verification control.',
      );
    if (/^Método: A definir/u.test(text))
      add(
        'example-assurance',
        text,
        pt
          ? 'Método: [Análise | Inspeção | Demonstração | Ensaio]'
          : 'Method: [Analysis | Inspection | Demonstration | Test]',
        pt
          ? 'Escolha um dos métodos de verificação e justifique na estratégia do plano de verificação.'
          : 'Choose one verification method and justify it in the verification strategy.',
      );
    if (/^PENDENTE — (?:redigir|completar)/u.test(text))
      add(
        'example-systems',
        text,
        pt ? '[Conteúdo do projeto para esta seção]' : '[Project content for this section]',
        pt
          ? 'Seção ainda sem conteúdo. Complete antes de pedir aprovação.'
          : 'Section still empty. Complete it before asking for approval.',
      );
    if (/^- PENDENTE — confirmar as edições/u.test(text))
      add(
        'example-configuration',
        text,
        pt
          ? '- [Edição aplicável, data e precedência acordadas no contrato]'
          : '- [Applicable edition, date and precedence agreed in the contract]',
        pt
          ? 'A lista de documentos aplicáveis precisa da edição acordada para controlar a configuração.'
          : 'Applicable documents need the agreed edition for configuration control.',
      );
    if (
      /^> Orientação:/u.test(text) &&
      suggestions.filter(item => item.reviewerId === 'example-configuration').length < 2
    )
      add(
        'example-configuration',
        text,
        '',
        pt
          ? 'Linha de orientação do modelo. Remova-a quando a seção estiver redigida.'
          : 'Template guidance line. Remove it once the section is written.',
      );
  }
  for (const reviewer of reviewers) {
    const count = suggestions.filter(item => item.reviewerId === reviewer.id).length;
    if (reviewer.decision === 'request_changes' && !count) reviewer.decision = 'approve';
    reviewer.comment =
      reviewer.decision === 'pending'
        ? pt
          ? 'Revisão solicitada; parecer ainda não enviado.'
          : 'Review requested; no decision yet.'
        : reviewer.decision === 'approve'
          ? pt
            ? 'Sem apontamentos nesta versão.'
            : 'No findings in this version.'
          : pt
            ? `${count} ${count === 1 ? 'sugestão' : 'sugestões'} no texto.`
            : `${count} ${count === 1 ? 'suggestion' : 'suggestions'} in the text.`;
  }
  return { reviewers, suggestions };
}

/** Applies one suggestion to a local draft. Returns null when the quoted text is no longer unique. */
export function applySuggestion(body: string, quote: string, replacement: string) {
  if (!once(body, quote)) return null;
  const next = body.replace(quote, () => replacement);
  // Removing a whole line should not leave an empty line behind.
  return replacement ? next : next.replace(/\n{3,}/gu, '\n\n');
}
