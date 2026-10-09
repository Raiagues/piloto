/* Lossless speech boundaries shared by live, typed and imported meeting turns.
 * This module finds literal clause boundaries; it does not classify or rewrite speech.
 * Commands stay atomic for routing; values stay with their units. A bounded
 * preceding prefix resolves continuations, while metadata preserves the source.
 */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.NorteMeetingSpeech=api;})(globalThis,function(){
'use strict';
const words=text=>(text.match(/\S+/gu)||[]).length;
// Use the same intent grammar as the simulator. This only protects literal
// speech boundaries; execution still goes through the command router.
const beamCommands=()=>typeof module==='object'&&module.exports?require('./beam-commands.js'):globalThis.NorteBeamCommands;
const abbreviations=/^(?:sr|sra|srta|dr|dra|prof|profa|eng|engª|etc|ex|art|fig|aprox|vs|mr|mrs|ms|figs)$/iu;
const filler='(?:tá|ta|então|entao|bom|bem|ok|okay|certo|beleza|aí|ai|agora|olha|é|e|o)';
const fillers=new RegExp('(?:(?<![\\p{L}\\p{N}])'+filler+'[\\s,;:–—-]+)+$','iu');
const wake=/\bnorte\s*[,!:;–—-]?\s*(?:(?:por favor|eu quero|eu queria|a gente vai|voc[eê])\s+)?(?:pode|poderia|vamos|mude|muda|mudar|altere|altera|troque|troca|coloque|coloca|bote|bota|ponha|põe|poe|adicione|adiciona|acrescente|acrescenta|insira|insere|remova|remove|retire|retira|tire|tira|apague|apaga|exclua|exclui|abra|abre|abrir|inicie|inicia|simule|simula|mostre|mostra|exiba|exibe|compare|compara|use|usa|utilize|utiliza|volte|volta|inverta|inverte|ajuste|ajusta|renomeie|renomeia|o assunto|o título|o titulo|move|mova|deixe|deixa|aumente|aumenta|reduza|reduz|diminua|diminui|aplique|aplica|defina|define|quero|preciso|show|open|change|rename)\b/giu;
const idea=/\b(?:hoje (?:a gente|nós|nos|vamos)|então vamos começar|entao vamos comecar|a gente vai tentar (?:mudar|alterar|testar|comparar|verificar|medir)|porque (?:ela|ele|a viga|o suporte|a peça|a peca) (?:tinha|tem|está|esta|apresenta)|talvez|pode ser que|suspeito que|a hipótese (?:é|e)|minha hipótese|vamos (?:testar|repetir|verificar|medir|comparar|adotar|manter|avaliar)|precisamos (?:testar|repetir|verificar|medir|confirmar|avaliar)|a gente (?:precisa|pode|vai) (?:testar|repetir|verificar|medir|avaliar)|o resultado (?:foi|mostrou|deu|indica)|os resultados (?:foram|mostraram|indicam)|(?:o teste|o ensaio|a simulação) (?:mostrou|deu|indicou|confirmou|retornou)|(?:testamos|observamos|medimos|obtivemos|decidimos|combinamos|definimos)|ficou decidido|outro (?:ponto|assunto|problema)|mudando de assunto|voltando (?:ao|à|para)|agora (?:vamos|sobre|falando)|(?:maybe|perhaps|let's test|let’s test|we tested|we measured|we decided|the result was|another issue))\b/giu;
const conjunction=/\s+(?=(?:mas|porém|porem|entretanto|no entanto|além disso|alem disso|por outro lado|e (?:agora|também|tambem|depois|então|entao)|and (?:now|then)|however)\s)/giu;
function quotedAt(text,index){
 let quote=null;
 for(let i=0;i<index;i++){const c=text[i];if(c==='"')quote=quote==='"'?null:quote||'"';else if(c==='“')quote='”';else if(c==='”'&&quote==='”')quote=null;}
 return quote!==null;
}
function subordinateBefore(text,index){return /(?:\b(?:que|se|quando|caso|porque|enquanto|para|if|when|that)|\b(?:disse|disser|falou|falar|dizer|say|said))\s*[:,]?\s*$/iu.test(text.slice(0,index));}
function commandStarts(text){
 const starts=[];
 for(const hit of text.matchAll(wake)){
  if(quotedAt(text,hit.index))continue;
  const prefix=text.slice(0,hit.index),f=prefix.match(fillers),start=f?hit.index-f[0].length:hit.index;
  if(subordinateBefore(text,start)||/\bnão\s*$/iu.test(text.slice(0,start)))continue;
  starts.push(start);
 }
 const boundaries=[0,...sentenceBoundaries(text).map(point=>point.at),text.length];
 for(let i=0;i<boundaries.length-1;i++){
  const at=boundaries[i],part=text.slice(at,boundaries[i+1]),leading=part.length-part.trimStart().length,start=at+leading;
  if(quotedAt(text,start)||subordinateBefore(text,start))continue;
  const intent=beamCommands()?.interpret(part,{active:true});
  if(intent?.eligible&&!intent.guarded&&/^(?:abra|mostre|exiba|veja|simule|simular|vamos simular|quero simular|mude|altere|ajuste|defina|aumente|reduza|adicione|coloque|insira|acrescente|aplique|mova|desloque|posicione|inverta|remova|retire|apague|exclua|use|utilize|compare|crie)\b/.test(intent.body))starts.push(start);
 }
 return [...new Set(starts)].sort((a,b)=>a-b);
}
function isCommand(text){const starts=commandStarts(String(text||''));return starts.length>0&&String(text).slice(0,starts[0]).trim()==='';}
function normalizeCommand(text){return String(text).replace(new RegExp('^\\s*(?:'+filler+'[\\s,;:–—-]+)*(?=norte\\b)','iu'),'');}
function sentenceBoundaries(text){
 const points=[];
 for(const hit of text.matchAll(/(?:[.!?…]+["”’)]*\s+|\n+)/gu)){
  if(quotedAt(text,hit.index))continue;
  const prefix=text.slice(0,hit.index),word=prefix.match(/([\p{L}.]+)$/u)?.[1]||'';
  if(hit[0][0]==='.'&&(abbreviations.test(word)||(/^(?:\p{Lu}|(?:\p{Lu}\.)+\p{Lu})$/u.test(word)&&!prefix.endsWith('°'+word))))continue;
  points.push({at:hit.index+hit[0].length,boundary:'sentence'});
 }
 return points;
}
function segment(input,{softWords=12,maxWords=18,preserveCommands=true}={}){
 if(typeof input!=='string')throw TypeError('A fala deve ser um texto.');
 if(!Number.isFinite(softWords)||!Number.isFinite(maxWords)||softWords<8||maxWords<softWords)throw RangeError('Limites da fala inválidos.');
 if(!input.trim())return [];
 const cuts=[{at:0,boundary:'start'},...sentenceBoundaries(input),...commandStarts(input).map(at=>({at,boundary:'command'})),{at:input.length,boundary:'end'}].sort((a,b)=>a.at-b.at);
 const unique=cuts.filter((cut,i)=>!i||cut.at!==cuts[i-1].at),out=[];
 function push(start,end,boundary){while(start<end&&/\s/u.test(input[start]))start++;while(end>start&&/\s/u.test(input[end-1]))end--;if(end>start)out.push({text:input.slice(start,end),start,end,boundary,command:isCommand(input.slice(start,end))});}
 for(let n=0;n<unique.length-1;n++){
  const begin=unique[n].at,end=unique[n+1].at,text=input.slice(begin,end);
  if(preserveCommands&&isCommand(text)){push(begin,end,'command');continue;}
  let start=begin;
  // Distinct explicit intents are stronger boundaries than a fixed word count.
  for(const hit of text.matchAll(idea)){
   let at=begin+hit.index;
   const before=input.slice(start,at),join=before.match(/\s+(?:e|aí|ai|então|entao|and|then)\s+$/iu);
   if(join)at-=join[0].length-1;
   if(words(input.slice(start,at))<5||subordinateBefore(input,begin+hit.index)||quotedAt(input,begin+hit.index))continue;
   push(start,at,'idea');start=at;
  }
  // Long descriptions can split at explicit discourse transitions without
  // separating a number from its unit or an experiment from its conditions.
  const tail=input.slice(start,end);let base=start;
  for(const hit of tail.matchAll(conjunction)){
   const at=base+hit.index+hit[0].length;
   if(words(input.slice(start,at))<softWords||words(input.slice(at,end))<5||quotedAt(input,at))continue;
   push(start,at,'transition');start=at;
  }
  push(start,end,unique[n+1].boundary);
 }
 const logical=out.splice(0);
 for(const part of logical){
  if(preserveCommands&&part.command){out.push(part);continue;}
  let start=part.start;const end=part.end;
  // Browser finals and imported turns may contain minutes without punctuation.
  // Keep every ordinary slice short; a safe unit boundary takes precedence over
  // a discourse marker. Capture time is measured elsewhere, never inferred here.
  while(words(input.slice(start,end))>maxWords){
   const tokens=[...input.slice(start,end).matchAll(/\S+/gu)],candidates=[];
   const safe=i=>{const right=tokens[i]?.[0]||'';return !quotedAt(input,start+tokens[i].index)&&! /^(?:(?:[kcm]?n(?:[·/]m)?|[kcm]?m|kg|gpa|mpa|pa|graus|metros?|centímetros?|centimetros?|milímetros?|milimetros?|quilonewtons?|newtons?)\b|[%°])/iu.test(right);};
   for(let i=Math.max(8,Math.floor(softWords*.7));i<=Math.min(tokens.length-1,maxWords);i++){
    const previous=tokens[i-1][0],next=tokens[i][0];
    if(safe(i)&&(/[,;:]$/.test(previous)||/^(?:e|mas|porém|porem|então|entao|agora|porque|para|and|but|then)$/iu.test(next)))candidates.push(i);
   }
   let index=candidates.length?candidates.reduce((a,b)=>Math.abs(b-softWords)<Math.abs(a-softWords)?b:a):maxWords;
   while(index>0&&!safe(index))index--;
   // A quotation is atomic so quoted instructions never turn into executable
   // commands in a subsequent slice. Preserve it rather than removing quotes.
   if(!index){index=maxWords;while(index<tokens.length&&!safe(index))index++;if(index===tokens.length)break;}
   const at=start+tokens[index].index;
   push(start,at,'readability');start=at;
  }
  push(start,end,part.boundary);
 }
 return out;
}
function split(text,options){return segment(text,options).map(part=>part.text);}
function entries(entry,source=entry.source||'text'){
 const original=entry.sourceText||entry.text,parts=segment(entry.text);
 return parts.map((part,index)=>({text:part.text,source,speaker:entry.speaker,offsetMs:entry.offsetMs,endOffsetMs:entry.endOffsetMs,sourceId:entry.sourceId,segmentId:entry.segmentId,sourceText:index===0?original:undefined,...(index||entry.speechContext?{speechContext:boundedContext([entry.speechContext,entry.text.slice(0,part.start)].filter(Boolean).join(' '))}:{})}));
}
function boundedContext(text){return String(text||'').trim().split(/\s+/u).slice(-60).join(' ').slice(-1600);}
// Capture windows remain short. Only a literally unfinished non-command clause
// may wait for its next window; this never invents a value or rewrites speech.
function unfinished(text){
 text=String(text||'').trim();
 if((isCommand(text)&&/^norte\b/iu.test(normalizeCommand(text)))||/[.!?…]$/u.test(text))return false;
 // \b is ASCII-only in JavaScript: "tensão" would end in the article "o". Use letter-aware edges.
 return /(?<![\p{L}\p{N}])(?:de|do|da|dos|das|para|pra|por|com|uma?|o|a|que|se|então|entao|vai|vou|vamos|suger|consegui)\s*$/iu.test(text)||/(?<![\p{L}\p{N}])(?:de|para|pra|em)\s+\d+(?:[.,]\d+)?\s*$/iu.test(text);
}
function canContinue(previous,next){
 if(!unfinished(previous)||!String(next||'').trim()||isCommand(next))return false;
 // An explicit new assertion, contrast or topic switch must stay independent.
 if(/^(?:(?:ah|e|tá|ta|então|entao|beleza)\s*[,;]?\s*)*(?:não|nao|mas|talvez|uma hipótese|uma hipotese|outra|outro|agora|voltando|o resultado|a gente|nós|nos|eu (?:acho|quero|queria|preciso)|vamos|decidimos|mude|muda|altere|altera|reduza|reduz|aumente|aumenta|adicione|adiciona|remova|remove|mostre|mostra|abra|abre)\b/iu.test(next))return false;
 return words(previous)+words(next)<=48;
}
return {segment,split,entries,isCommand,normalizeCommand,commandStarts,boundedContext,unfinished,canContinue};
});
