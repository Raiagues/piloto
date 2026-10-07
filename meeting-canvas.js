/* Compact, navigable projection of the meeting's classified hierarchy. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NorteMeetingCanvas = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  const relationLabels={tests:'avalia',result_of:'resultado de',depends_on:'depende de',affects:'afeta',based_on:'baseia-se em',supports:'sustenta',contradicts:'contradiz',supersedes:'substitui'};
  const statusLabels={active:'Registrado',registered:'Registrado',open:'Aberto',completed:'Concluído',review:'Revisar',conflict:'Conflito',error:'Erro',superseded:'Substituído'};
  function meetingState(){
    if(root.NorteMeetingState)return root.NorteMeetingState;
    if(typeof require==='function'){try{return require('./meeting-state.js');}catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error;}}
    return null;
  }
  function routeEdge(a,b,{sameColumn=false,nestedResult=false,resultTop=0}={}){
    if(nestedResult){const x=a.left+10;return {path:`M ${x} ${resultTop-3} V ${resultTop-25}`,labelX:x+8,labelY:resultTop-11,anchor:'start',nested:true};}
    if(sameColumn){const lane=Math.min(a.left,b.left)-18;return {path:`M ${a.left} ${a.y} H ${lane} V ${b.y} H ${b.left}`,labelX:lane-3,labelY:(a.y+b.y)/2,anchor:'end'};}
    const right=a.left<b.left,start=right?a.right:a.left,end=right?b.left:b.right,middle=(start+end)/2;
    return {path:Math.abs(a.y-b.y)<1?`M ${start} ${a.y} H ${end}`:`M ${start} ${a.y} H ${middle} V ${b.y} H ${end}`,labelX:middle,labelY:(a.y+b.y)/2,anchor:'middle'};
  }
  function build(sourceRun) {
    const hierarchy=root.NorteMeetingHierarchy || (typeof require==='function' ? require('./meeting-hierarchy.js') : null);
    const evidence=root.NorteMeetingEvidence || (typeof require==='function' ? require('./meeting-evidence.js') : null);
    if(!hierarchy||!evidence)throw Error('A organização dos assuntos ainda não está disponível.');
    const projected=evidence.project(sourceRun),run=projected.run,sharedState=meetingState()?.build(sourceRun),original=hierarchy.build(run),nodes=new Map(),review=[],edges=[],seen=new Set();
    const visit=node=>{
      const issues=(projected.diagnostics?.events?.[node.id]||[]).map(issue=>({...issue,event_ids:[node.id],relation_ids:[]}));
      nodes.set(node.id,{...node,event:{...node.event},parent_id:null,parent_relation_id:null,children:[],links:[],review:issues});
      review.push(...issues);for(const child of node.children)visit(child);
    };
    for(const topic of original.topics)topic.nodes.forEach(visit);
    const high=value=>Number.isFinite(value)&&value>.8;
    for(const [index,edge] of (run.meeting_relations||[]).entries()){
      if(!edge)continue;
      const source=nodes.get(edge.source_event_id||edge.source_id||edge.event_id),target=nodes.get(edge.target_event_id||edge.target_id),type=edge.relation_type;
      if(!relationLabels[type]||!source||!target||source===target||!source.event.thread_id||source.event.thread_id!==target.event.thread_id||!high(edge.relation_probability))continue;
      const id=edge.relation_id||edge.id||'direct-'+index;
      const configSafe=type==='result_of'?edge.configuration_match==='exact':(['exact','not_applicable',...(type==='supersedes'?['partial','mismatch']:[])].includes(edge.configuration_match)||edge.configuration_applicable===false&&edge.configuration_match==null);
      const confirmed=edge.review_state==='confirmed'&&!edge.error&&high(edge.match_probability)&&configSafe;
      if(type==='result_of'&&(source.type!=='test_result'||target.type!=='test_proposal'))continue;
      const needsReview=!!edge.error||['pending','uncertain','needs_review'].includes(edge.review_state)||!configSafe;
      if(!confirmed&&!needsReview)continue;
      // A low-probability relation is omitted. Explicit uncertainty about a
      // confidently identified relation/configuration belongs on its edge.
      if(edge.match_probability!=null&&!high(edge.match_probability)&&!edge.error&&edge.configuration_match!=='uncertain'&&edge.configuration_match!=='ambiguous')continue;
      const key=[source.id,target.id,type].join(':');if(seen.has(key))continue;seen.add(key);
      const issues=[];
      if(!confirmed){
        const message=edge.error?'Não foi possível concluir a análise deste vínculo.':edge.configuration_match==='mismatch'?'O resultado usa uma configuração diferente do teste planejado.':edge.configuration_match==='partial'?'Faltam condições do teste para confirmar este vínculo.':edge.configuration_match==='ambiguous'||edge.configuration_match==='uncertain'?'Não está claro a qual configuração este resultado se refere.':'Este vínculo ainda aguarda confirmação.';
        const issue={id:'relation:'+id,message,event_ids:[source.id,target.id],relation_ids:[id],kind:edge.error?'error':'review'};issues.push(issue);review.push(issue);
      }
      const link={id,source_id:source.id,target_id:target.id,type,label:relationLabels[type],thread_id:source.event.thread_id,source_text:source.text,target_text:target.text,review_state:confirmed?'confirmed':'pending',error:edge.error||null,issues};
      edges.push(link);source.links.push(link);target.links.push(link);
    }
    const superseded=new Set(sharedState?Object.values(sharedState.byId||{}).filter(entry=>entry.status==='superseded').map(entry=>entry.id):edges.filter(link=>link.type==='supersedes'&&link.review_state==='confirmed').map(link=>link.target_id));
    for(let index=edges.length-1;index>=0;index--){const link=edges[index];if(superseded.has(link.source_id)&&link.type!=='supersedes'){edges.splice(index,1);nodes.get(link.source_id).links=nodes.get(link.source_id).links.filter(item=>item!==link);nodes.get(link.target_id).links=nodes.get(link.target_id).links.filter(item=>item!==link);}}
    const resultParents=new Map();
    for(const link of edges)if(link.type==='result_of'&&link.review_state==='confirmed'){if(!resultParents.has(link.source_id))resultParents.set(link.source_id,[]);resultParents.get(link.source_id).push(link);}
    for(const [id,parents] of resultParents){
      const node=nodes.get(id);
      if(parents.length===1){node.parent_id=parents[0].target_id;node.parent_relation_id=parents[0].id;nodes.get(node.parent_id).children.push(node);}
      else for(const link of parents){
        link.review_state='pending';
        const issue={id:'result-parent:'+link.id,message:'Este resultado aponta para mais de um teste. Confirme qual teste foi executado.',event_ids:[id,link.target_id],relation_ids:[link.id],kind:'review'};
        link.issues.push(issue);review.push(issue);
      }
    }
    for(const node of nodes.values()){
      const state=sharedState?.byId?.[node.id];
      node.completed=state?!!state.completed:node.type==='test_proposal'&&!superseded.has(node.id)&&edges.some(link=>link.type==='result_of'&&link.target_id===node.id&&link.review_state==='confirmed');
      node.status=state?.status||(superseded.has(node.id)?'superseded':node.completed?'completed':['observation','hypothesis','test_proposal'].includes(node.type)?'open':'registered');
      // Shared state determines semantic closure. An isolated result or an
      // unrelated decision never closes a problem simply by sharing a topic.
      // Classification diagnostics stay on cards; link diagnostics stay edges.
      node.canvas_status=node.status==='superseded'?'superseded':node.review.some(issue=>issue.kind==='error')?'error':node.review.length?'review':node.status;
      node.status_label=(state?.status===node.canvas_status&&state.state_label)||statusLabels[node.canvas_status]||statusLabels.registered;
      node.resolved=!!state?.resolved;node.blocked=!!state?.blocked;node.blocked_by=state?.blocked_by||[];
      node.state_reasons=state?.reasons||[];
      const inspectionIssues=[...node.review,...(state?.alerts||[])],messages=new Set(inspectionIssues.map(issue=>issue.message));
      for(const [index,message] of node.state_reasons.entries())if(!messages.has(message)){inspectionIssues.push({id:'state-reason:'+node.id+':'+index,message,kind:'info',event_ids:[node.id],relation_ids:state?.relation_ids||[]});messages.add(message);}
      node.inspection={issues:[...new Map(inspectionIssues.map(issue=>[issue.message,issue])).values()],eventIds:[...new Set([node.id,...inspectionIssues.flatMap(issue=>issue.event_ids||[])])],relationIds:[...new Set(inspectionIssues.flatMap(issue=>issue.relation_ids||[]))]};
    }
    const clean=value=>typeof value==='string'?value.replace(/\s+/g,' ').trim():'';
    const topics=original.topics.map(topic=>{
      const members=(run.meeting_events||[]).filter(event=>(event.thread_id||null)===(topic.id||null)).map(event=>nodes.get(event.event_id)).filter(Boolean);
      const roots=members.filter(node=>!node.parent_id),columns={problems:[],hypotheses:[],tests:[],details:[]};
      for(const node of roots)columns[node.type==='observation'?'problems':node.type==='hypothesis'?'hypotheses':['test_proposal','test_result'].includes(node.type)?'tests':'details'].push(node);
      const thread=(run.meeting_threads||[]).find(thread=>thread.thread_id===topic.id),title=clean(run.topic_titles?.[topic.id])||clean(thread?.title);
      return {...topic,title,nodes:roots,columns,edges:edges.filter(edge=>edge.thread_id===topic.id),review:review.filter(item=>item.event_ids.some(id=>members.some(node=>node.id===id)))};
    });
    return {topics,edges,review,excluded:projected.excluded||[],state:sharedState||null,metrics:{topics:topics.length,events:nodes.size,nested:[...nodes.values()].filter(node=>node.parent_id).length,edges:edges.length,reviews:review.length}};
  }

  function create({canvas,board,onRename = () => {},onInspect = () => {}} = {}) {
    if (!canvas || !board || !canvas.contains(board)) throw Error('Informe o canvas e seu quadro de assuntos.');
    const document = canvas.ownerDocument;
    const view = document.defaultView || root;
    const expanded = new Set(), collapsed = new Set(), warnings = new Set(), known = new Set(),extraOpen=new Set();
    let zoom = 1, signature = '', runId = null, clusters = null, frame = 0, drag = null, fitted = false, destroyed = false, pendingFit = false, topicCount = 0;
    let svg=null,links=[],spaceHeld=false,pointerInside=false,suppressClickUntil=0,connectionsVisible=true,projection=null;
    const padding={left:600,right:600,top:600,bottom:600};
    const listeners = [];
    const element = (tag, className, text) => {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    };
    const listen = (node, name, fn, options) => { node.addEventListener(name,fn,options);listeners.push(() => node.removeEventListener(name,fn,options)); };
    const icon = (text, label, className) => {
      const button = element('button',className,text);button.type='button';button.title=label;button.setAttribute('aria-label',label);return button;
    };

    function updateGrid() {
      // Keep the same grid family without turning the overview into a dense
      // field of dots when individual cards are no longer readable.
      const spacing=24*zoom*(zoom<.5?2**Math.ceil(Math.log2(.5/zoom)):1);
      canvas.style.setProperty('--mc-grid-size',spacing+'px');
      canvas.style.setProperty('--mc-grid-x',(-canvas.scrollLeft%spacing)+'px');
      canvas.style.setProperty('--mc-grid-y',(-canvas.scrollTop%spacing)+'px');
    }
    function announceZoom() {
      board.dataset.detail=zoom<.28?'topics':zoom<.58?'lines':'full';
      board.style.setProperty('--mc-title-scale',String(zoom<.28?Math.min(8,.78/zoom):1));
      canvas.dispatchEvent(new view.CustomEvent('norte:canvas-zoom',{bubbles:true,detail:{zoom}}));
    }
    function setZoom(value, point = {x:canvas.clientWidth/2,y:canvas.clientHeight/2}) {
      const numeric=Number(value);if (!Number.isFinite(numeric) || destroyed) return zoom;
      const next=Math.max(.12,Math.min(1.8,numeric));
      const x=(canvas.scrollLeft+point.x)/zoom,y=(canvas.scrollTop+point.y)/zoom;
      zoom=next;board.style.zoom=String(zoom);
      panTo(x*zoom-point.x,y*zoom-point.y);
      updateGrid();announceZoom();schedule();return zoom;
    }
    function fit() {
      if (!clusters || !canvas.clientWidth || !canvas.clientHeight || destroyed) return zoom;
      // Measure content rather than the extra surface reserved for panning.
      const focus=clusters.querySelector('.room-topic')||clusters,bounds=focus.getBoundingClientRect(),width=bounds.width/zoom,height=bounds.height/zoom;
      const minimum=canvas.clientWidth>=900?.85:.45;
      const next=Math.max(minimum,Math.min(1,(canvas.clientWidth-64)/Math.max(1,width),(canvas.clientHeight-64)/Math.max(1,height)));
      const boardBounds=board.getBoundingClientRect(),left=(bounds.left-boardBounds.left)/zoom,top=(bounds.top-boardBounds.top)/zoom;
      zoom=next;board.style.zoom=String(zoom);
      canvas.scrollLeft=left*zoom-Math.max(24,(canvas.clientWidth-width*zoom)/2);
      canvas.scrollTop=top*zoom-32;
      updateGrid();announceZoom();drawEdges();return zoom;
    }
    function inspectText() {
      if(zoom>=.28)for(const body of board.querySelectorAll('.room-topic-body'))body.style.setProperty('--mc-body-height',body.scrollHeight+'px');
      for (const button of board.querySelectorAll('.mc-node-text')) {
        const copy=button.querySelector('.mc-node-copy'),isExpanded=expanded.has(button.closest('[data-event-id]').dataset.eventId);
        // Measure the collapsed copy even when open: short text must never gain
        // a redundant “Recolher” control after a click or a room resize.
        const lineHeight=parseFloat(view.getComputedStyle(copy).lineHeight)||18;
        const overflowing=isExpanded?copy.scrollHeight>lineHeight*4+1:copy.scrollHeight>copy.clientHeight+1;
        button.classList.toggle('has-overflow',overflowing);
        button.tabIndex=overflowing?0:-1;
        if(!overflowing){expanded.delete(button.closest('[data-event-id]').dataset.eventId);button.classList.remove('is-expanded');button.setAttribute('aria-expanded','false');}
      }
    }
    function schedule(requestFit = false) {
      pendingFit=pendingFit || requestFit;
      if (frame) view.cancelAnimationFrame(frame);
      frame=view.requestAnimationFrame(() => {
        frame=0;if(destroyed)return;
        if (pendingFit && topicCount && canvas.clientWidth && canvas.clientHeight) { fit();fitted=true;pendingFit=false; }
        inspectText();updateGrid();drawEdges();
      });
    }
    function drawEdges(){
      if(!svg||!clusters||!canvas.clientWidth)return;
      svg.style.display=connectionsVisible&&zoom>=.28?'':'none';
      const make=(tag,attrs={})=>{const item=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [key,value] of Object.entries(attrs))item.setAttribute(key,String(value));return item;};
      const origin=board.getBoundingClientRect(),width=board.offsetWidth,height=board.offsetHeight;
      svg.setAttribute('width',String(width));svg.setAttribute('height',String(height));svg.setAttribute('viewBox','0 0 '+width+' '+height);
      // The application also styles small icon SVGs; this surface needs the
      // board's measured dimensions rather than the shared 18px icon size.
      svg.style.width=width+'px';svg.style.height=height+'px';
      const defs=make('defs');
      for(const [name,color] of [['direct','#8faabf'],['review','#c4a361'],['error','#cf7886']]){const marker=make('marker',{id:'mc-'+name+'-arrow',viewBox:'0 0 8 8',refX:7,refY:4,markerWidth:6,markerHeight:6,orient:'auto'});marker.append(make('path',{d:'M1 1 L7 4 L1 7 Z',fill:color}));defs.append(marker);}svg.replaceChildren(defs);
      const cards=new Map([...board.querySelectorAll('.room-node')].map(card=>[card.dataset.eventId,card]));
      const box=card=>{const rect=card.getBoundingClientRect(),header=card.querySelector('.room-node-header').getBoundingClientRect();return {left:(rect.left-origin.left)/zoom,right:(rect.right-origin.left)/zoom,y:(header.top+header.height/2-origin.top)/zoom};};
      for(const link of links){
        const source=cards.get(link.source_id),target=cards.get(link.target_id);
        if(!source||!target||!source.getClientRects().length||!target.getClientRects().length||!source.offsetHeight||!target.offsetHeight)continue;
        const a=box(source),b=box(target),sameColumn=Math.abs(a.left-b.left)<80||target.contains(source)||source.contains(target);
        const nestedResult=link.type==='result_of'&&target.contains(source);
        const {path,labelX,labelY,anchor}=routeEdge(a,b,{sameColumn,nestedResult,resultTop:(source.getBoundingClientRect().top-origin.top)/zoom});
        const description=link.source_id+': '+link.source_text+'\n'+link.label+' → '+link.target_id+': '+link.target_text;
        const markerType=link.error?'error':link.review_state==='confirmed'?'direct':'review';
        const line=make('path',{d:path,class:'mc-edge'+(nestedResult?' mc-edge-nested':'')+(link.review_state==='confirmed'?'':' mc-edge-review'),'marker-end':'url(#mc-'+markerType+'-arrow)','aria-label':description});line.dataset.relationId=link.id;line.dataset.relationType=link.type;line.dataset.sourceId=link.source_id;line.dataset.targetId=link.target_id;line.dataset.status=link.error?'error':link.review_state;
        const lineTitle=make('title');lineTitle.textContent=description;line.append(lineTitle);svg.append(line);
        const label=make('g',{class:'mc-edge-label'+(nestedResult?' mc-edge-label-nested':''),transform:`translate(${labelX},${labelY})`}),title=make('title');title.textContent=description;label.dataset.relationId=link.id;
        const text=make('text',{'text-anchor':anchor,dy:nestedResult?'0':'-5'});text.textContent=link.label;
        label.append(title,text);svg.append(label);
        if(link.review_state!=='confirmed'){
          const warning=make('g',{class:'mc-edge-warning',role:'button',tabindex:'0',transform:`translate(${labelX},${labelY+10})`,'aria-label':'Revisar vínculo: '+(link.issues?.[0]?.message||link.label)});
          warning.dataset.relationId=link.id;warning.dataset.status=link.error?'error':'review';
          warning.append(make('path',{d:'M 0 -8 L 8 6 L -8 6 Z',fill:'#102332',stroke:'currentColor','stroke-width':1.3}));
          const mark=make('text',{'text-anchor':'middle',y:3});mark.textContent='!';warning.append(mark);
          const inspect=()=>onInspect({kind:'relation',relation_id:link.id,issues:link.issues||[]});
          warning.addEventListener('click',inspect);warning.addEventListener('keydown',event=>{if(['Enter',' '].includes(event.key)){event.preventDefault();inspect();}});svg.append(warning);
        }
      }
    }
    function applyPadding(){board.style.padding=`${padding.top}px ${padding.right}px ${padding.bottom}px ${padding.left}px`;}
    function panTo(left,top){
      let shiftX=0,shiftY=0;
      const step=600*zoom;
      if(left<120){shiftX=Math.ceil((120-left)/step)*step;padding.left+=shiftX/zoom;left+=shiftX;}
      if(top<120){shiftY=Math.ceil((120-top)/step)*step;padding.top+=shiftY/zoom;top+=shiftY;}
      if(shiftX||shiftY)applyPadding();
      const maxX=canvas.scrollWidth-canvas.clientWidth,maxY=canvas.scrollHeight-canvas.clientHeight;
      if(left>maxX-120)padding.right+=Math.ceil((left-maxX+120)/step)*600;
      if(top>maxY-120)padding.bottom+=Math.ceil((top-maxY+120)/step)*600;
      applyPadding();canvas.scrollLeft=left;canvas.scrollTop=top;
      if(drag){drag.left+=shiftX;drag.top+=shiftY;}schedule();
    }
    function nodeCard(node, depth = 0) {
      const card=element('article','room-node');
      card.dataset.eventId=node.id;card.dataset.type=node.type;card.dataset.status=node.status;card.dataset.canvasStatus=node.canvas_status;card.dataset.depth=String(depth);
      if (!known.has(node.id)) { card.classList.add('mc-new');known.add(node.id); }
      const header=element('header','room-node-header');
      header.append(element('span','room-node-label',node.type==='observation'?'Problema':node.label));
      header.append(element('span','room-node-state',node.status_label));
      const info=icon('', 'Ver informações e diagnóstico deste registro','mc-node-info');
      const infoSymbol=document.createElementNS('http://www.w3.org/2000/svg','svg');infoSymbol.setAttribute('viewBox','0 0 16 16');infoSymbol.setAttribute('aria-hidden','true');
      infoSymbol.innerHTML='<circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.15"/><path d="M8 7v4M8 4.5v1" fill="none" stroke="currentColor" stroke-width="1.3"/>';info.append(infoSymbol);
      info.addEventListener('click',()=>onInspect({kind:'event',event_id:node.id,issues:node.inspection.issues,eventIds:[...node.inspection.eventIds],relationIds:[...node.inspection.relationIds]}));header.append(info);
      if(node.links.length)header.title=node.links.map(link=>link.source_text+' → '+link.target_text+' ('+link.label+')').join('\n');
      if (node.review.length) {
        const detail=element('details','room-warning'),summary=element('summary');
        const symbol=document.createElementNS('http://www.w3.org/2000/svg','svg');symbol.setAttribute('viewBox','0 0 20 20');symbol.setAttribute('aria-hidden','true');
        symbol.innerHTML='<path d="M10 2 19 18H1Z" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M10 7v5m0 2v1" fill="none" stroke="currentColor" stroke-width="1.7"/>';summary.append(symbol);
        summary.setAttribute('aria-label','Ver pontos para revisão');summary.title='Ver pontos para revisão';
        detail.open=warnings.has(node.id);detail.append(summary);
        const content=element('div','mc-warning-content');
        content.append(element('strong','','Revisar classificação'));
        for (const message of new Set(node.review.map(item=>item.message))) content.append(element('p','',message));
        const explore=icon('Explorar diagnóstico','Abrir diagnóstico da classificação','mc-inspect');explore.addEventListener('click',()=>onInspect({kind:'event',event_id:node.id,issues:node.review}));content.append(explore);
        detail.append(content);detail.addEventListener('toggle',() => detail.open ? warnings.add(node.id) : warnings.delete(node.id));header.append(detail);
      }
      card.append(header);
      const read=element('button','mc-node-text'),copy=element('span','mc-node-copy',node.text),more=element('span','mc-text-toggle','Expandir');
      read.type='button';read.setAttribute('aria-expanded',String(expanded.has(node.id)));
      read.setAttribute('aria-label','Mostrar registro completo: '+node.text);more.setAttribute('aria-hidden','true');
      if(expanded.has(node.id)){read.classList.add('is-expanded');more.textContent='Recolher';}
      read.append(copy,more);read.addEventListener('click',() => {
        if(!read.classList.contains('has-overflow'))return;
        const open=!expanded.has(node.id);open?expanded.add(node.id):expanded.delete(node.id);
        read.classList.toggle('is-expanded',open);read.setAttribute('aria-expanded',String(open));more.textContent=open?'Recolher':'Expandir';
        read.setAttribute('aria-label',(open?'Recolher registro: ':'Mostrar registro completo: ')+node.text);schedule();
      });
      card.append(read);
      if (node.children.length) {
        const children=element('div','room-node-children');children.hidden=collapsed.has(node.id);
        const toggle=icon('⌄', 'Recolher registros relacionados','mc-children-toggle');
        toggle.setAttribute('aria-expanded',String(!children.hidden));
        toggle.addEventListener('click',() => {
          const hide=!children.hidden;children.hidden=hide;hide?collapsed.add(node.id):collapsed.delete(node.id);
          toggle.textContent=hide?'›':'⌄';toggle.setAttribute('aria-expanded',String(!hide));
          toggle.title=(hide?'Mostrar ':'Recolher ')+node.children.length+' registros relacionados';toggle.setAttribute('aria-label',toggle.title);schedule();
        });
        if(children.hidden)toggle.textContent='›';header.append(toggle);
        for (const child of node.children) children.append(nodeCard(child,depth+1));
        card.append(children);
      }
      return card;
    }
    function render(run) {
      if (destroyed) throw Error('Este canvas já foi encerrado.');
      if (!run) { reset();return {topics:[],edges:[],review:[],metrics:{topics:0,events:0,nested:0,edges:0,reviews:0}}; }
      const nextProjection=build(run),nextId=run.id || run.run_id || null;
      if (runId!==nextId) { reset();runId=nextId; }
      projection=nextProjection;
      const nextSignature=JSON.stringify(projection);if(signature===nextSignature)return projection;signature=nextSignature;topicCount=projection.topics.length;
      // Preserve the viewport and review affordances as the projection grows.
      const left=canvas.scrollLeft,top=canvas.scrollTop;
      clusters=element('div','mc-clusters');
      for (const [index,topic] of projection.topics.entries()) {
        const cluster=element('section','room-topic');cluster.dataset.topicId=topic.id||'';cluster.id='topic-'+(topic.id||'pending');
        const header=element('header','room-topic-head'),name=element('div','room-topic-name');
        header.append(element('span','room-topic-index',String(index+1).padStart(2,'0')));
        const placeholder=topic.id?'Diga “Norte, o assunto '+(index+1)+' é [nome do assunto]”':'Aguardando definição do assunto';
        const title=element('h2',topic.title?'':'mc-title-placeholder',topic.title||placeholder);title.title=topic.title||placeholder;name.append(title);header.append(name);
        header.addEventListener('click',event=>{if(zoom<.28&&!event.target.closest('button'))focusTopic(topic.id);});
        if (topic.id) {
          const edit=icon('✎',topic.title?'Renomear '+topic.title:'Definir nome do assunto','room-edit-title');edit.addEventListener('click',()=>onRename(topic.id,topic.title||''));header.append(edit);
        }
        const body=element('div','room-topic-body');
        for(const [key,label] of [['problems','Problema'],['hypotheses','Hipóteses'],['tests','Testes']]){
          const column=element('section','mc-column');column.dataset.column=key;
          const heading=element('h3','mc-column-title',label);heading.append(element('span','',String(topic.columns[key].length)));column.append(heading);
          const list=element('div','mc-column-nodes');for(const node of topic.columns[key])list.append(nodeCard(node));column.append(list);body.append(column);
        }
        cluster.append(header,body);
        if(topic.columns.details.length){
          const detail=element('details','mc-topic-details');detail.open=extraOpen.has(topic.id);
          detail.append(element('summary','','Decisões, critérios e outros registros · '+topic.columns.details.length));
          const list=element('div','mc-detail-nodes');for(const node of topic.columns.details)list.append(nodeCard(node));detail.append(list);
          detail.addEventListener('toggle',()=>{detail.open?extraOpen.add(topic.id):extraOpen.delete(topic.id);schedule();});cluster.append(detail);
        }
        clusters.append(cluster);
      }
      if (!projection.topics.length) clusters.append(element('p','room-board-empty','Os assuntos aparecerão aqui conforme a conversa avançar.'));
      svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.classList.add('mc-edges');svg.setAttribute('aria-label','Relações diretas confirmadas');links=projection.edges;
      board.replaceChildren(clusters,svg);canvas.scrollLeft=left;canvas.scrollTop=top;
      schedule(projection.topics.length>0 && !fitted);return projection;
    }
    function reset() {
      if(frame)view.cancelAnimationFrame(frame);frame=0;signature='';runId=null;clusters=null;fitted=false;pendingFit=false;topicCount=0;
      expanded.clear();collapsed.clear();warnings.clear();known.clear();extraOpen.clear();drag=null;svg=null;links=[];projection=null;canvas.classList.remove('mc-panning');
      for(const side of ['left','right','top','bottom'])padding[side]=600;applyPadding();
      board.replaceChildren();zoom=1;board.style.zoom='1';canvas.scrollLeft=0;canvas.scrollTop=0;updateGrid();announceZoom();
    }
    const interactive=target=>target.closest('a,input,textarea,select,summary,[data-no-pan],.mc-edge-warning,button:not(.mc-node-text)');
    listen(canvas,'pointerenter',()=>{pointerInside=true;});listen(canvas,'pointerleave',()=>{pointerInside=false;});
    listen(canvas,'pointerdown',event => {
      if(event.button!==0 || event.pointerType==='touch' || !spaceHeld&&interactive(event.target))return;
      drag={id:event.pointerId,x:event.clientX,y:event.clientY,left:canvas.scrollLeft,top:canvas.scrollTop};
      if(!event.target.closest('.mc-node-text'))event.preventDefault();
    });
    listen(canvas,'pointermove',event => {
      if(!drag || event.pointerId!==drag.id)return;
      if(Math.abs(event.clientX-drag.x)+Math.abs(event.clientY-drag.y)<=3&&!drag.moved)return;
      drag.moved=true;suppressClickUntil=view.performance.now()+300;
      if(!canvas.hasPointerCapture(event.pointerId))canvas.setPointerCapture(event.pointerId);canvas.classList.add('mc-panning');
      panTo(drag.left-(event.clientX-drag.x),drag.top-(event.clientY-drag.y));
    });
    const stopPan=event=>{if(!drag || event.pointerId!==drag.id)return;drag=null;canvas.classList.remove('mc-panning');if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);};
    listen(canvas,'pointerup',stopPan);listen(canvas,'pointercancel',stopPan);listen(canvas,'lostpointercapture',()=>{drag=null;canvas.classList.remove('mc-panning');});
    listen(canvas,'click',event=>{if(view.performance.now()<suppressClickUntil){event.preventDefault();event.stopPropagation();}},true);
    listen(view,'keydown',event=>{if(event.code==='Space'&&!event.target.closest?.('input,textarea,select,[contenteditable=true]')&&(pointerInside||canvas.contains(document.activeElement))){spaceHeld=true;canvas.classList.add('mc-space-pan');event.preventDefault();}});
    listen(view,'keyup',event=>{if(event.code==='Space'){spaceHeld=false;canvas.classList.remove('mc-space-pan');}});
    listen(view,'blur',()=>{spaceHeld=false;drag=null;canvas.classList.remove('mc-space-pan','mc-panning');});
    listen(canvas,'scroll',updateGrid,{passive:true});
    listen(board,'transitionend',event=>{if(event.target.matches('.room-topic-body,.room-topic-name h2'))schedule();});
    listen(canvas,'wheel',event => {
      if(event.target.closest('.mc-warning-content'))return;
      event.preventDefault();
      const scale=event.deltaMode===1?16:event.deltaMode===2?canvas.clientHeight:1;
      const rect=canvas.getBoundingClientRect();setZoom(zoom*Math.exp(-event.deltaY*scale*.002),{x:event.clientX-rect.left,y:event.clientY-rect.top});
    },{passive:false});
    listen(canvas,'keydown',event => {
      if(event.target!==canvas)return;
      if(['+','=','-','0'].includes(event.key)){event.preventDefault();event.key==='0'?fit():setZoom(zoom+(event.key==='-'?-.1:.1));}
    });
    // A narrower room or an opened transcript changes the actual viewport, not
    // the document. Reframe only on that resize; arrivals preserve navigation.
    let measuredWidth=0,measuredHeight=0;
    const resize=typeof view.ResizeObserver==='function' ? new view.ResizeObserver(() => {
      // Zoom can show/hide scrollbars. Their content-box delta is not a room
      // resize and must not undo the user's chosen zoom level.
      const bounds=canvas.getBoundingClientRect(),width=bounds.width,height=bounds.height;
      if(!width || !height || width===measuredWidth && height===measuredHeight)return;
      measuredWidth=width;measuredHeight=height;
      if(topicCount)schedule(true);
    }) : null;
    resize?.observe(canvas);
    applyPadding();updateGrid();
    function focusTopic(id){const topic=[...board.querySelectorAll('.room-topic')].find(item=>item.dataset.topicId===(id||''));if(!topic)return false;setZoom(Math.max(.8,zoom));const origin=board.getBoundingClientRect(),rect=topic.getBoundingClientRect();canvas.scrollLeft=rect.left-origin.left-Math.max(24,(canvas.clientWidth-rect.width)/2);canvas.scrollTop=rect.top-origin.top-32;schedule();return true;}
    return {render,reset,setZoom,fit,focusTopic,getProjection:()=>projection,getZoom:()=>zoom,setConnectionsVisible(value){connectionsVisible=!!value;drawEdges();return connectionsVisible;},getConnectionsVisible:()=>connectionsVisible,destroy(){destroyed=true;if(frame)view.cancelAnimationFrame(frame);resize?.disconnect();for(const remove of listeners)remove();canvas.classList.remove('mc-panning');}};
  }
  return {create,build,relationLabels,statusLabels,routeEdge};
});
