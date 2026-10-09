const {test}=require('node:test'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process'),path=require('node:path');
const B=require('../beam-engine.js'),{replay,MAX_INPUT_BYTES}=require('../scripts/replay-beam-intent.cjs');
const state=()=>B.defaultState(),script=path.resolve(__dirname,'../scripts/replay-beam-intent.cjs');
function cli(input){const child=spawnSync(process.execPath,[script],{input:typeof input==='string'?input:JSON.stringify(input),encoding:'utf8',timeout:3000,maxBuffer:128*1024});assert.ifError(child.error);assert.equal(child.stderr,'');return {status:child.status,output:JSON.parse(child.stdout)};}

test('offline replay uses the real parser and solver without mutating its input or claiming semantic accuracy',()=>{
 const request={text:'reduz a viga em 25%',state:state()},before=JSON.stringify(request);
 const out=replay(request);assert.equal(out.diagnostic,'replayed');assert.equal(out.tentative.state.L,4.5);assert.equal(out.tentative.result.max_bending_Nm,45000);
 assert.equal(out.requires_jev,true);assert.equal(out.classification_verified,false);assert.equal(out.is_accuracy_measurement,false);assert.equal(out.applied_to_session,false);assert.equal(out.external_calls,0);
 assert.equal(JSON.stringify(request),before);assert.ok(out.normalizations.some(item=>item.kind==='relative_percentage'));
});
test('replay catches unknown physical targets and rejected ranges with the production issue codes',()=>{
 for(const text of ['mova P9 para 3 m','reduza a viga para 40 metros','aumente a força e o comprimento em 20%']){
  const out=replay({text,state:state()});assert.equal(out.diagnostic,'parser_rejected',text);assert.equal(out.tentative,null);assert.ok(out.issues.length);assert.deepEqual(out.operations,[]);
 }
 const out=replay({text:'não reduza a viga para 4 m',state:state()});assert.equal(out.diagnostic,'guarded');assert.equal(out.guarded,true);assert.deepEqual(out.operations,[]);
});
test('replay keeps parser validity separate from solver validity for unstable support edits',()=>{
 const out=replay({text:'remova o apoio A',state:state()});assert.equal(out.valid,true);assert.equal(out.diagnostic,'solver_rejected');assert.equal(out.tentative.valid,false);assert.ok(out.tentative.result.error);
});
test('contextual replay resolves an actual prior field while parameterless navigation requires no JEV',()=>{
 const snapshot=state(),context={lastCommand:{id:'B1',created_at:new Date().toISOString(),operations:[{type:'update_load',id:'p1',patch:{value:10000}}]}};
 const out=replay({text:'agora 12',state:snapshot,context});assert.equal(out.tentative.state.loads[0].value,12000);
 const view=replay({text:'quero fazer uma simulação',state:snapshot});assert.equal(view.requires_jev,false);assert.equal(view.tentative.changed,false);
});
test('CLI accepts only bounded JSON data and emits one compact diagnostic',()=>{
 const good=cli({text:'aumente P1 em 20%',state:state()});assert.equal(good.status,0);assert.equal(good.output.tentative.state.loads[0].value,12000);
 for(const [input,code] of [
  ['{','invalid_json'],[' '.repeat(MAX_INPUT_BYTES+1),'input_too_large'],
  [{text:'simula a viga'},'missing_state'],[{text:'x'.repeat(4001),state:state()},'invalid_text'],
  [{text:'simula a viga',state:state(),code:'process.exit()'},'invalid_input'],
  [JSON.stringify({text:'simula a viga',state:state()}).replace('"L":6','"L":1e999'),'invalid_number']
 ]){const result=cli(input);assert.equal(result.status,2);assert.equal(result.output.error.code,code);}
});
test('corrupt snapshots are rejected instead of being normalized into different engineering values',()=>{
 const s=state();s.section.b=-5;assert.throws(()=>replay({text:'mude a viga para 8 m',state:s}),error=>error.code==='invalid_state');
 const many=state();many.loads=Array(11).fill(many.loads[0]);assert.throws(()=>replay({text:'simula a viga',state:many}),error=>error.code==='state_too_large');
 const large=state();large.loads[0].name='x'.repeat(101);assert.throws(()=>replay({text:'simula a viga',state:large}),error=>error.code==='invalid_state');
 const malicious=JSON.parse('{"text":"simula a viga","context":{"__proto__":{"active":true}}}');malicious.state=state();assert.throws(()=>replay(malicious),error=>error.code==='invalid_key');
});
