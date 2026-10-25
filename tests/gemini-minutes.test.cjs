const test=require('node:test'),assert=require('node:assert/strict');
global.NorteMinutes=require('../meetings/web/meeting-minutes.js');
global.NorteMeetingEvidence=require('../meetings/web/meeting-evidence.js');
global.NorteMeetingHierarchy=require('../meetings/web/meeting-hierarchy.js');
global.NorteMeetingState=require('../meetings/web/meeting-state.js');
require('../meetings/web/gemini-minutes.js');
const M=global.NorteGeminiMinutes;
const edge=(source,target,type,match='not_applicable')=>({source_event_id:source,target_event_id:target,relation_type:type,configuration_match:match,review_state:'confirmed',relation_probability:.99,match_probability:.99});
function run(){return {id:'document-1',status:'done',meeting_threads:[{thread_id:'T1'}],topic_titles:{T1:'Deformação do suporte'},typed_relation_worker:{status:'done',jobs:[]},meeting_events:[
 {event_id:'E1',thread_id:'T1',type:'observation',text:'O suporte deforma sob carga.'},
 {event_id:'E2',thread_id:'T1',type:'hypothesis',text:'A rigidez pode explicar a deformação.'},
 {event_id:'E3',thread_id:'T1',type:'test_proposal',text:'Testar a rigidez sob 20 N.'},
 {event_id:'E4',thread_id:'T1',type:'test_result',text:'No teste sob 20 N, a deformação excedeu o limite.'},
 {event_id:'E5',thread_id:'T1',type:'test_proposal',text:'Repetir amanhã sob a mesma carga.'}
 ].map(event=>({...event,store_confidence:.99,type_confidence:.99})),meeting_relations:[edge('E2','E1','related_to'),edge('E3','E2','tests'),edge('E4','E3','result_of','exact')]};}
const A=require('../meetings/web/meeting-amendments.js');
const blocks=pdf=>pdf.threads.flatMap(thread=>thread.sections.flatMap(section=>section.blocks));
const printed=pdf=>pdf.threads.map(thread=>thread.title+'\n'+thread.sections.map(section=>section.title+'\n'+section.blocks.map(block=>block.text).join('\n')).join('\n')).join('\n');
test('current source state is preserved while the PDF separates completed tests and remaining work',()=>{
 const r=run(),before=JSON.stringify(r),doc=M.localDocument(r),topic=doc.topics[0],pdf=M.pdfDocument(doc,{});
 assert.equal(doc.presentation,'current_only');assert.equal(doc.mode,'local');assert.equal(topic.title,'Deformação do suporte');
 assert.deepEqual(topic.current.open_points.map(e=>e.id),['E1','E2']);assert.deepEqual(topic.current.actions.map(e=>e.id),['E5']);
 assert.equal(topic.current.tests[0].results[0].event_id,'E4');assert.equal(topic.current.tests[0].completed,true);
 assert.deepEqual(topic.history.events.map(e=>e.id),['E1','E2','E3','E4','E5']);assert.equal(JSON.stringify(r),before);
 assert.deepEqual(pdf.threads[0].sections.map(section=>section.title),['1.1 Contexto e requisitos','1.2 Hipóteses','1.3 Testes realizados','1.4 Resultados','1.6 Pendências']);
 assert.equal(pdf.threads[0].sections.at(-1).blocks[0].text,'Repetir amanhã sob a mesma carga.');
 assert.ok(blocks(pdf).some(block=>block.text==='No teste sob 20 N, a deformação excedeu o limite.'&&block.depth===0));
 assert.doesNotMatch(printed(pdf),/\[E\d+\]|Histórico|Resultado compatível registrado|Sem conclusão compatível/);assert.equal(pdf.reviewLabel,undefined);
});
test('mismatched results require attribution and unfinished tests require explicit confirmation',()=>{
 const r=run();r.meeting_relations[2].configuration_match='mismatch';let doc=M.localDocument(r);
 assert.equal(doc.topics[0].current.tests[0].completed,false);assert.ok(doc.issues.some(issue=>issue.code==='orphan_result'&&issue.event_id==='E4'&&!issue.resolved));
 assert.ok(doc.issues.some(issue=>issue.code==='unconfirmed_test'&&issue.event_id==='E3'&&!issue.resolved));
 A.record(r,{type:'acknowledge_unknown',result_id:'E4'});A.record(r,{type:'confirm_pending',test_id:'E3',note:'Validar a condição de apoio.'});A.record(r,{type:'confirm_pending',test_id:'E5',note:'A repetição ainda será feita.'});
 doc=M.localDocument(r);assert.ok(doc.issues.every(issue=>issue.resolved));const pdf=M.pdfDocument(doc,{});
 assert.match(printed(pdf),/Teste de origem não identificado/);assert.ok(blocks(pdf).some(block=>block.text==='Teste de origem não identificado'));
 assert.ok(!pdf.threads.some(thread=>thread.id==='warnings'));assert.ok(blocks(pdf).filter(block=>block.marker==='todo').every(block=>!block.warning_ids.length));
});
test('only test attribution and completion are PDF review issues; title and human edits invalidate source cache',()=>{
 const r=run(),source=M.sourceFor(r),id=global.NorteMinutes.fingerprint(source);assert.equal(source.threads[0].title,'Deformação do suporte');
 r.topic_titles.T1='Novo título';assert.notEqual(global.NorteMinutes.fingerprint(M.sourceFor(r)),id);
 r.status='stopped';delete r.typed_relation_worker;const local=M.localDocument(r);assert.ok(local.issues.every(issue=>['orphan_result','unconfirmed_test'].includes(issue.code)));
 assert.doesNotMatch(printed(M.pdfDocument(local,{})),/Execução incompleta|não validada integralmente/);
 const previous=global.NorteMinutes.fingerprint(M.sourceFor(r));A.record(r,{type:'confirm_pending',test_id:'E5',note:'Repetir na bancada.'});assert.notEqual(global.NorteMinutes.fingerprint(M.sourceFor(r)),previous);
});
test('events below 60% never enter the document or organization input and original extraction is unchanged',()=>{
 const r=run();r.meeting_events[0].store_confidence=.59;r.meeting_events[1].type_confidence=.599;const before=JSON.stringify(r);
 const source=M.sourceFor(r),doc=M.localDocument(r);assert.deepEqual(source.events.map(e=>e.event_id),['E3','E4','E5']);assert.equal(doc.event_count,3);assert.equal(source.relations.length,1);assert.equal(JSON.stringify(r),before);
 assert.doesNotMatch(printed(M.pdfDocument(doc,{})),/O suporte deforma sob carga|A rigidez pode explicar a deformação/);
});
test('events at 60% appear in the current document without confirming uncertain relationships',()=>{
 const r=run();r.meeting_events[0].store_confidence=.6;r.meeting_events[1].type_confidence=.6;r.meeting_relations.forEach(edge=>{edge.relation_probability=.65;});
 const before=JSON.stringify(r),source=M.sourceFor(r),doc=M.localDocument(r);
 assert.equal(source.events.length,5);assert.equal(doc.event_count,5);assert.equal(source.relations.length,0);
 assert.match(printed(M.pdfDocument(doc,{})),/O suporte deforma sob carga|A rigidez pode explicar a deformação/);assert.equal(JSON.stringify(r),before);
});
test('unnamed topics use a short source excerpt and imported timestamps are not confused with upload time',()=>{
 const r=run();delete r.topic_titles;r.meeting_threads[0].title='Automatically guessed title';r.input_mode='import';r.startedAt='2026-10-06T12:00:00Z';r.finishedAt='2026-10-06T12:00:01Z';r.transcript=[{offsetMs:0},{offsetMs:464000}];
 r.meeting_threads.push({thread_id:'T2'});r.meeting_events.push({event_id:'E6',thread_id:'T2',type:'observation',text:'Outro assunto.',store_confidence:.99,type_confidence:.99});const before=JSON.stringify(r),doc=M.localDocument(r),pdf=M.pdfDocument(doc,{});
 assert.deepEqual(doc.topics.map(topic=>topic.title),['O suporte deforma sob carga.','Outro assunto.']);assert.deepEqual(pdf.contents.map(item=>item.title),doc.topics.map((topic,index)=>'Assunto '+(index+1)+': '+topic.title));
 assert.match(doc.metadata.date,/Não informada na transcrição/);assert.match(doc.metadata.time,/Não informado na transcrição/);assert.equal(doc.metadata.duration,'7 min 44 s');assert.equal(doc.metadata.participants,'Não informados');assert.equal(JSON.stringify(r),before);
});
test('replacements remain auditable internally but only the current decision and evidence are printed',()=>{
 const r=run();r.meeting_events.push(...[{event_id:'E6',thread_id:'T1',type:'decision',text:'Adotar a configuração inicial.'},{event_id:'E7',thread_id:'T1',type:'decision',text:'Adotar a configuração revisada.'},{event_id:'E8',thread_id:'T1',type:'requirement',text:'A deformação deve ficar abaixo de 2 mm.'}].map(e=>({...e,store_confidence:.99,type_confidence:.99})));
 r.meeting_relations.push(edge('E7','E6','supersedes'),edge('E7','E4','based_on'),edge('E7','E5','affects'),edge('E4','E8','contradicts'));
 const doc=M.localDocument(r),t=doc.topics[0],change=t.history.changes[0];assert.deepEqual(t.current.decisions.map(e=>e.id),['E7']);assert.deepEqual(change.before.map(e=>e.event_id),['E6']);assert.deepEqual(change.reason.map(e=>e.event_id),['E4']);assert.deepEqual(change.consequences.map(e=>e.event_id),['E5']);
 const pdf=M.pdfDocument(doc,{});assert.doesNotMatch(printed(pdf),/Adotar a configuração inicial/);assert.match(printed(pdf),/Base da decisão: Ref. 4/);assert.ok(pdf.threads[0].sections.every(section=>!section.table&&!section.id.includes('history')));assert.equal(pdf.threads[0].sections[0].title,'1.1 Contexto e requisitos');assert.match(pdf.threads[0].sections[0].blocks.map(b=>b.text).join('\n'),/A deformação deve ficar abaixo de 2 mm/);
});
test('organization can add source-backed context but cannot change event membership or close tests',()=>{
 const r=run(),before=M.localDocument(r),organized=M.organizedDocument(r,{topics:[{thread_id:'T1',summary:{text:'Foram discutidas rigidez e deformação.',event_ids:['E1','E2']},actions:[{id:'unsafe',event_ids:['E3'],status:'done',text:'Invented closure'}]}],warnings:[{id:'W1',target_id:'unsafe',message:'Confira a fonte.',event_ids:['E3']}]});
 assert.deepEqual(organized.topics[0].current,before.topics[0].current);assert.deepEqual(organized.topics[0].history.events,before.topics[0].history.events);assert.equal(organized.topics[0].summary.text,'Foram discutidas rigidez e deformação.');
 const pdf=M.pdfDocument(organized,{});assert.equal(pdf.threads[0].sections[0].blocks[0].text,'Foram discutidas rigidez e deformação.');assert.doesNotMatch(printed(pdf),/Invented closure|Confira a fonte/);assert.equal(organized.organization_diagnostics[0].id,'W1');
 assert.equal(M.organizedDocument(r,{topics:[{thread_id:'T1',summary:{text:'Unsupported text',event_ids:['missing']}}]}).topics[0].summary,undefined);
});
test('withdrawn results remain in internal history and cannot complete a current test or appear as its result',()=>{
 const r=run();r.meeting_events.push({event_id:'E6',thread_id:'T1',type:'test_result',text:'O resultado anterior foi retirado.',store_confidence:.99,type_confidence:.99});r.meeting_relations.push(edge('E6','E4','supersedes'));
 const doc=M.localDocument(r);assert.equal(doc.topics[0].current.tests.find(entry=>entry.id==='E3').completed,false);
 assert.doesNotMatch(printed(M.pdfDocument(doc,{})),/No teste sob 20 N, a deformação excedeu o limite/);assert.ok(doc.topics[0].history.events.some(entry=>entry.id==='E4'&&!entry.current));
});
test('requirements are introductory bullets, questions stay last and each current event has an invisible canonical anchor',()=>{
 const r=run();r.meeting_events.push(...[{event_id:'E6',thread_id:'T1',type:'requirement',text:'Usar a mesma carga e condição de apoio.'},{event_id:'E7',thread_id:'T1',type:'decision',text:'Executar a repetição antes de aprovar o desenho.'},{event_id:'E8',thread_id:'T1',type:'other',text:'Qual a tolerância aceitável?'}].map(event=>({...event,store_confidence:.99,type_confidence:.99})));r.meeting_relations.push(edge('E6','E5','affects'),edge('E7','E5','affects'),edge('E2','E6','depends_on'));
 const doc=M.localDocument(r),pdf=M.pdfDocument(doc,{}),sections=M.sectionsForTopic(doc.topics[0],1),all=blocks(pdf);
 assert.deepEqual(sections.map(section=>section.title),['1.1 Contexto e requisitos','1.2 Hipóteses','1.3 Testes realizados','1.4 Resultados','1.5 Decisões','1.6 Pendências']);assert.deepEqual(sections[0].entries.map(entry=>entry.id),['E1','E6']);assert.deepEqual(sections.at(-1).entries.map(entry=>entry.id),['E5','E8']);
 assert.ok(all.some(block=>block.text==='Consequência: Ref. 5'&&block.link_to==='event:E5'));
 const plan=global.NorteMinutes.pdfPlan(pdf),anchors=all.flatMap(block=>[block.anchor_id,...(block.anchor_aliases||[])].filter(Boolean));for(const event of r.meeting_events)assert.equal(anchors.filter(id=>id==='event:'+event.event_id).length,1);
 for(const block of all){if(block.link_to)assert.ok(plan.declared.has(block.link_to));for(const id of block.warning_ids||[])assert.ok(plan.declared.has('warning:'+id));}
});
test('post-meeting completion adds the explicit human result without modifying the extraction',()=>{
 const r=run(),original=JSON.stringify(r.meeting_events);A.record(r,{type:'complete_test',test_id:'E5',performed:'Repetimos sob a mesma carga.',performed_at:'2026-10-08',result:'A deformação foi de 1 mm.',outcome:'passed'});
 const doc=M.localDocument(r),pdf=M.pdfDocument(doc,{});assert.equal(JSON.stringify(r.meeting_events),original);assert.ok(doc.topics[0].current.tests.find(e=>e.id==='E5').completed);assert.match(printed(pdf),/A deformação foi de 1 mm/);assert.ok(!doc.issues.some(issue=>issue.event_id==='E5'));
});
test('concise model entries and literal tables preserve original evidence, human status and event links',()=>{
 const r=run(),original=JSON.stringify(r);global.location={origin:'https://norte.example'};
 const doc=M.organizedDocument(r,{topics:[{thread_id:'T1',entries:[{event_id:'E1',text:'Suporte deforma sob carga.'},{event_id:'E3',text:'Teste concluído sob 80 N.'},{event_id:'E4',text:'Sob 20 N, a deformação excedeu o limite.'}],tables:[{title:'Valores registrados',columns:['Carga','Resultado'],rows:[{event_id:'E4',cells:['20 N','a deformação excedeu o limite']}]}]}]});
 delete global.location;
 assert.equal(JSON.stringify(r),original);const t=doc.topics[0];assert.equal(t.current.tests[0].text,'Testar a rigidez sob 20 N.');assert.equal(t.current.tests[0].display_text,undefined);assert.equal(t.current.tests[0].completed,true);assert.equal(t.current.actions[0].completed,false);
 const pdf=M.pdfDocument(doc),all=blocks(pdf);assert.ok(all.some(b=>b.text==='Suporte deforma sob carga.'));assert.doesNotMatch(printed(pdf),/80 N/);assert.ok(all.some(b=>b.text==='Sob 20 N, a deformação excedeu o limite.'));
 const table=pdf.threads[0].sections.find(s=>s.tables?.length).tables[0];assert.deepEqual(table.headers,['Carga','Resultado','Referência']);assert.equal(table.rows[0].cells[0],'20 N');assert.match(table.rows[0].external_url,/meeting=document-1&event=E4#reuniao$/);assert.ok(all.some(b=>b.external_url==='https://norte.example/?meeting=document-1&event=E1#reuniao'));
});
test('retired events and ungrounded or cross-topic table cells never enter the current summary',()=>{
 const r=run();r.meeting_events.push({event_id:'E6',thread_id:'T1',type:'test_result',text:'A medição anterior foi retirada.',store_confidence:.99,type_confidence:.99},{event_id:'E7',thread_id:'T2',type:'observation',text:'Valor 30 N.',store_confidence:.99,type_confidence:.99});r.meeting_threads.push({thread_id:'T2'});r.meeting_relations.push(edge('E6','E4','supersedes'));
 const source=M.sourceFor(r);assert.ok(!source.events.some(e=>e.event_id==='E4'));assert.ok(!source.relations.some(e=>e.source_event_id==='E4'||e.target_event_id==='E4'));assert.deepEqual(source.post_meeting_edits,[]);
 const doc=M.organizedDocument(r,{topics:[{thread_id:'T1',entries:[{event_id:'E4',text:'Valor antigo 20 N.'},{event_id:'E7',text:'Valor 30 N.'}],tables:[{title:'Inventado',columns:['Carga','Resultado'],rows:[{event_id:'E1',cells:['99 N','aprovado']}]},{title:'Outro assunto',columns:['Carga','Resultado'],rows:[{event_id:'E7',cells:['30 N','']}]},{title:'Antigo',columns:['Carga','Resultado'],rows:[{event_id:'E4',cells:['20 N',''] }]}]}]});
 assert.deepEqual(doc.topics[0].tables,[]);assert.doesNotMatch(printed(M.pdfDocument(doc)),/Valor antigo|Inventado|Outro assunto/);
});
test('human summary corrections are presentation only in the PDF and invalidate on source changes',()=>{
 const r=run(),e=r.meeting_events[1],original=e.text;
 r.block_edits={[e.event_id]:{source:original,text:'Hipótese revisada por uma pessoa.'}};
 assert.match(printed(M.pdfDocument(M.localDocument(r),{})),/Hipótese revisada por uma pessoa/);
 assert.equal(M.sourceFor(r).events.find(item=>item.event_id===e.event_id).text,original);
 e.text='A fonte mudou e não corresponde ao resumo.';
 assert.doesNotMatch(printed(M.pdfDocument(M.localDocument(r),{})),/Hipótese revisada por uma pessoa/);
});

test('integrated minutes use the meeting record and never import a shared browser cache',async()=>{
 const storage={getItem(){throw Error('must not read browser storage');},setItem(){throw Error('must not write browser storage');}},r={...run(),integrated_norte:true};
 assert.equal(M.readDraft(r,'source-1',storage),null);
 const draft={sourceId:'source-1',doc:{title:'Ata'},reviewed:{},presentationVersion:10};let saved;
 await M.saveDraft(r,draft,{storage,onUpdate:value=>{saved=structuredClone(value);return true;}});
 assert.deepEqual(saved.minutes_document,draft);assert.deepEqual(M.readDraft(r,'source-1',storage),draft);assert.equal(M.readDraft(r,'changed-source',storage),null);
 assert.equal(await M.saveDraft(r,{...draft,doc:{title:'Unauthorized'}},{storage,readOnly:true}),false);assert.equal(r.minutes_document.doc.title,'Ata');
});
