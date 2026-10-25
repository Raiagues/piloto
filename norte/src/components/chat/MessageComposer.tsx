import { useLayoutEffect, useRef, useState } from 'react';
import { Camera, ImagePlus, Pencil, Send, X } from 'lucide-react';
import type { ChatAttachment, ChatDraftBlock } from '../../lib/conversations';
import type { Language } from '../../lib/types';
import { ImageSketch, normalizedImage } from './ImageSketch';

const textBlock = (text = ''):ChatDraftBlock => ({id:crypto.randomUUID(),type:'text',text});
type Insertion = {id:string;start:number;end:number};
type Sketch = {initial?:string;editId?:string;insertion?:Insertion};

export function MessageComposer({language,initialBody='',onSend}:{language:Language;initialBody?:string;onSend:(blocks:ChatDraftBlock[],key:string)=>Promise<void>}) {
  const pt=language==='pt';
  const [blocks,setBlocks]=useState<ChatDraftBlock[]>(()=>[textBlock(initialBody)]);
  const [sketch,setSketch]=useState<Sketch|null>(null),[busy,setBusy]=useState(false),[loadingImage,setLoadingImage]=useState(false),[error,setError]=useState('');
  const input=useRef<HTMLInputElement>(null),areas=useRef(new Map<string,HTMLTextAreaElement>());
  const active=useRef<Insertion|null>(null),nextFocus=useRef<string|null>(null),key=useRef(crypto.randomUUID()),sending=useRef(false);
  const pendingImages=useRef(0);
  const imageCount=blocks.filter(block=>block.type==='image').length;
  const characters=blocks.reduce((count,block)=>count+(block.type==='text'?block.text.length:0),0);
  const hasContent=blocks.some(block=>block.type==='image'||block.text.trim());

  useLayoutEffect(()=>{
    for(const area of areas.current.values()){area.style.height='auto';area.style.height=`${Math.min(220,Math.max(38,area.scrollHeight))}px`;}
    if(nextFocus.current){areas.current.get(nextFocus.current)?.focus();nextFocus.current=null;}
  },[blocks]);
  function change(update:(current:ChatDraftBlock[])=>ChatDraftBlock[]){key.current=crypto.randomUUID();setBlocks(update);setError('');}
  function selection():Insertion {
    if(active.current&&blocks.some(block=>block.id===active.current!.id))return {...active.current};
    const last=[...blocks].reverse().find(block=>block.type==='text');
    return {id:last?.id||blocks[0].id,start:last?.type==='text'?last.text.length:0,end:last?.type==='text'?last.text.length:0};
  }
  function remember(area:HTMLTextAreaElement,id:string){active.current={id,start:area.selectionStart,end:area.selectionEnd};}
  function insert(image:ChatAttachment,at:Insertion){
    const after=textBlock(),inserted:ChatDraftBlock={id:crypto.randomUUID(),type:'image',image};
    nextFocus.current=after.id;
    change(current=>{
      const index=current.findIndex(block=>block.id===at.id&&block.type==='text');
      if(index<0)return [...current,inserted,after];
      const target=current[index];if(target.type!=='text')return current;
      return [...current.slice(0,index),{...target,text:target.text.slice(0,at.start)},inserted,{...after,text:target.text.slice(at.end)},...current.slice(index+1)];
    });
    active.current={id:after.id,start:0,end:0};
  }
  function canAddImage(){if(imageCount+pendingImages.current>=6){setError(pt?'Você pode incluir até 6 imagens por mensagem.':'You can include up to 6 images per message.');return false;}return true;}
  async function addImage(blob:Blob,at=selection()){
    if(!canAddImage())return;
    pendingImages.current++;setLoadingImage(true);
    try{const dataUrl=await normalizedImage(blob);insert({dataUrl,name:blob instanceof File?blob.name:'captura.png'},at);}
    catch(reason){setError(reason instanceof Error?reason.message:'Imagem indisponível.');}
    finally{pendingImages.current--;setLoadingImage(pendingImages.current>0);}
  }
  async function capture(){
    if(!canAddImage())return;
    pendingImages.current++;setLoadingImage(true);
    const at=selection();let stream:MediaStream|undefined;
    try{
      stream=await navigator.mediaDevices.getDisplayMedia({video:true,audio:false});
      const video=document.createElement('video');video.srcObject=stream;await video.play();
      await new Promise<void>(resolve=>video.requestVideoFrameCallback(()=>resolve()));
      const canvas=document.createElement('canvas');canvas.width=video.videoWidth;canvas.height=video.videoHeight;
      canvas.getContext('2d')!.drawImage(video,0,0);
      const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/png'));
      if(blob)insert({dataUrl:await normalizedImage(blob),name:'captura.png'},at);
    }catch(reason){if(!(reason instanceof DOMException&&reason.name==='NotAllowedError'))setError(pt?'Não foi possível capturar. Você pode colar uma imagem com Ctrl+V.':'Capture unavailable. Paste an image with Ctrl+V.');}
    finally{stream?.getTracks().forEach(track=>track.stop());pendingImages.current--;setLoadingImage(pendingImages.current>0);}
  }
  function removeImage(id:string){
    change(current=>{
      const index=current.findIndex(block=>block.id===id),before=current[index-1],after=current[index+1];
      if(before?.type==='text'&&after?.type==='text'){
        nextFocus.current=before.id;
        return [...current.slice(0,index-1),{...before,text:[before.text,after.text].filter(Boolean).join('\n')},...current.slice(index+2)];
      }
      return current.filter(block=>block.id!==id);
    });
  }
  async function send(){
    if(sending.current||pendingImages.current||!hasContent)return;
    if(characters>4000){setError(pt?'Use até 4000 caracteres por mensagem.':'Use up to 4000 characters per message.');return;}
    sending.current=true;setBusy(true);setError('');
    try{await onSend(blocks,key.current);const empty=textBlock();setBlocks([empty]);key.current=crypto.randomUUID();active.current=null;nextFocus.current=empty.id;}
    catch(reason){setError(reason instanceof Error?reason.message:(pt?'Não foi possível enviar. Seu rascunho foi mantido.':'Unable to send. Your draft was kept.'));}
    finally{sending.current=false;setBusy(false);}
  }
  return <form className="chat-composer" onSubmit={event=>{event.preventDefault();void send();}}>
    <div className="chat-draft" aria-label={pt?'Mensagem com texto e imagens':'Message with text and images'}>
      {blocks.map((block,index)=>block.type==='text'
        ? <textarea key={block.id} ref={node=>{if(node)areas.current.set(block.id,node);else areas.current.delete(block.id);}} value={block.text} disabled={busy} rows={1} aria-label={index===0?(pt?'Mensagem':'Message'):(pt?'Texto após a imagem':'Text after image')} placeholder={index===0?(pt?'Escreva uma mensagem…':'Write a message…'):(pt?'Continue escrevendo aqui…':'Continue writing here…')}
          onFocus={event=>remember(event.currentTarget,block.id)} onSelect={event=>remember(event.currentTarget,block.id)}
          onPaste={event=>{const image=[...event.clipboardData.files].find(file=>file.type.startsWith('image/'));if(image){event.preventDefault();remember(event.currentTarget,block.id);void addImage(image,selection());}}}
          onChange={event=>{const value=event.currentTarget.value;remember(event.currentTarget,block.id);change(current=>current.map(item=>item.id===block.id&&item.type==='text'?{...item,text:value}:item));}}
          onKeyDown={event=>{if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)&&!event.nativeEvent.isComposing){event.preventDefault();void send();}}}/>
        : <figure key={block.id} className="chat-inline-image"><img src={block.image.dataUrl} alt={block.image.name}/><figcaption><button type="button" disabled={busy} onClick={()=>setSketch({initial:block.image.dataUrl,editId:block.id})}><Pencil size={14}/>{pt?'Anotar imagem':'Annotate image'}</button><button type="button" disabled={busy} aria-label={pt?'Remover imagem':'Remove image'} onClick={()=>removeImage(block.id)}><X size={16}/></button></figcaption></figure>)}
    </div>
    {error&&<p role="alert" className="chat-error">{error}</p>}
    <div className="chat-composer-tools"><div><button type="button" disabled={busy||loadingImage||imageCount>=6} title={pt?'Inserir imagem no texto':'Insert image into text'} onClick={()=>input.current?.click()}><ImagePlus size={17}/><span>{pt?'Imagem':'Image'}</span></button><button type="button" disabled={busy||loadingImage||imageCount>=6} title={pt?'Capturar tela':'Capture screen'} aria-label={pt?'Capturar tela':'Capture screen'} onClick={()=>void capture()}><Camera size={17}/></button><button type="button" disabled={busy||loadingImage||imageCount>=6} title={pt?'Inserir desenho':'Insert sketch'} aria-label={pt?'Inserir desenho':'Insert sketch'} onClick={()=>setSketch({insertion:selection()})}><Pencil size={17}/></button></div><button className="platform-primary" type="submit" data-usage-action="chat.send" disabled={busy||loadingImage||!hasContent||characters>4000} aria-label={pt?'Enviar mensagem':'Send message'}><Send size={16}/>{busy?(pt?'Enviando…':'Sending…'):(pt?'Enviar':'Send')}</button></div>
    <div className="chat-composer-hint"><span>{pt?'Cole imagens com Ctrl+V e escreva entre elas.':'Paste images with Ctrl+V and write between them.'}</span><span>{characters>3500?`${characters}/4000`:'Ctrl+Enter'}</span></div>
    <input type="file" ref={input} accept="image/png,image/jpeg,image/webp" hidden onChange={event=>{const chosen=event.currentTarget.files?.[0];if(chosen)void addImage(chosen);event.currentTarget.value='';}}/>
    {sketch&&<ImageSketch initial={sketch.initial} language={language} onClose={()=>setSketch(null)} onSave={image=>{if(sketch.editId)change(current=>current.map(block=>block.id===sketch.editId&&block.type==='image'?{...block,image}:block));else insert(image,sketch.insertion||selection());setSketch(null);}}/>}
  </form>;
}
