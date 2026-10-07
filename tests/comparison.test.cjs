const {test}=require('node:test'),assert=require('node:assert/strict');
const E=require('../experiments.js');
const batch=(values,expected={type:'noul',value:true,minProbability:.8})=>({input:{expected:{q:expected}},runs:values.map(noul=>({status:'done',output:{response:{answers:{q:{type:'noul',noul}}}}}))});
test('overview evaluates answer and confidence independently, including simultaneous failures',()=>{
  const b=batch([.95,.65,.1]),before=E.clone(b),c=E.questionChecks(b,'q');
  assert.equal(c.count,3);assert.equal(c.evaluated,3);assert.equal(c.matches,2);assert.equal(c.confident,1);assert.equal(c.passed,1);
  assert.deepEqual(b,before);
  const separate=E.questionChecks(batch([.4],{type:'noul',value:true,minProbability:.3}),'q');
  assert.equal(separate.matches,0);assert.equal(separate.confident,1);assert.equal(separate.passed,0);
  const falseAnswer=E.questionChecks(batch([.1],{type:'noul',value:false,minProbability:.8}),'q');
  assert.equal(falseAnswer.matches,1);assert.equal(falseAnswer.confident,1);
});
test('overview does not evaluate errors, deleted runs, absent expected answers or absent thresholds',()=>{
  const b=batch([.95]);b.runs.push({status:'error'},{status:'deleted'});
  assert.equal(E.questionChecks(b,'q').count,1);
  b.expectedOverride={q:{type:'noul',value:true}};assert.equal(E.questionChecks(b,'q').confident,null);assert.equal(E.questionChecks(b,'q').matches,1);
  b.expectedOverride={};assert.equal(E.questionChecks(b,'q').evaluated,0);assert.equal(E.questionChecks(b,'q').expected,undefined);
  b.runs=[];assert.equal(E.questionChecks(b,'q').count,0);
});
test('overview uses modal Score and P(expected level), never API confidence or rounded mean',()=>{
  const b={input:{expected:{q:{type:'score',value:1,minProbability:.6}}},runs:[{status:'done',output:{response:{answers:{q:{type:'score',score:1.4,probabilities:{0:.1,1:.4,2:.5},confidence:.99}}}}}]};
  const c=E.questionChecks(b,'q');assert.equal(c.actual,2);assert.equal(c.matches,0);assert.equal(c.confident,0);
  b.expectedOverride={q:{type:'score',value:2,minProbability:.5}};assert.equal(E.questionChecks(b,'q').passed,1);
});
test('comparison displays probability of the actual answer, including false',()=>{
  const b=batch([.07],{type:'noul',value:false,minProbability:.8}),r=E.questionComparison(b,'q');
  assert.equal(r.actual,false);assert.ok(Math.abs(r.probability-.93)<1e-12);assert.equal(r.reason,'pass');
  b.input.expected.q.value=true;
  const wrong=E.questionComparison(b,'q');assert.equal(wrong.reason,'wrong-value');assert.equal(wrong.actual,false);assert.equal(wrong.probability,r.probability);
});
test('correct answers below threshold are explicitly confidence failures, not wrong answers',()=>{
  const b=batch([.67]);const result=E.questionComparison(b,'q');
  assert.equal(result.reason,'low-probability');assert.equal(result.wrongValue,0);assert.equal(result.lowProbability,1);assert.equal(result.actual,true);
  b.expectedOverride={q:{type:'noul',value:true,minProbability:.6}};assert.equal(E.questionComparison(b,'q').reason,'pass');
});
test('a high mean cannot hide a failing run; mixed reasons and ties remain visible',()=>{
  const b=batch([.99,.67]);assert.ok(E.questionComparison(b,'q').probability>.8);assert.equal(E.questionComparison(b,'q').reason,'low-probability');
  assert.equal(E.questionComparison(b,'q',0).reason,'pass');assert.equal(E.questionComparison(b,'q',1).reason,'low-probability');
  b.runs.push(...batch([.2]).runs);const mixed=E.questionComparison(b,'q');assert.equal(mixed.reason,'mixed-failure');assert.equal(mixed.passed,1);assert.equal(mixed.wrongValue,1);assert.equal(mixed.lowProbability,1);
  const tie=E.questionComparison(batch([.9,.1]),'q');assert.equal(tie.actual,null);assert.equal(tie.probability,null);assert.equal(tie.varied,true);
});
test('deleted and error runs never affect response means or expected-answer evaluation',()=>{
  const b=batch([.9]);b.runs.push({status:'error',error:'API unavailable'},{status:'deleted'});
  const before=E.clone(b),r=E.questionComparison(b,'q');assert.equal(r.count,1);assert.equal(r.reason,'pass');assert.deepEqual(b,before);
  assert.equal(E.questionComparison(b,'q',1).reason,'pending');
  b.expectedOverride={};assert.equal(E.questionComparison(b,'q').reason,'unscored');
});
test('round grouping uses campaign ID, not same test name or version, and preserves snapshots',()=>{
  const items=[{id:'a',automation:{campaignId:'r1',round:1}},{id:'b',automation:{campaignId:'r1',round:1}},{id:'c',automation:{campaignId:'r2',round:2}},{id:'manual'}];
  const before=E.clone(items),groups=E.campaignGroups(items);assert.deepEqual(groups.map(g=>g.members.map(b=>b.id)),[['a','b'],['c'],['manual']]);assert.deepEqual(items,before);
  assert.equal(E.campaignGroups(items.slice(1))[0].members.length,1);
});
