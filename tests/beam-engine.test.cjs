const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const Beam=require('../beam-engine.js'),clone=value=>JSON.parse(JSON.stringify(value));
const originalPath=path.join(__dirname,'../exemplos-testes/testes_viga/viga_editor_calculos_secao.html');
const html=fs.readFileSync(originalPath,'utf8'),script=html.split('<script id="beam-app">')[1].split('\nlet selectedSupport=')[0];
// Execute the original, unchanged calculation prefix independently. Rendering
// begins after this prefix, so no DOM, browser mocks or copied solver are needed.
const context=vm.createContext({});vm.runInContext(script+'\nglobalThis.oracle={initial,photoExample,distributedExample,startCase,calculate,internalAt,diagramData,sectionProperties,materialInfo,structuralResults,deflectionData,ensureBeamModel};',context,{filename:originalPath});
const oracle=context.oracle;
const json=value=>JSON.stringify(value,(_,x)=>typeof x==='number'&&!Number.isFinite(x)?String(x):x);
function near(actual,expected,tolerance=1e-9){assert.ok(Number.isFinite(actual)&&Math.abs(actual-expected)<=tolerance*Math.max(1,Math.abs(expected)),`${actual} != ${expected}`);}
function base(kind='fixed'){const state=Beam.defaultState();if(kind==='simple')state.supports=[{id:'s1',name:'A',type:'pin',x:0},{id:'s2',name:'B',type:'roller',x:state.L}];return Beam.normalize(state);}
function compareOriginal(input){
 const state=Beam.normalize(input),before=json(state),result=Beam.calculate(state),reference=oracle.calculate(clone(state));
 assert.equal(json(result),json(reference));assert.equal(json(Beam.diagramData(state,result)),json(oracle.diagramData(clone(state),reference)));
 const actual=Beam.structuralResults(state,result),expected=oracle.structuralResults(clone(state),reference),{xs,ys,...summary}=actual.deflection;
 assert.equal(json({...actual,deflection:summary}),json(expected));
 for(const x of [0,state.L,...state.loads.map(load=>load.x),...state.supports.map(support=>support.x),state.L*.317])for(const side of ['left','right'])assert.equal(json(Beam.internalAt(state,result,x,side)),json(oracle.internalAt(clone(state),reference,x,side)));
 assert.equal(json(state),before,'all exported calculations must be pure');
 return result;
}

test('default state matches the original 6 m cantilever, including section and material defaults',()=>{
 const expected=clone(oracle.startCase);oracle.ensureBeamModel(expected);assert.equal(json(Beam.defaultState()),json(expected));
 const first=Beam.defaultState(),second=Beam.defaultState();first.loads[0].value=1;first.section.b=1;assert.equal(second.loads[0].value,10000);assert.equal(second.section.b,.12);
});

test('all original worked examples and determinate/indeterminate variants match the unchanged original script',()=>{
 const cases=[oracle.initial,oracle.photoExample,oracle.distributedExample,oracle.startCase].map(clone);
 let state=clone(oracle.initial);state.supports[0].type='fixed';state.loads=[];cases.push(state);
 state=clone(oracle.initial);state.supports.forEach(s=>s.type='fixed');cases.push(state);
 state=clone(oracle.initial);state.mbar=100/9.81;state.loads=[];state.supports.push({id:'s3',name:'C',x:5,type:'roller'});cases.push(state);
 state=clone(oracle.initial);state.supports[0].x=2;state.supports[1].x=8;cases.push(state);
 state=clone(oracle.photoExample);state.supports=[{id:'s1',name:'A',type:'fixed',x:0}];cases.push(state);
 state=clone(oracle.photoExample);state.loads=state.loads.slice(2);cases.push(state);
 state=clone(oracle.photoExample);state.loads[2].direction=1;cases.push(state);
 state=clone(oracle.photoExample);state.supports.forEach(s=>s.type='fixed');state.loads[0].x=1e-8;cases.push(state);
 state=base();state.supports[0].x=2;state.supports[0].edge=null;cases.push(state);
 for(const input of cases)assert.equal(compareOriginal(input).valid,true);
});

test('deterministic mixed load and support samples reproduce the original solver, diagrams, stresses and deflection maxima',()=>{
 let seed=73129;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
 for(let trial=0;trial<36;trial++){
  const state=base(trial%3?'simple':'fixed');state.L=3+random()*15;state.mbar=random()*50;state.supports.at(-1).x=state.supports.length===2?state.L:0;
  if(trial%3===1)state.supports.push({id:'s3',name:'C',type:'roller',x:state.L*.43});
  if(trial%3===2)state.supports.forEach(s=>s.type='fixed');
  state.loads=Array.from({length:4},(_,index)=>{const kind=['mass','force','moment','udl'][index],x=random()*state.L*.7;return {id:'p'+index,name:'P'+index,kind,x,value:random()*(kind==='mass'?200:25000),direction:random()>.3?1:-1,unit:{mass:'kg',force:'kN',moment:'Nm',udl:'kNpm'}[kind],...(kind==='udl'?{end:x+(state.L-x)*(.1+.9*random())}:{})};});
  if(trial%2)state.section={shape:'i',b:.2,h:.3,tw:.012,tf:.02};
  assert.equal(compareOriginal(state).valid,true);
 }
});

test('6 m and 4 m cantilevers under 10 kN reproduce reference reactions and section stresses',()=>{
 const state=base(),reaction=Beam.calculate(state).reactions[0],results=Beam.structuralResults(state);
 near(reaction.R,10000);near(reaction.M,60000);near(results.d.Mmax,60000);near(results.sec.I,.12*.24**3/12);near(results.sigma,60000/(.12*.24**2/6));near(results.tau,1.5*10000/(.12*.24));near(results.deflection.max,10000*6**3/(3*200e9*(.12*.24**3/12)),5e-4);
 const changed=Beam.applyOperations(state,[{type:'change_beam',patch:{L:4}}]);assert.equal(changed.state.loads[0].x,4);near(Beam.calculate(changed.state).reactions[0].M,40000);assert.equal(state.L,6);
});

test('force and moment discontinuities preserve the original left/right sign conventions',()=>{
 const state=Beam.normalize(oracle.photoExample),result=Beam.calculate(state);near(Beam.internalAt(state,result,1).V,7500);near(Beam.internalAt(state,result,3).V,-2500);near(Beam.internalAt(state,result,5).V,-12500);
 near(Beam.internalAt(state,result,6,'left').M,-15000);near(Beam.internalAt(state,result,6,'right').M,0);near(Beam.internalAt(state,result,6,'right').V,0);
 state.loads[2].x=3;const moved=Beam.calculate(state);near(Beam.internalAt(state,moved,3,'right').M-Beam.internalAt(state,moved,3,'left').M,15000);near(Beam.internalAt(state,moved,3,'right').V-Beam.internalAt(state,moved,3,'left').V,0);
 assert.throws(()=>Beam.internalAt(state,result,NaN),/consulta/);assert.throws(()=>Beam.internalAt(state,result,2,'middle'),/lado/);
});

test('display units never multiply an already-SI value, and mass loads always act downward like the original',()=>{
 const state=base();state.loads[0].unit='N';assert.equal(Beam.calculate(state).reactions[0].R,10000);state.loads[0].unit='kN';assert.equal(Beam.calculate(state).reactions[0].R,10000);state.loads[0].value=10;assert.equal(Beam.calculate(state).reactions[0].R,10);
 state.loads[0]={id:'p1',name:'P',kind:'mass',x:6,value:50,direction:-1,unit:'kg'};near(Beam.calculate(state).reactions[0].R,490.5);assert.equal(Beam.unitScale('kN'),1000);assert.equal(Beam.unitScale({unit:'Npm'}),1);
});

test('self weight is the manual total mass distributed over length, not automatic material density',()=>{
 const state=base('simple');state.loads=[];state.L=10;state.supports[1].x=10;state.mbar=10;const result=Beam.calculate(state);near(result.Wbar,98.1);near(result.q,9.81);near(Beam.diagramData(state,result).Mmax,98.1*10/8);
 const heavier=Beam.applyOperations(state,[{type:'change_material',patch:{rho:15000}},{type:'change_section',patch:{b:.2}}]).state;assert.equal(heavier.mbar,10);near(Beam.calculate(heavier).Wbar,98.1);assert.notEqual(Beam.structuralResults(heavier).geomMass,Beam.structuralResults(state).geomMass);
});

test('rectangular and I sections, material presets and deflection samples retain the original formulas',()=>{
 const original=base(),state=Beam.applyOperations(original,[{type:'change_section',patch:{shape:'i',b:.2,h:.3,tw:.012,tf:.02}},{type:'change_material',patch:{key:'aluminum'}}]).state,section=Beam.sectionProperties(state),result=Beam.structuralResults(state);
 near(section.A,2*.2*.02+.012*(.3-.04));near(section.I,(.2*.3**3-(.2-.012)*(.3-.04)**3)/12);near(result.tau,result.d.Vmax*section.Q/(section.I*section.tw));assert.equal(state.material.E,68.9e9);assert.equal(state.material.rho,2700);
 assert.equal(result.deflection.xs.length,result.deflection.ys.length);assert.ok(result.deflection.xs.length>=601);near(Math.max(...result.deflection.ys.map(Math.abs)),result.deflection.max);assert.equal(result.deflection.xs[0],0);assert.equal(result.deflection.xs.at(-1),6);near(result.deflection.ys[0],0);
 const stiffer=clone(state);stiffer.material.E*=2;near(Beam.structuralResults(stiffer).deflection.max,result.deflection.max/2);compareOriginal(state);
});

test('roller uplift is reported without silently switching the original bilateral support model',()=>{
 const state=Beam.normalize(oracle.initial);state.supports[0].x=8;const result=compareOriginal(state);assert.equal(result.valid,true);assert.match(result.warning,/retenção/);assert.ok(result.reactions.find(s=>s.type==='roller').R<0);
});

test('invalid geometry, duplicates, unsupported loads and unstable supports fail explicitly',()=>{
 const cases=[s=>s.supports=[],s=>s.supports=[{id:'s1',name:'A',type:'pin',x:0}],s=>s.supports=[{id:'s1',name:'A',type:'roller',x:0},{id:'s2',name:'B',type:'roller',x:6}],s=>s.supports.push({...s.supports[0]}),s=>s.loads.push({...s.loads[0]}),s=>s.loads[0].x=7,s=>s.loads[0].value=-1,s=>s.loads[0].direction=0,s=>s.loads[0].kind='triangle',s=>Object.assign(s.loads[0],{kind:'udl',unit:'Npm',x:4,end:2}),s=>s.L=0,s=>s.g=NaN];
 for(const modify of cases){const state=base();modify(state);const before=json(state);assert.equal(Beam.calculate(state).valid,false);assert.equal(Beam.validate(state).valid,false);assert.equal(json(state),before);}
 assert.equal(Beam.validate({loads:42}).valid,false);
 const coincident=base('simple');coincident.loads[0].x=0;assert.equal(Beam.calculate(coincident).valid,true,'a load may coincide with a support');
});

test('operations are atomic, generate stable IDs and preserve SI while display units change',()=>{
 const state=base(),before=json(state);assert.throws(()=>Beam.applyOperations(state,[{type:'change_beam',patch:{L:4}},{type:'update_load',id:'missing',patch:{value:20}}]),/não encontrado/);assert.equal(json(state),before);
 const added=Beam.applyOperations(state,[{type:'add_load',load:{kind:'force',name:'P2',x:3,value:2000,direction:-1,unit:'kN'}},{type:'add_support',support:{name:'B',type:'roller',x:6}}]);assert.equal(added.state.loads[1].id,'p2');assert.equal(added.state.supports[1].id,'s2');assert.equal(added.operations[0].load.id,'p2');assert.equal(added.changed,true);assert.equal(added.validation.valid,true);
 const changed=Beam.applyOperations(added.state,[{type:'update_load',id:'p2',patch:{unit:'N'}},{type:'update_support',id:'s2',patch:{x:5}},{type:'remove_load',id:'p1'}]);assert.equal(changed.state.loads[0].value,2000);assert.equal(changed.state.supports[1].x,5);assert.equal(changed.state.supports[1].edge,null);assert.equal(json(state),before);
});

test('out of range operation requests are rejected instead of silently clamped or partially applied',()=>{
 for(const operation of [{type:'change_beam',patch:{L:25}},{type:'change_beam',patch:{g:0}},{type:'change_section',patch:{b:0}},{type:'change_section',patch:{shape:'round'}},{type:'change_material',patch:{E:0}},{type:'change_material',patch:{key:'wood'}},{type:'update_load',id:'p1',patch:{x:9}},{type:'update_load',id:'p1',patch:{unit:'kg'}},{type:'change_beam',patch:{invented:1}},{type:'add_load',load:{kind:'triangle',x:2,value:1000}},{type:'fake'}]){const state=base(),before=json(state);assert.throws(()=>Beam.applyOperations(state,[operation]));assert.equal(json(state),before);}
 const state=base();state.loads[0].edge=null;state.loads[0].x=5;assert.throws(()=>Beam.applyOperations(state,[{type:'change_beam',patch:{L:4}}]),/posição/);
});

test('support editing can expose a mechanism and view-only commands never change physical state',()=>{
 const state=base(),removed=Beam.applyOperations(state,[{type:'remove_support',id:'s1'}]);assert.equal(removed.state.supports.length,0);assert.equal(removed.validation.valid,false);assert.match(removed.validation.error,/Sem apoios/);
 const views=Beam.applyOperations(state,[{type:'open_simulation',reset:false},{type:'show_graphs',graphs:['shear']},{type:'show_results'},{type:'show_calculations'},{type:'compare'}]);assert.equal(views.changed,false);assert.equal(json(views.state),json(state));
});

test('state normalization follows original section/material bounds without mutating the caller',()=>{
 const state=base();state.section.b=4;state.section.h=.001;state.material.E=1;const before=json(state),normalized=Beam.normalize(state),reference=clone(state);oracle.ensureBeamModel(reference);assert.equal(json(normalized.section),json(reference.section));assert.equal(json(normalized.material),json(reference.material));assert.equal(json(state),before);
});

test('snapshots are JSON-safe and distinguish unbounded zero-bending safety factor from missing results',()=>{
 const state=base();state.loads=[];const results=Beam.structuralResults(state);assert.equal(results.fos,Infinity);const saved=Beam.snapshot(state);assert.equal(saved.structural.fos,null);assert.equal(saved.structural.fosUnbounded,true);assert.deepEqual(JSON.parse(JSON.stringify(saved)),saved);
 const invalid=clone(state);invalid.supports=[];const incomplete=Beam.snapshot(invalid);assert.equal(incomplete.calculation.valid,false);assert.equal(incomplete.structural.fosUnbounded,false);assert.equal(incomplete.structural.fos,null);
});

test('the UMD module works without DOM, network or Node globals and reproduces the module result',()=>{
 const browser=vm.createContext({});vm.runInContext(fs.readFileSync(path.join(__dirname,'../beam-engine.js'),'utf8'),browser);assert.ok(browser.NorteBeamEngine);assert.equal(json(browser.NorteBeamEngine.calculate(browser.NorteBeamEngine.defaultState())),json(Beam.calculate(Beam.defaultState())));
});
