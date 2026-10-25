import { useCallback, useEffect, useState } from 'react';
import { Building2, HelpCircle, MessageSquare, Search, ShieldCheck, UserRound, Plus, X } from 'lucide-react';
import { useAuth } from '../lib/auth';
import type { Language } from '../lib/types';
import { conversationLabel } from '../lib/conversations';
import type { Conversation, ChatScope } from '../lib/conversations';
import { ConversationThread } from '../components/chat/ConversationThread';
import '../styles/features/chat.css';
export function MessagesPage({language}:{language:Language}) {
  const {api,user}=useAuth(),pt=language==='pt';
  const [conversations,setConversations]=useState<Conversation[]>([]),[active,setActive]=useState(''),[scopes,setScopes]=useState<ChatScope[]>([]),[adding,setAdding]=useState(false),[error,setError]=useState(''),[filter,setFilter]=useState('');
  const list=useCallback(async()=>{
    const result=await api<{conversations:Conversation[]}>('/platform/conversations');
    const rows=result.conversations.filter(conversation=>conversation.kind!=='help');setConversations(rows);return rows;
  },[api]);
  useEffect(()=>{
    let alive=true;
    const start=async()=>{
      const params=new URLSearchParams(window.location.hash.split('?')[1]||''),withId=params.get('with');
      let selected=params.get('conversation');
      if(withId){const result=await api<{conversation:Conversation}>('/platform/conversations',{method:'POST',body:JSON.stringify({recipientId:withId})});selected=result.conversation.id;}
      let rows=await list();
      if(!rows.some(conversation=>conversation.kind==='administration')){
        const result=await api<{conversation:Conversation}>('/platform/conversations',{method:'POST',body:JSON.stringify({kind:'administration'})});
        rows=await list();selected||=result.conversation.id;
      }
      if(alive)setActive(current=>selected||current||rows[0]?.id||'');
      const options=await api<{scopes:ChatScope[]}>('/platform/conversation-scopes');if(alive)setScopes(options.scopes);
    };
    const run=()=>{void start().catch(reason=>{if(alive)setError(reason.message);});};run();
    window.addEventListener('hashchange',run);
    const timer=setInterval(()=>{if(document.visibilityState==='visible')void list().catch(()=>undefined);},8000);
    return()=>{alive=false;clearInterval(timer);window.removeEventListener('hashchange',run);};
  },[api,list]);
  async function create(scope:Partial<ChatScope>|{kind:string}){
    try{const result=await api<{conversation:Conversation}>('/platform/conversations',{method:'POST',body:JSON.stringify(scope)});await list();setActive(result.conversation.id);setAdding(false);setFilter('');setError('');}
    catch(reason){setError(reason instanceof Error?reason.message:'Falha');}
  }
  const selected=conversations.find(conversation=>conversation.id===active);
  const filtered=conversations.filter(conversation=>conversationLabel(conversation,user?.id).toLocaleLowerCase().includes(filter.toLocaleLowerCase()));
  return <main className="platform-page messages-page">
    <header className="platform-page-head"><h1>{pt?'Mensagens':'Messages'}</h1><div className="chat-page-actions"><button onClick={()=>void create({kind:'administration'})}><HelpCircle size={16}/>{pt?'Ajuda e feedback':'Help and feedback'}</button><button className="platform-primary" onClick={()=>setAdding(value=>!value)} aria-expanded={adding}>{adding?<X size={16}/>:<Plus size={16}/>}<span>{adding?(pt?'Fechar':'Close'):(pt?'Nova conversa':'New conversation')}</span></button></div></header>
    {error&&<p role="alert" className="platform-error">{error}</p>}
    {adding&&<section className="chat-new" aria-label={pt?'Nova conversa':'New conversation'}><a href="#/people"><UserRound size={19}/>{pt?'Escolher contato':'Choose contact'}</a><button onClick={()=>void create({kind:'administration'})}><ShieldCheck size={19}/>{pt?'Administração Norte':'Norte administration'}</button>{scopes.map(scope=><button key={`${scope.teamId}:${scope.projectId||''}:${scope.sectorId||''}`} onClick={()=>void create(scope)}><Building2 size={19}/><span>{scope.title}<small>{scope.kind==='team'?(pt?'Equipe':'Team'):(pt?'Setor':'Department')}</small></span></button>)}</section>}
    <div className="messages-layout"><aside className="conversation-list" aria-label={pt?'Conversas':'Conversations'}><label className="conversation-search"><Search size={16}/><input type="search" aria-label={pt?'Buscar conversa':'Find conversation'} placeholder={pt?'Buscar conversa':'Find conversation'} value={filter} onChange={event=>setFilter(event.target.value)}/></label>
      <div className="conversation-items">{filtered.map(conversation=><button key={conversation.id} aria-pressed={active===conversation.id} onClick={()=>{setActive(conversation.id);setError('');}}><span className={`conversation-avatar${conversation.kind==='administration'?' administration':''}`}>{conversation.kind==='administration'?<ShieldCheck size={19}/>:['team','sector'].includes(conversation.kind)?<Building2 size={19}/>:<UserRound size={19}/>}</span><span className="conversation-preview"><strong>{conversationLabel(conversation,user?.id)}</strong><small>{conversation.lastMessage||(conversation.kind==='administration'?(pt?'Ajuda e feedback':'Help and feedback'):(pt?'Começar conversa':'Start conversation'))}</small></span>{conversation.unread>0&&<span className="platform-count">{conversation.unread}</span>}</button>)}</div>
      {!filtered.length&&<p className="conversation-none">{pt?'Nenhuma conversa encontrada.':'No conversations found.'}</p>}
    </aside>{selected?<ConversationThread key={selected.id} language={language} conversation={selected} onSent={()=>void list()}/>:<div className="chat-empty"><span className="chat-empty-icon"><MessageSquare size={26}/></span><strong>{pt?'Suas conversas, em um lugar':'Your conversations, in one place'}</strong><p>{pt?'Escolha um contato ou uma equipe para começar.':'Choose a contact or team to begin.'}</p></div>}</div>
  </main>;
}
