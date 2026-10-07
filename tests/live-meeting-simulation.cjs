// Explicit opt-in: a long Portuguese meeting spoken into the real app with real Jev calls.
// The microphone is replaced by a recognizer that behaves like Chrome's continuous
// recognition (word-by-word interim results, confirmation at pauses, deafness while
// restarting). Everything else is the production page, server and account storage.
// Credentials come from the environment and are never written by this script.
//   NORTE_URL=http://127.0.0.1:8000 NORTE_USER=… NORTE_PASSWORD=… node tests/live-meeting-simulation.cjs --run-live
// Optional: NORTE_SIGNUP=1 creates the account first; NORTE_SPEED=1.5 speaks faster.
if(!process.argv.includes('--run-live')){console.log('Use --run-live para simular a reunião com a API configurada (consome créditos).');process.exit(0);}
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {spawn}=require('node:child_process'),{setTimeout:sleep}=require('node:timers/promises');
const Speech=require('../meeting-speech.js');

// '/' short hesitation (no confirmation) · '//' pause long enough for the browser to confirm a phrase.
// [ms] at the start of a turn: silence before it (default 1300 ms).
const SCRIPT=[
 'bom dia pessoal / vamos começar // tá todo mundo me ouvindo',
 'tô ouvindo sim pode falar',
 'beleza // então a pauta de hoje é / primeiro a viga do suporte do motor // depois a fixação na fuselagem e por último a parte térmica',
 'então sobre a viga do suporte // o problema que a gente viu na semana passada era // que a tensão máxima no engaste tava passando de 250 megapascal na carga máxima',
 'e isso tá acima do limite que a gente definiu // que é 200 megapascal já com o fator de segurança',
 'eu acho que o problema é / a altura da seção // ela tá baixa demais pra esse comprimento',
 'é pode ser // a gente pode testar aumentar a altura da seção de 24 pra 30 centímetros e ver o que acontece com a tensão',
 'faz sentido // deixa eu abrir aqui',
 'norte vamos simular uma viga',
 '[2500] norte muda o comprimento da viga para 4 metros',
 'que é o nosso caso',
 'norte muda a força P1 para 25 quilonewtons',
 '[3000] tá vendo / com 24 centímetros a tensão fica bem alta',
 'norte muda a altura da seção para // 30 centímetros',
 '[2500] norte mostra os gráficos de momento fletor e cortante',
 'norte compara antes e depois',
 '[3000] olha só // o momento no engaste é o mesmo mas a tensão caiu bastante / ficou abaixo dos 200',
 'norte mostra os resultados',
 'beleza então tá decidido // a gente vai usar a seção de 30 centímetros na viga do suporte',
 'só uma dúvida / e se a gente usasse alumínio pra ficar mais leve',
 'norte usa alumínio 6061',
 '[3000] hum a flecha aumentou bastante né // quase o triplo',
 'é com alumínio não dá',
 'norte usa aço',
 'então fica o aço mesmo',
 'agora mudando de assunto // a fixação na fuselagem',
 'a gente testou e validou // os parafusos M8 aguentaram 18 quilonewtons no ensaio de arrancamento sem nenhuma deformação',
 'só que teve um detalhe // a chapa de reforço trincou perto do furo de baixo / na terceira repetição',
 'talvez seja // concentração de tensão porque o furo tá muito perto da borda',
 'então a gente vai / repetir o ensaio // com a distância do furo até a borda de pelo menos duas vezes o diâmetro',
 'na quarta repetição a carga de ruptura foi 21 / não pera // 23 quilonewtons',
 'beleza // último ponto / a análise térmica',
 'o requisito do cliente é que // a temperatura na carenagem não pode passar de 80 graus em operação contínua',
 'e o resultado da última medição foi // 72 graus na carenagem depois de 40 minutos de motor ligado',
 'a Júlia vai rodar a simulação térmica com o motor na potência máxima // e manda o resultado até sexta',
 'beleza / mais alguma coisa',
 'não acho que é isso',
 'então só resumindo // viga com 30 centímetros de altura / repetir o ensaio da chapa com o furo mais longe da borda // e a Júlia manda a térmica na sexta',
 'valeu pessoal até mais'
];
// Important information that must reach one single chunk intact (never split across chunks).
const KEY_FACTS=[
 ['problema relatado com o valor',/o problema que a gente viu.*era.*tens[aã]o m[aá]xima.*250 megapascal/],
 ['limite com o valor',/limite que a gente definiu.*200 megapascal/],
 ['hipótese sobre a altura',/problema [eé].*altura da se[cç][aã]o.*baixa/],
 ['proposta de teste 24→30 cm',/testar aumentar a altura da se[cç][aã]o de 24 pra 30 cent[ií]metros/],
 ['decisão da seção',/usar a se[cç][aã]o de 30 cent[ií]metros/],
 ['resultado do ensaio dos parafusos',/testou e validou.*M8.*18 quilonewtons/],
 ['trinca na chapa',/chapa de refor[cç]o trincou/],
 ['hipótese da borda',/talvez seja.*concentra[cç][aã]o de tens[aã]o.*borda/],
 ['proposta de repetir o ensaio',/repetir o ensaio.*duas vezes o di[aâ]metro/],
 ['correção 21→23 kN',/21.*n[aã]o pera.*23 quilonewtons/],
 ['requisito de temperatura',/temperatura.*n[aã]o pode passar de 80 graus/],
 ['resultado da medição térmica',/resultado da [uú]ltima medi[cç][aã]o foi.*72 graus/],
 ['tarefa da Júlia',/J[uú]lia.*simula[cç][aã]o t[eé]rmica.*at[eé] sexta/],
 ['decisão de ficar com o aço (fala após um comando)',/fica o a[cç]o mesmo/]
];
// Distinct facts that must not be fused into one chunk (over-merging hides events).
const SEPARATE=[
 ['resultado dos parafusos × trinca da chapa',/M8/,/trincou/],
 ['requisito de 80 graus × medição de 72 graus',/80 graus/,/72 graus/],
 ['pergunta ao grupo × resumo final',/mais alguma coisa/,/resumindo/],
 ['hipótese do alumínio × comando',/usasse alum[ií]nio/,/norte usa/]
];
const EXPECTED_COMMANDS=[
 ['abrir simulação',c=>c.operations.some(o=>o.type==='open_simulation')],
 ['comprimento 4 m',c=>c.operations.some(o=>o.type==='change_beam'&&o.patch?.L===4)],
 ['força P1 = 25 kN',c=>c.operations.some(o=>o.type==='update_load'&&o.patch?.value===25000)],
 ['altura 30 cm (comando dito em duas partes)',c=>c.operations.some(o=>o.type==='change_section'&&Math.abs(o.patch?.h-.3)<1e-9)],
 ['gráficos',c=>c.operations.some(o=>o.type==='show_graphs')],
 ['comparar antes e depois',c=>c.operations.some(o=>o.type==='compare')],
 ['resultados',c=>c.operations.some(o=>o.type==='show_results')],
 ['alumínio',c=>c.operations.some(o=>o.type==='change_material'&&o.patch?.key==='aluminum')],
 ['volta ao aço',c=>c.operations.some(o=>o.type==='change_material'&&o.patch?.key==='steel')]
];
const MIC=`(()=>{
 const mic=window.__mic={spoken:[],lost:[],sessions:0,confirmations:0,instances:[],active:null,done:false,log:[]};
 class SimRecognition{
  constructor(){this.results=[];this.current=null;this.state='idle';this.spoke=false;mic.instances.push(this);}
  start(){if(this.state!=='idle')throw new DOMException('already started','InvalidStateError');this.state='starting';mic.sessions++;this.startedAt=performance.now();
   setTimeout(()=>{if(this.state!=='starting')return;this.state='listening';mic.active=this;this.onstart?.();},300);}
  stop(){if(!['starting','listening'].includes(this.state))return;this.state='stopping';if(mic.active===this)mic.active=null;mic.log.push({stop:performance.now()});setTimeout(()=>{this.confirm();this.finish();},250);}
  abort(){this.state='stopping';if(mic.active===this)mic.active=null;this.current=null;setTimeout(()=>this.finish(),0);}
  finish(){if(this.state==='ended')return;this.state='ended';this.onend?.();}
  hear(word){if(!this.current){this.current={index:this.results.length,words:[]};if(!this.spoke){this.spoke=true;this.onspeechstart?.();}}this.current.words.push(word);this.publish(false);}
  confirm(){if(!this.current)return;this.publish(true);this.current=null;mic.confirmations++;}
  publish(isFinal){const c=this.current,result=[{transcript:(c.index?' ':'')+c.words.join(' '),confidence:isFinal?.93:.6}];result.isFinal=isFinal;this.results[c.index]=result;this.onresult?.({results:this.results,resultIndex:c.index});}
 }
 window.SpeechRecognition=window.webkitSpeechRecognition=SimRecognition;
 const wait=ms=>new Promise(r=>setTimeout(r,ms));
 mic.speak=async(turns,{wordMs=340,speed=1}={})=>{
  const scale=ms=>ms/speed;
  for(const turn of turns){
   const gap=turn.match(/^\\[(\\d+)\\]\\s*/);await wait(scale(gap?Number(gap[1]):1300));
   // Long silence: the browser confirms what it heard.
   mic.active?.confirm();
   const tokens=(gap?turn.slice(gap[0].length):turn).split(/\\s+/);
   for(const token of tokens){
    if(token==='/'){await wait(scale(350));continue;}
    if(token==='//'){await wait(scale(1000));mic.active?.confirm();continue;}
    await wait(scale(wordMs*(0.75+Math.random()*0.5)));
    mic.spoken.push(token);
    if(mic.active)mic.active.hear(token);else mic.lost.push({word:token,index:mic.spoken.length-1});
    // Run-on speech: browsers also confirm very long phrases on their own.
    if(mic.active?.current?.words.length>=30)mic.active.confirm();
   }
  }
  await wait(scale(1500));mic.active?.confirm();mic.done=true;
 };
})();`;

(async()=>{
 const base=(process.env.NORTE_URL||'http://127.0.0.1:8000').replace(/\/$/,''),user=process.env.NORTE_USER,password=process.env.NORTE_PASSWORD;
 assert.ok(user&&password,'Defina NORTE_USER e NORTE_PASSWORD.');
 const speed=Number(process.env.NORTE_SPEED||1),title=process.env.NORTE_TITLE||'Revisão de projeto — suporte do motor';
 const out=path.resolve(__dirname,'..','.runtime','simulation');await fs.mkdir(out,{recursive:true});
 const profile=await fs.mkdtemp(path.join(os.tmpdir(),'norte-live-simulation-'));
 const chrome=spawn(process.env.CHROME_BIN||'google-chrome',['--headless','--no-sandbox','--disable-gpu','--remote-debugging-port=0','--no-first-run','--user-data-dir='+profile,'about:blank'],{stdio:'ignore'});
 let socket;const errors=[];
 try{
  let port;for(let i=0;i<200;i++){try{port=(await fs.readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch(_){await sleep(50);}}assert.ok(port,'Chrome não iniciou');
  const tabs=await fetch('http://127.0.0.1:'+port+'/json/list').then(r=>r.json());socket=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise(r=>socket.addEventListener('open',r,{once:true}));
  let next=0;const pending=new Map();
  socket.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails?.exception?.description||m.params.exceptionDetails?.text);if(m.method==='Page.javascriptDialogOpening')call('Page.handleJavaScriptDialog',{accept:true}).catch(()=>{});if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}});
  const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||JSON.stringify(r.exceptionDetails));return r.result.value;};
  const wait=async(expression,ms=60000)=>{const end=Date.now()+ms;while(Date.now()<end){try{if(await evaluate(expression))return;}catch(_){}await sleep(200);}throw Error('Tempo esgotado: '+expression);};
  const click=selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const shot=async name=>{const image=await call('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(out,name+'.png'),Buffer.from(image.data,'base64'));};
  await call('Runtime.enable');await call('Page.enable');
  await call('Page.addScriptToEvaluateOnNewDocument',{source:MIC});
  await call('Emulation.setDeviceMetricsOverride',{width:1500,height:950,deviceScaleFactor:1,mobile:false});

  // Sign in like a person would: the sign-in page, then the meeting list.
  await call('Page.navigate',{url:base+'/login'+(process.env.NORTE_SIGNUP==='1'?'#criar-conta':'')});
  await wait('!!document.querySelector("#authForm")');
  await evaluate(`(()=>{const set=(id,v)=>{const n=document.getElementById(id);n.value=v;n.dispatchEvent(new Event('input',{bubbles:true}));};set('username',${JSON.stringify(user)});set('password',${JSON.stringify(password)});if(document.getElementById('confirm')&&!document.getElementById('signupFields').hidden)set('confirm',${JSON.stringify(password)});document.getElementById('authSubmit').click();})()`);
  await wait('location.pathname==="/" && document.body.dataset.page==="beam" && window.NorteMeetingRoom?.ready() && !document.querySelector("#roomNew").disabled',90000);
  const role=await evaluate('document.body.dataset.role');console.log('Conta:',user,'·',role);

  await click('#roomNew');await click('#roomCreateInstant');
  await wait('NorteMeetingRoom.snapshot()?.status==="draft"');
  await evaluate(`(()=>{const t=document.querySelector('#roomTitle');t.value=${JSON.stringify(title)};t.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await wait('!document.querySelector("#roomLive").disabled',30000);await click('#roomLive');
  try{await wait('!!window.__mic.active',20000);}catch(error){await shot('erro-microfone');throw Error(error.message+' · aviso na tela: '+await evaluate('document.querySelector("#roomNotice").textContent'));}
  console.log('Reunião iniciada:',title,'· falando',SCRIPT.length,'falas…');
  const started=Date.now();
  await evaluate(`(window.__speaking=__mic.speak(${JSON.stringify(SCRIPT)},{speed:${speed}}),true)`);

  // Live progress: chunks and commands as the pipeline produces them.
  const seen=new Set();
  const progress=async()=>{
   const rows=await evaluate(`(()=>{const r=NorteMeetingRoom.snapshot();if(!r)return [];const out=[];
    for(const c of r.batch.cases){const rec=r.records.find(x=>x.id===c.id);out.push({key:'c'+c.id+(rec?.status||''),line:c.id+' '+(rec?.status==='done'?(rec.result.store?rec.result.type:'ignorado'):'…')+(c.source_entry_ids?.length>1?' ['+c.source_entry_ids.length+' pedaços]':'')+' '+c.current_utterance,done:rec?.status==='done'});}
    for(const b of r.beam_commands||[])out.push({key:'b'+b.id+b.status,line:b.id+' comando '+b.status+' '+(b.operations||[]).map(o=>o.type).join('+')+' ← '+b.text,done:true});
    return out;})()`);
   for(const row of rows)if(row.done&&!seen.has(row.key)){seen.add(row.key);console.log('  ',((Date.now()-started)/1000).toFixed(0).padStart(4)+'s',row.line.slice(0,150));}
  };
  while(!await evaluate('__mic.done')){await progress();await sleep(1500);}
  // Let the pipeline catch up, then finish the meeting with the regular button.
  await wait('(()=>{const r=NorteMeetingRoom.snapshot();return r.transcript.every(x=>["done","command","error"].includes(x.status));})()',180000);await progress();
  await shot('reuniao-final-canvas');
  await click('#roomFinish');
  await wait('["done","interrupted"].includes(NorteMeetingRoom.snapshot()?.status)',600000);await progress();
  // The final save must reach the account: flush it and read it back from the server.
  assert.equal(await evaluate('NorteMeetingRoom.flushStorage()'),true,'final save');
  const stored=await evaluate(`fetch('/api/records?key='+encodeURIComponent('norte.meeting-room.session.v2.'+NorteMeetingRoom.snapshot().id)).then(r=>r.json()).then(b=>JSON.parse(b.value).status)`);
  assert.equal(stored,(await evaluate('NorteMeetingRoom.snapshot().status')),'the account holds the finished meeting');
  // Reopening validates the whole saved meeting, including how speech pieces were joined.
  assert.equal(await evaluate(`(()=>{try{NorteMeetingSession.restore(NorteMeetingRoom.snapshot());return 'ok';}catch(error){return error.message;}})()`),'ok','the saved meeting reopens');

  // Evaluation.
  const run=await evaluate('NorteMeetingRoom.snapshot()'),mic=await evaluate('({spoken:__mic.spoken,lost:__mic.lost,sessions:__mic.sessions,confirmations:__mic.confirmations,stops:__mic.log.length})');
  const confirmed=run.speech_ledger.records.filter(r=>r.status==='final').map(r=>r.text.trim()).join(' ').split(/\s+/).filter(Boolean);
  const chunks=run.batch.cases.map(c=>({id:c.id,text:c.current_utterance,pieces:c.source_entry_ids?.length||1,record:run.records.find(r=>r.id===c.id)}));
  const commandTexts=(run.beam_commands||[]).map(c=>c.text);
  const facts=KEY_FACTS.map(([name,pattern])=>{const chunk=chunks.find(c=>pattern.test(c.text)),command=commandTexts.find(t=>pattern.test(t));return {name,ok:!!chunk,stored:!!chunk?.record?.result?.store,type:chunk?.record?.result?.type||null,chunk:chunk?.id||null,text:chunk?.text||command||null};});
  const fused=SEPARATE.map(([name,a,b])=>({name,ok:!chunks.some(c=>a.test(c.text)&&b.test(c.text))&&!commandTexts.some(t=>a.test(t)&&b.test(t))}));
  const applied=(run.beam_commands||[]).filter(c=>c.status==='applied');
  const commands=EXPECTED_COMMANDS.map(([name,match])=>({name,ok:applied.some(match)}));
  const state=run.beam_lab?.state;
  const cut=chunks.filter(c=>Speech.unfinished(c.text)).map(c=>c.id+': '+c.text);
  const gate=run.records.flatMap(r=>r.segmentation?.checks||[]).concat((run.beam_commands||[]).flatMap(c=>c.segmentation?.checks||[]));
  const report={title,user,status:run.status,durationSec:Math.round((Date.now()-started)/1000),words:{spoken:mic.spoken.length,confirmed:confirmed.length,lost:mic.lost},microphone:{sessions:mic.sessions,forcedStops:mic.stops,confirmations:mic.confirmations},
   chunks:chunks.length,merged:chunks.filter(c=>c.pieces>1).length,gate:{checks:gate.length,waits:gate.filter(c=>c.wait).length,literal:gate.filter(c=>c.literal).length,errors:gate.filter(c=>c.error).length},
   keyFacts:facts,separated:fused,commands,hypotheticalNotExecuted:!(run.beam_commands||[]).some(c=>c.status==='applied'&&/usasse/.test(c.text)),
   finalState:state&&{L:state.L,P1:state.loads.find(l=>l.name==='P1')?.value,h:state.section.h,material:state.material.key},
   possiblyCut:cut,events:run.meeting_events.length,threads:run.meeting_threads.length,calls:run.calls,pageErrors:errors};
  await fs.writeFile(path.join(out,'report.json'),JSON.stringify({...report,chunksDetail:chunks.map(c=>({id:c.id,pieces:c.pieces,type:c.record?.result?.destination,text:c.text,checks:c.record?.segmentation?.checks}))},null,1));
  await shot('reuniao-final');

  console.log('\n=== Relatório ===');
  console.log('Status da reunião:',run.status,'· duração',report.durationSec+'s','· chamadas ao Jev',run.calls);
  console.log('Palavras faladas',mic.spoken.length,'· confirmadas',confirmed.length,'· perdidas',mic.lost.length,mic.lost.length?JSON.stringify(mic.lost.map(l=>l.word)):'');
  console.log('Microfone: sessões',mic.sessions,'· paradas forçadas',mic.stops);
  console.log('Chunks',chunks.length,'· juntados pelo Jev',report.merged,'· checagens',gate.length,'(esperou',report.gate.waits+')');
  for(const f of facts)console.log((f.ok?'  OK  ':'  FALHOU ')+f.name.padEnd(36)+(f.ok?' '+f.chunk+' '+(f.stored?f.type:'NÃO ARMAZENADO'):'')+(f.ok?'':'  → '+JSON.stringify(chunks.filter(c=>f.name&&KEY_FACTS.find(k=>k[0]===f.name)[1].source.split('.*').some(part=>new RegExp(part).test(c.text))).map(c=>c.text))));
  for(const f of fused)console.log((f.ok?'  OK  ':'  FALHOU ')+'separados: '+f.name);
  for(const c of commands)console.log((c.ok?'  OK  ':'  FALHOU ')+'comando: '+c.name);
  console.log('Chunks com mais de 3 pedaços:',chunks.filter(c=>c.pieces>3).map(c=>c.id+'('+c.pieces+')').join(' ')||'nenhum');
  console.log((report.hypotheticalNotExecuted?'  OK  ':'  FALHOU ')+'hipótese "e se a gente usasse alumínio" não executada');
  console.log('Estado final da viga:',JSON.stringify(report.finalState));
  if(cut.length)console.log('Possivelmente cortados:',cut);
  if(errors.length)console.log('Erros na página:',errors);
  const failures=facts.filter(f=>!f.ok||!f.stored).length+fused.filter(f=>!f.ok).length+commands.filter(c=>!c.ok).length+(report.hypotheticalNotExecuted?0:1)+mic.lost.length+(run.status==='done'?0:1);
  console.log(failures?'\n'+failures+' problema(s).':'\nTudo certo.');
  process.exitCode=failures?1:0;
 }finally{socket?.close();chrome.kill();await sleep(300);await fs.rm(profile,{recursive:true,force:true}).catch(()=>{});}
})().catch(error=>{console.error(error);process.exit(1);});
