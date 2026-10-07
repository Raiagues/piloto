/* Beam editor and comparisons share the original solver through NorteBeamEngine. */
(function (root) {
  'use strict';
  const clone = value => JSON.parse(JSON.stringify(value));
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const fmt = (value, digits = 3) => Number.isFinite(value) ? value.toLocaleString('pt-BR', {maximumFractionDigits: digits}) : value === Infinity ? '∞' : '—';
  const force = value => fmt(value / 1000) + ' kN';
  const moment = value => fmt(value / 1000) + ' kN·m';
  const colors = {ink:'#b1c7d7', beam:'#ca8673', edge:'#835f53', blue:'#72b2ed', red:'#e08d77', green:'#72c4a4', purple:'#ba9bd9', muted:'#7895aa'};
  const graphNames = {shear:'Força cortante', bending:'Momento fletor', deflection:'Deslocamento'};
  const supportNames = {fixed:'Engaste', pin:'Articulado', roller:'Rolete'};
  const loadNames = {force:'Força vertical', mass:'Massa', moment:'Momento', udl:'Carga distribuída'};
  let instance = 0;
  const line = (x1,y1,x2,y2,color,width=1,extra='') => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${width}" ${extra}/>`;
  const text = (x,y,value,extra='') => `<text x="${x}" y="${y}" ${extra.includes('text-anchor=')?'':'text-anchor="middle"'} ${extra}>${esc(value)}</text>`;
  function arrow(x,y1,y2,color,width=2) {
    const sign = y2 >= y1 ? 1 : -1, base = y2 - sign * 8;
    return line(x,y1,x,base+sign,color,width) + `<path d="M${x-3.7},${base}L${x},${y2}L${x+3.7},${base}Z" fill="${color}"/>`;
  }
  function momentArrow(x,y,r,positive,color) {
    const start = positive ? .72 : -.72, end = positive ? -4.2 : 4.2;
    const sx=x+r*Math.cos(start),sy=y+r*Math.sin(start),ex=x+r*Math.cos(end),ey=y+r*Math.sin(end),sign=positive?-1:1;
    const tx=-Math.sin(end)*sign,ty=Math.cos(end)*sign,bx=ex-7*tx,by=ey-7*ty;
    return `<path d="M${sx},${sy}A${r},${r} 0 1 ${positive?0:1} ${ex},${ey}" fill="none" stroke="${color}" stroke-width="2"/><path d="M${ex},${ey}L${bx-3.5*ty},${by+3.5*tx}L${bx+3.5*ty},${by-3.5*tx}Z" fill="${color}"/>`;
  }
  function ground(x,y,w) {
    let out=line(x-w,y,x+w,y,colors.ink);
    for(let i=-w+4;i<=w;i+=6)out+=line(x+i,y,x+i-4,y+5,colors.muted,.8);
    return out;
  }
  function supportGlyph(x,y,p,hatch) {
    if(p.type==='roller')return `<circle cx="${x}" cy="${y+9}" r="8" fill="#102a3b" stroke="${colors.ink}" stroke-width="1.5"/>`+ground(x,y+18,19);
    if(p.type==='pin')return `<path d="M${x-6},${y}Q${x},${y-7} ${x+6},${y}L${x+12},${y+22}H${x-12}Z" fill="#294556" stroke="${colors.ink}" stroke-width="1.4"/><circle cx="${x}" cy="${y+2}" r="3.5" fill="#071a2a" stroke="${colors.ink}"/>`+ground(x,y+23,21);
    if(p.edge==='left'||p.edge==='right')return `<rect x="${p.edge==='left'?x-12:x}" y="${y-38}" width="12" height="69" fill="url(#${hatch})"/>`+line(x,y-38,x,y+31,colors.ink,2);
    return `<path d="M${x-8},${y-12}V${y+22}H${x+8}V${y-12}" fill="url(#${hatch})" stroke="${colors.ink}"/>`+ground(x,y+23,22);
  }
  function summaryFor(state, result, structural) {
    return `Viga de ${fmt(state.L)} m; ${state.supports.map(p=>`${supportNames[p.type]} ${p.name} em ${fmt(p.x)} m`).join('; ')}; ${state.loads.map(p=>`${p.name}: ${loadNames[p.kind]}, ${fmt(p.value)} ${p.kind==='mass'?'kg':p.kind==='moment'?'N·m':p.kind==='udl'?'N/m':'N'}, x=${fmt(p.x)} m${p.kind==='udl'?` a ${fmt(p.end)} m`:''}`).join('; ')}. ${result.valid?`|V|max=${force(structural.d.Vmax)}; |M|max=${moment(structural.d.Mmax)}; tensão máxima=${fmt(structural.sigma/1e6)} MPa; deslocamento máximo=${fmt(structural.deflection.max*1000)} mm.`:`Cálculo indisponível: ${result.error}`}`;
  }
  function mount(host, options = {}) {
    const engine = root.NorteBeamEngine;
    if(!host || !engine)throw new Error('O simulador de vigas não está disponível.');
    const uid='bw-'+(++instance), supplied=options.data||{};
    let state=engine.normalize(supplied.state||options.state||engine.defaultState());
    let versions=Array.isArray(supplied.versions)?clone(supplied.versions):[];
    if(!versions.length)versions=[{id:'V001',label:'Configuração inicial',createdAt:new Date().toISOString(),source:'initial',state:clone(state)}];
    let currentId=supplied.currentId||versions.at(-1).id, baselineId=supplied.baselineId||versions[0].id;
    let tab=['simulation','graphs','results','calculations'].includes(supplied.tab)?supplied.tab:'simulation';
    let plots=Array.isArray(supplied.graphs)?supplied.graphs.filter(p=>graphNames[p]):[supplied.plot||'bending'];
    if(!plots.length)plots=['bending'];
    let compareEnabled=supplied.viewSchema===2&&supplied.compareEnabled===true, showReactions=supplied.viewSchema===2&&supplied.showReactions===true;
    let simulationFocus=supplied.viewSchema===2&&supplied.simulationFocus==='section'?'section':'beam';
    let probeX=Number.isFinite(supplied.probeX)?supplied.probeX:state.L/2,probeSide=supplied.probeSide==='left'?'left':'right';
    let selection={kind:'beam',id:''}, result, structural, baseline, baselineResult, baselineStructural;
    let destroyed=false, timer=0, drag=null, lastError='', recording=false;
    host.classList.add('beam-workspace');
    host.innerHTML=`<div class="bw-versionbar" hidden><label class="bw-baseline">Referência<select data-baseline aria-label="Configuração de referência"></select></label><label class="bw-toggle"><input type="checkbox" data-compare> Comparar</label></div><div class="bw-notice" role="status" hidden></div><button type="button" class="bw-menu-toggle" data-action="options" aria-label="Opções da simulação" aria-expanded="false"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/></svg></button><div class="bw-options" hidden><button type="button" data-edit="beam">Editar viga</button><button type="button" data-action="section">Ver seção transversal</button><button type="button" data-edit="support">Apoios</button><button type="button" data-edit="load">Carregamentos</button><label class="bw-toggle"><input type="checkbox" data-reactions> Mostrar reações</label><button type="button" data-action="history">Histórico de alterações</button><button type="button" data-action="record">Registrar resultado na reunião</button></div><div class="bw-history" hidden></div><div class="bw-content"><section class="bw-pane bw-simulation" data-pane="simulation"><div class="bw-scene"><div class="bw-drawing-wrap"><svg class="bw-drawing" viewBox="0 0 1000 365" role="img" aria-label="Viga, apoios e carregamentos"></svg></div><div class="bw-section-focus" hidden><div class="bw-section-heading"><button type="button" class="bw-back" data-action="beam">← Viga</button><span>Seção transversal</span><button type="button" class="bw-text-action" data-edit="section">Editar</button></div><svg class="bw-section-3d" viewBox="0 0 760 460" role="img" aria-label="Seção transversal extrudida em três dimensões"></svg></div><div class="bw-scene-status" role="status" hidden></div></div></section><section class="bw-pane bw-graphs" data-pane="graphs" hidden><div class="bw-pane-heading"><div><h3>Diagramas</h3><p>Mesma escala para a referência e a configuração atual.</p></div><div class="bw-graph-switch" role="group" aria-label="Diagramas">${Object.entries(graphNames).map(([id,name])=>`<button type="button" data-plot="${id}">${name}</button>`).join('')}<button type="button" data-plot="all">Todos</button></div></div><div class="bw-chart-tools"><div class="bw-chart-legend"></div><div class="bw-probe-controls"><label>Seção x <input type="number" min="0" step="any" data-probe-x aria-label="Seção do diagrama em metros"> m</label><label>Lado <select data-probe-side aria-label="Lado da seção"><option value="left">À esquerda</option><option value="right">À direita</option></select></label></div></div><div class="bw-charts"></div></section><section class="bw-pane bw-results" data-pane="results" hidden></section><section class="bw-pane bw-calculations" data-pane="calculations" hidden></section></div><dialog class="bw-inspector" aria-label="Editar elemento"><header><h3 data-inspector-title></h3><button type="button" data-action="close-editor" aria-label="Fechar edição">×</button></header><div class="bw-editor"></div></dialog>`;
    const $=selector=>host.querySelector(selector);
    const snapshot=()=>clone({schema:1,viewSchema:2,state,versions,baselineId,currentId,tab,graphs:plots,plot:plots[0],showReactions,compareEnabled,probeX,probeSide,simulationFocus});
    function notify(detail={}) {if(!destroyed&&options.onChange)options.onChange(snapshot(),detail);}
    function recompute(){
      result=engine.calculate(state);structural=engine.structuralResults(state,result);
      baseline=engine.normalize((versions.find(v=>v.id===baselineId)||versions[0]).state);
      baselineResult=engine.calculate(baseline);baselineStructural=engine.structuralResults(baseline,baselineResult);
    }
    function notice(message) {lastError=message||'';$('.bw-notice').hidden=!lastError;$('.bw-notice').textContent=lastError;}
    function versionId(){let n=versions.length+1;while(versions.some(v=>v.id==='V'+String(n).padStart(3,'0')))n++;return 'V'+String(n).padStart(3,'0');}
    function commit(next,label,source='manual',meta={}) {
      next=engine.normalize(next);
      if(JSON.stringify(next)===JSON.stringify(state))return false;
      try { engine.applyOperations(next, []); } catch (error) { notice(error.message); return false; }
      state=next;currentId=versionId();
      versions.push({id:currentId,label:label||'Configuração atualizada',createdAt:new Date().toISOString(),source,state:clone(state),...(meta.provenance?{provenance:clone(meta.provenance)}:{})});
      notice('');render();notify({source,label,versionId:currentId});return true;
    }
    function executeOperations(operations,meta={}) {
      flushInput();
      const physical=operations.filter(op=>!['open_simulation','show_graphs','show_results','show_calculations','show_section','compare'].includes(op.type||op.op||op.command_type));
      if(physical.length){
        const applied=engine.applyOperations(state,physical);
        if(applied.valid===false||applied.ok===false||applied.error)throw new Error(applied.error||(applied.errors||[]).join(' ')||'Não foi possível aplicar a alteração.');
        commit(applied.state||applied,meta.label||'Alteração durante a reunião',meta.source||'voice',meta);
      }
      if(physical.some(op=>op.type==='change_section'))showSection();
      for(const op of operations){const type=op.type||op.op||op.command_type;
        if(type==='open_simulation'){simulationFocus='beam';showTab('simulation');}
        if(type==='show_section')showSection();
        if(type==='show_graphs'){plots=(op.graphs||['bending']).filter(p=>graphNames[p]);if(!plots.length)plots=['bending'];showTab('graphs');}
        if(type==='show_results')showTab('results');
        if(type==='show_calculations')showTab('calculations');
        if(type==='compare'){compareEnabled=true;if(Array.isArray(op.graphs)&&op.graphs.some(p=>graphNames[p]))plots=op.graphs.filter(p=>graphNames[p]);const index=versions.findIndex(v=>v.id===currentId);baselineId=op.reference==='initial'?versions[0].id:versions[Math.max(0,index-1)].id;showTab('graphs');}
      }
      render();notify({source:meta.source||'voice',label:meta.label||'Visualização atualizada',versionId:currentId});return snapshot();
    }
    function applyManual(ops,label){try{executeOperations(ops,{source:'manual',label});}catch(error){notice(error.message);renderEditor();}}
    function showTab(next) {
      const aliases={simulacao:'simulation','simulação':'simulation',graficos:'graphs','gráficos':'graphs',resultados:'results',calculos:'calculations','cálculos':'calculations'};
      next=aliases[next]||next;if(!['simulation','graphs','results','calculations'].includes(next))return;
      const changed=tab!==next;tab=next;for(const pane of host.querySelectorAll('[data-pane]'))pane.hidden=pane.dataset.pane!==tab;
      if(changed&&options.onTabChange)options.onTabChange(tab);renderViews();renderVisibility();if(changed)notify({source:'view',tab});
    }
    function renderVisibility(){
      $('.bw-versionbar').hidden=!(compareEnabled&&['graphs','results'].includes(tab));
      $('.bw-drawing-wrap').hidden=simulationFocus==='section';$('.bw-section-focus').hidden=simulationFocus!=='section';
    }
    function showSection(){simulationFocus='section';showTab('simulation');renderSection3D();renderVisibility();notify({source:'view'});}
    function openEditor(kind='beam',id=''){
      flushInput();selection={kind,id};$('.bw-options').hidden=true;$('[data-action="options"]').setAttribute('aria-expanded','false');renderEditor();
      const dialog=$('.bw-inspector');if(!dialog.open)dialog.showModal();
    }
    function renderVersionbar(){
      $('[data-baseline]').innerHTML=versions.map((v,i)=>`<option value="${esc(v.id)}" ${v.id===baselineId?'selected':''}>${i===0?'Configuração inicial':v.id===currentId?'Configuração atual':'Configuração '+(i+1)}</option>`).join('');
      $('[data-compare]').checked=compareEnabled;$('[data-reactions]').checked=showReactions;
      $('[data-action="record"]').disabled=!result.valid||recording;
      $('.bw-history').innerHTML=`<div class="bw-history-heading"><h3>Alterações da viga</h3><button type="button" data-action="history">Fechar</button></div>${versions.slice().reverse().map(v=>`<div class="bw-history-row"><span>${esc(v.label)}<small>${new Date(v.createdAt).toLocaleString('pt-BR')}</small></span><button type="button" data-restore="${esc(v.id)}" ${v.id===currentId?'disabled':''}>${v.id===currentId?'Atual':'Restaurar'}</button></div>`).join('')}`;
    }
    const field=(label,path,value,unit='',config={})=>`<label class="bw-field">${esc(label)}<span class="bw-input-wrap"><input ${config.text?'type="text"':'type="number" inputmode="decimal"'} data-field="${esc(path)}" value="${esc(Number.isFinite(value)?Number(value.toFixed(8)):value)}" ${config.min!==undefined?`min="${config.min}"`:''} ${config.max!==undefined?`max="${config.max}"`:''} step="${config.step||'any'}" ${config.text?'maxlength="48"':''}>${unit?`<span>${esc(unit)}</span>`:''}</span></label>`;
    const select=(label,path,value,choices)=>`<label class="bw-field">${esc(label)}<select data-field="${esc(path)}">${Object.entries(choices).map(([k,v])=>`<option value="${esc(k)}" ${k===String(value)?'selected':''}>${esc(v)}</option>`).join('')}</select></label>`;
    function renderEditor(){
      const focused=host.contains(root.document.activeElement)?root.document.activeElement:null,focusPath=focused?.dataset?.field;
      let html=`<section class="bw-editor-group"><h3>Viga</h3><div class="bw-fields">${field('Comprimento','beam.L',state.L,'m',{min:.5,max:20})}${field('Massa total da viga','beam.mbar',state.mbar,'kg',{min:0})}${field('Gravidade','beam.g',state.g,'m/s²',{min:.1,max:30})}</div><p class="bw-field-note">O peso próprio usa esta massa, distribuída uniformemente.</p></section>`;
      html+=`<section class="bw-editor-group"><h3>Seção transversal</h3>${select('Perfil','section.shape',state.section.shape,{rect:'Retangular',i:'I / H'})}<div class="bw-section-layout"><svg viewBox="0 0 130 125" class="bw-section-preview" aria-label="Seção transversal">${sectionSVG()}</svg><div class="bw-fields">${field('Largura b','section.b',state.section.b*1000,'mm',{min:5})}${field('Altura h','section.h',state.section.h*1000,'mm',{min:5})}${state.section.shape==='i'?field('Alma tw','section.tw',state.section.tw*1000,'mm',{min:1})+field('Mesa tf','section.tf',state.section.tf*1000,'mm',{min:1}):''}</div></div><button type="button" class="bw-text-action" data-action="geometric-mass">Usar massa geométrica · ${fmt(structural.geomMass)} kg</button></section>`;
      html+=`<section class="bw-editor-group"><h3>Material</h3>${select('Material','material.key',state.material.key,Object.fromEntries(Object.entries(engine.materialLibrary).map(([k,v])=>[k,v.name])))}<div class="bw-fields">${field('Módulo E','material.E',state.material.E/1e9,'GPa',{min:.001})}${field('Escoamento','material.yield',state.material.yield/1e6,'MPa',{min:.1})}${field('Densidade','material.rho',state.material.rho,'kg/m³',{min:1})}</div></section>`;
      html+=`<section class="bw-editor-group"><div class="bw-group-heading"><h3>Apoios</h3><button type="button" data-action="add-support" ${state.supports.length>=8?'disabled':''}>+ Apoio</button></div>${state.supports.map(p=>`<div class="bw-object ${selection.id===p.id?'is-selected':''}" data-editor-object="${esc(p.id)}"><div class="bw-object-heading"><button type="button" class="bw-object-name" data-select="${esc(p.id)}" data-kind="support">${esc(p.name)} · ${supportNames[p.type]}</button><button type="button" data-remove="${esc(p.id)}" data-kind="support" aria-label="Remover apoio ${esc(p.name)}">×</button></div><div class="bw-fields">${field('Nome',`support:${p.id}.name`,p.name,'',{text:true})}${select('Tipo',`support:${p.id}.type`,p.type,supportNames)}${field('Posição',`support:${p.id}.x`,p.x,'m',{min:0,max:state.L})}</div></div>`).join('')||'<p class="bw-field-note">Adicione um apoio para definir o modelo.</p>'}</section>`;
      html+=`<section class="bw-editor-group"><div class="bw-group-heading"><h3>Carregamentos</h3><button type="button" data-action="add-load" ${state.loads.length>=10?'disabled':''}>+ Carga</button></div>${state.loads.map(p=>{
        const factor=engine.unitScale(p),unit={kg:'kg',N:'N',kN:'kN',Nm:'N·m',kNm:'kN·m',Npm:'N/m',kNpm:'kN/m'}[p.unit]||p.unit,units=p.kind==='moment'?{Nm:'N·m',kNm:'kN·m'}:p.kind==='udl'?{Npm:'N/m',kNpm:'kN/m'}:{N:'N',kN:'kN'};
        return `<div class="bw-object ${selection.id===p.id?'is-selected':''}" data-editor-object="${esc(p.id)}"><div class="bw-object-heading"><button type="button" class="bw-object-name" data-select="${esc(p.id)}" data-kind="load">${esc(p.name)} · ${loadNames[p.kind]}</button><button type="button" data-remove="${esc(p.id)}" data-kind="load" aria-label="Remover carga ${esc(p.name)}">×</button></div><div class="bw-fields">${field('Nome',`load:${p.id}.name`,p.name,'',{text:true})}${select('Tipo',`load:${p.id}.kind`,p.kind,loadNames)}${field(p.kind==='udl'?'Início':'Posição',`load:${p.id}.x`,p.x,'m',{min:0,max:state.L})}${p.kind==='udl'?field('Fim',`load:${p.id}.end`,p.end,'m',{min:0,max:state.L}):''}${field('Magnitude',`load:${p.id}.value`,p.value/factor,unit,{min:0})}${p.kind!=='mass'?select('Unidade',`load:${p.id}.unit`,p.unit,units):''}${p.kind!=='mass'?select('Sentido',`load:${p.id}.direction`,p.direction,p.kind==='moment'?{'1':'Anti-horário','-1':'Horário'}:{'1':'Para baixo','-1':'Para cima'}):''}</div></div>`;
      }).join('')||'<p class="bw-field-note">Nenhuma carga adicionada.</p>'}</section>`;
      $('.bw-editor').innerHTML=html;
      const groups=['beam','section','material','support','load'];
      for(const [index,group]of Array.from($('.bw-editor').children).entries()){group.dataset.editorGroup=groups[index];group.hidden=groups[index]!==selection.kind;}
      for(const object of $('.bw-editor').querySelectorAll('[data-editor-object]'))object.hidden=!!selection.id&&object.dataset.editorObject!==selection.id;
      const names={beam:'Viga',section:'Seção transversal',material:'Material',support:'Apoio',load:'Carregamento'};
      const selected=(selection.kind==='support'?state.supports:state.loads).find(p=>p.id===selection.id);
      $('[data-inspector-title]').textContent=names[selection.kind]+(selected?' · '+selected.name:'');
      if(selection.kind==='beam')$('.bw-editor').insertAdjacentHTML('beforeend','<nav class="bw-inspector-links"><button type="button" data-edit="section">Seção transversal</button><button type="button" data-edit="material">Material</button></nav>');
      if(focusPath)Array.from(host.querySelectorAll('[data-field]')).find(el=>el.dataset.field===focusPath)?.focus({preventScroll:true});
    }

    function sectionSVG(){
      const sec=structural.sec,w=clamp(72*sec.b/sec.h,35,82),h=82,x=(130-w)/2,y=12;
      const shape=sec.shape==='i'?`<rect x="${x}" y="${y}" width="${w}" height="${h*sec.tf/sec.h}"/><rect x="${65-w*sec.tw/sec.b/2}" y="${y}" width="${w*sec.tw/sec.b}" height="${h}"/><rect x="${x}" y="${y+h-h*sec.tf/sec.h}" width="${w}" height="${h*sec.tf/sec.h}"/>`:`<rect x="${x}" y="${y}" width="${w}" height="${h}"/>`;
      return `<g fill="#496273" stroke="#9ab4c6" stroke-width="1">${shape}</g>`+text(65,117,`${fmt(sec.b*1000)} × ${fmt(sec.h*1000)} mm`);
    }
    function renderSection3D(){
      const sec=structural.sec,scale=220/Math.max(sec.b,sec.h),w=sec.b*scale,h=sec.h*scale,t=sec.tf*scale,tw=sec.tw*scale,dx=180,dy=-95;
      const x=(760-w-dx)/2,y=(460-h+95)/2-10;
      const vertices=sec.shape==='i'?[[0,0],[w,0],[w,t],[(w+tw)/2,t],[(w+tw)/2,h-t],[w,h-t],[w,h],[0,h],[0,h-t],[(w-tw)/2,h-t],[(w-tw)/2,t],[0,t]]:[[0,0],[w,0],[w,h],[0,h]];
      const points=(items,ox=0,oy=0)=>items.map(([a,b])=>`${x+a+ox},${y+b+oy}`).join(' ');
      let svg=`<g class="bw-section-solid" data-profile="${sec.shape}" data-width="${sec.b}" data-height="${sec.h}"><polygon class="bw-section-back" points="${points(vertices,dx,dy)}" fill="#865e50" stroke="#bf8e79"/>`;
      for(let i=0;i<vertices.length;i++){const a=vertices[i],b=vertices[(i+1)%vertices.length];if((b[1]-a[1])*dx-(b[0]-a[0])*dy<=0)continue;svg+=`<polygon class="bw-section-face" points="${points([a,b])} ${points([b,a],dx,dy)}" fill="${a[1]===b[1]?'#be8b76':'#8d6252'}" stroke="#d8a58e" stroke-width="1"/>`;}
      svg+=`<polygon class="bw-section-front" points="${points(vertices)}" fill="#ca927d" stroke="#ecc3ae" stroke-width="1.4"/></g>`;
      const dim='#8cacc2';
      svg+=line(x,y+h+35,x+w,y+h+35,dim)+line(x,y+h+28,x,y+h+41,dim)+line(x+w,y+h+28,x+w,y+h+41,dim)+text(x+w/2,y+h+60,`b = ${fmt(sec.b*1000)} mm`,'class="bw-section-dimension"');
      svg+=line(x-42,y,x-42,y+h,dim)+line(x-48,y,x-35,y,dim)+line(x-48,y+h,x-35,y+h,dim)+text(x-62,y+h/2,`h = ${fmt(sec.h*1000)} mm`,`class="bw-section-dimension" transform="rotate(-90 ${x-62} ${y+h/2})"`);
      if(sec.shape==='i'){
        const webX=x+(w+tw)/2,webY=y+h*.58,flangeX=x+w*.78,flangeY=y+h-t/2,targetX=x+w+dx+28;
        svg+=line(webX,webY,targetX,webY+38,dim,.8)+text(targetX+8,webY+44,`tw = ${fmt(sec.tw*1000)} mm`,'class="bw-section-dimension" text-anchor="start"');
        svg+=line(flangeX,flangeY,targetX,flangeY+48,dim,.8)+text(targetX+8,flangeY+54,`tf = ${fmt(sec.tf*1000)} mm`,'class="bw-section-dimension" text-anchor="start"');
      }
      $('.bw-section-3d').innerHTML=svg;
    }
    function renderDrawing(){
      const x0=90,span=820,y=167,xOf=x=>x0+x/state.L*span,hatch=uid+'-hatch';
      let svg=`<defs><pattern id="${hatch}" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><rect width="6" height="6" fill="#132e41"/><path d="M0 0V6" stroke="#7992a6" stroke-width="1"/></pattern></defs>`;
      svg+=line(x0,28,x0+span,28,colors.blue)+line(x0,23,x0,33,colors.blue)+line(x0+span,23,x0+span,33,colors.blue)+text(500,19,`L = ${fmt(state.L)} m`);
      svg+=line(x0,34,x0,y-4,colors.blue,.8,'opacity=".2" stroke-dasharray="3 5"')+line(x0+span,34,x0+span,y-4,colors.blue,.8,'opacity=".2" stroke-dasharray="3 5"');
      svg+=`<g data-object="beam" tabindex="0" role="button" aria-label="Editar viga"><rect x="${x0}" y="${y}" width="${span}" height="16" fill="${colors.beam}" stroke="${colors.edge}"/>${line(x0+1,y+3,x0+span-1,y+3,'#edbdab')}${line(x0+1,y+13,x0+span-1,y+13,'#a86c5a')}</g>`;
      for(const p of state.supports){const x=xOf(p.x);svg+=`<g class="bw-handle ${selection.id===p.id?'is-selected':''}" data-object="support" data-id="${esc(p.id)}" tabindex="0" role="button" aria-label="Editar apoio ${esc(p.name)}"><rect class="bw-hit" x="${x-25}" y="${y-24}" width="50" height="75"/>${supportGlyph(x,y+16,{...p,edge:p.edge||(p.x===0?'left':p.x===state.L?'right':null)},hatch)}${text(x+(p.x>state.L*.85?25:-25),y+49,p.name)}</g>`;}
      const bands=[];
      for(const p of state.loads.filter(p=>p.kind==='udl')){let lane=0;while(bands.some(b=>b.lane===lane&&p.x<b.end&&p.end>b.x))lane++;bands.push({...p,lane});const a=xOf(p.x),b=xOf(p.end),top=117-lane*24;svg+=`<g class="bw-handle" data-object="load" data-id="${esc(p.id)}" tabindex="0" role="button" aria-label="Editar carga ${esc(p.name)}"><rect class="bw-hit" x="${a-7}" y="${top-20}" width="${b-a+14}" height="${y-top+20}"/>${line(a,top,b,top,colors.red)}`;const count=Math.max(2,Math.floor((b-a)/30)+1);for(let i=0;i<count;i++)svg+=arrow(a+(b-a)*i/(count-1),p.direction===1?top:y-4,p.direction===1?y-4:top,colors.red,1.2);svg+=text((a+b)/2,top-10,`${p.name} = ${fmt(p.value/1000)} kN/m`,'class="bw-force-text"')+'</g>';}
      if(result.Wbar>1e-9)svg+=arrow(xOf(state.L/2),76,y-4,colors.purple)+text(xOf(state.L/2),65,`Peso próprio = ${force(result.Wbar)}`,'class="bw-weight-text"');
      const labels=[];
      for(const p of state.loads.filter(p=>p.kind!=='udl')){
        const x=xOf(p.x);let lane=0;while(labels.some(l=>l.lane===lane&&Math.abs(l.x-x)<155))lane++;labels.push({x,lane});const top=85-lane*22;
        svg+=`<g class="bw-handle ${selection.id===p.id?'is-selected':''}" data-object="load" data-id="${esc(p.id)}" tabindex="0" role="button" aria-label="Editar carga ${esc(p.name)}">`;
        if(p.kind==='moment'){svg+=`<circle class="bw-hit" cx="${x}" cy="${y+8}" r="35"/>`+momentArrow(x,y+8,25,p.direction===1,colors.blue)+text(clamp(x,85,915),y-33,`${p.name} = ${moment(p.value)}`,'class="bw-moment-text"');}
        else {const mass=p.kind==='mass',body=mass?28:0,P=mass?p.value*state.g:p.value,down=mass||p.direction===1;svg+=`<rect class="bw-hit" x="${x-25}" y="${top-20}" width="50" height="${y-top+20}"/>`;if(mass)svg+=`<rect x="${x-18}" y="${y-body}" width="36" height="${body}" fill="#647278" stroke="${colors.ink}"/>`;svg+=arrow(x,down?top:y-body-4,down?y-body-4:top,colors.red,2.4)+text(clamp(x,85,915),top-10,`${p.name} = ${mass?fmt(p.value)+' kg':force(P)}`,'class="bw-force-text"');}
        svg+='</g>';
      }
      if(showReactions&&result.valid)for(const p of result.reactions){const x=xOf(p.x),down=p.R<0;svg+=arrow(x,down?y+23:y+85,down?y+85:y+23,colors.green)+text(clamp(x,80,920),y+105,`R${p.name} = ${force(p.R)}`,'class="bw-reaction-text"');if(p.type==='fixed')svg+=momentArrow(x,y+8,36,p.M>=0,colors.green)+text(clamp(x,85,915),y+125,`M${p.name} = ${moment(p.M)}`,'class="bw-reaction-text"');}
      const positions=[...new Set([0,state.L,...state.supports.map(p=>p.x),...state.loads.flatMap(p=>p.kind==='udl'?[p.x,p.end]:[p.x])])].sort((a,b)=>a-b);
      for(let i=1;i<positions.length;i++){const a=xOf(positions[i-1]),b=xOf(positions[i]);svg+=line(a,345,b,345,colors.blue,.8)+line(a,341,a,349,colors.blue)+line(b,341,b,349,colors.blue);if(b-a>43)svg+=text((a+b)/2,336,fmt(positions[i]-positions[i-1])+' m');}
      $('.bw-drawing').innerHTML=svg;
      $('.bw-scene-status').className='bw-scene-status'+(!result.valid?' is-error':result.warning?' is-warning':'');
      $('.bw-scene-status').textContent=result.valid?(result.warning||''):result.error;$('.bw-scene-status').hidden=result.valid&&!result.warning;
    }
    const metrics=()=>[
      ['Cortante máximo',structural.d.Vmax,baselineStructural.d.Vmax,1/1000,'kN'],
      ['Momento máximo',structural.d.Mmax,baselineStructural.d.Mmax,1/1000,'kN·m'],
      ['Tensão de flexão',structural.sigma,baselineStructural.sigma,1/1e6,'MPa'],
      ['Deslocamento máximo',structural.deflection.max,baselineStructural.deflection.max,1000,'mm']
    ];
    const metricValue=(v,scale,unit)=>v===null||v===undefined?'—':fmt(v*scale)+' '+unit;
    function metricCards(){return metrics().map(([name,value,old,scale,unit])=>`<div class="bw-metric"><span>${name}</span><strong>${metricValue(value,scale,unit)}</strong>${compareEnabled?`<small>Ref. ${metricValue(old,scale,unit)}</small>`:''}</div>`).join('');}
    function graphSeries(s,r,z,kind){
      if(!r.valid)return [];
      if(kind==='deflection'){
        const d=z.deflection;
        if(d.xs&&d.ys)return [d.xs.map((x,i)=>({x,y:d.ys[i]*1000}))];
        if(d.values)return [d.values.map(p=>({x:p.x,y:(p.y??p.value)*1000}))];
        return [];
      }
      return z.d.segments.map(seg=>seg.values.map(p=>({x:p.x,y:(kind==='shear'?p.V:p.M)/1000})));
    }
    function graphSVG(kind){
      const current=graphSeries(state,result,structural,kind),old=compareEnabled?graphSeries(baseline,baselineResult,baselineStructural,kind):[];
      const all=[...current.flat(),...old.flat()],maxX=Math.max(state.L,compareEnabled?baseline.L:0),maxY=Math.max(.001,...all.map(p=>Math.abs(p.y)))*1.15;
      const x=p=>60+p/maxX*850,y=p=>158-p/maxY*111;
      let svg='';
      for(let i=-2;i<=2;i++){const yy=158-i*55.5;svg+=line(60,yy,910,yy,'#264359',.7,i?'stroke-dasharray="3 5"':'')+text(47,yy+4,fmt(i*maxY/2,2),'text-anchor="end"');}
      for(let i=0;i<=5;i++){const xx=60+i*170;svg+=line(xx,47,xx,269,'#1a3449',.6)+text(xx,295,fmt(maxX*i/5)+' m');}
      const draw=(series,color,isBaseline)=>series.map(values=>`<path class="${isBaseline?'bw-baseline-path':'bw-current-path'}" d="${values.map((p,i)=>(i?'L':'M')+x(p.x).toFixed(2)+','+y(p.y).toFixed(2)).join(' ')}" fill="none" stroke="${color}" stroke-width="${isBaseline?1.6:2.1}" ${isBaseline?'stroke-dasharray="7 5"':''}/>`).join('');
      const graphColor=kind==='shear'?colors.green:kind==='deflection'?colors.purple:colors.blue;
      const jumps=(s,r,z,color,isBaseline)=>kind==='deflection'||!r.valid?'':z.d.events.map(at=>{const left=engine.internalAt(s,r,at,'left'),right=engine.internalAt(s,r,at,'right'),a=(kind==='shear'?left.V:left.M)/1000,b=(kind==='shear'?right.V:right.M)/1000;return Math.abs(a-b)<1e-9?'':line(x(at),y(a),x(at),y(b),color,isBaseline?1.5:2,`class="${isBaseline?'bw-baseline-jump':'bw-current-jump'}" ${isBaseline?'stroke-dasharray="5 4"':''}`);}).join('');
      svg+=draw(old,'#8c9ba9',true)+(compareEnabled?jumps(baseline,baselineResult,baselineStructural,'#8c9ba9',true):'')+draw(current,graphColor,false)+jumps(state,result,structural,graphColor,false);
      if(!current.length)svg+=text(490,135,result.error||'Não há resultados disponíveis.','class="bw-plot-empty"');
      return `<article class="bw-chart"><h4>${graphNames[kind]} <span>${kind==='shear'?'kN':kind==='bending'?'kN·m':'mm'}</span></h4><svg viewBox="0 0 960 315" data-chart="${kind}" role="img" aria-label="${graphNames[kind]}: configuração atual${compareEnabled?' e referência':''}">${svg}<g class="bw-chart-probe" hidden></g></svg><div class="bw-chart-readout" data-readout="${kind}">Passe o cursor no gráfico para consultar uma seção.</div></article>`;
    }
    function renderGraphs(){
      $('.bw-graphs .bw-pane-heading p').hidden=!compareEnabled;
      for(const button of host.querySelectorAll('[data-plot]'))button.setAttribute('aria-pressed',String(button.dataset.plot==='all'?plots.length===3:plots.includes(button.dataset.plot)));
      $('.bw-chart-legend').innerHTML=`<span><i style="background:${plots.length===1?(plots[0]==='shear'?colors.green:plots[0]==='deflection'?colors.purple:colors.blue):'#b4cddd'}"></i>Atual · linha contínua</span>${compareEnabled?`<span class="is-baseline"><i></i>Referência</span>`:''}`;
      $('[data-probe-x]').value=Number(probeX.toFixed(3));$('[data-probe-x]').max=Math.max(state.L,compareEnabled?baseline.L:0);$('[data-probe-side]').value=probeSide;
      $('.bw-charts').innerHTML=plots.map(graphSVG).join('');renderProbe();
    }
    function delta(value,old,scale,unit){if(!Number.isFinite(value)||!Number.isFinite(old))return '—';const d=(value-old)*scale;return (d>0?'+':'')+fmt(d)+' '+unit+(Math.abs(old)>1e-12?' ('+(value>old?'+':'')+fmt((value-old)/Math.abs(old)*100,1)+'%)':'');}
    function renderResults(){
      $('.bw-results').innerHTML=`<div class="bw-pane-heading"><div><h3>Resultados da análise</h3><p>${result.valid?'Valores calculados para a configuração atual.':esc(result.error)}</p></div><span class="bw-state-tag ${result.valid?'':'is-error'}">${result.valid?(result.hyper?'Hiperestática':'Isostática'):'Modelo não resolvido'}</span></div><div class="bw-results-metrics">${metricCards()}</div><div class="bw-table-wrap"><table><thead><tr><th>Grandeza</th>${compareEnabled?`<th>Referência</th>`:''}<th>Atual</th>${compareEnabled?'<th>Variação</th>':''}</tr></thead><tbody>${[...metrics(),['Tensão de cisalhamento',structural.tau,baselineStructural.tau,1/1e6,'MPa'],['Fator de segurança à flexão',structural.fos,baselineStructural.fos,1,''],['Massa geométrica',structural.geomMass,baselineStructural.geomMass,1,'kg']].map(([name,v,old,scale,unit])=>`<tr><th>${name}</th>${compareEnabled?`<td>${metricValue(old,scale,unit)}</td>`:''}<td>${metricValue(v,scale,unit)}</td>${compareEnabled?`<td class="bw-delta">${delta(v,old,scale,unit)}</td>`:''}</tr>`).join('')}</tbody></table></div><h4>Reações nos apoios</h4><div class="bw-table-wrap"><table><thead><tr><th>Apoio</th><th>Posição</th>${compareEnabled?'<th>Força · referência</th>':''}<th>Força · atual</th>${compareEnabled?'<th>Momento · referência</th>':''}<th>Momento · atual</th></tr></thead><tbody>${result.reactions.map(p=>{const old=baselineResult.reactions.find(v=>v.id===p.id);return `<tr><th>${esc(p.name)} · ${supportNames[p.type]}</th><td>${fmt(p.x)} m</td>${compareEnabled?`<td>${old?force(old.R):'—'}</td>`:''}<td>${result.valid?force(p.R):'—'}</td>${compareEnabled?`<td>${old?moment(old.M):'—'}</td>`:''}<td>${result.valid?moment(p.M):'—'}</td></tr>`;}).join('')||'<tr><td colspan="6">Nenhum apoio configurado.</td></tr>'}</tbody></table></div><p class="bw-model-note">Força positiva para cima nas reações; momento positivo anti-horário. Fator de segurança calculado com a tensão de escoamento informada e a tensão máxima de flexão.</p>${result.warning?`<p class="bw-inline-warning">${esc(result.warning)}</p>`:''}`;
    }
    function renderCalculations(){
      const sec=structural.sec,mat=structural.mat;
      $('.bw-calculations').innerHTML=`<div class="bw-pane-heading"><div><h3>Memória de cálculo</h3><p>${esc(mat.name)} · unidades em N, m e Pa</p></div></div><div class="bw-calculation-grid"><section><h4>1. Seção transversal</h4><p class="bw-formula">${sec.shape==='i'?'A = 2b t_f + t_w (h − 2t_f)':'A = b h'}</p><p>A = ${fmt(sec.A,7)} m²</p><p class="bw-formula">${sec.shape==='i'?'I = [b h³ − (b − t_w)(h − 2t_f)³] / 12':'I = b h³ / 12'}</p><p>I = ${sec.I.toExponential(5)} m⁴</p><p class="bw-formula">W = I / (h / 2)</p><p>W = ${sec.S.toExponential(5)} m³</p></section><section><h4>2. Carregamento e equilíbrio</h4><p class="bw-formula">q_peso = m_viga g / L</p><p>q_peso = ${fmt(result.q)} N/m · peso total = ${force(result.Wbar)}</p><p class="bw-formula">Σ R = Σ P + ∫q(x) dx</p><p>Carregamento vertical total = ${force(result.total)}</p><p class="bw-formula">Σ [R x + M_apoio] = Σ [P x − M_aplicado] + ∫x q(x) dx</p><p>Momento requerido em x = 0: ${moment(result.demand)}</p><p>Resíduos: ΣF = ${fmt(result.forceError,8)} N · ΣM = ${fmt(result.momentError,8)} N·m</p></section><section><h4>3. Esforços internos</h4><p class="bw-formula">dV/dx = −q(x) · dM/dx = V(x)</p><p>Integração por trecho, preservando os saltos nas forças e nos momentos concentrados.</p><p>|V|max = ${metricValue(structural.d.Vmax,1/1000,'kN')} · x = ${fmt(structural.d.vmax?.x)} m</p><p>|M|max = ${metricValue(structural.d.Mmax,1/1000,'kN·m')} · x = ${fmt(structural.d.mmax?.x)} m</p></section><section><h4>4. Tensões e deformação</h4><p class="bw-formula">σ_max = |M|max / W</p><p>σ_max = ${metricValue(structural.sigma,1e-6,'MPa')}</p><p class="bw-formula">${sec.shape==='i'?'τ_max = |V|max Q / (I t_w)':'τ_max = 1,5 |V|max / A'}</p><p>τ_max = ${metricValue(structural.tau,1e-6,'MPa')} · FS = σ_escoamento / σ_max = ${fmt(structural.fos)}</p><p class="bw-formula">y″(x) = M(x) / (E I)</p><p>|y|max = ${metricValue(structural.deflection.max,1000,'mm')} · x = ${fmt(structural.deflection.x)} m</p></section></div><div class="bw-model-assumptions"><h4>Modelo utilizado</h4><p>Viga de Euler–Bernoulli, seção e material constantes, elasticidade linear e pequenos deslocamentos. E = ${fmt(mat.E/1e9)} GPa; densidade = ${fmt(mat.rho)} kg/m³. ${result.hyper?'As reações são obtidas pelo método da rigidez com interpolação de Hermite.':'As reações são obtidas pelas equações de equilíbrio estático.'} A deformação é integrada numericamente com as condições de contorno dos apoios.</p><p>Forças horizontais, recalques, rigidez variável e efeitos não lineares não estão incluídos. A massa geométrica é informativa até ser aplicada como massa da viga.</p></div>`;
    }
    function renderViews(){if(tab==='graphs')renderGraphs();if(tab==='results')renderResults();if(tab==='calculations')renderCalculations();}
    function render(){recompute();renderVersionbar();renderDrawing();renderSection3D();renderEditor();renderViews();renderVisibility();for(const pane of host.querySelectorAll('[data-pane]'))pane.hidden=pane.dataset.pane!==tab;}
    let pendingInput=null;
    function flushInput(){if(!pendingInput)return;clearTimeout(timer);const pending=pendingInput;pendingInput=null;applyField(pending.path,pending.value);}
    function applyField(path,value){
      const [group,key]=path.split('.'),[kind,id]=group.split(':');
      let parsed=['name','type','kind','shape','key','unit'].includes(key)?value:Number(value);
      if(typeof parsed==='number'&&!Number.isFinite(parsed)){notice('Informe um valor numérico válido.');return;}
      if(typeof parsed==='number'&&value.trim()===''){notice('Preencha o valor antes de atualizar o modelo.');return;}
      let patch={[key]:parsed},op,label;
      if(kind==='beam'){op={type:'change_beam',patch};label=key==='L'?`Comprimento alterado para ${fmt(parsed)} m`:'Propriedades da viga atualizadas';}
      if(kind==='section'){if(key!=='shape')patch[key]=parsed/1000;op={type:'change_section',patch};label='Seção transversal atualizada';}
      if(kind==='material'){if(key==='E')patch.E=parsed*1e9;if(key==='yield')patch.yield=parsed*1e6;if(key==='key'&&engine.materialLibrary[value]){const m=engine.materialLibrary[value];patch={key:value,E:m.E,yield:m.yield,rho:m.rho};}else patch.key='custom';op={type:'change_material',patch};label='Material atualizado';}
      if(kind==='support'){if(key==='x')patch.edge=parsed===0?'left':parsed===state.L?'right':null;op={type:'update_support',id,patch};label=`Apoio ${state.supports.find(p=>p.id===id)?.name||''} atualizado`;}
      if(kind==='load'){const p=state.loads.find(p=>p.id===id);if(!p)return;if(key==='value')patch.value=parsed*engine.unitScale(p);if(key==='x')patch.edge=parsed===0?'left':parsed===state.L?'right':null;if(key==='end')patch.endEdge=parsed===state.L?'right':null;if(key==='kind'){patch={kind:parsed,value:parsed==='mass'?10:1000,unit:parsed==='mass'?'kg':parsed==='moment'?'kNm':parsed==='udl'?'kNpm':'kN',direction:1};if(parsed==='udl'){patch.x=Math.min(p.x,state.L*.5);patch.end=state.L;patch.edge=patch.x===0?'left':null;patch.endEdge='right';}}op={type:'update_load',id,patch};label=`Carga ${p.name} atualizada`;}
      if(op)applyManual([op],label);
    }
    function onInput(event){const el=event.target;if(!el.matches('input[data-field]'))return;clearTimeout(timer);pendingInput={path:el.dataset.field,value:el.value};timer=setTimeout(flushInput,550);}
    function onChange(event){const el=event.target;if(el.matches('[data-field]')){clearTimeout(timer);pendingInput=null;applyField(el.dataset.field,el.value);}
      if(el.matches('[data-baseline]')){baselineId=el.value;render();notify({source:'view',label:'Referência de comparação alterada'});}
      if(el.matches('[data-compare]')){compareEnabled=el.checked;render();notify({source:'view'});}
      if(el.matches('[data-probe-x]')){probeX=clamp(Number(el.value)||0,0,Math.max(state.L,compareEnabled?baseline.L:0));renderProbe();notify({source:'view'});}
      if(el.matches('[data-probe-side]')){probeSide=el.value==='left'?'left':'right';renderProbe();notify({source:'view'});}
      if(el.matches('[data-reactions]')){showReactions=el.checked;renderDrawing();notify({source:'view'});}
    }
    async function onClick(event){const b=event.target.closest('button');if(!b||!host.contains(b))return;
      if(b.dataset.action==='options'){const menu=$('.bw-options');menu.hidden=!menu.hidden;b.setAttribute('aria-expanded',String(!menu.hidden));return;}
      if(b.dataset.edit){openEditor(b.dataset.edit,b.dataset.id||'');return;}
      if(b.dataset.action==='close-editor'){flushInput();$('.bw-inspector').close();return;}
      if(b.dataset.action==='section'){$('.bw-options').hidden=true;$('[data-action="options"]').setAttribute('aria-expanded','false');showSection();return;}
      if(b.dataset.action==='beam'){simulationFocus='beam';renderVisibility();notify({source:'view'});return;}
      if(b.dataset.action==='history'){$('.bw-options').hidden=true;$('[data-action="options"]').setAttribute('aria-expanded','false');$('.bw-history').hidden=!$('.bw-history').hidden;return;}
      if(b.dataset.restore){const v=versions.find(v=>v.id===b.dataset.restore);if(v)commit(v.state,`Restaurada a configuração ${v.id}`,'manual');return;}
      if(b.dataset.plot){plots=b.dataset.plot==='all'?Object.keys(graphNames):[b.dataset.plot];renderGraphs();notify({source:'view'});return;}
      if(b.dataset.select){openEditor(b.dataset.kind,b.dataset.select);return;}
      if(b.dataset.remove){applyManual([{type:'remove_'+b.dataset.kind,id:b.dataset.remove}],'Elemento removido');return;}
      if(b.dataset.action==='add-support'){let x=state.L/2;for(let i=0;i<9&&state.supports.some(p=>Math.abs(p.x-x)<1e-6);i++)x=state.L*(i+1)/10;applyManual([{type:'add_support',support:{name:String.fromCharCode(65+state.supports.length),type:'roller',x,edge:null}}],'Apoio adicionado');}
      if(b.dataset.action==='add-load')applyManual([{type:'add_load',load:{name:'P'+(state.loads.length+1),kind:'force',x:state.L/2,value:1000,direction:1,unit:'kN',edge:null}}],'Carga adicionada');
      if(b.dataset.action==='geometric-mass')applyManual([{type:'change_beam',patch:{mbar:structural.geomMass}}],'Massa geométrica aplicada como peso próprio');
      if(b.dataset.action==='record'&&result.valid&&options.onRecord){recording=true;renderVersionbar();try{const accepted=await options.onRecord({version:clone(versions.find(v=>v.id===currentId)),state:clone(state),result:clone(result),results:clone(structural),summary:summaryFor(state,result,structural)});if(accepted===false)notice('O resultado ainda não foi registrado na reunião.');else notice('Resultado enviado para os registros da reunião.');}catch(error){notice(error.message||'Não foi possível registrar o resultado.');}finally{recording=false;if(!destroyed)renderVersionbar();}}
    }
    function svgPoint(svg,event){const point=svg.createSVGPoint();point.x=event.clientX;point.y=event.clientY;const matrix=svg.getScreenCTM();return matrix?point.matrixTransform(matrix.inverse()):point;}
    function pointerX(event){const point=svgPoint($('.bw-drawing'),event);return clamp((point.x-90)/820*state.L,0,state.L);}
    function onPointerDown(event){const object=event.target.closest('[data-object]');if(!object||event.button!==0)return;flushInput();selection={kind:object.dataset.object,id:object.dataset.id||''};renderEditor();if(selection.kind==='beam'){openEditor('beam');return;}const source=(selection.kind==='support'?state.supports:state.loads).find(p=>p.id===selection.id);if(!source)return;drag={...selection,startX:pointerX(event),original:clone(state),source:clone(source),pointer:event.pointerId,moved:false};$('.bw-drawing').setPointerCapture(event.pointerId);event.preventDefault();}
    function onPointerMove(event){if(drag){const x=pointerX(event);if(Math.abs(x-drag.startX)>state.L*.004)drag.moved=true;const next=clone(drag.original),p=(drag.kind==='support'?next.supports:next.loads).find(p=>p.id===drag.id);if(p.kind==='udl'){const length=p.end-p.x;p.x=clamp(drag.source.x+x-drag.startX,0,state.L-length);p.end=p.x+length;p.endEdge=p.end===state.L?'right':null;}else p.x=x;p.x=Math.round(p.x*100)/100;p.edge=p.x===0?'left':p.x===state.L?'right':null;state=next;recompute();renderDrawing();return;}
      const chart=event.target.closest('[data-chart]');if(!chart)return;const point=svgPoint(chart,event);probeX=clamp((point.x-60)/850*Math.max(state.L,compareEnabled?baseline.L:0),0,Math.max(state.L,compareEnabled?baseline.L:0));
      $('[data-probe-x]').value=Number(probeX.toFixed(3));renderProbe();
    }
    function renderProbe(){
      const x=probeX;
      const at=(s,r,z,kind)=>{if(!r.valid||x>s.L)return '—';if(kind!=='deflection'){const values=engine.internalAt(s,r,x,probeSide);return fmt((kind==='shear'?values.V:values.M)/1000)+' '+(kind==='shear'?'kN':'kN·m');}const series=graphSeries(s,r,z,kind)[0]||[],p=series.reduce((best,v)=>!best||Math.abs(v.x-x)<Math.abs(best.x-x)?v:best,null);return p?fmt(p.y)+' mm':'—';};
      for(const chart of host.querySelectorAll('[data-chart]')){const kind=chart.dataset.chart,xx=60+x/Math.max(state.L,compareEnabled?baseline.L:0)*850,g=chart.querySelector('.bw-chart-probe');g.removeAttribute('hidden');g.innerHTML=line(xx,47,xx,269,'#aac6da',1,'stroke-dasharray="2 4"');$('[data-readout="'+kind+'"]').textContent=`x = ${fmt(x)} m · ${probeSide==='left'?'À esquerda':'À direita'} · Atual: ${at(state,result,structural,kind)}${compareEnabled?' · Referência: '+at(baseline,baselineResult,baselineStructural,kind):''}`;}
    }
    function onPointerUp(event){if(!drag)return;const completed=drag;drag=null;const changed=clone(state);state=completed.original;try{$('.bw-drawing').releasePointerCapture(event.pointerId);}catch(_){}if(completed.moved)commit(changed,`${completed.kind==='support'?'Apoio':'Carga'} ${completed.source.name} reposicionado`,'manual');render();if(!completed.moved)openEditor(completed.kind,completed.id);}
    function onKeyDown(event){const object=event.target.closest('[data-object]');if(object&&['Enter',' '].includes(event.key)){event.preventDefault();openEditor(object.dataset.object,object.dataset.id||'');}if(event.key==='Escape'){$('.bw-options').hidden=true;$('[data-action="options"]').setAttribute('aria-expanded','false');}}

    host.addEventListener('input',onInput);host.addEventListener('change',onChange);host.addEventListener('click',onClick);host.addEventListener('pointerdown',onPointerDown);host.addEventListener('pointermove',onPointerMove);host.addEventListener('pointerup',onPointerUp);host.addEventListener('pointercancel',onPointerUp);host.addEventListener('keydown',onKeyDown);
    render();
    return {snapshot,flushPending:flushInput,applyOperations:executeOperations,showTab,showSection,openEditor,setState:(next,meta={})=>{flushInput();return commit(next,meta.label||'Modelo atualizado',meta.source||'manual',meta);},compare:(id)=>{if(versions.some(v=>v.id===id))baselineId=id;compareEnabled=true;showTab('graphs');render();},destroy:()=>{flushInput();destroyed=true;if($('.bw-inspector').open)$('.bw-inspector').close();clearTimeout(timer);for(const [event,fn]of [['input',onInput],['change',onChange],['click',onClick],['pointerdown',onPointerDown],['pointermove',onPointerMove],['pointerup',onPointerUp],['pointercancel',onPointerUp],['keydown',onKeyDown]])host.removeEventListener(event,fn);host.innerHTML='';host.classList.remove('beam-workspace');}};
  }
  root.NorteBeamWorkspace={mount,summaryFor};
})(typeof window!=='undefined'?window:globalThis);
