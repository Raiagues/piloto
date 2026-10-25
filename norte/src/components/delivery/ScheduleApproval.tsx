import { useState } from 'react';
import { useAuth } from '../../lib/auth';
import type { DeliveryState, DeliveryTask } from '../../lib/projectDelivery';
import { DeliverySelect } from './DeliveryShared';

export function ScheduleApproval({data,task,pt,busy,mutate}:{data:DeliveryState;task:DeliveryTask;pt:boolean;busy:boolean;mutate:(action:string,payload:Record<string,unknown>)=>Promise<boolean>}) {
  const {user}=useAuth();
  const [reviewers,setReviewers]=useState<string[]>([]),[comment,setComment]=useState('');
  const status=task.approvalStatus||'draft';
  return <details className="schedule-task-section document-review"><summary>{pt?'Aprovação do planejamento':'Planning approval'}<span>{status==='approved'?(pt?'Aprovado':'Approved'):status==='in_review'?(pt?'Em revisão':'In review'):(pt?'Rascunho':'Draft')}</span></summary>
    {task.decisions?.map(decision=><p key={decision.userId}><strong>{decision.authorName}</strong> · {decision.decision==='approve'?(pt?'Aprovado':'Approved'):(pt?'Alterações solicitadas':'Changes requested')}<small>{decision.comment}</small></p>)}
    {task.canEdit&&!task.archived&&status!=='approved'&&<><DeliverySelect label={pt?'Revisores':'Reviewers'} choices={data.members.filter(member=>member.canReview&&!member.isFictionalProfile&&member.id!==task.authorId&&member.id!==user?.id).map(member=>({id:member.id,label:member.name}))} selected={reviewers} onChange={setReviewers}/><button disabled={busy||!reviewers.length} onClick={()=>void mutate('task.request_review',{id:task.id,reviewers})}>{pt?'Solicitar revisão':'Request review'}</button></>}
    {task.canReview&&<><label>{pt?'Parecer':'Review comment'}<textarea value={comment} maxLength={2000} onChange={event=>setComment(event.target.value)}/></label><div className="delivery-actions"><button disabled={busy} onClick={()=>void mutate('task.review',{id:task.id,decision:'approve',comment,version:task.version})}>{pt?'Aprovar versão':'Approve version'}</button><button disabled={busy||!comment.trim()} onClick={()=>void mutate('task.review',{id:task.id,decision:'request_changes',comment,version:task.version})}>{pt?'Solicitar alterações':'Request changes'}</button></div></>}
  </details>;
}
