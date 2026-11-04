import PDFDocument from 'pdfkit';
import { fileURLToPath } from 'node:url';
import { documentTemplate } from '../shared/document-templates.mjs';

const pending = 'PENDENTE';
// Drafts are issued in Portuguese with the interface wording; stored values keep their codes.
const LABELS = {
  draft: 'Rascunho',
  in_review: 'Em revisão',
  approved: 'Aprovado',
  changes_requested: 'Alterações solicitadas',
  archived: 'Arquivado',
  planned: 'Planejado',
  in_progress: 'Em andamento',
  blocked: 'Bloqueado',
  done: 'Concluído',
  passed: 'Atendeu ao critério',
  failed: 'Não atendeu',
  inconclusive: 'Inconclusivo',
  unspecified: 'A definir',
  test: 'Ensaio',
  analysis: 'Análise',
  inspection: 'Inspeção',
  demonstration: 'Demonstração',
  simulation: 'Simulação',
};
const label = value => (value ? LABELS[value] || value : pending);
const list = values => (values || []).filter(Boolean).join(', ') || pending;
const cell = value =>
  String(value ?? pending)
    .replace(/\|/gu, '/')
    .replace(/\r?\n/gu, ' ');
const table = (head, rows) => [
  `| ${head.join(' | ')} |`,
  `| ${head.map(() => '---').join(' | ')} |`,
  ...rows.map(row => `| ${row.map(cell).join(' | ')} |`),
];

const legacySections = content => [
  { heading: 'Objetivo e escopo', guide: '', fill: 'purpose' },
  ...(['traceability', 'verification-matrix'].includes(content)
    ? [{ heading: 'Matriz de rastreabilidade', guide: '', fill: 'traceability' }]
    : []),
  ...(['requirements', 'traceability', 'analysis', 'verification-matrix'].includes(content)
    ? [{ heading: 'Requisitos', guide: '', fill: 'requirements' }]
    : ['verification-plan', 'verification-results'].includes(content)
      ? [{ heading: 'Verificações', guide: '', fill: 'verification-activities' }]
      : ['architecture', 'preliminary', 'detailed'].includes(content)
        ? [{ heading: 'Arquitetura', guide: '', fill: 'architecture' }]
        : [{ heading: 'Conteúdo', guide: '', fill: '' }]),
];
const shortText = (value, size = 140) => {
  const text = String(value || '')
    .replace(/\s+/gu, ' ')
    .trim();
  return text.length > size ? `${text.slice(0, size - 1)}…` : text;
};
const longDate = value =>
  /^\d{4}-\d{2}-\d{2}$/u.test(value || '')
    ? new Date(`${value}T12:00:00Z`).toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      })
    : 'data a definir';
// A physical quantity copied literally from a requirement; nothing is computed or estimated.
const QUANTITY =
  /(?:[≤≥<>=±]\s*)?(?<![\p{L}\d])[-+−]?\d+(?:[.,]\d+)?\s*(?:kg|g|W|kW|mW|V|A|mA|Wh|m\/s|km|m|mm|µm|s|ms|min|h|Hz|kHz|MHz|GHz|dB|dBm|bit\/s|kbit\/s|Mbit\/s|bps|°C|K|Pa|kPa|N|Nm|%|g0)(?![\p{L}])/u;

/** Records a draft may cite, taken from the delivery view the actor can already see. */
export const draftContext = (view, project, task) => ({
  phases: view.lifecycleRanges,
  tasks: view.tasks,
  members: view.members,
  sectors: project.context?.sectors || [],
  artifacts: view.artifacts,
  package: task ? view.tasks.find(item => item.id === task.id)?.documentOptions || [] : [],
});

/** Draft a review document from its template: headings and guidance from the standard, content from existing records only. */
export function draftDeliveryDocument(definition, project, requirements, tests, task, context = {}) {
  const outline =
    (definition.profile && documentTemplate(definition.profile, definition.id)?.sections) ||
    legacySections(definition.content);
  const active = requirements.filter(requirement => !requirement.archived),
    activeTests = tests.filter(test => !test.archived);
  const sectors = context.sectors || project.context?.sectors || [];
  const testsFor = requirement => activeTests.filter(test => test.requirementIds?.includes(requirement.id));
  const reviewLine = task ? `${task.title} · ${longDate(task.dueDate)}` : 'revisão a definir';
  const lines = [
    `# ${definition.title}`,
    `Projeto: ${project.name}${definition.code ? ` · Documento ${definition.code}` : ''}`,
    `Revisão planejada: ${reviewLine}`,
  ];
  if (definition.reference)
    lines.push(
      `Estrutura: ${definition.reference.section} — ${definition.reference.title}${definition.reference.edition ? ` (${definition.reference.edition})` : ''}`,
      definition.reference.url,
    );
  if (definition.maturity) lines.push(`Maturidade esperada nesta revisão: ${definition.maturity}`);
  lines.push(
    'Emissão inicial: RASCUNHO PARA REVISÃO DA EQUIPE. As linhas "Orientação" resumem a estrutura de referência; substitua-as pelo conteúdo do projeto. Campos PENDENTE dependem da equipe.',
    '',
  );
  const fill = {
    purpose: () => [
      `Este documento apoia ${task ? `a ${task.title}` : 'a revisão planejada'} do projeto ${project.name}.`,
      'PENDENTE — completar o propósito, o escopo e o motivo desta emissão.',
    ],
    references: () => {
      const rows = [];
      if (definition.reference)
        rows.push(
          `- ${definition.reference.title}${definition.reference.edition ? ` · ${definition.reference.edition}` : ''} — ${definition.reference.section}`,
        );
      for (const source of project.engineeringSystem?.artifactSources || [])
        rows.push(`- ${source.artifactLabel || source.artifactId || source.id}`);
      for (const artifact of context.artifacts || [])
        if (!rows.some(row => row.includes(artifact.label))) rows.push(`- ${artifact.label}`);
      return [...rows, '- PENDENTE — confirmar as edições aplicáveis e de referência e a precedência entre elas.'];
    },
    'requirement-summary': () =>
      active.length
        ? table(
            ['ID', 'Requisito', 'Método', 'Situação'],
            active.map(r => [
              `${r.id} · v${r.version}`,
              `${r.title}: ${shortText(r.statement)}`,
              label(r.method || 'unspecified'),
              label(r.status),
            ]),
          )
        : ['PENDENTE — nenhum requisito registrado para este escopo.'],
    requirements: () => {
      if (!active.length) return ['PENDENTE — nenhum requisito registrado para este escopo.'];
      return active.flatMap(requirement => [
        `### ${requirement.id} · ${requirement.title} · v${requirement.version}`,
        requirement.statement,
        `Situação de revisão: ${label(requirement.status)}`,
        `Método: ${label(requirement.method || 'unspecified')}`,
        `Condição: ${requirement.condition || pending}`,
        `Critério: ${requirement.acceptanceCriteria || 'PENDENTE — definir critério de aceitação'}`,
        `Origem: ${list([...(requirement.sourceRefs || []), ...(requirement.artifactIds || [])])}`,
        `Requisito superior: ${list(requirement.parentIds)}`,
        `Localização na fonte: ${requirement.sourceLocator || pending}`,
        '',
      ]);
    },
    traceability: () =>
      active.length
        ? table(
            ['Requisito / versão', 'Origem / requisito superior', 'Método', 'Verificações / situação'],
            active.map(requirement => [
              `${requirement.id} · v${requirement.version}`,
              list([
                ...(requirement.sourceRefs || []),
                ...(requirement.artifactIds || []),
                ...(requirement.parentIds || []),
              ]),
              label(requirement.method),
              list(testsFor(requirement).map(test => `${test.id}: ${label(test.status || 'planned')}`)),
            ]),
          )
        : ['PENDENTE — nenhum requisito registrado para este escopo.'],
    justification: () =>
      active.length
        ? table(
            ['Requisito', 'Justificativa', 'Origem'],
            active.map(r => [
              `${r.id} · ${r.title}`,
              r.rationale || 'PENDENTE — justificar',
              list([...(r.sourceRefs || []), ...(r.artifactIds || []), ...(r.parentIds || [])]),
            ]),
          )
        : ['PENDENTE — nenhum requisito registrado.'],
    allocation: () =>
      active.length
        ? table(
            ['Requisito', 'Elemento / setor responsável'],
            active.map(r => [
              `${r.id} · ${r.title}`,
              sectors.find(sector => sector.id === r.sectorId)?.name ||
                list(
                  (r.entityIds || []).map(
                    id => project.engineeringSystem?.entities?.find(entity => entity.id === id)?.name || id,
                  ),
                ),
            ]),
          )
        : ['PENDENTE — nenhum requisito registrado.'],
    'method-allocation': () =>
      active.length
        ? table(
            ['Requisito', 'Método', 'Nível', 'Estágio'],
            active.map(r => [`${r.id} · ${r.title}`, label(r.method || 'unspecified'), pending, pending]),
          )
        : ['PENDENTE — nenhum requisito registrado.'],
    'verification-matrix': () =>
      active.length
        ? table(
            ['Requisito', 'Texto', 'Método', 'Atividade', 'Situação', 'Evidência'],
            active.map(r => {
              const linked = testsFor(r),
                runs = linked.flatMap(test => test.runs || []);
              return [
                `${r.id} · v${r.version}`,
                shortText(r.statement, 120),
                label(r.method || 'unspecified'),
                list(linked.map(test => test.id)),
                linked.length ? list(linked.map(test => label(test.status || 'planned'))) : 'Sem verificação planejada',
                runs.length ? list(runs.map(run => run.evidenceUrl || (run.artifactIds || []).join(' '))) : pending,
              ];
            }),
          )
        : ['PENDENTE — nenhum requisito registrado.'],
    rvm: () =>
      active.length
        ? table(
            [
              'Requisito',
              'Documento',
              'Enunciado',
              'Critério de sucesso',
              'Método',
              'Instalação',
              'Fase',
              'Organização',
              'Resultado',
            ],
            active.map(r => {
              const linked = testsFor(r);
              return [
                r.id,
                definition.code || pending,
                shortText(r.statement, 120),
                r.acceptanceCriteria || pending,
                label(r.method || 'unspecified'),
                pending,
                pending,
                sectors.find(sector => sector.id === r.sectorId)?.name || pending,
                linked.length ? list(linked.map(test => label(test.status || 'planned'))) : pending,
              ];
            }),
          )
        : ['PENDENTE — nenhum requisito registrado.'],
    'verification-status': () => {
      if (!active.length) return ['PENDENTE — nenhum requisito registrado.'];
      const passed = active.filter(
          r => testsFor(r).length && testsFor(r).every(test => test.status === 'passed'),
        ).length,
        planned = active.filter(r => testsFor(r).length).length;
      return [
        `- Requisitos no escopo: ${active.length}`,
        `- Com verificação planejada: ${planned}`,
        `- Com todas as verificações atendidas: ${passed}`,
        `- Sem verificação planejada: ${active.length - planned}`,
        'Os números refletem os registros do Norte na emissão deste rascunho; nenhum resultado é presumido.',
      ];
    },
    'verification-activities': () =>
      activeTests.length
        ? activeTests.flatMap(test => [
            `### ${test.id} · ${test.title}`,
            `Requisitos: ${list(test.requirementIds)}`,
            `Método: ${label(test.method)}`,
            `Configuração / condições: ${test.conditions || pending}`,
            `Procedimento: ${test.procedure || pending}`,
            `Critério: ${test.acceptanceCriteria || pending}`,
            `Execuções registradas: ${test.runs?.length || 0}`,
            '',
          ])
        : ['PENDENTE — nenhuma verificação planejada para este escopo.'],
    'test-runs': () => {
      const runs = activeTests.flatMap(test => (test.runs || []).map(run => ({ test, run })));
      return runs.length
        ? runs.map(({ test, run }) =>
            `- ${test.id} · ${String(run.createdAt || '').slice(0, 10)}: ${label(run.outcome)} — ${run.result}. Evidências: ${list(run.artifactIds)} ${run.evidenceUrl || ''}`.trim(),
          )
        : ['PENDENTE — nenhuma execução registrada; não há resultado presumido.'];
    },
    'test-requirements': () => {
      const rows = active.filter(r => r.method === 'test');
      return rows.length
        ? rows.map(r => `- ${r.id} · ${r.title}`)
        : ['PENDENTE — nenhum requisito com verificação por ensaio.'];
    },
    lifecycle: () => {
      const phases = context.phases || [],
        reviews = (context.tasks || [])
          .filter(item => item.kind === 'review' && !item.archived && !item.excluded)
          .sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));
      const rows = [];
      if (phases.length)
        rows.push(
          ...table(
            ['Fase', 'Nome', 'Início', 'Fim'],
            phases.map(phase => [phase.code, phase.name, longDate(phase.start), longDate(phase.end)]),
          ),
          '',
        );
      if (reviews.length)
        rows.push(
          ...table(
            ['Revisão', 'Data', 'Situação'],
            reviews.map(review => [review.title, longDate(review.dueDate), label(review.status)]),
          ),
        );
      return rows.length ? rows : ['PENDENTE — o cronograma ainda não tem fases nem revisões.'];
    },
    organization: () => {
      const owner = context.members?.find(member => member.id === task?.ownerId)?.name;
      return [
        ...(owner ? [`Responsável pela revisão: ${owner}`, ''] : []),
        ...(sectors.length
          ? table(
              ['Setor', 'Responsabilidade técnica'],
              sectors.map(sector => [sector.name, pending]),
            )
          : ['PENDENTE — setores ainda não definidos.']),
      ];
    },
    architecture: () => {
      const entities = project.engineeringSystem?.entities || [];
      return entities.length
        ? entities.flatMap(entity => [
            `### ${entity.id} · ${entity.name}`,
            `${entity.kind || 'elemento'}; origem: ${list(entity.evidenceRefs)}`,
            entity.description || '',
            '',
          ])
        : sectors.length
          ? [
              'Elementos registrados como setores do projeto:',
              ...sectors.map(sector => `- ${sector.name} — PENDENTE: descrever`),
            ]
          : ['PENDENTE — descrever os elementos do sistema.'];
    },
    products: () => {
      const entities = project.engineeringSystem?.entities || [];
      const children = entities.length ? entities.map(entity => entity.name) : sectors.map(sector => sector.name);
      return [
        `- 1 ${project.name}`,
        ...children.map((name, index) => `  - 1.${index + 1} ${name}`),
        ...(children.length ? [] : ['  - PENDENTE — decompor o produto em itens de configuração']),
      ];
    },
    specifications: () => [
      `- ${definition.profile === 'nasa' ? 'SRD' : 'TS'} · Especificação do sistema ${project.name}`,
      ...sectors.map(sector => `  - Especificação de ${sector.name} — PENDENTE`),
      ...(sectors.length ? [] : ['  - PENDENTE — especificações de nível inferior']),
    ],
    functions: () => {
      if (!active.length) return ['PENDENTE — nenhum requisito registrado para derivar funções.'];
      const groups = [{ id: '', name: 'Sistema' }, ...sectors]
        .map(sector => ({ sector, items: active.filter(r => (r.sectorId || '') === sector.id) }))
        .filter(group => group.items.length);
      return [
        `- F0 Função principal de ${project.name} — PENDENTE: enunciar`,
        ...groups.flatMap((group, index) => [
          `  - F${index + 1} ${group.sector.name}`,
          ...group.items.map((r, child) => `    - F${index + 1}.${child + 1} ${r.title} (${r.id})`),
        ]),
      ];
    },
    interfaces: () => {
      const relations = project.engineeringSystem?.relations || [];
      return relations.length
        ? relations.map(
            relation =>
              `- ${relation.sourceName || relation.sourceId || relation.source || '?'} ↔ ${relation.targetName || relation.targetId || relation.target || '?'}${relation.kind || relation.type ? ` (${relation.kind || relation.type})` : ''}`,
          )
        : table(
            ['Interface', 'Extremidades', 'Tipo', 'Requisito', 'Verificação'],
            [[pending, pending, pending, pending, pending]],
          );
    },
    budget: () => {
      const rows = active.flatMap(r => {
        const values = [...(r.statement || '').matchAll(new RegExp(QUANTITY.source, 'gu'))]
          .slice(0, 4)
          .map(match => match[0].trim());
        return values.length
          ? [[`${r.title}`, `${r.id} · v${r.version}`, values.join('; '), pending, pending, pending]]
          : [];
      });
      return table(
        ['Parâmetro', 'Requisito de origem', 'Valor especificado', 'Margem', 'Estimativa atual', 'Situação'],
        rows.length ? rows : [[pending, pending, pending, pending, pending, pending]],
      );
    },
    trsl: () =>
      table(
        ['Tecnologia / elemento', 'Função', 'TRL atual', 'Evidência', 'TRL necessário', 'Ação'],
        [[pending, pending, pending, pending, pending, pending]],
      ),
    criteria: () => table(['Critério', 'Peso', 'Justificativa'], [[pending, pending, pending]]),
    stakeholders: () =>
      table(['Parte interessada', 'Interesse', 'Expectativa', 'Prioridade'], [[pending, pending, pending, pending]]),
    moe: () =>
      table(['Medida de eficácia', 'Objetivo', 'Critério de sucesso', 'Fonte'], [[pending, pending, pending, pending]]),
    tbd: () => {
      const rows = active.filter(r => /\b(?:TBD|TBR|a definir)\b/iu.test(r.statement || ''));
      return rows.length
        ? rows.map(r => `- ${r.id}: ${shortText(r.statement)} — PENDENTE: responsável e data`)
        : ['Nenhum TBD/TBR nos enunciados registrados.'];
    },
    package: () =>
      (context.package || []).length
        ? context.package.map(option => `- ${option.code} · ${option.title} — ${option.maturity}`)
        : [pending],
  };
  for (const section of outline) {
    const level = /^#+/u.exec(section.heading)?.[0].length || 2;
    lines.push(`${'#'.repeat(Math.max(2, level))} ${section.heading.replace(/^#+\s*/u, '')}`);
    if (section.guide) lines.push(`> Orientação: ${section.guide}`);
    lines.push(...(fill[section.fill]?.() || ['PENDENTE — redigir esta seção.']), '');
  }
  return (
    lines
      .join('\n')
      .replace(/\n{3,}/gu, '\n\n')
      .trimEnd() + '\n'
  );
}

const printable = value =>
  [...String(value ?? '')].filter(character => character.codePointAt(0) >= 32 || '\n\r\t'.includes(character)).join('');
const parseRow = line =>
  line
    .trim()
    .replace(/^\|/u, '')
    .replace(/\|$/u, '')
    .split('|')
    .map(value => value.trim());
export async function deliveryPdf(document) {
  const pdf = new PDFDocument({
      size: 'A4',
      margins: { top: 62, bottom: 60, left: 48, right: 48 },
      bufferPages: true,
      info: {
        Title: document.title || 'Documento de engenharia',
        Author: document.authorName || 'Norte',
        Subject: `${document.id || ''} · versão ${document.version || 1}`,
      },
    }),
    chunks = [];
  pdf.on('data', chunk => chunks.push(chunk));
  const completed = new Promise((resolve, reject) => {
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);
  });
  pdf.registerFont('Body', fileURLToPath(new URL('./fonts/DejaVuSans.ttf', import.meta.url)));
  pdf.registerFont('Strong', fileURLToPath(new URL('./fonts/DejaVuSans-Bold.ttf', import.meta.url)));
  const width = pdf.page.width - 96,
    bottom = () => pdf.page.height - 60;
  const room = height => {
    if (pdf.y + height > bottom()) pdf.addPage();
  };
  function paragraph(text, { size = 10, bold = false, color = '#293541', gap = 7 } = {}) {
    const value = printable(text);
    pdf.font(bold ? 'Strong' : 'Body').fontSize(size);
    room(Math.min(140, pdf.heightOfString(value, { width, lineGap: 3 }) + gap));
    pdf.fillColor(color).text(value, 48, pdf.y, {
      width,
      lineGap: 3,
      ...(/^https:\/\//u.test(value) ? { link: value, underline: true } : {}),
    });
    pdf.y += gap;
  }
  const status =
    document.status === 'approved' ? 'APROVADO' : document.status === 'in_review' ? 'EM REVISÃO' : 'RASCUNHO';
  paragraph(document.title || 'Documento de engenharia', { size: 21, bold: true, gap: 14 });
  paragraph(`${document.id || 'Documento'}  /  v${document.version || 1}  /  ${status}`, {
    size: 9,
    bold: true,
    color: '#785636',
  });
  paragraph(
    `Estrutura: ${(document.profile || 'custom').toUpperCase()}${document.taskId ? `  ·  Revisão: ${document.taskId}` : ''}`,
    { size: 9, color: '#5d6b77' },
  );
  if (document.authorName) paragraph(`Autor: ${document.authorName}`, { size: 9, color: '#5d6b77' });
  if (document.updatedAt)
    paragraph(`Atualizado: ${String(document.updatedAt).slice(0, 10)}`, { size: 9, color: '#5d6b77' });
  pdf.moveDown(0.5);
  const lines = String(document.body || '').split('\n');
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (index === 0 && line === `# ${document.title}`) continue;
    if (line.trim().startsWith('|') && /^\|?\s*:?-+/u.test(lines[index + 1]?.trim() || '')) {
      const head = parseRow(line),
        rows = [];
      index += 2;
      while (index < lines.length && lines[index].trim().startsWith('|')) {
        rows.push(parseRow(lines[index]));
        index++;
      }
      index--;
      const columns = head.length,
        colWidth = width / columns;
      const drawRow = (row, header = false) => {
        pdf.font(header ? 'Strong' : 'Body').fontSize(8);
        const height = Math.max(
          27,
          ...head.map((_, i) => pdf.heightOfString(printable(row[i] || ''), { width: colWidth - 14, lineGap: 2 }) + 14),
        );
        // A single oversized cell becomes labelled paragraphs, retaining its full text.
        if (height > bottom() - 110) {
          for (let i = 0; i < head.length; i++) paragraph(`${head[i]}: ${row[i] || ''}`, { size: 9 });
          return;
        }
        const newPage = pdf.y + height > bottom();
        room(height);
        if (newPage && !header) drawRow(head, true);
        const y = pdf.y;
        for (let column = 0; column < columns; column++) {
          const x = 48 + column * colWidth;
          pdf.rect(x, y, colWidth, height).fillAndStroke(header ? '#eef0ef' : '#ffffff', '#d5dcdF');
          pdf
            .font(header ? 'Strong' : 'Body')
            .fontSize(8)
            .fillColor('#293541')
            .text(printable(row[column] || ''), x + 7, y + 7, { width: colWidth - 14, lineGap: 2 });
        }
        pdf.y = y + height;
        pdf.x = 48;
      };
      room(60);
      drawRow(head, true);
      for (const row of rows) drawRow(row);
      pdf.y += 12;
      continue;
    }
    if (!line.trim()) {
      pdf.y += 5;
      continue;
    }
    const heading = /^(#{1,3})\s+(.+)/u.exec(line);
    if (heading) {
      room(65);
      paragraph(heading[2], {
        size: heading[1].length === 1 ? 18 : heading[1].length === 2 ? 13 : 11,
        bold: true,
        gap: 10,
      });
    } else if (/^>\s?/u.test(line)) paragraph(line.replace(/^>\s?/u, ''), { size: 8.5, color: '#5d6b77', gap: 5 });
    else paragraph(line);
  }
  if (document.decisions?.length) {
    paragraph('Controle de aprovação', { size: 13, bold: true });
    for (const decision of document.decisions)
      paragraph(
        `${decision.authorName} · v${decision.version || document.version} · ${decision.decision === 'approve' ? 'Aprovado' : 'Alterações solicitadas'}${decision.comment ? `\n${decision.comment}` : ''}`,
        { size: 9 },
      );
  }
  const range = pdf.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index++) {
    pdf.switchToPage(index);
    pdf.page.margins.bottom = 0;
    pdf
      .font('Strong')
      .fontSize(8)
      .fillColor('#785636')
      .text('NORTE  /  ENGENHARIA DE SISTEMAS', 48, 31, { width, lineBreak: false });
    pdf
      .moveTo(48, 48)
      .lineTo(pdf.page.width - 48, 48)
      .lineWidth(0.5)
      .strokeColor('#d5dcdf')
      .stroke();
    pdf
      .font('Body')
      .fontSize(8)
      .fillColor('#5d6b77')
      .text(`${document.id || 'Documento'} · v${document.version || 1} · ${status}`, 48, pdf.page.height - 35, {
        width: width - 80,
        lineBreak: false,
      });
    pdf.text(`${index + 1} / ${range.count}`, pdf.page.width - 105, pdf.page.height - 35, {
      width: 57,
      align: 'right',
      lineBreak: false,
    });
  }
  pdf.end();
  return completed;
}
