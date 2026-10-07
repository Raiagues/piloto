const test=require('node:test'),assert=require('node:assert/strict');
const M=require('../meeting-minutes.js');
const make=()=>({id:'run-1',batch:{batch_id:'REVIEW-01'},status:'done',createdAt:'2026-01-01T10:00:00Z',meeting_events:[
  {event_id:'E001',chunk_id:'C01',thread_id:'T001',type:'hypothesis',text:'Talvez a rigidez explique a deformação.',status:'open'},
  {event_id:'E002',chunk_id:'C02',thread_id:'T001',type:'test_proposal',text:'Vamos medir a versão de 4 mm sob 20 N.',status:'open'},
  {event_id:'E003',chunk_id:'C03',thread_id:'T001',type:'test_result',text:'A versão de 5 mm falhou sob 20 N.',status:'active'},
  {event_id:'E004',chunk_id:'C04',thread_id:null,type:'requirement',text:'O cliente exige menos de 2 kg.',status:'active'}
],meeting_threads:[{thread_id:'T001'}],meeting_relations:[{relation_id:'R001',source_event_id:'E003',target_event_id:'E002',thread_id:'T001',relation_type:'result_of',configuration_match:'mismatch',review_state:'needs_review',relation_probability:.99,match_probability:.99}],typed_relation_worker:{status:'done',schemaVersion:1}});
test('minutes group classified events inside each thread and retain faithful text and unassigned events',()=>{
 const run=make();run.meeting_events.push({event_id:'E005',chunk_id:'C05',thread_id:'T001',type:'decision',text:'Vamos manter o protótipo atual.'});
 const doc=M.buildDocument(run,null);assert.equal(doc.title,'Ata de reunião');assert.equal(doc.presentation,'thread_sections');
 assert.equal(doc.threads[0].title,'Discussão T001');assert.deepEqual(doc.threads[0].blocks.map(b=>b.event_ids[0]),['E001','E002','E003','E005']);
 assert.deepEqual(doc.threads[0].sections.map(s=>s.id),['hypotheses','decisions','tested','followups']);
 assert.deepEqual(doc.threads[0].sections.flatMap(s=>s.blocks).map(b=>b.event_ids[0]),['E001','E005','E003','E002']);
 assert.equal(doc.threads[1].title,'Pontos sem assunto definido');assert.equal(doc.threads[1].blocks[0].text,'O cliente exige menos de 2 kg.');
 run.meeting_threads[0].title='Revisão do suporte';const titled=M.buildDocument(run,null);assert.equal(titled.threads[0].title,'Revisão do suporte');
 assert.equal(titled.id,doc.id,'presentation changes preserve existing source comment anchors');
 const feedback=M.exportFeedback(titled,[]);assert.equal(feedback.document_structure.threads[0].title,'Revisão do suporte');assert.equal(feedback.source_snapshot.relations[0].configuration_match,'mismatch');
});
test('grounded document preserves exact utterances and never closes a mismatched test or hypothesis',()=>{
 const run=make(),before=JSON.stringify(run),doc=M.buildDocument(run,{E001:{event_id:'E001',status:'open',evidence_state:'challenged',relation_ids:[],review_required:true,reasons:['Hipótese ainda exige investigação.']},E002:{event_id:'E002',status:'open',evidence_state:'unassessed',relation_ids:['R001'],review_required:true,reasons:['Configuração incompatível.']}});
 assert.equal(JSON.stringify(run),before);assert.equal(doc.metrics.events,4);assert.equal(doc.metrics.threads,1);assert.equal(doc.metrics.relations,1);
 assert.equal(doc.blocks.find(b=>b.id==='event:E003').text,run.meeting_events[2].text);
 assert.equal(doc.blocks.find(b=>b.id==='followup:E002').status,'open');assert.equal(doc.blocks.find(b=>b.id==='followup:E001').status,'open');
 assert.ok(doc.blocks.find(b=>b.id==='unassigned:E004'));assert.ok(doc.warnings.some(b=>b.text.includes('configurações diferentes')));
 assert.match(doc.blocks[0].text,/não comprovam consenso/);assert.ok(!doc.blocks.some(b=>b.text.includes('2026-01-01')));
});
test('only lifecycle changes completion; original event status stays immutable',()=>{
 const run=make(),doc=M.buildDocument(run,{E002:{event_id:'E002',status:'completed',relation_ids:['R001'],review_required:false,reasons:[]}});
 assert.equal(doc.blocks.find(b=>b.id==='followup:E002').status,'completed');assert.equal(run.meeting_events[1].status,'open');assert.match(doc.blocks.find(b=>b.id==='followup:E002').text,/aprovação não inferida/);
});
test('fingerprint ignores object key order but separates run identity and source revisions',()=>{
 const run=make(),doc=M.buildDocument(run,null);assert.equal(M.buildDocument({...run},null).id,doc.id);
 assert.equal(M.fingerprint({a:1,b:2}),M.fingerprint({b:2,a:1}));assert.notEqual(M.buildDocument({...run,id:'run-2'},null).id,doc.id);
 run.meeting_events[1].text+=' amanhã';assert.notEqual(M.buildDocument(run,null).id,doc.id);
});
test('comment anchors use UTF-16 offsets and reject stale source, forged quote or another run',()=>{
 const run=make();run.meeting_events[0].text='A peça 🔩 está trincando.';const doc=M.buildDocument(run,null),text=run.meeting_events[0].text,start=text.indexOf('está'),anchor=M.makeAnchor(doc,'event:E001',start,start+'está trincando'.length);
 const comment=M.createComment(doc,anchor,'Confirmar resultado',{id:'F01',now:'2026-01-01T10:00:00Z',category:'question'});
 assert.equal(anchor.quote,'está trincando');assert.equal(anchor.offset_unit,'utf16');assert.equal(M.validateComment(doc,comment),true);
 assert.equal(M.validateComment(doc,{...comment,run_fingerprint:'other'}),false);assert.equal(M.validateComment(doc,{...comment,anchor:{...anchor,quote:'outra'}}),false);
 assert.equal(M.validateComment(doc,{...comment,anchor:{...anchor,event_ids:['E999']}}),false);assert.throws(()=>M.makeAnchor(doc,'event:E001',-1,3));
});
test('feedback is auditable local review, not training truth; invalid anchors are excluded',()=>{
 const doc=M.buildDocument(make(),null),a=M.makeAnchor(doc,'relation:R001');const c=M.createComment(doc,a,'Configurações distintas.',{category:'correction'});const out=M.exportFeedback(doc,[c,{...c,run_fingerprint:'bad'}],'2026-01-02T00:00:00Z');
 assert.equal(out.comments.length,1);assert.equal(out.provenance.automatic_training,false);assert.equal(out.provenance.feedback_is_verified_ground_truth,false);assert.deepEqual(out.comments[0].anchor.relation_ids,['R001']);assert.equal(out.source_snapshot.relations[0].configuration_match,'mismatch');
 out.source_snapshot.events[0].text='modified';assert.notEqual(out.source_snapshot.events[0].text,doc.source.events[0].text);
});
test('partial and missing processing are explicitly represented',()=>{
 const run=make();run.status='stopped';delete run.typed_relation_worker;run.meeting_relations=[];const doc=M.buildDocument(run,null);
 assert.ok(doc.blocks.find(b=>b.id==='warning:incomplete'));assert.ok(doc.blocks.find(b=>b.id==='warning:relations'));assert.equal(doc.blocks.find(b=>b.id==='followup:E002').status,'pending');
});
test('uncertain negative pairs and interrupted jobs are warnings, never synthesized edges',()=>{
 const run=make();run.typed_relation_worker.version='TRQ003';run.typed_relation_worker.config={questions:{relation_type:{instructions:'Question snapshot'}}};run.typed_relation_worker.jobs=[{event_id:'E003',chunk_id:'C03',thread_id:'T001',status:'interrupted',parts:[],results:[{target_event_id:'E001',relation_type:'none',relation_probability:.55,review_state:'needs_review'}]}];
 const doc=M.buildDocument(run,null);assert.equal(doc.metrics.relations,1);assert.ok(doc.warnings.some(w=>w.id==='negative-review:E003:E001'));assert.ok(doc.warnings.some(w=>w.id==='job-review:E003'));
 const out=M.exportFeedback(doc,[]);assert.equal(out.source_snapshot.question_version,'TRQ003');assert.equal(out.source_snapshot.relation_config.questions.relation_type.instructions,'Question snapshot');assert.equal(out.source_snapshot.classification_audit[0].results[0].relation_type,'none');
});
test('feedback provenance snapshots explicit classifier prompts and unique actual response model IDs',()=>{
 const run=make();run.provider='official';run.questions={should_store_memory:{instructions:'retention question'}};run.questionVersion='CQ02';run.records=[{storeOutput:{response:{model:'jev-model-A'}},typeOutput:{response:{model:'jev-model-A'}}}];run.thread_worker={version:'TQ05',config:{questions:{belongs_to_active_thread:{instructions:'thread question'}}},jobs:[{parts:[{output:{response:{model:'jev-model-B'}}}]}]};run.typed_relation_worker.config={questions:{relation_type:{instructions:'relation question'}}};run.typed_relation_worker.jobs=[{event_id:'E003',status:'done',parts:[{output:{response:{model:'jev-model-C'}}}],results:[]}];
 const doc=M.buildDocument(run,null),source=M.exportFeedback(doc,[]).source_snapshot;
 assert.equal(source.provider,'official');assert.deepEqual(source.model_ids,['jev-model-A','jev-model-B','jev-model-C']);assert.equal(source.chunk_question_version,'CQ02');assert.equal(source.thread_question_version,'TQ05');assert.deepEqual(source.chunk_questions,run.questions);assert.deepEqual(source.thread_config,run.thread_worker.config);
 source.chunk_questions.should_store_memory.instructions='edited';assert.equal(run.questions.should_store_memory.instructions,'retention question');assert.equal(JSON.stringify(source).includes('storeOutput'),false);
});
test('relation evidence separates executed tests, pending reruns and superseded records without assuming success',()=>{
 const run=make();run.meeting_events[2].text='A versão de 4 mm excedeu o limite.';
 run.meeting_events.push({event_id:'E005',thread_id:'T001',type:'test_proposal',text:'Repetir o teste amanhã.'},{event_id:'E006',thread_id:'T001',type:'observation',text:'Há deformação.'},{event_id:'E007',thread_id:'T001',type:'other',text:'Registro adicional.'});
 const edge=run.meeting_relations[0];edge.configuration_match='exact';edge.review_state='confirmed';
 let doc=M.buildDocument(run),thread=doc.threads[0],section=id=>thread.sections.find(s=>s.id===id);
 assert.deepEqual(section('tested').blocks.map(b=>b.id),['event:E002','event:E003']);
 assert.deepEqual(section('followups').blocks.map(b=>b.id),['event:E005']);
 assert.match(section('tested').blocks[0].detail,/aprovação não inferida/);
 assert.equal(section('discussion').blocks[0].id,'event:E006');assert.equal(section('other').blocks[0].id,'event:E007');
 run.meeting_relations.push({relation_id:'R002',source_event_id:'E005',target_event_id:'E002',relation_type:'supersedes',configuration_applicable:false,configuration_match:'not_applicable',review_state:'confirmed',relation_probability:.99,match_probability:.99});
 doc=M.buildDocument(run);thread=doc.threads[0];assert.equal(section('history').blocks[0].id,'event:E002');
 assert.equal(new Set(thread.sections.flatMap(s=>s.blocks.map(b=>b.id))).size,thread.blocks.length);
 edge.configuration_match='mismatch';run.meeting_relations.pop();doc=M.buildDocument(run);thread=doc.threads[0];
 assert.deepEqual(section('followups').blocks.map(b=>b.id),['event:E002','event:E005']);assert.match(section('followups').blocks[0].detail,/Revisão necessária/);
});
test('PDF plan preserves shared numbering, hierarchy anchors and explicit contents without changing the document',()=>{
 const doc={contents:[{title:'1. Suporte',target_id:'topic:T1'},{title:'1.2 Histórico',target_id:'section:T1:history',level:1}],threads:[{id:'topic:T1',title:'1. Suporte',sections:[{id:'section:T1:current',title:'1.1 Estado atual',blocks:[{text:'Verificar [E1]',link_to:'event:E1',warning_ids:['W1']}]},{id:'section:T1:history',title:'1.2 Histórico',blocks:[{anchor_id:'event:E1',text:'Ensaio original.'}]}]},{id:'warnings',title:'Revisões pendentes',sections:[{id:'section:warnings',title:'',blocks:[{anchor_id:'warning:W1',text:'Revisar configuração.'}]}]}]};
 const before=JSON.stringify(doc),plan=M.pdfPlan(doc);
 assert.equal(JSON.stringify(doc),before);assert.equal(plan.threads[0].title,'1. Suporte');assert.equal(plan.threads[0].sections[0].title,'1.1 Estado atual');assert.deepEqual(plan.contents,doc.contents);
 for(const id of ['contents','topic:T1','section:T1:current','section:T1:history','event:E1','warnings','warning:W1'])assert.ok(plan.declared.has(id),id);
 assert.equal(plan.declared.has('event:E404'),false,'unrepresented references do not acquire invented destinations');
});
test('PDF plan gives legacy topics and event blocks stable destinations and numbered headings',()=>{
 const doc=M.buildDocument(make()),plan=M.pdfPlan(doc);
 assert.equal(plan.threads[0].title,'1. Discussão T001');assert.match(plan.threads[0].sections[0].title,/^1\.1 /);
 assert.equal(plan.contents[0].target_id,plan.threads[0].id);assert.equal(plan.contents[0].title,plan.threads[0].title);
 assert.ok(plan.declared.has('event:E001'));assert.ok(plan.declared.has('event:E003'));
});
test('PDF plan retains intentionally unnamed topic labels and only declares canonical history blocks',()=>{
 const plan=M.pdfPlan({threads:[{id:'topic:T9',title:'Assunto 1 · sem título',sections:[{id:'section:T9:current',title:'1.1 Ações',blocks:[{text:'Executar [E9]',event_ids:['E9'],link_to:'event:E9'}]}]}]});
 assert.equal(plan.threads[0].title,'Assunto 1 · sem título');assert.equal(plan.declared.has('event:E9'),false);
});
