#!/usr/bin/env node
'use strict';
// Export an audited, real JEV run through the same browser PDF module as the UI.
// No model calls. The ephemeral loopback server serves static assets and the run only.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),http=require('node:http'),crypto=require('node:crypto');
const {spawn,execFileSync}=require('node:child_process'),{setTimeout:sleep}=require('node:timers/promises');
const F=require('../memory-flow.js'),TR=require('../typed-relations.js'),M=require('../meeting-minutes.js');
function options(argv){const out={};for(let i=0;i<argv.length;i++){if(argv[i]==='--help')out.help=true;else if(['--run','--output'].includes(argv[i])&&argv[i+1]&&!argv[i+1].startsWith('--'))out[argv[i++].slice(2)]=argv[i];else throw Error('Use --run artifact.json --output minutes.pdf');}if(!out.help&&(!out.run||!out.output))throw Error('Both --run and --output are required.');return out;}
const normalize=s=>s.normalize('NFKC').replace(/\s+/gu,' ').trim();
async function main(){
 const args=options(process.argv.slice(2));if(args.help){console.log('Usage: node scripts/export-meeting-minutes.cjs --run real-artifact.json --output minutes.pdf\nRequires a completed real JEV artifact, Chrome and pdftotext. Makes no model calls. Exports thread headings, classified sections and original utterances; keeps audit data in the verification JSON.');return;}
 const sourcePath=path.resolve(args.run),outputPath=path.resolve(args.output),raw=await fs.readFile(sourcePath,'utf8'),artifact=JSON.parse(raw);
 assert.equal(artifact.source,'live-jev','Use an actual JEV artifact.');assert.notEqual(artifact.evaluation?.mode,'isolated','Annotated upstream is not a full real meeting run.');assert.notEqual(artifact.run?.upstream_origin,'annotated_fixture');assert.ok(artifact.summary,'The run has not completed its audit summary.');
 const run=F.restore(artifact.run);assert.equal(run.provider,'official');assert.equal(run.status,'done');assert.equal(run.thread_worker?.status,'done');assert.equal(run.typed_relation_worker?.status,'done');
 const expected=M.buildDocument(run),states=TR.lifecycle(run),root=path.resolve(__dirname,'..'),requests=[],errors=[];
 // Check completion against evidence instead of the fixture's desired answers.
 for(const event of run.meeting_events.filter(e=>e.type==='test_proposal')){
  if(states[event.event_id].status!=='completed')continue;
  assert.ok(run.meeting_relations.some(r=>r.target_event_id===event.event_id&&r.relation_type==='result_of'&&r.configuration_match==='exact'&&r.review_state==='confirmed'&&r.relation_probability+1e-12>=TR.threshold&&r.match_probability+1e-12>=TR.threshold&&states[r.source_event_id]?.status!=='superseded'),'A completed proposal lacks confirmed, exact, current result evidence: '+event.event_id);
 }
 const assets=new Set(['experiments.js','typed-relations.js','meeting-minutes.js','vendor/minutes/jspdf-4.2.1.umd.min.js','vendor/minutes/DejaVuSans-2.37.ttf']);
 const server=http.createServer(async(req,res)=>{try{const name=new URL(req.url,'http://localhost').pathname.slice(1);requests.push(name);if(!name)return res.writeHead(200,{'Content-Type':'text/html'}).end('<!doctype html><meta charset="utf-8"><title>Local meeting export</title><script src="experiments.js"></script><script src="typed-relations.js"></script><script src="meeting-minutes.js"></script>');if(name==='run.json')return res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify(run));if(!assets.has(name))return res.writeHead(404).end();res.writeHead(200,{'Content-Type':name.endsWith('.js')?'text/javascript':'font/ttf'}).end(await fs.readFile(path.join(root,name)));}catch(error){res.writeHead(500).end(error.message);}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const profile=await fs.mkdtemp(path.join(os.tmpdir(),'norte-real-minutes-'));
 const chrome=spawn('google-chrome',['--headless','--no-sandbox','--disable-gpu','--disable-background-networking','--remote-debugging-port=0','--no-first-run','--user-data-dir='+profile,'about:blank'],{stdio:['ignore','ignore','pipe']});let socket,chromeError='';chrome.stderr.on('data',d=>chromeError=(chromeError+d).slice(-2000));
 try{
  let port;for(let i=0;i<160;i++){try{port=(await fs.readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch(_){await sleep(50);}}assert.ok(port,chromeError);
  const tabs=await fetch('http://127.0.0.1:'+port+'/json/list').then(r=>r.json());socket=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise(resolve=>socket.addEventListener('open',resolve,{once:true}));let next=0;const pending=new Map();
  socket.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);if(m.id){const p=pending.get(m.id);if(!p)return;pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}});
  const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++next,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method));},30000);pending.set(id,{resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}});socket.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
  await call('Runtime.enable');await call('Page.enable');await call('Page.navigate',{url:'http://127.0.0.1:'+server.address().port});
  for(let i=0;i<160;i++){if(await evaluate('Boolean(window.NorteMinutes&&window.NorteTypedRelations)'))break;await sleep(30);}
  const result=await evaluate(`(async()=>{const run=await fetch('/run.json').then(r=>r.json());const doc=NorteMinutes.buildDocument(run),states=NorteTypedRelations.lifecycle(run),pdf=await NorteMinutes.createPDF(doc);const bytes=new Uint8Array(pdf.output('arraybuffer'));let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));return {document_id:doc.id,states,pages:pdf.getNumberOfPages(),pdf:btoa(binary)};})()`);
  assert.equal(result.document_id,expected.id);assert.deepEqual(result.states,states);assert.deepEqual(errors,[]);assert.equal(requests.some(r=>r.startsWith('api/')),false);
  await fs.mkdir(path.dirname(outputPath),{recursive:true});await fs.writeFile(outputPath,Buffer.from(result.pdf,'base64'));
  const text=execFileSync('pdftotext',['-layout',outputPath,'-'],{encoding:'utf8'}),flat=normalize(text.replace(/^\s*\d+ \/ \d+\s*$/gm,''));
  for(const event of run.meeting_events)assert.ok(flat.includes(normalize(event.text)),'Missing or altered source utterance '+event.event_id);
  for(const thread of expected.threads){assert.ok(flat.includes(normalize(thread.title)),'Missing discussion title '+thread.id);let previous=-1;for(const block of thread.sections.flatMap(section=>section.blocks)){const next=flat.indexOf(normalize(block.text),previous+1);assert.ok(next>previous,'Section order lost for '+block.id);previous=next;}}
  assert.ok(flat.includes('Ata de reunião'),'Missing accented document title');
  const report={schemaVersion:2,presentation:expected.presentation,source_artifact:sourcePath,source_sha256:crypto.createHash('sha256').update(raw).digest('hex'),source_mode:artifact.evaluation?.mode,source_provider:run.provider,document_id:expected.id,output_pdf:outputPath,generated_at:new Date().toISOString(),events:run.meeting_events.length,event_ids:run.meeting_events.map(e=>e.event_id),relations:run.meeting_relations.length,warnings:expected.warnings.length,pages:result.pages,all_source_utterances_preserved:true,section_chronology_preserved:true,audit_included_in_pdf:false,review_warnings:expected.warnings,lifecycle:states,source_snapshot:expected.source,unicode_labels_verified:true,new_model_calls:0,test_proposals:run.meeting_events.filter(e=>e.type==='test_proposal').map(e=>({event_id:e.event_id,chunk_id:e.chunk_id,...states[e.event_id]}))};
  const stem=outputPath.replace(/\.pdf$/i,'');await fs.writeFile(stem+'.txt',text);await fs.writeFile(stem+'.verification.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({output:outputPath,verification:stem+'.verification.json',events:report.events,relations:report.relations,warnings:report.warnings,pages:report.pages,source_mode:report.source_mode,new_model_calls:0,test_proposals:report.test_proposals},null,2));
 }finally{socket?.close();await new Promise(resolve=>{if(chrome.exitCode!==null)return resolve();chrome.once('exit',resolve);chrome.kill('SIGTERM');});server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await fs.rm(profile,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
}
if(require.main===module)main().catch(error=>{console.error(error.stack||error.message);process.exitCode=1;});
module.exports={options,normalize};
