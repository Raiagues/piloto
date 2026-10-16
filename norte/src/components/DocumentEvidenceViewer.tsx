import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ExternalLink, FileText, Search, ZoomIn, ZoomOut } from 'lucide-react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { TextItem } from 'pdfjs-dist/types/src/display/api.js';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { API_ORIGIN, useAuth } from '../lib/auth';
import { artifactHref } from '../lib/artifacts';
import type { ConnectedArtifact } from '../lib/team';
import type { EngineeringEvidence } from '../lib/engineeringSystem';
import type { Language } from '../lib/types';
import { evidenceRanges } from '../lib/evidenceHighlight';
import '../evidence-viewer.css';
type PageText = { text: string; items: { item: TextItem; start: number; end: number }[] };
type Box = { left: number; top: number; width: number; height: number; evidence: number };

export function DocumentEvidenceViewer({ evidence, language }: { evidence: EngineeringEvidence[]; language: Language }) {
  const { api } = useAuth(), pt = language === 'pt';
  const [artifacts, setArtifacts] = useState<ConnectedArtifact[]>([]), [active, setActive] = useState(0), [loaded, setLoaded] = useState(false);
  const [pdf, setPdf] = useState<PDFDocumentProxy|null>(null), [page, setPage] = useState(1), [zoom, setZoom] = useState(1);
  const [error, setError] = useState(''), [status, setStatus] = useState(''), [located, setLocated] = useState(false), [boxes, setBoxes] = useState<Box[]>([]);
  const [size, setSize] = useState({ width: 1, height: 1 }), [width, setWidth] = useState(650);
  const host = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null), cache = useRef(new WeakMap<PDFDocumentProxy,Map<number,PageText>>());
  const selected = evidence[active] || evidence[0], artifact = artifacts.find(item => item.id === selected?.artifactId);
  const source = artifact?.contentPath ? artifact.documentText !== undefined ? `${API_ORIGIN}/api/artifacts/${encodeURIComponent(artifact.id)}/pdf` : artifact.mimeType === 'application/pdf' ? artifactHref(artifact) : '' : '';
  const quotes = useMemo(() => evidence.filter(item => item.artifactId === selected?.artifactId), [evidence, selected?.artifactId]);
  useEffect(() => { let alive=true; void api<{artifacts:ConnectedArtifact[]}>('/artifacts').then(result=>{if(alive){setArtifacts(result.artifacts);setLoaded(true);}}).catch(()=>{if(alive)setError(pt?'Você não tem acesso a esta fonte ou ela foi removida.':'This source is unavailable or access was removed.');});return()=>{alive=false;}; },[api,pt]);
  useEffect(()=>{if(active>=evidence.length)setActive(0);},[active,evidence.length]);
  useEffect(()=>{const element=host.current;if(!element)return;const resize=()=>setWidth(Math.max(240,element.clientWidth-24));resize();const observer=new ResizeObserver(resize);observer.observe(element);return()=>observer.disconnect();},[]);
  useEffect(()=>{
    setPdf(null);setBoxes([]);setLocated(false);setPage(1);setError('');
    if(!source)return;
    let alive=true;let destroy:(()=>Promise<void>)|undefined;
    setStatus(pt?'Abrindo documento…':'Opening document…');
    void import('pdfjs-dist').then(async library=>{
      if(!alive)return; library.GlobalWorkerOptions.workerSrc=workerUrl;
      const task=library.getDocument({url:source,withCredentials:true});destroy=()=>task.destroy();
      const document=await task.promise;if(alive){setPdf(document);setStatus('');}
    }).catch(()=>{if(alive){setError(pt?'Não foi possível abrir o documento. Tente novamente ou consulte o original.':'Unable to open the document. Retry or inspect the original.');setStatus('');}});
    return()=>{alive=false;void destroy?.();};
  },[source,pt]);
  async function readPage(document:PDFDocumentProxy,number:number):Promise<PageText>{
    let pages=cache.current.get(document);if(!pages){pages=new Map();cache.current.set(document,pages);}const existing=pages.get(number);if(existing)return existing;
    const content=await (await document.getPage(number)).getTextContent();let text='';const items:PageText['items']=[];
    for(const item of content.items){if(!('str' in item))continue;const start=text.length;text+=item.str;items.push({item,start,end:text.length});text+=item.hasEOL?'\n':' ';}
    const result={text,items};pages.set(number,result);return result;
  }
  useEffect(()=>{
    if(!pdf||!selected)return;let alive=true;setLocated(false);setBoxes([]);setStatus(pt?'Localizando evidência…':'Locating evidence…');
    const hint=Number(selected.locator?.match(/(?:page|página|p\.)\s*(\d+)/i)?.[1]);
    const pages=[...(hint>=1&&hint<=pdf.numPages?[hint]:[]),...Array.from({length:pdf.numPages},(_,index)=>index+1).filter(number=>number!==hint)];
    void (async()=>{for(const number of pages){if(!alive)return;const content=await readPage(pdf,number);if(!alive)return;if(evidenceRanges(content.text,selected.excerpt).length){setPage(number);setLocated(true);setStatus('');return;}}
      if(alive){setPage(hint>=1&&hint<=pdf.numPages?hint:1);setStatus(pt?'Trecho não localizado automaticamente. Confira o documento original.':'Excerpt could not be located automatically. Check the original document.');}
    })().catch(()=>{if(alive)setStatus(pt?'Não foi possível localizar este trecho.':'Unable to locate this excerpt.');});return()=>{alive=false;};
  },[pdf,selected?.id,selected?.excerpt,pt]);
  useEffect(()=>{
    if(!pdf||!canvas.current)return;let alive=true;let cancel:(()=>void)|undefined;setBoxes([]);
    void (async()=>{const pdfPage=await pdf.getPage(page);const library=await import('pdfjs-dist');if(!alive||!canvas.current)return;
      const base=pdfPage.getViewport({scale:1}),viewport=pdfPage.getViewport({scale:width/base.width*zoom});const scale=window.devicePixelRatio||1;
      canvas.current.width=Math.ceil(viewport.width*scale);canvas.current.height=Math.ceil(viewport.height*scale);setSize({width:viewport.width,height:viewport.height});
      const task=pdfPage.render({canvas:canvas.current,viewport,transform:scale===1?undefined:[scale,0,0,scale,0,0]});cancel=()=>task.cancel();await task.promise;
      const content=await readPage(pdf,page);if(!alive)return;const highlights:Box[]=[];
      quotes.forEach(quote=>{const evidenceIndex=evidence.findIndex(item=>item.id===quote.id);for(const range of evidenceRanges(content.text,quote.excerpt)){for(const segment of content.items){const start=Math.max(range.start,segment.start),end=Math.min(range.end,segment.end);if(start>=end||!segment.item.str.length)continue;
        const item=segment.item;const transform=library.Util.transform(viewport.transform,item.transform);const height=Math.hypot(transform[2],transform[3]);const advance=item.width*viewport.scale;
        const fraction=(start-segment.start)/item.str.length,part=(end-start)/item.str.length;
        highlights.push({left:transform[4]+advance*fraction,top:transform[5]-height*.85,width:Math.max(2,advance*part),height:height*1.12,evidence:evidenceIndex});
      }}});setBoxes(highlights);
    })().catch(reason=>{if(alive&&reason?.name!=='RenderingCancelledException')setError(pt?'Não foi possível renderizar esta página.':'Unable to render this page.');});return()=>{alive=false;cancel?.();};
  },[pdf,page,width,zoom,quotes,evidence,selected?.id,pt]);
  useEffect(()=>{const mark=host.current?.querySelector<HTMLElement>('.evidence-mark.active');if(mark&&host.current)host.current.scrollTo({top:Math.max(0,mark.offsetTop-90),left:0,behavior:'instant'});},[boxes,active]);
  return <section className="evidence-document-viewer" aria-label={pt?'Documento com evidências destacadas':'Document with highlighted evidence'}>
    <nav className="evidence-tabs" aria-label={pt?'Evidências':'Evidence'}>{evidence.map((item,index)=><button key={item.id} type="button" aria-pressed={active===index} onClick={()=>setActive(index)} title={item.artifactLabel}><i style={{background:`var(--evidence-${index%4})`}}/>{index+1}<span>{item.artifactLabel}</span></button>)}</nav>
    <div className="evidence-document-toolbar"><FileText size={15}/><strong>{selected?.artifactLabel}</strong>{pdf&&<><button type="button" disabled={page<=1} aria-label={pt?'Página anterior':'Previous page'} onClick={()=>setPage(value=>value-1)}><ChevronLeft size={16}/></button><label><input aria-label={pt?'Página do documento':'Document page'} type="number" min={1} max={pdf.numPages} value={page} onChange={event=>{const number=Number(event.target.value);if(number>=1&&number<=pdf.numPages)setPage(number);}}/> / {pdf.numPages}</label><button type="button" disabled={page>=pdf.numPages} aria-label={pt?'Próxima página':'Next page'} onClick={()=>setPage(value=>value+1)}><ChevronRight size={16}/></button><button type="button" aria-label={pt?'Diminuir documento':'Zoom out'} disabled={zoom<=.7} onClick={()=>setZoom(value=>Math.max(.7,value-.2))}><ZoomOut size={16}/></button><button type="button" aria-label={pt?'Ampliar documento':'Zoom in'} disabled={zoom>=2} onClick={()=>setZoom(value=>Math.min(2,value+.2))}><ZoomIn size={16}/></button></>}</div>
    {status&&<p className="evidence-document-status" role="status"><Search size={14}/>{status}</p>}{error&&<p role="alert">{error}</p>}
    <div ref={host} className="evidence-document-scroll">{pdf&&<div className="evidence-paper" style={{width:size.width,height:size.height}}><canvas ref={canvas} style={{width:size.width,height:size.height}} aria-label={`${selected?.artifactLabel} · ${pt?'página':'page'} ${page}`}/>{boxes.map((box,index)=><span className={`evidence-mark${box.evidence===active?' active':''}`} key={index} style={{left:box.left,top:box.top,width:box.width,height:box.height,background:`var(--evidence-${box.evidence%4})`}} title={`${pt?'Evidência':'Evidence'} ${box.evidence+1}`}/>)}</div>}{!pdf&&<canvas ref={canvas} hidden/>}{loaded&&!artifact&&<div className="evidence-unavailable"><FileText/><p>{selected?.kind==='user'?(pt?'Este registro foi informado pela equipe e não tem documento vinculado.':'This record was entered by the team and has no linked document.'):(pt?'Esta evidência não tem um documento acessível vinculado.':'This evidence has no accessible linked document.')}</p></div>}{artifact&&!source&&<div className="evidence-unavailable"><FileText/><p>{pt?'Este formato ainda não permite destaque no documento.':'This format does not support in-document highlights yet.'}</p></div>}</div>
    <footer>{located&&<span>{pt?'Trecho localizado no documento':'Excerpt located in document'} · {quotes.length} {pt?'evidência(s) nesta fonte':'evidence item(s) in source'}</span>}{artifact&&/^https?:\/\/|^\/api\//.test(artifactHref(artifact))&&<a href={source||artifactHref(artifact)} target="_blank" rel="noreferrer">{pt?'Original':'Original'}<ExternalLink size={13}/></a>}</footer>
  </section>;
}
