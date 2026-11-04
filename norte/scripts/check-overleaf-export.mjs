import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { unzipSync } from 'fflate';
import { documentLatexArchive } from '../server/document-latex.mjs';
import { draftDeliveryDocument } from '../server/delivery-documents.mjs';
import { documentPackage } from '../shared/document-templates.mjs';

// Explicit local validation: generic fixtures, no accounts and no external upload.
// Default: compiles inside the running `overleaf` compose service. `--image <tag>` compiles with that TeX image
// (for example the one built from docker/overleaf) in a container without network.
const root = fileURLToPath(new URL('../../', import.meta.url));
const out = resolve(root, 'novo_teste/resultados/infra/overleaf');
const imageIndex = process.argv.indexOf('--image'),
  image = imageIndex > 0 ? process.argv[imageIndex + 1] : '';
await mkdir(out, { recursive: true });

const fixture = {
  id: 'DOC-VALIDACAO',
  title: 'Validação LaTeX — critérios & condições',
  authorName: 'Equipe de validação',
  version: 1,
  status: 'draft',
  body: '# Validação LaTeX — critérios & condições\n\n## Caracteres de engenharia\n\n- Limite inferior ≥ 300 km; limite superior ≤ 550 kg.\n- Temperatura 20 °C ± 2 °C; dimensão 2 × 3 mm.\n- Rastreabilidade: origem → requisito → verificação ↔ evidência.\n- Acentos: ação, revisão, propulsão, água, elétrica.\n\n## Texto literal\n\n**Negrito** e `campo_teste` permanecem legíveis.\nCaracteres reservados: & % $ # _ { } ~ ^ \\.\nEste texto não executa comandos: \\input{arquivo-inexistente}.\n[Marcador entre colchetes no início da linha]\nSímbolo sem suporte no pdfLaTeX: ✓\n\n## Matriz de validação\n\n| ID | Critério | Método |\n| --- | --- | --- |\n| TESTE_01 | ≥ 300 km & ≤ 550 kg | Análise |\n| [TESTE_02] | 20 °C ± 2 °C | Ensaio |',
};

// Template drafts as the review package produces them, filled with generic records.
const project = {
  name: 'Projeto de validação',
  context: {
    sectors: [
      { id: 'str', name: 'Estruturas & mecanismos' },
      { id: 'eps', name: 'Energia_EPS' },
    ],
  },
  engineeringSystem: {
    entities: [
      { id: 'OBJ-1', name: 'Módulo de serviço', kind: 'subsistema', evidenceRefs: ['FONTE-1'] },
      { id: 'OBJ-2', name: 'Carga útil #1', kind: 'carga útil', evidenceRefs: [] },
    ],
    relations: [{ sourceName: 'Módulo de serviço', targetName: 'Carga útil #1', kind: 'elétrica' }],
  },
};
const requirements = [
  {
    id: 'VAL-R-001',
    title: 'Massa total',
    statement: 'A massa total deve ser ≤ 25 kg na configuração de lançamento.',
    version: 2,
    status: 'in_review',
    method: 'analysis',
    sectorId: 'str',
    sourceRefs: ['FONTE-1 §2.1'],
    acceptanceCriteria: 'Massa medida ≤ 25 kg ± 0,5 %',
    rationale: 'Limite do lançador & margem de 10 %.',
  },
  {
    id: 'VAL-R-002',
    title: 'Potência',
    statement: 'O subsistema de energia deve fornecer 40 W em modo nominal (TBD) e/ou 60 W em pico.',
    version: 1,
    status: 'draft',
    method: 'unspecified',
    sectorId: 'eps',
  },
  {
    id: 'VAL-R-003',
    title: 'Temperatura',
    statement: 'A carga útil deve operar entre -20 °C e +50 °C de forma adequada.',
    version: 1,
    status: 'draft',
    method: 'test',
    sectorId: '',
    parentIds: ['VAL-R-001'],
  },
];
const tests = [
  {
    id: 'VAL-V-001',
    title: 'Ensaio térmico_1',
    requirementIds: ['VAL-R-003'],
    method: 'test',
    status: 'planned',
    runs: [],
  },
];
const task = { id: 'review', title: 'Revisão de validação', dueDate: '2026-12-01', ownerId: '' };
const context = {
  phases: [{ code: 'A', name: 'Viabilidade', start: '2026-11-02', end: '2027-02-01' }],
  tasks: [{ kind: 'review', title: 'Revisão de validação', dueDate: '2026-12-01', status: 'planned' }],
  members: [],
  sectors: project.context.sectors,
  artifacts: [],
};
const samples = [
  ['ecss', 'MDR', 'REQ'],
  ['ecss', 'PRR', 'SEMP'],
  ['ecss', 'PRR', 'TB'],
  ['ecss', 'PRR', 'FT'],
  ['ecss', 'SRR', 'ICD'],
  ['ecss', 'CDR', 'VCD'],
  ['ecss', 'MDR', 'SDM'],
  ['nasa', 'SRR', 'VCD'],
  ['nasa', 'MCR', 'SEMP'],
  ['nasa', 'PDR', 'VVP'],
];
const documents = [
  { name: 'fixture', document: fixture },
  ...samples.map(([profile, code, id]) => {
    const options = documentPackage(profile, code),
      definition = options.find(item => item.id === id);
    assert.ok(definition, `${profile} ${code} ${id}`);
    return {
      name: `${profile}-${code}-${definition.code}`,
      document: {
        id: `${definition.code}-${code}`,
        title: definition.title,
        authorName: 'Equipe de validação',
        version: 1,
        status: 'draft',
        body: draftDeliveryDocument(definition, project, requirements, tests, task, { ...context, package: options }),
      },
    };
  }),
];
for (const { name, document } of documents) {
  const zip = documentLatexArchive(document),
    files = unzipSync(zip),
    folder = join(out, name);
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, 'exportacao.zip'), zip);
  for (const file of ['main.tex', 'source.md', 'metadata.json', 'README.txt']) {
    assert.ok(files[file], `Missing ${file}`);
    await writeFile(join(folder, file), files[file]);
  }
}

if (process.argv.includes('--prepare-only')) {
  console.log(`Prepared ${documents.length} generic exports in ${out}`);
} else {
  const run = (args, timeout = 180000) =>
    execFileSync('docker', args, { cwd: root, encoding: 'utf8', timeout, maxBuffer: 16 * 1024 * 1024 });
  const compose = (...args) => run(['compose', '--profile', 'overleaf', ...args]);
  let launchpad = null;
  if (!image) {
    const response = await fetch('http://127.0.0.1:8081/launchpad', { signal: AbortSignal.timeout(15000) });
    assert.equal(response.status, 200, 'Local Overleaf launchpad must respond 200');
    assert.match(await response.text(), /Overleaf/i);
    launchpad = { url: response.url, status: response.status };
  }
  const pdflatexArgs = [
    '-no-shell-escape',
    '-interaction=nonstopmode',
    '-halt-on-error',
    '-file-line-error',
    'main.tex',
  ];
  const compileInImage = folder =>
    run([
      'run',
      '--rm',
      '--network',
      'none',
      '--user',
      `${process.getuid()}:${process.getgid()}`,
      '-v',
      `${folder}:/work`,
      '-w',
      '/work',
      '--entrypoint',
      'pdflatex',
      image,
      ...pdflatexArgs,
    ]);
  const compileInService = folder => {
    const directory = compose('exec', '-T', 'overleaf', 'mktemp', '-d', '/tmp/norte-latex-check.XXXXXX').trim();
    assert.match(directory, /^\/tmp\/norte-latex-check\.[a-zA-Z0-9]+$/);
    const compile = () => compose('exec', '-T', '--workdir', directory, 'overleaf', 'pdflatex', ...pdflatexArgs);
    try {
      compose('cp', join(folder, 'main.tex'), `overleaf:${directory}/main.tex`);
      const log = compile() + compile();
      compose('cp', `overleaf:${directory}/main.pdf`, join(folder, 'main.pdf'));
      compose('cp', `overleaf:${directory}/main.log`, join(folder, 'main.log'));
      return log;
    } finally {
      compose('exec', '-T', 'overleaf', 'rm', '-rf', directory);
    }
  };
  const results = [];
  for (const { name } of documents) {
    const folder = join(out, name);
    let output = '';
    try {
      output = image ? compileInImage(folder) + compileInImage(folder) : compileInService(folder);
    } catch (error) {
      output += String(error.stdout || '') + String(error.stderr || '') + '\n' + error.message;
      await writeFile(join(folder, 'compile-output.log'), output);
      throw new Error(`${name}: pdfLaTeX failed; see ${join(folder, 'compile-output.log')}`, { cause: error });
    }
    await writeFile(join(folder, 'compile-output.log'), output);
    assert.doesNotMatch(output, /Missing character|Undefined control sequence|LaTeX Error:|Unicode character/, name);
    const text = execFileSync('pdftotext', ['-layout', '-enc', 'UTF-8', join(folder, 'main.pdf'), '-'], {
      encoding: 'utf8',
    });
    await writeFile(join(folder, 'pdf-text.txt'), text);
    const pages = Number(/Output written on main\.pdf \((\d+) page/u.exec(output)?.[1] || 0);
    results.push({ name, pages, overfull: (output.match(/Overfull \\hbox/gu) || []).length });
    if (name === 'fixture') {
      for (const symbol of ['≥', '≤', '°', '±']) assert.ok(text.includes(symbol), `PDF lost ${symbol}`);
      assert.match(text, /ação/);
      assert.match(text, /arquivo-inexistente/);
      assert.match(text, /\[Marcador entre colchetes/);
      assert.match(text, /\[U\+2713\]/);
    } else {
      assert.match(text, /RASCUNHO/, name);
      assert.match(text, /Orientação:/, name);
      assert.match(text, /PENDENTE/, name);
    }
  }
  const compiler = (
    image
      ? run(['run', '--rm', '--network', 'none', '--entrypoint', 'pdflatex', image, '--version'])
      : compose('exec', '-T', 'overleaf', 'pdflatex', '--version')
  ).split('\n')[0];
  await writeFile(
    join(out, 'validation.json'),
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        runner: image ? { image } : { compose: 'overleaf', launchpad },
        compiler,
        results,
        assertions: [
          'two pdfLaTeX passes per document',
          'no shell escape',
          'fixture PDF keeps ≥ ≤ ° ±, accents, literal \\input and a leading bracket',
          'unsupported characters appear as code points',
          'ECSS/NASA template drafts compile with guidance, tables and PENDENTE markers',
          'no external upload or user creation',
        ],
      },
      null,
      2,
    ),
  );
  console.log(`PASS: ${results.length} exports compiled twice with pdfLaTeX (${compiler}).`);
  for (const result of results)
    console.log(`  ${result.name}: ${result.pages} page(s), ${result.overfull} overfull box warning(s)`);
}
