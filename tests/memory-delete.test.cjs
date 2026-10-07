const {test}=require('node:test'),assert=require('node:assert/strict');
const F=require('../memory-flow.js'),R=require('../relation-worker.js');
const batch=require('./fixtures/memory-b001-positive-relations.json');
const clone=value=>JSON.parse(JSON.stringify(value));

test('delete removes only the exact saved test, preserves question versions and never recycles IDs',()=>{
  const library=F.emptyLibrary();
  const first=F.saveTest(library,batch,F.questions,null,R.defaults);
  const second=F.saveTest(library,batch,F.questions,null,R.defaults);
  const before=clone(library);
  assert.deepEqual(F.deleteTest(library,second.id),second);
  assert.deepEqual(library.tests,[first]);
  assert.deepEqual(library.versions,before.versions);assert.deepEqual(library.relationVersions,before.relationVersions);
  const restored=F.validateLibrary(clone(library));
  assert.equal(F.saveTest(restored,batch,F.questions).id,'T003');
  F.deleteTest(restored,'T001');F.deleteTest(restored,'T003');
  assert.equal(restored.tests.length,0);
  assert.equal(F.saveTest(F.validateLibrary(restored),batch,F.questions).id,'T004');
});

test('legacy libraries gain a high-water ID on deletion, invalid targets cannot mutate anything',()=>{
  const library=F.emptyLibrary();F.saveTest(library,batch,F.questions);delete library.nextTestNumber;
  const before=clone(library);
  for(const id of ['missing','',null,undefined,'T001_B001']) assert.throws(()=>F.deleteTest(library,id),/não encontrado/);
  assert.deepEqual(library,before);
  F.deleteTest(library,'T001');assert.equal(F.saveTest(library,batch,F.questions).id,'T002');
  for(const invalid of [null,0,1,2,-1,1.5,'3',Infinity]) assert.throws(()=>F.validateLibrary({...library,nextTestNumber:invalid}),/Sequência/);
});
