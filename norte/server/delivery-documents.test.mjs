import test from 'node:test';
import assert from 'node:assert/strict';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { draftDeliveryDocument, deliveryPdf } from './delivery-documents.mjs';

test('document drafts preserve traceability and make missing evidence explicit', () => {
  const body=draftDeliveryDocument({title:'Matriz de rastreabilidade',content:'traceability'}, {name:'Projeto de teste'}, [{id:'REQ-1',title:'Temperatura',statement:'A temperatura deve ser ≤ 35 °C.',version:2,status:'draft',sourceRefs:['SRC-1'],parentIds:['SYS-1']}], [], {title:'SRR',dueDate:''});
  assert.match(body,/\| REQ-1 · v2 \| SRC-1, SYS-1 \| PENDENTE \| PENDENTE \|/);
  assert.match(body,/≤ 35 °C/);assert.match(body,/PENDENTE — definir critério/);
  assert.doesNotMatch(body,/Execuções registradas: [1-9]/);
  const spec=draftDeliveryDocument({title:'Especificação',content:'requirements'}, {name:'Projeto de teste'}, [{id:'REQ-2',title:'Massa',statement:'A massa deve ser ≤ 2 kg.',version:1,status:'in_review',method:'unspecified'}], [], null);
  assert.match(spec,/Situação de revisão: Em revisão/);assert.match(spec,/Método: A definir/);assert.doesNotMatch(spec,/in_review|unspecified/);
});

test('PDF preserves engineering symbols, long tables, version metadata and review decisions across pages', async () => {
  const rows=Array.from({length:90},(_,index)=>`| REQ-${index} | Tolerância ≤ ${index+1} µm; variação ΔT ≥ 2 °C. | PENDENTE |`);
  const bytes=await deliveryPdf({id:'DOC-TEST',title:'Matriz técnica',version:3,status:'approved',profile:'ecss',authorName:'Engenharia',updatedAt:'2026-10-24T12:00:00Z',body:`# Matriz técnica\n\n| ID | Critério | Evidência |\n| --- | --- | --- |\n${rows.join('\n')}\n\n## Pendências\nConferir todas as fontes.`,decisions:[{authorName:'Revisor',version:3,decision:'approve',comment:'Vínculos conferidos.'}]});
  assert.equal(bytes.subarray(0,5).toString(),'%PDF-');
  const loading=getDocument({data:new Uint8Array(bytes),useSystemFonts:true});
  const pdf=await loading.promise;
  assert.ok(pdf.numPages>2&&pdf.numPages<15);
  const pages=[];
  for(let page=1;page<=pdf.numPages;page++){const content=await (await pdf.getPage(page)).getTextContent();pages.push(content.items.map(item=>item.str||'').join(' '));}
  const all=pages.join(' ');
  assert.match(all,/REQ-0/);assert.match(all,/REQ-89/);assert.match(all,/≤ 90 [µμ]m/);assert.match(all,/ΔT ≥ 2 °C/);
  assert.match(all,/Revisor/);assert.match(all,/Vínculos conferidos/);
  for(let page=0;page<pages.length;page++){assert.match(pages[page],/DOC-TEST · v3 · APROVADO/);assert.ok(pages[page].includes(`${page+1} / ${pages.length}`));}
  await loading.destroy();
});
