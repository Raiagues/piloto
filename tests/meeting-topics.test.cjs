const {test}=require('node:test'),assert=require('node:assert/strict');
const S=require('../meetings/web/meeting-session.js'),T=require('../meetings/web/relation-worker.js').threads,V=require('../meetings/web/memory-v2.js');
const clone=value=>JSON.parse(JSON.stringify(value));
// Each fixture answer is an explicit probability table; nothing is read from labels.
function answer(q,choice,table){
 if(q.type==='noul')return {type:'noul',noul:choice?.97:.03};
 const keys=Object.keys(q.criteria),probabilities=table?Object.fromEntries(keys.map(key=>[key,table[key]??0])):Object.fromEntries(keys.map(key=>[key,key===choice?.97:.03/(keys.length-1)]));
 const best=Object.entries(probabilities).sort((a,b)=>b[1]-a[1])[0][0];
 return {type:'choice',choice:best,confidence:.2,probabilities};
}
const reply=(req,pick)=>({request:clone(req),provider:'official',latencyMs:1,response:{model:'fixture',answers:Object.fromEntries(Object.entries(req.questions).map(([id,q])=>{const [choice,table]=pick(id,q);return [id,answer(q,choice,table)];}))}});
const subject=text=>/métrica|300 km|alcance|altitude/i.test(text)?'metric':/fornecedor|cotaç/i.test(text)?'supplier':/MTCR|exportação/i.test(text)?'export':null;
function send(topicTable){
 return async(req,provider,lane)=>{
  assert.equal(provider,'official');
  if(lane==='chunks')return reply(req,id=>[id==='should_store_memory'?true:'observation']);
  if(lane==='threads')return reply(req,(id,q)=>{
   assert.equal(id,'topic_assignment');
   if(topicTable)return [null,topicTable(req)];
   // The fixture matches the subject of current_event with the subject of each offered topic.
   const wanted=subject(req.state.current_event.text),match=req.state.topics.find(topic=>topic.events.some(event=>subject(event.text)===wanted));
   return [match?match.topic_id:'new_topic'];
  });
  if(lane==='relations')return reply(req,id=>[id.startsWith('configuration_match')?'not_applicable':'none']);
  throw Error('Unexpected lane '+lane);
 };
}
const lines=['No formulário, os 300 km estão cadastrados como altitude da missão.','Já temos cotações externas para o computador de bordo.','Essas cotações são de fornecedores de fora.','Na planilha de missão, esses 300 km representam alcance e não altitude.','A finalidade não elimina a análise de exportação do MTCR.'];

test('one question per event returns to an earlier topic, opens new ones and keeps the conversation order',async()=>{
 const sent=[],session=S.create({send:async(...args)=>{sent.push(clone(args));return send()(...args);}});
 for(const text of lines)session.append(text,{source:'import',speaker:'Ana'});
 const run=await session.close();assert.equal(run.status,'done',run.error);
 assert.equal(run.thread_worker.schemaVersion,6);assert.equal(run.thread_worker.version,'topics-v6');
 assert.deepEqual(run.meeting_events.map(event=>event.thread_id),['T001','T002','T002','T001','T003']);
 assert.deepEqual(run.meeting_threads.map(thread=>thread.anchor_event_ids),[['E001','E004'],['E002','E003'],['E005']]);
 assert.ok(run.meeting_events.every(event=>event.thread_assignment_state==='assigned'));
 const topicCalls=sent.filter(([, ,lane])=>lane==='threads');
 assert.equal(topicCalls.length,4,'the first event opens T001 without a call; every later event costs one call');
 const back=topicCalls.find(([req])=>req.state.current_event.event_id==='E004')[0];
 assert.deepEqual(Object.keys(back.questions.topic_assignment.criteria),['T001','T002','new_topic']);
 assert.equal(back.state.current_topic_id,'T002');assert.match(back.questions.topic_assignment.criteria.T001,/altitude da missão/);
 assert.deepEqual(back.state.recent_context.map(item=>item.speaker),['Ana','Ana','Ana']);
 const early=topicCalls.find(([req])=>req.state.current_event.event_id==='E002')[0];assert.ok(lines.slice(2).every(text=>!JSON.stringify(early).includes(text)),'later speech never enters the request');
 const restored=S.restore(run);assert.deepEqual(restored.meeting_threads,run.meeting_threads);assert.deepEqual(restored.meeting_events,run.meeting_events);
});

test('an unclear answer keeps the event in its most likely topic as tentative, and only a clear signal opens a topic',async()=>{
 const tables={
  E002:req=>({T001:.2,new_topic:.8}),
  E003:req=>({T001:.35,T002:.4,new_topic:.25}),
  E004:req=>({T001:.4,T002:.15,new_topic:.45}),
  E005:req=>({T001:.1,T002:.1,new_topic:.8})
 };
 const session=S.create({send:send(req=>tables[req.state.current_event.event_id](req))});
 for(const text of lines)session.append(text,{source:'import'});
 const run=await session.close();assert.equal(run.status,'done',run.error);
 assert.deepEqual(run.meeting_events.map(event=>[event.thread_id,event.thread_assignment_state]),[['T001','assigned'],['T002','assigned'],['T002','tentative'],['T001','tentative'],['T003','assigned']]);
 assert.deepEqual(run.thread_worker.jobs.map(job=>job.result.reason),['first_event','new_topic','tentative','tentative','new_topic']);
 assert.deepEqual(S.restore(run).meeting_events,run.meeting_events);
});

test('a forged topic result or request is rejected when a saved meeting is restored',async()=>{
 const session=S.create({send:send()});for(const text of lines)session.append(text,{source:'import'});const run=await session.close();
 const result=clone(run);result.thread_worker.jobs[3].result={thread_id:'T002',route:'active',reason:'belongs'};assert.throws(()=>S.restore(result),/respostas/);
 const request=clone(run);request.thread_worker.jobs[3].parts[0].request.state.topics[0].events[0].text='Outro assunto';assert.throws(()=>S.restore(request),/difere/);
 const config=clone(run);config.thread_worker.config.questions.topic_assignment.criteria.extra='x';assert.throws(()=>S.restore(config),/topic_assignment/);
});

test('only the ten most recently discussed topics are offered, within the request limits',async()=>{
 const count=12,topics=Array.from({length:count},(_,i)=>'Subsistema '+(i+1)+' tem uma pendência de interface número '+(i+1)+'.');
 const sent=[],session=S.create({send:async(req,provider,lane)=>{sent.push(clone(req));if(lane==='threads')return reply(req,()=>[null,{new_topic:1}]);return send()(req,provider,lane);}});
 for(const text of [...topics,'Voltando ao subsistema 1, a interface foi revisada.'])session.append(text,{source:'import'});
 const run=await session.close();assert.equal(run.status,'done',run.error);assert.equal(run.meeting_threads.length,count+1);
 const last=sent.filter(req=>req.questions.topic_assignment).at(-1),options=Object.keys(last.questions.topic_assignment.criteria);
 assert.equal(options.length,11);assert.equal(options.at(-1),'new_topic');assert.ok(!options.includes('T001')&&!options.includes('T002'),'the oldest topics leave the offer');
 assert.ok(JSON.stringify(last.state).length<=16000);assert.ok(last.state.topics.every(topic=>topic.events.length<=5));
});

test('a saved memory v2 meeting keeps its two-call classification and yes/no topic questions when continued',async()=>{
 const stamp='2026-10-07T12:00:00.000Z',seed={schemaVersion:1,liveSchemaVersion:1,memorySchemaVersion:2,id:'legacy-meeting',title:'Reunião antiga',provider:'official',threshold:.6,questions:clone(V.questions),questionVersion:'memory-v2',createdAt:stamp,startedAt:stamp,status:'draft',batch:{batch_id:'legacy-meeting',cases:[]},records:[],calls:0,meeting_events:[],meeting_threads:[],meeting_relations:[],raw_window:[],transcript:[],topic_titles:{},meeting_commands:[]};
 const lanes=[],session=S.create({seed,provider:'official',send:async(req,provider,lane)=>{lanes.push([lane,Object.keys(req.questions).join()]);
  if(lane==='chunks')return reply(req,id=>[id==='should_store_memory'?true:'observation']);
  if(lane==='threads')return reply(req,()=>['belongs']);
  return send()(req,provider,lane);}});
 session.append('O suporte deforma.');session.append('A chapa tem 3 mm.');
 const run=await session.close();assert.equal(run.status,'done',run.error);assert.equal(run.memorySchemaVersion,2);assert.equal(run.thread_worker.schemaVersion,5);
 assert.deepEqual(lanes.filter(([lane])=>lane==='chunks').map(([,ids])=>ids),['should_store_memory','event_type','should_store_memory','event_type']);
 assert.ok(run.records.every(record=>record.storeOutput&&record.typeOutput&&!record.memoryOutput));assert.deepEqual(lanes.find(([lane])=>lane==='threads')[1],'belongs_to_active_thread');
 assert.deepEqual(S.restore(run).meeting_events,run.meeting_events);
});
