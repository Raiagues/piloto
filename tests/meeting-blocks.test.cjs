const test=require('node:test'),assert=require('node:assert/strict');
const Blocks=require('../meetings/web/meeting-blocks.js'),Canvas=require('../meetings/web/meeting-canvas.js');
const source='Conversamos sobre o suporte por bastante tempo e ficou decidido, depois dessa conversa, que Marina revisará o suporte na sexta-feira.';
function run(){return {id:'S1',topic_titles:{},meeting_threads:[{thread_id:'T1'}],meeting_relations:[],meeting_events:[{event_id:'E1',thread_id:'T1',type:'decision',text:source,store_confidence:.99,type_confidence:.99}]};}
function overlay(r){const basis=r.meeting_events.map(e=>({id:e.event_id,text:e.text,type:e.type,thread_id:e.thread_id}));return {blocks:{E1:{text:'Marina revisará o suporte na sexta-feira.',source,basis,key:'B1',version:1,origin:'automatic'}},titles:{T1:{text:'Revisão do suporte',source,basis,key:'T1',version:1,origin:'automatic'}}};}

test('canvas displays concise overlay while preserving original evidence and classification',()=>{
 const r=run();r.block_review=overlay(r);const before=JSON.stringify(r),projection=Canvas.build(r),node=projection.topics[0].columns.details[0];
 assert.equal(node.text,source);assert.equal(node.event.text,source);assert.equal(node.display_text,r.block_review.blocks.E1.text);assert.equal(node.type,'decision');
 assert.equal(projection.topics[0].title,'Revisão do suporte');assert.equal(JSON.stringify(r),before);
 r.topic_titles.T1='Meu título';assert.equal(Canvas.build(r).topics[0].title,'Meu título');
});
test('changed source, new context or new title evidence invalidates stale overlays',()=>{
 const r=run();r.block_review=overlay(r);r.meeting_events[0].text='Outra decisão.';
 assert.equal(Blocks.valid(r.block_review.blocks.E1,r,'block','E1'),false);
 assert.equal(Canvas.build(r).topics[0].columns.details[0].display_text,undefined);
 const next=run();next.block_review=overlay(next);next.meeting_events.push({event_id:'E2',thread_id:'T1',type:'decision',text:'Outra decisão.'});
 assert.equal(Blocks.valid(next.block_review.blocks.E1,next,'block','E1'),true);
 assert.equal(Blocks.valid(next.block_review.titles.T1,next,'title','T1'),false);
 next.meeting_events.unshift({event_id:'E0',thread_id:'T1',type:'observation',text:'Contexto anterior diferente.'});
 assert.equal(Blocks.valid(next.block_review.blocks.E1,next,'block','E1'),false);
});
test('late responses cannot paint another meeting',async()=>{
 let current=run(),resolve;const first=current;
 const client=Blocks.create({getRun:()=>current,fetch:()=>new Promise(r=>resolve=r)});
 const pending=client.refresh();current={...run(),id:'S2'};
 resolve({ok:true,json:async()=>({status:'ready',review:overlay(first)})});await pending;client.stop();
 assert.equal(current.block_review,undefined);assert.equal(first.block_review,undefined);
});
test('human title approval becomes an explicit title and saves without altering speech',async()=>{
 const current=run();current.block_review=overlay(current);let saved=0,body;
 const client=Blocks.create({getRun:()=>current,onSave:()=>saved++,fetch:async(url,options)=>{body=JSON.parse(options.body);return {ok:true,json:async()=>({status:'ready',review:overlay(current)})};}});
 await client.feedback('title','T1','correct','Plano de revisão');client.stop();
 assert.equal(body.version,1);assert.equal(body.key,'T1');assert.equal(current.topic_titles.T1,'Plano de revisão');assert.equal(current.meeting_threads[0].title,'Plano de revisão');
 assert.equal(current.meeting_events[0].text,source);assert.equal(saved,1);assert.equal(current.title_edits[0].source,'manual');
});
test('failed feedback preserves the visible suggestion and original',async()=>{
 const current=run();current.block_review=overlay(current);const before=JSON.stringify(current);
 const client=Blocks.create({getRun:()=>current,fetch:async()=>({ok:false,json:async()=>({error:'A sugestão mudou.'})})});
 await assert.rejects(client.feedback('block','E1','correct','Novo texto'),/mudou/);client.stop();assert.equal(JSON.stringify(current),before);
});

test('human display summaries need no model, preserve source and survive later AI overlays',()=>{
 const r=run();r.block_edits={E1:{text:'Marina revisará o suporte na sexta-feira.',source}};r.block_review=overlay(r);
 assert.equal(Blocks.manual(r,'E1').text,r.block_edits.E1.text);
 const node=Canvas.build(r).topics[0].columns.details[0];assert.equal(node.display_text,r.block_edits.E1.text);assert.equal(node.text,source);assert.equal(node.editorial,'human');
 r.meeting_events[0].text='Fonte alterada';assert.equal(Blocks.manual(r,'E1'),null);assert.equal(Canvas.build(r).topics[0].columns.details[0].display_text,undefined);
});

test('restore original explicitly overrides a previous automatic summary',()=>{
 const r=run();r.block_review=overlay(r);r.block_edits={E1:{restore:true,source}};
 assert.equal(Canvas.build(r).topics[0].columns.details[0].display_text,source);
});

test('local manual editing never enables automatic provider calls',async()=>{
 const current=run();let requests=0;const client=Blocks.create({getRun:()=>current,automatic:false,fetch:async()=>{requests++;throw Error('unexpected');},delay:0});
 client.saved(current);await client.refresh();client.stop();assert.equal(requests,0);
});

test('human label changes the projection while preserving raw Jev classification and reverting cleanly',()=>{
 const r=run(),raw=JSON.stringify(r.meeting_events);
 r.classification_learning={version:1,examples:[{event_id:'E1',source,label:'hypothesis',original_label:'decision'}]};
 const projection=Canvas.build(r),node=projection.topics[0].columns.hypotheses[0];
 assert.equal(node.type,'hypothesis');assert.equal(node.event.original_type,'decision');
 assert.equal(JSON.stringify(r.meeting_events),raw);
 r.classification_learning={version:2,examples:[]};
 assert.equal(Canvas.build(r).topics[0].columns.details[0].type,'decision');
 r.classification_learning={version:3,examples:[{event_id:'E1',source:'Fonte diferente',label:'hypothesis'}]};
 assert.equal(Blocks.classification(r,r.meeting_events[0]),null);
});
