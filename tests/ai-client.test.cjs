const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function client(){
 const requests=[],listeners={};
 const box={document:{body:{dataset:{auth:'on'}},addEventListener(){}},addEventListener:(name,fn)=>listeners[name]=fn,crypto:require('node:crypto').webcrypto,TextEncoder,AbortSignal,
  setTimeout:()=>1,fetch:async(url,options)=>{requests.push({url,body:JSON.parse(options.body)});return {ok:true,json:async()=>({intent:'open_simulation',confidence:.99,source:'learned_alias'})};}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../ai-client.js'),'utf8'),box);
 return {api:box.NorteAI,requests,box};
}
const entry=(id,text,extra={})=>({id,text,status:'done',source:'microphone',receivedAt:'2026-10-09T10:00:00Z',...extra});
test('merged speech is one decision and preserves the full classified point',async()=>{
 const {api,requests}=client(),run={id:'r',transcript:[entry('s1','o resultado foi',{chunk_id:'c1'}),entry('s2','20 MPa',{chunk_id:'c1'})],batch:{cases:[{id:'c1',current_utterance:'o resultado foi 20 MPa'}]},records:[{id:'c1',result:{type:'test_result',store:true},timestamp:'2026-10-09T10:00:01Z'}]};
 api.observe(run);api.observe(run);await api.flush();
 assert.equal(requests.length,1);assert.equal(requests[0].body.events.length,1);
 assert.equal(requests[0].body.events[0].text,'o resultado foi 20 MPa');
 assert.equal(requests[0].body.events[0].correct,undefined);
});
test('failed physical request carries bounded state for local replay and clamps latency',async()=>{
 const {api,requests}=client(),state={L:6,loads:[]};
 api.observe({id:'r',transcript:[entry('s','muda a força p9 para 8 kN',{status:'command',command:{id:'b',text:'muda a força p9 para 8 kN',consumed:true,status:'ambiguous',processed_at:'2026-10-09T15:00:00Z',beam_state_before:state,issues:[{code:'missing_target'}]}})]});
 await api.flush();const event=requests[0].body.events[0];
 assert.equal(event.status,'unrecognized');assert.equal(event.latency_ms,3600000);assert.equal(event.details.beam_state_before.L,6);
});
test('incomplete commands do not count as failures',async()=>{
 const {api,requests}=client();api.observe({id:'r',transcript:[entry('s','mude a força para',{status:'command',command:{id:'b',consumed:true,status:'awaiting_continuation'}})]});await api.flush();assert.equal(requests.length,0);
});
test('resolver never sends negation, numbers or physical state externally',async()=>{
 const {api,requests}=client();
 assert.equal(await api.resolve('não abra a simulação','r'),null);
 assert.equal(await api.resolve('muda a força para 12 kN','r'),null);
 await api.resolve('bora mostrar essa simulação','r');
 assert.equal(requests.length,1);assert.deepEqual(Object.keys(requests[0].body).sort(),['allow_model','session_id','text']);
});
test('telemetry failure retains the batch for a later retry',async()=>{
 const {api,requests,box}=client();const original=box.fetch;box.fetch=async()=>{throw Error('offline');};
 api.record({id:'e',session_id:'r',kind:'intent',text:'simula a viga',status:'success'});assert.equal(await api.flush(),false);
 box.fetch=original;assert.equal(await api.flush(),true);assert.equal(requests[0].body.events[0].id,'e');
});
