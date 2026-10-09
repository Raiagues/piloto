const {test}=require('node:test'),assert=require('node:assert/strict');
const C=require('../beam-commands.js'),B=require('../beam-engine.js'),Speech=require('../meeting-speech.js');
const state=()=>B.defaultState();

test('natural simulation invitations and common typing errors work before any simulator is active',async()=>{
 const phrases=[
  'quero abrir a simulacao','quero fazer uma simulação','abirr simulação','vamos simular uma viga','simula a viga',
  'Quero abrir a simulaççao.','pode abrir a simulação?','você poderia abrir a simulação?',
  'poderia mostrar a simulação?','consegue abrir o simulador?','eu quero fazer uma simulação',
  'vamos fazer uma simulação','bora simular uma viga','podemos simular uma viga?',
  'inicia uma simulação','iniciar o simulador','roda a simulação','vamos rodar uma simulação',
  'quero uma simulação','gostaria de uma simulação','gostaria de abrir a simulação',
  'quero simular','vamos simular','simular uma viga','abrir uma simulacoa',
  'por favor, abra o simulador','abre pra mim a simulação','quero que você abra a simulação',
  'bom então quero abrir a simulação','Norte, quero fazer uma simulação','abir o simulador',
  'vamos simualr uma viga','mostra a simulação da viga'
 ];
 for(const text of phrases){
  const s=state(),before=JSON.stringify(s);let calls=0;
  const out=await C.process(text,{state:s,transport:async()=>{calls++;throw Error('Views must not require the provider');}});
  assert.equal(out.status,'proposed',text+' '+JSON.stringify(out));
  assert.deepEqual(out.operations,[{type:'open_simulation'}],text);
  assert.equal(out.routing,'local_navigation');assert.deepEqual(out.requests,[]);assert.deepEqual(out.outputs,[]);
  assert.equal(out.probability,null,'local match is not measured AI accuracy');assert.equal(calls,0);
  assert.equal(out.raw_text,text);assert.equal(JSON.stringify(s),before);
 }
});

test('view navigation is immediate offline and preserves diagrams versus calculations',async()=>{
 for(const [text,type] of [
  ['quero ver os resultados','show_results'],['poderia mostrar os cálculos?','show_calculations'],
  ['abre os resultados','show_results'],['mostra os gráficos','show_graphs'],
  ['mostra o diagrama de momento fletor','show_graphs'],['volta pro canvas','show_canvas'],
  ['abre a seção','show_section'],['mostra os caluculos','show_calculations']
 ]){
  const out=await C.process(text,{state:state()});assert.equal(out.status,'proposed',text);assert.equal(out.operations[0].type,type);assert.equal(out.routing,'local_navigation',text);
 }
});

test('negation, quotation, explanation, hypothetical and unrelated simulation are not local navigation',async()=>{
 for(const text of [
  'não quero abrir a simulação','nunca abra o simulador','nem abra a simulação',
  'talvez vamos simular uma viga','se eu quiser abrir uma simulação','quando abrir a simulação vamos comparar',
  'ele disse quero abrir a simulação','ela falou "simula a viga"','"quero fazer uma simulação"',
  "'quero fazer uma simulação'",'por exemplo, abirr simulação','como abrir a simulação?',
  'a gente discutiu uma simulação','quero explicar como abrir a simulação',
  'a simulação','uma simulação','vamos fazer uma simulação de financiamento',
  'quero abrir a simulação amanhã','simula a viga amanhã','mostra os resultados depois da reunião',
  'mostra os cálculos e os esforços desconhecidos','abra a simulação com apoios e cargas'
 ]){
  const candidate=C.parse(text,{state:state(),active:true});
  assert.equal(C.localView(candidate),false,text);
  const out=await C.process(text,{state:state(),active:true});assert.deepEqual(out.operations,[],text);
 }
});

test('opening plus a physical edit retains every operation and still needs classification',async()=>{
 for(const text of ['quero fazer uma simulação de 8 m','vamos simular uma viga de oito metros','abra a simulação e mude o comprimento para 8 m']){
  const candidate=C.parse(text,{state:state()});assert.equal(candidate.valid,true,text);
  assert.deepEqual(candidate.operations,[{type:'open_simulation'},{type:'change_beam',patch:{L:8}}]);
  assert.equal(C.localView(candidate),false);const out=await C.process(text,{state:state()});assert.equal(out.status,'classification_error');assert.deepEqual(out.operations,[]);
 }
 for(const text of ['abra a simulação com força de 12 kN','quero fazer uma simulação de 8 m com uma carga de 12 kN'])assert.equal(C.parse(text,{state:state()}).valid,false,text);
});

test('natural beam and P1 edits preserve absolute, incremental and percentage semantics',()=>{
 for(const [text,field,value] of [
  ['aumenta a viga para 8 metros','L',8],['reduz a viga em 2 metros','L',4],
  ['diminui a viga para 4','L',4],['poderia aumentar o comprimento para 8?','L',8],
  ['aumentar a viga para 8 m','L',8],['reduzir o comprimento em 2 m','L',4],
  ['aumenta a viga em 50%','L',9],['reduz o comprimento da viga em 25 por cento','L',4.5],
  ['reduza a força P1 em 20%','value',8000],['aumenta P1 em 50%','value',15000],
  ['muda a força p um para 12','value',12000],['aumenta a força P1 para 2 kN','value',2000],
  ['aumenta a altura em 20 mm','h',.26],['reduz a altura em 50%','h',.12]
 ]){
  const s=state(),before=JSON.stringify(s),p=C.parse(text,{state:s,active:true});
  assert.equal(p.valid,true,text+' '+JSON.stringify(p.issues));assert.equal(p.operations[0].patch[field],value,text);assert.equal(JSON.stringify(s),before);
 }
 for(const text of ['aumenta a força P1 e o comprimento em 20%','reduz a viga em 120%','aumenta P9 em 20%','mova P9 para 3 m','se aumentar a viga em 20%','não aumenta a viga em 20%']){
  const p=C.parse(text,{state:state(),active:true});assert.equal(p.valid,false,text);assert.deepEqual(p.operations,[]);
 }
 const s=state();s.loads[0].unit='N';assert.equal(C.parse('aumente P1 em 20%',{state:s,active:true}).operations[0].patch.value,12000);
 s.loads.push({...s.loads[0],id:'p2',name:'P2'});assert.equal(C.parse('aumente a força em 20%',{state:s,active:true}).valid,false);
});

test('natural commands remain atomic in transcription without rewriting or absorbing discussions',()=>{
 for(const text of [
  'quero fazer uma simulação','abirr simulação','vamos simular uma viga',
  'poderia aumentar o comprimento da viga para oito metros e mostrar os gráficos de cortante e momento fletor para comparação'
 ]){
  const parts=Speech.segment(text);assert.equal(parts.length,1,text);assert.equal(parts[0].text,text);assert.equal(parts[0].command,true,text);
 }
 const text='A viga apresentou deformação. Quero fazer uma simulação. Não aumenta a força P1 para 20 kN.';
 const parts=Speech.segment(text);assert.equal(parts.length,3);assert.deepEqual(parts.map(p=>p.command),[false,true,false]);assert.equal(parts.map(p=>p.text).join(' '),text);
 for(const text of ['4 metros','para 15 mm','a simulação','"quero fazer uma simulação"','Vamos testar se aumentar a viga resolve.'])assert.equal(Speech.isCommand(text),false,text);
});
