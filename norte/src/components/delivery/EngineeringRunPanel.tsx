import { Check, LoaderCircle, AlertCircle, X } from 'lucide-react';
import type { ReactNode } from 'react';
import type { AssistantRun } from '../../lib/engineeringAssistant';
import '../../styles/requirements-workspace.css';
export function EngineeringRunPanel({run,error,pt=true,onClose,children}:{run:AssistantRun|null;error?:string;pt?:boolean;onClose?:()=>void;children?:ReactNode}) {
  if(!run&&!error)return null;
  const running=run&&['queued','running'].includes(run.status);
  return <section className="engineering-run" aria-label={pt?'Atividade da análise':'Analysis activity'}><header><strong>{running?(pt?'Análise em andamento':'Analysis in progress'):run?.status==='failed'?(pt?'Análise interrompida':'Analysis interrupted'):(pt?'Registro da análise':'Analysis log')}</strong>{onClose&&!running&&<button onClick={onClose} aria-label={pt?'Fechar registro':'Close log'}><X size={14}/></button>}</header><ol aria-live="polite" aria-relevant="additions">{run?.events.map((event,i)=><li key={`${event.at}-${i}`} className={event.level}>{event.level==='error'?<AlertCircle size={14}/>:running&&i===run.events.length-1?<LoaderCircle size={14}/>:<Check size={14}/>}<span>{event.message}</span><time>{new Date(event.at).toLocaleTimeString(pt?'pt-BR':'en',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}</time></li>)}</ol>{(error||run?.error)&&<p role="alert" className="error">{error||run?.error}</p>}{children}</section>;
}
