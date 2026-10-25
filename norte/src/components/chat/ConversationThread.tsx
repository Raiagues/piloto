import { useCallback, useEffect, useRef, useState } from 'react';
import { MessageSquare, ShieldCheck } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import type { ChatDraftBlock, ChatMessage, Conversation } from '../../lib/conversations';
import { conversationLabel, messageContent } from '../../lib/conversations';
import type { Language } from '../../lib/types';
import { MessageComposer } from './MessageComposer';
import '../../styles/features/chat.css';
export function ConversationThread({conversation,language,initialBody='',compact=false,onSent}:{conversation:Conversation;language:Language;initialBody?:string;compact?:boolean;onSent?:(body:string)=>void}) {
  const {api,user}=useAuth(),pt=language==='pt';
  const [messages,setMessages]=useState<ChatMessage[]>([]),[error,setError]=useState(''),[older,setOlder]=useState(false),[loadingOlder,setLoadingOlder]=useState(false);
  const generation=useRef(0),log=useRef<HTMLDivElement>(null),initialized=useRef(false),alive=useRef(true),historyExhausted=useRef(false),lifetime=useRef(0);
  const load=useCallback(async()=>{
    const seq=++generation.current;
    try{
      const result=await api<{messages:ChatMessage[];hasOlder:boolean}>(`/platform/conversations/${conversation.id}`);
      if(seq!==generation.current||!alive.current)return;
      const bottom=log.current?log.current.scrollHeight-log.current.scrollTop-log.current.clientHeight<80:true;
      setMessages(current=>[...current.filter(message=>message.sequence<(result.messages[0]?.sequence||0)),...result.messages]);
      setOlder(result.hasOlder&&!historyExhausted.current);
      if(document.visibilityState==='visible'&&result.messages.length)void api(`/platform/conversations/${conversation.id}/read`,{method:'POST',body:JSON.stringify({through:result.messages.at(-1)!.sequence})}).catch(()=>undefined);
      if(bottom||!initialized.current){requestAnimationFrame(()=>log.current?.scrollTo({top:log.current.scrollHeight}));initialized.current=true;}
    }catch(reason){if(alive.current&&seq===generation.current)setError(reason instanceof Error?reason.message:'Falha ao carregar.');}
  },[api,conversation.id]);
  useEffect(()=>{
    alive.current=true;lifetime.current++;void load();
    const timer=setInterval(()=>{if(document.visibilityState==='visible')void load();},4000);
    return()=>{alive.current=false;lifetime.current++;generation.current++;clearInterval(timer);};
  },[load]);
  async function loadOlder(){
    if(loadingOlder||historyExhausted.current||!messages.length)return;
    const mounted=lifetime.current,before=messages[0].sequence;setLoadingOlder(true);
    try{
      const result=await api<{messages:ChatMessage[];hasOlder:boolean}>(`/platform/conversations/${conversation.id}?before=${before}`);
      if(!alive.current||mounted!==lifetime.current)return;
      const previousHeight=log.current?.scrollHeight||0;
      setMessages(current=>[...result.messages,...current].filter((message,index,all)=>all.findIndex(item=>item.id===message.id)===index));
      historyExhausted.current=!result.hasOlder;setOlder(result.hasOlder);
      requestAnimationFrame(()=>{if(alive.current&&mounted===lifetime.current&&log.current)log.current.scrollTop+=log.current.scrollHeight-previousHeight;});
    }catch(reason){if(alive.current&&mounted===lifetime.current)setError(reason instanceof Error?reason.message:'Falha ao carregar.');}
    finally{if(alive.current&&mounted===lifetime.current)setLoadingOlder(false);}
  }
  async function send(blocks:ChatDraftBlock[],key:string){
    await api(`/platform/conversations/${conversation.id}/messages`,{method:'POST',body:JSON.stringify({key,blocks:blocks.map(block=>block.type==='text'?{type:'text',text:block.text}:{type:'image',image:block.image}),language})});
    if(!alive.current)return;
    setError('');await load();
    requestAnimationFrame(()=>log.current?.scrollTo({top:log.current.scrollHeight,behavior:'smooth'}));
    onSent?.(blocks.filter(block=>block.type==='text').map(block=>block.type==='text'?block.text:'').join('\n'));
  }
  const sender=(id:string)=>id==='norte-guide'?(pt?'Guia Norte':'Norte guide'):conversation.participants.find(person=>person.id===id)?.name||(pt?'Participante':'Participant');
  const administration=conversation.kind==='administration';
  return <section className={`chat-thread${compact?' compact':''}`} aria-label={conversationLabel(conversation,user?.id)}>
    {!compact&&<header><span className={`chat-thread-avatar${administration?' administration':''}`}>{administration?<ShieldCheck size={21}/>:<MessageSquare size={21}/>}</span><div><strong>{conversationLabel(conversation,user?.id)}</strong><small>{administration?(pt?'Ajuda e feedback':'Help and feedback'):`${conversation.participants.length} ${pt?'participantes':'participants'}`}</small></div></header>}
    <div className="chat-log" ref={log} role="log" aria-label={pt?'Histórico de mensagens':'Message history'} aria-live="polite">
      {older&&<button className="chat-load-older" disabled={loadingOlder} onClick={()=>void loadOlder()}>{pt?'Mensagens anteriores':'Earlier messages'}</button>}
      {!messages.length&&<div className="chat-empty"><span className="chat-empty-icon">{administration?<ShieldCheck size={26}/>:<MessageSquare size={26}/>}</span><strong>{administration?(pt?'Fale com a administração':'Talk to the administration'):(pt?'Comece uma conversa':'Start a conversation')}</strong><p>{administration?(pt?'Conte sua ideia ou mostre o problema com imagens.':'Share an idea or show the problem with images.'):(pt?'Compartilhe uma mensagem com sua equipe.':'Share a message with your team.')}</p></div>}
      {messages.map(message=><article key={message.id} className={message.senderId===user?.id?'own':''}>
        <small>{sender(message.senderId)}</small>
        {messageContent(message).map((block,index)=>block.type==='text'?<p key={index}>{block.text}</p>:<a key={block.image.id} className="chat-message-image" href={block.image.url} target="_blank" rel="noreferrer" aria-label={pt?'Abrir imagem em tamanho original':'Open full-size image'}><img src={block.image.url} alt={block.image.name} loading="lazy"/></a>)}
        {message.link&&<a href={message.link}>{pt?'Abrir página':'Open page'} →</a>}
        <time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleTimeString(pt?'pt-BR':'en-US',{hour:'2-digit',minute:'2-digit'})}</time>
      </article>)}
    </div>
    {error&&<p role="alert" className="chat-error">{error}</p>}
    <MessageComposer language={language} initialBody={initialBody} onSend={send}/>
  </section>;
}
