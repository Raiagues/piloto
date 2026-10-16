import { LIFE_PHASES, LIFE_DURATIONS, lifecycleMilestones, reviewDocuments } from '../shared/delivery-lifecycle.mjs';
import { draftDeliveryDocument } from './delivery-documents.mjs';
/** Mutates a caller-owned proposal copy only. Never opens a store or changes a source artifact. */
export function seedDeliveryDemo(data, projectId, actorId) {
 const record=data.workspace?.projects?.[projectId], actor=data.users?.find(u=>u.id===actorId);
 if(!record||!actor)throw new Error('DELIVERY_SEED_PROJECT_OR_ACTOR_MISSING');
 data.workspace.delivery||={};
 const state=data.workspace.delivery[projectId]||={revision:0,requirements:[],tests:[],tasks:[],standards:[],history:[],proposals:[],documents:[],analyses:{}};
 const audit={createdTasks:0,createdDocuments:0,createdTests:0,planningDates:'Fictitious demonstration dates starting 2026-11-02; not Quetzal-1 historical dates.',preservedRequirements:true};
 if(state.demoSeedVersion===1)return {...audit,alreadySeeded:true};
 const timestamp=new Date().toISOString();state.documents||=[];state.proposals||=[];state.analyses||={};
 if(!state.lifecycle){
  state.lifecycle={profile:'nasa',startDate:'2026-11-02',durations:[...LIFE_DURATIONS.nasa],updatedAt:timestamp,demonstration:true};
  const definitions=lifecycleMilestones(state.lifecycle);state.lifecycle.selectedReviews=definitions.filter(r=>r.active).map(r=>r.id);
  for(const d of definitions){const id=`DEMO-NASA-${d.id}`;if(state.tasks.some(t=>t.id===id))continue;state.tasks.push({id,reviewCode:d.id,lifecycleProfile:'nasa',lane:d.lane,phaseIndex:d.phase,excluded:!d.active,title:`${d.id} · ${d.title}`,phase:LIFE_PHASES.nasa[d.phase][1],description:`${d.focus}\nDEMONSTRAÇÃO: datas fictícias para explorar o planejamento, sem representar a missão histórica Quetzal-1.`,kind:'review',startDate:d.date,dueDate:d.date,prepDays:10,closeDays:7,status:'planned',sectorId:'',ownerId:actor.id,dependencyIds:[],requirementIds:[],testIds:[],inputArtifactIds:[],outputArtifactIds:[],archived:false,updatedAt:timestamp,manual:false,demonstration:true});audit.createdTasks++;}
  if(!state.standards.length)state.standards=['nasa-hb','nasa-npr'];
 }
 const overlays=new Map(state.requirements.map(r=>[r.id,r]));
 const requirements=(record.document.engineeringSystem?.requirements||[]).map(r=>{const edit=overlays.get(r.id);overlays.delete(r.id);return {...r,version:1,status:'draft',...edit};}).concat([...overlays.values()]).filter(r=>!r.archived);
 const tasks=state.tasks.filter(t=>t.lifecycleProfile===state.lifecycle.profile&&!t.excluded&&!t.archived);
 if(requirements.length&&!state.tests.length){
  const r=requirements[0],task=tasks.find(t=>t.reviewCode==='TRR'),id='DEMO-VER-SOURCE-REVIEW';
  state.tests.push({id,title:`Revisar evidências de ${r.id}`,method:'inspection',procedure:'Conferir o enunciado e as referências citadas na documentação original. Registrar configuração, limites aplicáveis e itens sem comprovação antes de executar a verificação de desempenho.',acceptanceCriteria:'PENDENTE — definir com o responsável a evidência e o critério de aceitação deste requisito. Este exemplo não demonstra atendimento.',requirementIds:[r.id],entityIds:r.entityIds||r.relatedEntityIds||[],sectorId:r.sectorId||'',ownerId:actor.id,conditions:'Rascunho de demonstração; nenhuma execução registrada.',configuration:'A definir pela equipe com base na versão do projeto.',level:'system',reviewTaskIds:task?[task.id]:[],runs:[],archived:false,version:1,updatedAt:timestamp,demonstration:true});if(task){task.testIds=[...new Set([...task.testIds,id])];task.requirementIds=[...new Set([...task.requirementIds,r.id])];}audit.createdTests++;
 }
 const selected=tasks.filter(t=>['SRR','TRR','PDR'].includes(t.reviewCode));
 for(const task of selected){
  for(const def of reviewDocuments(task.lifecycleProfile,task.reviewCode).filter(d=>d.flow==='output'||['requirements','verification-plan','traceability','verification-matrix'].includes(d.content)||d.id.startsWith('PROC-')).slice(0,5)){
   if(state.documents.some(d=>d.taskId===task.id&&d.templateId===def.id))continue;
   const id=`DEMO-DOC-${task.reviewCode}-${def.id}`;
   state.documents.push({id,taskId:task.id,templateId:def.id,title:def.title,flow:def.flow,reference:def.reference,body:draftDeliveryDocument(def,record.document,requirements,state.tests,task)+'\n\nDEMONSTRAÇÃO: planejamento com datas fictícias. As fontes e enunciados existentes foram preservados; os campos pendentes não são resultados.',status:'draft',version:1,authorId:actor.id,authorName:actor.name,createdAt:timestamp,updatedAt:timestamp,sourceRevision:state.revision,demonstration:true});audit.createdDocuments++;
  }
 }

 state.demoSeedVersion=1;state.revision++;state.history.push({id:'DEMO-SEED-DELIVERY-V1',revision:state.revision,action:'demo.seed',subjectId:projectId,actorId,actorName:actor.name,createdAt:timestamp,before:null,after:audit});
 return audit;
}
