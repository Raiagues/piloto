import { randomUUID } from 'node:crypto';
import { canReviewAccount, isFictionalProfile } from './reviewer-eligibility.mjs';
import { matchesSchema, changeSchema } from '../shared/engineering-schema.mjs';
import { isProjectAdmin } from '../shared/project-organization.mjs';
import { ideaBaselineHash } from './idea-sessions.mjs';
import { projectBaselineIsCurrent } from './project-retrieval.mjs';
const fail=(statusCode,code,message)=>Object.assign(new Error(message),{statusCode,code});
const now=()=>new Date().toISOString();
export function registerConfigurationChanges(app,{store,requireAuth,requireCsrf,canAccessProject,intelligence}){
 const recordFor=(data,actor,id)=>{const r=data.workspace.projects?.[id];if(!r||!canAccessProject(data,actor,r))throw fail(404,'PROJECT_NOT_FOUND','Projeto indisponível.');return r;};
 const currentUser=(data,request)=>{const u=data.users.find(u=>u.id===request.auth.user.id&&u.active);if(!u)throw fail(401,'AUTH_REQUIRED','Entre novamente.');return u;};
 const state=(data,id)=>{data.workspace.configurationChanges||={};return data.workspace.configurationChanges[id]||=[];};
 const currentBaseline=record=>{if(!projectBaselineIsCurrent(record.document))throw fail(409,'SYSTEM_MEMORY_STALE','Os documentos mudaram. Revise ou regenere a arquitetura antes de continuar com a proposta.');};
 const view=(data,id,actor)=>{
  const record=recordFor(data,actor,id),eligible=id=>data.users.some(u=>u.id===id&&canReviewAccount(u)&&canAccessProject(data,u,record));
  const changes=(data.workspace.configurationChanges?.[id]||[]).map(c=>({...c,
   status:c.status==='approved'&&!c.reviewers.every(eligible)?'in_review':c.status,
   decisions:Object.fromEntries(Object.entries(c.decisions).filter(([id])=>eligible(id)))}));
  return{changes,baselineHash:ideaBaselineHash(record.document.engineeringSystem),deliveryRevision:data.workspace.delivery?.[id]?.revision||0,canMerge:isProjectAdmin(record.document,actor,record.createdBy),members:data.users.filter(u=>u.active&&canAccessProject(data,u,record)).map(u=>({id:u.id,name:u.name,canReview:canReviewAccount(u),isFictionalProfile:isFictionalProfile(u)}))};
 };
 app.get('/api/projects/:id/configuration-changes',{preHandler:[requireAuth]},async request=>view(store.read(),request.params.id,request.auth.user));
 app.post('/api/projects/:id/configuration-changes',{preHandler:[requireAuth,requireCsrf],bodyLimit:20000},async request=>store.update(data=>{
  const actor=currentUser(data,request),r=recordFor(data,actor,request.params.id),b=request.body||{},model=r.document.engineeringSystem;
  if(actor.accessRole==='advisor')throw fail(403,'FORBIDDEN','Somente participantes com edição podem propor mudanças.');
  if(!model||b.baselineHash!==ideaBaselineHash(model))throw fail(409,'BASELINE_CHANGED','A configuração mudou. Reavalie o impacto antes de propor.');
  currentBaseline(r);
  if(!['analysis','manual'].includes(b.basis)||!Number.isSafeInteger(b.deliveryRevision)||b.deliveryRevision<0)throw fail(400,'CHANGE_CONTEXT_REQUIRED','Indique se a proposta é manual ou vem de uma análise e informe a revisão de requisitos utilizada.');
  if(b.deliveryRevision!==(data.workspace.delivery?.[r.document.id]?.revision||0))throw fail(409,'DELIVERY_CHANGED','Os requisitos ou verificações mudaram. Reavalie a proposta no contexto atual.');
  if(!matchesSchema(b.change,changeSchema)||b.change.kind==='requirement')throw fail(400,'INVALID_CHANGE','Use o fluxo de requisitos para mudanças em requisitos.');
  const target=model.entities.find(e=>e.id===b.change.targetEntityId);
  if(!target||!b.change.newValues.length||b.change.newValues.some(p=>!target.properties.some(old=>old.key===p.key))||new Set(b.change.newValues.map(p=>p.key)).size!==b.change.newValues.length)throw fail(400,'INVALID_CHANGE','Confira o componente e os parâmetros existentes.');
  if(!Array.isArray(b.reviewers)||b.reviewers.some(id=>typeof id!=='string'||id.length>100))throw fail(400,'INVALID_REVIEWER','Escolha revisores do projeto.');const reviewers=[...new Set(b.reviewers)];if(!reviewers.length||reviewers.length>10||reviewers.includes(actor.id)||reviewers.some(id=>!data.users.some(u=>u.id===id&&canReviewAccount(u)&&canAccessProject(data,u,r))))throw fail(400,'INVALID_REVIEWER','Escolha ao menos um revisor independente do projeto. Perfis fictícios não podem revisar.');
  const rows=state(data,r.document.id);if(rows.length>=500)throw fail(409,'LIMIT','Limite de propostas atingido.');
  const key=typeof b.key==='string'?b.key.slice(0,100):'';if(key){const existing=rows.find(c=>c.createdBy===actor.id&&c.key===key);if(existing){if(JSON.stringify(existing.change.newValues)!==JSON.stringify(b.change.newValues)||existing.change.targetEntityId!==b.change.targetEntityId)throw fail(409,'IDEMPOTENCY_CONFLICT','Proposta já registrada.');return view(data,r.document.id,actor);}}
  rows.push({id:randomUUID(),key,basis:b.basis,change:{...b.change,oldValues:target.properties.filter(p=>b.change.newValues.some(next=>next.key===p.key))},baselineHash:b.baselineHash,baselineRevision:model.revision||0,deliveryRevision:b.deliveryRevision,reviewers,decisions:{},comments:[],revision:1,status:'in_review',createdBy:actor.id,createdAt:now(),updatedAt:now()});return view(data,r.document.id,actor);
 }));
 app.post('/api/projects/:id/configuration-changes/:changeId/actions',{preHandler:[requireAuth,requireCsrf],bodyLimit:5000},async request=>store.update(data=>{
  const actor=currentUser(data,request),r=recordFor(data,actor,request.params.id),c=state(data,r.document.id).find(c=>c.id===request.params.changeId),b=request.body||{};
  if(!c)throw fail(404,'CHANGE_NOT_FOUND','Proposta indisponível.');if(c.status==='merged'||c.status==='cancelled')throw fail(409,'CHANGE_CLOSED','Proposta encerrada.');
  if(b.action==='comment'){if(typeof b.comment!=='string'||!b.comment.trim()||b.comment.length>2000||c.comments.length>=200)throw fail(400,'INVALID_COMMENT','Escreva um comentário de até 2000 caracteres.');c.comments.push({id:randomUUID(),body:b.comment.trim(),createdBy:actor.id,createdAt:now()});}
  else {if(b.expectedRevision!==c.revision)throw fail(409,'CHANGE_UPDATED','A revisão mudou. Recarregue antes de continuar.');
   if(b.action==='review'){if(!canReviewAccount(actor)||actor.id===c.createdBy||!c.reviewers.includes(actor.id))throw fail(403,'REVIEWER_REQUIRED','Esta decisão exige um revisor atribuído independente.');if(!['approve','request_changes'].includes(b.decision))throw fail(400,'INVALID_DECISION','Decisão inválida.');currentBaseline(r);if(c.baselineHash!==ideaBaselineHash(r.document.engineeringSystem)||(data.workspace.delivery?.[r.document.id]?.revision||0)!==c.deliveryRevision)throw fail(409,'BASELINE_CHANGED','A configuração ou os requisitos mudaram. Reavalie a proposta.');c.decisions[actor.id]={decision:b.decision,at:now()};c.status=Object.values(c.decisions).some(d=>d.decision==='request_changes')?'changes_requested':c.reviewers.every(id=>c.decisions[id]?.decision==='approve')?'approved':'in_review';}
   else if(b.action==='cancel'){if(actor.id!==c.createdBy&&!isProjectAdmin(r.document,actor,r.createdBy))throw fail(403,'FORBIDDEN','Somente autor ou responsável pode encerrar.');c.status='cancelled';}
   else if(b.action==='merge'){
    if(!isProjectAdmin(r.document,actor,r.createdBy))throw fail(403,'FORBIDDEN','Somente a liderança pode incorporar uma configuração.');
    currentBaseline(r);
    if(c.status!=='approved'||!c.reviewers.every(id=>c.decisions[id]?.decision==='approve'&&data.users.some(u=>u.id===id&&canReviewAccount(u)&&canAccessProject(data,u,r))))throw fail(409,'REVIEW_REQUIRED','Conclua as revisões independentes atuais.');
    if(c.baselineHash!==ideaBaselineHash(r.document.engineeringSystem)||(data.workspace.delivery?.[r.document.id]?.revision||0)!==c.deliveryRevision)throw fail(409,'BASELINE_CHANGED','A configuração ou os requisitos mudaram. Reavalie a proposta.');
    const previous=structuredClone(r.document),model=r.document.engineeringSystem,target=model.entities.find(e=>e.id===c.change.targetEntityId),evidenceId=`configuration-${c.id}`;
    r.engineeringHistory||=[];r.engineeringHistory.push({id:randomUUID(),reason:'configuration_change',archivedAt:now(),archivedBy:actor.id,engineeringSystem:structuredClone(model),extractionReport:structuredClone(r.extractionReport||null),changeId:c.id});
    model.evidence.push({id:evidenceId,artifactId:'user',artifactLabel:'Mudança de configuração revisada',locator:c.id,excerpt:c.change.description,kind:'user'});
    target.properties=target.properties.map(p=>{const next=c.change.newValues.find(v=>v.key===p.key);return next?{...next,source:'user',evidenceRefs:[evidenceId]}:p;});
    if(c.change.kind==='replace_component'&&c.change.replacementName)target.name=c.change.replacementName;
    target.source='user';target.evidenceRefs=[...new Set([...target.evidenceRefs,evidenceId])];model.revision=(model.revision||0)+1;model.generatedAt=now();r.revision=(r.revision||0)+1;r.updatedAt=now();r.updatedBy=actor.id;c.status='merged';c.mergedAt=now();c.mergedBy=actor.id;
    // Verification performed against an older configuration needs explicit revalidation.
    const delivery=data.workspace.delivery?.[r.document.id];if(delivery)delivery.revision++;
    intelligence.captureMapCorrections?.(data,previous,r.document,actor.id);
   }else throw fail(400,'INVALID_ACTION','Ação indisponível.');c.revision++;
  }c.updatedAt=now();return{...view(data,r.document.id,actor),...(b.action==='merge'?{project:r.document}:{})};
 }));
}
