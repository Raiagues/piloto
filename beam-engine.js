/* Pure beam calculations extracted from exemplos-testes/testes_viga/viga_editor_calculos_secao.html.
 * Core solver, section/stress formulas and numerical deflection integration are
 * preserved. Additional deflection arrays expose the same samples for plotting.
 * SI internally: m, kg, N, N*m, N/m, Pa. `unit` is display metadata only.
 */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.NorteBeamEngine=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const supportNames={pin:'Articulado',roller:'Rolete',fixed:'Engaste'};
const clone=value=>Array.isArray(value)?value.map(clone):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,clone(item)])):value;
const clamp=(value,low,high)=>Math.max(low,Math.min(high,value));
const startCase = {L:6,mbar:0,g:9.81,supports:[{id:'s1',name:'A',x:0,type:'fixed',edge:'left'}],loads:[{id:'p1',name:'P1',x:6,kind:'force',value:10000,direction:1,unit:'kN',edge:'right'}]};
const materialLibrary = {
  steel:{name:'Aço estrutural',E:200e9,yield:250e6,rho:7850,color:'#78828b'},
  aluminum:{name:'Alumínio 6061-T6',E:68.9e9,yield:276e6,rho:2700,color:'#b3bec6'},
  stainless:{name:'Aço inox 304',E:193e9,yield:215e6,rho:8000,color:'#98a4ab'},
  custom:{name:'Personalizado',E:200e9,yield:250e6,rho:7850,color:'#84909a'}
};
const defaultSection={shape:'rect',b:.12,h:.24,tw:.012,tf:.018};
const defaultMaterial={key:'steel',E:200e9,yield:250e6,rho:7850};

function ensureBeamModel(s) {
  if (!s.section) s.section=clone(defaultSection);
  if (!s.material) s.material=clone(defaultMaterial);
  if (!['rect','i'].includes(s.section.shape)) s.section.shape='rect';
  s.section.b=clamp(Number(s.section.b)||defaultSection.b,.005,2);
  s.section.h=clamp(Number(s.section.h)||defaultSection.h,.005,3);
  s.section.tw=clamp(Number(s.section.tw)||defaultSection.tw,.001,Math.max(.001,s.section.b*.95));
  s.section.tf=clamp(Number(s.section.tf)||defaultSection.tf,.001,Math.max(.001,s.section.h*.45));
  if (!materialLibrary[s.material.key]) s.material.key='custom';
  s.material.E=clamp(Number(s.material.E)||defaultMaterial.E,1e6,1e12);
  s.material.yield=clamp(Number(s.material.yield)||defaultMaterial.yield,1e5,5e9);
  s.material.rho=clamp(Number(s.material.rho)||defaultMaterial.rho,1,30000);
}

function materialInfo(s) {
  ensureBeamModel(s);
  return {...s.material,name:materialLibrary[s.material.key]?.name||'Personalizado',color:materialLibrary[s.material.key]?.color||'#84909a'};
}

function sectionProperties(s) {
  ensureBeamModel(s);
  const sec=s.section,b=sec.b,h=sec.h,c=h/2;
  if (sec.shape==='i') {
    const tf=clamp(sec.tf,.001,h*.45),tw=clamp(sec.tw,.001,b*.95),hw=h-2*tf;
    const A=2*b*tf+tw*hw;
    const I=(b*h**3-(b-tw)*hw**3)/12;
    const S=I/c;
    const Q=b*tf*(h/2-tf/2)+(tw*hw/2)*(hw/4);
    return {shape:'i',b,h,tf,tw,hw,A,I,S,c,Q,shearThickness:tw,valid:A>0&&I>0&&hw>0};
  }
  const A=b*h,I=b*h**3/12,S=I/c;
  return {shape:'rect',b,h,tf:0,tw:b,hw:h,A,I,S,c,Q:null,shearThickness:b,valid:A>0&&I>0};
}

function interpSeries(xs,ys,x) {
  if (x<=xs[0]) return ys[0];
  if (x>=xs[xs.length-1]) return ys[ys.length-1];
  let lo=0,hi=xs.length-1;
  while (hi-lo>1) {const mid=(lo+hi)>>1;if(xs[mid]<=x)lo=mid;else hi=mid;}
  const t=(x-xs[lo])/(xs[hi]-xs[lo]);
  return ys[lo]*(1-t)+ys[hi]*t;
}

function deflectionData(s,r,sec,mat) {
  if (!r.valid||!sec.valid||!(mat.E>0&&sec.I>0)) return {max:null,x:null,value:null,xs:[],ys:[]};
  const base=Array.from({length:601},(_,i)=>s.L*i/600);
  const xs=[...base,...beamEvents(s)].sort((a,b)=>a-b).filter((v,i,a)=>i===0||Math.abs(v-a[i-1])>1e-10*s.L);
  const kappa=xs.map(x=>internalAt(s,r,x,'right').M/(mat.E*sec.I));
  const theta0=Array(xs.length).fill(0),y0=Array(xs.length).fill(0);
  for (let i=1;i<xs.length;i++) {
    const dx=xs[i]-xs[i-1];
    theta0[i]=theta0[i-1]+.5*(kappa[i-1]+kappa[i])*dx;
    y0[i]=y0[i-1]+.5*(theta0[i-1]+theta0[i])*dx;
  }
  let C1=0,C2=0;
  const fixed=[...s.supports].filter(p=>p.type==='fixed').sort((a,b)=>a.x-b.x);
  if (fixed.length) {
    const x=fixed[0].x,th=interpSeries(xs,theta0,x),yy=interpSeries(xs,y0,x);
    C1=-th;C2=-yy-C1*x;
  } else {
    const supports=[...s.supports].sort((a,b)=>a.x-b.x);
    if (supports.length<2||Math.abs(supports[1].x-supports[0].x)<1e-12) return {max:null,x:null,value:null,xs:[],ys:[]};
    const xa=supports[0].x,xb=supports[1].x;
    const ya=interpSeries(xs,y0,xa),yb=interpSeries(xs,y0,xb);
    C1=-(yb-ya)/(xb-xa);C2=-ya-C1*xa;
  }
  let best={x:xs[0],value:y0[0]+C1*xs[0]+C2};
  for (let i=1;i<xs.length;i++) {
    const value=y0[i]+C1*xs[i]+C2;
    if (Math.abs(value)>Math.abs(best.value)) best={x:xs[i],value};
  }
  return {max:Math.abs(best.value),x:best.x,value:best.value,xs,ys:xs.map((x,i)=>y0[i]+C1*x+C2)};
}

function structuralResults(s,r) {
  const sec=sectionProperties(s),mat=materialInfo(s);
  const d=diagramData(s,r);
  if (!r.valid||d.Mmax===null||!sec.valid) return {sec,mat,d,sigma:null,tau:null,fos:null,deflection:{max:null,x:null,value:null,xs:[],ys:[]},geomMass:sec.A*s.L*mat.rho};
  const sigma=sec.S>0?d.Mmax/sec.S:null;
  const tau=sec.shape==='i'&&sec.I>0&&sec.shearThickness>0?d.Vmax*sec.Q/(sec.I*sec.shearThickness):sec.A>0?1.5*d.Vmax/sec.A:null;
  const fos=sigma>0?mat.yield/sigma:Infinity;
  const deflection=deflectionData(s,r,sec,mat);
  return {sec,mat,d,sigma,tau,fos,deflection,geomMass:sec.A*s.L*mat.rho};
}

function solveLinear(matrix,vector) {
  const n=vector.length;
  if (!n) return [];
  const scale=matrix.map((row,i)=>1/Math.sqrt(Math.max(Math.abs(row[i]),1e-30)));
  const a=matrix.map((row,i)=>row.map((v,j)=>v*scale[i]*scale[j]).concat(vector[i]*scale[i]));
  for (let k=0;k<n;k++) {
    let pivot=k;
    for (let i=k+1;i<n;i++) if (Math.abs(a[i][k])>Math.abs(a[pivot][k])) pivot=i;
    if (Math.abs(a[pivot][k])<1e-12) throw new Error('Não foi possível resolver esta configuração com precisão. Revise os apoios.');
    [a[k],a[pivot]]=[a[pivot],a[k]];
    for (let i=k+1;i<n;i++) {
      const ratio=a[i][k]/a[k][k];
      for (let j=k+1;j<=n;j++) a[i][j]-=ratio*a[k][j];
      a[i][k]=0;
    }
  }
  const x=Array(n).fill(0);
  for (let i=n-1;i>=0;i--) {
    let v=a[i][n];
    for (let j=i+1;j<n;j++) v-=a[i][j]*x[j];
    x[i]=v/a[i][i];
  }
  return x.map((v,i)=>v*scale[i]);
}

function loadForce(p,s) { return p.kind==='mass' ? p.value*s.g : p.kind==='force' ? p.value*p.direction : 0; }

function loadMoment(p) { return p.kind==='moment' ? p.value*p.direction : 0; }

function loadIntensity(p) { return p.kind==='udl' ? p.value*p.direction : 0; }

function calculate(s) {
  const Wbar=s.mbar*s.g;
  const forces=s.loads.filter(p=>p.kind!=='udl').map(p=>({id:p.id,x:p.x,P:loadForce(p,s),M:loadMoment(p)}));
  const distributed=s.loads.filter(p=>p.kind==='udl').map(p=>({id:p.id,a:p.x,b:p.end,q:loadIntensity(p)}));
  const total=Wbar+forces.reduce((sum,p)=>sum+p.P,0)+distributed.reduce((sum,p)=>sum+p.q*(p.b-p.a),0);
  const demand=Wbar*s.L/2+forces.reduce((sum,p)=>sum+p.P*p.x-p.M,0)+distributed.reduce((sum,p)=>sum+p.q*(p.b-p.a)*(p.a+p.b)/2,0);
  const dofs=s.supports.reduce((sum,p)=>sum+(p.type==='fixed'?2:1),0);
  const r={valid:false,error:'',warning:'',hyper:dofs>2,Wbar,xbar:s.L/2,forces,distributed,total,demand,q:Wbar/s.L,reactions:[],forceError:null,momentError:null};
  if (![s.L,s.mbar,s.g].every(Number.isFinite)||s.L<=0||s.mbar<0||s.g<=0) {r.error='Revise os valores da viga.';return r;}
  const invalidLoad=s.loads.some(p=>![p.x,p.value,p.direction].every(Number.isFinite)||p.x<0||p.x>s.L||p.value<0||!['mass','force','moment','udl'].includes(p.kind)||![-1,1].includes(p.direction));
  if (invalidLoad) {r.error='Revise os valores das cargas.';return r;}
  if (distributed.some(p=>!Number.isFinite(p.b)||p.b<=p.a||p.b>s.L)) {r.error='O fim da carga distribuída deve ficar depois do início, dentro da viga.';return r;}
  if (!s.supports.length) {r.error='Sem apoios. A estrutura está livre.';return r;}
  if (s.supports.some(p=>!Number.isFinite(p.x)||p.x<0||p.x>s.L||!supportNames[p.type])) {r.error='Há um apoio fora da viga ou com tipo inválido.';return r;}
  if (new Set(s.supports.map(p=>p.id)).size!==s.supports.length) {r.error='Há identificadores de apoio repetidos.';return r;}
  if (new Set(s.loads.map(p=>p.id)).size!==s.loads.length) {r.error='Há identificadores de carga repetidos.';return r;}
  if (s.supports.every(p=>p.type==='roller')) {r.error='Falta uma restrição horizontal. Use um articulado ou um engaste.';return r;}
  if (!s.supports.some(p=>p.type==='fixed')&&s.supports.length<2) {r.error='A viga pode girar. Falta um apoio ou um engaste.';return r;}
  const tol=1e-10*s.L;
  for (let i=0;i<s.supports.length;i++) for (let j=i+1;j<s.supports.length;j++) {
    const a=s.supports[i],b=s.supports[j];
    if (Math.abs(a.x-b.x)<=tol) {r.error='Apoios '+a.name+' e '+b.name+' na mesma posição. Separe ou remova um deles.';return r;}
  }
  try {
    if (dofs===2) {
      if (s.supports.length===1) {
        const p=s.supports[0];
        r.reactions=[{...p,R:total,M:demand-total*p.x}];
      } else {
        const a=s.supports[0],b=s.supports[1];
        const rb=(demand-total*a.x)/(b.x-a.x);
        r.reactions=[{...a,R:total-rb,M:0},{...b,R:rb,M:0}];
      }
    } else r.reactions=stiffnessReactions(s,r);
  } catch(error) {r.error=error.message;return r;}
  r.forceError=r.reactions.reduce((sum,p)=>sum+p.R,0)-total;
  r.momentError=r.reactions.reduce((sum,p)=>sum+p.R*p.x+p.M,0)-demand;
  const absQ=distributed.reduce((sum,p)=>sum+Math.abs(p.q)*(p.b-p.a),0);
  const scaleF=Math.max(1,Wbar+forces.reduce((sum,p)=>sum+Math.abs(p.P),0)+absQ);
  const scaleM=Math.max(1,scaleF*s.L+forces.reduce((sum,p)=>sum+Math.abs(p.M),0));
  const invalid=r.reactions.some(p=>!Number.isFinite(p.R)||!Number.isFinite(p.M));
  if (invalid||Math.abs(r.forceError)>1e-7*scaleF||Math.abs(r.momentError)>1e-7*scaleM) {
    r.error='Equilíbrio não confirmado numericamente. Revise esta configuração.';
    r.reactions=[];return r;
  }
  r.valid=true;
  const lift=r.reactions.filter(p=>p.type==='roller'&&p.R<-1e-8*scaleF);
  if (lift.length) r.warning='O rolete '+lift.map(p=>p.name).join(', ')+' exigiria retenção. Resultados do vínculo bilateral ideal.';
  return r;
}

function shapePrimitive(z,h) {
  return [z-z**3+z**4/2,h*(z*z/2-2*z**3/3+z**4/4),z**3-z**4/2,h*(-(z**3)/3+z**4/4)];
}

function stiffnessReactions(s,r) {
  const raw=[0,1,...s.supports.map(p=>p.x/s.L)].sort((a,b)=>a-b);
  const nodes=raw.filter((v,i)=>i===0||v-raw[i-1]>1e-10);
  const n=2*nodes.length;
  const K=Array.from({length:n},()=>Array(n).fill(0));
  const F=Array(n).fill(0);
  const ranges=[{a:0,b:s.L,q:r.q},...r.distributed];
  for (let e=0;e<nodes.length-1;e++) {
    const h=nodes[e+1]-nodes[e];
    const k=[[12,6*h,-12,6*h],[6*h,4*h*h,-6*h,2*h*h],[-12,-6*h,12,-6*h],[6*h,2*h*h,-6*h,4*h*h]];
    for (let i=0;i<4;i++) for (let j=0;j<4;j++) K[2*e+i][2*e+j]+=k[i][j]/h**3;
    for (const p of ranges) {
      const a=Math.max(nodes[e],p.a/s.L),b=Math.min(nodes[e+1],p.b/s.L);
      if (b<=a||p.q===0) continue;
      const left=shapePrimitive((a-nodes[e])/h,h);
      const right=shapePrimitive((b-nodes[e])/h,h);
      for (let i=0;i<4;i++) F[2*e+i]-=p.q*s.L*h*(right[i]-left[i]);
    }
  }
  for (const p of r.forces) {
    const t=p.x/s.L;
    const at=nodes.findIndex(x=>Math.abs(x-t)<=1e-10);
    if (at>=0) {F[2*at]-=p.P;F[2*at+1]+=p.M/s.L;continue;}
    const e=nodes.findIndex((x,i)=>i<nodes.length-1&&t>x&&t<nodes[i+1]);
    if (e<0) throw new Error('Não foi possível localizar uma carga na viga.');
    const h=nodes[e+1]-nodes[e],z=(t-nodes[e])/h;
    const N=[1-3*z*z+2*z**3,h*(z-2*z*z+z**3),3*z*z-2*z**3,h*(-z*z+z**3)];
    const D=[(-6*z+6*z*z)/h,1-4*z+3*z*z,(6*z-6*z*z)/h,-2*z+3*z*z];
    for (let i=0;i<4;i++) F[2*e+i]+=-p.P*N[i]+p.M/s.L*D[i];
  }
  const restrained=new Set();
  for (const p of s.supports) {
    const i=nodes.findIndex(x=>Math.abs(x-p.x/s.L)<=1e-10);
    if (i<0) throw new Error('Não foi possível localizar um apoio.');
    restrained.add(2*i);
    if (p.type==='fixed') restrained.add(2*i+1);
  }
  const free=Array.from({length:n},(_,i)=>i).filter(i=>!restrained.has(i));
  const A=free.map(i=>free.map(j=>K[i][j]));
  const b=free.map(i=>F[i]);
  const solved=solveLinear(A,b),u=Array(n).fill(0);
  for (let i=0;i<free.length;i++) u[free[i]]=solved[i];
  const residual=K.map((row,i)=>row.reduce((sum,k,j)=>sum+k*u[j],0)-F[i]);
  return s.supports.map(p=>{
    const i=nodes.findIndex(x=>Math.abs(x-p.x/s.L)<=1e-10);
    return {...p,R:residual[2*i],M:p.type==='fixed'?residual[2*i+1]*s.L:0};
  });
}

function rangeAt(p,x) {
  const ell=clamp(x-p.a,0,p.b-p.a);
  return {ell,V:-p.q*ell,M:-p.q*ell*(x-p.a-ell/2)};
}

function intensityAt(r,x) {
  return r.q+r.distributed.reduce((sum,p)=>sum+(x>p.a&&x<p.b?p.q:0),0);
}

function internalAt(s,r,x,side='right') {
  if (!r.valid) return {V:null,M:null};
  const t=clamp(x,0,s.L),eps=1e-10*s.L;
  const include=a=>side==='left'?a<t-eps:a<=t+eps;
  let V=-r.q*t,M=-r.q*t*t/2;
  for (const p of r.distributed) {const d=rangeAt(p,t);V+=d.V;M+=d.M;}
  for (const p of r.reactions) if (include(p.x)) {V+=p.R;M+=p.R*(t-p.x)-p.M;}
  for (const p of r.forces) if (include(p.x)) {V-=p.P;M-=p.P*(t-p.x)+p.M;}
  const scaleF=Math.max(1,Math.abs(r.total)),scaleM=Math.max(1,Math.abs(r.demand),scaleF*s.L);
  if (Math.abs(V)<1e-11*scaleF) V=0;
  if (Math.abs(M)<1e-11*scaleM) M=0;
  return {V,M};
}

function beamEvents(s) {
  const xs=[0,s.L,...s.supports.map(p=>p.x),...s.loads.flatMap(p=>p.kind==='udl'?[p.x,p.end]:[p.x])].sort((a,b)=>a-b);
  return xs.filter((v,i)=>i===0||v-xs[i-1]>1e-10*s.L);
}

function diagramData(s,r) {
  const events=beamEvents(s),segments=[],points=[];
  if (!r.valid) return {events,segments,points,Vmax:null,Mmax:null};
  for (let i=0;i<events.length;i++) {
    const x=events[i],left=internalAt(s,r,x,'left'),right=internalAt(s,r,x,'right');
    points.push({x,side:'left',...left},{x,side:'right',...right});
    if (i===events.length-1) continue;
    const b=events[i+1],values=[],q=intensityAt(r,(x+b)/2);
    for (let j=0;j<=40;j++) {
      const at=x+(b-x)*j/40;
      values.push({x:at,...internalAt(s,r,at,j===40?'left':'right')});
    }
    if (Math.abs(q)>1e-12) {
      const root=x+right.V/q;
      if (root>x+1e-10*s.L&&root<b-1e-10*s.L) points.push({x:root,side:'right',...internalAt(s,r,root)});
    }
    segments.push({a:x,b,q,values});
  }
  const vmax=points.reduce((best,p)=>Math.abs(p.V)>Math.abs(best.V)?p:best,points[0]);
  const mmax=points.reduce((best,p)=>Math.abs(p.M)>Math.abs(best.M)?p:best,points[0]);
  return {events,segments,points,Vmax:Math.abs(vmax.V),Mmax:Math.abs(mmax.M),vmax,mmax};
}

const units={mass:['kg'],force:['N','kN'],moment:['Nm','kNm'],udl:['Npm','kNpm']};
const defaultUnit={mass:'kg',force:'kN',moment:'kNm',udl:'kNpm'};
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value);
function positionEdge(x,L){return Math.abs(x)<1e-9?'left':Math.abs(x-L)<1e-9?'right':null;}
function normalize(input=startCase){
  if(!plain(input))throw Error('O modelo da viga deve ser um objeto.');
  const state=clone(input);
  for(const [key,value] of Object.entries({L:6,mbar:0,g:9.81}))if(!own(state,key))state[key]=value;
  for(const key of ['supports','loads']){if(!own(state,key))state[key]=[];if(!Array.isArray(state[key])||state[key].some(item=>!plain(item)))throw Error('A lista '+key+' é inválida.');}
  if(state.section!=null&&!plain(state.section)||state.material!=null&&!plain(state.material))throw Error('Seção ou material inválido.');
  for(const [index,support] of state.supports.entries()){
    if(!own(support,'id'))support.id='s'+(index+1);
    if(!own(support,'name'))support.name=support.id;
    if(!own(support,'edge'))support.edge=positionEdge(support.x,state.L);
  }
  for(const [index,load] of state.loads.entries()){
    if(!own(load,'id'))load.id='p'+(index+1);
    if(!own(load,'name'))load.name=load.id;
    if(!own(load,'direction'))load.direction=load.kind==='moment'?-1:1;
    if(!own(load,'unit'))load.unit=defaultUnit[load.kind];
    if(!own(load,'edge'))load.edge=positionEdge(load.x,state.L);
    if(load.kind==='udl'&&!own(load,'endEdge'))load.endEdge=positionEdge(load.end,state.L);
  }
  ensureBeamModel(state);return state;
}
function defaultState(){return normalize(startCase);}
function inputErrors(s,{editorLimits=false}={}){
  const errors=[],add=(field,message)=>errors.push({field,message});
  if(!Number.isFinite(s.L)||s.L<=0)add('L','Informe um comprimento positivo em metros.');
  if(!Number.isFinite(s.mbar)||s.mbar<0)add('mbar','A massa total da viga deve ser não negativa, em kg.');
  if(!Number.isFinite(s.g)||s.g<=0)add('g','Informe uma aceleração da gravidade positiva.');
  if(editorLimits){if(s.L<.5||s.L>20)add('L','O editor admite comprimentos entre 0,5 e 20 m.');if(s.mbar>10000)add('mbar','O editor admite massa própria de até 10.000 kg.');if(s.g<.1||s.g>30)add('g','A gravidade deve ficar entre 0,1 e 30 m/s².');if(s.supports.length>8)add('supports','O editor admite até oito apoios.');if(s.loads.length>10)add('loads','O editor admite até dez cargas.');}
  for(const [kind,items] of [['supports',s.supports],['loads',s.loads]]){
    const ids=new Set();
    for(const [index,item] of items.entries()){
      const field=kind+'.'+index;
      if(typeof item.id!=='string'||!item.id.trim()||ids.has(item.id))add(field+'.id','Use identificadores únicos e não vazios.');ids.add(item.id);
      if(typeof item.name!=='string'||!item.name.trim())add(field+'.name','Informe um nome para o elemento.');
      if(!Number.isFinite(item.x)||item.x<0||item.x>s.L)add(field+'.x','A posição deve estar dentro da viga.');
      if(![null,undefined,'left','right'].includes(item.edge))add(field+'.edge','Extremidade inválida.');
      if(kind==='supports'){
        if(!own(supportNames,item.type))add(field+'.type','Use engaste, articulado ou rolete.');
        if(items.slice(0,index).some(other=>Math.abs(other.x-item.x)<=1e-10*s.L))add(field+'.x','Dois apoios não podem ocupar a mesma posição.');
      }else{
        if(!own(units,item.kind))add(field+'.kind','Tipo de carga não suportado.');
        if(!units[item.kind]?.includes(item.unit))add(field+'.unit','A unidade não corresponde ao tipo de carga.');
        if(!Number.isFinite(item.value)||item.value<0)add(field+'.value','A grandeza da carga deve ser não negativa, em unidades SI.');
        if(editorLimits&&item.value>(item.kind==='mass'?10000:1e7))add(field+'.value','A carga excede o limite do editor original.');
        if(![-1,1].includes(item.direction))add(field+'.direction','Use direção 1 ou -1.');
        if(item.kind==='udl'){
          if(!Number.isFinite(item.end)||item.end<=item.x||item.end>s.L)add(field+'.end','O fim da carga distribuída deve ficar depois do início e dentro da viga.');
          if(![null,undefined,'left','right'].includes(item.endEdge))add(field+'.endEdge','Extremidade final inválida.');
        }
      }
    }
  }
  return errors;
}
function validate(input){
  let state;try{state=normalize(input);}catch(error){return {valid:false,error:error.message,errors:[{field:'state',message:error.message}],warning:'',state:null};}
  const errors=inputErrors(state);if(errors.length)return {valid:false,error:errors[0].message,errors,warning:'',state};
  const result=calculate(state);if(!result.valid)errors.push({field:'supports',message:result.error});
  return {valid:result.valid,error:result.error,errors,warning:result.warning,state};
}
function safeCalculate(input){
  const state=normalize(input),errors=inputErrors(state),result=calculate(state);
  if(errors.length){result.valid=false;result.error=errors[0].message;result.reactions=[];}
  return result;
}
function unitScale(loadOrUnit){return ['kN','kNm','kNpm'].includes(typeof loadOrUnit==='string'?loadOrUnit:loadOrUnit?.unit)?1000:1;}
function deflection(input,result,section,material){const state=normalize(input);return deflectionData(state,result||safeCalculate(state),section||sectionProperties(state),material||materialInfo(state));}
function structural(input,result){const state=normalize(input);return structuralResults(state,result||safeCalculate(state));}
function snapshot(input){
  const state=normalize(input),calculation=safeCalculate(state),results=structuralResults(state,calculation);
  const jsonSafe=value=>Array.isArray(value)?value.map(jsonSafe):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,jsonSafe(item)])):typeof value==='number'&&!Number.isFinite(value)?null:value;
  return jsonSafe({schemaVersion:1,state,calculation,structural:{...results,fosUnbounded:results.fos===Infinity}});
}

const allowedPatches={change_beam:['L','mbar','g'],change_section:['shape','b','h','tw','tf'],change_material:['key','E','yield','rho'],update_load:['name','kind','x','end','value','direction','unit','edge','endEdge'],update_support:['name','x','type','edge','mount']};
const viewOperations=new Set(['open_simulation','show_graphs','show_results','show_calculations','compare']);
function assertPatch(operation,keys){if(!plain(operation.patch)||Object.keys(operation.patch).some(key=>!keys.includes(key)))throw Error('Campos inválidos para '+operation.type+'.');}
function finitePatch(patch){for(const [key,value] of Object.entries(patch))if(['L','mbar','g','b','h','tw','tf','E','yield','rho','x','end','value','direction'].includes(key)&&!Number.isFinite(value))throw Error('Informe um número finito para '+key+'.');}
function validateSectionMaterial(state){
  const ranges={b:[.005,2],h:[.005,3],tw:[.001,state.section.b*.95],tf:[.001,state.section.h*.45]};
  if(!['rect','i'].includes(state.section.shape))throw Error('Seção não suportada: use rect ou i.');
  for(const [key,[min,max]] of Object.entries(ranges))if(!Number.isFinite(state.section[key])||state.section[key]<min||state.section[key]>max)throw Error('A dimensão '+key+' deve ficar entre '+min+' e '+max+' m.');
  if(!own(materialLibrary,state.material.key))throw Error('Material desconhecido.');
  for(const [key,[min,max]] of Object.entries({E:[1e6,1e12],yield:[1e5,5e9],rho:[1,30000]}))if(!Number.isFinite(state.material[key])||state.material[key]<min||state.material[key]>max)throw Error('Propriedade '+key+' fora dos limites do editor.');
}
function applyOperations(input,operations){
  if(!Array.isArray(operations))throw Error('As alterações devem ser uma lista.');
  const original=normalize(input),state=clone(original),applied=[];
  const newId=(prefix,items)=>{let index=1;const ids=new Set(items.map(item=>item.id));while(ids.has(prefix+index))index++;return prefix+index;};
  for(const operation of operations){
    if(!plain(operation)||typeof operation.type!=='string')throw Error('Alteração inválida.');
    const op=clone(operation),type=op.type;
    if(viewOperations.has(type)){applied.push(op);continue;}
    if(allowedPatches[type]){assertPatch(op,allowedPatches[type]);finitePatch(op.patch);}
    if(type==='change_beam'){
      Object.assign(state,op.patch);
      if(own(op.patch,'L'))for(const item of [...state.supports,...state.loads]){
        if(item.edge==='right')item.x=state.L;else if(item.edge==='left')item.x=0;
        if(item.kind==='udl'&&item.endEdge==='right')item.end=state.L;
      }
    }else if(type==='change_section')Object.assign(state.section,op.patch);
    else if(type==='change_material'){
      if(own(op.patch,'key')){
        if(!own(materialLibrary,op.patch.key))throw Error('Material desconhecido.');
        if(op.patch.key!=='custom'){const material=materialLibrary[op.patch.key];Object.assign(state.material,{E:material.E,yield:material.yield,rho:material.rho});}
      }
      Object.assign(state.material,op.patch);
    }else if(type==='add_support'||type==='add_load'){
      const support=type==='add_support',provided=support?op.support:op.load;
      if(!plain(provided))throw Error('Informe os parâmetros do elemento.');
      const allowed=support?['id','name','x','type','edge']:['id','name','x','end','kind','value','direction','unit','edge','endEdge'];
      if(Object.keys(provided).some(key=>!allowed.includes(key)))throw Error('Parâmetro do elemento não suportado.');
      finitePatch(provided);const items=support?state.supports:state.loads,id=provided.id||newId(support?'s':'p',items);
      const element={...clone(provided),id,name:provided.name||id};
      if(!support){if(!own(element,'direction'))element.direction=element.kind==='moment'?-1:1;if(!own(element,'unit'))element.unit=defaultUnit[element.kind];}
      if(!own(element,'edge'))element.edge=positionEdge(element.x,state.L);
      if(element.kind==='udl'&&!own(element,'endEdge'))element.endEdge=positionEdge(element.end,state.L);
      items.push(element);if(support)op.support=clone(element);else op.load=clone(element);
    }else if(type==='update_support'||type==='update_load'){
      const items=type==='update_support'?state.supports:state.loads,element=items.find(item=>item.id===op.id);
      if(!element)throw Error('Elemento não encontrado: '+op.id+'.');
      const patch=op.patch;
      if(type==='update_load'&&own(patch,'kind')&&patch.kind!==element.kind){
        const oldKind=element.kind,oldForce=loadForce(element,state),kind=patch.kind;
        if(!own(units,kind))throw Error('Tipo de carga não suportado.');
        if(kind==='mass')Object.assign(element,{value:['moment','udl'].includes(oldKind)?50:Math.abs(oldForce)/state.g,unit:'kg',direction:1});
        if(kind==='force'){const value=['moment','udl'].includes(oldKind)?1000:Math.abs(oldForce);Object.assign(element,{value,unit:value>=1000?'kN':'N',direction:oldForce<0?-1:1});}
        if(kind==='moment')Object.assign(element,{value:1000,unit:'kNm',direction:-1});
        if(kind==='udl')Object.assign(element,{value:1000,unit:'kNpm',direction:1,x:Math.min(element.x,state.L/2),end:state.L,endEdge:'right'});
        element.kind=kind;
      }
      Object.assign(element,patch);
      if(own(patch,'mount')){if(element.type!=='fixed'||!['left','right'].includes(patch.mount))throw Error('Montagem inválida para este apoio.');element.edge=patch.mount;element.x=patch.mount==='left'?0:state.L;delete element.mount;}
      else if(own(patch,'x'))element.edge=own(patch,'edge')?patch.edge:positionEdge(element.x,state.L);
      else if(own(patch,'edge')&&['left','right'].includes(patch.edge))element.x=patch.edge==='left'?0:state.L;
      if(element.kind==='udl'&&own(patch,'end'))element.endEdge=own(patch,'endEdge')?patch.endEdge:positionEdge(element.end,state.L);
    }else if(type==='remove_support'||type==='remove_load'){
      const items=type==='remove_support'?state.supports:state.loads,index=items.findIndex(item=>item.id===op.id);
      if(index<0)throw Error('Elemento não encontrado: '+op.id+'.');items.splice(index,1);
    }else throw Error('Alteração não suportada: '+type+'.');
    applied.push(op);
  }
  validateSectionMaterial(state);
  const errors=inputErrors(state,{editorLimits:true});if(errors.length){const error=Error(errors.map(item=>item.message).join(' '));error.issues=errors;throw error;}
  return {state,operations:applied,changed:JSON.stringify(original)!==JSON.stringify(state),validation:validate(state)};
}
for(const material of Object.values(materialLibrary))Object.freeze(material);Object.freeze(materialLibrary);
return {defaultState,normalize,validate,calculate:safeCalculate,internalAt:(input,result,x,side='right')=>{if(!Number.isFinite(x)||!['left','right'].includes(side))throw Error('Posição de consulta ou lado inválido.');return internalAt(normalize(input),result,x,side);},diagramData:(input,result)=>{const state=normalize(input);return diagramData(state,result||safeCalculate(state));},structuralResults:structural,deflectionData:deflection,sectionProperties:input=>sectionProperties(normalize(input)),materialInfo:input=>materialInfo(normalize(input)),beamEvents:input=>beamEvents(normalize(input)),loadForce,loadMoment,loadIntensity,unitScale,materialLibrary,supportNames:Object.freeze(supportNames),applyOperations,snapshot};
});
