import test from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'fflate';
import { documentLatex, documentLatexArchive } from './document-latex.mjs';

test('LaTeX archive retains source and review version without allowing injected commands', () => {
  const document = { id: 'DOC-LYLE', title: 'Critérios & condições', version: 3, status: 'draft', body: '# Critérios & condições\n\n## Revisão\n\n- **Massa:** 500 kg\n- \\input{/etc/passwd}\n\n| ID | Critério |\n| --- | --- |\n| REQ_01 | ≥ 300 km |' };
  const files = unzipSync(documentLatexArchive(document));
  assert.equal(strFromU8(files['source.md']), document.body);
  assert.equal(JSON.parse(strFromU8(files['metadata.json'])).version, 3);
  const tex = strFromU8(files['main.tex']);
  assert.match(tex, /\\textbf\{Massa:\}/u);
  assert.match(tex, /\\begin\{longtable\}/u);
  assert.doesNotMatch(tex, /\\input\{/u);
  assert.match(tex, /\\textbackslash\{\}input\\\{/u);
  assert.equal(tex, documentLatex(document));
});
