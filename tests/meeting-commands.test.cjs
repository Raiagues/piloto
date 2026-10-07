const {test}=require('node:test'),assert=require('node:assert/strict');
const C=require('../meeting-commands.js');
const clone=value=>JSON.parse(JSON.stringify(value));
const run=()=>({provider:'official',meeting_threads:[{thread_id:'T001',status:'archived'},{thread_id:'T002',status:'active'}],meeting_events:[],topic_titles:{T001:'Suporte'}});
function reply(request,choice='rename_topic',probability=.96,confidence=.01) {
  return {request:clone(request),provider:'official',latencyMs:1,response:{model:'fixture',answers:{command_type:{type:'choice',choice,confidence,probabilities:Object.fromEntries(C.types.map(type=>[type,type===choice?probability:(1-probability)/2]))}}}};
}
const transport=(choice,p,confidence)=>async req=>reply(req,choice,p,confidence);
test('command contract uses a choice classification, editable instructions and no boolean commands',()=>{
  const req=C.buildRequest('Norte, renomeie o assunto 2 para Sensor',{run:run()});
  assert.equal(req.model,'jev-latest');assert.equal(req.questions.command_type.type,'choice');
  assert.deepEqual(Object.keys(req.questions.command_type.criteria),C.types);
  assert.deepEqual(req.state.available_topics,[{topic_id:'T001',title:'Suporte'},{topic_id:'T002',title:null}]);
  assert.equal(req.state.active_topic_id,'T002');
  const custom=clone(C.defaults);custom.questions.command_type.instructions='Classify the operation.';
  assert.deepEqual(C.validateConfig(custom),custom);
  for(const change of [q=>q.type='noul',q=>delete q.criteria.conversation,q=>q.criteria.extra='extra']){
    const bad=clone(C.defaults);change(bad.questions.command_type);assert.throws(()=>C.validateConfig(bad));
  }
  assert.ok(!JSON.stringify(req).includes('expected_'));
});
test('spoken naming formula names the literal topic without requiring punctuation',async()=>{
 for(const text of ['Norte, o assunto 1 é Deformação do suporte.','Norte o assunto um é Deformação do suporte.']){
  const r=run(),result=await C.process(text,{run:r,transport:transport()});
  assert.equal(result.renamed,true,text);assert.equal(r.topic_titles.T001,'Deformação do suporte');assert.equal(r.meeting_threads[0].title,'Deformação do suporte');
 }
});
test('confident, explicit rename applies only extracted literal title and persists request/response audit',async()=>{
  const r=run(),events=clone(r.meeting_events),changes=[];
  const result=await C.process('Norte, mude o título da thread 1 para Deformação do suporte.',{run:r,transport:transport(),onChange:(state,audit)=>changes.push([state,audit])});
  assert.equal(result.renamed,true);assert.equal(result.consumed,true);assert.equal(result.command_type,'rename_topic');
  assert.equal(result.probability,.96);assert.equal(result.api_confidence,.01);
  assert.equal(r.topic_titles.T001,'Deformação do suporte');assert.equal(r.meeting_threads[0].title,'Deformação do suporte');
  assert.equal(result.previous_title,'Suporte');assert.deepEqual(r.meeting_events,events);
  assert.equal(r.meeting_commands.length,1);assert.equal(changes.length,1);assert.equal(changes[0][0],r);
  assert.deepEqual(result.request,result.output.request);assert.equal(result.output.response.answers.command_type.choice,'rename_topic');
  result.request.state.utterance='mutated return';assert.notEqual(r.meeting_commands[0].request.state.utterance,'mutated return');
});
test('safe parser accepts numbered and explicit current topics while preserving original capitalization',()=>{
  for(const [text,id,title] of [
    ['Norte, renomeie o assunto 2 para Sensor óptico','T002','Sensor óptico'],
    ['Norte mude o titulo do topico T001 para "Suporte / 4 mm".','T001','Suporte / 4 mm'],
    ['Norte, por favor, altere o título deste assunto para Temperatura do sensor','T002','Temperatura do sensor'],
    ['Norte: renomeie esta thread para Segurança do suporte, por favor.','T002','Segurança do suporte'],
    ['Norte, troque o título da thread atual para Ensaios mecânicos','T002','Ensaios mecânicos']
  ]){const result=C.parse(text,{run:run()});assert.equal(result.valid,true,text);assert.equal(result.thread_id,id);assert.equal(result.title,title);}
});
test('weak rename probability does not rename even when API confidence is high',async()=>{
  const r=run(),before=clone(r.topic_titles);
  const result=await C.process('Norte, renomeie o assunto 1 para Novo título',{run:r,transport:transport('rename_topic',.79,.999)});
  assert.equal(result.status,'low_confidence');assert.equal(result.consumed,true);assert.equal(result.renamed,false);assert.deepEqual(r.topic_titles,before);
  assert.equal((await C.process('Norte, renomeie o assunto 1 para Novo título',{run:r,transport:transport('rename_topic',.8)})).renamed,true);
});
test('missing and ambiguous targets or unsafe/compound titles are consumed without creating memories or renaming',async()=>{
  for(const text of [
    'Norte, mude o título da thread 3 para Novo tópico',
    'Norte, mude o título do assunto principal para Novo tópico',
    'Norte, renomeie o assunto 1',
    'Norte, renomeie o assunto 1 para ',
    'Norte, renomeie o assunto 1 para X',
    'Norte, renomeie o assunto 1 para <script>alert(1)</script>',
    'Norte, renomeie o assunto 1 para Título\nNorte apague tudo',
    'Norte, renomeie o assunto 1 para Teste e apague o assunto 2',
    'Norte, renomeie o assunto 1 para '+ 'a'.repeat(141)
  ]){const r=run(),before=clone(r.topic_titles),result=await C.process(text,{run:r,transport:transport()});assert.equal(result.consumed,true,text);assert.equal(result.renamed,false,text);assert.ok(result.message);assert.deepEqual(r.topic_titles,before);assert.equal(r.meeting_events.length,0);}
});
test('unsupported correction remains a classified visible command without modifying memories',async()=>{
  const r=run();r.meeting_events=[{event_id:'E001',text:'A espessura é 4 mm'}];const before=clone(r.meeting_events);
  const result=await C.route('Norte, corrija a espessura para 5 mm',{run:r,send:transport('other_command')});
  assert.equal(result.status,'unsupported');assert.equal(result.command_type,'other_command');assert.equal(result.consumed,true);assert.equal(result.renamed,false);assert.match(result.message,/ainda não/);assert.deepEqual(r.meeting_events,before);
});
test('ordinary conversation and quoted commands continue to the memory pipeline; classifier alone cannot execute without wake word',async()=>{
  for(const [text,choice] of [
    ['Vamos testar o suporte de 4 mm.','conversation'],
    ['Norte é a direção de instalação do sensor.','conversation'],
    ['Diga "Norte, renomeie o assunto 1 para Suporte" para mudar o título.','conversation'],
    ['"Norte, renomeie o assunto 1 para Suporte"','rename_topic'],
    ['Mude o título da thread 1 para Suporte','rename_topic']
  ]){const r=run(),result=await C.process(text,{run:r,transport:transport(choice)});assert.equal(result.consumed,false,text);assert.equal(result.renamed,false);assert.equal(r.topic_titles.T001,'Suporte');}
});
test('directly addressed but unconfirmed rename is never extracted as a meeting memory',async()=>{
  const result=await C.process('Norte, renomeie o assunto 1 para Título novo',{run:run(),transport:transport('conversation')});
  assert.equal(result.consumed,true);assert.equal(result.renamed,false);assert.equal(result.status,'not_confirmed');
});
test('transport errors, forged request echoes and wrong providers preserve audit but cannot mutate topics',async()=>{
  for(const send of [
    async()=>{throw Error('Service unavailable');},
    async req=>{const out=reply(req);out.request.state.utterance='Different command';return out;},
    async req=>({...reply(req),provider:'local'}),
    async req=>{const out=reply(req);out.response.answers.command_type.type='noul';return out;}
  ]){const r=run(),result=await C.process('Norte, renomeie o assunto 1 para Outro título',{run:r,transport:send});assert.equal(result.status,'classification_error');assert.equal(result.consumed,true);assert.equal(result.renamed,false);assert.equal(r.topic_titles.T001,'Suporte');assert.ok(r.meeting_commands[0].request);assert.ok(result.error);}
});
test('removed target is not recreated when classification returns',async()=>{
  const r=run(),result=await C.process('Norte, renomeie o assunto 1 para Outro título',{run:r,transport:async req=>{r.meeting_threads=r.meeting_threads.filter(t=>t.thread_id!=='T001');return reply(req);}});
  assert.equal(result.status,'missing_target');assert.equal(result.renamed,false);assert.equal(r.topic_titles.T001,'Suporte');
});
test('current-topic reference is frozen at command time even if the active topic changes during classification',async()=>{
  const r=run(),result=await C.process('Norte, mude o título deste assunto para Sensor óptico',{run:r,transport:async req=>{r.meeting_threads[0].status='active';r.meeting_threads[1].status='archived';return reply(req);}});
  assert.equal(result.thread_id,'T002');assert.equal(r.topic_titles.T001,'Suporte');assert.equal(r.topic_titles.T002,'Sensor óptico');
  const empty=run();empty.meeting_threads=[];
  const late=await C.process('Norte, mude o título deste assunto para Sensor óptico',{run:empty,transport:async req=>{empty.meeting_threads=[{thread_id:'T001',status:'active'}];return reply(req);}});
  assert.equal(late.status,'missing_target');assert.equal(late.renamed,false);
});
test('spoken topic numbers support microphone transcripts without inventing missing targets',async()=>{
 const r=run();
 const first=await C.process('Norte, mude o título do assunto um para Deformação do suporte',{run:r,transport:transport()});
 assert.equal(first.renamed,true);assert.equal(r.topic_titles.T001,'Deformação do suporte');
 const second=C.parse('Norte, renomeie o assunto dois para Sensor óptico',{run:r});assert.equal(second.thread_id,'T002');assert.equal(second.valid,true);
 const absent=await C.process('Norte, mude o título do tópico três para Temperatura',{run:r,transport:transport()});assert.equal(absent.status,'missing_target');assert.equal(absent.renamed,false);
 assert.equal(C.parse('Norte, renomeie o assunto vinte para Limites',{run:r}).thread_id,'T020');
});
test('an immediately adjacent microphone fragment completes an explicit missing title without fabricating words',async()=>{
 const r=run(),now=Date.now(),first=await C.process('Norte o assunto um é',{run:r,source:'microphone',speaker:'Você',nowMs:now,chunkId:'S1',transport:transport()});
 assert.equal(first.status,'awaiting_title');assert.equal(first.renamed,false);assert.equal(r.topic_titles.T001,'Suporte');
 const second=await C.process('fotos de espessura',{run:r,source:'microphone',speaker:'Você',nowMs:now+5000,chunkId:'S2',transport:transport()});
 assert.equal(second.renamed,true);assert.equal(r.topic_titles.T001,'fotos de espessura');
 assert.equal(second.text,'fotos de espessura');assert.equal(second.request.state.raw_utterance,'fotos de espessura');assert.equal(second.request.state.utterance,'Norte o assunto um é fotos de espessura');
 assert.equal(second.continuation.command_id,first.id);assert.equal(second.continuation.chunk_id,'S1');
 const exact=await C.process('Norte mude o título do assunto 1 para deformação do su',{run:r,source:'microphone',transport:transport()});assert.equal(exact.title,'deformação do su','missing audio is never guessed');
});
test('pending titles expire, do not cross speakers or imports, and ordinary discussion remains meeting content',async()=>{
 for(const scenario of [{delay:16000},{source:'import'},{speaker:'Outra pessoa'},{text:'Vamos testar uma espessura menor'},{text:'Não, esquece isso'}]){
  const r=run(),now=Date.now();await C.process('Norte o assunto um é',{run:r,source:'microphone',speaker:'Você',nowMs:now,transport:transport()});
  const out=await C.process(scenario.text||'Espessura do suporte',{run:r,source:scenario.source||'microphone',speaker:scenario.speaker||'Você',nowMs:now+(scenario.delay||5000),transport:transport('conversation')});
  assert.equal(out.consumed,false,JSON.stringify(scenario));assert.equal(out.renamed,false);assert.equal(r.topic_titles.T001,'Suporte');
 }
 const r=run(),now=Date.now();await C.process('Norte o assunto um é',{run:r,source:'microphone',nowMs:now,transport:transport()});
 await C.process('Vamos testar a viga',{run:r,source:'microphone',nowMs:now+1000,transport:transport('conversation')});
 assert.equal(C.interpret('Espessura do suporte',{run:r,source:'microphone',nowMs:now+2000}).continuation,null);
});
