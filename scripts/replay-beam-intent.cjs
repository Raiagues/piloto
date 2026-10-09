#!/usr/bin/env node
/* Fixed offline replay entrypoint. JSON data in, diagnostics out. It never
 * invokes C.process, an API, generated code, storage or a live meeting. */
'use strict';
const C=require('../beam-commands.js'),B=require('../beam-engine.js');
const MAX_INPUT_BYTES=65536,MAX_DEPTH=10;
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
function fail(code,message){const error=new Error(message);error.code=code;throw error;}
function bounded(value){
 const pending=[[value,0]];let entries=0;
 while(pending.length){
  const [item,depth]=pending.pop();
  if(++entries>2400||depth>MAX_DEPTH)fail('input_too_complex','O replay excede os limites de estrutura.');
  if(typeof item==='string'&&item.length>4000)fail('string_too_long','Um campo excede 4.000 caracteres.');
  if(typeof item==='number'&&!Number.isFinite(item))fail('invalid_number','Todos os números devem ser finitos.');
  if(item&&typeof item==='object')for(const [key,child] of Object.entries(item)){
   if(['__proto__','constructor','prototype'].includes(key))fail('invalid_key','Chave de entrada não permitida.');
   pending.push([child,depth+1]);
  }
 }
}
function snapshot(input){
 if(!object(input)||!object(input.section)||!object(input.material)||!Array.isArray(input.loads)||!Array.isArray(input.supports))fail('missing_state','Informe o snapshot completo da viga antes do pedido.');
 if(input.loads.length>10||input.supports.length>8)fail('state_too_large','O editor permite até dez cargas e oito apoios.');
 if(input.loads.some(item=>!object(item))||input.supports.some(item=>!object(item)))fail('invalid_state','Cargas e apoios devem ser objetos.');
 const finiteFields=(item,keys)=>keys.every(key=>typeof item[key]==='number'&&Number.isFinite(item[key]));
 if(!finiteFields(input,['L','mbar','g'])||!finiteFields(input.section,['b','h','tw','tf'])||!finiteFields(input.material,['E','yield','rho']))fail('invalid_state','O snapshot deve incluir todas as propriedades numéricas da viga, seção e material.');
 for(const item of [...input.loads,...input.supports])if(typeof item.id!=='string'||typeof item.name!=='string'||item.id.length>64||item.name.length>100)fail('invalid_state','Os elementos precisam de nomes e identificadores limitados.');
 const state=C.stateSnapshot(input),normalized=B.normalize(state);
 // Normalization must not silently repair a corrupt engineering snapshot.
 for(const key of ['section','material'])for(const [field,value] of Object.entries(state[key]))if(normalized[key][field]!==value)fail('invalid_state','O snapshot contém uma propriedade inválida: '+key+'.'+field+'.');
 try{B.applyOperations(state,[]);}catch(error){fail('invalid_state',error.message);}
 return state;
}
function replay(input){
 if(!object(input)||typeof input.text!=='string'||!input.text.trim()||input.text.length>4000)fail('invalid_text','Informe text com 1 a 4.000 caracteres.');
 if(Object.keys(input).some(key=>!['text','state','context'].includes(key)))fail('invalid_input','Use apenas text, state e context.');
 if(input.context!==undefined&&!object(input.context))fail('invalid_context','O contexto deve ser um objeto.');
 bounded(input);
 const state=snapshot(input.state),context=input.context||{};
 const options={state,context,active:context.active!==false,activeTab:context.activeTab||'simulation',previousTab:context.previousTab||null,simulationFocus:context.simulationFocus||'beam'};
 for(const key of ['selection','selected','speaker','source','nowMs','availableTabs'])if(Object.hasOwn(context,key))options[key]=context[key];
 const interpretation=C.interpret(input.text,options),parsed=C.parse(input.text,options);
 const output={ok:true,version:1,scope:'offline_parser_and_solver',applied_to_session:false,external_calls:0,classification_verified:false,is_accuracy_measurement:false,
  guarded:interpretation.guarded,consumed:parsed.consumed,valid:parsed.valid,command_type:parsed.command_type,
  interpreted_text:parsed.interpreted_text,state_fingerprint:parsed.state_fingerprint,
  normalizations:parsed.normalizations.map(item=>({...item,from:item.from.slice(0,600),to:item.to.slice(0,600)})),
  operations:parsed.operations,candidate_operations:parsed.candidate_operations,issues:parsed.issues,
  requires_jev:parsed.valid&&!C.localView(parsed),tentative:null};
 if(parsed.valid){
  try{
   const applied=B.applyOperations(state,parsed.operations),result=B.calculate(applied.state),structural=result.valid?B.structuralResults(applied.state,result):null;
   const finite=value=>Number.isFinite(value)?value:null;
   output.tentative={state:C.stateSnapshot(applied.state),changed:applied.changed,valid:result.valid,
    result:{valid:result.valid,error:result.error||null,warning:result.warning||null,reactions:result.reactions||[],
     ...(structural?{max_shear_N:finite(structural.d.Vmax),max_bending_Nm:finite(structural.d.Mmax),max_deflection_m:finite(structural.deflection.max),bending_stress_Pa:finite(structural.sigma),shear_stress_Pa:finite(structural.tau),factor_of_safety:finite(structural.fos)}:{})}};
  }catch(error){output.tentative={state:null,changed:false,valid:false,result:{valid:false,error:error.message}};}
 }
 output.diagnostic=output.guarded?'guarded':!output.consumed?'not_recognized':!output.valid?'parser_rejected':!output.tentative?.valid?'solver_rejected':'replayed';
 return output;
}
function main(){
 let size=0,chunks=[],done=false;
 const finish=(value,status=0)=>{if(done)return;done=true;clearTimeout(timer);process.stdout.write(JSON.stringify(value)+'\n');process.exitCode=status;process.stdin.destroy();};
 const error=(code,message)=>finish({ok:false,error:{code,message}},2);
 const timer=setTimeout(()=>error('stdin_timeout','Tempo limite de leitura do replay.'),5000);
 process.stdin.on('data',chunk=>{size+=chunk.length;if(size>MAX_INPUT_BYTES)return error('input_too_large','O replay aceita até 64 KiB de JSON.');chunks.push(chunk);});
 process.stdin.on('error',()=>error('stdin_error','Não foi possível ler a entrada.'));
 process.stdin.on('end',()=>{
  if(done)return;
  let input;try{input=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch(_){return error('invalid_json','Informe exatamente um objeto JSON.');}
  chunks=[];
  try{finish(replay(input));}catch(cause){error(cause.code||'replay_failed',cause.code?cause.message:'Não foi possível reproduzir o pedido.');}
 });
}
if(require.main===module)main();
module.exports={replay,MAX_INPUT_BYTES};
