const {test}=require('node:test'),assert=require('node:assert/strict');
const C=require('../beam-commands.js'),B=require('../beam-engine.js');
const clone=value=>JSON.parse(JSON.stringify(value)),state=()=>B.defaultState();
function reply(request,{action,mode,fit='exact',probability=.97,confidence=.01}={}){
 const ops=request.state.deterministic_candidate.operations;
 const categories=ops.map(op=>/_(?:load)$/.test(op.type)?'load':/_(?:support)$/.test(op.type)?'support':['show_results','show_calculations','show_canvas','show_section'].includes(op.type)?'show_inspection':op.type);
 const modes=[...new Set(ops.map(op=>op.type.startsWith('add_')?'add':op.type.startsWith('update_')?'update':op.type.startsWith('remove_')?'remove':op.type.startsWith('change_')?'change':'view'))];
 const choices={beam_action:action||(ops.length>1?'compound':categories[0]||'other_command'),action_mode:mode||(modes.length>1?'mixed':modes[0]||'not_applicable'),candidate_fit:fit};
 return {request:clone(request),provider:'official',latencyMs:12,response:{model:'fixture-not-a-live-model',answers:Object.fromEntries(Object.entries(request.questions).map(([id,q])=>[id,{type:'choice',choice:choices[id],confidence,probabilities:Object.fromEntries(Object.keys(q.criteria).map(key=>[key,key===choices[id]?probability:(1-probability)/(Object.keys(q.criteria).length-1)]))}]))}};
}
const transport=settings=>async request=>reply(request,settings);
function valid(text,s=state(),options={}){const before=JSON.stringify(s),p=C.parse(text,{state:s,...options});assert.equal(p.valid,true,text+' '+JSON.stringify(p.issues));assert.equal(JSON.stringify(s),before,'parser never mutates');B.applyOperations(s,p.operations);return p.operations;}
test('classifier has choice-only intent, mode and literal candidate validation within protocol limits',()=>{
 const request=C.buildRequest('Norte, mude a força P1 para 12 kN',{state:state()});
 assert.equal(request.model,'jev-latest');assert.deepEqual(Object.keys(request.questions),['beam_action','action_mode','candidate_fit']);
 for(const q of Object.values(request.questions)){assert.equal(q.type,'choice');assert.ok(Object.keys(q.criteria).length<=12);}
 assert.deepEqual(request.state.deterministic_candidate.operations[0].patch.magnitude,{value:12,unit:'kN'});assert.deepEqual(request.state.deterministic_candidate.operations[0].patch.equivalent_si,{value:12000,unit:'N'});assert.doesNotMatch(JSON.stringify(request),/expected_|api.key|secret/i);
 const bad=clone(C.defaults);bad.questions.candidate_fit.type='noul';assert.throws(()=>C.validateConfig(bad));
});
test('wake word variants and explicit active-context commands route without swallowing meeting commands',()=>{
 for(const text of ['Norte, vamos simular uma viga','Ok, Norte, abra o simulador','OK Norte mostre os resultados'])assert.ok(C.isCandidate(text),text);
 assert.equal(C.isCandidate('Mude a força P1 para 12 kN'),false);assert.equal(C.isCandidate('Mude a força P1 para 12 kN',{active:true}),true);
 for(const text of ['Vamos testar uma viga de 12 metros','A força P1 deveria ser de 12 kN','Se eu disser Norte, mude a viga para 10 m','"Norte, abra o simulador"','Norte, mude o título do assunto 1 para Viga','Norte é a direção da carga'])assert.equal(C.isCandidate(text,{active:true}),false,text);
});
test('opens the original simulator without silently resetting existing geometry or loads',()=>{
 assert.deepEqual(valid('Norte, vamos simular uma viga'),[{type:'open_simulation'}]);
 assert.deepEqual(valid('Norte, abra o simulador e mude o comprimento para 10 m'),[{type:'open_simulation'},{type:'change_beam',patch:{L:10}}]);
 const p=C.parse('Norte, simule uma viga de 10 m com dois apoios e uma carga de 12 kN',{state:state()});assert.equal(p.valid,false);assert.deepEqual(p.operations,[]);assert.ok(p.issues.some(i=>i.code==='ambiguous_setup'));
});
test('beam dimensions and Portuguese spoken quantities convert to SI without conflating position and load',()=>{
 assert.equal(valid('Norte, mude o comprimento da viga para dez metros')[0].patch.L,10);
 assert.equal(valid('Norte, mude o comprimento para 650 cm')[0].patch.L,6.5);
 assert.equal(valid('Norte, aumente o comprimento da viga em 2 m')[0].patch.L,8);
 assert.equal(valid('Norte, reduza o comprimento da viga em 1,5 m')[0].patch.L,4.5);
 assert.equal(valid('Norte, mude a massa total da viga para 120 kg')[0].patch.mbar,120);
 assert.equal(valid('Norte, defina a gravidade para 9,81 m/s²')[0].patch.g,9.81);
 const s=state();s.L=10;s.loads[0].x=10;
 const load=valid('Norte, adicione uma força de doze quilonewtons para baixo a dez metros',s)[0].load;
 assert.equal(load.x,10);assert.equal(load.value,12000);assert.equal(load.unit,'kN');assert.equal(load.direction,1);
});
test('add force, moment, mass and distributed load preserve their dimensions and orientation',()=>{
 for(const [text,expected] of [
  ['Norte, adicione uma força de 1200 N para cima a 250 cm',{kind:'force',value:1200,x:2.5,direction:-1}],
  ['Norte, adicione um momento de 5 kNm horário na ponta',{kind:'moment',value:5000,x:6,direction:-1}],
  ['Norte, aplique um momento de 8 kN·m anti-horário a 4 m',{kind:'moment',value:8000,x:4,direction:1}],
  ['Norte, adicione uma massa de 50 kg no meio',{kind:'mass',value:50,x:3,direction:1}],
  ['Norte, adicione uma carga distribuída de 2 kN/m para baixo de 1 m até 5 m',{kind:'udl',value:2000,x:1,end:5,direction:1}],
  ['Norte, adicione uma carga distribuída de 800 N/m para cima ao longo de toda a viga',{kind:'udl',value:800,x:0,end:6,direction:-1}]
 ]){const load=valid(text)[0].load;for(const [key,value] of Object.entries(expected))assert.equal(load[key],value,text+' '+key);}
});
test('existing loads resolve IDs and names; parameter updates preserve unspecified values',()=>{
 assert.deepEqual(valid('Norte, mude a força P1 para 12 kN')[0],{type:'update_load',id:'p1',patch:{kind:'force',value:12000,unit:'kN'}});
 assert.deepEqual(valid('Norte, mova P1 para 4 m')[0],{type:'update_load',id:'p1',patch:{x:4,edge:null}});
 assert.equal(valid('Norte, aumente a força P1 em 2 kN')[0].patch.value,12000);
 assert.equal(valid('Norte, reduza a força P1 em 2 kN')[0].patch.value,8000);
 assert.equal(valid('Norte, inverta o sentido da força P1')[0].patch.direction,-1);
 assert.equal(valid('Norte, mude a força P1 de 10 kN para 12 kN')[0].patch.value,12000);
 const s=state();s.loads.push({id:'p2',name:'Q1',kind:'udl',x:1,end:4,value:1000,direction:1,unit:'Npm',edge:null,endEdge:null});
 assert.deepEqual(valid('Norte, mude o fim da carga Q1 para 5 m',s)[0],{type:'update_load',id:'p2',patch:{end:5,endEdge:null}});
 assert.deepEqual(valid('Norte, remova a carga Q1',s)[0],{type:'remove_load',id:'p2'});
});
test('support types and positions are explicit, including target removal and changing a known support',()=>{
 assert.deepEqual(valid('Norte, adicione um apoio articulado a 3 m')[0],{type:'add_support',support:{type:'pin',x:3,edge:null}});
 assert.deepEqual(valid('Norte, adicione um rolete no fim')[0],{type:'add_support',support:{type:'roller',x:6,edge:'right'}});
 assert.deepEqual(valid('Norte, mude o apoio A para rolete')[0],{type:'update_support',id:'s1',patch:{type:'roller'}});
 assert.deepEqual(valid('Norte, remova o apoio A')[0],{type:'remove_support',id:'s1'});
 const s=state();s.supports[0].type='pin';assert.equal(valid('Norte, mova o apoio A para 2 m',s)[0].patch.x,2);
});
test('section and material fields use named dimensions, recognized presets and SI values',()=>{
 assert.deepEqual(valid('Norte, mude a seção para perfil I')[0],{type:'change_section',patch:{shape:'i'}});
 assert.deepEqual(valid('Norte, mude a largura da seção para 150 mm e altura para 30 cm')[0].patch,{b:.15,h:.3});
 const s=state();s.section.shape='i';assert.equal(valid('Norte, mude a espessura da alma para 8 mm',s)[0].patch.tw,.008);assert.equal(valid('Norte, mude a espessura da mesa para 20 mm',s)[0].patch.tf,.02);
 assert.equal(valid('Norte, use alumínio 6061-T6')[0].patch.key,'aluminum');assert.equal(valid('Norte, use aço inox 304')[0].patch.key,'stainless');
 assert.deepEqual(valid('Norte, defina o módulo de elasticidade para 70 GPa')[0].patch,{E:70e9,key:'custom'});
 assert.deepEqual(valid('Norte, defina a tensão de escoamento para 250 MPa')[0].patch,{yield:250e6,key:'custom'});
 assert.deepEqual(valid('Norte, defina a densidade para 2700 kg/m³')[0].patch,{rho:2700,key:'custom'});
});
test('graphs, numerical results, calculations and comparison are distinct nonmutating views',()=>{
 assert.deepEqual(valid('Norte, mostre os gráficos de cortante, momento fletor e flecha'),[{type:'show_graphs',graphs:['shear','bending','deflection']}]);
 assert.deepEqual(valid('Norte, mostre o diagrama de flecha'),[{type:'show_graphs',graphs:['deflection']}]);
 assert.deepEqual(valid('Norte, mostre os resultados'),[{type:'show_results'}]);assert.deepEqual(valid('Norte, mostre os cálculos'),[{type:'show_calculations'}]);assert.deepEqual(valid('Norte, compare antes e depois'),[{type:'compare',reference:'previous'}]);
 assert.deepEqual(valid('Norte, compare o esforço cortante antes e depois'),[{type:'compare',reference:'previous',graphs:['shear']}]);
 assert.deepEqual(valid('Norte, compare o momento fletor e a flecha com a configuração inicial'),[{type:'compare',reference:'initial',graphs:['bending','deflection']}]);
});
test('natural requests resolve a deictic force only when the target is unique',()=>{
 const s=state();s.L=10;s.loads[0].x=10;
 assert.equal(valid('Norte, vamos variar essa força e colocar ela em dez metros',s)[0].patch.x,10);
 assert.equal(valid('Norte, quero mudar o tipo do apoio para articulado',s)[0].patch.type,'pin');
 s.loads.push({...s.loads[0],id:'p2',name:'P2',x:4,edge:null});const ambiguous=C.parse('Norte, vamos variar essa força e colocar ela em dez metros',{state:s});assert.equal(ambiguous.valid,false);assert.ok(ambiguous.issues.some(i=>i.code==='missing_target'));
});
test('extra unitless values or quantities outside the represented operation cannot disappear',()=>{
 for(const text of ['Norte, mude o apoio A para articulado em 2','Norte, mude a força P1 para 12 kN e 200 GPa','Norte, mostre os resultados em 12 m','Norte, remova a carga P1 de 12 kN']){const p=C.parse(text,{state:state()});assert.equal(p.valid,false,text);assert.deepEqual(p.operations,[]);}
});
test('missing units, direction, targets and unsafe dimensions never yield a partial operation',()=>{
 const s=state();s.loads.push({...s.loads[0],id:'p2',name:'P2',x:3,edge:null});
 for(const text of ['Norte, adicione uma força de 12 kN a 4 m','Norte, adicione uma força de 12 kN para baixo','Norte, adicione uma força de 12 para baixo a 4 m','Norte, mude a força para 12 kN','Norte, mova P9 para 3 m','Norte, adicione um momento de 5 kN horário a 3 m','Norte, adicione uma força de 12 kN horizontal a 4 m','Norte, mude o comprimento para 40 m','Norte, mude a espessura para 5 mm','Norte, use alumínio 6351','Norte, adicione um engaste a 2 m','Norte, adicione um apoio articulado no início','Norte, adicione uma carga distribuída de 1 kN/m para baixo de 5 m até 2 m','Norte, mude a carga P1 para -12 kN','Norte, mude a carga P1 para 1.200 N','Norte, abra o simulador e adicione uma força de 12 kN']){const p=C.parse(text,{state:s});assert.equal(p.valid,false,text);assert.deepEqual(p.operations,[],text);assert.ok(p.clarifications.length,text);}
});
test('composite commands remain atomic and preserve the original state',()=>{
 const s=state(),before=clone(s),ops=valid('Norte, mude o comprimento para 10 m e adicione uma força de 12 kN para baixo a 10 m',s);
 assert.equal(ops.length,2);assert.equal(ops[1].load.x,10);assert.deepEqual(s,before);
 const applied=B.applyOperations(s,ops);assert.equal(applied.state.L,10);assert.equal(applied.state.loads[1].value,12000);assert.equal(applied.state.loads[0].x,10);
});
test('process validates all three classifications and returns proposals plus source audit without mutation',async()=>{
 const s=state(),run={provider:'official',meeting_commands:[],meeting_events:[]},before=JSON.stringify({s,run});
 const out=await C.process('Norte, mude a força P1 para 12 kN',{state:s,run,transport:transport()});
 assert.equal(out.status,'proposed');assert.equal(out.consumed,true);assert.equal(out.operations[0].patch.value,12000);assert.equal(out.probability,.97);assert.equal(out.classifications.beam_action.confidence,.01);assert.deepEqual(out.requests[0],out.outputs[0].request);assert.equal(JSON.stringify({s,run}),before);
});
test('classification probability gates cannot be bypassed by confidence or an exact candidate',async()=>{
 for(const config of [{probability:.8},{probability:.79},{fit:'contradicted'},{fit:'ambiguous'},{action:'support'}]){const out=await C.process('Norte, mude a força P1 para 12 kN',{state:state(),transport:transport(config)});assert.equal(out.status,'ambiguous');assert.deepEqual(out.operations,[]);}
 const incomplete=await C.process('Norte, adicione uma força de 12 kN',{state:state(),transport:transport()});assert.equal(incomplete.status,'ambiguous');assert.deepEqual(incomplete.operations,[]);
});
test('classifier candidates express engineering names and units while executable operations remain SI',()=>{
 const s=state();s.section.shape='i';
 const section=C.buildRequest('Norte, mude a espessura da alma para 8 mm',{state:s});assert.deepEqual(section.state.deterministic_candidate.operations[0].patch,{web_thickness_mm:8});assert.equal(C.parse(section.state.utterance,{state:s}).operations[0].patch.tw,.008);
 const material=C.buildRequest('Norte, use alumínio 6061-T6',{state:s});assert.equal(material.state.deterministic_candidate.operations[0].patch.preset,'Alumínio 6061-T6');
 const support=C.buildRequest('Norte, quero mudar o tipo do apoio para articulado',{state:s});assert.equal(support.state.deterministic_candidate.operations[0].patch.type,'articulado');assert.equal(C.parse(support.state.utterance,{state:s}).operations[0].patch.type,'pin');
 const load=C.buildRequest('Norte, adicione um momento de 5 kNm horário na ponta',{state:s});assert.deepEqual(load.state.deterministic_candidate.operations[0].load.magnitude,{value:5,unit:'kN·m'});assert.equal(load.state.deterministic_candidate.operations[0].load.direction,'horário');assert.equal(load.state.beam_state.loads[0].magnitude.value,10);
});
test('strict parameterless views validate intent and mode but still refuse contradiction or ambiguity',async()=>{
 const open=await C.process('Norte, vamos simular uma viga',{state:state(),transport:transport({fit:'incomplete'})});assert.equal(open.status,'proposed');assert.deepEqual(open.validation_gates,['beam_action']);
 for(const fit of ['contradicted','ambiguous','not_applicable']){const out=await C.process('Norte, vamos simular uma viga',{state:state(),transport:transport({fit})});assert.equal(out.status,'ambiguous',fit);assert.deepEqual(out.operations,[]);}
 const lowIntent=await C.process('Norte, vamos simular uma viga',{state:state(),transport:transport({probability:.8})});assert.equal(lowIntent.status,'ambiguous');
 const decorated=await C.process('Norte, mostre os resultados e os esforços desconhecidos',{state:state(),transport:transport({fit:'incomplete'})});assert.equal(decorated.status,'ambiguous','only a fully matched parameterless sentence bypasses a nonexistent value check');
});
test('conversation skips transport and classifier conversation releases the utterance to meeting extraction',async()=>{
 let calls=0;const send=async req=>{calls++;return reply(req,{action:'conversation',mode:'not_applicable',fit:'not_applicable'});};
 for(const text of ['Vamos testar a viga de 10 m','Norte, mude o título do assunto 1 para Viga']){const out=await C.process(text,{state:state(),transport:send});assert.equal(out.status,'conversation');assert.equal(out.consumed,false);}assert.equal(calls,0);
 const rejected=await C.process('Norte, mostre os cálculos',{state:state(),transport:send});assert.equal(rejected.consumed,false);assert.deepEqual(rejected.operations,[]);assert.equal(calls,1);
});
test('timeout, wrong provider, malformed response and changed state retain safe audit but no operations',async()=>{
 for(const send of [async()=>{throw Error('unexpected provider diagnostics SECRET');},async req=>({...reply(req),provider:'local'}),async req=>{const out=reply(req);out.request.state.utterance='forged';return out;},async()=>new Promise(()=>{})]){const out=await C.process('Norte, mova P1 para 4 m',{state:state(),transport:send,timeoutMs:15});assert.equal(out.status,'classification_error');assert.deepEqual(out.operations,[]);assert.doesNotMatch(JSON.stringify(out),/SECRET/);assert.ok(out.requests.length);}
 const s=state(),out=await C.process('Norte, mova P1 para 4 m',{state:s,transport:async req=>{s.L=8;return reply(req);}});assert.equal(out.status,'ambiguous');assert.deepEqual(out.operations,[]);assert.match(out.message,/mudou/);
});
test('real speech restarts and filler prefixes open the simulator without an exact phrase or mandatory wake word',()=>{
 for(const text of ['tá então o Norte vamos simular um teste uma discussão vamos simular uma viga','Norte vamos simular uma viga','bom então vamos simular uma viga','vamos simular uma viga','abre o simulador']){const p=C.parse(text,{state:state()});assert.equal(p.valid,true,text);assert.deepEqual(p.operations,[{type:'open_simulation'}]);assert.equal(p.raw_text,text);}
 const unsafe=C.parse('Norte, coloque 12 kN e vamos simular uma viga',{state:state()});assert.equal(unsafe.valid,false,'restart cannot discard earlier physical parameters');
});
test('ASR km becomes kN only for a uniquely identified force magnitude and preserves provenance',()=>{
 for(const text of ['Norte a força P1 para 12 km','Norte mude a força P1 para 12 km','muda essa força pra 12 km','coloque a força P1 para 12 km','mude a força p 1 para doze km']){const p=C.parse(text,{state:state(),active:true,source:'microphone'});assert.equal(p.valid,true,text);assert.equal(p.operations[0].type,'update_load');assert.equal(p.operations[0].patch.value,12000);assert.equal(p.raw_text,text);assert.ok(p.normalizations.some(n=>n.kind==='asr_unit'));}
 for(const text of ['Norte, mova a força para 12 km','Norte, mude a posição da força P1 para 12 km','Norte, mude o comprimento da viga para 12 km']){const p=C.parse(text,{state:state(),active:true});assert.equal(p.valid,false,text);assert.equal(p.normalizations.some(n=>n.kind==='asr_unit'),false,text);}
 const s=state();s.loads.push({...s.loads[0],id:'p2',name:'P2',x:3,edge:null});const ambiguous=C.parse('muda a força pra 12 km',{state:s,active:true});assert.equal(ambiguous.valid,false);assert.equal(ambiguous.normalizations.some(n=>n.kind==='asr_unit'),false);
});
test('omitted force units use the visible unit of the clear target, never a universal kN default',()=>{
 let p=C.parse('muda a força pra 12',{state:state(),active:true});assert.equal(p.operations[0].patch.value,12000);assert.ok(p.normalizations.some(n=>n.kind==='display_unit'));
 const s=state();s.loads[0].unit='N';p=C.parse('Norte a força P1 para 12',{state:s});assert.equal(p.operations[0].patch.value,12);assert.equal(p.operations[0].patch.unit,'N');
 assert.equal(C.parse('coloca em 12',{state:s,active:true}).valid,false,'unique force alone does not choose magnitude versus position');
});
test('short follow-ups reuse one recent field, enforce dimensional compatibility and expire',()=>{
 const s=state(),last={...C.parse('Norte, mude a força P1 para 12 kN',{state:s}),id:'BC1',created_at:new Date().toISOString()};
 const p=C.parse('coloca em 14',{state:s,active:true,context:{lastCommand:last}});assert.equal(p.operations[0].patch.value,14000);assert.equal(p.normalizations.find(n=>n.kind==='contextual_followup').context_command_id,'BC1');
 assert.equal(C.parse('agora 25 cm',{state:s,active:true,context:{lastCommand:last}}).valid,false,'force magnitude context cannot become a position');
 const height={...C.parse('Norte, mude a altura da seção para 300 mm',{state:s}),created_at:new Date().toISOString()};assert.equal(C.parse('agora 25 cm',{state:s,active:true,context:{lastCommand:height}}).operations[0].patch.h,.25);
 height.created_at=new Date(Date.now()-61000).toISOString();assert.equal(C.parse('agora 25 cm',{state:s,active:true,context:{lastCommand:height}}).valid,false);
 const multi=C.parse('Norte, mude a largura da seção para 120 mm e altura para 300 mm',{state:s});assert.equal(C.parse('agora 25 cm',{state:s,active:true,context:{lastCommand:multi}}).valid,false,'multi-field changes do not select an arbitrary field');
});
test('a separate unit completes the pending number without rewriting either transcript entry',()=>{
 const pending={id:'BC-PENDING',text:'Norte, mude a força P1 para 12 km',status:'ambiguous',created_at:new Date().toISOString()},before=JSON.stringify(pending);
 const p=C.parse('KN',{state:state(),active:true,context:{pendingAudit:pending}});assert.equal(p.valid,true);assert.equal(p.raw_text,'KN');assert.equal(p.operations[0].patch.value,12000);assert.ok(p.normalizations.some(n=>n.kind==='pending_unit'));assert.equal(JSON.stringify(pending),before);
 assert.equal(C.parse('KN',{state:state(),active:true}).valid,false);assert.equal(C.parse('cm',{state:state(),active:true,context:{pendingAudit:pending}}).valid,false);
});
test('natural tab navigation maps to view operations and resolves only an available previous tab',()=>{
 const options={state:state(),active:true,activeTab:'results',previousTab:'canvas',availableTabs:['canvas','simulation','results']};
 for(const [text,type] of [['volta pro canvas','show_canvas'],['volte pra simulação','open_simulation'],['quero ver os resultados','show_results'],['mostra os cálculos','show_calculations'],['mostra a seção','show_section'],['volta pra aba anterior','show_canvas']]){const p=C.parse(text,options);assert.equal(p.valid,true,text);assert.equal(p.operations[0].type,type);}
 assert.deepEqual(C.parse('volta para os gráficos',options).operations[0].graphs,['shear','bending','deflection']);
 assert.equal(C.parse('volta pra aba anterior',{...options,previousTab:null}).valid,false);assert.equal(C.parse('volta pra aba anterior',{...options,previousTab:'graphs'}).valid,false,'closed/nonexistent previous tab is not fabricated');
});
test('negation, quotations, conditionals and ordinary discussion never become contextual commands',()=>{
 const context={lastCommand:C.parse('Norte, mude a força P1 para 12 kN',{state:state()})};
 for(const text of ['não mude a força','Norte não mude a força para 12 km','se aumentar a força para 12 kN','vamos discutir se deveria aumentar a força','ele disse "Norte mude a força para 12 km"','por exemplo Norte vamos simular uma viga','a força é de 12 kN','talvez agora 25 cm']){const p=C.parse(text,{state:state(),active:true,context});assert.equal(p.consumed,false,text);assert.deepEqual(p.operations,[]);}
});
test('classification receives the interpreted request with original speech and normalization audit separately',async()=>{
 const text='muda essa força pra 12 km',s=state(),before=JSON.stringify(s),out=await C.process(text,{state:s,active:true,source:'microphone',transport:transport({mode:'add'})});
 assert.equal(out.status,'proposed');assert.equal(out.text,text);assert.equal(out.raw_text,text);assert.match(out.interpreted_text,/12 kn/i);assert.equal(out.requests[0].state.raw_utterance,text);assert.equal(out.requests[0].state.utterance,out.interpreted_text);assert.equal(out.requests[0].state.interpretation.source,'microphone');assert.equal(out.operations[0].patch.value,12000);assert.equal(out.mode_agrees,false,'redundant mode remains audit, while intent and complete candidate are validated');assert.equal(JSON.stringify(s),before);
 const discussion=await C.process(text,{state:s,active:true,transport:transport({action:'conversation',fit:'not_applicable'})});assert.equal(discussion.consumed,false);assert.deepEqual(discussion.operations,[]);
});
test('polite and colloquial phrasing preserves absolute values versus explicit increments',()=>{
 for(const text of ['pode aumentar a força pra 12?','você pode aumentar a força pra 12?','quero que você mude a força para 12 kN','mude a força para12?']){const p=C.parse(text,{state:state(),active:true});assert.equal(p.valid,true,text);assert.equal(p.operations[0].patch.value,12000);}
 assert.equal(C.parse('vamos deixar a força em 15',{state:state(),active:true}).operations[0].patch.value,15000);
 assert.equal(C.parse('aumenta a força em 2',{state:state(),active:true}).operations[0].patch.value,12000);assert.equal(C.parse('aumenta a força para 2',{state:state(),active:true}).operations[0].patch.value,2000);
 assert.deepEqual(C.parse('eu quero ver o cortante',{state:state(),active:true}).operations,[{type:'show_graphs',graphs:['shear']}]);
 for(const text of ['coloca a altura em 25 centímetros','coloca 25 centímetros de altura'])assert.equal(C.parse(text,{state:state(),active:true}).operations[0].patch.h,.25,text);
});
test('ambiguous pending or multi-field context cannot fall back to an older unrelated field',()=>{
 const s=state(),single=C.parse('Norte, mude a altura da seção para 300 mm',{state:s}),multi=C.parse('Norte, mude a largura da seção para 120 mm e altura para 300 mm',{state:s}),text='Norte, mude a largura da seção para 120 mm e altura para 300 mm';
 const recent=[{text:'Norte, mude a altura da seção para 300 mm',created_at:new Date().toISOString()},{text,created_at:new Date().toISOString()}];
 for(const context of [{lastCommand:multi,recentTranscript:recent},{pendingAudit:{text},lastCommand:single,recentTranscript:recent},{recentTranscript:recent}]){const p=C.parse('agora 25 cm',{state:s,active:true,context});assert.equal(p.valid,false);assert.deepEqual(p.operations,[]);}
 const stale={text:'Norte, mude a altura da seção para 300 mm',created_at:new Date(Date.now()-61000).toISOString()};assert.equal(C.parse('agora 25 cm',{state:s,active:true,context:{recentTranscript:[stale]}}).valid,false);
});
test('polite simulation requests and fragmented microphone invitations open only the requested view',async()=>{
 for(const text of ['Norte você pode abrir a simulação','Norte você poderia mostrar a simulação','Norte pode fazer a simulação','Norte você pode a gente a simulação']){
  assert.deepEqual(valid(text),[{type:'open_simulation'}],text);
 }
 const now=Date.now(),s=state(),before=JSON.stringify(s),pending=await C.process('Norte você pode',{state:s,source:'microphone',nowMs:now,transport:async()=>{throw Error('Incomplete speech must wait without classification');}});
 assert.equal(pending.status,'awaiting_continuation');assert.equal(pending.consumed,true);assert.deepEqual(pending.operations,[]);assert.deepEqual(pending.requests,[]);
 const out=await C.process('a gente a simulação',{state:s,source:'microphone',nowMs:now+5000,context:{pendingAudit:pending},transport:transport()});
 assert.equal(out.status,'proposed');assert.deepEqual(out.operations,[{type:'open_simulation'}]);assert.equal(out.raw_text,'a gente a simulação');assert.ok(out.normalizations.some(n=>n.kind==='pending_navigation'&&n.context_command_id===pending.id));assert.equal(JSON.stringify(s),before);
});
test('a split change request may resolve one force by its explicit unit but never an ambiguous target or section dimension',async()=>{
 const now=Date.now(),s=state(),pending=await C.process('Norte eu quero testar mudar',{state:s,source:'microphone',nowMs:now});
 assert.equal(pending.status,'awaiting_continuation');
 const options={state:s,source:'microphone',nowMs:now+5000,context:{pendingAudit:pending}};
 const p=C.parse('para 10 Kilo Newton',options);assert.equal(p.valid,true);assert.equal(p.operations[0].patch.value,10000);assert.equal(p.operations[0].id,s.loads[0].id);assert.ok(p.normalizations.some(n=>n.kind==='pending_force'));
 const multi=clone(s);multi.loads.push({...multi.loads[0],id:'p2',name:'P2'});assert.equal(C.parse('para 10 Kilo Newton',{...options,state:multi}).valid,false);
 assert.equal(C.parse('para 15 mm',options).valid,false,'a length unit cannot identify width, height or thickness');
 for(const extra of [{nowMs:now+16000},{source:'import'},{context:{pendingAudit:pending,recentTranscript:[{text:'A hipótese precisa de outro teste'}]}}])assert.equal(C.parse('para 10 Kilo Newton',{...options,...extra}).consumed,false,JSON.stringify(extra));
 assert.equal(C.parse('para 10 Kilo Newton',{state:s,source:'microphone'}).consumed,false);
 assert.equal(C.parse('a gente precisa discutir a simulação',{state:s,source:'microphone',context:{pendingAudit:pending}}).consumed,false);
});
test('natural reduction and increase preserve destination versus delta and section names',()=>{
 for(const [text,key,value] of [
  ['eu quero reduzir o tamanho da viga de 6 metros para 5 metros','L',5],
  ['beleza eu quero diminuir o tamanho da viga para 4 metros','L',4],
  ['quero aumentar o comprimento da viga de 5 m para 8 m','L',8],
  ['eu quero reduzir o tamanho da viga em 2 metros','L',4],
  ['eu quero reduzir a força P1 de 10 kN para 5 kN','value',5000],
  ['eu quero reduzir a força P1 em 2 kN','value',8000],
  ['eu quero aumentar a força P1 para 2 kN','value',2000]
 ])assert.equal(valid(text,state(),{active:true})[0].patch[key],value,text);
 const section=C.parse('eu quero reduzir a altura da seção de 240 mm para 200 mm',{state:state(),active:true});assert.equal(section.operations[0].patch.h,.2);assert.ok(section.normalizations.some(n=>n.kind==='explicit_destination'));
 for(const text of ['eu não quero reduzir a força P1 para 5 kN','talvez reduzir o tamanho da viga para 5 m','se reduzir o tamanho da viga para 5 m','ele disse "quero reduzir a força P1 para 5 kN"'])assert.equal(C.parse(text,{state:state(),active:true}).consumed,false,text);
});
test('short capture preserves incomplete baseline and waits for the explicit destination without transport',async()=>{
 const now=Date.now(),opts={state:state(),active:true,activeTab:'simulation',source:'microphone',speaker:'Você',nowMs:now,transport:async()=>{throw Error('Incomplete request must not classify');}};
 for(const text of ['beleza eu quero reduzir de','eu quero reduzir o tamanho da viga de 5 m para','eu quero reduzir a força P1 de 10 Kg','eu quero aumentar a força P1','eu quero reduzir o tamanho da viga de 5 m para me']){
  const p=await C.process(text,opts);assert.equal(p.status,'awaiting_continuation',text);assert.deepEqual(p.operations,[]);assert.deepEqual(p.requests,[]);assert.equal(p.message,'');
  const typed=C.parse(text,{...opts,source:'typed'});assert.equal(typed.valid,false,text);assert.deepEqual(typed.operations,[]);
 }
});
test('captured screenshot baseline in kg never becomes applied mass when destination explicitly names force',async()=>{
 const now=Date.now(),s=state(),opts={state:s,active:true,activeTab:'simulation',source:'microphone',speaker:'Você',nowMs:now};
 const pending=await C.process('eu quero reduzir a força P1 de 10 Kg',opts),out=await C.process('é 5 Kilo newtons',{...opts,nowMs:now+5000,context:{pendingAudit:pending},transport:transport()});
 assert.equal(out.status,'proposed');assert.deepEqual(out.operations,[{type:'update_load',id:'p1',patch:{kind:'force',value:5000,unit:'kN'}}]);
 assert.equal(out.raw_text,'é 5 Kilo newtons');assert.ok(out.normalizations.find(n=>n.kind==='explicit_destination'&&n.stated_from==='10 kg'));assert.equal(s.loads[0].value,10000);
 const unitCorrection=await C.process('kN',{...opts,nowMs:now+3000,context:{pendingAudit:pending}});assert.equal(unitCorrection.status,'awaiting_continuation','a unit alone corrects the baseline without applying it');assert.deepEqual(unitCorrection.operations,[]);assert.match(unitCorrection.interpreted_text,/de 10 kn$/);
 assert.equal(C.parse('para 5 kN',{...opts,nowMs:now+7000,context:{pendingAudit:unitCorrection}}).operations[0].patch.value,5000);
 assert.equal(C.parse('eu quero reduzir a força P1 de 10 kg para 5 kg',{...opts}).valid,false,'kg destination cannot be relabeled as force');
 const massState=clone(s);massState.loads.push({id:'m1',name:'M1',kind:'mass',unit:'kg',value:10,x:3,direction:1});
 const mass=C.parse('eu quero reduzir a massa M1 de 10 kg para 5 kg',{...opts,state:massState});assert.equal(mass.valid,true);assert.equal(mass.operations[0].patch.kind,'mass');assert.equal(mass.operations[0].patch.value,5);
 assert.equal(C.parse('eu quero reduzir a massa M1 de 10 kg para 5 kN',{...opts,state:massState}).valid,false,'actual mass remains a distinct dimension');
});
test('generic reducing in meters resolves only the visible whole beam, not selected entities or section dimensions',async()=>{
 const now=Date.now(),opts={state:state(),active:true,activeTab:'simulation',simulationFocus:'beam',source:'microphone',speaker:'Você',nowMs:now},pending=await C.process('beleza eu quero reduzir de',opts);
 const continued={...opts,nowMs:now+5000,context:{pendingAudit:pending}};
 assert.equal(C.parse('para 5 metros',continued).operations[0].patch.L,5);
 for(const text of ['beleza eu quero reduzir de para 5 metros','beleza eu quero diminuir para 5 metros'])assert.equal(C.parse(text,opts).operations[0].patch.L,5,text);
 for(const extra of [{activeTab:'canvas'},{simulationFocus:'section'},{selection:{kind:'load',id:'p1'}},{selected:{kind:'load',id:'p1'}}])assert.equal(C.parse('para 5 metros',{...continued,...extra}).valid,false,JSON.stringify(extra));
 assert.equal(C.parse('para 5 mm',continued).valid,false,'millimeters do not choose a cross-section dimension');
 const field={...C.parse('Norte mude a altura para 300 mm',{state:state()}),created_at:new Date(now).toISOString()};assert.equal(C.parse('para 5 metros',{...continued,context:{pendingAudit:pending,lastCommand:field}}).valid,false,'recent section field prevents silent whole-beam selection');
});
test('continuations keep one speaker and capture deadline even with grouping and hesitation',async()=>{
 const now=Date.now(),opts={state:state(),active:true,activeTab:'simulation',source:'microphone',speaker:'Alice',nowMs:now};
 const pending=await C.process('eu quero reduzir o tamanho da viga de 5 m para',opts);pending.source_entry_ids=['S1','S2'];
 const recentTranscript=[{id:'S2',text:'de 5 m para',speaker:'Alice'}],context={pendingAudit:pending,recentTranscript};
 assert.equal(C.parse('4 metros',{...opts,nowMs:now+5000,context}).operations[0].patch.L,4);
 for(const extra of [{speaker:'Bob'},{nowMs:now+16000},{source:'import'},{context:{...context,recentTranscript:[{id:'S3',text:'a hipótese precisa ser discutida'}]}}])assert.equal(C.parse('4 metros',{...opts,nowMs:now+5000,context,...extra}).valid,false,JSON.stringify(extra));
 const hesitation=await C.process('me',{...opts,nowMs:now+5000,context});assert.equal(hesitation.status,'awaiting_continuation');assert.equal(hesitation.continuation_started_at,pending.created_at);assert.equal(C.parse('4 metros',{...opts,nowMs:now+16000,context:{pendingAudit:hesitation}}).valid,false,'hesitations do not renew an expired request');
 assert.equal(C.parse('4 metros',{...opts,nowMs:now+8000,context:{pendingAudit:hesitation}}).operations[0].patch.L,4);
});
test('multiple and incompatible targets cannot be narrowed by deleting stated source values',()=>{
 const opts={state:state(),active:true,source:'microphone'};
 for(const text of ['eu quero reduzir a força P1 e o comprimento de 10 kN para 5 kN','eu quero reduzir o comprimento da viga de 5 metros para 4 kN','eu quero reduzir a força P1 de 10 kN para 5 metros','eu quero reduzir a altura e a largura de 240 mm para 200 mm']){
  const parsed=C.parse(text,opts);assert.equal(parsed.valid,false,text);assert.deepEqual(parsed.operations,[],text);
 }
});
