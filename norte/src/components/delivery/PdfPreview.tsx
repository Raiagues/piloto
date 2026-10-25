import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from 'lucide-react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

export function PdfPreview({source,title,pt}:{source:string;title:string;pt:boolean}) {
  const [pdf,setPdf]=useState<PDFDocumentProxy|null>(null),[page,setPage]=useState(1),[zoom,setZoom]=useState(1),[width,setWidth]=useState(650),[error,setError]=useState(''),[rendering,setRendering]=useState(true);
  const host=useRef<HTMLDivElement>(null),canvas=useRef<HTMLCanvasElement>(null);
  useEffect(()=>{const element=host.current;if(!element)return;const update=()=>setWidth(Math.max(220,element.clientWidth-28));update();const resize=new ResizeObserver(update);resize.observe(element);return()=>resize.disconnect();},[]);
  useEffect(()=>{
    let alive=true,destroy:(()=>Promise<void>)|undefined;setPdf(null);setPage(1);setError('');setRendering(true);
    void import('pdfjs-dist').then(async library=>{if(!alive)return;library.GlobalWorkerOptions.workerSrc=workerUrl;const task=library.getDocument({url:source,withCredentials:true});destroy=()=>task.destroy();const loaded=await task.promise;if(alive)setPdf(loaded);}).catch(()=>{if(alive){setError(pt?'Não foi possível abrir o PDF.':'Unable to open the PDF.');setRendering(false);}});
    return()=>{alive=false;void destroy?.();};
  },[source,pt]);
  useEffect(()=>{
    if(!pdf||!canvas.current)return;let alive=true,cancel:(()=>void)|undefined;setRendering(true);
    void (async()=>{const documentPage=await pdf.getPage(page);if(!alive||!canvas.current)return;const base=documentPage.getViewport({scale:1}),viewport=documentPage.getViewport({scale:width/base.width*zoom}),ratio=Math.min(window.devicePixelRatio||1,2),element=canvas.current;element.width=Math.ceil(viewport.width*ratio);element.height=Math.ceil(viewport.height*ratio);element.style.width=`${viewport.width}px`;element.style.height=`${viewport.height}px`;const task=documentPage.render({canvas:element,viewport,transform:ratio===1?undefined:[ratio,0,0,ratio,0,0]});cancel=()=>task.cancel();await task.promise;if(alive)setRendering(false);})().catch(reason=>{if(alive&&reason?.name!=='RenderingCancelledException'){setError(pt?'Não foi possível exibir esta página.':'Unable to render this page.');setRendering(false);}});
    return()=>{alive=false;cancel?.();};
  },[pdf,page,width,zoom,pt]);
  return <section className="document-pdf-viewer" aria-label={pt?'Prévia do documento':'Document preview'}>
    <div className="document-pdf-controls"><button aria-label={pt?'Página anterior':'Previous page'} disabled={!pdf||page===1} onClick={()=>setPage(value=>value-1)}><ChevronLeft size={15}/></button><span>{page} / {pdf?.numPages||'—'}</span><button aria-label={pt?'Próxima página':'Next page'} disabled={!pdf||page===pdf.numPages} onClick={()=>setPage(value=>value+1)}><ChevronRight size={15}/></button><button aria-label={pt?'Diminuir':'Zoom out'} disabled={zoom<=.7} onClick={()=>setZoom(value=>Math.max(.7,value-.2))}><ZoomOut size={15}/></button><button aria-label={pt?'Ampliar':'Zoom in'} disabled={zoom>=2} onClick={()=>setZoom(value=>Math.min(2,value+.2))}><ZoomIn size={15}/></button></div>
    {error&&<p role="alert">{error} <a href={source} target="_blank" rel="noreferrer">{pt?'Abrir PDF':'Open PDF'} ↗</a></p>}
    <div className="document-pdf-scroll" ref={host} aria-busy={rendering}>{rendering&&<p role="status">{pt?'Preparando página…':'Preparing page…'}</p>}<canvas ref={canvas} hidden={!pdf} aria-label={`${title} · ${pt?'página':'page'} ${page}`}/></div>
  </section>;
}
