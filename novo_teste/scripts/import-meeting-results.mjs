/** Import only previously evaluated private LYLE artifacts, through ordinary APIs.
 * --check is read-only/local. --apply requires an explicit origin and private runtime.
 * Never calls classification/minutes, registers accounts, deletes data or overwrites edits.
 */
import { readFile, writeFile, rename, chmod, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const root=resolve(import.meta.dirname,'../..'),require=createRequire(import.meta.url);
const {prepare}=require('../resultados/reunioes/scripts/preparar-seed-lyle.cjs');
const ensure=(ok,message)=>{if(!ok)throw Error(message);};
export async function importMeetingResults({origin,runtime,credentialsPath,workspaceStatePath,bundlePath,apply=false,scope='team',fetchImpl=fetch}){
 const bundle=JSON.parse(await readFile(bundlePath,'utf8'));
 ensure(bundle.schema==='norte.lyle-evaluation-import.v1'&&bundle.fictional===true&&bundle.meetings?.length===3,'Pacote privado não reconhecido.');
 ensure(new Set(bundle.meetings.map(m=>m.scenarioId)).size===3&&bundle.meetings.every(m=>/^LYLE-0[123]$/.test(m.scenarioId)&&m.run?.status==='done'&&m.organized?.model&&m.source?.sha256),'São necessários exatamente três resultados reais concluídos.');
 if(!apply)return {mode:'check',meetings:bundle.meetings.map(m=>({scenario:m.scenarioId,events:m.run.meeting_events.length,editorial:m.organized.editorial_counts})),providerCalls:0};
 const url=new URL(origin);ensure(url.origin===origin&&(!url.username&&!url.password)&&(['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.protocol==='https:'),'Use uma origem HTTPS ou localhost explícita.');
 const credentials=JSON.parse(await readFile(credentialsPath,'utf8')),workspace=JSON.parse(await readFile(workspaceStatePath,'utf8'));
 ensure(credentials.origin===origin&&workspace.origin===origin,'Credenciais/estado pertencem a outra origem.');
 ensure(typeof credentials.password==='string'&&typeof (credentials.login||credentials.email)==='string','Credenciais locais ausentes.');
 ensure(['private','team'].includes(scope),'Escopo de importação inválido.');
 ensure(scope==='private'||workspace.projectId&&workspace.teamId,'Prepare primeiro a equipe e o projeto de destino.');
 const projectId=scope==='private'?null:workspace.projectId,teamId=scope==='private'?null:workspace.teamId;
 await mkdir(runtime,{recursive:true,mode:0o700});
 const statePath=join(runtime,'lyle-meeting-results-import.json');let state;
 try{state=JSON.parse(await readFile(statePath,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;state={version:1,origin,meetings:{}};}
 ensure(state.origin===origin,'Estado de importação pertence a outro servidor.');ensure(!state.scope||state.scope===scope,'Estado de importação pertence a outro escopo.');state.scope=scope;
 const save=async()=>{const temporary=statePath+'.tmp';await writeFile(temporary,JSON.stringify(state,null,2),{mode:0o600});await chmod(temporary,0o600);await rename(temporary,statePath);};
 let cookie='',csrf='';
 const api=async(path,body)=>{
  const response=await fetchImpl(origin+'/api'+path,{method:body===undefined?'GET':'POST',redirect:'error',headers:{origin,...(cookie?{cookie}:{}),...(csrf?{'x-csrf-token':csrf}:{}),...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(180000)});
  const set=response.headers.getSetCookie?.()||[];if(set.length)cookie=set.map(value=>value.split(';')[0]).join('; ');
  let data;try{data=await response.json();}catch{throw Error('Resposta inválida da API ('+response.status+').');}
  if(!response.ok)throw Error('API '+path.split('?')[0]+' recusou HTTP '+response.status+' ('+String(data.code||'sem código')+').');
  if(data.csrfToken)csrf=data.csrfToken;return data;
 };
 const signed=await api('/auth/login',{login:credentials.login||credentials.email,password:credentials.password});
 ensure(signed.user?.id&&csrf&&cookie,'Login não concluiu a sessão de importação.');
 const userId=signed.user.id;ensure(!state.userId||state.userId===userId,'Importação pertence a outra conta.');state.userId=userId;
 const list=(await api('/meetings')).meetings,results=[];
 for(const item of bundle.meetings){
  const title=item.title,known=state.meetings[item.scenarioId],matches=list.filter(m=>m.title===title&&m.ownerId===userId&&m.projectId===projectId);
  ensure(matches.length<=1,'Há reuniões repetidas para '+item.scenarioId+'; revise antes de importar.');
  let meeting=known?.id?(await api('/meetings/'+encodeURIComponent(known.id))).meeting:matches[0];
  if(!meeting){meeting=(await api('/meetings',{title,scope,teamId,projectId})).meeting;list.push(meeting);}
  ensure(meeting.ownerId===userId&&meeting.projectId===projectId,'Destino não pertence à conta/projeto esperado.');
  state.meetings[item.scenarioId]={...known,id:meeting.id,sourceSha256:item.source.sha256};await save();
  const key='norte.meeting-room.session.v2.'+meeting.id,path='/meetings/'+encodeURIComponent(meeting.id)+'/legacy/records',saved=await api(path+'?key='+encodeURIComponent(key));
  if(saved.value!==null){
   const run=JSON.parse(saved.value);ensure(run.source_document?.sha256===item.source.sha256&&run.source_document?.scenario===item.scenarioId,'Destino já tem registros diferentes; nada será sobrescrito.');
   results.push({scenario:item.scenarioId,id:meeting.id,status:'preserved_existing',recordVersion:saved.version});continue;
  }
  const run=prepare(item.run,item.organized,meeting.id);run.title=title;run.project_id=projectId;run.source_document=item.source;
  const result=await api(path,{key,value:JSON.stringify(run),expected_version:saved.version});
  state.meetings[item.scenarioId]={...state.meetings[item.scenarioId],importedAt:new Date().toISOString(),recordVersion:result.version,contentSha256:createHash('sha256').update(JSON.stringify(run)).digest('hex')};await save();
  const verified=(await api('/meetings/'+encodeURIComponent(meeting.id))).meeting;ensure(verified.status==='done','Registro salvo, mas o status precisa ser conferido.');
  results.push({scenario:item.scenarioId,id:meeting.id,status:'imported',recordVersion:result.version});
 }
 return {mode:'apply',providerCalls:0,meetings:results};
}
if(process.argv[1]&&resolve(process.argv[1])===import.meta.filename){
 const apply=process.argv.includes('--apply');ensure(process.argv.slice(2).every(arg=>['--apply','--check'].includes(arg)),'Use --check ou --apply.');
 const runtime=resolve(process.env.NORTE_REVIEW_RUNTIME||join(root,'.runtime'));
 importMeetingResults({apply,scope:process.env.NORTE_MEETING_IMPORT_SCOPE||'team',origin:process.env.NORTE_REVIEW_ORIGIN||'',runtime,credentialsPath:resolve(process.env.NORTE_MEETING_IMPORT_CREDENTIALS||join(runtime,'workspace-review-credentials.json')),workspaceStatePath:resolve(process.env.NORTE_MEETING_IMPORT_WORKSPACE||join(runtime,'workspace-review-seed-state.json')),bundlePath:resolve(process.env.NORTE_MEETING_IMPORT_BUNDLE||join(root,'novo_teste/resultados/reunioes/artefatos/lyle-meetings-seed.json'))}).then(result=>console.log(JSON.stringify(result,null,2))).catch(error=>{console.error(error.message);process.exitCode=1;});
}
