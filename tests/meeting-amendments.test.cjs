const test=require('node:test');
const assert=require('node:assert/strict');
const Amend=require('../meeting-amendments.js');
const event=(id,type,extra={})=>({event_id:id,chunk_id:'C'+id,thread_id:'T1',type,text:'Frase original '+id,store_confidence:.99,type_confidence:.99,...extra});
const edge=(from,to,match='exact',extra={})=>({relation_id:'R'+from+to,source_event_id:from,target_event_id:to,relation_type:'result_of',configuration_match:match,configuration_applicable:true,relation_probability:.99,match_probability:.99,review_state:'confirmed',...extra});
const meeting=(events,relations=[])=>({id:'meeting-one',title:'Ensaio da viga',status:'done',meeting_threads:[{thread_id:'T1'},{thread_id:'T2'}],meeting_events:events,meeting_relations:relations});
const freeze=value=>{if(value&&typeof value==='object'){Object.freeze(value);Object.values(value).forEach(freeze);}return value;};
const completion={type:'complete_test',test_id:'T',performed:'Aplicamos 12 kN na ponta da viga.',performed_at:'2026-10-07',result:'O deslocamento medido foi 24 mm.',outcome:'failed'};

test('PDF issues cover orphan results and unconfirmed tests, never general classification alerts',()=>{
 const run=meeting([event('T','test_proposal'),event('R','test_result'),event('H','hypothesis'),event('Q','requirement')]);
 const view=Amend.build(freeze(run));assert.deepEqual(view.issues.map(i=>i.id),['unconfirmed_test:T','orphan_result:R']);assert.ok(view.issues.every(i=>!i.resolved));assert.equal(view.state.entries.length,4);assert.equal(view.state.byId.R.standalone,true);
});

test('a compatible current result needs no correction; mismatched, ambiguous and unconfirmed edges do',()=>{
 let run=meeting([event('T','test_proposal'),event('R','test_result')],[edge('R','T')]);assert.deepEqual(Amend.build(run).issues,[]);
 for(const relation of [edge('R','T','mismatch'),edge('R','T','ambiguous'),edge('R','T','exact',{review_state:'needs_review'}),edge('R','T','exact',{relation_probability:.8})]){
  run=meeting([event('T','test_proposal'),event('R','test_result')],[relation]);const view=Amend.build(run);assert.equal(view.state.byId.R.standalone,true);assert.deepEqual(view.state.topics[0].current.tests.map(n=>n.id),['T','R']);assert.equal(view.issues.length,2);
 }
});

test('manual association updates state, current actions and relations while preserving exact extraction',()=>{
 const run=meeting([event('T','test_proposal'),event('R','test_result')]),source=JSON.stringify(run);
 const edit=Amend.record(run,{type:'associate_result',result_id:'R',test_id:'T'}),view=Amend.build(run);
 assert.equal(edit.id,'PM000001');assert.equal(edit.before.find(n=>n.event_id==='T').completed,false);assert.equal(edit.after.find(n=>n.event_id==='T').completed,true);assert.equal(view.state.byId.T.completed,true);assert.equal(view.state.byId.R.standalone,false);assert.deepEqual(view.state.topics[0].current.actions,[]);assert.deepEqual(view.issues,[]);
 assert.equal(view.state.byId.T.results[0].event_id,'R');assert.equal(view.state.byId.T.results[0].relation.source,'post_meeting');assert.equal(view.state.byId.R.relations[0].event_id,'T');assert.equal(view.invalid_edits.length,0);
 const {post_meeting_edits,...unchanged}=run;assert.equal(JSON.stringify(unchanged),source);assert.throws(()=>Amend.record(run,{type:'associate_result',result_id:'R',test_id:'T'}),/já está associado/);assert.equal(run.post_meeting_edits.length,1);
});

test('reassignment leaves a single parent and reopens the previous test without inventing an answer',()=>{
 const run=meeting([event('A','test_proposal'),event('B','test_proposal'),event('R','test_result')],[edge('R','A')]);
 Amend.record(run,{type:'associate_result',result_id:'R',test_id:'B'});const view=Amend.build(run);
 assert.equal(view.state.byId.A.completed,false);assert.equal(view.state.byId.B.completed,true);assert.deepEqual(view.state.byId.A.results,[]);assert.equal(view.state.byId.R.relations.filter(r=>r.type==='result_of').length,1);assert.deepEqual(view.issues.map(i=>i.id),['unconfirmed_test:A']);assert.deepEqual(run.meeting_relations,[edge('R','A')]);
});

test('explicit unknown and pending choices unblock export but keep the relevant visible states',()=>{
 const run=meeting([event('T','test_proposal'),event('R','test_result')]);
 Amend.record(run,{type:'acknowledge_unknown',result_id:'R'});Amend.record(run,{type:'confirm_pending',test_id:'T',note:'Falta repetir a medição com a carga correta.'});
 const view=Amend.build(run);assert.ok(view.issues.every(i=>i.resolved));assert.equal(view.issues.find(i=>i.event_id==='R').disposition,'unknown');assert.equal(view.state.byId.R.unknown_test,true);assert.equal(view.state.byId.R.standalone,true);assert.equal(view.state.byId.T.completed,false);assert.equal(view.state.byId.T.status,'open');assert.equal(view.state.byId.T.pending_confirmed,true);assert.match(view.state.byId.T.post_meeting_note,/repetir/);
 Amend.record(run,{type:'associate_result',result_id:'R',test_id:'T'});const linked=Amend.build(run);assert.deepEqual(linked.issues,[]);assert.equal(linked.state.byId.R.unknown_test,undefined);assert.equal(linked.state.byId.T.pending_confirmed,undefined);
});

test('completion creates an auditable human result without mistaking completed for successful',()=>{
 const run=meeting([event('T','test_proposal')]),raw=JSON.stringify(run.meeting_events);
 const edit=Amend.record(run,completion),view=Amend.build(run),node=view.state.byId.T,result=view.state.byId['PM_RESULT_'+edit.id];
 assert.equal(node.completed,true);assert.equal(node.status,'completed');assert.equal(node.completion.outcome,'failed');assert.equal(result.event.outcome,'failed');assert.equal(result.event.source,'post_meeting');assert.equal(result.text,completion.result);assert.equal(result.type,'test_result');assert.equal(node.results[0].event_id,result.id);assert.equal(view.state.topics[0].current.tests.length,1);assert.equal(view.issues.length,0);assert.equal(JSON.stringify(run.meeting_events),raw);assert.equal(edit.after.find(n=>n.event_id===result.id).text,completion.result);
});

test('reopening retains the historical result but explicitly stops it from closing the test',()=>{
 const run=meeting([event('T','test_proposal'),event('R','test_result')],[edge('R','T')]);
 Amend.record(run,{type:'reopen_test',test_id:'T',note:'Falta validar o deslocamento com o equipamento calibrado.'});const view=Amend.build(run);
 assert.equal(view.state.byId.T.completed,false);assert.equal(view.state.byId.T.results[0].usable,false);assert.equal(view.state.byId.T.results[0].post_meeting_reopened,true);assert.equal(view.state.byId.R.relations[0].usable,false);assert.equal(view.state.byId.R.standalone,false);assert.deepEqual(view.state.topics[0].current.actions.map(n=>n.id),['T']);assert.equal(view.issues.length,1);assert.equal(view.issues[0].resolved,true);
 Amend.record(run,completion);const again=Amend.build(run);assert.equal(again.state.byId.T.completed,true);assert.equal(again.state.byId.T.results.length,2);assert.equal(again.state.byId.T.results.find(r=>r.event_id==='R').usable,false);assert.equal(again.state.byId.T.results.filter(r=>r.usable).length,1);assert.equal(again.issues.length,0);assert.equal(again.invalid_edits.length,0);
});

test('human completion and reopening refresh dependency blocking',()=>{
 const run=meeting([event('T','test_proposal'),event('A','task')],[edge('A','T','not_applicable',{relation_type:'depends_on',configuration_applicable:false})]);
 assert.equal(Amend.build(run).state.byId.A.blocked,true);Amend.record(run,completion);let state=Amend.build(run).state;assert.equal(state.byId.A.blocked,false);assert.equal(state.byId.A.status,'open');assert.ok(!state.alerts.some(a=>a.code==='dependency_pending'));
 Amend.record(run,{type:'reopen_test',test_id:'T',note:'Conferir calibração.'});state=Amend.build(run).state;assert.equal(state.byId.A.blocked,true);assert.equal(state.byId.A.status,'review');assert.deepEqual(state.byId.A.blocked_by,['T']);assert.ok(state.alerts.some(a=>a.code==='dependency_pending'));
});

test('invalid completions and missing confirmation notes are rejected atomically',()=>{
 const source=meeting([event('T','test_proposal')]);
 for(const change of [{...completion,performed:''},{...completion,performed_at:'2026-02-30'},{...completion,performed_at:'hoje'},{...completion,result:''},{...completion,outcome:'completed'},{type:'confirm_pending',test_id:'T',note:' '}]){const run=structuredClone(source);assert.throws(()=>Amend.record(run,change));assert.deepEqual(run,source);}
});

test('cross-topic, low-confidence, unknown, wrong-type and retired targets never receive human links',()=>{
 const run=meeting([event('T','test_proposal'),event('R','test_result'),event('T2','test_proposal',{thread_id:'T2'}),event('LOW','test_proposal',{type_confidence:.599}),event('H','hypothesis'),event('OLD','test_proposal'),event('NEW','test_proposal')],[edge('NEW','OLD','mismatch',{relation_type:'supersedes'})]);
 for(const id of ['T2','LOW','MISSING','H','OLD'])assert.throws(()=>Amend.record(run,{type:'associate_result',result_id:'R',test_id:id}));assert.equal(run.post_meeting_edits,undefined);
});

test('changed source meanings invalidate old corrections without touching the extraction or silently replaying',()=>{
 const run=meeting([event('T','test_proposal'),event('R','test_result')]);Amend.record(run,{type:'associate_result',result_id:'R',test_id:'T'});run.meeting_events[1].text='Uma leitura diferente.';
 const view=Amend.build(run);assert.equal(view.edits.length,0);assert.equal(view.invalid_edits[0].code,'stale_source');assert.equal(view.state.byId.T.completed,false);assert.equal(view.state.byId.R.standalone,true);assert.ok(view.issues.every(i=>!i.resolved));assert.equal(run.post_meeting_edits.length,1);
});

test('tampered or duplicate persisted edits are rejected and valid later edits remain reviewable',()=>{
 const run=meeting([event('T','test_proposal'),event('R','test_result')]);Amend.record(run,{type:'confirm_pending',test_id:'T',note:'Aguardamos o ensaio.'});run.post_meeting_edits.push({...structuredClone(run.post_meeting_edits[0])},{id:'bad',type:'delete_event'});const view=Amend.build(run);assert.equal(view.edits.length,1);assert.equal(view.invalid_edits.length,2);assert.equal(view.state.byId.T.pending_confirmed,true);
});

test('export includes timestamps, source identity and before/after audit, never unrelated runtime secrets',()=>{
 const run=meeting([event('T','test_proposal')]);run.api_key='secret';Amend.record(run,completion);const payload=Amend.export(run);
 assert.equal(payload.schema,'norte.post-meeting-amendments');assert.equal(payload.source.meeting_id,'meeting-one');assert.equal(payload.edits.length,1);assert.ok(payload.edits[0].created_at);assert.ok(payload.edits[0].before.length);assert.ok(payload.edits[0].after.length);assert.equal(payload.edits[0].source_snapshot.events[0].event_id,'T');assert.ok(!JSON.stringify(payload).includes('secret'));assert.deepEqual(JSON.parse(JSON.stringify(payload)).applied_edit_ids,['PM000001']);
});

test('a reopened dependency also reopens a problem closed by the dependent decision',()=>{
 const run=meeting([event('T','test_proposal'),event('R','test_result'),event('P','observation'),event('D','decision')],[edge('R','T'),edge('D','T','not_applicable',{relation_type:'depends_on'}),edge('D','P','not_applicable',{relation_type:'resolves'})]);
 assert.equal(Amend.build(run).state.byId.P.resolved,true);Amend.record(run,{type:'reopen_test',test_id:'T',note:'Refazer leitura.'});const state=Amend.build(run).state;
 assert.equal(state.byId.P.resolved,false);assert.equal(state.byId.P.status,'open');assert.equal(state.byId.D.blocked,true);assert.deepEqual(state.topics[0].current.open_points.map(n=>n.id),['P']);
});

test('organizer source contains corrected facts and provenance without false current completion links',()=>{
 const run=meeting([event('T','test_proposal')]);Amend.record(run,completion);let source=Amend.source(run);
 assert.equal(source.events.length,2);assert.equal(source.events.find(e=>e.event_id==='T').completed,true);assert.equal(source.events.find(e=>e.type==='test_result').source,'post_meeting');assert.equal(source.relations[0].relation_type,'result_of');assert.equal(source.relations[0].usable,true);assert.equal(source.relations[0].review_state,'confirmed');assert.equal(source.relations[0].relation_probability,1);assert.equal(source.relations[0].match_probability,1);assert.equal(source.relations[0].configuration_applicable,true);assert.equal(source.edits[0].change.outcome,'failed');assert.equal(source.edits[0].source_snapshot,undefined);
 Amend.record(run,{type:'reopen_test',test_id:'T',note:'Repetir a medida.'});source=Amend.source(run);assert.equal(source.events.find(e=>e.event_id==='T').completed,false);assert.equal(source.events.find(e=>e.event_id==='T').pending_confirmed,true);assert.equal(source.events.find(e=>e.event_id==='T').post_meeting_note,'Repetir a medida.');assert.equal(source.relations.length,0);
});

test('confirming a pending test never hides its mismatched result or its unknown-test acknowledgement',()=>{
 const run=meeting([event('T','test_proposal'),event('R','test_result')],[edge('R','T','mismatch')]);
 Amend.record(run,{type:'acknowledge_unknown',result_id:'R'});Amend.record(run,{type:'confirm_pending',test_id:'T',note:'Falta o resultado da configuração correta.'});const view=Amend.build(run);
 assert.equal(view.state.byId.R.standalone,true);assert.equal(view.state.byId.R.unknown_test,true);assert.deepEqual(view.state.topics[0].current.tests.map(n=>n.id),['T','R']);assert.equal(view.issues.length,2);assert.ok(view.issues.every(i=>i.resolved));assert.equal(view.state.byId.T.results[0].post_meeting_reopened,undefined);
});

test('unassigned trusted records can be acknowledged without authorizing an invented topic or link',()=>{
 const run=meeting([event('T','test_proposal',{thread_id:null}),event('R','test_result',{thread_id:null})]);
 assert.throws(()=>Amend.record(run,{type:'associate_result',result_id:'R',test_id:'T'}),/assunto/);
 Amend.record(run,{type:'acknowledge_unknown',result_id:'R'});Amend.record(run,{type:'confirm_pending',test_id:'T',note:'Ainda falta identificar a configuração e executar o teste.'});
 const view=Amend.build(run);assert.equal(view.invalid_edits.length,0);assert.equal(view.issues.length,2);assert.ok(view.issues.every(i=>i.resolved));assert.equal(view.state.byId.R.unknown_test,true);assert.equal(view.state.byId.R.topic_id,null);assert.equal(view.state.byId.T.pending_confirmed,true);assert.equal(view.state.byId.T.completed,false);assert.equal(view.state.byId.T.topic_id,null);assert.equal(view.state.byId.T.results.length,0);
 assert.throws(()=>Amend.record(run,{type:'associate_result',result_id:'R',test_id:'T'}),/assunto/);assert.equal(run.post_meeting_edits.length,2);
});
