import { useCallback, useEffect, useRef, useState } from 'react';
import { CalendarDays, FileText, Folder, FolderOpen, ListChecks, Search, Sheet, Upload, ExternalLink, Plus, FileCheck2, Download, ArrowLeft } from 'lucide-react';
import { API_ORIGIN, useAuth } from '../lib/auth';
import { artifactHref } from '../lib/artifacts';
import type { ConnectedArtifact } from '../lib/team';
import type { MeetingSummary } from '../lib/meetings';
import type { MissionProject } from '../lib/projectStore';
import type { Language } from '../lib/types';
import type { RailNavigation } from '../components/ProjectHeader';
import { ProjectAreaShell } from '../components/ProjectAreaShell';
import { useProjectDelivery, deliveryStatus } from '../lib/projectDelivery';
import { DeliveryAlert } from '../components/delivery/DeliveryShared';
import { DocumentWorkspace, documentLocation } from '../components/delivery/DocumentWorkspace';
import { PdfPreview } from '../components/delivery/PdfPreview';
import { ReviewDocumentWorkspace } from '../components/delivery/ReviewDocumentWorkspace';
import '../styles/document-library.css';

type Category='all'|'minutes'|'matrices'|'plans'|'schedules'|'requirements'|'sources';
const categories=[{id:'all',pt:'Todos',en:'All',icon:FolderOpen},{id:'minutes',pt:'Atas de reuniões',en:'Meeting minutes',icon:FileText},{id:'matrices',pt:'Matrizes',en:'Matrices',icon:Sheet},{id:'plans',pt:'Planos',en:'Plans',icon:ListChecks},{id:'schedules',pt:'Cronogramas',en:'Schedules',icon:CalendarDays},{id:'requirements',pt:'Especificações',en:'Specifications',icon:FileCheck2},{id:'sources',pt:'Fontes',en:'Sources',icon:Folder}] as const;
function categoryOf(name:string):Category {
  const value=name.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase();
  if(/\bata\b|minutes|reuniao/.test(value))return 'minutes';
  if(/matri[cz]|traceab|rastreab|\brtm\b|\bvcd\b/.test(value))return 'matrices';
  if(/cronograma|schedule/.test(value))return 'schedules';
  if(/plano|\bplan\b|\bsemp\b|\bsep\b/.test(value))return 'plans';
  if(/especifica|requirement|requisito|\breq\b/.test(value))return 'requirements';
  return 'sources';
}
function SourcePreview({artifact,pt,onClose}:{artifact:ConnectedArtifact;pt:boolean;onClose:()=>void}) {
  const [text,setText]=useState(''),[error,setError]=useState('');
  const source=artifact.documentText!==undefined?`${API_ORIGIN}/api/artifacts/${encodeURIComponent(artifact.id)}/pdf`:artifactHref(artifact);
  const pdf=artifact.documentText!==undefined||artifact.mimeType==='application/pdf';
  useEffect(()=>{
    if(!artifact.contentPath||!artifact.mimeType?.startsWith('text/'))return;
    let alive=true;void fetch(source,{credentials:'include'}).then(response=>{if(!response.ok)throw new Error('Documento indisponível.');return response.text();}).then(value=>{if(alive)setText(value);}).catch(reason=>{if(alive)setError(reason.message);});return()=>{alive=false;};
  },[artifact.contentPath,artifact.mimeType,source]);
  return <section className="document-source-workspace"><header className="document-editor-heading"><button onClick={onClose} aria-label={pt?'Voltar aos documentos':'Back to documents'}><ArrowLeft size={16}/></button><h2>{artifact.label}</h2></header><div className="document-draft-content"><div className="document-source-preview">{pdf&&(artifact.contentPath||artifact.documentText!==undefined)?<PdfPreview title={artifact.label} source={source} pt={pt}/>:artifact.contentPath&&artifact.mimeType?.startsWith('image/')?<img src={source} alt={artifact.label}/>:text?<pre>{text}</pre>:<div className="document-empty"><FileText size={32}/><p>{pt?'Consulte o arquivo no formato original.':'Open the file in its original format.'}</p></div>}{error&&<p role="alert">{error}</p>}</div><footer><a href={`${source}${artifact.contentPath?'?download=1':''}`} target="_blank" rel="noreferrer"><Download size={15}/>{pt?'Abrir original':'Open original'}</a></footer></div></section>;
}

export function DocumentsPage({language,project,navigation}:{language:Language;project:MissionProject;navigation:RailNavigation}) {
  const pt=language==='pt',{api}=useAuth(),{data,busy,error,refresh,mutate}=useProjectDelivery(project.id);
  const [artifacts,setArtifacts]=useState<ConnectedArtifact[]>([]),[meetings,setMeetings]=useState<MeetingSummary[]>([]),[folder,setFolder]=useState<Category>('all'),[query,setQuery]=useState(''),[selected,setSelected]=useState(()=>new URL(window.location.href).searchParams.get('document')||''),[sourceId,setSourceId]=useState(()=>new URL(window.location.href).searchParams.get('artifact')||''),[packageOpen,setPackageOpen]=useState(()=>new URL(window.location.href).searchParams.has('review')),[uploading,setUploading]=useState(false),[uploadSector,setUploadSector]=useState(''),[localError,setLocalError]=useState('');
  const file=useRef<HTMLInputElement>(null);
  const loadSources=useCallback(async()=>{
    const [sources,rooms]=await Promise.all([api<{artifacts:ConnectedArtifact[]}>('/artifacts'),api<{meetings:MeetingSummary[]}>('/meetings')]);
    const ids=new Set([...(project.context.projectArtifactIds||[]),...(project.context.teamArtifactIds||[]),...(project.context.programArtifactIds||[])]);
    setArtifacts(sources.artifacts.filter(artifact=>(artifact.scope==='project'&&artifact.ownerId===project.id)||ids.has(artifact.id)));
    setMeetings(rooms.meetings.filter(meeting=>meeting.projectId===project.id&&!meeting.example));
  },[api,project.id,project.context.projectArtifactIds,project.context.teamArtifactIds,project.context.programArtifactIds]);
  useEffect(()=>{void loadSources().catch(reason=>setLocalError(reason.message));},[loadSources]);
  const documents=data?.documents||[],chosenSource=artifacts.find(artifact=>artifact.id===sourceId);
  const selectDocument=(id:string)=>{setSelected(id);setSourceId('');setPackageOpen(false);documentLocation(project.id,id);};
  const selectSource=(id:string)=>{setSelected('');setSourceId(id);setPackageOpen(false);const url=new URL(window.location.href);url.searchParams.set('project',project.id);url.searchParams.delete('document');if(id)url.searchParams.set('artifact',id);else url.searchParams.delete('artifact');window.history.replaceState(null,'',url);window.dispatchEvent(new PopStateEvent('popstate'));};
  useEffect(()=>{const restore=()=>{const url=new URL(window.location.href);setSelected(url.searchParams.has('review')?'':url.searchParams.get('document')||'');setSourceId(url.searchParams.get('artifact')||'');setPackageOpen(url.searchParams.has('review'));};window.addEventListener('popstate',restore);return()=>window.removeEventListener('popstate',restore);},[]);
  const items=[...documents.map(document=>({id:document.id,title:document.title,category:categoryOf(`${document.templateId} ${document.title}`),kind:'draft' as const,meta:`v${document.version} · ${deliveryStatus(document.status,pt)}`,review:data?.tasks.find(task=>task.id===document.taskId)?.title||''})),...artifacts.map(artifact=>({id:artifact.id,title:artifact.label,category:categoryOf(`${artifact.label} ${artifact.tags.join(' ')}`),kind:'source' as const,meta:artifact.fileName||artifact.mimeType||'',review:''})),...meetings.map(meeting=>({id:meeting.id,title:meeting.title,category:'minutes' as const,kind:'meeting' as const,meta:pt?'Ata e registros da reunião':'Meeting minutes and records',review:''}))];
  const filtered=items.filter(item=>(folder==='all'||item.category===folder)&&`${item.title} ${item.meta} ${item.review}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  useEffect(()=>{if(chosenSource)window.dispatchEvent(new CustomEvent('norte:workspace-item',{detail:{label:chosenSource.label,href:window.location.pathname+window.location.search+window.location.hash}}));},[chosenSource]);
  const editable=data?.permissions.manage||Boolean(data?.permissions.editableSectorIds.length);
  async function upload(chosen:File){
    if(chosen.size>48*1024*1024){setLocalError(pt?'Escolha um arquivo de até 48 MB.':'Choose a file up to 48 MB.');return;}
    setUploading(true);setLocalError('');
    try{
      const mimeType=chosen.type||({pdf:'application/pdf',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',txt:'text/plain',md:'text/markdown',csv:'text/csv',json:'application/json',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg'} as Record<string,string>)[chosen.name.split('.').pop()?.toLowerCase()||''];
      if(!mimeType)throw new Error(pt?'Formato de arquivo não reconhecido.':'Unrecognized file format.');
      const raw=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error(pt?'Não foi possível ler o arquivo.':'Could not read the file.'));reader.readAsDataURL(chosen);});
      const url=raw.replace(/^data:[^;]*;base64,/,`data:${mimeType};base64,`);
      await api('/artifacts',{method:'POST',body:JSON.stringify({kind:'document',scope:'project',ownerId:project.id,label:chosen.name.replace(/\.[^.]+$/,''),url,fileName:chosen.name,mimeType,folderId:uploadSector||(!data?.permissions.manage?data?.permissions.editableSectorIds[0]:null),size:chosen.size,description:'',tags:[],sourceRole:'project_context'})});
      await loadSources();await refresh();
    }catch(reason){setLocalError(reason instanceof Error?reason.message:'Falha ao adicionar arquivo.');}
    finally{setUploading(false);}
  }
  return <ProjectAreaShell language={language} project={project} area="documents" navigation={navigation}>
    <div className="document-library"><DeliveryAlert error={error||localError} refresh={()=>{void refresh();void loadSources();}} pt={pt}/>
      <div className="document-library-toolbar">{(selected||chosenSource||packageOpen)?<button onClick={()=>{selectDocument('');selectSource('');}}><ArrowLeft size={15}/>{pt?'Biblioteca':'Library'}</button>:<label><Search size={16}/><input type="search" value={query} onChange={event=>setQuery(event.target.value)} aria-label={pt?'Buscar documento':'Search documents'} placeholder={pt?'Buscar documento ou revisão':'Search documents or reviews'}/></label>}<div>{editable&&Boolean(data?.sectors.length)&&<select aria-label={pt?'Setor do arquivo':'File sector'} value={uploadSector||(!data?.permissions.manage?data?.permissions.editableSectorIds[0]:'')} onChange={event=>setUploadSector(event.target.value)}>{data?.permissions.manage&&<option value="">{pt?'Projeto':'Project'}</option>}{data?.sectors.filter(sector=>data.permissions.manage||data.permissions.editableSectorIds.includes(sector.id)).map(sector=><option key={sector.id} value={sector.id}>{sector.name}</option>)}</select>}{editable&&<button disabled={uploading} onClick={()=>file.current?.click()}><Upload size={15}/>{uploading?(pt?'Adicionando…':'Uploading…'):(pt?'Adicionar arquivo':'Add file')}</button>}<button onClick={()=>{selectDocument('');selectSource('');setPackageOpen(true);}}><Plus size={15}/>{pt?'Documentos por revisão':'Review documents'}</button></div><input type="file" ref={file} hidden accept=".pdf,.docx,.txt,.md,.csv,.json,.png,.jpg,.jpeg" onChange={event=>{const chosen=event.currentTarget.files?.[0];if(chosen)void upload(chosen);event.currentTarget.value='';}}/></div>
      {!selected&&!chosenSource&&!packageOpen&&<div className="document-library-layout"><aside className="document-folders" aria-label={pt?'Pastas de documentos':'Document folders'}>{categories.map(category=><button key={category.id} aria-pressed={folder===category.id} onClick={()=>setFolder(category.id)}><category.icon size={17}/><span>{pt?category.pt:category.en}</span><small>{category.id==='all'?items.length:items.filter(item=>item.category===category.id).length}</small></button>)}</aside>
        <section className="document-library-content"><header><FolderOpen size={18}/><h2>{categories.find(category=>category.id===folder)?.[pt?'pt':'en']}</h2><small>{filtered.length}</small></header>
          {filtered.length?<div className="document-card-grid">{filtered.map(item=><button data-usage-action="documents.preview" className="document-card" key={`${item.kind}:${item.id}`} onClick={()=>{if(item.kind==='draft')selectDocument(item.id);else if(item.kind==='source')selectSource(item.id);else{const url=new URL(window.location.href);url.searchParams.set('project',project.id);url.searchParams.set('meeting',item.id);url.searchParams.delete('document');url.searchParams.delete('artifact');url.hash='/meetings';window.location.assign(url.toString());}}}><span className={`document-card-symbol ${item.category}`}>{item.category==='matrices'?<Sheet size={26}/>:item.category==='schedules'?<CalendarDays size={26}/>:<FileText size={26}/>}</span><strong>{item.title}</strong><small>{item.meta}</small>{item.review&&<span className="document-card-review">{item.review}</span>}<span className="document-card-open">{pt?'Abrir':'Open'} <ExternalLink size={12}/></span></button>)}</div>:<div className="document-empty"><FolderOpen size={36}/><h3>{query?(pt?'Nenhum documento encontrado':'No matching documents'):(pt?'Esta pasta está vazia':'This folder is empty')}</h3><p>{query?(pt?'Tente outro nome ou revisão.':'Try another name or review.'):(pt?'Adicione arquivos ou prepare os documentos de uma revisão.':'Add files or prepare documents for a review.')}</p></div>}
        </section>
      </div>}
      {chosenSource&&<SourcePreview key={chosenSource.id} artifact={chosenSource} pt={pt} onClose={()=>selectSource('')}/>}
      {selected&&data&&<DocumentWorkspace projectId={project.id} data={data} activeId={selected} onSelect={selectDocument} onClose={()=>selectDocument('')} busy={busy} error={error} mutate={mutate} pt={pt}/>}
      {packageOpen&&data&&<ReviewDocumentWorkspace projectId={project.id} data={data} busy={busy} error={error} mutate={mutate} pt={pt}/>}
    </div>
  </ProjectAreaShell>;
}
