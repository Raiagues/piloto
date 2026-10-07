const test=require('node:test'),assert=require('node:assert/strict');
const Document=require('../meeting-document.js'),Minutes=require('../meeting-minutes.js');
const node=(id,type,text,extra={})=>({id,type,text,current:true,status:'open',completed:false,relations:[],...extra});
function fixture(){
 const context=node('E001','observation','A viga de referência tem 6 m.'),hypothesis=node('E002','hypothesis','Reduzir o comprimento pode reduzir o momento.'),requirement=node('E003','requirement','Manter a força de 10 kN.'),test=node('E004','test_proposal','Simular a viga com 4 m.',{completed:true,status:'completed'}),result=node('E005','test_result','O momento na simulação foi 40 kN·m.'),decision=node('E006','decision','Adotar o comprimento de 4 m.'),pending=node('E007','test_proposal','Repetir a simulação com 12 kN.'),question=node('E008','other','Qual é o limite de deslocamento?'),orphan=node('E009','test_result','Foi obtido deslocamento de 5 mm.',{standalone:true});
 const link=(event,type)=>({event,event_id:event.id,type,direction:'incoming',confirmed:true,compatible:true,usable:true,event_current:true});
 test.results=[link(result,'result_of')];decision.evidence=[link(result,'based_on')];
 return {title:'Tópicos discutidos',batch_id:'FORMATO',event_count:9,issues:[{id:'orphan_result:E009',code:'orphan_result',event_id:'E009',resolved:true,disposition:'unknown'},{id:'unconfirmed_test:E007',code:'unconfirmed_test',event_id:'E007',resolved:true,disposition:'pending_confirmed'}],topics:[{thread_id:'T001',untitled:true,title:'Assunto 1 · sem título',current:{open_points:[context,hypothesis,question],requirements:[requirement],tests:[test,pending,orphan],decisions:[decision],actions:[pending]},history:{events:[context,hypothesis,requirement,test,result,decision,pending,question,orphan],changes:[{before:['old']}],summary:{text:'Historical notes'}}}]};
}
const blocks=doc=>doc.threads.flatMap(thread=>thread.sections.flatMap(section=>section.blocks));
test('context is untitled, sections follow the review order and incomplete tests appear only in Em aberto',()=>{
 const doc=fixture(),topic=doc.topics[0],before=JSON.stringify(doc),sections=Document.sectionsForTopic(topic,1);
 assert.deepEqual(sections.map(section=>[section.key,section.title]),[['context',''],['hypotheses','1.1 Hipóteses'],['tests','1.2 Testes'],['decisions','1.3 Concluído'],['actions','1.4 Em aberto']]);
 assert.deepEqual(sections[0].entries.map(entry=>entry.id),['E001','E003']);
 assert.deepEqual(sections.at(-1).entries.map(entry=>entry.id),['E007','E008']);
 assert.deepEqual(sections.find(section=>section.key==='tests').entries.map(entry=>entry.id),['E004','E009']);
 assert.equal(JSON.stringify(doc),before);
});
test('PDF retains wording and nesting without visible IDs, technical status copy or discussion history',()=>{
 const doc=fixture(),pdf=Document.pdfDocument(doc),all=blocks(pdf),text=all.map(block=>block.text).join('\n');
 assert.equal(pdf.threads[0].title,'Assunto 1: sem título');assert.equal(pdf.contents[0].target_id,'topic:T001');
 assert.doesNotMatch(text,/E00\d|Historical notes|Resultado compatível registrado|Sem conclusão compatível|Pendente:|Realizado:/);
 assert.ok(!pdf.threads.some(thread=>thread.id==='warnings'));assert.equal(pdf.reviewLabel,undefined);
 assert.equal(all.find(block=>block.text==='Simular a viga com 4 m.').marker,'done');
 assert.equal(all.find(block=>block.text==='Repetir a simulação com 12 kN.').marker,'todo');
 assert.equal(all.find(block=>block.text.startsWith('Resultado:')).depth,1);
 assert.deepEqual(all.filter(block=>block.text==='Teste desconhecido').map(block=>block.warning_ids),[['orphan_result:E009']]);
 assert.ok(!all.find(block=>block.text==='Repetir a simulação com 12 kN.').warning_ids.length);
 assert.ok(pdf.threads[0].sections.every(section=>!section.table&&!section.layout&&!section.id.includes('history')));
});
test('sentence references and inline warnings have real invisible destinations',()=>{
 const pdf=Document.pdfDocument(fixture()),plan=Minutes.pdfPlan(pdf),all=blocks(pdf),anchors=all.flatMap(block=>[block.anchor_id,...(block.anchor_aliases||[])].filter(Boolean));
 assert.ok(all.some(block=>block.text.startsWith('Base da decisão:')&&block.link_to==='event:E005'));
 for(const block of all){if(block.link_to)assert.ok(plan.declared.has(block.link_to));for(const id of block.warning_ids||[])assert.ok(plan.declared.has('warning:'+id));}
 for(const id of new Set(all.map(block=>block.anchor_id).filter(Boolean)))assert.equal(anchors.filter(anchor=>anchor===id).length,1);
});
test('a source-backed summary replaces only covered context bullets, retaining their link destinations',()=>{
 const doc=fixture();doc.topics[0].summary={text:'Viga de 6 m com força de 10 kN.',event_ids:['E001','E003']};
 const sections=Document.sectionsForTopic(doc.topics[0]),context=sections[0];assert.equal(context.entries.length,1);assert.equal(context.entries[0].text,'Viga de 6 m com força de 10 kN.');
 const pdf=Document.pdfDocument(doc),plan=Minutes.pdfPlan(pdf);assert.ok(plan.declared.has('event:E001'));assert.ok(plan.declared.has('event:E003'));
 assert.doesNotMatch(blocks(pdf).filter(block=>block.depth===0).map(block=>block.text).join('\n'),/A viga de referência/);
});
test('incompatible result edges never present a completion and no generic warnings enter the PDF',()=>{
 const doc=fixture(),test=doc.topics[0].current.tests[0];test.results[0].compatible=false;test.completed=false;test.status='open';doc.topics[0].current.actions.push(test);
 doc.warnings=[{id:'generic',message:'Revisões pendentes — ata não validada integralmente'}];
 const pdf=Document.pdfDocument(doc),all=blocks(pdf);assert.ok(!all.some(block=>block.text.startsWith('Resultado: O momento')));
 assert.equal(all.find(block=>block.text==='Simular a viga com 4 m.').marker,'todo');
 assert.doesNotMatch(JSON.stringify(pdf),/Revisões pendentes|não validada integralmente/);
});
