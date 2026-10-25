import { useEffect, useState } from 'react';
import { FileText, Plus, Sparkles } from 'lucide-react';
import { reviewDocuments } from '../../../shared/delivery-lifecycle.mjs';
import type { DeliveryState,DeliveryTask,DeliveryDocumentOption } from '../../lib/projectDelivery';
import { useAuth } from '../../lib/auth';
import { useEngineeringAssistant } from '../../lib/engineeringAssistant';
import { DocumentText } from './DocumentDraftPanel';
import { openDocumentPage } from './DocumentWorkspace';
import { DocumentBasis } from './DocumentBasis';
import '../../styles/document-library.css';

export function ReviewDocuments({projectId,data,task,busy,mutate,pt,compact=false,error='',onOpenDocument}:{projectId:string;data:DeliveryState;task:DeliveryTask;busy:boolean;mutate:(action:string,payload:Record<string,unknown>)=>Promise<boolean>;pt:boolean;compact?:boolean;error?:string;onOpenDocument?:(id:string)=>void}) {
  const {user}=useAuth(),draftKey=`norte:document-generation:${user?.id||'anonymous'}:${projectId}:${task.id}`;
  const [restored]=useState(()=>{try{return JSON.parse(sessionStorage.getItem(draftKey)||'null') as {open?:boolean;profile?:string;templateId?:string;body?:string;title?:string;suggestionRunId?:string}|null;}catch{return null;}});
  const [generating,setGenerating]=useState(Boolean(restored?.open)),[profile,setProfile]=useState(restored?.profile||task.lifecycleProfile||data.lifecycle?.profile||'nasa'),[templateId,setTemplateId]=useState(restored?.templateId||''),[body,setBody]=useState(restored?.body||''),[title,setTitle]=useState(restored?.title||''),[suggestionRunId,setSuggestionRunId]=useState(restored?.suggestionRunId||'');
  useEffect(()=>{try{if(body||generating)sessionStorage.setItem(draftKey,JSON.stringify({open:generating,profile,templateId,body,title,suggestionRunId}));else sessionStorage.removeItem(draftKey);}catch{/* The generated text stays available to copy on this screen. */}},[draftKey,generating,profile,templateId,body,title,suggestionRunId]);
  const [pendingTemplate,setPendingTemplate]=useState('');
  const assistant=useEngineeringAssistant(projectId);
  const options=reviewDocuments(profile,task.reviewCode||'') as DeliveryDocumentOption[];
  const open=(id:string)=>onOpenDocument?onOpenDocument(id):openDocumentPage(projectId,id);
  const prepared=data.documents.filter(item=>item.taskId===task.id);
  useEffect(()=>{const created=prepared.find(item=>item.templateId===pendingTemplate);if(created){setPendingTemplate('');if(onOpenDocument)onOpenDocument(created.id);else openDocumentPage(projectId,created.id);}},[pendingTemplate,prepared,onOpenDocument,projectId]);
  useEffect(()=>{
    const draft=assistant.run?.result?.documentDraft;
    if(draft){setBody(draft.body);setTitle(draft.title);setSuggestionRunId(assistant.run?.id||'');}
  },[assistant.run?.id,assistant.run?.result]);
  function openGenerator(option?:DeliveryDocumentOption){setTemplateId(option?.id||options[0]?.id||'');setBody('');setTitle('');setSuggestionRunId('');assistant.clear();setGenerating(true);}
  return <section className="review-documents">
    <div className="document-package-heading">{!compact&&<h3>{pt?'Documentos da revisão':'Review documents'}</h3>}{task.canEdit&&<button onClick={()=>openGenerator()}><Sparkles size={14}/>{pt?'Rascunho com IA':'AI draft'}</button>}</div>
    {['input','output'].map(flow=>{
      const selected=task.documentOptions?.filter(option=>option.flow===flow)||[];
      return selected.length?<div key={flow}><h4>{flow==='input'?(pt?'Preparar para a revisão':'Prepare for review'):(pt?'Registrar após a revisão':'Record after review')}</h4>{selected.map(option=>{
        const saved=prepared.find(item=>item.templateId===option.id);
        return <article className="review-document" key={option.id}><FileText size={17}/><div><strong>{option.code} · {option.title}</strong>{option.reference&&<a href={option.reference.url} target="_blank" rel="noreferrer">{option.reference.section} ↗</a>}</div>{saved?<button onClick={()=>open(saved.id)}>{pt?'Abrir':'Open'} · v{saved.version}</button>:task.canEdit&&<button disabled={busy} onClick={async()=>{if(await mutate('document.prepare',{taskId:task.id,templateId:option.id}))setPendingTemplate(option.id);}}><Plus size={13}/>{pt?'Preparar':'Prepare'}</button>}</article>;
      })}</div>:null;
    })}
    {prepared.filter(item=>!task.documentOptions?.some(option=>option.id===item.templateId)).map(saved=><article className="review-document" key={saved.id}><FileText size={17}/><div><strong>{saved.title}</strong></div><button onClick={()=>open(saved.id)}>{pt?'Abrir':'Open'} · v{saved.version}</button></article>)}
    {!task.documentOptions?.length&&!prepared.length&&<p className="delivery-note">{pt?'Escolha um modelo para preparar o primeiro documento.':'Choose a template to prepare the first document.'}</p>}
    {generating&&<section className="document-generation document-draft-content" aria-label={pt?'Preparar documento com IA':'Prepare document with AI'}><p>{task.title}</p><div className="delivery-form-grid"><label>{pt?'Formato de referência':'Reference format'}<select disabled={assistant.running} value={profile} onChange={event=>{setProfile(event.target.value);setTemplateId('');setBody('');}}><option value="nasa">NASA</option><option value="ecss">ECSS</option><option value="custom">{pt?'Personalizado':'Custom'}</option></select></label><label>{pt?'Documento':'Document'}<select disabled={assistant.running} value={templateId} onChange={event=>{setTemplateId(event.target.value);setBody('');}}><option value="">{pt?'Selecionar modelo':'Choose template'}</option>{options.map(option=><option key={option.id} value={option.id}>{option.code} · {option.title}</option>)}</select></label></div>
        {options.find(option=>option.id===templateId)&&<DocumentBasis document={options.find(option=>option.id===templateId)!} reviewTitle={task.title} pt={pt}/>}
        <button data-usage-action="documents.generate" className="primary" disabled={assistant.running||!templateId} onClick={()=>{setBody('');void assistant.start('document',{taskId:task.id,templateId,profile});}}><Sparkles size={15}/>{assistant.running?(pt?'Preparando…':'Preparing…'):(pt?'Gerar rascunho com IA':'Generate AI draft')}</button>
        {assistant.run&&<ol className="document-run-log" aria-label={pt?'Atividade da análise':'Analysis activity'} aria-live="polite">{assistant.run.events.map((event,index)=><li key={index}><time>{new Date(event.at).toLocaleTimeString(pt?'pt-BR':'en-US',{hour:'2-digit',minute:'2-digit'})}</time><span>{event.message}</span></li>)}</ol>}
        {(assistant.error||assistant.run?.error)&&<p role="alert" className="delivery-inline-error">{assistant.error||assistant.run?.error}</p>}
        {body&&<><label>{pt?'Título':'Title'}<input value={title} maxLength={200} onChange={event=>setTitle(event.target.value)}/></label><div className="document-edit-panes mode-split"><section className="document-code-pane"><header>{pt?'Código Markdown':'Markdown source'}</header><textarea className="delivery-document-editor" aria-label={pt?'Revisar rascunho':'Review draft'} value={body} maxLength={150000} onChange={event=>setBody(event.target.value)}/></section><section className="document-preview-pane"><header>{pt?'Prévia do rascunho':'Draft preview'}</header><DocumentText body={body}/></section></div><p className="delivery-note">{pt?'Revise o conteúdo antes de salvar. A aprovação é feita por outra pessoa da equipe.':'Review the content before saving. Approval belongs to another team member.'}</p></>}
        {error&&<p role="alert" className="delivery-inline-error">{error}</p>}
        <footer><button onClick={()=>setGenerating(false)}>{pt?'Fechar':'Close'}</button>{body&&<button className="primary" disabled={busy||assistant.running||!body.trim()} onClick={async()=>{if(await mutate('document.save',{suggestionRunId:suggestionRunId||undefined,item:{taskId:task.id,templateId,profile,body,title}})){setPendingTemplate(templateId);setBody('');setTitle('');setSuggestionRunId('');setGenerating(false);}}}>{pt?'Salvar rascunho':'Save draft'}</button>}</footer>
    </section>}
  </section>;
}
