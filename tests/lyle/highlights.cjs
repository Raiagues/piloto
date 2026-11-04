'use strict';
/* LYLE suite of the highlights. The answer key comes from the marks in the user's PDF.
 *
 *   node tests/lyle/highlights.cjs run --note "o que mudou"   real JEV: paid, about US$ 0.01 per round
 *   node tests/lyle/highlights.cjs report                     free: rebuilds the report from the saved rounds
 *
 * Every round keeps the questions used and the raw scores, so any result can be reviewed later.
 * The folder stays outside Git, like the rest of the user's documents.
 */
const fs = require('node:fs'),
  path = require('node:path');
const Highlights = require('../../meetings/web/meeting-highlights.js'),
  Q = require('../../prompts/jev/questions.js');
const { score } = require('./metrics.cjs');

const ROOT = path.resolve(__dirname, '../..'),
  FOLDER = path.join(ROOT, 'novo_teste/resultados/destaques');
const SCENARIOS = path.join(ROOT, 'novo_teste/resultados/reunioes/cenarios/lyle-transcricoes.json');
const JEV_URL = 'https://api.typesafe.ai/v1/systemone',
  JEV_USD_PER_MILLION_INPUT = 0.042;
// Meetings that took no part in writing the questions. They have no answer key: every alert in them is listed to be read.
const CONTROLS = ['memory-b001.json', 'memory-v2-holdout.json'];
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const percent = value => (value === null ? '—' : `${(100 * value).toFixed(0)}%`);
const rounds = () =>
  fs
    .readdirSync(FOLDER)
    .filter(name => /^rodada-\d+$/u.test(name))
    .sort((a, b) => a.split('-')[1] - b.split('-')[1]);
const cell = text => String(text).replace(/\|/gu, '\\|').replace(/\s+/gu, ' ');

async function jevClient() {
  process.loadEnvFile(path.join(ROOT, '.env'));
  const { resolveKey } = await import('../../norte/server/ai-keys.mjs');
  const { key } = resolveKey('typesafe');
  if (!key) throw Error('Configure TYPESAFE_API_KEY para rodar a suíte com o JEV real.');
  const usage = { input: 0, output: 0, ms: 0 };
  const send = async body => {
    const started = Date.now();
    const response = await fetch(JEV_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });
    if (!response.ok)
      throw Error(`JEV respondeu ${response.status}. A rodada foi interrompida sem salvar resultado parcial.`);
    const output = await response.json();
    usage.input += output.usage?.input_tokens || 0;
    usage.output += output.usage?.output_tokens || 0;
    usage.ms += Date.now() - started;
    return { response: output };
  };
  return { send, usage };
}

async function run(note) {
  const { send, usage } = await jevClient(),
    meetings = [];
  for (const scenario of read(SCENARIOS).scenarios) {
    const turns = scenario.transcript.map(turn => ({
      key: turn.id,
      speaker: turn.speaker,
      offsetMs: turn.offsetMs,
      text: turn.text,
    }));
    const result = await Highlights.analyze(turns, send, ({ done, total }) =>
      process.stdout.write(`\r${scenario.id}: ${done}/${total} frases`),
    );
    process.stdout.write('\n');
    meetings.push({ id: scenario.id, title: scenario.title, ...result });
  }
  const controls = [];
  for (const file of CONTROLS) {
    const cases = read(path.join(ROOT, 'tests/fixtures', file)).cases;
    const turns = cases.map((item, index) => ({ key: item.id, offsetMs: index * 30000, text: item.current_utterance }));
    controls.push({ id: file, ...(await Highlights.analyze(turns, send)) });
  }
  const next = rounds().length + 1,
    folder = path.join(FOLDER, `rodada-${next}`);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(
    path.join(folder, 'perguntas.json'),
    JSON.stringify(
      {
        version: Q.highlightVersion,
        highlights: Q.highlights,
        fragment: Q.highlightFragment,
        evidence: Q.highlightEvidence,
        rules: Q.highlightRules,
        thresholds: { sentence: Highlights.THRESHOLD },
      },
      null,
      1,
    ),
  );
  fs.writeFileSync(
    path.join(folder, 'resultado.json'),
    JSON.stringify(
      {
        ranAt: new Date().toISOString(),
        note,
        usage: { ...usage, usd: (usage.input * JEV_USD_PER_MILLION_INPUT) / 1e6 },
        meetings,
        controls,
      },
      null,
      1,
    ),
  );
  console.log(`Rodada ${next} salva.`);
}

function evaluate(name) {
  const { alerts } = read(path.join(FOLDER, 'gabarito.json')),
    result = read(path.join(FOLDER, name, 'resultado.json'));
  const findings = result.meetings.flatMap(meeting => meeting.findings),
    sentences = result.meetings.reduce((sum, meeting) => sum + meeting.sentences, 0);
  return {
    name,
    result,
    questions: read(path.join(FOLDER, name, 'perguntas.json')),
    calls: result.meetings.reduce((sum, meeting) => sum + meeting.calls, 0),
    ...score(alerts, findings, sentences),
  };
}

function changed(previous, current) {
  if (!previous) return [];
  const before = previous.questions.highlights,
    after = current.questions.highlights;
  return Object.keys(after).filter(id => JSON.stringify(before[id]) !== JSON.stringify(after[id]));
}

// The report carries the prompt itself: every question in the first round, then before and after of what changed.
function questionLines(question) {
  const answers = Object.entries(question.criteria || {}).map(([id, text]) => `  - \`${id}\`: ${text}`);
  return [`  ${question.instructions}`, ...answers];
}
function promptSection(round, previous) {
  const lines = [];
  if (!previous) {
    lines.push('', 'Perguntas enviadas:', '');
    for (const [id, question] of Object.entries(round.questions.highlights))
      lines.push(`- \`${id}\``, ...questionLines(question));
    lines.push('- pedaço da frase (`fragment`)', ...questionLines(round.questions.fragment));
    lines.push('- prova (`evidence`)', `  ${round.questions.evidence.instructions}`);
    return lines;
  }
  for (const id of changed(previous, round)) {
    lines.push('', `Pergunta \`${id}\`, antes:`, '', ...questionLines(previous.questions.highlights[id]));
    lines.push('', 'Depois:', '', ...questionLines(round.questions.highlights[id]));
  }
  return lines;
}

function roundSection(round, previous) {
  const number = round.name.split('-')[1],
    { usage } = round.result,
    edited = changed(previous, round);
  const lines = [
    `## Rodada ${number}`,
    '',
    `- Data: ${round.result.ranAt}`,
    `- Perguntas: \`${round.questions.version}\` (\`${round.name}/perguntas.json\`)`,
    `- O que mudou: ${round.result.note}`,
  ];
  if (edited.length) lines.push(`- Perguntas alteradas: ${edited.map(id => `\`${id}\``).join(', ')}`);
  lines.push(
    `- Custo: ${round.calls} chamadas ao JEV, ${usage.input} tokens de entrada, US$ ${usage.usd.toFixed(4)}, ${(usage.ms / 1000).toFixed(0)} s somando as chamadas`,
  );
  lines.push(...promptSection(round, previous));
  lines.push('', '| Alerta | Esperado | Obtido | Marcação | Prova |', '| --- | --- | --- | --- | --- |');
  for (const row of round.rows) {
    const { alert, finding } = row;
    lines.push(
      `| ${alert.id} ${alert.time} | \`${alert.rule}\`: “${cell(alert.text)}” | ${finding ? `\`${finding.ruleId}\` (${finding.confidence.toFixed(2)}): “${cell(finding.affectedText)}”` : 'não encontrado'} | ${finding ? percent(row.iou) : '—'} | ${!row.proofExpected ? 'sem prova esperada' : row.proofRight ? 'certa' : finding?.evidence.length ? `outra: ${finding.evidence[0].time}` : 'nenhuma'} |`,
    );
  }
  lines.push('', `Falsos alarmes (${round.falseAlarms.length}):`, '');
  for (const item of round.falseAlarms)
    lines.push(
      `- ${item.time} ${item.speaker}, \`${item.ruleId}\` (${item.confidence.toFixed(2)}): “${cell(item.affectedText)}”`,
    );
  if (!round.falseAlarms.length) lines.push('- nenhum');
  for (const control of round.result.controls || []) {
    lines.push('', `Controle \`${control.id}\`: ${control.findings.length} alertas em ${control.sentences} frases.`);
    if (control.findings.length) lines.push('');
    for (const item of control.findings)
      lines.push(`- \`${item.ruleId}\` (${item.confidence.toFixed(2)}): “${cell(item.affectedText)}”`);
  }
  return lines.join('\n');
}

function report() {
  const list = rounds().map(evaluate),
    { alerts } = read(path.join(FOLDER, 'gabarito.json'));
  const header = [
    '# Destaques LYLE: resultados',
    '',
    'Entrada: as três transcrições fictícias de `LYLE_transcricoes_com_alertas.pdf`.',
    `Esperado: as ${alerts.length} marcações do próprio PDF (\`gabarito.json\`).`,
    'Perguntas: arquivo `perguntas.json` de cada rodada.',
    '',
    'Atenção: as perguntas foram escritas conhecendo estes alertas. Estes números mostram o comportamento no caso LYLE; não são uma medida de precisão geral nem validação jurídica.',
    '',
    '## Resumo',
    '',
    '| Rodada | Perguntas | Encontrados | Regra certa | Precisão | F1 | Falsos alarmes / 100 frases | Marcação média | Marcações ≥ 80% | Prova certa | Custo (US$) |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const round of list)
    header.push(
      `| ${round.name.split('-')[1]} | ${round.questions.version} | ${round.found}/${round.alerts} | ${percent(round.rightRule)} | ${percent(round.precision)} | ${percent(round.f1)} | ${round.falseAlarmsPer100.toFixed(1)} | ${percent(round.meanIou)} | ${percent(round.closeMarks)} | ${percent(round.proofRight)} | ${round.result.usage.usd.toFixed(4)} |`,
    );
  const body = list.map((round, index) => roundSection(round, list[index - 1]));
  fs.writeFileSync(path.join(FOLDER, 'RELATORIO.md'), `${[header.join('\n'), ...body].join('\n\n')}\n`);
  console.log(header.slice(-list.length - 2).join('\n'));
}

const [command, flag, note] = process.argv.slice(2);
if (command === 'run')
  run(flag === '--note' ? note : 'sem nota')
    .then(report)
    .catch(error => {
      console.error(error.message);
      process.exitCode = 1;
    });
else if (command === 'report') report();
else console.log('Use: node tests/lyle/highlights.cjs run --note "..." | report');
