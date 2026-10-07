const test = require('node:test');
const assert = require('node:assert/strict');
const Canvas = require('../meeting-canvas.js');

const event = (id,type,text,thread='T001') => ({event_id:id,thread_id:thread,chunk_id:'C'+id,type,text,store_confidence:.97,type_confidence:.98});
const edge = (source,target,type,extra={}) => ({
  relation_id:source+'-'+target+'-'+type,source_event_id:source,target_event_id:target,relation_type:type,
  relation_probability:.98,match_probability:.99,review_state:'confirmed',
  configuration_match:null,configuration_applicable:false,...extra
});
const run = () => ({meeting_threads:[{thread_id:'T001'},{thread_id:'T002'}],meeting_events:[
  event('E1','observation','O suporte deforma demais.'),
  event('E2','hypothesis','A espessura pode explicar a deformação.'),
  event('E3','test_proposal','Medir a versão de 4 mm sob 20 N.'),
  event('E4','test_result','O teste de 4 mm sob 20 N excedeu o limite.'),
  event('E5','decision','Manter o protótipo para avaliação.'),
  event('E6','requirement','A caixa deve pesar menos de 2 kg.','T002')
],meeting_relations:[edge('E2','E1','related_to'),edge('E3','E2','tests'),edge('E4','E3','result_of',{configuration_match:'exact',configuration_applicable:true})]});
const allNodes = doc => doc.topics.flatMap(topic => topic.nodes.flatMap(function visit(node){return [node,...node.children.flatMap(visit)];}));
const find = (doc,id) => allNodes(doc).find(node=>node.id===id);

test('three columns preserve each record once while only exact results remain inside tests',()=>{
  const source=run(),before=JSON.stringify(source),doc=Canvas.build(source),topic=doc.topics[0];
  assert.deepEqual(topic.columns.problems.map(n=>n.id),['E1']);
  assert.deepEqual(topic.columns.hypotheses.map(n=>n.id),['E2']);
  assert.deepEqual(topic.columns.tests.map(n=>n.id),['E3']);
  assert.deepEqual(topic.columns.details.map(n=>n.id),['E5']);
  assert.equal(find(doc,'E2').parent_id,null);
  assert.equal(find(doc,'E3').parent_id,null);
  assert.equal(find(doc,'E4').parent_id,'E3');
  assert.deepEqual(find(doc,'E3').children.map(n=>n.id),['E4']);
  assert.equal(allNodes(doc).length,source.meeting_events.length);
  assert.equal(new Set(allNodes(doc).map(n=>n.id)).size,source.meeting_events.length);
  assert.equal(JSON.stringify(source),before);
  find(doc,'E1').event.text='Modified';
  assert.equal(source.meeting_events[0].text,'O suporte deforma demais.');
});

test('arrows use only confirmed direct semantic links and do not infer transitive edges',()=>{
  const source=run();
  source.meeting_relations.push(edge('E4','E2','contradicts'),edge('E5','E4','based_on'));
  const doc=Canvas.build(source);
  assert.deepEqual(doc.edges.map(e=>[e.source_id,e.target_id,e.type]),[
    ['E3','E2','tests'],['E4','E3','result_of'],['E4','E2','contradicts'],['E5','E4','based_on']
  ]);
  assert.equal(doc.edges[0].label,'avalia');
  assert.equal(doc.edges[0].source_text,source.meeting_events[2].text);
  assert.ok(!doc.edges.some(e=>e.source_id==='E3'&&e.target_id==='E1'));
});

test('related_to, repeats, clarifies, none and unknown classifications never draw arrows',()=>{
  for(const type of ['related_to','repeats','clarifies','none','explains','unknown']){
    const source=run();source.meeting_relations=[edge('E2','E1',type)];
    assert.equal(Canvas.build(source).edges.length,0,type);
  }
});

test('weak relations and cross-topic links never draw arrows',()=>{
  for(const patch of [
    {relation_probability:.8},{relation_probability:.799}, {match_probability:.8},{match_probability:.799},
    {relation_probability:undefined}, {match_probability:NaN},
    {target_event_id:'E6'}, {target_event_id:'missing'}, {target_event_id:'E3'}
  ]){
    const source=run();source.meeting_relations=[edge('E3','E2','tests',patch)];
    assert.equal(Canvas.build(source).edges.length,0,JSON.stringify(patch));
  }
  const source=run();source.meeting_events[1].thread_id=null;
  source.meeting_relations=[edge('E3','E2','tests')];
  assert.equal(Canvas.build(source).edges.length,0);
});

test('pending or failed direct relations put their diagnosis on the edge, never on either card',()=>{
  for(const patch of [{review_state:'pending',match_probability:null},{review_state:'uncertain'}, {error:'Request failed'}, {configuration_match:'ambiguous',configuration_applicable:true}]){
    const source=run();source.meeting_relations=[edge('E3','E2','tests',patch)];
    const doc=Canvas.build(source);
    assert.equal(doc.edges.length,1,JSON.stringify(patch));
    assert.equal(doc.edges[0].review_state,'pending');
    assert.equal(doc.edges[0].issues.length,1);
    assert.equal(find(doc,'E3').review.length,0);
    assert.equal(find(doc,'E2').review.length,0);
    assert.equal(find(doc,'E3').canvas_status,'open');
  }
});

test('supported, opposed, dependent and replacement links retain their direct direction',()=>{
  for(const type of ['supports','contradicts','depends_on','affects','based_on','supersedes']){
    const source=run();source.meeting_relations=[edge('E5','E1',type)];
    const doc=Canvas.build(source);
    assert.equal(doc.edges.length,1,type);
    assert.deepEqual([doc.edges[0].source_id,doc.edges[0].target_id],['E5','E1']);
  }
});

test('multiple hypotheses can be evaluated directly by one test without hierarchy warnings',()=>{
  const source=run();source.meeting_events.push(event('E7','hypothesis','A rigidez pode explicar a deformação.'));
  source.meeting_relations.push(edge('E3','E7','tests'));
  const doc=Canvas.build(source),proposal=find(doc,'E3');
  assert.equal(proposal.parent_id,null);
  assert.equal(proposal.links.filter(e=>e.type==='tests').length,2);
  assert.ok(!doc.review.some(r=>r.id==='parents:E3'));
  assert.ok(!proposal.review.some(r=>r.id==='parents:E3'));
});

test('an unsuccessful physical result is recorded and completes execution, not an application error',()=>{
  const doc=Canvas.build(run());
  assert.equal(find(doc,'E1').canvas_status,'open');
  assert.equal(find(doc,'E2').canvas_status,'open');
  assert.equal(find(doc,'E3').canvas_status,'completed');
  assert.equal(find(doc,'E4').canvas_status,'registered');
  assert.equal(find(doc,'E4').status_label,'Registrado');
});

test('ambiguous attribution to multiple tests requests review without completing either plan',()=>{
  const source=run();source.meeting_events.push(event('E7','test_proposal','Medir novamente a versão de 4 mm sob 20 N.'));
  source.meeting_relations.push(edge('E4','E7','result_of',{configuration_match:'exact',configuration_applicable:true}));
  const doc=Canvas.build(source);
  assert.equal(find(doc,'E4').parent_id,null);
  for(const id of ['E3','E7']){
    assert.equal(find(doc,id).completed,false);
    assert.equal(find(doc,id).canvas_status,'open');
    assert.equal(find(doc,id).review.length,0);
  }
  assert.equal(doc.edges.filter(link=>link.type==='result_of'&&link.review_state==='pending').length,2);
  assert.equal(new Set(allNodes(doc).map(node=>node.id)).size,source.meeting_events.length);
});

test('partial or mismatched test outcomes remain separate and require review, never completion',()=>{
  for(const configuration_match of ['partial','mismatch','ambiguous']){
    const source=run();source.meeting_relations[2].configuration_match=configuration_match;
    const doc=Canvas.build(source);
    assert.equal(find(doc,'E4').parent_id,null);
    assert.equal(find(doc,'E3').completed,false);
    assert.equal(find(doc,'E3').canvas_status,'open');
    assert.equal(find(doc,'E4').canvas_status,'registered');
    assert.equal(find(doc,'E3').review.length,0);
    assert.equal(find(doc,'E4').review.length,0);
    assert.ok(doc.edges.some(e=>e.type==='result_of'&&e.review_state==='pending'));
  }
});

test('classification failures are red, relation worker failures do not affect cards and replacements are gray',()=>{
  const source=run();
  source.thread_worker={jobs:[{event_id:'E5',status:'error',error:'Falha ao classificar o assunto.'}]};
  source.typed_relation_worker={jobs:[{event_id:'E2',status:'error'}]};
  source.meeting_events.push(event('E7','observation','A medição relatada estava incorreta.'));
  source.meeting_relations.push(edge('E7','E4','supersedes'));
  const doc=Canvas.build(source);
  assert.equal(find(doc,'E5').canvas_status,'error');
  assert.equal(find(doc,'E2').canvas_status,'open');
  assert.equal(find(doc,'E4').canvas_status,'superseded');
  assert.equal(find(doc,'E4').status_label,'Substituído');
  assert.equal(find(doc,'E3').completed,false);
  assert.ok(!doc.edges.some(e=>e.source_id==='E4'));
});

test('duplicates do not repeat arrows; manual titles and unassigned records survive the projection',()=>{
  const source=run();source.topic_titles={T001:'Resistência do suporte'};
  source.meeting_relations.push({...source.meeting_relations[1],relation_id:'duplicate'});
  source.meeting_events.push(event('E7','other','Um registro aguardando organização.',null));
  const doc=Canvas.build(source);
  assert.equal(doc.topics[0].title,'Resistência do suporte');
  assert.equal(doc.edges.filter(e=>e.type==='tests').length,1);
  assert.equal(doc.topics.at(-1).columns.details[0].id,'E7');
  assert.equal(find(doc,'E7').canvas_status,'review');
  assert.deepEqual(Canvas.build({meeting_events:[]}).topics,[]);
});


test('confidence below 60% stays excluded and raw extraction is preserved',()=>{
  for(const confidence of [.599,.4,undefined]){
    const source=run();source.meeting_events[1].type_confidence=confidence;
    const before=JSON.stringify(source),doc=Canvas.build(source);
    assert.equal(find(doc,'E2'),undefined);
    assert.ok(doc.excluded.some(item=>item.event_id==='E2'));
    assert.ok(!doc.edges.some(link=>link.source_id==='E2'||link.target_id==='E2'));
    assert.equal(JSON.stringify(source),before);
  }
});

test('saved meetings retain classifications at 60% without lowering relation confirmation',()=>{
  for(const confidence of [.6,.79,.8]){
    const source=run();source.threshold=.8;source.meeting_events[1].type_confidence=confidence;
    const before=JSON.stringify(source),doc=Canvas.build(source);
    assert.equal(find(doc,'E2').type,'hypothesis');assert.equal(find(doc,'E2').canvas_status,'open');assert.equal(doc.excluded.length,0);
    assert.equal(JSON.stringify(source),before);
  }
});

test('retained points with weak topic assignment appear in the pending group without a false topic link',()=>{
  const source=run();source.meeting_events[1].type_confidence=.6;
  source.thread_worker={jobs:[{event_id:'E2',status:'done',result:{reason:'low_confidence_active',thread_id:'T001'}}]};
  const before=JSON.stringify(source),doc=Canvas.build(source),node=find(doc,'E2');
  assert.ok(node);assert.equal(node.event.thread_id,null);assert.equal(node.canvas_status,'review');assert.equal(doc.excluded.length,0);
  assert.equal(doc.edges.some(e=>e.source_id==='E2'||e.target_id==='E2'),false);assert.equal(JSON.stringify(source),before);
});

test('untitled topics never copy the first utterance into the title',()=>{
  const source=run();
  assert.equal(Canvas.build(source).topics[0].title,'');
  source.meeting_threads[0].title='Nome explícito';
  assert.equal(Canvas.build(source).topics[0].title,'Nome explícito');
  source.topic_titles={T001:'Título manual'};
  assert.equal(Canvas.build(source).topics[0].title,'Título manual');
});

test('shared state is authoritative for closure, blockage and conflict without moving link warnings onto cards',()=>{
  const previous=global.NorteMeetingState;
  global.NorteMeetingState={build:()=>({byId:{
    E1:{status:'completed',resolved:true,completed:false,reasons:['Decisão explicitamente vinculada.']},
    E2:{status:'conflict',resolved:false,completed:false,reasons:['Evidência contraditória.']},
    E3:{status:'review',completed:false,blocked:true,blocked_by:['E2'],reasons:['Dependência ainda sem conclusão.']},
    E4:{status:'registered',completed:false,reasons:[]},
    E5:{status:'registered',completed:false,reasons:[]},
    E6:{status:'open',completed:false,reasons:[]}
  }})};
  try{
    const doc=Canvas.build(run());
    assert.equal(find(doc,'E1').canvas_status,'completed');assert.equal(find(doc,'E1').resolved,true);assert.equal(find(doc,'E1').completed,false);
    assert.equal(find(doc,'E2').canvas_status,'conflict');assert.equal(find(doc,'E2').status_label,'Conflito');
    assert.equal(find(doc,'E3').canvas_status,'review');assert.equal(find(doc,'E3').completed,false);assert.equal(find(doc,'E3').blocked,true);assert.deepEqual(find(doc,'E3').blocked_by,['E2']);
    assert.equal(find(doc,'E4').canvas_status,'registered');
    for(const id of ['E1','E2','E3','E4'])assert.equal(find(doc,id).review.length,0,'semantic link state must not manufacture a classification warning');
  }finally{if(previous===undefined)delete global.NorteMeetingState;else global.NorteMeetingState=previous;}
});

test('an unrelated decision and a standalone result do not close an open problem or hypothesis',()=>{
  const source=run();source.meeting_relations=[];const doc=Canvas.build(source);
  assert.equal(find(doc,'E1').canvas_status,'open');assert.equal(find(doc,'E2').canvas_status,'open');assert.equal(find(doc,'E3').canvas_status,'open');assert.equal(find(doc,'E4').canvas_status,'registered');assert.equal(find(doc,'E5').canvas_status,'registered');
});

test('dependency routes are straight when aligned and orthogonal otherwise, with source-to-target direction preserved',()=>{
  const a={left:0,right:100,y:30},b={left:200,right:300,y:30};
  assert.equal(Canvas.routeEdge(a,b).path,'M 100 30 H 200');assert.equal(Canvas.routeEdge(b,a).path,'M 200 30 H 100');
  const offset=Canvas.routeEdge(a,{...b,y:90});assert.equal(offset.path,'M 100 30 H 150 V 90 H 200');assert.equal(offset.labelX,150);assert.equal(offset.labelY,60);
  const same=Canvas.routeEdge(a,{...a,y:130},{sameColumn:true});assert.equal(same.path,'M 0 30 H -18 V 130 H 0');assert.equal(same.anchor,'end');
  const nested=Canvas.routeEdge(a,b,{nestedResult:true,resultTop:80});assert.equal(nested.path,'M 10 77 V 55');assert.equal(nested.labelX,18);assert.equal(nested.labelY,69);assert.equal(nested.anchor,'start');assert.ok(![offset.path,same.path,nested.path].some(path=>/[CQ]/.test(path)));
});

test('an explicit replacement may change configuration without turning the replacement edge into an error',()=>{
  const source=run();source.meeting_events.push(event('E7','test_proposal','Substituir o ensaio anterior pela versão de 5 mm sob 30 N.'));
  source.meeting_relations.push(edge('E7','E3','supersedes',{configuration_match:'mismatch',configuration_applicable:true}));
  const doc=Canvas.build(source),replacement=doc.edges.find(link=>link.type==='supersedes');
  assert.equal(replacement.review_state,'confirmed');assert.equal(replacement.issues.length,0);assert.equal(find(doc,'E3').canvas_status,'superseded');assert.equal(find(doc,'E7').completed,false);assert.ok(!doc.edges.some(link=>link.source_id==='E3'&&link.type==='tests'));
});

test('the information control receives semantic conflict explanations and their evidence without creating a classification warning',()=>{
  const source=run();source.meeting_events.push(event('E7','test_result','A caixa medida pesa 3 kg.','T002'));
  const contradiction=edge('E7','E6','contradicts');source.meeting_relations.push(contradiction);
  const node=find(Canvas.build(source),'E6');assert.equal(node.canvas_status,'conflict');assert.equal(node.review.length,0);assert.ok(node.inspection.issues.some(issue=>issue.message.includes('contradiz')));assert.ok(node.inspection.eventIds.includes('E6'));assert.ok(node.inspection.relationIds.includes(contradiction.relation_id));
  const completed=find(Canvas.build(run()),'E3');assert.equal(completed.canvas_status,'completed');assert.ok(completed.inspection.issues.some(issue=>issue.message.includes('Execução relatada')));assert.ok(completed.inspection.relationIds.some(id=>id.endsWith('result_of')));
});
