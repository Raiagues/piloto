const test=require('node:test'),assert=require('node:assert/strict');
const Document=require('../meetings/web/meeting-document.js'),Minutes=require('../meetings/web/meeting-minutes.js');
const node=(id,type,text,extra={})=>({id,type,text,current:true,status:'open',completed:false,relations:[],...extra});
function fixture(){
 const context=node('E001','observation','A viga de referência tem 6 m.'),hypothesis=node('E002','hypothesis','Reduzir o comprimento pode reduzir o momento.'),requirement=node('E003','requirement','Manter a força de 10 kN.'),test=node('E004','test_proposal','Simular a viga com 4 m.',{completed:true,status:'completed'}),result=node('E005','test_result','O momento na simulação foi 40 kN·m.'),decision=node('E006','decision','Adotar o comprimento de 4 m.'),pending=node('E007','test_proposal','Repetir a simulação com 12 kN.'),question=node('E008','other','Qual é o limite de deslocamento?'),orphan=node('E009','test_result','Foi obtido deslocamento de 5 mm.',{standalone:true});
 const link=(event,type)=>({event,event_id:event.id,type,direction:'incoming',confirmed:true,compatible:true,usable:true,event_current:true});
 test.results=[link(result,'result_of')];decision.evidence=[link(result,'based_on')];
 return {title:'Tópicos discutidos',batch_id:'FORMATO',event_count:9,issues:[{id:'orphan_result:E009',code:'orphan_result',event_id:'E009',resolved:true,disposition:'unknown'},{id:'unconfirmed_test:E007',code:'unconfirmed_test',event_id:'E007',resolved:true,disposition:'pending_confirmed'}],topics:[{thread_id:'T001',untitled:true,title:'Assunto 1 · sem título',current:{open_points:[context,hypothesis,question],requirements:[requirement],tests:[test,pending,orphan],decisions:[decision],actions:[pending]},history:{events:[context,hypothesis,requirement,test,result,decision,pending,question,orphan],changes:[{before:['old']}],summary:{text:'Historical notes'}}}]};
}
const blocks=doc=>doc.threads.flatMap(thread=>thread.sections.flatMap(section=>section.blocks));
test('six fixed section numbers separate current tests from results and pending work',()=>{
 const doc=fixture(),topic=doc.topics[0],before=JSON.stringify(doc),sections=Document.sectionsForTopic(topic,1);
 assert.deepEqual(sections.map(section=>[section.key,section.title]),[['context','1.1 Contexto e requisitos'],['hypotheses','1.2 Hipóteses'],['tests','1.3 Testes realizados'],['results','1.4 Resultados'],['decisions','1.5 Decisões'],['actions','1.6 Pendências']]);
 assert.deepEqual(sections[0].entries.map(entry=>entry.id),['E001','E003']);
 assert.deepEqual(sections.at(-1).entries.map(entry=>entry.id),['E007','E008']);
 assert.deepEqual(sections.find(section=>section.key==='tests').entries.map(entry=>entry.id),['E004']);
 assert.deepEqual(sections.find(section=>section.key==='results').entries.map(entry=>entry.id),['E005','E009']);
 assert.equal(JSON.stringify(doc),before);
});
test('PDF retains wording and nesting without visible IDs, technical status copy or discussion history',()=>{
 const doc=fixture(),pdf=Document.pdfDocument(doc),all=blocks(pdf),text=all.map(block=>block.text).join('\n');
 assert.equal(pdf.threads[0].title,'Assunto 1: sem título');assert.equal(pdf.contents[0].target_id,'topic:T001');
 assert.doesNotMatch(text,/E00\d|Historical notes|Resultado compatível registrado|Sem conclusão compatível|Pendente:|Realizado:/);
 assert.ok(!pdf.threads.some(thread=>thread.id==='warnings'));assert.equal(pdf.reviewLabel,undefined);
 assert.equal(all.find(block=>block.text==='Simular a viga com 4 m.').marker,'bullet');
 assert.equal(all.find(block=>block.text==='Repetir a simulação com 12 kN.').marker,'bullet');
 assert.equal(all.find(block=>block.text.startsWith('Resultado:')).depth,1);
 assert.equal(all.find(block=>block.text==='Teste de origem não identificado').depth,1);
 assert.deepEqual(all.find(block=>block.event_ids?.includes('E009')&&block.depth===0).warning_ids,['orphan_result:E009']);
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
 assert.equal(all.find(block=>block.text==='Simular a viga com 4 m.').marker,'bullet');
 assert.doesNotMatch(JSON.stringify(pdf),/Revisões pendentes|não validada integralmente/);
});
test('concise display text is used without mutating facts, and repeated evidence becomes a short reference',()=>{
 const doc=fixture(),topic=doc.topics[0],source=topic.history.events.find(entry=>entry.id==='E005');
 source.display_text='Momento: 40 kN·m.';source.ref_label='Ref. 5';const before=JSON.stringify(doc),pdf=Document.pdfDocument(doc),all=blocks(pdf);
 assert.equal(JSON.stringify(doc),before);assert.equal(Document.eventText(source),'Momento: 40 kN·m.');assert.equal(source.text,'O momento na simulação foi 40 kN·m.');
 assert.equal(all.filter(block=>block.text==='Momento: 40 kN·m.').length,1);
 assert.ok(all.some(block=>block.text==='Base da decisão: Ref. 5'));assert.ok(all.some(block=>block.text==='Resultado: Ref. 5'));
 const historical=node('E010','decision','VERSÃO ANTIGA',{current:false});topic.history.events.push(historical);
 assert.doesNotMatch(JSON.stringify(Document.pdfDocument(doc)),/VERSÃO ANTIGA/);
});
test('brief incompatibility explanations cite a requirement without inventing a threshold',()=>{
 const doc=fixture(),topic=doc.topics[0],entry=topic.current.decisions[0],requirement=topic.current.requirements[0];
 entry.relations=[{event:requirement,event_id:requirement.id,type:'contradicts',direction:'outgoing',confirmed:true,compatible:true,usable:true,event_current:true}];
 assert.deepEqual(Document.briefReasons(entry),[{text:'Contradiz requisito',event_ids:['E003']}]);
 let all=blocks(Document.pdfDocument(doc));assert.ok(all.some(block=>block.detail_reason&&block.text==='Contradiz requisito · Ref. 3'));
 assert.equal(all.some(block=>block.text==='Contradiz: Ref. 3'),false,'a traced incompatibility reason does not repeat the same relation');assert.equal(all.find(block=>block.detail_reason&&block.text==='Contradiz requisito · Ref. 3').link_to,'event:E003');
 assert.ok(all.some(block=>block.text==='Base da decisão: Ref. 5'),'other evidence references remain available');
 entry.relations[0].configuration_match='mismatch';entry.relations[0].usable=false;
 assert.deepEqual(Document.briefReasons(entry),[{text:'Configuração diferente da referência',event_ids:['E003']}]);
 entry.relations[0].confirmed=false;assert.deepEqual(Document.briefReasons(entry),[]);
});
test('generic comparison tables accept only exact quotations from current events and preserve row references',()=>{
 const doc=fixture(),topic=doc.topics[0];topic.tables=[{title:'Valores comparados',columns:['Grandeza','Valor'],rows:[{event_id:'E005',cells:['momento','40 kN·m']}]}];
 const before=JSON.stringify(doc),sections=Document.sectionsForTopic(topic),table=sections.find(section=>section.key==='results').tables[0];
 assert.deepEqual(table.headers,['Grandeza','Valor','Referência']);assert.deepEqual(table.rows[0].cells,['momento','40 kN·m','Ref. 5']);assert.equal(JSON.stringify(doc),before);
 const pdf=Document.pdfDocument(doc);assert.equal(pdf.threads[0].sections.find(section=>section.id.endsWith(':results')).tables[0].rows[0].anchor_id,undefined,'the same event already has one canonical paragraph');
 topic.tables[0].rows[0].cells[1]='50 kN·m';assert.deepEqual(Document.topicTables(topic),[],'no invented or cross-event value');
 topic.tables[0].rows[0].cells[1]='40 kN·m';topic.history.events.find(entry=>entry.id==='E005').current=false;assert.deepEqual(Document.topicTables(topic),[],'retired rows are excluded');
});
test('meeting links carry only meeting and event identity and never credentials or provider settings',()=>{
 const base=Document.meetingURL({id:'reunião & 1',room_kind:'beam'},'https://norte.example/path?api_key=secret');
 assert.equal(base,'https://norte.example/?meeting=reuni%C3%A3o+%26+1#simulacao');
 const event=Document.eventURL(base.replace('#','&token=secret#'),'E001');const url=new URL(event);
 assert.equal(url.searchParams.get('event'),'E001');assert.equal(url.searchParams.has('token'),false);assert.equal(url.hash,'#simulacao');
 assert.equal(Document.meetingURL({id:'one'},'javascript:alert(1)'), '');assert.equal(Document.eventURL('https://name:password@example.com/?meeting=one','E1'),'');
 const doc=fixture();doc.meeting_url=base;const pdf=Document.pdfDocument(doc),all=blocks(pdf),plan=Minutes.pdfPlan(pdf);
 assert.ok(all.find(block=>block.text==='Base da decisão: Ref. 5').external_url.includes('event=E005'));assert.equal(plan.external_targets.get('event:E001'),Document.eventURL(base,'E001'));
 assert.equal(plan.external_targets.has('event:E404'),false);
});
test('tables retain missing values as a dash and accept quoted whitespace normalization',()=>{
 const topic=fixture().topics[0];topic.tables=[{title:'Medições',columns:['Inicial','Final'],rows:[{event_id:'E005',cells:['','40\n kN·m']}]}];
 const table=Document.topicTables(topic)[0];assert.deepEqual(table.rows[0].cells,['—','40 kN·m','Ref. 5']);
 topic.tables[0].rows[0].cells[1]='50\n kN·m';assert.deepEqual(Document.topicTables(topic),[],'normalizing whitespace must not permit a changed value');
});
test('every current record remains represented exactly once even when it has no classified group',()=>{
 const topic=fixture().topics[0],unclassified=node('E010','other','Ana vai comprar o material.');topic.history.events.push(unclassified,node('E011','other','Registro anterior',{current:false}));
 topic.current.open_points.push(topic.current.decisions[0]);const before=JSON.stringify(topic),sections=Document.sectionsForTopic(topic),ids=sections.flatMap(section=>section.entries.flatMap(entry=>entry.type==='summary'?entry.event_ids:[entry.id]));
 assert.deepEqual([...ids].sort(),topic.history.events.filter(entry=>entry.current!==false).map(entry=>entry.id).sort());assert.equal(new Set(ids).size,ids.length);assert.equal(JSON.stringify(topic),before);
 assert.ok(sections.find(section=>section.key==='context').entries.some(entry=>entry.id==='E010'));
 assert.equal(sections.find(section=>section.key==='context').entries.find(entry=>entry.id==='E010').status,'open','existing state is preserved');
});
test('table limits match the provider contract and do not silently truncate values',()=>{
 const topic=fixture().topics[0],base={title:'Valores',columns:['Grandeza','Valor'],rows:[{event_id:'E005',cells:['momento','40 kN·m']}]};
 topic.tables=Array.from({length:4},()=>structuredClone(base));assert.deepEqual(Document.topicTables(topic),[]);
 topic.tables=[structuredClone(base)];topic.tables[0].columns=Array(6).fill('Coluna');assert.deepEqual(Document.topicTables(topic),[]);
 topic.tables=[structuredClone(base)];topic.tables[0].rows=Array.from({length:17},()=>base.rows[0]);assert.deepEqual(Document.topicTables(topic),[]);
 topic.tables=[structuredClone(base)];topic.tables[0].rows[0].cells[1]='x'.repeat(121);assert.deepEqual(Document.topicTables(topic),[]);
 topic.tables=[structuredClone(base)];topic.tables[0].rows[0].cells=['',' '];assert.deepEqual(Document.topicTables(topic),[]);
});
test('incompatibility notes retain the real human reference label when the result link is not usable',()=>{
 const related=node('E005','test_proposal','Medir a espessura de 4 mm.',{ref_label:'Ref. 2'}),entry=node('E008','test_result','A espessura usada foi 5 mm.',{ref_label:'Ref. 3'});
 entry.relations=[{type:'result_of',configuration_match:'mismatch',event:related,event_id:related.id,confirmed:true,compatible:false,usable:false}];
 const blocks=Document.entryBlocks(entry,'results'),note=blocks.find(block=>block.detail_reason);
 assert.equal(note.text,'Configuração diferente da referência · Ref. 2');assert.equal(note.link_to,'event:E005');
});
