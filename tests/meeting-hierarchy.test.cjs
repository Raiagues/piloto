const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const H = require('../meeting-hierarchy.js');

const event = (id,type,text,thread='T001') => ({event_id:id,thread_id:thread,chunk_id:'C'+id,type,text});
const edge = (source,target,type,config='not_applicable',extra={}) => ({
  relation_id:'R'+source+'-'+target,source_event_id:source,target_event_id:target,relation_type:type,
  configuration_match:config === 'not_applicable' ? null : config,configuration_applicable:config !== 'not_applicable',
  relation_probability:.98,match_probability:.99,review_state:'confirmed',...extra
});
const run = () => ({meeting_threads:[{thread_id:'T001'},{thread_id:'T002'}],meeting_events:[
  event('E1','observation','O suporte está deformando.'),
  event('E2','hypothesis','A espessura pode explicar a deformação.'),
  event('E3','test_proposal','Medir o suporte de 4 mm a 20 N.'),
  event('E4','test_result','O suporte de 4 mm a 20 N ainda excedeu o limite.'),
  event('E5','decision','Manter o protótipo para avaliação.'),
  event('E6','requirement','A caixa deve pesar menos de 2 kg.','T002')
],meeting_relations:[edge('E2','E1','related_to'),edge('E3','E2','tests'),edge('E4','E3','result_of','exact')]});
const allNodes = doc => doc.topics.flatMap(topic => topic.nodes.flatMap(function visit(node) { return [node,...node.children.flatMap(visit)]; }));
const find = (doc,id) => allNodes(doc).find(node => node.id === id);

test('confirmed typed relations make observation > hypothesis > test > result, without losing events', () => {
  const source=run(), before=JSON.stringify(source), doc=H.build(source);
  assert.equal(doc.topics[0].title,'Assunto sem título');
  assert.deepEqual(doc.topics[0].nodes.map(node=>node.id),['E1','E5']);
  assert.equal(find(doc,'E2').parent_id,'E1');
  assert.equal(find(doc,'E3').parent_id,'E2');
  assert.equal(find(doc,'E4').parent_id,'E3');
  assert.equal(find(doc,'E3').completed,true);
  assert.equal(find(doc,'E3').status,'completed');
  assert.equal(find(doc,'E4').text,source.meeting_events[3].text);
  assert.equal(allNodes(doc).length,6);
  assert.equal(new Set(allNodes(doc).map(node=>node.id)).size,6);
  assert.equal(JSON.stringify(source),before);
  find(doc,'E1').event.text='View mutation';
  assert.equal(source.meeting_events[0].text,'O suporte está deformando.');
});

test('titles require explicit naming and never infer a title from event text', () => {
  const source=run();
  source.meeting_threads[0].title='Validação do suporte';
  assert.equal(H.build(source).topics[0].title,'Validação do suporte');
  source.topic_titles={T001:'  Resistência do suporte  '};
  assert.equal(H.build(source).topics[0].title,'Resistência do suporte');
  source.meeting_threads[0]={thread_id:'T001'};
  assert.equal(H.build(source).topics[0].title,'Resistência do suporte');
  delete source.topic_titles;
  source.meeting_events.unshift(event('E0','hypothesis','Hipótese inicial.'));
  assert.equal(H.build(source).topics[0].title,'Assunto sem título');
  assert.equal(H.build(source).topics[1].title,'Assunto sem título');
  source.meeting_events[1].text='Uma observação longa '.repeat(20);
  assert.equal(H.build(source).topics[0].title,'Assunto sem título');
});

test('unconfirmed, weak, missing-score and ambiguous edges never become parents or complete a test', () => {
  for (const patch of [
    {review_state:'needs_review'}, {relation_probability:.79}, {match_probability:.79},
    {relation_probability:undefined}, {configuration_match:'ambiguous'}, {error:'Classificação incompleta.'}
  ]) {
    const source=run();Object.assign(source.meeting_relations[2],patch);
    const doc=H.build(source);
    assert.equal(find(doc,'E4').parent_id,null);
    assert.equal(find(doc,'E3').completed,false);
    assert.ok(find(doc,'E4').review.length);
  }
});

test('explicit attribution with different or partial configuration nests the result but leaves test open with a warning', () => {
  for (const config of ['partial','mismatch']) {
    const source=run();source.meeting_relations[2].configuration_match=config;
    const doc=H.build(source);
    assert.equal(find(doc,'E4').parent_id,'E3');
    assert.equal(find(doc,'E3').completed,false);
    assert.equal(find(doc,'E3').status,'open');
    assert.ok(find(doc,'E3').review.some(item=>item.id.startsWith('configuration:')));
    assert.ok(find(doc,'E4').review.some(item=>item.id.startsWith('configuration:')));
  }
});

test('a result without applicable setup evidence stays separate and pending', () => {
  const source=run();Object.assign(source.meeting_relations[2],{configuration_match:null,configuration_applicable:false});
  const doc=H.build(source);
  assert.equal(find(doc,'E4').parent_id,null);
  assert.equal(find(doc,'E3').completed,false);
  assert.ok(find(doc,'E4').review.length);
});

test('cross-topic and dangling relations cannot group points or complete tests', () => {
  const source=run();source.meeting_events[3].thread_id='T002';
  source.meeting_relations.push(edge('E4','absent','result_of','exact'));
  const doc=H.build(source);
  assert.equal(find(doc,'E4').parent_id,null);
  assert.equal(find(doc,'E3').completed,false);
  assert.equal(find(doc,'E4').review.length,2);
  assert.equal(allNodes(doc).length,source.meeting_events.length);
});

test('generic related_to, rationale, support, repeats and proximity cannot create a hierarchy', () => {
  const source=run();source.meeting_relations=[
    edge('E2','E1','supports'),edge('E3','E2','related_to'),edge('E4','E3','repeats','exact'),
    edge('E5','E4','based_on'),edge('E3','E1','depends_on')
  ];
  const doc=H.build(source);
  assert.equal(doc.metrics.nested,0);
  assert.equal(find(doc,'E3').completed,false);
});

test('a node with competing confirmed parents stays visible once and requests review', () => {
  const source=run();source.meeting_events.push(event('E7','hypothesis','A rigidez pode explicar a deformação.'));
  source.meeting_relations.push(edge('E3','E7','tests'));
  const doc=H.build(source);
  assert.equal(find(doc,'E3').parent_id,null);
  assert.equal(find(doc,'E4').parent_id,'E3');
  assert.ok(find(doc,'E3').review.some(item=>item.id==='parents:E3'));
  assert.equal(new Set(allNodes(doc).map(node=>node.id)).size,source.meeting_events.length);
});

test('cycles are broken while preserving result and test structural roles', () => {
  const source=run();source.meeting_relations[0]=edge('E2','E4','related_to');
  const doc=H.build(source);
  assert.equal(find(doc,'E2').parent_id,null);
  assert.equal(find(doc,'E3').parent_id,'E2');
  assert.equal(find(doc,'E4').parent_id,'E3');
  assert.ok(doc.review.some(item=>item.id.startsWith('cycle:')));
  assert.equal(allNodes(doc).length,6);
});

test('unassigned points remain in a separate topic and do not acquire a hierarchy', () => {
  const source=run();source.meeting_events[0].thread_id=null;source.meeting_events[1].thread_id=null;
  const doc=H.build(source),topic=doc.topics.find(item=>item.id===null);
  assert.equal(topic.title,'Pontos a organizar');
  assert.deepEqual(topic.nodes.map(node=>node.id),['E1','E2']);
  assert.ok(topic.review.length);
  assert.equal(allNodes(doc).length,6);
});

test('superseded outcomes stay nested as history but no longer complete the test', () => {
  const source=run();source.meeting_events.push(event('E7','observation','A medição relatada estava incorreta.'));
  source.meeting_relations.push(edge('E7','E4','supersedes'));
  const doc=H.build(source);
  assert.equal(find(doc,'E4').status,'superseded');
  assert.equal(find(doc,'E4').parent_id,'E3');
  assert.equal(find(doc,'E3').completed,false);
  assert.ok(find(doc,'E3').review.some(item=>item.message.includes('substituída')));
});

test('incomplete classification and uncertain negative pairs become compact review entries', () => {
  const source=run();source.typed_relation_worker={jobs:[{event_id:'E5',status:'interrupted',results:[{target_event_id:'E1',relation_type:'none',review_state:'needs_review'}]}]};
  const doc=H.build(source);
  assert.equal(find(doc,'E5').review.length,2);
  assert.equal(find(doc,'E5').parent_id,null);
});

test('browser UMD fallback keeps a test open even if raw event.status claims completion', () => {
  const context={};vm.runInNewContext(fs.readFileSync(require.resolve('../meeting-hierarchy.js'),'utf8'),context);
  const source=run();source.meeting_events[2].status='completed';
  const doc=context.NorteMeetingHierarchy.build(source);
  assert.equal(find(doc,'E3').completed,false);
  assert.equal(find(doc,'E3').status,'open');
  assert.equal(find(doc,'E4').parent_id,'E3');
});

test('empty memory works and duplicate event identifiers are rejected', () => {
  assert.deepEqual(H.build({meeting_events:[]}).topics,[]);
  const source=run();source.meeting_events.push({...source.meeting_events[0]});
  assert.throws(()=>H.build(source),/identificador/);
});
