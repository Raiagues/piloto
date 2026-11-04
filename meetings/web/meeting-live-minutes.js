/* Read-only minutes while the meeting runs: the current records grouped by topic. No model call and no editing. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NorteLiveMinutes = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const SECTIONS = [
    ['Observações', ['observation']],
    ['Hipóteses em investigação', ['hypothesis']],
    ['Decisões registradas', ['decision']],
    ['Requisitos e critérios', ['requirement']],
    ['Testes e resultados', ['test_proposal', 'test_result']],
    ['Outros registros', ['other']],
  ];

  function outline(projection) {
    return projection.topics
      .map((topic, index) => {
        const nodes = Object.values(topic.columns)
          .flat()
          .flatMap(function withChildren(node) {
            return [node, ...node.children.flatMap(withChildren)];
          });
        return {
          id: topic.id,
          title: topic.title || 'Assunto ' + (index + 1),
          sections: SECTIONS.map(([title, types]) => ({
            title,
            items: nodes.filter(node => types.includes(node.type)),
          })).filter(section => section.items.length),
        };
      })
      .filter(topic => topic.sections.length);
  }

  function render(host, { title, participants, lines, outside, projection, onReference, referenceOf }) {
    const document = host.ownerDocument;
    const el = (tag, className, text) => {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    };
    const article = el('article', 'room-live-minutes');
    article.append(el('small', '', 'Ata da reunião'), el('h3', '', title));
    const facts = el('dl');
    for (const [label, value] of [
      ['Participantes', participants.join(', ') || '—'],
      ['Falas', String(lines)],
      ['Fora da ata', String(outside)],
    ]) {
      const row = el('div');
      row.append(el('dt', '', label), el('dd', '', value));
      facts.append(row);
    }
    article.append(facts);
    const topics = outline(projection);
    if (!topics.length)
      article.append(el('p', 'room-live-minutes-empty', 'A ata se forma conforme as notas são escritas.'));
    else {
      const nav = el('nav'),
        list = el('ol');
      nav.setAttribute('aria-label', 'Sumário');
      for (const topic of topics) list.append(el('li', '', topic.title));
      nav.append(el('strong', '', 'Sumário'), list);
      article.append(nav);
    }
    topics.forEach((topic, index) => {
      const section = el('section');
      section.append(el('h4', '', index + 1 + '. ' + topic.title));
      for (const group of topic.sections) {
        const list = el('ul');
        for (const item of group.items) {
          const row = el('li', '', item.display_text ?? item.text),
            reference = el('button', 'room-reference', 'Ref. ' + referenceOf(item.id));
          reference.type = 'button';
          reference.setAttribute('aria-label', 'Mostrar a fala de origem na transcrição');
          reference.onclick = () => onReference(item.id);
          row.append(reference);
          list.append(row);
        }
        section.append(el('h5', '', group.title), list);
      }
      article.append(section);
    });
    host.replaceChildren(article);
  }

  return { render };
});
