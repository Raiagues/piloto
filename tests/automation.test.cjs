const {test}=require('node:test');
const assert=require('node:assert/strict');
const E=require('../experiments.js'),A=require('../automation.js');
const example=require('../manual-test-example.json');
const base=()=>({name:example.name,language:example.language,state:E.clone(example.state),config:{model:example.model,questions:E.clone(example.questions)},expected:E.clone(example.expected)});
const opts=overrides=>({field:'current_utterance',format:'text',variants:A.sample,expectations:'none',repeats:4,...overrides});
test('the exact active-thread State executes as one base without options, including restored empty variation axes',()=>{
  const fixture=require('./fixtures/active-thread-base.json');
  const source={name:'Base',language:'en',state:E.clone(fixture.state),config:{model:fixture.model,questions:E.clone(fixture.questions)},expected:{belongs_to_active_thread:{type:'choice',value:'belongs',minProbability:.8}}};
  const before=E.clone(source);
  for(const field of ['fixed','current_utterance','recent_context','state','mixed']) for(const includeBase of [false,true]) for(const repeats of [1,4,10]) {
    const plan=A.plan(source,{field,options:[],repeats,includeBase});
    assert.equal(plan.field,'fixed');assert.equal(plan.count,1);assert.equal(plan.calls,repeats);
    assert.deepEqual(E.request(plan.items[0].input),fixture);assert.deepEqual(plan.items[0].input.expected,source.expected);
  }
  assert.deepEqual(source,before);
  const variation={...E.clone(fixture.state),current_event:{...fixture.state.current_event,text:'A revised test proposal.'}};
  const plan=A.plan(source,{field:'mixed',options:[{id:'copy',field:'state',state:variation,text:JSON.stringify(variation),expected:{}}],includeBase:true,repeats:1});
  assert.equal(plan.count,2);assert.deepEqual(plan.items.map(item=>item.input.state),[source.state,variation]);
});
test('full State copies can vary context, utterance and other fields without changing the source',()=>{
  const source=base(),before=E.clone(source),state={recent_context:['New context'],current_utterance:'New utterance',extra:{size:4}};
  const options={field:'mixed',includeBase:true,repeats:1,options:[{id:'copy',field:'current_utterance',focusField:'current_utterance',text:'New utterance',state,expected:{}}]};
  const p=A.plan(source,options);assert.equal(p.count,2);assert.equal(p.calls,2);
  assert.deepEqual(p.items[0].input.state,source.state);assert.deepEqual(p.items[1].input.state,state);assert.deepEqual(source,before);
  assert.notEqual(p.items[0].identity.utterance,p.items[1].identity.utterance);assert.notEqual(p.items[0].identity.context,p.items[1].identity.context);
  assert.ok(p.items[1].identity.state);assert.equal(p.items[0].identity.version,p.items[1].identity.version);
  assert.deepEqual(Object.keys(E.request(p.items[1].input)),['model','state','questions']);
  const q=E.clone(source);q.config.questions.should_track.instructions+=' Revised.';
  const next=A.plan(q,options,2,p.registry);assert.notEqual(next.items[1].identity.version,p.items[1].identity.version);assert.equal(next.items[1].identity.utterance,p.items[1].identity.utterance);
  options.options[0].state='Plain text is also editable';assert.equal(A.plan(source,options).items[1].input.state,options.options[0].state);
  options.options[0].editor='{';assert.throws(()=>A.plan(source,options),/Conclua/);
});
test('empty Questions are a draft only and base plus copies obey the total scenario limit',()=>{
  const config={model:'jev-latest',questions:{}};assert.doesNotThrow(()=>E.validateDraftConfig(config));assert.throws(()=>E.validateConfig(config));
  assert.throws(()=>E.validateDraftConfig({model:'other',questions:{}}));
  assert.throws(()=>E.validateInput({...base(),config}));
  const options={field:'mixed',includeBase:true,repeats:1,options:Array.from({length:50},(_,i)=>({id:String(i),field:'state',text:'x',state:'x',expected:{}}))};
  assert.throws(()=>A.plan(base(),options),/50 cenários/);
});
test('mixed variations change only their own field, preserve expectations and allow display names',()=>{
  const source=base(),before=E.clone(source),options={field:'mixed',repeats:1,options:[
    {id:'u',field:'current_utterance',text:'A new utterance',expected:{should_track:{type:'noul',value:true,minProbability:.6}},name:'Custom title'},
    {id:'c',field:'recent_context',text:'A different context\nSecond speaker',expected:{}}
  ]};
  const p=A.plan(source,options),[u,c]=p.items;
  assert.equal(p.count,2);assert.equal(p.calls,2);assert.equal(u.input.name,'Custom title');assert.match(u.code,/^JEV-001-U001-C001$/);
  assert.deepEqual(u.input.state,{...source.state,current_utterance:'A new utterance'});
  assert.deepEqual(c.input.state,{...source.state,recent_context:['A different context','Second speaker']});
  assert.deepEqual(u.input.expected,options.options[0].expected);assert.deepEqual(c.input.expected,{});
  for(const item of p.items){assert.deepEqual(item.input.config,source.config);assert.deepEqual(Object.keys(E.request(item.input)),['model','state','questions']);}
  const renamed=E.clone(options);renamed.options[0].name='Renamed';
  const again=A.plan(source,renamed,2,p.registry);assert.equal(again.items[0].code,u.code);assert.equal(again.items[1].code,c.code);
  assert.deepEqual(source,before);
  const batch={id:'mixed-batch',createdAt:'2026-10-04T10:00:00Z',origin:'automation',input:u.input,requested:1,status:'cancelled',runs:[],automation:{campaignId:'mixed-round',round:1,field:'mixed',optionId:'u',variant:1,questionVariant:1,label:u.code,questionLabel:'Questions',totalScenarios:2,totalCalls:2}};
  assert.equal(E.validateArchive({schemaVersion:1,cases:[],batches:[batch]}).batches[0].automation.field,'mixed');
});
test('unfinished variant JSON cannot silently execute its previous valid value',()=>{
  const options={field:'mixed',repeats:1,options:[{id:'u',field:'current_utterance',text:'Valid prior text',editor:'{',expected:{}}]};
  assert.throws(()=>A.plan(base(),options),/JSON da variação/);
  delete options.options[0].editor;options.options[0].field='unknown';assert.throws(()=>A.plan(base(),options),/Campo/);
  options.options[0].field='current_utterance';options.options[0].name='';assert.throws(()=>A.plan(base(),options),/Nome/);
  assert.throws(()=>A.plan(base(),opts({field:'mixed'})),/campo explícito/);
});
test('common setup has all eleven new Questions and compatible expected values',()=>{
  const keys=['should_track','event_type','test_is_proposed','decision_is_final','pending_decision','creates_action_item','next_step_commitment','change_commitment','project_impact','primary_affected_area','requires_followup'];
  assert.deepEqual(Object.keys(example.questions),keys);assert.deepEqual(Object.keys(example.expected),keys);
  assert.deepEqual(E.parseRequest(JSON.stringify(example)),example);E.validateInput(base());
  assert.equal(example.expected.pending_decision.value,true);assert.equal(example.expected.creates_action_item.value,true);
  assert.equal(example.expected.next_step_commitment.value,2);assert.equal(example.expected.change_commitment.value,1);
  const q=Object.fromEntries(Array.from({length:32},(_,i)=>['q'+i,{type:'noul',instructions:'Question?'}]));
  E.validateConfig({model:'jev-latest',questions:q});q.extra={type:'noul',instructions:'?'};assert.throws(()=>E.validateConfig({model:'jev-latest',questions:q}));
});
test('utterance variants preserve the entire base context/questions and never inherit prototype labels',()=>{
  const b=base(),before=E.clone(b),p=A.plan(b,opts(),2);
  assert.equal(p.count,6);assert.equal(p.calls,24);assert.equal(new Set(p.items.map(i=>i.input.name)).size,6);
  for(const [index,item]of p.items.entries()) {
    assert.deepEqual(item.input.state.recent_context,b.state.recent_context);assert.deepEqual(item.input.config,b.config);
    assert.deepEqual(item.input.expected,{});assert.equal(item.input.state.current_utterance,A.sample.split('\n\n')[index]);
    assert.match(item.input.name,/^JEV-001-U\d{3}-C001$/);assert.ok(item.input.name.length<=100);
    assert.deepEqual(Object.keys(E.request(item.input)),['model','state','questions']);
  }
  assert.deepEqual(b,before);p.items[0].input.state.recent_context.push('Changed');assert.deepEqual(p.items[1].input.state.recent_context,b.state.recent_context);
});
test('context, entire State and fixed State preserve the applied Questions',()=>{
  const b=base(),p=A.plan(b,opts({field:'recent_context',variants:'Context A\nSecond line\n\nContext B'}));
  assert.deepEqual(p.items[0].input.state.recent_context,['Context A','Second line']);assert.equal(p.items[0].input.state.current_utterance,b.state.current_utterance);
  const s=A.plan(b,opts({field:'state',format:'json',variants:JSON.stringify([{value:{a:1}},{value:'Literal State'}])}));
  assert.deepEqual(s.items[0].input.state,{a:1});assert.equal(s.items[1].input.state,'Literal State');
  const q=A.plan(b,opts({field:'fixed'}));
  assert.equal(q.count,1);assert.equal(q.calls,4);assert.deepEqual(q.items[0].input.state,b.state);
  for(const item of [...p.items,...s.items,...q.items])assert.deepEqual(item.input.config,b.config);
});
test('editing the principal Questions applies to every variant without changing previous plans',()=>{
  const b=base(),previous=A.plan(b,opts({variants:'A\n\nB'}));
  b.config.questions={only:{type:'noul',instructions:'Is there a concrete proposal?'}};b.expected={};
  const p=A.plan(b,opts({variants:'A\n\nB'}),2);
  assert.equal(p.count,2);assert.equal(p.calls,8);assert.deepEqual(p.items.map(i=>i.code),['JEV-001-U001-C001','JEV-001-U002-C001']);
  for(const item of p.items)assert.deepEqual(item.input.config,b.config);
  for(const item of previous.items)assert.deepEqual(item.input.config.questions,example.questions);
  b.config.questions.only.instructions='Edited again';p.items[0].input.config.questions.only.instructions='Changed item';
  assert.equal(p.items[1].input.config.questions.only.instructions,'Is there a concrete proposal?');
});
test('all six examples include eleven editable expectations and the requested final-decision completion',()=>{
  const options=A.exampleOptions(example.questions),p=A.plan(base(),{field:'current_utterance',options,repeats:1});
  const expectedValues=[
    [true,'change_proposal',false,false,false,false,1,1,2,'material',true],
    [true,'test_proposal',true,false,false,true,2,1,2,'material',true],
    [true,'test_proposal',true,false,false,true,2,1,2,'material',true],
    [true,'test_result',false,false,false,false,0,1,2,'performance',true],
    [true,'change_proposal',false,false,false,true,2,2,2,'material',true],
    [true,'decision',false,true,false,true,3,3,3,'material',true]
  ];
  const floors=[[.6,.8,.8,.8,.8,.8,.8,.8,.6,.8,.6],[.8,.6,.6,.8,.8,.8,.8,.8,.8,.8,.8],[.8,.8,.8,.8,.8,.8,.8,.8,.8,.6,.8],[.8,.8,.8,.8,.8,.8,.8,.6,.8,.8,.6],[.8,.6,.8,.6,.8,.6,.8,.8,.8,.8,.8],[.8,.8,.8,.8,.8,.6,.8,.8,.6,.8,.8]];
  for(const [i,item]of p.items.entries()){
    assert.deepEqual(Object.values(item.input.expected).map(e=>e.value),expectedValues[i]);
    assert.deepEqual(Object.values(item.input.expected).map(e=>e.minProbability),floors[i]);
    assert.deepEqual(Object.keys(E.request(item.input)),['model','state','questions']);
  }
  assert.equal(Object.keys(p.items[5].input.expected).length,11);
  const repeated=A.plan(base(),{field:'current_utterance',options,repeats:4},2,p.registry);
  assert.deepEqual(repeated.items.map(i=>i.input.name),p.items.map(i=>i.input.name));
  options[0].expected.should_track.value=false;assert.equal(p.items[0].input.expected.should_track.value,true);
});
test('legacy final-decision draft gains missing labels once, preserving user corrections and identifiers',()=>{
  const full=A.exampleOptions(example.questions),legacy=E.clone(full);
  delete legacy[5].presetRevision;
  for(const id of Object.keys(legacy[5].expected).slice(6))delete legacy[5].expected[id];
  const completed=A.completeDecisionDraft(legacy,base(),base());
  assert.deepEqual(completed,full);assert.equal(Object.keys(legacy[5].expected).length,6,'original data is not mutated');
  legacy[5].expected.should_track.minProbability=.92;
  legacy[5].expected.project_impact={type:'score',value:3,minProbability:.7};
  const corrected=A.completeDecisionDraft(legacy,base(),base());
  assert.equal(corrected[5].expected.should_track.minProbability,.92);
  assert.deepEqual(corrected[5].expected.project_impact,legacy[5].expected.project_impact);
  delete corrected[5].expected.requires_followup;
  assert.deepEqual(A.completeDecisionDraft(corrected,base(),base()),corrected,'intentional later removal is preserved');
  const changed=base();changed.state.recent_context=['Different context'];assert.deepEqual(A.completeDecisionDraft(legacy,changed,base()),legacy);
  const questions=base();questions.config.questions.should_track.instructions+=' Different.';assert.deepEqual(A.completeDecisionDraft(legacy,questions,base()),legacy);
  const edited=E.clone(legacy);edited[5].text='A different decision.';assert.deepEqual(A.completeDecisionDraft(edited,base(),base()),edited);
  const unscored=E.clone(legacy);unscored[5].expected={};assert.deepEqual(A.completeDecisionDraft(unscored,base(),base())[5].expected,{});
});
test('stable names version Questions only, distinguish contexts and extra state, and survive serialization',()=>{
  let catalog=A.registry();const b=base(),first=A.identify(b,catalog);
  assert.equal(first.name,'JEV-001-U001-C001');
  b.config.questions=Object.fromEntries(Object.entries(b.config.questions).reverse());
  b.expected={};b.name='Not part of identity';assert.equal(A.identify(b,catalog).name,first.name);
  b.state.recent_context=['New context'];assert.equal(A.identify(b,catalog).name,'JEV-001-U001-C002');
  b.state.current_utterance='New utterance';assert.equal(A.identify(b,catalog).name,'JEV-001-U002-C002');
  b.config.questions.should_track.instructions+=' Changed.';assert.equal(A.identify(b,catalog).name,'JEV-002-U002-C002');
  b.state.other='Preserved';assert.equal(A.identify(b,catalog).name,'JEV-002-U002-C002-S001');
  catalog=A.registry(JSON.parse(JSON.stringify(catalog)));assert.equal(A.identify(b,catalog).name,'JEV-002-U002-C002-S001');
  b.config.questions=E.clone(example.questions);assert.equal(A.identify(b,catalog).version,1,'returning to same Questions reuses version');
  assert.throws(()=>A.registry({schemaVersion:2}));
});
test('individual options support adding/removing and per-context expectations',()=>{
  const options=[{id:'a',text:'Context A\nSecond line',expected:{should_track:{type:'noul',value:false,minProbability:.8}}},{id:'b',text:'Context B',expected:{}}];
  const p=A.plan(base(),{field:'recent_context',options,repeats:1});
  assert.deepEqual(p.items[0].input.state.recent_context,['Context A','Second line']);
  assert.equal(p.items[0].input.expected.should_track.value,false);
  assert.equal(p.items[0].identity.utterance,p.items[1].identity.utterance);
  assert.notEqual(p.items[0].identity.context,p.items[1].identity.context);
  options.shift();const later=A.plan(base(),{field:'recent_context',options,repeats:1},2,p.registry);
  assert.equal(later.items[0].code,p.items[1].code);
  for(const invalid of [[{id:'x',text:'',expected:{}}],[options[0],options[0]],[{id:'x',text:'OK',expected:{bad:true}}]])assert.throws(()=>A.plan(base(),{field:'current_utterance',options:invalid,repeats:1}));
});
test('obsolete question-variation drafts never multiply calls or override Questions or expected values',()=>{
  const b=base();
  for(const questionVariants of ['invalid old JSON',JSON.stringify([{questions:{old:{type:'noul',instructions:'Old?'}},expected:{should_track:false}},{questions:b.config.questions}])]) {
    const options=opts({variants:'A\n\nB',expectations:'fixed',varyQuestions:true,questionVariants});
    const p=A.plan(b,options);
    assert.equal(p.count,2);assert.equal(p.calls,8);
    for(const item of p.items){assert.deepEqual(item.input.config,b.config);assert.deepEqual(item.input.expected,b.expected);assert.equal(item.questionVariant,1);}
    const v=A.plan(b,{...options,format:'json',variants:JSON.stringify([{value:'A',expected:{should_track:true}}]),expectations:'variant'});
    assert.deepEqual(v.items[0].input.expected,{should_track:{type:'noul',value:true}});
  }
});
test('expected values follow only the explicit base or State-variant policy',()=>{
  const b=base();
  const fixed=A.plan(b,opts({expectations:'fixed'}));assert.deepEqual(fixed.items[0].input.expected,b.expected);
  const variants=JSON.stringify([{name:'Proposal',value:'Try this',expected:{test_is_proposed:true}},{value:'Observation',expected:{test_is_proposed:{type:'noul',value:false,minProbability:.8}}}]);
  const v=A.plan(b,opts({format:'json',variants,expectations:'variant'}));
  assert.deepEqual(v.items[0].input.expected,{test_is_proposed:{type:'noul',value:true}});assert.equal(v.items[1].input.expected.test_is_proposed.minProbability,.8);
  assert.throws(()=>A.plan(b,opts({format:'json',variants:JSON.stringify([{value:'X',expected:{unknown:true}}]),expectations:'variant'})));
});
test('plans reject malformed, oversized and incompatible scenarios before any request',()=>{
  for(const overrides of [{variants:''},{format:'json',variants:'{'},{format:'json',variants:'[]'},{field:'__proto__'},{repeats:100},{expectations:'guess'},{variants:'X'.repeat(17000)},{variants:Array(51).fill('A').join('\n\n')},{variants:Array(21).fill('A').join('\n\n'),repeats:10},{format:'json',variants:'[{"typo":"X"}]'}])assert.throws(()=>A.plan(base(),opts(overrides)));
  assert.throws(()=>A.plan({...base(),state:'Text'},opts()));
  assert.throws(()=>A.plan(base(),opts(),0));
});
