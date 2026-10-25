import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from './auth';
export type AssistantSuggestion = { id?: string; title?: string; method?: string; procedure?: string; acceptanceCriteria?: string; rationale?: string; requirementIds?: string[]; sectorId?: string; source?: {title:string;url:string;section:string;accessible:boolean}; standardId?:string; reason?:string; applicability?:string };
export type AssistantRun = { id:string; kind:string; status:'queued'|'running'|'completed'|'failed'; events:{at:string;message:string;level:string}[]; result: {suggestions?:AssistantSuggestion[]; count?:number; documentDraft?:{title:string;body:string;taskId:string;templateId:string;profile:string}} | null; error?:string };
export function useEngineeringAssistant(projectId:string,onComplete?:()=>unknown) {
  const {api}=useAuth(),[run,setRun]=useState<AssistantRun|null>(null),[error,setError]=useState(''),[starting,setStarting]=useState(false);
  const completed=useRef(onComplete);completed.current=onComplete;
  const scope=useRef(projectId);scope.current=projectId;
  const notified=useRef('');
  const key=`norte:assistant-run:${projectId}`;
  useEffect(()=>{setRun(null);setError('');setStarting(false);notified.current='';let cancelled=false;let id='';try{id=sessionStorage.getItem(key)||'';}catch{/* optional persistence */}if(id)void api<{run:AssistantRun}>(`/projects/${encodeURIComponent(projectId)}/delivery/assistant-runs/${encodeURIComponent(id)}`).then(r=>{if(!cancelled)setRun(r.run);}).catch(()=>{try{sessionStorage.removeItem(key);}catch{/* private mode */}});return()=>{cancelled=true;};},[api,projectId,key]);
  useEffect(()=>{
    if(!run||!['queued','running'].includes(run.status))return;
    let disposed=false;let timeout:ReturnType<typeof setTimeout>;
    const poll=async()=>{try{const response=await api<{run:AssistantRun}>(`/projects/${encodeURIComponent(projectId)}/delivery/assistant-runs/${run.id}`);if(disposed)return;setRun(response.run);if(response.run.status==='completed'&&notified.current!==run.id){notified.current=run.id;void completed.current?.();}if(['queued','running'].includes(response.run.status))timeout=setTimeout(()=>void poll(),900);}catch(e){if(!disposed){setError(e instanceof Error?e.message:'Falha ao acompanhar a análise.');timeout=setTimeout(()=>void poll(),3000);}}};
    timeout=setTimeout(()=>void poll(),400);return()=>{disposed=true;clearTimeout(timeout);};
  },[api,projectId,run?.id,run?.status]);
  const start=useCallback(async(kind:string,payload:Record<string,unknown>={})=>{setStarting(true);setError('');try{const response=await api<{run:AssistantRun}>(`/projects/${encodeURIComponent(projectId)}/delivery/assistant-runs`,{method:'POST',body:JSON.stringify({kind,...payload})});if(scope.current!==projectId)return null;setRun(response.run);try{sessionStorage.setItem(key,response.run.id);}catch{/* optional */}return response.run;}catch(e){if(scope.current===projectId)setError(e instanceof Error?e.message:'Não foi possível iniciar.');return null;}finally{if(scope.current===projectId)setStarting(false);}},[api,projectId,key]);
  const clear=()=>{setRun(null);setError('');try{sessionStorage.removeItem(key);}catch{/* optional */}};
  return {run,start,running:starting||Boolean(run&&['queued','running'].includes(run.status)),error,clear};
}
