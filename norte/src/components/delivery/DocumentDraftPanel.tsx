import { useState } from 'react';
import { ArrowLeft, Columns2, Code2, Download, ExternalLink, Eye, FileText, Save } from 'lucide-react';
import { API_ORIGIN, useAuth } from '../../lib/auth';
import type { DeliveryDocument, DeliveryPerson } from '../../lib/projectDelivery';
import { PdfPreview } from './PdfPreview';
import { DocumentBasis } from './DocumentBasis';
import { DeliverySelect } from './DeliveryShared';
import '../../styles/document-library.css';

export function DocumentText({body}:{body:string}) {
  const lines=body.split('\n');
  const rows:React.ReactNode[]=[];
  const cells=(line:string)=>line.trim().replace(/^\|/,'').replace(/\|$/,'').split('|').map(value=>value.trim());
  for(let index=0;index<lines.length;index++){
    const line=lines[index],key=index;
    if(line.trim().startsWith('|')&&/^\|?\s*:?-+/.test(lines[index+1]?.trim()||'')){
      const head=cells(line),content:string[][]=[];index+=2;
      while(index<lines.length&&lines[index].trim().startsWith('|')){content.push(cells(lines[index]));index++;}index--;
      rows.push(<div className="document-table-scroll" key={key}><table><thead><tr>{head.map((cell,i)=><th key={i}>{cell}</th>)}</tr></thead><tbody>{content.map((row,i)=><tr key={i}>{head.map((_,j)=><td key={j}>{row[j]||''}</td>)}</tr>)}</tbody></table></div>);continue;
    }
    if(line.startsWith('# '))rows.push(<h1 key={key}>{line.slice(2)}</h1>);
    else if(line.startsWith('## '))rows.push(<h2 key={key}>{line.slice(3)}</h2>);
    else if(line.startsWith('### '))rows.push(<h3 key={key}>{line.slice(4)}</h3>);
    else if(/^https:\/\//.test(line))rows.push(<p key={key}><a href={line} target="_blank" rel="noreferrer">{line}</a></p>);
    else if(line.startsWith('- '))rows.push(<p className="document-bullet" key={key}>{line.slice(2)}</p>);
    else rows.push(line.trim()?<p key={key}>{line}</p>:<div key={key} className="document-line-gap"/>);
  }
  return <div className="document-reading">{rows}</div>;
}
type Draft = {body:string;baseBody:string;baseVersion:number};
function readDraft(key:string,document:DeliveryDocument):Draft {
  try {const value=JSON.parse(sessionStorage.getItem(key)||'null');if(value&&typeof value.body==='string'&&typeof value.baseBody==='string'&&Number.isInteger(value.baseVersion))return value;}catch{/* Optional tab storage. */}
  return {body:document.body,baseBody:document.body,baseVersion:document.version};
}
export function DocumentDraftPanel({document,projectId,canEdit,busy,error,pt,onClose,onSave,members=[],mutate,reviewTitle=''}:{document:DeliveryDocument;projectId:string;canEdit:boolean;busy:boolean;error:string;pt:boolean;onClose:()=>void;onSave:(body:string)=>Promise<boolean>;members?:DeliveryPerson[];mutate?:(action:string,payload:Record<string,unknown>)=>Promise<boolean>;reviewTitle?:string}) {
  const {user}=useAuth();
  const draftKey=`norte:document-draft:${user?.id||'anonymous'}:${projectId}:${document.id}`;
  const [draft,setDraft]=useState(()=>readDraft(draftKey,document)),[storageError,setStorageError]=useState(false);
  const [mode,setMode]=useState<'split'|'code'|'read'|'pdf'>(canEdit?'split':'read');
  const [exporting,setExporting]=useState(false),[exportError,setExportError]=useState('');
  const [reviewers,setReviewers]=useState<string[]>([]),[comment,setComment]=useState('');
  const body=draft.body,changed=body!==draft.baseBody,stale=document.version!==draft.baseVersion;
  const endpoint=`${API_ORIGIN}/api/projects/${encodeURIComponent(projectId)}/delivery/documents/${encodeURIComponent(document.id)}/export`;
  function update(next:Draft){setDraft(next);try{if(next.body===next.baseBody)sessionStorage.removeItem(draftKey);else sessionStorage.setItem(draftKey,JSON.stringify(next));setStorageError(false);}catch{setStorageError(true);}}
  async function save(){if(await onSave(body))update({body,baseBody:body,baseVersion:document.version+1});}
  async function sendToOverleaf(){
    setExporting(true);setExportError('');
    try{const response=await fetch(`${endpoint}?format=latex`,{credentials:'include'});if(!response.ok)throw new Error(pt?'Não foi possível exportar a versão salva.':'Could not export the saved version.');const blob=await response.blob();const data=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error(pt?'Não foi possível ler a exportação.':'Could not read the export.'));reader.readAsDataURL(blob);});const form=window.document.createElement('form');form.action='https://www.overleaf.com/docs';form.method='POST';form.target='_blank';form.rel='noopener noreferrer';const input=window.document.createElement('input');input.type='hidden';input.name='snip_uri';input.value=data;form.append(input);form.hidden=true;window.document.body.append(form);form.submit();form.remove();}
    catch(reason){setExportError(reason instanceof Error?reason.message:'Export failed.');}finally{setExporting(false);}
  }
  return <section className="document-editor-workspace" aria-label={pt?'Área de trabalho do documento':'Document workspace'}>
    <header className="document-editor-heading"><button onClick={onClose} aria-label={pt?'Voltar aos documentos':'Back to documents'}><ArrowLeft size={16}/></button><div><h2>{document.title}</h2><div className="document-draft-meta"><span>{document.id} · v{document.version}</span><span className={`delivery-badge ${document.status}`}>{document.status==='approved'?(pt?'Aprovado':'Approved'):document.status==='in_review'?(pt?'Em revisão':'In review'):(pt?'Rascunho':'Draft')}</span>{changed&&<small>{storageError?(pt?'Rascunho somente nesta tela':'Draft only on this screen'):(pt?'Rascunho preservado nesta aba':'Draft kept in this browser tab')}</small>}</div></div>{canEdit&&<button className="primary" disabled={busy||stale||!changed||!body.trim()} onClick={()=>void save()}><Save size={15}/>{pt?'Salvar versão':'Save version'}</button>}</header>
    <div className="document-view-toolbar"><div>{canEdit&&<><button aria-pressed={mode==='split'} onClick={()=>setMode('split')}><Columns2 size={15}/>{pt?'Editor e prévia':'Editor and preview'}</button><button aria-pressed={mode==='code'} onClick={()=>setMode('code')}><Code2 size={15}/>{pt?'Código':'Source'}</button></>}<button aria-pressed={mode==='read'} onClick={()=>setMode('read')}><FileText size={15}/>{pt?'Leitura':'Read'}</button><button aria-pressed={mode==='pdf'} onClick={()=>setMode('pdf')}><Eye size={15}/>{pt?'PDF salvo':'Saved PDF'}</button></div><div><a href={endpoint} download><Code2 size={15}/>.md</a><a href={`${endpoint}?format=pdf`}><Download size={15}/>PDF</a><a href={`${endpoint}?format=latex`}><Download size={15}/>LaTeX ZIP</a></div></div>
    {changed&&<p className="document-export-note">{pt?'As exportações usam a versão salva.':'Exports use the saved version.'}</p>}
    {stale&&<div className="delivery-error" role="alert"><span>{pt?'O documento tem uma versão mais recente. Seu rascunho foi preservado; copie o que deseja manter antes de carregar a versão atual.':'A newer version exists. Your draft is preserved; copy what you need before loading the current version.'}</span><button onClick={()=>update({body:document.body,baseBody:document.body,baseVersion:document.version})}>{pt?'Usar versão atual':'Use current version'}</button></div>}
    {storageError&&changed&&<p role="alert">{pt?'O navegador não conseguiu preservar o rascunho. Salve antes de sair desta tela.':'The browser could not preserve this draft. Save before leaving this screen.'}</p>}
    {mode==='pdf'?<div className="document-pdf-preview">{changed&&<p>{pt?'Este PDF corresponde à versão salva. A prévia do editor acompanha seu rascunho.':'This PDF represents the saved version. The editor preview follows your draft.'}</p>}<PdfPreview key={document.version} title={document.title} pt={pt} source={`${endpoint}?format=pdf&inline=1`}/></div>:<div className={`document-edit-panes mode-${mode}`}>
      {(mode==='split'||mode==='code')&&<section className="document-code-pane"><header>{pt?'Código Markdown':'Markdown source'}</header><textarea className="delivery-document-editor" aria-label={pt?'Conteúdo do documento':'Document content'} value={body} readOnly={!canEdit} spellCheck={false} maxLength={150000} onChange={event=>update({...draft,body:event.target.value})}/></section>}
      {(mode==='split'||mode==='read')&&<section className="document-preview-pane"><header>{pt?'Prévia do rascunho':'Draft preview'}</header><DocumentText body={body}/></section>}
    </div>}
    <details className="document-export-options"><summary>{pt?'Continuar no Overleaf':'Continue in Overleaf'}</summary><p>{pt?'Envia uma cópia da versão salva para overleaf.com. As alterações feitas lá não são sincronizadas com o Norte.':'Sends a copy of the saved version to overleaf.com. Changes there are not synchronized with Norte.'}</p><button disabled={exporting||changed||stale} onClick={()=>void sendToOverleaf()}><ExternalLink size={15}/>{exporting?(pt?'Preparando cópia…':'Preparing copy…'):(pt?'Enviar cópia ao Overleaf':'Send copy to Overleaf')}</button>{changed&&<small>{pt?'Salve sua versão para enviar.':'Save your version before sending.'}</small>}{exportError&&<p role="alert">{exportError}</p>}</details>
    <DocumentBasis document={document} reviewTitle={reviewTitle} pt={pt}/>
    {mutate&&<details className="document-review"><summary>{pt?'Revisão da equipe':'Team review'}</summary>
      {document.decisions?.map(decision=><p key={decision.userId}><strong>{decision.authorName}</strong> · {decision.decision==='approve'?(pt?'Aprovado':'Approved'):(pt?'Alterações solicitadas':'Changes requested')}<small>{decision.comment}</small></p>)}
      {canEdit&&!changed&&!stale&&document.status!=='approved'&&<><DeliverySelect label={pt?'Revisores independentes':'Independent reviewers'} choices={members.filter(member=>member.canReview&&!member.isFictionalProfile&&member.id!==document.authorId&&member.id!==user?.id).map(member=>({id:member.id,label:member.name}))} selected={reviewers} onChange={setReviewers}/><button disabled={busy||!reviewers.length} onClick={()=>void mutate('document.request_review',{id:document.id,reviewers})}>{pt?'Solicitar revisão':'Request review'}</button></>}
      {document.canReview&&!changed&&!stale&&<><label>{pt?'Parecer':'Review comment'}<textarea value={comment} maxLength={2000} onChange={event=>setComment(event.target.value)}/></label><div className="delivery-actions"><button disabled={busy} onClick={()=>void mutate('document.review',{id:document.id,decision:'approve',comment,version:document.version})}>{pt?'Aprovar versão':'Approve version'}</button><button disabled={busy||!comment.trim()} onClick={()=>void mutate('document.review',{id:document.id,decision:'request_changes',comment,version:document.version})}>{pt?'Solicitar alterações':'Request changes'}</button></div></>}
    </details>}
    {error&&<p role="alert" className="delivery-inline-error">{error}</p>}
  </section>;
}
