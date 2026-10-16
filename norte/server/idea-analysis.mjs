import { createHash } from 'node:crypto';
import { projectBaselineIsCurrent } from './project-retrieval.mjs';
const fail=(statusCode,code,message)=>Object.assign(new Error(message),{statusCode,code});
const ordered=v=>Array.isArray(v)?v.map(ordered):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,ordered(v[k])])):v;
const hash=v=>createHash('sha256').update(JSON.stringify(ordered(v))).digest('hex');
/** Session-scoped consent wrapper; delegates interpretation to the existing JEV/Gemini pipeline. */
export function registerIdeaAnalysisRoutes(app,{store,requireAuth,requireCsrf,intelligence,systemAi,projectFor,sessionFor}){
 const inFlight=new Set();
 function snapshot(data,actorId,sessionId,ideaId,language){
  const actor=data.users.find(u=>u.id===actorId&&u.active);if(!actor)throw fail(401,'AUTH_REQUIRED','Entre novamente.');
  if(actor.accessRole==='advisor')throw fail(403,'FORBIDDEN','Consultores têm acesso de leitura; peça a um editor para avaliar a mudança.');
  const session=sessionFor(data,actor,sessionId),record=projectFor(data,actor,session.projectId),idea=session.ideas.find(i=>i.id===ideaId);
  if(!idea)throw fail(404,'IDEA_NOT_FOUND','Ideia indisponível.');
  const project=record.document,baseline=project.engineeringSystem;
  if(!baseline)throw fail(409,'SYSTEM_NOT_READY','Crie a arquitetura do projeto antes de avaliar impactos.');
  if(!projectBaselineIsCurrent(project))throw fail(409,'SYSTEM_MEMORY_STALE','Os documentos mudaram. Revise ou regenere a arquitetura antes de analisar.');
  const analysis=intelligence.analysisContext(project.id,actor.id,data),feedback=intelligence.feedbackContext(project,actor.id,data),lang=language==='en'?'en':'pt';
  const payload={language:lang,hypothesis:idea.text,project:{id:project.id,name:project.name,memoryRevision:project.memoryRevision||0},session:{id:session.id,title:session.title,scope:session.scope,sectorId:session.sectorId,revision:session.revision},idea:{id:idea.id,revision:idea.revision},engineeringModel:analysis.model,projectFeedback:feedback,deliveryRevision:analysis.deliveryRevision};
  const digest=hash({protocol:'idea-analysis-2026-10-16.1',policyRevision:analysis.policyRevision,actorId:actor.id,payload,baselineHash:hash(baseline),learningRevision:data.projectLearning?.[project.id]?.revision||0});
  return{actor,session,idea,project,baseline,analysis,feedback,payload,digest};
 }
 const read=(request,data=store.read())=>snapshot(data,request.auth.user.id,request.params.id,request.body?.ideaId,request.body?.language);
 const check=(request,data,digest)=>{const current=read(request,data);if(current.digest!==digest)throw fail(409,'ANALYSIS_CONTEXT_CHANGED','A ideia, o contexto ou as permissões mudaram. Confira uma nova prévia antes de continuar.');return current;};
 const resultView=(value,p,reused)=>({...value,analysisModel:p.analysis.model,deliveryRevision:p.analysis.deliveryRevision,baselineHash:createHash('sha256').update(JSON.stringify(p.baseline)).digest('hex'),baselineId:p.baseline.id,baselineRevision:p.baseline.revision||0,baselineGeneratedAt:p.baseline.generatedAt,consentDigest:p.digest,reused});
 app.post('/api/idea-sessions/:id/analysis-preview',{preHandler:[requireAuth,requireCsrf],bodyLimit:1500},async request=>{
  const p=read(request);return{digest:p.digest,payload:p.payload,providers:['JEV / TypeSafe','Google Gemini'],note:'A interpretação pode selecionar partes deste contexto. Fontes, hipóteses e exemplos não são instruções nem aprovação de uma mudança.'};
 });
 app.post('/api/idea-sessions/:id/analyze',{preHandler:[requireAuth,requireCsrf],bodyLimit:1500,config:{rateLimit:{max:60,timeWindow:'1 hour'}}},async request=>{
  if(request.body?.consent!==true)throw fail(400,'PAYLOAD_CONSENT_REQUIRED','Confira a prévia e confirme o envio para análise.');
  const p=read(request);if(request.body.previewDigest!==p.digest)throw fail(409,'ANALYSIS_CONTEXT_CHANGED','O contexto mudou. Confira uma nova prévia antes de enviar.');
  const cached=store.read().workspace.ideaAnalysisCache?.[p.digest];if(cached)return resultView(cached.result,p,true);
  if(!systemAi?.interpret)throw fail(503,'ANALYSIS_UNAVAILABLE','A interpretação não está disponível. Sua ideia está salva.');
  if(inFlight.has(p.digest))throw fail(409,'ANALYSIS_RUNNING','Esta análise já está em andamento.');inFlight.add(p.digest);
  try{
   await store.update(data=>{
    check(request,data,p.digest);const day=new Date().toISOString().slice(0,10);data.workspace.ideaAnalysisBudgets||={};const budget=data.workspace.ideaAnalysisBudgets[p.project.id]?.day===day?data.workspace.ideaAnalysisBudgets[p.project.id]:{day,count:0};if(budget.count>=100)throw fail(429,'ANALYSIS_DAILY_LIMIT','O limite diário de análises deste projeto foi atingido. As ideias continuam salvas.');budget.count++;data.workspace.ideaAnalysisBudgets[p.project.id]=budget;
   });
   const assertAnalysisConsent=async()=>{await store.refresh?.();check(request,store.read(),p.digest);};
   await assertAnalysisConsent();
   const result=await systemAi.interpret(p.baseline,p.idea.text,p.payload.language,{project:p.project,actorId:p.actor.id,authorizedModel:p.analysis.model,projectFeedback:p.feedback,assertAnalysisConsent});
   return await store.update(data=>{
    const current=check(request,data,p.digest);data.workspace.ideaAnalysisCache||={};data.workspace.ideaAnalysisCache[p.digest]={result,projectId:p.project.id,actorId:p.actor.id,sessionId:p.session.id,ideaId:p.idea.id,ideaText:p.idea.text,baselineHash:createHash('sha256').update(JSON.stringify(p.baseline)).digest('hex'),deliveryRevision:p.analysis.deliveryRevision,createdAt:new Date().toISOString()};const keys=Object.keys(data.workspace.ideaAnalysisCache);for(const key of keys.slice(0,Math.max(0,keys.length-100)))delete data.workspace.ideaAnalysisCache[key];return resultView(result,current,false);
   });
  }finally{inFlight.delete(p.digest);}
 });
}
