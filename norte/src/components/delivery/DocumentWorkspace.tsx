import { useEffect, useState } from 'react';
import { FileText, X } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import type { DeliveryState } from '../../lib/projectDelivery';
import { openWorkspace, rememberWorkspace } from '../../lib/workspaceHistory';
import { deliveryStatus } from '../../lib/projectDelivery';
import { DocumentDraftPanel } from './DocumentDraftPanel';

export function documentLocation(projectId:string,documentId:string,reviewId?:string){
  const url=new URL(window.location.href);url.searchParams.set('project',projectId);url.searchParams.delete('artifact');
  if(documentId)url.searchParams.set('document',documentId);else url.searchParams.delete('document');
  if(reviewId)url.searchParams.set('review',reviewId);else url.searchParams.delete('review');
  window.history.replaceState(null,'',url);window.dispatchEvent(new PopStateEvent('popstate'));
}
export function openDocumentPage(projectId:string,documentId:string){const url=new URL(window.location.href);url.searchParams.set('project',projectId);url.searchParams.delete('artifact');url.searchParams.set('document',documentId);url.searchParams.delete('review');url.hash='/project';openWorkspace(url.toString());}
export function DocumentWorkspace({projectId,context='',data,activeId,onSelect,onClose,busy,error,mutate,pt}:{projectId:string;context?:string;data:DeliveryState;activeId:string;onSelect:(id:string)=>void;onClose:()=>void;busy:boolean;error:string;mutate:(action:string,payload:Record<string,unknown>)=>Promise<boolean>;pt:boolean}) {
  const {user}=useAuth(),key=`norte:document-tabs:${user?.id||'anonymous'}:${projectId}`;
  const [openIds,setOpenIds]=useState<string[]>(()=>{try{const saved=JSON.parse(sessionStorage.getItem(key)||'[]');return Array.isArray(saved)?saved.filter(id=>typeof id==='string').slice(-12):[];}catch{return [];}});
  useEffect(()=>{if(activeId)setOpenIds(ids=>ids.includes(activeId)?ids:[...ids,activeId].slice(-12));},[activeId]);
  const tabs=[...new Set([...openIds,activeId])].filter(id=>data.documents.some(item=>item.id===id)).slice(-12);
  const document=data.documents.find(item=>item.id===activeId);
  useEffect(()=>{if(document)rememberWorkspace(document.title,{kind:'document',context,detail:`v${document.version||1} · ${deliveryStatus(document.status,pt)}`});},[document?.id,document?.title,document?.version,document?.status,activeId,context,pt]);
  useEffect(()=>{try{sessionStorage.setItem(key,JSON.stringify(tabs));}catch{/* Draft storage has its own visible failure state. */}},[key,tabs]);
  const select=(id:string)=>{setOpenIds(tabs);onSelect(id);};
  const close=(id:string)=>{const next=tabs.filter(item=>item!==id);setOpenIds(next);if(id===activeId){if(next.length)onSelect(next[next.length-1]);else onClose();}};
  return <div className="document-workspace"><nav className="document-tabs" aria-label={pt?'Documentos abertos':'Open documents'}>{tabs.map(id=>{const item=data.documents.find(candidate=>candidate.id===id)!;return <div className={id===activeId?'active':''} key={id}><button aria-current={id===activeId?'page':undefined} onClick={()=>select(id)} title={item.title}><FileText size={14}/><span>{item.title}</span></button><button aria-label={`${pt?'Fechar aba':'Close tab'} ${item.title}`} onClick={()=>close(id)}><X size={13}/></button></div>;})}</nav>
    {document?<DocumentDraftPanel key={`${user?.id}:${projectId}:${document.id}`} document={document} projectId={projectId} canEdit={document.canEdit??Boolean(data.tasks.find(task=>task.id===document.taskId)?.canEdit)} busy={busy} error={error} pt={pt} members={data.members} mutate={mutate} reviewTitle={data.tasks.find(task=>task.id===document.taskId)?.title||''} onClose={onClose} onSave={body=>mutate('document.save',{id:document.id,item:{version:document.version,body}})}/>:<div className="document-empty"><FileText size={30}/><h3>{pt?'Documento indisponível':'Document unavailable'}</h3><button onClick={onClose}>{pt?'Voltar aos documentos':'Back to documents'}</button></div>}
  </div>;
}
