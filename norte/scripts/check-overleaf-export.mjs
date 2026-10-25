import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { unzipSync } from 'fflate';
import { documentLatexArchive } from '../server/document-latex.mjs';

// Explicit local validation: generic fixture, no accounts and no external upload.
const root = fileURLToPath(new URL('../../', import.meta.url));
const out = resolve(root, 'novo_teste/resultados/infra/overleaf');
await mkdir(out, { recursive: true });
const fixture = {
  id: 'DOC-VALIDACAO', title: 'Validação LaTeX — critérios & condições',
  authorName: 'Equipe de validação', version: 1, status: 'draft',
  body: '# Validação LaTeX — critérios & condições\n\n## Caracteres de engenharia\n\n- Limite inferior ≥ 300 km; limite superior ≤ 550 kg.\n- Temperatura 20 °C ± 2 °C; dimensão 2 × 3 mm.\n- Rastreabilidade: origem → requisito → verificação.\n- Acentos: ação, revisão, propulsão, água, elétrica.\n\n## Texto literal\n\n**Negrito** e `campo_teste` permanecem legíveis.\nCaracteres reservados: & % $ # _ { } ~ ^ \\.\nEste texto não executa comandos: \\input{arquivo-inexistente}.\n\n## Matriz de validação\n\n| ID | Critério | Método |\n| --- | --- | --- |\n| TESTE_01 | ≥ 300 km & ≤ 550 kg | Análise |\n| TESTE_02 | 20 °C ± 2 °C | Ensaio |',
};
const zip = documentLatexArchive(fixture);
await writeFile(join(out, 'exportacao-teste.zip'), zip);
const files = unzipSync(zip);
for (const name of ['main.tex', 'source.md', 'metadata.json', 'README.txt']) {
  assert.ok(files[name], `Missing ${name}`);
  await writeFile(join(out, name), files[name]);
}
if (process.argv.includes('--prepare-only')) {
  console.log(`Prepared generic fixture in ${out}`);
} else {
  const launchpad = await fetch('http://127.0.0.1:8081/launchpad', { signal: AbortSignal.timeout(15000) });
  assert.equal(launchpad.status, 200, 'Local Overleaf launchpad must respond 200');
  assert.match(await launchpad.text(), /Overleaf/i);
  const docker = (...args) => execFileSync('docker', ['compose', '--profile', 'overleaf', ...args], {
    cwd: root, encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024,
  });
  const directory = docker('exec', '-T', 'overleaf', 'mktemp', '-d', '/tmp/norte-latex-check.XXXXXX').trim();
  assert.match(directory, /^\/tmp\/norte-latex-check\.[a-zA-Z0-9]+$/);
  let output = '';
  try {
    docker('cp', join(out, 'main.tex'), `overleaf:${directory}/main.tex`);
    for (let pass = 1; pass <= 2; pass++) {
      output += `Compilation ${pass}\n` + docker('exec', '-T', '--workdir', directory, 'overleaf',
        'pdflatex', '-no-shell-escape', '-interaction=nonstopmode', '-halt-on-error', '-file-line-error', 'main.tex');
    }
    docker('cp', `overleaf:${directory}/main.pdf`, join(out, 'main.pdf'));
    docker('cp', `overleaf:${directory}/main.log`, join(out, 'main.log'));
    const text = execFileSync('pdftotext', ['-layout', '-enc', 'UTF-8', join(out, 'main.pdf'), '-'], { encoding: 'utf8' });
    await writeFile(join(out, 'pdf-text.txt'), text);
    for (const symbol of ['≥', '≤', '°', '±']) assert.ok(text.includes(symbol), `PDF lost ${symbol}`);
    assert.match(text, /ação/);
    assert.match(text, /arquivo-inexistente/);
    assert.doesNotMatch(output, /Missing character|Undefined control sequence|LaTeX Error:/);
    await writeFile(join(out, 'validation.json'), JSON.stringify({
      checkedAt: new Date().toISOString(), launchpad: { url: launchpad.url, status: launchpad.status },
      compiler: docker('exec', '-T', 'overleaf', 'pdflatex', '--version').split('\n')[0],
      compose: docker('ps', '--format', 'json').trim().split('\n').map(line => JSON.parse(line)).map(item => ({ service: item.Service, state: item.State, image: item.Image, ports: item.Publishers })),
      assertions: ['two pdfLaTeX passes', 'no shell escape', 'PDF contains ≥ ≤ ° ± and Portuguese accents', 'input command stays literal', 'no external upload or user creation'],
    }, null, 2));
    console.log('PASS: local launchpad, ZIP, two pdfLaTeX passes, reserved characters, Portuguese accents and ≥ ≤ ° ± retained in PDF.');
  } catch (error) {
    output += String(error.stdout || '') + String(error.stderr || '') + '\n' + error.message;
    throw error;
  } finally {
    await writeFile(join(out, 'compile-output.log'), output);
    docker('exec', '-T', 'overleaf', 'rm', '-rf', directory);
  }
}
