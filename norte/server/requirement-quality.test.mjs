import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectRequirement, activeRequirementRules, validateRequirementAnalysis } from '../shared/requirement-quality.mjs';
test('editorial spans match exact UTF-16 text and optional references do not fabricate standards',()=>{
 const statement='📡 O rádio deve enviar os dados rapidamente; frequência TBD.';
 const local=inspectRequirement({statement,method:'test'},[]);assert(local.findings.every(f=>f.reference===null));
 const nasa=inspectRequirement({statement,method:'test'},['nasa-hb']);for(const f of nasa.findings.filter(f=>f.start!==null))assert.equal(statement.slice(f.start,f.end),f.affectedText);
 assert(nasa.findings.some(f=>f.severity==='critical'&&f.affectedText==='TBD'));assert(nasa.findings.every(f=>f.reference?.source.startsWith('NASA')));
 const ecss=inspectRequirement({statement,method:'test'},['ecss-req']);assert(ecss.findings.every(f=>f.reference?.url.includes('ecss.nl')));assert(ecss.findings.every(f=>f.reference?.page>=25&&f.reference.page<=27));
});
test('model findings cannot invent sources, offsets or replacement thresholds',()=>{
 const statement='O sistema deve responder rapidamente.',start=statement.indexOf('rapidamente'),rules=activeRequirementRules(['nasa-hb']);
 const valid={ruleId:'nasa-verifiable',severity:'warning',title:'Definir limite',explanation:'Critério subjetivo.',suggestion:'Defina um limite com fonte.',start,end:start+11,affectedText:'rapidamente'};
 assert.equal(validateRequirementAnalysis({findings:[valid]},{statement},rules).length,1);
 for(const patch of [{ruleId:'fake-law'},{start:start+1},{affectedText:'rápido'},{suggestion:'Defina limite de 2 segundos.'},{explanation:'Veja https://invented.invalid'}])assert.throws(()=>validateRequirementAnalysis({findings:[{...valid,...patch}]},{statement},rules));
});
