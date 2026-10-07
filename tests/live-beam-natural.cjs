// Explicitly opt-in: this script consumes the configured server's API credits.
// All cases are synthetic speech fixtures; expected outcomes never enter requests.
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const C=require('../beam-commands.js'),B=require('../beam-engine.js');
async function main(){
 if(!process.argv.includes('--run-live'))throw Error('Use --run-live only when API-credit use is authorized.');
 const state=B.defaultState(),lastForce={...C.parse('Norte, mude a força P1 para 12 kN',{state}),id:'fixture-last-force',created_at:new Date().toISOString()},lastHeight={...C.parse('Norte, mude a altura da seção para 300 mm',{state}),id:'fixture-last-height',created_at:new Date().toISOString()},pending={id:'fixture-pending',text:'Norte a força P1 para 12 km',status:'ambiguous',created_at:new Date().toISOString()};
 const cases=[
  ['tá então o Norte vamos simular um teste uma discussão vamos simular uma viga',true,{active:false}],
  ['Norte vamos simular uma viga',true,{active:false}],['bom então vamos simular uma viga',true,{active:false}],
  ['Norte a força P1 para 12 km',true],['Norte mude a força P1 para 12 km',true],['muda essa força pra 12 km',true],
  ['muda a força para 12',true],['pode aumentar a força pra 12?',true],['quero que você mude a força para 12 kN',true],['vamos deixar a força em 15',true],
  ['coloca em 12',true,{context:{lastCommand:lastForce}}],['KN',true,{context:{pendingAudit:pending}}],
  ['muda a altura da seção para 25 centímetros',true],['coloca a altura em 25 centímetros',true],['agora 25 cm',true,{context:{lastCommand:lastHeight}}],
  ['eu quero ver o cortante',true],['quero ver os resultados',true],['mostra os cálculos',true],['mostra gráfico',true],
  ['volta para o canvas',true],['volta para os gráficos',true],['volta para a simulação',true],['volta pra aba anterior',true],
  ['Norte, mova a força para 12 km',false],['Norte, mude o comprimento para 12 km',false],
  ['muda a força pra 12 km',false,{state:{...state,loads:[...state.loads,{...state.loads[0],id:'p2',name:'P2',x:3,edge:null}]}}],
  ['não mude a força para 12 km',false],['se aumentar a força para 12 kN',false],['vamos discutir se deveria aumentar a força',false],['ele disse "Norte mude a força para 12 km"',false],['agora 25 cm',false]
 ];
 const report={fixture:true,created_at:new Date().toISOString(),requested_model:'jev-latest',cases:[]};
 for(const [text,expectedProposed,override={}] of cases){
  const options={state,active:true,activeTab:'simulation',previousTab:'canvas',availableTabs:['canvas','simulation','results'],source:'microphone',provider:'official',...override};const before=JSON.stringify(options.state),started=Date.now();
  const audit=await C.process(text,{...options,transport:async(request,meta)=>{const response=await fetch('http://127.0.0.1:8000/api/classify',{method:'POST',headers:{'Content-Type':'application/json','X-Norte-Provider':'official'},body:JSON.stringify(request),signal:meta.signal});if(!response.ok)throw Error('HTTP '+response.status);return response.json();}});
  assert.equal(JSON.stringify(options.state),before,'classification must not mutate simulation');assert.equal(audit.raw_text,text,'original speech preserved');
  const passed=(audit.status==='proposed')===expectedProposed,row={text,expected_proposed:expectedProposed,passed,status:audit.status,latency_ms:Date.now()-started,model:audit.outputs[0]?.response?.model||null,operations:audit.operations,audit};
  report.cases.push(row);console.log(JSON.stringify({text,passed,status:row.status,latency_ms:row.latency_ms,choices:Object.fromEntries(Object.entries(audit.classifications||{}).map(([id,value])=>[id,{choice:value.choice,p:value.probabilities[value.choice]}]))}));
  if(audit.status==='classification_error')break;
 }
 report.summary={total:report.cases.length,passed:report.cases.filter(row=>row.passed).length,failed:report.cases.filter(row=>!row.passed).length,api_calls:report.cases.filter(row=>row.audit.requests.length).length};
 const directory=path.resolve(__dirname,'../.runtime');await fs.mkdir(directory,{recursive:true});const filename=path.join(directory,'beam-natural-live.json');await fs.writeFile(filename,JSON.stringify(report,null,2));console.log(JSON.stringify({summary:report.summary,report:filename}));
 if(report.summary.failed||report.summary.total!==cases.length)process.exitCode=1;
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
