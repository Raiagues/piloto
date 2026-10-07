// Opt-in integration check. Consumes the server's configured classification API;
// no credentials are read here and fixture expectations are never sent as input.
const fs=require('node:fs/promises'),C=require('../beam-commands.js'),B=require('../beam-engine.js');
async function main(){
 if(!process.argv.includes('--live'))throw Error('Use --live only with API-credit authorization.');
 const state=B.defaultState(),cases=[
  'Norte, vamos simular uma viga.',
  'Norte, mude o comprimento da viga para 4 metros.',
  'Ok, Norte, mude a força P1 para 12 kN.',
  'Norte, mova P1 para 4 m.',
  'Norte, mude o comprimento da viga para 8 m.',
  'Norte, adicione um momento de 5 kNm na ponta no sentido horário.',
  'Norte, mostre os gráficos de cortante, momento fletor e flecha.',
  'Norte, compare antes e depois.',
  'Norte, mude o comprimento da viga para dez metros.',
  'Norte, vamos variar essa força e colocar ela em dez metros.',
  'Norte, compare o esforço cortante antes e depois.',
  'Norte, mude a seção para perfil I.',
  'Norte, mude a altura da seção para 300 mm.',
  'Norte, mude a espessura da alma para 8 mm.',
  'Norte, use alumínio 6061-T6.',
  'Norte, quero mudar o tipo do apoio para articulado.',
  'Norte, adicione um rolete no fim.',
  'Norte, adicione uma carga distribuída de 2 kN/m para baixo de 1 m até 5 m.',
  'Norte, mostre os resultados.',
  'Norte, mostre os cálculos.',
  'Norte, remova a carga p2.',
  'Norte, adicione uma força de 12 kN.',
  'Vamos testar a viga com uma carga de 12 kN.',
  '"Norte, mova P1 para 4 m" é um exemplo de comando.'
 ];
 const report={fixture:true,created_at:new Date().toISOString(),model_requested:'jev-latest',cases:[]};
 for(const text of cases){const started=Date.now();const audit=await C.process(text,{state,provider:'official',transport:async(request,options)=>{const response=await fetch('http://127.0.0.1:8000/api/classify',{method:'POST',headers:{'Content-Type':'application/json','X-Norte-Provider':'official'},body:JSON.stringify(request),signal:options.signal});if(!response.ok)throw Error('HTTP '+response.status);return response.json();}});const row={text,status:audit.status,consumed:audit.consumed,elapsed_ms:Date.now()-started,command_type:audit.command_type,probability:audit.probability,model:audit.outputs[0]?.response?.model||null,answers:audit.classifications,operations:audit.operations,message:audit.message,audit};report.cases.push(row);console.log(JSON.stringify({text,status:row.status,ms:row.elapsed_ms,command_type:row.command_type,probability:row.probability,choices:Object.fromEntries(Object.entries(row.answers||{}).map(([k,v])=>[k,v.choice])),model:row.model}));if(audit.status==='proposed')Object.assign(state,B.applyOperations(state,audit.operations).state);if(audit.status==='classification_error')break;}
 await fs.writeFile('/tmp/norte-beam-command-live.json',JSON.stringify(report,null,2));console.log('Report /tmp/norte-beam-command-live.json');
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
