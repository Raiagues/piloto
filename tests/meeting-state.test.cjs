const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const State=require('../meeting-state.js'),Evidence=require('../meeting-evidence.js');
const event=(id,type,text=id,extra={})=>({event_id:id,chunk_id:'C'+id,thread_id:'T1',type,text,store_confidence:.99,type_confidence:.99,...extra});
const edge=(from,to,type,match='not_applicable',extra={})=>({relation_id:'R-'+from+'-'+to+'-'+type,source_event_id:from,target_event_id:to,relation_type:type,configuration_match:match,configuration_applicable:match!=='not_applicable',relation_probability:.99,match_probability:.99,review_state:'confirmed',...extra});
const run=(events,relations=[],extra={})=>({status:'done',meeting_threads:[{thread_id:'T1'}],meeting_events:events,meeting_relations:relations,...extra});
const ids=items=>items.map(item=>item.id||item.event_id);
const freeze=value=>{if(value&&typeof value==='object'){Object.freeze(value);Object.values(value).forEach(freeze);}return value;};

test('current decisions, pending work and chronological history preserve exact immutable source objects',()=>{
 const source=run([event('P','observation','O suporte deforma.'),event('H','hypothesis','A espessura pode explicar a deformação.'),event('T','test_proposal','Testar 4 mm a 20 N.'),event('R','test_result','A deformação excedeu o limite.'),event('D1','decision','Usar 4 mm.'),event('D2','decision','Usar 5 mm.'),event('T2','test_proposal','Repetir o ensaio amanhã.')],[edge('T','H','tests'),edge('R','T','result_of','exact'),edge('D2','D1','supersedes','mismatch'),edge('D2','R','based_on'),edge('T2','T','repeats','exact')],{topic_titles:{T1:'Título escolhido'}});
 const before=JSON.stringify(source),view=State.build(freeze(source)),topic=view.topics[0];
 assert.equal(topic.title,'Título escolhido');assert.deepEqual(ids(topic.current.decisions),['D2']);assert.deepEqual(ids(topic.current.actions),['T2']);
 assert.deepEqual(ids(topic.current.tests),['T','T2']);assert.deepEqual(ids(topic.history.events),source.meeting_events.map(e=>e.event_id));
 assert.equal(view.byId.D1.status,'superseded');assert.equal(view.byId.D1.current,false);assert.equal(view.byId.T.completed,true);assert.equal(view.byId.R.status,'registered');
 assert.equal(view.byId.D2.status,'registered');assert.equal(view.byId.D2.evidence[0].event,source.meeting_events[3]);assert.equal(view.byId.D2.evidence[0].event_status,'registered');assert.equal(view.byId.D2.evidence[0].event_current,true);assert.equal(view.byId.T.event,source.meeting_events[2]);
 assert.equal(view.byId.T.results[0].relation,source.meeting_relations[1]);assert.equal(JSON.stringify(source),before);
});

test('events use an inclusive 60 percent boundary while semantic relations remain above 80 percent',()=>{
 for(const key of ['store_confidence','type_confidence']){
  const view=State.build(run([event('A','observation','A',{[key]:.599}),event('B','observation','B',{[key]:.6}),event('C','observation','C',{[key]:.8})]));
  assert.equal(view.byId.A,undefined);assert.deepEqual(ids(view.topics[0].history.events),['B','C']);assert.equal(view.excluded.length,1);
 }
 for(const key of ['relation_probability','match_probability']){
  const view=State.build(run([event('T','test_proposal'),event('R','test_result')],[edge('R','T','result_of','exact',{[key]:.8})]));
  assert.equal(view.byId.T.completed,false);assert.equal(view.byId.T.status,'open');
 }
});

test('weak topic assignment stays visible as pending without trusting the raw topic or completing tests',()=>{
 const source=run([event('T','test_proposal'),event('R','test_result','Resultado',{type_confidence:.6})],[edge('R','T','result_of','exact')],{thread_worker:{jobs:[{event_id:'R',status:'done',result:{reason:'low_confidence_active',thread_id:'T1'}}]}});
 const before=JSON.stringify(source),view=State.build(source);
 assert.equal(view.byId.R.topic_id,null);assert.equal(view.byId.R.status,'review');assert.equal(view.byId.T.completed,false);
 assert.ok(view.byId.R.alerts.some(a=>a.code==='classification'));assert.ok(view.topics.some(t=>t.history.events.some(e=>e.id==='R')));
 assert.equal(view.excluded.length,0);assert.equal(JSON.stringify(source),before);
});

test('raw event lifecycle labels, type and adjacency never imply approval or execution',()=>{
 const view=State.build(run([event('T','test_proposal','Teste proposto',{status:'completed'}),event('R','test_result','Aprovado.'),event('D','decision','Tudo aprovado.')],[]));
 assert.equal(view.byId.T.status,'open');assert.equal(view.byId.R.status,'registered');assert.equal(view.byId.D.status,'registered');
 assert.equal(view.byId.R.standalone,true);assert.deepEqual(ids(view.topics[0].current.tests),['T','R']);assert.equal(view.metrics.completed,0);
});

test('different, partial, ambiguous and unconfirmed result configurations never complete a proposed test',()=>{
 for(const match of ['mismatch','partial','ambiguous','not_applicable']){
  const view=State.build(run([event('T','test_proposal'),event('R','test_result')],[edge('R','T','result_of',match)]));
  assert.equal(view.byId.T.completed,false);assert.equal(view.byId.T.status,'open');assert.equal(view.byId.R.status,'registered');assert.equal(view.byId.T.results[0].configuration_match,match);assert.deepEqual(ids(view.topics[0].current.actions),['T']);
 }
 const view=State.build(run([event('T','test_proposal'),event('R','test_result')],[edge('R','T','result_of','exact',{review_state:'needs_review'})]));
 assert.equal(view.byId.T.completed,false);assert.equal(view.byId.T.results[0].confirmed,false);
});

test('a withdrawn result no longer completes an active test and remains only historical evidence',()=>{
 const view=State.build(run([event('T','test_proposal'),event('R','test_result'),event('C','observation','A medição anterior estava incorreta.')],[edge('R','T','result_of','exact'),edge('C','R','supersedes')]));
 assert.equal(view.byId.R.status,'superseded');assert.equal(view.byId.T.completed,false);assert.equal(view.byId.T.status,'open');assert.equal(view.byId.T.results[0].usable,false);
 assert.ok(view.alerts.some(a=>a.code==='retired_result'));assert.deepEqual(ids(view.topics[0].current.actions),['T']);
});

test('replacement chains retain before/change/current, cited reasons and explicit impacts',()=>{
 const source=run([event('A','decision','Usar 3 mm.'),event('R1','test_result','3 mm falhou.'),event('B','decision','Passar para 4 mm.'),event('R2','test_result','4 mm falhou.'),event('C','decision','Passar para 5 mm.'),event('Q','requirement','Massa máxima de 2 kg.')],[edge('B','A','supersedes','mismatch'),edge('C','B','supersedes','mismatch'),edge('B','R1','based_on'),edge('C','R2','based_on'),edge('C','Q','affects')]);
 const view=State.build(source),change=view.topics[0].history.changes[0];
 assert.deepEqual(ids(view.topics[0].current.decisions),['C']);assert.deepEqual(ids(change.item),['A']);assert.deepEqual(ids(change.before),['A','B']);assert.deepEqual(ids(change.change),['B','C']);assert.deepEqual(ids(change.current),['C']);assert.deepEqual(ids(change.reason),['R1','R2']);assert.deepEqual(ids(change.consequences),['Q']);assert.equal(change.ambiguous,false);
 assert.equal(change.current[0],source.meeting_events[4]);assert.equal(view.byId.A.status,'superseded');assert.equal(view.byId.B.status,'superseded');
});

test('branches expose concurrent current versions rather than choosing a head by recency',()=>{
 const view=State.build(run([event('A','decision'),event('B','decision'),event('C','decision')],[edge('B','A','supersedes'),edge('C','A','supersedes')])),change=view.topics[0].history.changes[0];
 assert.deepEqual(ids(change.current),['B','C']);assert.equal(change.ambiguous,true);assert.deepEqual(ids(view.topics[0].current.decisions),['B','C']);
 assert.equal(view.byId.A.status,'superseded');assert.equal(view.byId.B.status,'review');assert.equal(view.byId.C.status,'review');assert.ok(view.alerts.some(a=>a.code==='replacement_branch'));
});

test('circular replacement history does not publish a fabricated current decision',()=>{
 const view=State.build(run([event('A','decision'),event('B','decision')],[edge('B','A','supersedes'),edge('A','B','supersedes')]));
 assert.deepEqual(view.topics[0].current.decisions,[]);assert.deepEqual(view.topics[0].history.changes[0].current,[]);assert.equal(view.byId.A.status,'review');assert.equal(view.byId.B.status,'review');assert.deepEqual(ids(view.pending),['A','B']);
});

test('weak or ambiguous replacement cannot retire a decision',()=>{
 for(const extra of [{review_state:'needs_review'},{relation_probability:.8},{configuration_match:'ambiguous',configuration_applicable:true}]){
  const view=State.build(run([event('A','decision'),event('B','decision')],[edge('B','A','supersedes','not_applicable',extra)]));
  assert.equal(view.byId.A.current,true);assert.notEqual(view.byId.A.status,'superseded');assert.equal(view.topics[0].history.changes.length,0);
 }
});

test('hypothesis support and contradictory evidence remain unproven until an explicit closing decision',()=>{
 let source=run([event('H','hypothesis'),event('R','test_result')],[edge('R','H','supports','exact')]);
 let view=State.build(source);assert.equal(view.byId.H.status,'open');assert.equal(view.byId.H.resolved,false);assert.equal(view.byId.H.evidence_state,'supported');
 source.meeting_relations=[edge('R','H','contradicts','exact')];view=State.build(source);assert.equal(view.byId.H.resolved,false);assert.equal(view.byId.H.evidence_state,'challenged');
 source.meeting_events.push(event('R2','test_result'));source.meeting_relations.push(edge('R2','H','supports','exact'));view=State.build(source);assert.equal(view.byId.H.status,'conflict');assert.equal(view.byId.H.resolved,false);
 source.meeting_relations=[edge('R','H','supports','mismatch')];view=State.build(source);assert.equal(view.byId.H.evidence_state,'unassessed');assert.equal(view.byId.H.status,'open');
});

test('a direct rejecting decision closes a hypothesis without claiming empirical proof',()=>{
 const view=State.build(run([event('H','hypothesis'),event('D','decision','A equipe rejeitou a hipótese.')],[edge('D','H','contradicts')]));
 assert.equal(view.byId.H.resolved,true);assert.equal(view.byId.H.completed,false);assert.equal(view.byId.H.status,'completed');assert.deepEqual(view.topics[0].current.open_points,[]);assert.equal(view.byId.D.status,'registered');
});

test('problems need an explicit resolution link; generic rationale or shared topic does not close them',()=>{
 const source=run([event('P','observation','Há vazamento.'),event('D','decision','Encerramos a investigação.')],[edge('D','P','based_on')]);
 assert.equal(State.build(source).byId.P.resolved,false);
 source.meeting_relations.push(edge('D','P','resolves'));
 const view=State.build(source);assert.equal(view.byId.P.resolved,true);assert.equal(view.byId.P.status,'completed');
});

test('requirements expose tests and support, while a valid contradiction is a visible conflict',()=>{
 const source=run([event('Q','requirement','Massa menor que 2 kg.'),event('T','test_proposal'),event('R','test_result')],[edge('T','Q','tests'),edge('R','Q','supports','exact')]);
 let view=State.build(source);assert.equal(view.byId.Q.status,'registered');assert.equal(view.byId.Q.tests[0].event_id,'T');assert.equal(view.byId.Q.evidence[0].event_id,'R');
 source.meeting_relations[1]=edge('R','Q','contradicts','exact');view=State.build(source);assert.equal(view.byId.Q.status,'conflict');assert.equal(view.byId.Q.completed,false);assert.ok(ids(view.pending).includes('Q'));
});

test('a decision citing a replaced rationale is reviewed without replacing its wording',()=>{
 const view=State.build(run([event('R','test_result'),event('D','decision','Manter a configuração.'),event('R2','test_result')],[edge('D','R','based_on'),edge('R2','R','supersedes')]));
 assert.equal(view.byId.D.status,'registered');assert.equal(view.byId.D.evidence[0].usable,false);assert.equal(view.byId.D.evidence[0].event_status,'superseded');assert.equal(view.byId.D.evidence[0].event_current,false);assert.equal(view.byId.D.text,'Manter a configuração.');
});

test('depends_on blocks unfinished work and clears only with a valid completion of the actual target',()=>{
 const source=run([event('T','test_proposal'),event('A','other','Enviar o desenho.',{is_action:true}),event('N','other','Vamos enviar outro desenho.')],[edge('A','T','depends_on')]);
 let view=State.build(source);assert.equal(view.byId.A.blocked,true);assert.deepEqual(view.byId.A.blocked_by,['T']);assert.equal(view.byId.A.status,'review');assert.deepEqual(ids(view.topics[0].current.actions),['T','A']);
 source.meeting_events.push(event('R','test_result'));source.meeting_relations.push(edge('R','T','result_of','exact'));view=State.build(source);assert.equal(view.byId.A.blocked,false);assert.equal(view.byId.A.status,'open');assert.deepEqual(ids(view.topics[0].current.actions),['A']);assert.equal(view.byId.N.status,'registered');
});

test('a replaced dependency is not silently redirected to a different completed test',()=>{
 const view=State.build(run([event('T1','test_proposal'),event('T2','test_proposal'),event('R','test_result'),event('A','task')],[edge('T2','T1','supersedes'),edge('R','T2','result_of','exact'),edge('A','T1','depends_on')]));
 assert.equal(view.byId.T2.completed,true);assert.equal(view.byId.A.blocked,true);assert.deepEqual(view.byId.A.blocked_by,['T1']);
});

test('unfinished prerequisites prevent a closing decision from prematurely resolving a problem',()=>{
 const source=run([event('P','observation'),event('T','test_proposal'),event('D','decision')],[edge('D','P','resolves'),edge('D','T','depends_on')]);
 assert.equal(State.build(source).byId.P.resolved,false);
 source.meeting_events.push(event('R','test_result'));source.meeting_relations.push(edge('R','T','result_of','exact'));assert.equal(State.build(source).byId.P.resolved,true);
});

test('other questions remain open unless a direct answer or clarification is asserted',()=>{
 const source=run([event('Q','other','Qual pressão foi usada?'),event('A','observation','A pressão foi 2 bar.')],[edge('A','Q','related_to')]);
 assert.ok(ids(State.build(source).topics[0].current.open_points).includes('Q'));
 source.meeting_relations=[edge('A','Q','clarifies')];const view=State.build(source);assert.equal(view.byId.Q.resolved,true);assert.equal(view.byId.Q.status,'completed');
});

test('cross-topic relations neither complete nor visually attach a result to the wrong test',()=>{
 const view=State.build(run([event('T','test_proposal'),event('R','test_result','R',{thread_id:'T2'})],[edge('R','T','result_of','exact')]));
 assert.equal(view.byId.T.completed,false);assert.deepEqual(view.byId.T.results,[]);assert.equal(view.byId.R.standalone,true);assert.ok(view.alerts.some(a=>a.code==='cross_topic'));
});

test('processing errors and uncertain missing links remain actionable without dropping source history',()=>{
 const source=run([event('A','observation'),event('B','hypothesis')],[],{typed_relation_worker:{status:'error',jobs:[{event_id:'A',status:'error',results:[]},{event_id:'B',status:'interrupted',results:[{target_event_id:'A',relation_type:'none',review_state:'needs_review'}]}]}});
 const view=State.build(source);assert.equal(view.byId.A.status,'open');assert.equal(view.byId.B.status,'open');assert.equal(view.metrics.errors,0);assert.ok(view.alerts.some(a=>a.kind==='error'));assert.deepEqual(ids(view.topics[0].history.events),['A','B']);
});

test('browser module requires evidence projection and never falls back to unfiltered events',()=>{
 const code=fs.readFileSync(require.resolve('../meeting-state.js'),'utf8'),bare={};vm.runInNewContext(code,bare);
 assert.throws(()=>bare.NorteMeetingState.build(run([event('A','observation')])),/evidências/);
 const context={NorteMeetingEvidence:Evidence};vm.runInNewContext(code,context);assert.equal(context.NorteMeetingState.build(run([event('A','observation')])).byId.A.status,'open');
});

test('empty memory, unassigned topics and duplicate IDs are handled explicitly',()=>{
 assert.deepEqual(State.build(run([])).topics,[]);
 const view=State.build(run([event('A','observation','A',{thread_id:null})]));assert.equal(view.topics[0].title,'Pontos a organizar');assert.equal(view.byId.A.status,'review');
 assert.throws(()=>State.build(run([event('A','observation'),event('A','decision')])),/Identificador/);
});


test('one result attributed to two distinct tests completes neither, with warnings only on the links',()=>{
 const source=run([event('T1','test_proposal'),event('T2','test_proposal'),event('R','test_result')],[edge('R','T1','result_of','exact'),edge('R','T2','result_of','exact')]);
 const view=State.build(source);
 for(const id of ['T1','T2']){assert.equal(view.byId[id].completed,false);assert.equal(view.byId[id].status,'open');assert.equal(view.byId[id].results[0].usable,false);}
 assert.equal(view.byId.R.status,'registered');assert.equal(view.byId.R.standalone,true);assert.ok(view.alerts.some(a=>a.code==='result_attribution'));
 const duplicate=run([event('T','test_proposal'),event('R','test_result')],[edge('R','T','result_of','exact'),edge('R','T','result_of','exact',{relation_id:'duplicate-report'})]);
 assert.equal(State.build(duplicate).byId.T.completed,true,'duplicate edges to the same plan are not distinct attributions');
});

test('a newer explicit replacement of all branch heads settles the formerly competing decisions',()=>{
 const view=State.build(run([event('A','decision'),event('B','decision'),event('C','decision'),event('D','decision')],[edge('B','A','supersedes'),edge('C','A','supersedes'),edge('D','B','supersedes'),edge('D','C','supersedes')]));
 assert.deepEqual(ids(view.topics[0].current.decisions),['D']);assert.equal(view.byId.D.status,'registered');assert.equal(view.topics[0].history.changes[0].ambiguous,false);assert.deepEqual(ids(view.topics[0].history.changes[0].current),['D']);
});

test('inconsistent not-applicable metadata cannot override explicit mismatched evidence',()=>{
 const view=State.build(run([event('Q','requirement'),event('R','test_result')],[edge('R','Q','contradicts','mismatch',{configuration_applicable:false})]));
 assert.equal(view.byId.Q.evidence_state,'unassessed');assert.equal(view.byId.Q.status,'registered');assert.equal(view.byId.Q.evidence[0].usable,false);
});

test('retired rationale in a retired decision remains ordinary history without a current warning',()=>{
 const view=State.build(run([event('R1','test_result'),event('D1','decision'),event('R2','test_result'),event('D2','decision')],[edge('D1','R1','based_on'),edge('R2','R1','supersedes'),edge('D2','D1','supersedes'),edge('D2','R2','based_on')]));
 assert.equal(view.alerts.some(a=>a.code==='retired_rationale'),false);assert.equal(view.byId.D2.status,'registered');
});

test('classification problems affect node state while relation processing issues do not',()=>{
 const source=run([event('A','observation')],[],{thread_worker:{jobs:[{event_id:'A',status:'error',error:'Atribuição indisponível.'}]}});
 const view=State.build(source);assert.equal(view.byId.A.status,'error');assert.equal(view.metrics.errors,1);assert.ok(view.alerts.some(a=>a.code==='classification'));
});
