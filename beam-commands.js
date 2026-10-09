/* Controlled beam commands: literal parameters + choice validation, never solver mutation. */
(function (root) {
  'use strict';
  const E = typeof module !== 'undefined' && module.exports ? require('./experiments.js') : root.NorteExperiments;
  const clone = value => JSON.parse(JSON.stringify(value));
  const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[−–]/g, '-');
  const threshold = .8;
  const types = ['open_simulation','change_beam','load','support','change_section','change_material','show_graphs','show_inspection','compare','compound','other_command','conversation'];
  const defaults = {questions:{
    beam_action:{type:'choice',instructions:'Classify the requested operation in utterance, the interpreted command. raw_utterance preserves original speech. interpretation records deterministic, authorized context completion and ASR correction; use it rather than requiring a literal wake word or perfect sentence. A direct simulation invitation or navigation needs no Norte. Existing simulation context may resolve a unique force, visible unit, recent field or pending command. Quotation, negation, hypothetical and discussion are conversation and must not execute. Do not reject an authorized normalization solely because its raw ASR spelling differs. Never invent a target or value beyond the supplied interpretation. Select compound for multiple explicit operations.',criteria:{
      open_simulation:'Open or begin viewing the beam simulator, with no mandatory wake word: quero fazer uma simulação; vamos simular uma viga; abra o simulador.',
      change_beam:'Change beam length, total manually applied beam mass or gravity. Not cross section or material.',
      load:'Add, update, move, reverse or remove one applied force, mass, moment or uniform distributed load.',
      support:'Add, update, move or remove a support: pin/articulado, roller/rolete or fixed/engaste.',
      change_section:'Change cross-section shape or explicit width/height/web/flange thickness. Section geometry only.',
      change_material:'Select a material or change explicitly stated Young modulus, yield stress or density.',
      show_graphs:'Show shear, bending moment or deflection diagrams (gráficos/diagramas de cortante, momento fletor, flecha), including several named diagrams.',
      show_inspection:'Navigate to the numerical results tab (resultados), calculations/dependency map (cálculos), meeting canvas or cross-section editor, even if that tab was never opened. Includes going back to these tabs. "Mostre os resultados" is this, not diagrams.',
      compare:'Compare the previous/baseline configuration with the current one, without changing it.',
      compound:'Two or more explicit operations, e.g. open simulator AND set beam length; not a list of fields on one item.',
      other_command:'A direct simulator operation that is not supported above, including resetting or deleting everything.',
      conversation:'Ordinary discussion, proposals to colleagues, negated/hypothetical instructions, quotations, examples, no direct simulator operation.'
    }},
    action_mode:{type:'choice',instructions:'Classify the requested operation mode. Consider intent, not whether deterministic parsing succeeded. Different modes in one utterance are mixed. A load/support update changes an existing item. Adding a new load/support is add. Cross-section/material/beam edits are change.',criteria:{add:'Explicit addition of a load or support.',update:'Edit, move or reverse an existing load or support.',remove:'Remove an explicitly targeted load or support.',change:'Change beam, section or material parameters.',view:'Open simulator, show graphs/results/calculations or compare.',mixed:'Several distinct operation modes requested together.',not_applicable:'No supported direct operation.'}},
    candidate_fit:{type:'choice',instructions:'Validate candidate against interpreted utterance, interpretation and current context. Raw speech is audit evidence, not a veto on authorized normalization: km→kN is allowed ONLY for a clearly targeted force magnitude, never position/length; omitted units may use that field visible unit; a short follow-up may use the single recent field or pending value. relative_percentage computes a destination from baseline_si and the requested percent; validate that arithmetic, not literal numeric equality between percent and destination. For aumente/reduza, "em" requests a delta; "para" an absolute destination. These rules do not invent targets or measurements. Exact requires all requested operations, values and targets represented correctly. No extra fields are required for an update. Opening/navigation/show/compare are complete view operations with no new physical parameters. New loads need position and magnitude; a new force or distributed load said without a sense acts downward (default_direction normalization), like mass; moments need their sense. Compare quantities by their stated units and equivalent_si. A candidate with issues is not exact. Reject negation, quotation, hypothesis, unresolved targets or a genuinely contradictory interpreted candidate.',criteria:{exact:'Candidate faithfully implements the interpreted request and documented contextual normalization; no issues or unresolved fields.',incomplete:'A required value, unit, position, orientation or target remains absent after permitted context completion.',contradicted:'Candidate differs from the interpreted request or applies a normalization incompatible with the target dimension.',ambiguous:'Several targets or fields remain possible, unsupported geometry/material, or conflicting values.',not_applicable:'Conversation or unsupported operation with no executable candidate.'}}
  }};
  const examples = [
    'Quero abrir a simulação.', 'Vamos simular uma viga.', 'Mude o comprimento da viga para 10 metros.',
    'Norte, adicione uma força de 12 kN para baixo a 10 m.', 'Norte, mude a força P1 para 15 kN.',
    'Norte, mova a carga P1 para 3,5 m.', 'Norte, inverta o sentido da força P1.',
    'Norte, adicione um momento de 8 kN·m no sentido horário a 4 m.',
    'Norte, adicione uma carga distribuída de 2 kN/m para baixo de 1 m até 5 m.',
    'Norte, adicione um apoio articulado no início.', 'Norte, mude o apoio A para rolete.',
    'Norte, remova a carga P1.', 'Norte, mude a seção para perfil I.',
    'Norte, mude a espessura da alma para 12 mm.', 'Norte, mude a altura da seção para 300 mm.',
    'Norte, use alumínio 6061-T6.', 'Norte, defina o módulo de elasticidade para 200 GPa.',
    'Norte, mostre os gráficos de cortante, momento fletor e flecha.',
    'Norte, mostre os resultados.', 'Norte, mostre os cálculos.', 'Norte, compare antes e depois.'
  ];
  const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const colloquialVerbs = {compara:'compare',usa:'use',utiliza:'utilize',troca:'troque',adiciona:'adicione',acrescenta:'acrescente',insere:'insira',aplica:'aplique',move:'mova',desloca:'desloque',posiciona:'posicione',inverte:'inverta',remove:'remova',retira:'retire',tira:'retire',tire:'retire',apaga:'apague',exclui:'exclua',define:'defina',ajusta:'ajuste',cria:'crie',coloca:'coloque',bota:'coloque',bote:'coloque',poe:'coloque',ponha:'coloque',muda:'mude',altera:'altere',mostra:'mostre',exibe:'exiba',abre:'abra',volta:'volte',simula:'simule'};
  const imperative = /^(?:(?:por favor|agora)\s*[, ]*)?(?:abra|abre|abrir|mostre|mostra|mostrar|exiba|exibe|veja|compare|comparar|simule|simular|vamos (?:simular|variar|mudar|alterar)|quero (?:simular|ver|abrir|mudar|alterar|adicionar)|mude|muda|altere|alterar|troque|defina|definir|ajuste|coloque|coloca|adicione|adicionar|insira|acrescente|aplique|mova|desloque|posicione|leve|inverta|remova|retire|apague|exclua|use|utilize|aumente|reduza|crie|criar|reinicie|limpe)\b/;
  const beamWords = /\b(?:canvas|simulacao|simulador|viga|carga|forca|momento|apoio|rolete|engaste|articulado|comprimento|tamanho|secao|perfil|largura|altura|espessura|alma|mesa|flange|material|aco|aluminio|modulo|elasticidade|escoamento|densidade|grafico|graficos|diagrama|diagramas|cortante|flecha|deflexao|resultados|calculos|gravidade|massa|p\d+|s\d+)\b/;
  // Correct a small navigation vocabulary only. Numbers, units, identifiers and
  // engineering properties are never fuzzily rewritten.
  const navigationSpelling = {abirr:'abrir',abir:'abrir',arbir:'abrir',abrirr:'abrir',simulacoa:'simulacao',simulacaoo:'simulacao',simualcao:'simulacao',simulcao:'simulacao',simulaccao:'simulacao',simuladorr:'simulador',simualr:'simular',simualdor:'simulador',caluculos:'calculos',resutados:'resultados'};
  function viewRequest(body) {
    const sentence=body.replace(/[.!?]+$/,'').trim();
    if(!/^(?:(?:eu|voce)\s+)?(?:quero|queria|gostaria|preciso|pode|poderia|consegue|conseguiria|podemos|vamos|bora|abrir|abra|abre|fazer|faca|faz|rodar|rode|roda|iniciar|inicie|inicia|comecar|comece|comeca|acessar|acesse|acessa|ver|mostrar|mostre|mostra|simular|simule|simula)\b/.test(sentence))return null;
    const open=sentence.match(/^(?:(?:eu\s+)?(?:quero|queria|gostaria de|preciso(?: de)?)\s+|(?:voce\s+)?(?:pode|poderia|consegue|conseguiria|podemos)\s+|(?:vamos|bora)\s+)?(?:(?:me\s+)?(?:abrir|abra|abre|fazer|faca|faz|rodar|rode|roda|iniciar|inicie|inicia|comecar|comece|comeca|acessar|acesse|acessa|ver|mostrar|mostre|mostra)\s+(?:(?:para|pra)\s+mim\s+)?(?:(?:a|o|uma|um|essa|esse)\s+)?(?:simulacao|simulador)(?:\s+(?:de|da|de uma|da nossa)\s+viga)?|(?:simular|simule|simula)(?:\s+(?:(?:uma|a|essa|esta)\s+)?viga)?|(?:uma|a)\s+simulacao)(.*)$/);
    if(!open)return null;
    const tail=open[1].trim();
    // Preserve physical parameters/compound operations for the regular parser.
    // Discussion, delayed wishes and a different simulation are not navigation.
    if(tail&&!/^(?:de\s+[-+\d]|de\s+(?:um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez)\b|com\b|e\s+(?:mude|muda|altere|altera|adicione|adiciona|coloque|coloca|mostre|mostra|reduza|reduz|aumente|aumenta)\b|;)/.test(tail))return null;
    return 'abra o simulador'+(tail?' '+tail:'');
  }
  function literalInvocation(text, options={}) {
    const value=normalize(text).trim(),wake=value.match(/^(?:(?:ok|okay|ola|ei)\s*[,!:;.\-]?\s*)?norte(?=$|[\s,!:;.\-])\s*[,!:;.\-]?\s*/);
    const body=(wake?value.slice(wake[0].length):value).replace(/^(?:por favor|agora)\s*[, ]*/,'').replace(/[, ]+por favor[.!]?$/,'');
    const explicit=imperative.test(body),contextual=!wake&&(options.simulationActive===true||options.active===true)&&explicit;
    const quoted=/^["'“‘]/.test(value)||/^(?:se|quando|por exemplo|diga|fale|imagine|suponha)\b/.test(body);
    const relevant=(beamWords.test(body)||/^compare\b/.test(body))&&!/\b(?:titulo|assunto|topico|thread)\b/.test(body);
    return {addressed:!!wake,contextual,body,eligible:!quoted&&explicit&&relevant&&(!!wake||contextual)};
  }
  function recentAudit(audit,options={}) {
    if(!audit||typeof audit!=='object')return null;
    const at=Date.parse(audit.continuation_started_at||audit.created_at||audit.createdAt||''),now=options.nowMs??Date.now();
    const lifetime=audit.status==='awaiting_continuation'?15000:60000;
    if(options.speaker&&audit.speaker&&normalize(options.speaker)!==normalize(audit.speaker))return null;
    return Number.isFinite(at)&&(now-at>lifetime||at-now>5000)?null:audit;
  }
  function contextData(options={}) {
    const source=options.context||{};
    let pending=recentAudit(source.pendingAudit||source.pending_audit||options.pendingAudit,options);
    const recent=(source.recentTranscript||source.recent_transcript||[]).slice(-6),lastRow=recent.at(-1),lastText=typeof lastRow==='string'?lastRow:lastRow?.text;
    const adjacent=!lastText||normalize(lastText).trim()===normalize(pending?.raw_text||pending?.text||'').trim()||(lastRow?.id&&pending?.source_entry_ids?.includes(lastRow.id))||(lastRow?.command_id&&lastRow.command_id===pending?.id);
    if(pending?.status==='awaiting_continuation'&&(options.source!=='microphone'||!adjacent))pending=null;
    return {pending,last:recentAudit(source.lastCommand||source.last_command||options.lastCommand,options),recent};
  }
  function uniqueLoad(text,state={}) {
    const all=state.loads||[],ids=all.filter(item=>[item.id,item.name].filter(Boolean).some(id=>new RegExp('\\b'+escape(normalize(id))+'\\b').test(text)));
    if(ids.length)return ids.length===1?ids[0]:null;
    if(/\b(?:p\d+|carga\s+[a-z]\d+|forca\s+[a-z]\d+)\b/.test(text))return null;
    const kind=/\bforca\b/.test(text)?'force':/\bmomento\b/.test(text)?'moment':/\bdistribuida\b/.test(text)?'udl':/\bmassa\b/.test(text)?'mass':null,list=kind?all.filter(item=>item.kind===kind):all;
    return list.length===1?list[0]:null;
  }
  const loadUnit=load=>({kN:'kN',N:'N',kNm:'kNm',Nm:'Nm',kNpm:'kN/m',Npm:'N/m',kg:'kg'})[load?.unit]||({force:'N',moment:'Nm',udl:'N/m',mass:'kg'})[load?.kind];
  function focusFromAudit(audit,state) {
    if(!audit)return null;
    const ops=audit.operations?.length?audit.operations:audit.candidate?.candidate_operations||audit.candidate?.operations||audit.candidate_operations||[];
    const physical=ops.filter(op=>/^(?:change_|update_)/.test(op.type));
    if(physical.length===1){const op=physical[0],patch=op.patch||{};
      if(op.type==='update_load'){
        const load=state.loads?.find(item=>item.id===op.id),fields=['value','x','end','direction'].filter(key=>Object.hasOwn(patch,key));
        if(load&&fields.length===1){const field=fields[0];return {type:'load',id:load.id,field,unit:field==='value'?loadUnit(load):field==='direction'?null:'m',dimension:field==='value'?load.kind:'length'};}
      }
      if(op.type==='change_beam'){const fields=Object.keys(patch);if(fields.length===1){const field=fields[0];return {type:'beam',field,unit:{L:'m',mbar:'kg',g:'m/s²'}[field],dimension:{L:'length',mbar:'mass',g:'acceleration'}[field]};}}
      if(op.type==='change_section'){const fields=Object.keys(patch);if(fields.length===1&&['b','h','tw','tf'].includes(fields[0]))return {type:'section',field:fields[0],unit:'mm',dimension:'length'};}
      if(op.type==='change_material'){const fields=Object.keys(patch).filter(key=>key!=='key');if(fields.length===1)return {type:'material',field:fields[0],unit:{E:'GPa',yield:'MPa',rho:'kg/m³'}[fields[0]],dimension:fields[0]==='rho'?'density':'pressure'};}
    }
    if(physical.length)return null;
    const text=normalize(audit.interpreted_text||audit.text||audit.raw_text||'');
    if(/\b(?:adicione|adicionar|insira|aplique|nova forca|nova carga|coloque uma)\b/.test(text))return null;
    if(/\b(?:e|depois)\s+(?:mude|mova|altere|defina|coloca|adicione)\b/.test(text))return null;
    if(/\b(?:forca|carga|momento|p\d+)\b/.test(text)){const load=uniqueLoad(text,state);if(load){const position=/\b(?:mova|mover|posicao|posicione|desloque)\b/.test(text);return {type:'load',id:load.id,field:position?'x':'value',unit:position?'m':loadUnit(load),dimension:position?'length':load.kind};}}
    const dimensions=[['tw',/\balma\b/],['tf',/\b(?:mesa|flange)\b/],['h',/\baltura\b/],['b',/\b(?:largura|base)\b/]].filter(([,regex])=>regex.test(text));
    if(dimensions.length>1||(dimensions.length&&/\bcomprimento\b/.test(text)))return null;
    if(dimensions.length)return {type:'section',field:dimensions[0][0],unit:'mm',dimension:'length'};
    if(/\b(?:comprimento|tamanho da viga)\b/.test(text))return {type:'beam',field:'L',unit:'m',dimension:'length'};
    return null;
  }
  function focusCommand(focus,value) {
    if(focus.type==='load')return (focus.field==='value'?'mude a carga ':focus.field==='end'?'mude o fim da carga ':'mova a carga ')+focus.id+' para '+value;
    if(focus.type==='beam')return 'mude '+({L:'o comprimento da viga',mbar:'a massa total da viga',g:'a gravidade'}[focus.field])+' para '+value;
    if(focus.type==='section')return 'mude '+({b:'a largura da seção',h:'a altura da seção',tw:'a espessura da alma',tf:'a espessura da mesa'}[focus.field])+' para '+value;
    if(focus.type==='material')return 'defina '+({E:'o módulo de elasticidade',yield:'a tensão de escoamento',rho:'a densidade'}[focus.field])+' para '+value;
    return null;
  }
  function interpret(text,options={}) {
    const raw=String(text??''),state=options.state||{},context=contextData(options),normalizations=[],issues=[];
    const record=(kind,from,to,reason,extra={})=>{if(from!==to)normalizations.push({kind,from,to,reason,...extra});return to;};
    let body=normalize(raw).trim();
    const politeAddress=/^(?:(?:ok|entao|ta|por favor)\s*[, ]*)?(?:norte\b[\s,]*)?(?:voce\s+)?poderia\b/.test(body);
    const guarded=/^["'“‘]|["“‘]\s*(?:norte|mude|mova|coloca|vamos simular|quero)/.test(body)||/\b(?:nao|nunca|nem|talvez|poderiamos|se fosse|por exemplo|hipoteticamente)\b/.test(body)||(/\bpoderia\b/.test(body)&&!politeAddress)||/^(?:se|quando|diga|fale|imagine|suponha)\b/.test(body)||/\b(?:disse|falou|exemplo de comando)\b/.test(body);
    if(guarded)return {raw_text:raw,interpreted_text:raw,normalizations,issues,guarded:true,addressed:false,contextual:false,eligible:false,body};
    const clean=body.replace(/^(?:(?:ta|entao|bom|bem|eh|e|ah|certo|beleza|ok|okay|tipo|assim|olha|vamos la)\b[\s,.:;-]*|o\s+(?=norte\b))+/,'');
    body=record('speech_filler',body,clean,'Remoção de hesitação inicial, sem descartar parâmetros.');
    const wake=body.match(/^(?:ola\s*[, ]*|ei\s*[, ]*)?norte\b[\s,!:;.—-]*/);if(wake)body=body.slice(wake[0].length);
    body=record('navigation_spelling',body,body.replace(/\b[a-z]+\b/g,word=>navigationSpelling[word]||word),'Correção limitada de grafia em palavras de navegação; medidas e alvos permanecem literais.');
    const pendingPrefix=context.pending?.status==='awaiting_continuation'?context.pending:null;
    const pendingAge=(options.nowMs??Date.now())-Date.parse(pendingPrefix?.continuation_started_at||pendingPrefix?.created_at||'');
    const previous=context.recent.at(-1),previousText=typeof previous==='string'?previous:previous?.text;
    const pendingAdjacent=!previousText||normalize(previousText).trim()===normalize(pendingPrefix?.raw_text||pendingPrefix?.text||'').trim()||(previous?.id&&pendingPrefix?.source_entry_ids?.includes(previous.id))||(previous?.command_id&&previous.command_id===pendingPrefix?.id);
    const canContinue=!wake&&options.source==='microphone'&&pendingPrefix&&pendingAge>=0&&pendingAge<=15000&&pendingAdjacent;
    if(canContinue){
      const prefix=normalize(pendingPrefix.interpreted_text||pendingPrefix.text||'');
      const tail=body.replace(/\b(?:kilo|quilo)\s*newtons?\b/g,'quilonewtons');
      const simulationTail=/^(?:(?:(?:para|pra)\s+)?(?:a gente|mim|nos|me)\s+)?(?:(?:abrir|abra|abre|mostrar|mostra|mostre|fazer|rodar)\s+)?(?:(?:a|o|uma|um)\s+)?(?:simulacao|simulador)(?:\s+(?:da|de|uma)\s+viga)?[.!?]?$/;
      if(simulationTail.test(tail)&&/\b(?:pode|poderia|quero|queria|gostaria|abrir|abra|mostrar|mostre|simular|simule)\b/.test(prefix)){
        body=record('pending_navigation',body,'abra o simulador','Complemento imediato de um pedido à plataforma para ver a simulação; nenhum parâmetro físico foi alterado.',{context_command_id:pendingPrefix.id||null});
      }else if(/\b(?:mudar|alterar|mude|altere)\s*$/.test(prefix)&&/^(?:para\s+)?[-+]?\d+(?:[.,]\d+)?\s*(?:kn|quilonewtons?|n|newtons?)[.!?]?$/.test(tail)){
        const forces=(state.loads||[]).filter(load=>load.kind==='force');
        if(forces.length===1)body=record('pending_force',body,'mude a forca '+forces[0].id+' para '+tail.replace(/^para\s+/,'').replace(/[.!?]$/,''),'Intensidade com unidade de força completa o pedido de mudança e identifica a única força existente.',{context_command_id:pendingPrefix.id||null,target_id:forces[0].id,field:'value'});
        else issues.push({code:'missing_context_field',message:'Há mais de uma força possível. Diga qual força deseja alterar.'});
      }else if(/\b(?:mudar|alterar|mude|altere)\s*$/.test(prefix)&&/^(?:para\s+)?[-+]?\d/.test(tail))issues.push({code:'missing_context_field',message:'Diga qual propriedade deseja alterar com esse valor.'});
    }
    body=body.replace(/^(?:por favor|agora)\s*[, ]*/,'').replace(/[, ]+por favor[.!]?$/,'');
    const simulationRequest=viewRequest(body);
    if(simulationRequest)body=record('simulation_intent',body,simulationRequest,'Pedido direto para abrir a simulação sem palavra de ativação; parâmetros adicionais ficam sujeitos à validação.');
    const verbs={ver:'mostre',mostrar:'mostre',abrir:'abra',voltar:'volte',mudar:'mude',alterar:'altere',aumentar:'aumente',reduzir:'reduza',diminuir:'reduza',colocar:'coloque',adicionar:'adicione',remover:'remova',mover:'mova',usar:'use',comparar:'compare'};
    let phrasing=body.replace(/^(?:eu|voce)\s+/,'').replace(/^(?:quero|queria|gostaria)\s+que\s+(?:(?:voce|ce)\s+)?/,'');
    phrasing=phrasing.replace(/^(?:(?:pode|poderia|consegue|conseguiria)(?:\s+(?:voce|me))?|quero|queria|gostaria de|preciso(?: de)?|vamos)\s+(?:testar\s+)?(ver|mostrar|abrir|voltar|mudar|alterar|aumentar|reduzir|diminuir|colocar|adicionar|remover|mover|usar|comparar)\b/,(_,verb)=>verbs[verb]);
    phrasing=phrasing.replace(new RegExp('^('+Object.keys(verbs).join('|')+')\\b'),verb=>verbs[verb]);
    if(wake&&/^(?:pode|poderia|quero|queria|gostaria de)\s+(?:(?:para|pra)\s+)?(?:a gente\s+)?(?:a\s+)?simulacao[.!?]?$/.test(phrasing))phrasing='abra o simulador';
    if(wake&&/^(?:(?:pode|poderia)\s+)?(?:fazer|rodar|simular)\s+(?:uma?\s+|a\s+)?(?:simulacao|viga)[.!?]?$/.test(phrasing))phrasing='abra o simulador';
    phrasing=phrasing.replace(/^(?:vamos deixar|deixa|deixe)\s+(.+?)\s+(?:em|pra|para)\s+([-+]?\d)/,'mude $1 para $2').replace(/^(aumenta|reduz|diminui|diminua)\b/,verb=>verb==='aumenta'?'aumente':'reduza').replace(/\?\s*$/,'');
    body=record('polite_request',body,phrasing,'Pedido operacional em linguagem coloquial, mantendo valor absoluto ou incremento.');
    // Spoken Brazilian Portuguese gives orders in the 3rd person ("compara", "usa", "tira").
    // Map them to the command forms at the start of each clause; targets and values are untouched.
    body=record('colloquial_imperative',body,body.replace(/(^|[;,]\s*|\b(?:e|depois|em seguida|e depois)\s+)(compara|usa|utiliza|troca|adiciona|acrescenta|insere|aplica|move|desloca|posiciona|inverte|remove|retira|tira|tire|apaga|exclui|define|ajusta|cria|coloca|bota|bote|poe|ponha|muda|altera|mostra|exibe|abre|volta|simula)(?=\s|$|[.,!?])/g,(match,lead,verb)=>lead+colloquialVerbs[verb]),'Imperativo coloquial do português falado convertido na forma do comando, sem alterar alvo ou valor.');
    // A new force or distributed load said without a sense acts downward, like gravity ("coloca uma carga de 5 kN no meio").
    if(/^(?:adicione|coloque|aplique|insira|acrescente|crie)\b/.test(body)&&/\b(?:uma|nova|outra)\s+(?:carga|forca)\b/.test(body)&&!/\b(?:momento|massa|kg|para baixo|para cima|horario|anti[- ]?horario|sentido|horizontal|inclinad[oa]|graus|esquerda|direita)\b/.test(body))
      body=record('default_direction',body,body.replace(/[.!?]*\s*$/,' para baixo'),'Carga nova sem sentido falado atua para baixo, como a gravidade.');
    body=record('spoken_preposition',body,body.replace(/\b(para|em|pra)(?=[-+]?\d)/g,'$1 ').replace(/\bpra\b/g,'para').replace(/\bpro\b/g,'para o'),'Forma coloquial da preposição, preservando o alvo.');
    body=record('spoken_quantity',body,spokenNumbers(body),'Número por extenso convertido sem alterar sua unidade.');
    body=record('beam_length_name',body,body.replace(/\btamanho (?:da|de uma|dessa|desta) viga\b/g,'comprimento da viga'),'“Tamanho da viga” identifica o comprimento longitudinal; dimensões da seção mantêm seus nomes.');
    body=record('beam_length_target',body,body.replace(/^(aumente|reduza|mude|altere|ajuste)\s+(?:(?:a|essa|esta)\s+)?viga\b/,'$1 o comprimento da viga'),'Alteração do tamanho da viga identifica seu comprimento; altura e largura exigem seus próprios nomes.');
    body=record('spoken_identifier',body,body.replace(/\bp\s+(um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez)\b/g,(_,word)=>'p'+spoken[word]),'Identificador P seguido de número por extenso.');
    body=record('spoken_identifier',body,body.replace(/\bp\s+(\d+)\b/g,(match,id)=>state.loads?.some(load=>normalize(load.id)==='p'+id||normalize(load.name)==='p'+id)?'p'+id:match),'Identificador já existente soletrado na fala.');
    const active=options.active===true||options.simulationActive===true,scope=active||!!wake||!!context.pending;
    const simulationMatches=[...body.matchAll(/(?:vamos simular|quero simular|simule|abr[ae](?: o)? simulador)(?:\s+(?:uma|a))?\s*(?:viga)?/g)];
    if(simulationMatches.length>1){const last=simulationMatches.at(-1),prefix=body.slice(0,last.index).trim();if(/^(?:(?:vamos|simular|quero|um|uma|a|o|teste|discussao|entao|ta|ah|e|fazer|isso)[\s,.;:-]*)+$/.test(prefix))body=record('speech_restart',body,body.slice(last.index),'Reinício da mesma intenção de abrir a simulação, sem parâmetros na hesitação anterior.');}
    const invitation=/^(?:vamos simular|quero simular|simule|abr[ae](?: o)? simulador)\b/.test(body)&&/\b(?:viga|simulador)\b/.test(body);
    const navigation=/^(?:volta|volte|voltar|retorna|retorne|vai|va|mostra|mostre|abre|abra|exiba|quero ver)\b/.test(body)&&/\b(?:canvas|mapa|simulacao|simulador|aba|resultados|graficos?|diagramas?|calculos|secao)\b/.test(body);
    const plainNavigation=/^(?:volta|volte|voltar|retorna|retorne|vai|va|mostra|mostre|abre|abra|exiba|quero ver)\s+(?:(?:para|em)\s+)?(?:(?:a|o|as|os)\s+)?(?:aba\s+(?:de\s+)?)?(?:canvas|mapa da reuniao|mapa de discussao|simulacao|simulador|resultados|calculos|mapa de dependencias|secao|graficos?|diagramas?|aba anterior|ultima aba)(?:\s+(?:da|de uma?)\s+viga)?[.!?]*$/;
    if(navigation&&plainNavigation.test(body)){
      let next=null;
      if(/\b(?:aba anterior|ultima aba)\b/.test(body)){const available=options.availableTabs||['canvas','simulation','graphs','results','calculations'];if(options.previousTab&&available.includes(options.previousTab))next=options.previousTab;else issues.push({code:'missing_previous_tab',message:'Ainda não há uma aba anterior definida. Diga qual vista deseja abrir.'});}
      else if(/\b(?:canvas|mapa da reuniao|mapa de discussao)\b/.test(body))next='canvas';
      else if(/\b(?:simulacao|simulador)\b/.test(body))next='simulation';
      else if(/\bresultados\b/.test(body))next='results';
      else if(/\b(?:calculos|mapa de dependencias)\b/.test(body))next='calculations';
      else if(/\bsecao\b/.test(body))next='section';
      else if(/\b(?:graficos?|diagramas?)\b/.test(body))next='graphs';
      const names={canvas:'mostre o canvas',simulation:'abra o simulador',results:'mostre os resultados',calculations:'mostre os cálculos',section:'mostre a seção',graphs:'mostre os gráficos'};
      if(next&&(!/\be\b/.test(body)||next==='graphs')){let replacement=names[next];if(next==='graphs'&&/\b(?:cortante|fletor|momento|flecha|deflexao)\b/.test(body))replacement=body.replace(/^(?:volta|volte|voltar|retorna|retorne|vai|va|abre|abra)/,'mostre');body=record('navigation',body,normalize(replacement),'Navegação para a vista solicitada.',{target_tab:next});}
    }
    body=record('unit_spelling',body,body.replace(/\bk\s+n\b/g,'kn').replace(/\b(?:quilo|kilo)\s*newtons?\b/g,'quilonewtons'),'Grafia da unidade reconhecida na fala.');
    body=record('trailing_hesitation',body,body.replace(/\b(para|em)\s+(?:me|eh|hum|ahn)[.!]?$/,'$1'),'Hesitação após a preposição de destino mantém o pedido incompleto.');
    // Capture boundaries are not sentence boundaries. Complete only an adjacent,
    // same-speaker request, retaining its target and the distinction de/para/em.
    if(canContinue&&!imperative.test(body)){
      const prefix=normalize(pendingPrefix.interpreted_text||pendingPrefix.text||'').replace(/^norte[\s,]*/,''),tail=body.replace(/^(?:para|em)\s+/,''),measurements=quantities(tail).values;
      const valueTail=/^[-+]?\d+(?:[.,]\d+)?(?:\s*[a-z·/²³]+(?:\s+[a-z·/²³]+)*)?[.!]?$/.test(tail);
      if(valueTail&&/^(?:mude|altere|ajuste|aumente|reduza)\b/.test(prefix)){
        const pendingFocus=focusFromAudit({text:prefix},state);
        if(pendingFocus){
          let joined=null;
          if(/\b(?:para|em)\s*$/.test(prefix))joined=prefix+' '+tail;
          else if(/\bde\s+[-+]?\d+(?:[.,]\d+)?(?:\s*[a-z·/²³]+(?:\s+[a-z·/²³]+)*)?\s*$/.test(prefix))joined=prefix+' para '+tail;
          else if(/\bde\s*$/.test(prefix))joined=prefix.replace(/\bde\s*$/,'para ')+tail;
          else if(!/\d/.test(prefix.replace(/\bp\d+\b/g,'')))joined=prefix+' para '+tail;
          if(joined)body=record('pending_parameter',body,joined,'Continuação imediata do mesmo pedido; o primeiro valor após “de” é origem, e o valor após “para” é o destino.',{context_command_id:pendingPrefix.id||null,target_id:pendingFocus.id||null,field:pendingFocus.field});
        }else if(/^(?:reduza|aumente)(?:\s+de)?\s*$/.test(prefix)&&measurements.length===1&&measurements[0].dimension==='length'&&measurements[0].unit==='m'&&options.activeTab==='simulation'&&options.simulationFocus!=='section'&&!options.selection&&!options.selected&&!focusFromAudit(context.last,state)){
          body=record('pending_beam_length',body,prefix.split(' ')[0]+' o comprimento da viga para '+tail,'Pedido de reduzir ou aumentar em metros, na vista da viga inteira sem outro elemento selecionado; identifica seu comprimento longitudinal.',{context_command_id:pendingPrefix.id||null,field:'L'});
        }
      }else if(/^(?:kn|n|mm|cm|m|kg|quilonewtons?|newtons?|milimetros?|centimetros?|metros?)[.!]?$/.test(body)&&/\bde\s+[-+]?\d+(?:[.,]\d+)?(?:\s*[a-z]+)?[.!]?$/.test(prefix)){
        body=record('pending_source_unit',body,prefix.replace(/(\bde\s+[-+]?\d+(?:[.,]\d+)?)(?:\s*[a-z]+)?[.!]?$/,'$1 '+body.replace(/[.!]$/,'')),'A unidade corrige apenas a origem citada; o pedido continua esperando o valor de destino.',{context_command_id:pendingPrefix.id||null});
      }else if(/^(?:me|eh|hum|ahn|ok|beleza|certo)?[.!]?$/.test(body)){
        body=record('pending_hesitation',body,prefix,'Hesitação isolada durante um pedido incompleto; nenhum valor foi aplicado.',{context_command_id:pendingPrefix.id||null});
      }
    }
    const genericLength=body.match(/^(reduza|aumente)(?:\s+de)?\s+para\s+([-+]?\d+(?:[.,]\d+)?\s*(?:m|metros?))[.!]?$/);
    if(scope&&genericLength&&options.activeTab==='simulation'&&options.simulationFocus!=='section'&&!options.selection&&!options.selected&&!focusFromAudit(context.pending||context.last,state))body=record('visible_beam_length',body,genericLength[1]+' o comprimento da viga para '+genericLength[2],'Na vista da viga inteira, sem outra propriedade em foco, reduzir ou aumentar para um valor em metros identifica o comprimento.',{field:'L'});
    // A from→to instruction has one destination. Keep the stated baseline in
    // provenance, not as a second mutation or as a fabricated current value.
    const range=body.match(/^((?:mude|altere|ajuste|aumente|reduza)\b.+?)\s+de\s+([-+]?\d+(?:[.,]\d+)?(?:\s*[a-z·/²³]+(?:\s+[a-z·/²³]+)*)?)\s+para\s+([-+]?\d+(?:[.,]\d+)?(?:\s*[a-z·/²³]+(?:\s+[a-z·/²³]+)*)?)[.!]?$/);
    if(scope&&range){
      const targetFocus=focusFromAudit({text:range[1]},state),from=quantities(range[2]).values,to=quantities(range[3]).values;
      const numeric=/^[-+]?\d+(?:[.,]\d+)?$/;
      if(/\b(?:e|ou)\b/.test(range[1]))issues.push({code:'ambiguous_range_target',message:'Há mais de uma propriedade nesse pedido. Indique o valor de destino de cada uma separadamente.'});
      if(targetFocus&&!/\b(?:e|ou)\b/.test(range[1])&&(from.length===1||numeric.test(range[2]))&&(to.length===1||numeric.test(range[3]))){
        const destination=to[0],origin=from[0],sourceForceASR=targetFocus.type==='load'&&targetFocus.dimension==='force'&&origin?.dimension==='mass'&&destination?.dimension==='force'&&!/\bmassa\b/.test(range[1]);
        if((!destination||destination.dimension===targetFocus.dimension)&&(!origin||origin.dimension===targetFocus.dimension||sourceForceASR)){
          let value=range[3];if(!destination&&targetFocus.unit)value+=' '+targetFocus.unit;
          const replacement=range[1]+' para '+value;
          body=record('explicit_destination',body,replacement,'O valor solicitado após “para” é o destino absoluto. A origem citada é preservada no registro e não é reaplicada.',{target_id:targetFocus.id||null,field:targetFocus.field,stated_from:range[2],stated_to:range[3],...(sourceForceASR?{source_unit_note:'A unidade kg aparece apenas na origem falada; o destino explícito em força é o valor a aplicar.'}:{})});
        }else issues.push({code:'range_dimension_mismatch',message:'A unidade do novo valor não corresponde à propriedade indicada. Diga o destino com a unidade dessa propriedade.'});
      }
    }
    if(scope&&/^(?:(?:a|o)\s+)?(?:forca|carga|comprimento|altura|largura|espessura|apoio|p\d+)\b.*\b(?:para|em)\s+[-+]?\d/.test(body)&&!imperative.test(body))body=record('elliptical_command',body,'mude '+body,'Pedido elíptico com propriedade e valor explícitos.');
    let focus=focusFromAudit(context.pending||context.last,state);
    const previousOps=context.last?.operations?.length?context.last.operations:context.last?.candidate?.candidate_operations||context.last?.candidate_operations||[];
    if(!focus&&active&&!context.pending&&!previousOps.some(op=>/^(?:change_|update_)/.test(op.type))){for(const row of [...context.recent].reverse()){const prior=typeof row==='string'?row:row.text;if(typeof prior!=='string'||!/^\s*(?:norte\b|mude\b|mova\b|altere\b)/i.test(prior)||/\b(?:nao|talvez|se|exemplo|disse)\b/.test(normalize(prior)))continue;const audit=recentAudit(typeof row==='string'?{text:row}:{...row,text:prior},options);if(audit){if(/\b(?:mostre|mostra|abra|volte|volta)\b/.test(normalize(prior)))continue;focus=focusFromAudit(audit,state);break;}}}
    const short=body.match(/^(?:(?:agora|entao|coloca|coloque|bota|bote|muda|mude|altere)\s*)?(?:(?:em|para|pra)\s*)?([-+]?\d+(?:[.,]\d+)?\s*(?:[a-z·/²³]+(?:\s*[a-z·/²³]+)?)?)[.!]?$/);
    const unitOnly=/^(?:kn|n|knm|nm|mm|cm|m|gpa|mpa|kg)[.!]?$/.test(body);
    if(scope&&(short||unitOnly)){
      if(!focus)issues.push({code:'missing_context_field',message:'Diga qual propriedade deseja alterar; esse valor ainda não tem um alvo claro.'});
      else {
        let value=short?.[1]?.trim();
        if(unitOnly){const pendingText=normalize(context.pending?.interpreted_text||context.pending?.text||''),match=pendingText.match(/\b(?:para|em|de)\s+([-+]?\d+(?:[.,]\d+)?)(?:\s*[a-z]+)?[.!]?$/);if(context.pending&&match)value=match[1]+' '+body.replace(/[.!]$/,'');else issues.push({code:'missing_pending_value',message:'Diga também o valor que acompanha essa unidade.'});}
        if(value){const numericOnly=/^[-+]?\d+(?:[.,]\d+)?$/.test(value);if(numericOnly&&focus.unit)value+=' '+focus.unit;const measurements=quantities(value).values;
          if(measurements.length!==1||measurements[0].dimension!==focus.dimension)issues.push({code:'context_dimension_mismatch',message:'Essa unidade não corresponde à propriedade anterior. Diga a propriedade junto com o novo valor.'});
          else {const replacement=focusCommand(focus,value);if(replacement)body=record(unitOnly?'pending_unit':'contextual_followup',body,normalize(replacement),'Complemento da propriedade inequívoca do comando recente.',{context_command_id:context.pending?.id||context.last?.id||null,target_id:focus.id||null,field:focus.field});}
        }
      }
    }
    const percentage=body.match(/^(aumente|reduza)\s+(.+?)\s+(?:em\s+)?(\d+(?:[.,]\d+)?)\s*(?:%|por cento)[.!]?$/);
    if(scope&&percentage){
      const relativeFocus=/\b(?:e|ou)\b/.test(percentage[2])?null:focusFromAudit({text:percentage[2]},state),ratio=Number(percentage[3].replace(',','.'))/100;
      let current,scale=1;
      if(relativeFocus?.type==='beam')current=state[relativeFocus.field];
      else if(relativeFocus?.type==='load'&&relativeFocus.field==='value'){const item=state.loads?.find(item=>item.id===relativeFocus.id);current=item?.value;scale=['kN','kNm','kN/m'].includes(relativeFocus.unit)?1000:1;}
      else if(relativeFocus?.type==='section'){current=state.section?.[relativeFocus.field];scale=.001;}
      if(relativeFocus&&Number.isFinite(current)&&Number.isFinite(ratio)){
        const value=Number((current*(1+(percentage[1]==='reduza'?-1:1)*ratio)/scale).toPrecision(12));
        body=record('relative_percentage',body,normalize(focusCommand(relativeFocus,value+' '+relativeFocus.unit)),'Percentual aplicado ao valor atual de uma única propriedade identificada.',{target_id:relativeFocus.id||null,field:relativeFocus.field,baseline_si:current,percent:ratio*100});
      }else issues.push({code:'ambiguous_percentage',message:'Indique a propriedade ou a carga cujo valor deve aumentar ou diminuir em porcentagem.'});
    }
    // The current field determines an omitted unit, just as it does for loads.
    const directFocus=focusFromAudit({text:body},state),bareValue=body.match(/\b(?:para|em)\s+([-+]?\d+(?:[.,]\d+)?)[.!]?$/);
    if(scope&&bareValue&&directFocus&&['beam','section'].includes(directFocus.type)&&!quantities(body).values.length){
      body=record('display_unit',body,body.replace(/([-+]?\d+(?:[.,]\d+)?)[.!]?$/,bareValue[1]+' '+directFocus.unit),'Unidade exibida para a propriedade explicitamente solicitada.',{field:directFocus.field,unit:directFocus.unit});
    }
    const load=uniqueLoad(body,state),moving=/\b(?:mova|mover|posicao|posicione|desloque|deslocar|leve|a distancia)\b/.test(body);
    if(scope&&load&&/^(?:coloca|coloque|bota|bote)\s+(?:a|essa|esta)\s+(?:forca|carga)\b/.test(body))body=record('existing_target',body,body.replace(/^(?:coloca|coloque|bota|bote)/,'mude'),'Alteração da carga existente indicada pelo contexto.',{target_id:load.id});
    if(scope&&load?.kind==='force'&&!moving&&!/^\s*(?:adicione|aplique|insira|crie)\b/.test(body)&&/\b(?:forca|carga|p\d+)\b/.test(body)){
      const corrected=body.replace(/(\b(?:para|de)\s+[-+]?\d+(?:[.,]\d+)?\s*)km\b/g,'$1kn');
      body=record('asr_unit',body,corrected,'“km” foi interpretado como “kN” somente na intensidade de uma força identificada.',{target_id:load.id,field:'value',raw_unit:'km',interpreted_unit:'kN'});
      const magnitude=body.match(/^(?:mude|muda|altere|ajuste|defina|aumente|reduza|quero mudar)\b.*\b(?:para|em)\s+([-+]?\d+(?:[.,]\d+)?)[.!]?$/);
      if(magnitude){const replacement=body.replace(/([-+]?\d+(?:[.,]\d+)?)[.!]?$/,magnitude[1]+' '+loadUnit(load));body=record('display_unit',body,replacement,'Unidade atualmente exibida para a força identificada.',{target_id:load.id,field:'value',unit:loadUnit(load)});}
    }
    if(scope&&moving&&load){const match=body.match(/\b(?:para|em)\s+([-+]?\d+(?:[.,]\d+)?)[.!]?$/);if(match)body=record('display_unit',body,body.replace(/([-+]?\d+(?:[.,]\d+)?)[.!]?$/,match[1]+' m'),'Posição da carga em metros, conforme o campo do simulador.',{target_id:load.id,field:'x',unit:'m'});}
    const barePrefix=/^(?:(?:pode|poderia)(?:\s+(?:me|nos))?|quero|queria|gostaria de|mude|altere|ajuste|aumente|reduza|abra|mostre|simule|(?:quero\s+)?testar(?:\s+(?:mudar|alterar))?)(?:\s+de)?[.!?]?$/.test(body);
    const changePrefix=/^(?:mude|altere|ajuste|aumente|reduza)\b/.test(body)&&!/[;]|\b(?:e|depois)\s+(?:mude|altere|adicione|mova|reduza|aumente)\b/.test(body);
    const missingDestination=changePrefix&&(/\b(?:para|em|de)\s*[.!?]?$/.test(body)||/\bde\s+[-+]?\d+(?:[.,]\d+)?(?:\s*[a-z·/²³]+(?:\s+[a-z·/²³]+)*)?[.!?]?$/.test(body)||(!quantities(body).values.length&&focusFromAudit({text:body},state)&&!/\b(?:para|em)\s+[-+]?\d/.test(body)));
    const awaiting=options.source==='microphone'&&scope&&(barePrefix||missingDestination);
    if(scope&&missingDestination&&!awaiting)issues.push({code:'missing_destination',message:'Diga o novo valor de destino para completar a alteração.'});
    const eligibleScope=scope||invitation||navigation;
    const interpreted='Norte, '+body,call=literalInvocation(interpreted,{...options,active:true});
    const continuationStarted=awaiting?(normalizations.some(item=>item.kind.startsWith('pending_'))?(pendingPrefix?.continuation_started_at||pendingPrefix?.created_at):null)||new Date(options.nowMs??Date.now()).toISOString():null;
    return {raw_text:raw,interpreted_text:eligibleScope?interpreted:raw,normalizations,issues,addressed:!!wake,contextual:!wake&&eligibleScope,eligible:eligibleScope&&(call.eligible||issues.length>0||awaiting),awaiting_continuation:awaiting,continuation_started_at:continuationStarted,body:eligibleScope?call.body:body,guarded:false};
  }
  const invocation=(text,options={})=>interpret(text,options);
  const canHandle=(text,options={})=>invocation(text,options).eligible;
  const spoken={zero:0,um:1,uma:1,dois:2,duas:2,tres:3,quatro:4,cinco:5,seis:6,sete:7,oito:8,nove:9,dez:10,onze:11,doze:12,treze:13,catorze:14,quatorze:14,quinze:15,dezesseis:16,dezessete:17,dezoito:18,dezenove:19,vinte:20,trinta:30,quarenta:40,cinquenta:50,sessenta:60,setenta:70,oitenta:80,noventa:90,cem:100,duzentos:200,trezentos:300,mil:1000};
  const unitText='(?:quilonewtons?|newtons?|kn|n|milimetros?|centimetros?|metros?|mm|cm|km|m|quilogramas?|kg|gpa|mpa|pa)';
  function spokenNumbers(text) {
    const words=Object.keys(spoken).join('|');
    return text.replace(new RegExp('\\b('+words+')(?:\\s+e\\s+('+words+'))?(?=\\s*'+unitText+'\\b)','g'),(_,a,b)=>String(spoken[a]+(b?spoken[b]:0)))
      .replace(/(\d+)\s+(metros?|centimetros?|milimetros?)\s+e\s+mei[oa]\b/g,(_,n,u)=>Number(n)+.5+' '+u);
  }
  const units = [
    ['density',1,'kg/m3','kg\\s*\\/\\s*m(?:3|³)|quilogramas? por metro cubico'],
    ['acceleration',1,'m/s2','m\\s*\\/\\s*s(?:2|²)|metros? por segundo ao quadrado'],
    ['udl',1000,'kNpm','kn\\s*(?:\\/|por)\\s*m(?:etro(?:s)?)?|quilonewtons? por metro'],
    ['udl',1,'Npm','n\\s*(?:\\/|por)\\s*m(?:etro(?:s)?)?|newtons? por metro'],
    ['moment',1000,'kNm','kn\\s*[·.*]?\\s*m(?:etro(?:s)?)?|quilonewtons?[- ]metro'],
    ['moment',1,'Nm','n\\s*[·.*]?\\s*m(?:etro(?:s)?)?|newtons?[- ]metro'],
    ['force',1000,'kN','kn|quilonewtons?'],['force',1,'N','n|newtons?'],
    ['pressure',1e9,'GPa','gpa|gigapascais'],['pressure',1e6,'MPa','mpa|megapascais'],['pressure',1,'Pa','pa|pascais'],
    ['length',.001,'mm','mm|milimetros?'],['length',.01,'cm','cm|centimetros?'],['length',1,'m','m|metros?'],
    ['mass',1,'kg','kg|quilogramas?']
  ];
  function quantities(text) {
    const source=spokenNumbers(normalize(text)),found=[];
    const pattern=new RegExp('([+-]?\\d+(?:[.,]\\d+)*)\\s*('+units.map(u=>'(?:'+u[3]+')').join('|')+')(?![a-z0-9])','g');
    for(const match of source.matchAll(pattern)) {
      const unit=units.find(u=>new RegExp('^(?:'+u[3]+')$').test(match[2]));
      const raw=match[1],bad=/[.,].*[.,]/.test(raw)||/^\d+\.\d{3}$/.test(raw),value=bad?null:Number(raw.replace(',','.'))*unit[1];
      found.push({raw:match[0],dimension:unit[0],unit:unit[2],value,start:match.index,end:match.index+match[0].length,ambiguous:bad});
    }
    return {source,values:found};
  }
  function stateSnapshot(state={}) {
    const keys=(item,fields)=>Object.fromEntries(fields.filter(key=>Object.hasOwn(item,key)).map(key=>[key,clone(item[key])]));
    return {...keys(state,['L','mbar','g','section','material']),supports:(state.supports||[]).map(item=>keys(item,['id','name','x','type','edge'])),loads:(state.loads||[]).map(item=>keys(item,['id','name','x','end','kind','value','direction','unit','edge','endEdge']))};
  }
  function fingerprint(state) {const text=JSON.stringify(stateSnapshot(state));let hash=2166136261;for(const char of text){hash^=char.charCodeAt(0);hash=Math.imul(hash,16777619);}return 'beam-'+(hash>>>0).toString(16);}
  function parse(text, options={}) {
    const state=stateSnapshot(options.state),call=invocation(text,options),issues=clone(call.issues||[]),operations=[];
    const issue=(code,message,segment)=>{if(!issues.some(i=>i.code===code&&i.segment===segment))issues.push({code,message,...(segment?{segment}:{})});};
    const finish=()=>({raw_text:call.raw_text,interpreted_text:call.interpreted_text,normalizations:clone(call.normalizations),addressed:call.addressed,contextual:call.contextual,consumed:call.eligible,awaiting_continuation:!!call.awaiting_continuation,continuation_started_at:call.continuation_started_at||null,valid:call.eligible&&operations.length>0&&!issues.length,command_type:commandType(operations),operations:issues.length?[]:operations,candidate_operations:operations,issues,clarifications:issues.map(i=>i.message),state_fingerprint:fingerprint(state)});
    if(!call.eligible)return finish();
    if(call.awaiting_continuation)return finish();
    if(issues.length)return finish();
    if(typeof text!=='string'||text.length>4000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)){issue('invalid_text','Use um comando de até 4.000 caracteres.');return finish();}
    if(/\b(?:nao|talvez|poderia|poderiamos|se fosse|por exemplo)\b/.test(call.body)){issue('conditional','Repita apenas a operação que deseja executar, sem hipótese ou negação.');return finish();}
    if(/\b(?:reinicie|limpe|apague tudo|remova tudo|do zero)\b/.test(call.body)){issue('unsupported','Reiniciar ou limpar toda a simulação por voz ainda não está disponível.');return finish();}
    const chunks=call.body.split(/\s*;\s*|\s+(?:e(?: depois)?|depois|em seguida)\s+(?=(?:norte[, ]*)?(?:abra|mostre|exiba|compare|mude|altere|troque|defina|ajuste|coloque|adicione|insira|aplique|mova|inverta|remova|retire|use|aumente|reduza)\b)/).map(c=>c.replace(/^norte[, ]*/,''));
    if(chunks.length>8){issue('too_many_operations','Divida a instrução em até oito operações por vez.');return finish();}
    let working=clone(state);
    const add=op=>operations.push(op);
    for(const raw of chunks){
      const parsed=quantities(raw),s=parsed.source,qs=parsed.values,used=new Set(),errorsBefore=issues.length;
      const problem=(code,message)=>issue(code,message,raw);
      if(qs.some(q=>q.ambiguous)){problem('ambiguous_number','Diga o número sem separador de milhar e use vírgula para decimais.');continue;}
      const by=dimension=>qs.filter(q=>q.dimension===dimension);
      const single=(dimension,label,previous)=>{const values=by(dimension);if(values.length===1){used.add(values[0]);return values[0];}if(values.length===2&&/\bde\b.*\bpara\b/.test(s)&&Number.isFinite(previous)&&Math.abs(values[0].value-previous)<1e-8){values.forEach(q=>used.add(q));return values[1];}if(values.length>1)problem('ambiguous_value','Indique um único valor de '+label+'.');return null;};
      const edge=x=>Math.abs(x)<1e-9?'left':Math.abs(x-working.L)<1e-9?'right':null;
      const position=(previous,range=false)=>{
        const values=by('length');
        if(range){if(values.length===2){values.forEach(q=>used.add(q));return {x:values[0].value,end:values[1].value,edge:edge(values[0].value),endEdge:edge(values[1].value)};}if(values.length===1&&Number.isFinite(previous)){if(/\b(?:fim|final)\b/.test(s)){used.add(values[0]);return {end:values[0].value,endEdge:edge(values[0].value)};}if(/\binicio\b/.test(s)){used.add(values[0]);return {x:values[0].value,edge:edge(values[0].value)};}}if(/\b(?:toda a viga|ao longo de toda|do inicio ao fim)\b/.test(s)&&!values.length)return {x:0,end:working.L,edge:'left',endEdge:'right'};if(values.length)problem('missing_range','Diga o início e o fim da carga distribuída, ambos com unidade.');return null;}
        if(values.length){const q=single('length','posição',previous);return q?{x:q.value,edge:edge(q.value)}:null;}
        const left=/\b(?:no inicio|na origem|na extremidade esquerda|na ponta esquerda|a esquerda)\b/.test(s),right=/\b(?:no fim|no final|na extremidade direita|na ponta direita|a direita)\b/.test(s),center=/\b(?:no meio|no centro)\b/.test(s);
        if([left,right,center].filter(Boolean).length>1){problem('ambiguous_position','Indique uma única posição para este elemento.');return null;}
        if(left)return {x:0,edge:'left'};if(right)return {x:working.L,edge:'right'};if(center)return {x:working.L/2,edge:null};
        if(/\b(?:na ponta|na extremidade livre|na ponta livre)\b/.test(s)){
          const supports=working.supports;
          if(supports.length===1&&supports[0].type==='fixed'&&(supports[0].x===0||supports[0].x===working.L)){const x=supports[0].x===0?working.L:0;return {x,edge:edge(x)};}
          problem('ambiguous_position','Diga se a carga está na extremidade esquerda ou direita.');
        }
        return null;
      };
      const target=(kind)=>{
        let list=kind==='load'?working.loads:working.supports;const nouns=kind==='load'?'carga|forca|momento|massa':'apoio|engaste|rolete|articulado';
        const literalId=s.match(kind==='load'?/\bp\d+\b/:/\bs\d+\b/);
        if(literalId&&!list.some(item=>[item.id,item.name].filter(Boolean).some(name=>normalize(name)===literalId[0]))){problem('missing_target','Não encontrei o elemento '+literalId[0]+'. Use um identificador da simulação.');return null;}
        const mentions=list.filter(item=>[item.id,item.name].filter(Boolean).some(name=>new RegExp('(?:\\b(?:'+nouns+')\\s+(?:chamad[oa]\\s+)?|\\b)'+escape(normalize(name))+'\\b').test(s)&&(!/^[a-z]$/.test(normalize(name))||new RegExp('\\b(?:'+nouns+')\\s+'+escape(normalize(name))+'\\b').test(s))));
        if(mentions.length===1)return mentions[0];if(mentions.length>1){problem('ambiguous_target','Indique apenas uma '+(kind==='load'?'carga':'posição de apoio')+' por operação.');return null;}
        if(kind==='load'){const requested=/\bforca\b/.test(s)?'force':/\bmomento\b/.test(s)?'moment':/\bdistribuida\b/.test(s)?'udl':/\bmassa\b/.test(s)?'mass':null;if(requested)list=list.filter(item=>item.kind===requested);}
        const ordinal=s.match(new RegExp('\\b(primeir[oa]|segund[oa]|terceir[oa]|ultim[oa])\\s+(?:'+nouns+')\\b|\\b(?:'+nouns+')\\s+(?:numero\\s+)?([1-9]\\d*)\\b'));
        if(ordinal){const index=ordinal[2]?Number(ordinal[2])-1:/^primeir/.test(ordinal[1])?0:/^segund/.test(ordinal[1])?1:/^terceir/.test(ordinal[1])?2:list.length-1;return list[index]||null;}
        if(/\bselecionad[oa]\b/.test(s)){const selection=options.selection||options.selected;if(selection?.kind===kind)return list.find(item=>item.id===selection.id)||null;problem('missing_target','Selecione o elemento ou diga seu identificador.');return null;}
        const explicit=s.match(new RegExp('\\b(?:'+nouns+')\\s+([a-z]+\\d+|[a-z](?=\\s+(?:para|de|em|a)|[.,;]?$))\\b'));
        if(explicit){problem('missing_target','Não encontrei o elemento '+explicit[1]+'. Use um identificador da simulação.');return null;}
        if(kind==='support'&&/\b(?:da esquerda|da direita)\b/.test(s)){const x=/da esquerda/.test(s)?0:working.L,found=list.filter(item=>Math.abs(item.x-x)<1e-9);if(found.length===1)return found[0];}
        if(list.length===1)return list[0];
        problem('missing_target','Indique '+(kind==='load'?'a carga':'o apoio')+' pelo nome ou identificador; há '+list.length+' disponível(is).');return null;
      };
      const remove=/^(?:remova|retire|apague|exclua)\b/.test(s),adding=/^(?:adicione|insira|acrescente|coloque|coloca|aplique|crie)\b/.test(s);
      if(/^(?:abra|abre|abrir|simule|simular|vamos simular|quero (?:simular|abrir)|crie)\b/.test(s)&&/\b(?:simulacao|simulador|viga)\b/.test(s)){
        add({type:'open_simulation'});
        if(/\bcom\b.*\b(?:apoio|carga|forca|engaste|rolete|momento)\b/.test(s))problem('ambiguous_setup','Abra a simulação e especifique cada alteração. Diga quais apoios ou cargas existentes devem ser alterados ou removidos.');
        const length=single('length','comprimento');if(length){add({type:'change_beam',patch:{L:length.value}});working.L=length.value;}
      } else if(/^(?:mostre|mostra|mostrar|exiba|exibe|veja|quero ver)\b/.test(s)){
        const graphs=[];if(/\b(?:cortante|cortantes|cisalhamento)\b/.test(s))graphs.push('shear');if(/\b(?:momento|momentos|fletor|flexao)\b/.test(s))graphs.push('bending');if(/\b(?:flecha|flechas|deflexao|deformada|deslocamento)\b/.test(s))graphs.push('deflection');
        if(/\b(?:todos os graficos|todos os diagramas)\b/.test(s))graphs.push('shear','bending','deflection');
        if(graphs.length)add({type:'show_graphs',graphs:[...new Set(graphs)]});
        else if(/\bcanvas\b/.test(s))add({type:'show_canvas'});
        else if(/\bsecao\b/.test(s))add({type:'show_section'});
        else if(/\b(?:calculos|mapa de dependencias|dependencias)\b/.test(s))add({type:'show_calculations'});
        else if(/\b(?:resultados|reacoes|tensoes|fator de seguranca)\b/.test(s))add({type:'show_results'});
        else if(/\b(?:graficos?|diagramas?)\b/.test(s))add({type:'show_graphs',graphs:['shear','bending','deflection']});
        else problem('missing_graph','Diga qual gráfico deseja: cortante, momento fletor ou flecha.');
      } else if(/^(?:compare|comparar)\b/.test(s)){
        const graphs=[];if(/\b(?:cortante|cortantes|cisalhamento)\b/.test(s))graphs.push('shear');if(/\b(?:momento|momentos|fletor|flexao)\b/.test(s))graphs.push('bending');if(/\b(?:flecha|flechas|deflexao|deformada|deslocamento)\b/.test(s))graphs.push('deflection');
        if(/\b(?:antes|anterior|depois|atual|configuracoes|versoes|inicial|original|primeira)\b/.test(s)||graphs.length)add({type:'compare',reference:/\b(?:inicial|original|primeira)\b/.test(s)?'initial':'previous',...(graphs.length?{graphs}: {})});else problem('missing_comparison','Diga “compare a configuração anterior com a atual”.');
      } else if(/\b(?:secao|perfil|largura|altura|alma|mesa|flange|espessura)\b/.test(s)){
        const patch={};if(/\b(?:perfil i|secao i)\b/.test(s))patch.shape='i';if(/\b(?:retangular|retangulo)\b/.test(s))patch.shape='rect';
        if(/\b(?:tubo|tubular|circular|redond[oa]|perfil [uthl])\b/.test(s))problem('unsupported_section','Estão disponíveis apenas seção retangular e perfil I.');
        for(const q of by('length')){const before=s.slice(0,q.start).slice(-65);let key=null;if(/(?:alma|\btw)\s*(?:para|em|de|=|com)?\s*$/.test(before))key='tw';else if(/(?:mesa|flange|\btf)\s*(?:para|em|de|=|com)?\s*$/.test(before))key='tf';else if(/(?:largura|base|\bb)\s*(?:(?:da|de) (?:secao|viga)\s*)?(?:para|em|de|=|com)?\s*$/.test(before))key='b';else if(/(?:altura|\bh)\s*(?:(?:da|de) (?:secao|viga)\s*)?(?:para|em|de|=|com)?\s*$/.test(before))key='h';if(!key){const after=s.slice(q.end).match(/^\s*(?:de|da)?\s*(altura|largura|base|alma|mesa|flange)\b/);if(after)key=({altura:'h',largura:'b',base:'b',alma:'tw',mesa:'tf',flange:'tf'})[after[1]];}if(!key){problem('missing_dimension','Identifique a dimensão: largura, altura, espessura da alma ou espessura da mesa.');continue;}used.add(q);if(Object.hasOwn(patch,key))problem('ambiguous_dimension','Indique apenas um valor para cada dimensão da seção.');else patch[key]=q.value;}
        if(/^(?:aumente|reduza)\b.*\bem\s/.test(s))for(const key of ['b','h','tw','tf'])if(Object.hasOwn(patch,key))patch[key]=working.section[key]+(/^reduza/.test(s)?-1:1)*patch[key];
        if(!Object.keys(patch).length)problem('missing_section','Diga a forma da seção ou qual dimensão deseja alterar, com unidade.');else add({type:'change_section',patch});
      } else if(/\b(?:material|aco|aluminio|elasticidade|modulo|escoamento|densidade)\b/.test(s)){
        const patch={};if(/\binox(?:idavel)?\b/.test(s)||/\b304\b/.test(s))patch.key='stainless';else if(/\baco\b/.test(s))patch.key='steel';if(/\baluminio\b/.test(s))patch.key='aluminum';
        const grade=s.match(/\b(?:aluminio|aco(?: inox(?:idavel)?)?)\s+([a-z]?\d+(?:-t\d+)?)/);
        if(/\b(?:concreto|madeira|cobre|titanio|7075|6063|316|a36|s235|s355)\b/.test(s)||(grade&&!['6061-t6','6061','304'].includes(grade[1])))problem('unsupported_material','Esse material ou grau não está no catálogo. Informe módulo de elasticidade, tensão de escoamento e densidade para material personalizado.');
        for(const q of by('pressure')){const before=s.slice(0,q.start).slice(-70),key=/\b(?:escoamento|limite de escoamento|resistencia)\b/.test(before)?'yield':/\b(?:modulo|elasticidade|young)\b/.test(before)?'E':null;if(key&&!Object.hasOwn(patch,key)){used.add(q);patch[key]=q.value;}else problem('ambiguous_material_property','Diga se a pressão se refere ao módulo de elasticidade ou à tensão de escoamento.');}
        const density=single('density','densidade');if(density)patch.rho=density.value;
        if(!Object.keys(patch).length)problem('missing_material','Use aço estrutural, alumínio 6061-T6, aço inox 304 ou informe uma propriedade com unidade.');else {if(['E','yield','rho'].some(key=>Object.hasOwn(patch,key)))patch.key='custom';add({type:'change_material',patch});}
      } else if(/\b(?:apoio|engaste|rolete|articulado|s\d+)\b/.test(s)){
        const existing=adding?null:target('support');
        if(remove){if(existing)add({type:'remove_support',id:existing.id});}
        else {
          const patch={},requestedType=s.includes(' para ')?s.slice(s.lastIndexOf(' para ')):s;const supportTypes=[['fixed',/\b(?:engaste|engastado|fixo)\b/],['roller',/\b(?:rolete|movel)\b/],['pin',/\b(?:articulado|pino)\b/]].filter(([,re])=>re.test(requestedType));
          if(supportTypes.length===1)patch.type=supportTypes[0][0];else if(supportTypes.length>1)problem('ambiguous_support','Indique um único tipo de apoio.');
          const pos=position(existing?.x);if(pos)Object.assign(patch,pos);
          if(adding){if(!patch.type)problem('missing_support_type','Diga o tipo do apoio: articulado, rolete ou engaste.');if(!pos)problem('missing_position','Diga a posição do apoio, por exemplo “a 2 m” ou “no início”.');add({type:'add_support',support:patch});}
          else if(existing){if(!Object.keys(patch).length)problem('missing_change','Diga o tipo ou a nova posição do apoio.');else add({type:'update_support',id:existing.id,patch});}
        }
      } else if(/\b(?:carga|forca|momento|massa|p\d+)\b/.test(s)&&!(/\b(?:massa|peso)\b.*\b(?:viga|total)\b/.test(s))){
        const existing=adding?null:target('load');
        if(remove){if(existing)add({type:'remove_load',id:existing.id});}
        else {
          const patch={},physical=qs.filter(q=>['force','moment','udl','mass'].includes(q.dimension)),kind=physical[0]?.dimension||existing?.kind;
          if(physical.length>1){if(physical.length===2&&physical[0].dimension===physical[1].dimension&&/\bde\b.*\bpara\b/.test(s)&&existing&&physical[0].value===existing.value)used.add(physical.shift());else problem('ambiguous_value','Indique uma única intensidade de carga por operação.');}
          if(physical[0]){const q=physical[0];used.add(q);Object.assign(patch,{kind:q.dimension,value:q.value,unit:q.unit});if(existing&&/^(?:aumente|reduza)\b.*\bem\s/.test(s))patch.value=existing.value+(/^reduza/.test(s)?-1:1)*q.value;}
          if((/\bmomento\b/.test(s)&&kind!=='moment')||(/\bdistribuida\b/.test(s)&&kind!=='udl'))problem('unit_mismatch','A unidade não corresponde ao tipo de carga: momentos usam N·m e cargas distribuídas usam N/m.');
          const direction=kind==='moment'?(/\b(?:anti[- ]?horario|sentido positivo)\b/.test(s)?1:/\b(?:horario|sentido negativo)\b/.test(s)?-1:null):(/\b(?:para baixo|sentido negativo de y)\b/.test(s)?1:/\b(?:para cima|sentido positivo de y)\b/.test(s)?-1:null);
          if(/\b(?:horizontal|inclinad[oa]|graus|esquerda|direita)\b/.test(s)&&!(/\b(?:extremidade|ponta|a esquerda|a direita)\b/.test(s)))problem('unsupported_direction','O simulador aceita forças verticais e momentos no plano. Especifique “para baixo”, “para cima” ou o sentido do momento.');
          if(/\bpara baixo\b/.test(s)&&/\bpara cima\b/.test(s))problem('ambiguous_direction','Indique um único sentido para a carga.');
          if(/\binverta\b/.test(s)){if(existing)patch.direction=-existing.direction;else problem('missing_target','Indique a carga cujo sentido deseja inverter.');}else if(direction!==null)patch.direction=direction;
          if(kind==='mass'){patch.direction=1;if(direction===-1)problem('invalid_mass_direction','Uma massa atua para baixo pela gravidade; use uma força para representar ação para cima.');}
          const range=kind==='udl',pos=position(existing?.x,range);if(pos)Object.assign(patch,pos);
          if(adding){if(!physical.length)problem('missing_magnitude','Diga a intensidade e a unidade da carga: N, kN, N·m, kN·m, N/m, kN/m ou kg.');if(!pos)problem('missing_position',range?'Diga onde a carga distribuída começa e termina.':'Diga a posição da carga com unidade.');if(!Object.hasOwn(patch,'direction'))problem('missing_direction',kind==='moment'?'Diga se o momento é horário ou anti-horário.':'Diga se a força atua para baixo ou para cima.');add({type:'add_load',load:patch});}
          else if(existing){if(patch.kind&&patch.kind!==existing.kind)problem('kind_change','Para trocar o tipo de carga, remova a existente e adicione a nova com posição e sentido explícitos.');if(!Object.keys(patch).length)problem('missing_change','Diga qual valor, posição ou sentido deve mudar.');else add({type:'update_load',id:existing.id,patch});}
        }
      } else if(/\b(?:viga|comprimento|gravidade|massa total)\b/.test(s)){
        const patch={},length=single('length','comprimento',working.L),mass=single('mass','massa total',working.mbar),gravity=single('acceleration','gravidade',working.g);
        if(length)patch.L=length.value;if(mass)patch.mbar=mass.value;if(gravity)patch.g=gravity.value;
        if(/^(?:aumente|reduza)\b.*\bem\s/.test(s))for(const key of Object.keys(patch))patch[key]=working[key]+(/^reduza/.test(s)?-1:1)*patch[key];
        if(!Object.keys(patch).length)problem('missing_beam_value','Diga a propriedade e seu valor com unidade, por exemplo “comprimento para 10 m”.');else add({type:'change_beam',patch});
      } else problem('unsupported','Não reconheci uma operação completa do simulador. Use um dos exemplos de comandos.');
      if(qs.some(q=>!used.has(q)))problem('unmapped_quantity','Nem todas as medidas da instrução correspondem à operação. Separe as alterações e informe a propriedade de cada valor.');
      for(const number of s.matchAll(/(?<![a-z0-9])[-+]?\d+(?:[.,]\d+)*/g)){
        if(qs.some(q=>number.index>=q.start&&number.index<q.end))continue;
        const prefix=s.slice(0,number.index);
        if(/\b(?:carga|forca|momento|apoio)\s+(?:numero\s+)?$/.test(prefix)||/\b(?:aluminio|aco(?: inox(?:idavel)?)?)\s+$/.test(prefix))continue;
        problem('unit_required','Há um número sem unidade ou sem alvo reconhecido. Informe a unidade de cada medida.');
      }
      if(issues.length===errorsBefore){for(const op of operations.slice(0))if(op.type==='change_beam'&&op.patch.L)working.L=op.patch.L;}
    }
    if(!issues.length)for(const item of validateOperations(state,operations))issue(item.code,item.message);
    return finish();
  }
  function commandType(operations) {
    const map=op=>['add_load','update_load','remove_load'].includes(op.type)?'load':['add_support','update_support','remove_support'].includes(op.type)?'support':['show_results','show_calculations','show_canvas','show_section'].includes(op.type)?'show_inspection':op.type;
    return operations.length>1?'compound':operations.length?map(operations[0]):'other_command';
  }
  function actionMode(operations) {const modes=[...new Set(operations.map(op=>op.type.startsWith('add_')?'add':op.type.startsWith('update_')?'update':op.type.startsWith('remove_')?'remove':op.type.startsWith('change_')?'change':'view'))];return modes.length>1?'mixed':modes[0]||'not_applicable';}
  function validateOperations(state,operations) {
    const s=clone(state),issues=[],issue=(code,message)=>issues.push({code,message});
    s.loads||=[];s.supports||=[];
    for(const op of operations){
      if(op.type==='change_beam'){
        for(const [key,min,max,label] of [['L',.5,20,'comprimento (0,5 a 20 m)'],['mbar',0,10000,'massa total (0 a 10.000 kg)'],['g',.1,30,'gravidade (0,1 a 30 m/s²)']])if(Object.hasOwn(op.patch,key)&&(!Number.isFinite(op.patch[key])||op.patch[key]<min||op.patch[key]>max))issue('out_of_range','Revise o '+label+'.');
        Object.assign(s,op.patch);
        if(Object.hasOwn(op.patch,'L'))for(const item of [...s.loads,...s.supports]){if(item.edge==='right')item.x=s.L;if(item.endEdge==='right')item.end=s.L;}
      }
      if(op.type==='change_section'){
        s.section={...s.section,...op.patch};const v=s.section;
        if((Object.hasOwn(op.patch,'b')&&!(v.b>=.005&&v.b<=2))||(Object.hasOwn(op.patch,'h')&&!(v.h>=.005&&v.h<=3))||(Object.hasOwn(op.patch,'tw')&&!(v.tw>=.001&&v.tw<=v.b*.95))||(Object.hasOwn(op.patch,'tf')&&!(v.tf>=.001&&v.tf<=v.h*.45)))issue('invalid_section','Dimensões da seção fora dos limites: largura 5–2.000 mm, altura 5–3.000 mm; alma menor que a largura e mesas sem se sobrepor.');
        if((Object.hasOwn(op.patch,'tw')||Object.hasOwn(op.patch,'tf'))&&v.shape!=='i')issue('section_shape','Espessura da alma ou mesa exige um perfil I. Defina essa forma primeiro.');
      }
      if(op.type==='change_material')for(const [key,min,max] of [['E',1e6,1e12],['yield',1e5,5e9],['rho',1,30000]])if(Object.hasOwn(op.patch,key)&&!(op.patch[key]>=min&&op.patch[key]<=max))issue('invalid_material','Propriedade do material fora do intervalo aceito pelo simulador: '+key+'.');
      for(const kind of ['load','support']){
        const list=kind==='load'?s.loads:s.supports;
        if(op.type==='add_'+kind)list.push({...clone(op[kind]),id:'proposed-'+kind+'-'+list.length});
        if(op.type==='update_'+kind){const item=list.find(item=>item.id===op.id);if(item)Object.assign(item,op.patch);else issue('missing_target','O elemento solicitado não está mais na simulação.');}
        if(op.type==='remove_'+kind){const at=list.findIndex(item=>item.id===op.id);if(at<0)issue('missing_target','O elemento solicitado não está mais na simulação.');else list.splice(at,1);}
      }
    }
    if(operations.some(op=>/^(?:change_beam|add_|update_)/.test(op.type))){
      for(const item of [...s.loads,...s.supports])if(!Number.isFinite(item.x)||item.x<0||item.x>s.L)issue('position_outside','Uma posição ficaria fora da viga. Informe um ponto entre 0 e '+s.L+' m.');
      for(const item of s.loads){if(!Number.isFinite(item.value)||item.value<0||item.value>(item.kind==='mass'?10000:1e7))issue('invalid_load','Use uma intensidade não negativa dentro dos limites da carga; especifique o sentido separadamente.');if(item.kind==='udl'&&(!Number.isFinite(item.end)||item.end<=item.x||item.end>s.L))issue('invalid_range','O fim da carga distribuída deve ser maior que o início e não ultrapassar a viga.');}
      for(const item of s.supports)if(item.type==='fixed'&&item.x!==0&&item.x!==s.L)issue('fixed_position','Neste editor, o engaste deve estar em uma extremidade da viga.');
      for(let a=0;a<s.supports.length;a++)for(let b=a+1;b<s.supports.length;b++)if(Math.abs(s.supports[a].x-s.supports[b].x)<1e-9)issue('duplicate_support','Já existe um apoio nessa posição. Altere ou remova o apoio existente.');
    }
    return issues;
  }
  function validateConfig(config=defaults) {
    E.validateConfig({model:'jev-latest',questions:config.questions});
    if(Object.keys(config.questions).sort().join()!==Object.keys(defaults.questions).sort().join())throw Error('Mantenha as três classificações de comandos do simulador.');
    for(const [id,q] of Object.entries(config.questions))if(q.type!=='choice'||Object.keys(q.criteria).sort().join()!==Object.keys(defaults.questions[id].criteria).sort().join())throw Error('Mantenha as classes da pergunta '+id+'.');
    return clone(config);
  }
  function operationDescription(op,state) {
    if(op.type==='open_simulation')return 'Abrir a visualização da viga existente, preservando todos os parâmetros.';
    if(op.type==='compare')return 'Mostrar comparação da configuração '+(op.reference==='initial'?'inicial':'imediatamente anterior')+' com a atual'+(op.graphs?' nos gráficos '+op.graphs.join(', '):'')+'.';
    if(op.type==='change_beam'&&Object.hasOwn(op.patch,'L'))return 'Alterar o comprimento da viga para '+op.patch.L+' m. Elementos vinculados à extremidade direita (edge:right ou endEdge:right) acompanham automaticamente o novo comprimento; os demais valores permanecem iguais.';
    if(op.type==='add_load'||op.type==='update_load'){
      const value=op.load||op.patch,current=state.loads?.find(item=>item.id===op.id),kind=value.kind||current?.kind,unit=value.unit||current?.unit,scale=['kN','kNm','kNpm'].includes(unit)?1000:1;
      const notes=[op.type==='add_load'?'Adicionar carga':'Alterar apenas os campos indicados da carga '+(current?.name||op.id)];
      if(Object.hasOwn(value,'value'))notes.push('intensidade '+value.value/scale+' '+unit+' ('+value.value+' '+({force:'N',moment:'N·m',udl:'N/m',mass:'kg'}[kind]||'SI')+')');
      if(Object.hasOwn(value,'x'))notes.push('posição '+value.x+' m');if(Object.hasOwn(value,'end'))notes.push('fim '+value.end+' m');
      if(Object.hasOwn(value,'direction'))notes.push('sentido '+(kind==='moment'?(value.direction===1?'anti-horário':'horário'):(value.direction===1?'para baixo':'para cima')));
      return notes.join('; ')+'.';
    }
    return JSON.stringify(operationForValidation(op,state));
  }
  // The classifier sees engineering quantities, never an SI value next to an
  // unrelated display-unit selector. Executable operations remain SI in audit.
  const materialNames={steel:'Aço estrutural',aluminum:'Alumínio 6061-T6',stainless:'Aço inox 304',custom:'Material personalizado'};
  const supportTypes={pin:'articulado',roller:'rolete',fixed:'engaste'};
  const displayUnits={kN:'kN',N:'N',kNm:'kN·m',Nm:'N·m',kNpm:'kN/m',Npm:'N/m',kg:'kg'};
  function loadForValidation(value,previous={}) {
    const out={},kind=value.kind||previous.kind,unit=value.unit||previous.unit||({force:'N',moment:'Nm',udl:'Npm',mass:'kg'}[kind]);
    for(const key of ['id','name'])if(Object.hasOwn(value,key))out[key]=value[key];
    if(value.kind)out.load_type=({force:'força pontual',moment:'momento concentrado',udl:'carga uniformemente distribuída',mass:'massa'}[value.kind]);
    if(Object.hasOwn(value,'value')){out.magnitude={value:value.value/(['kN','kNm','kNpm'].includes(unit)?1000:1),unit:displayUnits[unit]};out.equivalent_si={value:value.value,unit:({force:'N',moment:'N·m',udl:'N/m',mass:'kg'}[kind])};}
    if(Object.hasOwn(value,'x'))out.position_m=value.x;if(Object.hasOwn(value,'end'))out.end_position_m=value.end;
    if(Object.hasOwn(value,'direction'))out.direction=kind==='moment'?(value.direction===1?'anti-horário':'horário'):(value.direction===1?'para baixo':'para cima');
    if(Object.hasOwn(value,'edge'))out.attached_end=value.edge;if(Object.hasOwn(value,'endEdge'))out.end_attached_end=value.endEdge;
    return out;
  }
  function sectionForValidation(section={}) {const out={};if(section.shape)out.shape=section.shape==='i'?'perfil I':'retangular';for(const [key,name] of [['b','width_mm'],['h','height_mm'],['tw','web_thickness_mm'],['tf','flange_thickness_mm']])if(Object.hasOwn(section,key))out[name]=section[key]*1000;return out;}
  function materialForValidation(material={}) {const out={};if(material.key)out.preset=materialNames[material.key];if(Object.hasOwn(material,'E'))out.young_modulus_GPa=material.E/1e9;if(Object.hasOwn(material,'yield'))out.yield_stress_MPa=material.yield/1e6;if(Object.hasOwn(material,'rho'))out.density_kg_m3=material.rho;return out;}
  function supportForValidation(support={}) {const out={...support};if(support.type)out.type=supportTypes[support.type];return out;}
  function operationForValidation(op,state) {
    if(op.type==='add_load')return {...op,load:loadForValidation(op.load)};
    if(op.type==='update_load')return {...op,patch:loadForValidation(op.patch,state.loads.find(item=>item.id===op.id))};
    if(op.type==='add_support')return {...op,support:supportForValidation(op.support)};
    if(op.type==='update_support')return {...op,patch:supportForValidation(op.patch)};
    if(op.type==='change_section')return {...op,patch:sectionForValidation(op.patch)};
    if(op.type==='change_material')return {...op,patch:materialForValidation(op.patch)};
    return clone(op);
  }
  function buildRequest(text,options={}) {
    const candidate=options.candidate||parse(text,options),call=invocation(text,options),snapshot=stateSnapshot(options.state),context=contextData(options);
    const beamState={L_m:snapshot.L,total_applied_mass_kg:snapshot.mbar,gravity_m_s2:snapshot.g,section:sectionForValidation(snapshot.section),material:materialForValidation(snapshot.material),supports:snapshot.supports.map(supportForValidation),loads:snapshot.loads.map(load=>loadForValidation(load))};
    // A caller can open the workspace before a physical state exists.
    for(const key of Object.keys(beamState))if(beamState[key]===undefined)delete beamState[key];
    const request={model:'jev-latest',state:{utterance:candidate.interpreted_text,raw_utterance:text,interpretation:{normalizations:candidate.normalizations,source:options.source||'unspecified'},invocation:{addressed:call.addressed,contextual:call.contextual},conversation_context:{active_tab:options.activeTab||null,previous_tab:options.previousTab||null,available_tabs:options.availableTabs||[],pending_command:context.pending?{id:context.pending.id||null,text:String(context.pending.interpreted_text||context.pending.text||'').slice(0,600)}:null,last_command:context.last?{id:context.last.id||null,text:String(context.last.interpreted_text||context.last.text||'').slice(0,600)}:null,recent_utterances:context.recent.map(row=>String(typeof row==='string'?row:row.text||'').slice(0,250))},simulator_contract:'open_simulation displays the existing/default beam; it does not reset or edit physical parameters. show_canvas returns to the meeting map; show_section opens the section editor. Generic show_graphs displays all three diagrams. compare displays previous vs current, or initial vs current when requested. View operations need no numeric data. Beam patch.L is length in meters. When L changes, attached_end:right, edge:right or endEdge:right follows the new L automatically. Quantities state their units; magnitude and equivalent_si are the SAME quantity. Unspecified fields remain unchanged. Switching section shape to perfil I retains existing dimensions. A lone force/support is an unambiguous target; a force without a unit uses its visible display unit. Ponta on a cantilever is the unique free end. Material presets are complete: aluminum = Alumínio 6061-T6; steel = Aço estrutural; stainless = Aço inox 304. Web = alma, flange = mesa; millimeters are mm. Variar essa força e colocar em X metros requests a position update. Documented context and ASR normalizations are authorized, but never override negation/quotes or invent numeric values.',beam_state:beamState,deterministic_candidate:{operations:candidate.candidate_operations.map(op=>operationForValidation(op,snapshot)),readable_operations:candidate.candidate_operations.map(op=>operationDescription(op,snapshot)),issues:candidate.issues}},questions:validateConfig(options.config||defaults).questions};
    E.validateState(request.state);return request;
  }
  function localView(candidate) {
    if(!candidate.valid||candidate.operations.length!==1)return false;
    const type=candidate.operations[0].type,body=normalize(candidate.interpreted_text).replace(/^norte[\s,]*/,'').replace(/[.!?]+$/,'').trim();
    if(type==='open_simulation')return /^(?:abra o simulador|(?:vamos simular|quero simular|simule) (?:uma |a )?viga)$/.test(body);
    if(['show_results','show_calculations','show_canvas','show_section'].includes(type))return /^(?:mostre|exiba|veja) (?:o |os |a )?(?:resultados|calculos|canvas|secao)$/.test(body);
    if(type==='show_graphs')return /^(?:mostre|exiba|veja) (?:(?:o|os|a|as|todos os) )?(?:(?:graficos?|diagramas?)(?: de)? ?)?(?:(?:cortante|momento fletor|momento|flecha|deflexao)(?:, | e )?)*$/.test(body);
    return false;
  }
  async function process(text,options={}) {
    const original=options.state||{},snapshot=stateSnapshot(original),candidate=parse(text,{...options,state:snapshot});
    const audit={id:'BCMD-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,7),text,raw_text:text,interpreted_text:candidate.interpreted_text,normalizations:clone(candidate.normalizations),created_at:new Date(options.nowMs??Date.now()).toISOString(),continuation_started_at:candidate.continuation_started_at||null,speaker:options.speaker||null,status:'classifying',consumed:candidate.consumed,command_type:candidate.command_type,probability:null,operations:[],candidate,issues:clone(candidate.issues),clarifications:[...candidate.clarifications],state_fingerprint:candidate.state_fingerprint,requests:[],outputs:[],message:''};
    const finish=(status,message)=>{audit.status=status;audit.message=message;options.onChange?.(clone(audit));return clone(audit);};
    if(!candidate.consumed)return finish('conversation','');
    if(candidate.awaiting_continuation)return finish('awaiting_continuation','');
    // Viewing an existing tab has no physical side effects. A fully matched,
    // deterministic view does not depend on network availability or API credit.
    // Physical edits and additional unmatched instructions still require JEV.
    if(options.localNavigation!==false&&localView(candidate)){
      audit.routing='local_navigation';audit.validation_gates=['deterministic_view'];audit.operations=clone(candidate.operations);
      audit.interpreted_effect=candidate.operations.map(op=>operationDescription(op,snapshot)).join(' ');
      return finish('proposed','Visualização aberta.');
    }
    const send=options.transport||options.send;
    if(typeof send!=='function')return finish('classification_error','Não foi possível verificar o comando. A simulação permanece igual; tente novamente.');
    let timer;
    try {
      const request=buildRequest(text,{...options,state:snapshot,candidate});audit.requests.push(clone(request));
      const controller=new AbortController(),timeout=Number.isFinite(options.timeoutMs)?Math.max(10,Math.min(options.timeoutMs,120000)):45000;
      const output=await Promise.race([send(clone(request),{endpoint:'/api/classify',provider:options.provider||options.run?.provider||'official',signal:controller.signal}),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('command_timeout'));},timeout);})]);
      audit.outputs.push(clone(output));
      E.validateOutput(output,{state:request.state,config:{model:request.model,questions:request.questions}});
      if(output.provider!==(options.provider||options.run?.provider||'official'))throw Error('provider_mismatch');
      const answers=output.response.answers;audit.classifications=clone(answers);audit.command_type=answers.beam_action.choice;audit.probability=answers.beam_action.probabilities[answers.beam_action.choice];
      if(audit.command_type==='conversation'){audit.consumed=false;return finish('conversation','');}
      const simpleView=/^(?:(?:vamos simular|simule|quero simular)(?: uma)? viga|(?:abra|abre|abrir|quero abrir)(?: o)? simulador(?: de vigas?)?|(?:mostre|mostra|exiba|quero ver)(?: os| o| a)? (?:resultados|calculos|canvas|secao))[.!]?$/;
      const parameterlessView=candidate.valid&&candidate.operations.length===1&&['open_simulation','show_results','show_calculations','show_canvas','show_section'].includes(candidate.operations[0].type)&&simpleView.test(invocation(text,options).body);
      const gates=parameterlessView?['beam_action']:['beam_action','candidate_fit'];audit.validation_gates=gates;audit.mode_agrees=answers.action_mode.choice===actionMode(candidate.operations);
      if(!candidate.valid)return finish(candidate.issues.some(i=>i.code==='unsupported'||i.code==='unsupported_section')?'unsupported':'ambiguous',candidate.clarifications.join(' '));
      if(!gates.every(id=>answers[id].probabilities[answers[id].choice]>threshold))return finish('ambiguous','O comando ficou ambíguo. Nenhuma alteração foi aplicada; repita a operação com seus valores e alvo.');
      if(audit.command_type!==candidate.command_type||['contradicted','ambiguous','not_applicable'].includes(answers.candidate_fit.choice)||(!parameterlessView&&answers.candidate_fit.choice!=='exact'))return finish('ambiguous','Não consegui confirmar todos os valores e o alvo desse comando. Nenhuma alteração foi aplicada; reformule a instrução.');
      if(fingerprint(original)!==candidate.state_fingerprint)return finish('ambiguous','A configuração mudou enquanto o comando era verificado. Repita o comando sobre a versão atual.');
      audit.operations=clone(candidate.operations);audit.interpreted_effect=candidate.operations.map(op=>operationDescription(op,snapshot)).join(' ');return finish('proposed','Comando verificado.');
    } catch(error) {
      audit.error_code=error.message==='command_timeout'?'timeout':'classification_failed';
      return finish('classification_error',audit.error_code==='timeout'?'A verificação demorou mais que o esperado. Nenhuma alteração foi aplicada; tente novamente.':'Não foi possível verificar o comando agora. Nenhuma alteração foi aplicada; tente novamente.');
    } finally {clearTimeout(timer);}
  }
  const api={threshold,types,defaults,examples,interpret,invocation,canHandle,isCandidate:canHandle,parse,localView,quantities,stateSnapshot,fingerprint,validateOperations,validateConfig,buildRequest,process};
  root.NorteBeamCommands=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:window);
