const {test}=require('node:test'),assert=require('node:assert/strict');
const Speech=require('../meeting-speech.js'),Session=require('../meeting-session.js');
const actual='Oi gente a gente vai começar a reunião agora hoje a gente vai tentar fazer a simulação da Viga porque ela tinha dado um problema na parte anterior então vamos começar a gente vai tentar mudar ela de 20 cm para 25 cm para a gente conseguir entender principalmente qual que vai ser todo o efeito';
const command='tá então o Norte vamos simular um teste uma discussão vamos simular uma viga';
function lossless(text,segments){
 let previous=0;
 for(const s of segments){assert.equal(s.text,text.slice(s.start,s.end));assert.match(text.slice(previous,s.start),/^\s*$/u);previous=s.end;}
 assert.match(text.slice(previous),/^\s*$/u);
}
test('actual unpunctuated ASR separates introduction, simulation proposal, prior problem and ambiguous dimensional change',()=>{
 const segments=Speech.segment(actual);assert.ok(segments.length>=4);lossless(actual,segments);
 assert.equal(segments[0].text,'Oi gente a gente vai começar a reunião agora');
 assert.equal(segments[1].text,'hoje a gente vai tentar fazer a simulação da Viga');
 assert.equal(segments[2].text,'porque ela tinha dado um problema na parte anterior');
 assert.match(segments.slice(3).map(s=>s.text).join(' '),/de 20 cm para 25 cm/);assert.ok(segments.every(s=>!s.command));
 assert.ok(segments.every(s=>s.text.split(/\s+/).length<=18),'recognition finals remain short even without punctuation');
 assert.equal(Speech.split(actual).join(' '),actual,'no inferred dimension name, punctuation or assertion is inserted');
});
test('addressed disfluent command is one literal slice, even after a long discussion',()=>{
 assert.deepEqual(Speech.split(command),[command]);assert.equal(Speech.isCommand(command),true);
 const combined=actual+' '+command,parts=Speech.segment(combined);assert.ok(parts.length>=5);lossless(combined,parts);
 assert.equal(parts.at(-1).text,command);assert.equal(parts.at(-1).command,true);assert.match(parts.slice(0,-1).map(s=>s.text).join(' '),/20 cm para 25 cm/);
});
test('a polite unfinished command does not swallow the preceding proposal value',()=>{
 const parts=Speech.segment('para 15 MM Norte você pode');
 assert.deepEqual(parts.map(p=>p.text),['para 15 MM','Norte você pode']);
 assert.equal(parts[0].command,false);assert.equal(parts[1].command,true);
 assert.equal(Speech.unfinished(parts[1].text),false,'command continuations use their dedicated audit');
});
test('a new unaddressed simulation instruction cannot complete a previous unfinished instruction',()=>{
 const previous='eu quero reduzir o tamanho da viga de 5 m para';
 for(const next of ['eu quero reduzir a força P1 de 10 Kg','beleza eu queria mudar a força para 5 kN','mude a força P1 para 5 kN','mostre os gráficos']){
  assert.equal(Speech.canContinue(previous,next),false,next);
 }
 for(const next of ['4 metros','é 4 metros','para 4 metros'])assert.equal(Speech.canContinue(previous,next),true,next);
});
test('speech context prompts satisfy the proxy instruction limit without altering the base contract',()=>{
 const Flow=require('../memory-flow.js'),V=require('../memory-v2.js'),E=require('../experiments.js'),original=JSON.stringify(V.questions);
 for(const stage of ['store','type']){
  const request=Flow.request({current_utterance:'para 15 mm',speech_context:'Vamos testar a espessura de 10'},stage,V.questions);
  assert.doesNotThrow(()=>E.validateConfig(request));
  assert.ok(Object.values(request.questions)[0].instructions.length<=1500);
  assert.equal(request.state.current_utterance,'para 15 mm');
  assert.equal(request.state.speech_context.preceding_words,'Vamos testar a espessura de 10');
 }
 assert.equal(JSON.stringify(V.questions),original);
});
test('explicit hypothesis, test, result and decision clauses separate without changing qualifiers',()=>{
 const text='A viga está deformando muito com uma força de dez quilonewtons na ponta talvez a altura seja pequena para esta carga vamos testar uma seção com vinte centímetros de altura mantendo o mesmo comprimento e a mesma força o resultado foi uma redução de vinte por cento na deformação decidimos manter esta seção no protótipo';
 const parts=Speech.segment(text);assert.equal(parts.length,5);lossless(text,parts);
 assert.match(parts[1].text,/^talvez/);assert.match(parts[2].text,/^vamos testar.*mantendo o mesmo comprimento e a mesma força$/);assert.match(parts[3].text,/^o resultado/);assert.match(parts[4].text,/^decidimos/);
});
test('punctuated speech handles lowercase ASR, decimal numbers, abbreviations and initials',()=>{
 const text='O suporte tem 3.5 mm. O Dr. João pediu outro teste. temperatura: 24,5 °C. A. Costa confirmou.';
 assert.deepEqual(Speech.split(text),['O suporte tem 3.5 mm.','O Dr. João pediu outro teste.','temperatura: 24,5 °C.','A. Costa confirmou.']);lossless(text,Speech.segment(text));
});
test('a long test proposal retains every number, unit and condition in bounded slices with explicit continuation context',()=>{
 const text='Vamos testar a viga de 6 m sob 10 kN, com engaste à esquerda, seção de 120 mm por 240 mm e material aço mantendo o mesmo apoio para comparar com o caso anterior.';
 const parts=Speech.entries({text});assert.ok(parts.length>1);assert.equal(parts.map(p=>p.text).join(' '),text);assert.ok(parts.every(p=>p.text.split(/\s+/).length<=18));
 assert.ok(parts.slice(1).every(p=>p.speechContext&&text.includes(p.speechContext)));
 for(const value of ['6 m','10 kN','120 mm','240 mm'])assert.ok(parts.some(p=>p.text.includes(value)),value+' must not split');
 const compound='Norte, mude a força P1 para 12 kN e a posição para 4 metros e mostre o gráfico de momento';
 assert.deepEqual(Speech.split(compound),[compound]);
});
test('subordinate hypotheses and quoted or conditional command examples stay attached',()=>{
 for(const text of ['Vamos testar se talvez a altura seja a causa da deformação.', 'Quando eu disser Norte abra o simulador não precisa executar agora.', 'Não Norte abra o simulador.', 'Ela disse “Norte, mude a força para 12 kN” como exemplo.']){
  assert.deepEqual(Speech.split(text),[text]);assert.equal(Speech.isCommand(text),false,text);
 }
});
test('geographic Norte and ordinary discussion are not command boundaries',()=>{
 const text='O apoio está no lado Norte da estrutura e a equipe precisa verificar a fixação.';
 assert.deepEqual(Speech.split(text),[text]);assert.equal(Speech.isCommand(text),false);
});
test('consecutive addressed commands stay separate while retaining their own compound actions',()=>{
 const text='Norte, abra a simulação. Norte, mude a força para 12 kN e mova para 4 m.';
 assert.deepEqual(Speech.split(text),['Norte, abra a simulação.','Norte, mude a força para 12 kN e mova para 4 m.']);
 assert.ok(Speech.segment(text).every(s=>s.command));
});
test('long natural transition uses a coherent boundary rather than slicing a number and unit',()=>{
 const start='A configuração contém '+Array(42).fill('detalhes').join(' ')+' e agora vamos comparar o comportamento da viga sob 10 kN com o caso anterior sob 12 kN';
 const parts=Speech.segment(start);assert.ok(parts.length>2);lossless(start,parts);assert.match(parts.at(-1).text,/10 kN.*12 kN/);assert.ok(parts.every(p=>p.text.split(/\s+/).length<=18));
});
test('oversized uninterrupted technical clause is bounded without separating numbers from units',()=>{
 const text='Medidas '+Array.from({length:80},(_,i)=>(i+1)+'.5 mm').join(' ');
 const parts=Speech.segment(text);assert.ok(parts.length>5);lossless(text,parts);assert.ok(parts.every(p=>p.text.split(/\s+/).length<=18));assert.ok(parts.every(p=>p.text.endsWith('mm')));
});
test('late imported text keeps spelled quantities, percentages, temperature and ASR units attached',()=>{
 for(const value of ['doze kN','12 km','20 %','25 °C','0.8 MPa']){
  const text=Array(17).fill('medida').join(' ')+' '+value+' '+Array(20).fill('condição').join(' '),parts=Speech.split(text);
  assert.ok(parts.some(part=>part.includes(value)),value);assert.ok(parts.every(part=>part.split(/\s+/u).length<=18));assert.equal(parts.join(' '),text);
 }
});
test('ranges refer to untouched whitespace and input is never normalized',()=>{
 const text='  O suporte falhou.\n\n talvez seja a altura\t vamos testar a seção sob 10 kN.  ';
 lossless(text,Speech.segment(text));assert.equal(Speech.segment(text)[0].start,2);
 assert.throws(()=>Speech.segment({}),/texto/);assert.throws(()=>Speech.segment('teste',{softWords:2}),/Limites/);assert.deepEqual(Speech.split(' \n\t '),[]);
});
test('imported timestamp, speaker, raw source and one shared segment survive idea segmentation',()=>{
 const raw='[00:01:20] Ana: '+actual,entry=Session.parseTranscriptEntries(raw)[0],parts=Speech.entries(entry,'import');
 assert.ok(parts.length>=4);assert.equal(parts[0].sourceText,raw);assert.equal(parts.filter(p=>p.sourceText).length,1);
 assert.ok(parts.every(p=>p.speaker==='Ana'&&p.offsetMs===80000&&p.segmentId===entry.segmentId&&p.source==='import'));
 assert.equal(parts.map(p=>p.text).join(' '),actual);
});
test('recognizer source and timing stay attached to every slice without invented timestamps',()=>{
 const parts=Speech.entries({text:actual+' '+command,sourceText:actual+' '+command,sourceId:'run-1:0',segmentId:'microphone:meeting:run-1:0',speaker:'Você',offsetMs:1200},'microphone');
 assert.ok(parts.length>=5);assert.ok(parts.every(p=>p.offsetMs===1200&&p.sourceId==='run-1:0'&&p.segmentId==='microphone:meeting:run-1:0'));
 assert.equal(parts[0].sourceText,actual+' '+command);assert.equal(parts.at(-1).text,command);
});
test('optional vocative normalization does not remove fillers from ordinary speech',()=>{
 assert.equal(Speech.normalizeCommand(command),'Norte vamos simular um teste uma discussão vamos simular uma viga');
 assert.equal(Speech.normalizeCommand('tá então a viga mudou'),'tá então a viga mudou');
});
test('segmented live speech uses the existing memory workers and restores its exact raw turn',async()=>{
 const source=actual+' '+command,received=[],session=Session.create({commandHandler:async text=>{received.push(text);return Speech.isCommand(text)?{consumed:true,status:'applied',message:'Comando aplicado.'}:null;},send:async(request,provider,lane)=>{
  const answers=Object.fromEntries(Object.entries(request.questions).map(([id,q])=>{
   if(q.type==='noul')return [id,{type:'noul',noul:request.state.current_utterance.startsWith('Oi gente')?.03:.98}];
   const choice=id==='command_type'?'conversation':id==='event_type'?'observation':id.startsWith('relation_type')?'none':id.startsWith('configuration_match')?'not_applicable':'belongs';
   assert.ok(Object.hasOwn(q.criteria,choice),'fixture choice '+id);return [id,{type:'choice',choice,confidence:.1,probabilities:Object.fromEntries(Object.keys(q.criteria).map(key=>[key,key===choice?.98:.02/(Object.keys(q.criteria).length-1)]))}];
  }));return {request,provider,latencyMs:1,response:{model:'segmentation-fixture',answers}};
 }});
 for(const part of Speech.entries({text:source,segmentId:'microphone:one:run-1:0',sourceId:'run-1:0',offsetMs:2000,speaker:'Você'},'microphone')){const {text,...meta}=part;session.append(text,meta);}
 const run=await session.close();assert.equal(run.status,'done');assert.ok(run.transcript.length>=5);assert.equal(run.records.length,run.transcript.length-1);assert.equal(run.meeting_events.length,run.records.length-1);
 assert.equal(received.at(-1),command,'the parser receives the literal addressed command, not a rewritten one');
 assert.equal(run.transcript.at(-1).status,'command');assert.equal(run.transcript[0].sourceText,source);assert.equal(run.transcript.map(e=>e.text).join(' '),source);
 const restored=Session.restore(run);assert.equal(restored.transcript[0].sourceText,source);assert.equal(restored.transcript.at(-1).text,command);assert.equal(restored.meeting_events.length,run.meeting_events.length);
 const continuation=run.records[1].storeOutput.request;assert.equal(continuation.state.current_utterance,run.transcript[1].text);assert.equal(continuation.state.speech_context.preceding_words,run.transcript[0].text);assert.match(continuation.questions.should_store_memory.instructions,/ONLY information newly stated or completed in current_utterance/);
});

test('the reported paragraph cannot survive as one chunk even without known discourse markers',()=>{
 const text='Oi gente vamos começar a reunião então tá a gente vai começar a discutir primeiro a parte de do tamanho da viga ela deu problema no teste anterior e a gente tem que resolver isso tá como que a gente vai fazer então o que eu pensei era da gente pegar e conseguir diminuir o tamanho dela';
 const parts=Speech.segment(text);assert.ok(parts.length>=4);lossless(text,parts);assert.ok(parts.every(p=>p.text.split(/\s+/u).length<=18));
 const entries=Speech.entries({text,offsetMs:1000,sourceId:'audio:1'},'microphone');assert.ok(entries.every(p=>p.offsetMs===1000));assert.equal(entries[0].sourceText,text);assert.ok(entries.slice(1).every(p=>p.speechContext.split(/\s+/u).length<=60));
});
