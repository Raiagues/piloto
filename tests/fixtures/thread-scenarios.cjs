const F=require('../../memory-flow.js');
const clone=x=>JSON.parse(JSON.stringify(x));
const requested=clone(require('./memory-b001.json'));
delete requested.expected_relations;
Object.assign(requested,require('./expected-threads.json'));
const scenario={batch_id:'TOPICS',cases:[
  ['bracket','The bracket is deforming too much.','observation'],
  ['noise','Yeah.',null],
  ['cause','Maybe the bracket thickness causes this.','hypothesis'],
  ['test_bracket',"Let's test 4 mm.",'test_proposal'],
  ['sensor','Next, the sensor enclosure wall is too flexible.','observation'],
  ['noise2','Could you repeat that?',null],
  ['sensor_cause','Maybe increasing the enclosure thickness will help.','hypothesis'],
  ['test_sensor',"Let's test 4 mm.",'test_proposal'],
  ['requirement','The client requires a safety factor of two.','requirement'],
  ['return',"Let's go back to the bracket. Test the 4 mm version again.",'test_proposal'],
  ['ambiguous','That one needs a test.','test_proposal'],
  ['archive_uncertain','The other problem may be back.','hypothesis'],
  ['archive_conflict','The earlier concern needs a new test.','test_proposal']
].map(([id,current_utterance,type])=>({id,current_utterance,expected_store_memory:type!==null,expected_event_type:type})),expected_threads:{
  bracket:{expected_action:'create_new_thread',expected_thread_id:'T001'},cause:'T001',test_bracket:'T001',
  sensor:{expected_active_result:'does_not_belong',expected_archive_match:null,expected_action:'create_new_thread',expected_thread_id:'T002'},sensor_cause:'T002',test_sensor:'T002',
  requirement:{expected_active_result:'does_not_belong',expected_archive_match:null,expected_action:'create_new_thread',expected_thread_id:'T003'},
  return:{expected_active_result:'does_not_belong',expected_archive_match:'T001',expected_archive_result:'belongs',expected_action:'reactivate_thread',expected_thread_id:'T001'},
  ambiguous:{expected_active_result:'uncertain',expected_action:'assignment_pending',expected_thread_id:null},archive_uncertain:null,archive_conflict:null
}};
function response(req,choices={},p=.94){return {request:clone(req),response:{model:'fixture',answers:Object.fromEntries(Object.entries(req.questions).map(([id,q])=>{
  const choice=choices[id] || 'belongs',keys=Object.keys(q.criteria);
  return [id,{type:'choice',choice,confidence:.2,probabilities:Object.fromEntries(keys.map(k=>[k,k===choice?p:(1-p)/(keys.length-1)]))}];
}))},latencyMs:1,provider:'official'};}
function threadOutput(req){
  const id=req.state.current_event.chunk_id,active=req.questions.belongs_to_active_thread;
  const choice=active?(['C12','C13','sensor','requirement','return','archive_uncertain','archive_conflict'].includes(id)?'does_not_belong':id==='ambiguous'?'uncertain':'belongs'):null;
  const values=Object.fromEntries(Object.keys(req.questions).map(key=>[key,choice || (id==='archive_uncertain'?key.endsWith('T002')?'uncertain':'does_not_belong':id==='archive_conflict'?'belongs':(id==='C13'||id==='return')&&key.endsWith('T001')?'belongs':'does_not_belong')]));
  return response(req,values);
}
function chunkOutput(req,batch){
  const item=batch.cases.find(c=>c.current_utterance===req.state.current_utterance);
  if(!item)throw Error('Unknown mock chunk');
  const answers=req.questions.should_store_memory?{should_store_memory:{type:'noul',noul:item.expected_store_memory?.96:.03}}:{event_type:{type:'choice',choice:item.expected_event_type,confidence:.2,probabilities:Object.fromEntries(Object.keys(req.questions.event_type.criteria).map(k=>[k,k===item.expected_event_type?1:0]))}};
  return {request:clone(req),response:{model:'fixture',answers},provider:'official',latencyMs:1};
}
module.exports={requested,scenario,threadOutput,chunkOutput,response,clone};
