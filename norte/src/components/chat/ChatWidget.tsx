import { useEffect, useRef, useState } from 'react';
import { GripHorizontal, HelpCircle, MessageSquare, Minus, X, Maximize2, ShieldCheck } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import type { Language } from '../../lib/types';
import type { Conversation } from '../../lib/conversations';
import { ConversationThread } from './ConversationThread';
import '../../styles/features/chat.css';
export function ChatWidget({language}:{language:Language}) {
  const {api,user}=useAuth(),pt=language==='pt';
  const [messagesPage,setMessagesPage]=useState(()=>window.location.hash.startsWith('#/messages'));
  const [open,setOpen]=useState(false),[conversation,setConversation]=useState<Conversation|null>(null),[error,setError]=useState(''),[tutorial,setTutorial]=useState(false),[position,setPosition]=useState<{x:number;y:number}|null>(null);
  const drag=useRef<{x:number;y:number;left:number;top:number}|null>(null),panel=useRef<HTMLElement>(null),loadId=useRef(0);
  useEffect(()=>{const navigate=()=>{const showing=window.location.hash.startsWith('#/messages');setMessagesPage(showing);if(showing)setOpen(false);};window.addEventListener('hashchange',navigate);return()=>window.removeEventListener('hashchange',navigate);},[]);
  useEffect(()=>{
    const launch=()=>setOpen(true);
    window.addEventListener('norte:open-chat',launch);
    return()=>window.removeEventListener('norte:open-chat',launch);
  },[]);
  useEffect(()=>{
    if(!open)return;
    const id=++loadId.current;setConversation(null);setError('');
    void api<{conversation:Conversation}>('/platform/conversations',{method:'POST',body:JSON.stringify({kind:'administration'})}).then(result=>{if(id===loadId.current)setConversation(result.conversation);}).catch(reason=>{if(id===loadId.current)setError(reason.message);});
    return()=>{loadId.current++;};
  },[open,api,user?.id]);
  useEffect(()=>{const resize=()=>setPosition(null);window.addEventListener('resize',resize);return()=>window.removeEventListener('resize',resize);},[]);
  return <>
    {!open&&!messagesPage&&<button className="chat-launcher" onClick={()=>setOpen(true)}><MessageSquare size={18}/>{pt?'Ajuda e feedback':'Help and feedback'}</button>}
    {open&&<aside ref={panel} className="chat-widget" style={position?{left:position.x,top:position.y,right:'auto',bottom:'auto'}:undefined} aria-label={pt?'Administração Norte':'Norte administration'}>
      <header className="chat-widget-head"><span className="chat-drag" title={pt?'Arrastar conversa':'Move chat'} onPointerDown={event=>{if(window.innerWidth<600)return;const rect=panel.current!.getBoundingClientRect();drag.current={x:event.clientX,y:event.clientY,left:rect.left,top:rect.top};event.currentTarget.setPointerCapture(event.pointerId);}} onPointerMove={event=>{const start=drag.current;if(start){const rect=panel.current!.getBoundingClientRect();setPosition({x:Math.max(8,Math.min(window.innerWidth-rect.width-8,start.left+event.clientX-start.x)),y:Math.max(64,Math.min(window.innerHeight-rect.height-8,start.top+event.clientY-start.y))});}}} onPointerUp={event=>{drag.current=null;if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);}} onPointerCancel={()=>{drag.current=null;}}><GripHorizontal size={14}/><span className="chat-widget-emblem"><ShieldCheck size={20}/></span><span><strong>{pt?'Administração Norte':'Norte administration'}</strong><small>{pt?'Ajuda e feedback':'Help and feedback'}</small></span></span><div><button onClick={()=>setTutorial(true)} aria-label={pt?'Como enviar imagens':'How to send images'} title={pt?'Como enviar imagens':'How to send images'}><HelpCircle size={17}/></button><a href={`#/messages${conversation?`?conversation=${conversation.id}`:''}`} onClick={()=>setOpen(false)} aria-label={pt?'Expandir conversa':'Expand conversation'}><Maximize2 size={16}/></a><button onClick={()=>setOpen(false)} aria-label={pt?'Recolher conversa':'Minimize chat'}><Minus size={18}/></button></div></header>
      {error&&<p role="alert" className="chat-error">{error}</p>}
      {conversation?<ConversationThread key={conversation.id} compact conversation={conversation} language={language}/>:<div className="chat-empty" role="status">{pt?'Abrindo conversa…':'Opening conversation…'}</div>}
    </aside>}
    {tutorial&&<div className="sketch-backdrop"><section className="chat-tutorial" role="dialog" aria-modal="true" aria-label={pt?'Texto e imagens na mesma mensagem':'Text and images in one message'}><header><h2>{pt?'Mostre o que aconteceu':'Show what happened'}</h2><button onClick={()=>setTutorial(false)} aria-label={pt?'Fechar tutorial':'Close tutorial'}><X size={18}/></button></header><ol><li>{pt?'Escreva o contexto e cole uma imagem com Ctrl+V, no ponto que quiser.':'Write the context and paste an image with Ctrl+V wherever you want.'}</li><li>{pt?'Clique em “Anotar imagem” para desenhar sobre ela.':'Click “Annotate image” to draw on it.'}</li><li>{pt?'Continue escrevendo abaixo. Você pode inserir outras imagens antes de enviar.':'Continue writing below. You can insert more images before sending.'}</li></ol><div className="chat-tutorial-example"><p>{pt?'O campo não mostra o valor esperado.':'The field does not show the expected value.'}</p><div><span className="tutorial-field">{pt?'Valor':'Value'}</span><span className="tutorial-annotation">{pt?'aqui':'here'} ↙</span></div><p>{pt?'Depois de salvar, acontece isto…':'After saving, this happens…'}</p></div><button className="platform-primary" onClick={()=>setTutorial(false)}>{pt?'Entendi':'Got it'}</button></section></div>}
  </>;
}
