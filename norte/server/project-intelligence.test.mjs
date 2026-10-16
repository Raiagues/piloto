import test from 'node:test';
import assert from 'node:assert/strict';
import { createProjectIntelligence } from './project-intelligence.mjs';
import { createProjectRetriever, memoryContext, modelForArtifacts, rankProjectObjects } from './project-retrieval.mjs';
import { pruneDemoSandboxes } from './demo-account.mjs';

class Store {
  constructor(data) { this.data = structuredClone(data); this.queue = Promise.resolve(); this.beforeUpdate = null; }
  read() { return structuredClone(this.data); }
  async refresh() {}
  update(fn) { const operation = this.queue.then(async () => { if (this.beforeUpdate) { const hook = this.beforeUpdate; this.beforeUpdate = null; hook(this.data); } const draft = this.read(), result = await fn(draft); this.data = draft; return structuredClone(result); }); this.queue = operation.catch(() => {}); return operation; }
}
const evidence = (id, artifactId, excerpt) => ({ id, artifactId, artifactLabel: artifactId, excerpt, kind: 'fact', locator: 'p. 1' });
const entity = (id, name, ref, value) => ({ id, name, kind: 'component', description: name + ' documentado.', source: 'documented', confidence: .9, evidenceRefs: [ref], properties: [{ key: 'mass', name: 'Massa', value, unit: 'kg', source: 'documented', evidenceRefs: [ref] }] });
const exampleModel = () => ({ id: 'baseline', name: 'Missão', schemaVersion: 1, revision: 1, generatedFromRevision: 2,
  entities: [entity('radio', 'Rádio público', 'e-public', 1), entity('secret', 'Carga secreta', 'e-private', 5), entity('foreign', 'Objeto externo', 'e-foreign', 9)],
  relations: [{ id: 'rel-secret', from: 'radio', to: 'secret', kind: 'powers', source: 'documented', evidenceRefs: ['e-private'], confidence: .9 }],
  requirements: [{ id: 'req-secret', title: 'Limite secreto', statement: 'A carga secreta deve pesar 5 kg.', sourceRefs: ['e-private'], relatedEntityIds: ['secret'], properties: [], status: 'unreviewed' }],
  evidence: [evidence('e-public', 'public-doc', 'O rádio possui massa de 1 kg.'), evidence('e-private', 'private-doc', 'A carga secreta possui massa de 5 kg.'), evidence('e-foreign', 'foreign-doc', 'Outro projeto tem massa de 9 kg.')], artifactSources: [], scenarios: [], corrections: [] });
function fixture({ jev, restrict = false } = {}) {
  const users = ['alice', 'bob', 'outsider'].map(id => ({ id, memberId: 'm-' + id, name: id, nickname: id, active: true, accessRole: id === 'outsider' ? 'owner_admin' : 'member' }));
  const project = { id: 'project', memoryRevision: 2, context: { teamId: 'team', projectArtifactIds: ['public-doc', 'private-doc', 'foreign-doc'], teamArtifactIds: [] }, engineeringSystem: exampleModel() };
  const artifacts = [{ id: 'public-doc', scope: 'project', ownerId: project.id, size: 30, updatedAt: '1', allowed: ['alice', 'bob'] }, { id: 'private-doc', scope: 'project', ownerId: project.id, size: 40, updatedAt: '1', allowed: restrict ? ['alice'] : ['alice', 'bob'] }, { id: 'foreign-doc', scope: 'project', ownerId: 'another-project', allowed: ['alice', 'bob'] }];
  const meeting = { id: 'meeting', ownerId: 'alice', participantIds: ['bob'], projectId: project.id, memoryMode: 'project' };
  const store = new Store({ users, teams: [{ id: 'team', memberIds: ['m-alice', 'm-bob'] }], artifacts, workspace: { projects: { project: { document: project, createdBy: 'alice' } }, labs: {} }, meetings: { meeting, alone: { ...meeting, id: 'alone', participantIds: [] }, none: { ...meeting, id: 'none', memoryMode: 'none', projectId: null } }, projectLearning: {} });
  const intelligence = createProjectIntelligence({ store, jev: jev || { enabled: false }, canReadArtifact: (data, user, artifact) => artifact.allowed.includes(user.id) });
  const actor = id => store.read().users.find(user => user.id === id);
  const currentProject = () => store.read().workspace.projects.project.document;
  const context = (actorId = 'alice') => ({ actorId, project: currentProject() });
  return { store, intelligence, actor, currentProject, context, meeting };
}
const choice = key => ({ type: 'choice', choice: key, confidence: 1, probabilities: { c0: key === 'c0' ? 1 : 0, none: key === 'none' ? 1 : 0 } });
const result = { status: 'resolved', change: { id: 'old-change', createdAt: 'old', targetEntityId: 'radio', kind: 'parameter', oldValues: [], newValues: [], description: 'Rádio revisado.' } };

test('retrieval drops unavailable provenance, dangling references and private one-hop relations without fabricating evidence', async () => {
  const model = exampleModel(); model.entities.push(entity('dangling', 'Fantasma', 'missing', 123));
  model.requirements.push({ id: 'public-req', title: 'Rádio', statement: 'Rádio de 1 kg.', sourceRefs: ['e-public'], originalStatement: 'Texto antigo de acesso desconhecido.', properties: [] });
  const filtered = modelForArtifacts(model, ['public-doc']);
  assert.deepEqual(filtered.entities.map(item => item.id), ['radio']);
  assert.deepEqual(filtered.relations, []); assert.deepEqual(filtered.requirements.map(item => item.id), ['public-req']);
  assert.equal(filtered.requirements[0].originalStatement, undefined);
  const context = memoryContext(filtered, ['radio'], { maxCharacters: 1200 });
  assert.equal(context.entities[0].properties[0].value, 1);
  assert.deepEqual(context.evidence, [model.evidence[0]]);
  assert.doesNotMatch(JSON.stringify(context), /secreta|secret|foreign|123|9 kg|5 kg/);
  assert.ok(JSON.stringify(context).length <= 1200);
  assert.deepEqual(model.entities[3].evidenceRefs, ['missing'], 'selection never rewrites original evidence');
});

test('technical identifier prefixes match package suffixes without broad substring or short-token matches', async () => {
  const model=exampleModel();
  model.entities=[entity('buffer','Buffer I2C TCA4311ADGKR','e-public',1),entity('exact','TCA4311A','e-private',2)];
  assert.deepEqual(rankProjectObjects(model,'TCA4311A').map(item=>item.id),['exact','buffer']);
  for(const query of ['4311','TCA','ADGKR','CA4311A','buffe']) assert.deepEqual(rankProjectObjects(model,query),[]);
  const retrieve=createProjectRetriever();
  const result=await retrieve({id:'prefix-project',memoryRevision:2,engineeringSystem:model},'Como funciona o TCA4311A?','alice',{allowedArtifactIds:['public-doc']});
  assert.equal(result.status,'ready');
  assert.equal(result.context.entities[0].id,'buffer');
  assert.doesNotMatch(JSON.stringify(result.context),/e-private|private-doc|"exact"/u);
});

test('large graph context reserves selected focus before neighbors and fits properties with their complete evidence',()=>{
  const model=exampleModel();
  const neighbors=Array.from({length:70},(_,index)=>entity(`neighbor-${index}`,`Vizinho ${index}`,'e-public',index));
  const focus=entity('buffer','Buffer I2C TCA4311ADGKR','e-focus',1);
  model.entities=[...neighbors,focus];
  model.evidence=[evidence('e-public','public-doc','Detalhes documentados dos vizinhos. '.repeat(15)),evidence('e-focus','public-doc','O buffer TCA4311ADGKR isola o barramento I2C.')];
  focus.properties=Array.from({length:24},(_,index)=>({key:`detail_${index}`,name:`Detalhe ${index}`,value:'Informação extensa. '.repeat(15),source:'documented',evidenceRefs:[`property-${index}`]}));
  model.evidence.push(...focus.properties.map((property,index)=>evidence(`property-${index}`,'public-doc',`Propriedade ${property.key} explicitamente documentada.`)));
  model.relations=neighbors.slice(0,10).map((neighbor,index)=>({id:`rel-${index}`,from:neighbor.id,to:focus.id,kind:'depends_on',source:'documented',evidenceRefs:['e-public'],confidence:.9}));model.requirements=[];
  const original=JSON.stringify(model),context=memoryContext(model,['buffer'],{maxCharacters:2200});
  assert.equal(context.entities[0].id,'buffer');
  assert.ok(context.entities[0].properties.length>0&&context.entities[0].properties.length<12);
  const refs=new Set(context.evidence.map(item=>item.id));
  for(const item of context.entities) for(const ref of [...(item.evidenceRefs||[]),...(item.properties||[]).flatMap(property=>property.evidenceRefs)]) assert.ok(refs.has(ref));
  assert.ok(JSON.stringify(context).length<=2200);
  assert.equal(JSON.stringify(model),original);
});

test('oversized focus provenance retains only an explicit identity locator within even the minimum budget',()=>{
  const model=exampleModel();
  const refs=Array.from({length:100},(_,index)=>`proof-${index}`),id='x'.repeat(100);
  model.entities=[{...entity(id,'N'.repeat(140),refs[0],1),description:'Detalhe que exige todas as fontes.',evidenceRefs:refs}];
  model.relations=[];model.requirements=[];model.evidence=refs.map(ref=>evidence(ref,'public-doc','Prova original extensa. '.repeat(25)));
  for(const maxCharacters of [512,1200]){
    const context=memoryContext(model,[id],{maxCharacters});
    assert.equal(context.entities[0].id,id);
    assert.equal(context.entities[0].contextMode,'identity_only');
    assert.equal(context.entities[0].description,undefined);
    assert.equal(context.entities[0].properties,undefined);
    assert.deepEqual(context.evidence,[]);
    assert.ok(JSON.stringify(context).length<=maxCharacters);
  }
});

test('meeting memory is the intersection of current participant document permissions', async () => {
  let calls = 0;
  const f = fixture({ restrict: true, jev: { enabled: true, async classify() { calls++; return { answers: { focus: choice('c0') } }; } } });
  const hidden = await f.intelligence.meetingContext({ meeting: f.meeting, user: f.actor('alice'), query: 'Carga secreta' });
  assert.equal(hidden.status, 'no_match'); assert.equal(calls, 0);
  const alone = await f.intelligence.meetingContext({ meeting: { id: 'alone' }, user: f.actor('alice'), query: 'Carga secreta' });
  assert.equal(alone.status, 'ready'); assert.match(JSON.stringify(alone.context), /5 kg/); assert.equal(calls, 1);
  const visible = await f.intelligence.meetingContext({ meeting: f.meeting, user: f.actor('bob'), query: 'Rádio público' });
  assert.equal(visible.status, 'ready'); assert.doesNotMatch(JSON.stringify(visible.context), /secreta|foreign-doc/);
  await assert.rejects(f.intelligence.meetingContext({ meeting: f.meeting, user: f.actor('outsider'), query: 'Rádio público' }), error => error.statusCode === 404);
});

test('disabled memory always strips client-supplied project context, including relation requests', async () => {
  let calls = 0;
  const f = fixture({ jev: { enabled: true, async classify() { calls++; throw Error('must not be called'); } } });
  const input = { project_memory: { forged: true }, state: { current_utterance: 'Rádio público', project_memory: { forged: true } } };
  for (const path of ['/api/classify', '/api/relations', '/api/typed-relations']) {
    const clean = await f.intelligence.prepareMeetingRequest({ meeting: { id: 'none', memoryMode: 'project' }, user: f.actor('alice'), body: input, path });
    assert.equal(clean.project_memory, undefined); assert.equal(clean.state.project_memory, undefined);
  }
  assert.equal(input.state.project_memory.forged, true); assert.equal(calls, 0);
  assert.equal((await f.intelligence.meetingContext({ meeting: { id: 'none' }, user: f.actor('bob'), query: 'Rádio' })).enabled, false);
});

test('retrieval cache is actor-scoped, uses current provenance and revalidates cached access', async () => {
  let calls = 0, valid = true;
  const retrieve = createProjectRetriever({ jev: { enabled: true, async classify() { calls++; return { answers: { focus: choice('c0') } }; } } });
  const project = { id: 'p', memoryRevision: 2, engineeringSystem: exampleModel() }, options = { allowedArtifactIds: ['public-doc'], accessKey: 'acl-1', revalidate: async () => valid };
  assert.equal((await retrieve(project, 'Rádio', 'alice', options)).cached, false);
  assert.equal((await retrieve(project, 'Rádio', 'alice', options)).cached, true); assert.equal(calls, 1);
  assert.equal((await retrieve(project, 'Rádio', 'bob', options)).cached, false); assert.equal(calls, 2);
  assert.equal((await retrieve(project, 'Rádio', 'alice', { ...options, allowedArtifactIds: [], accessKey: 'acl-2' })).status, 'no_match');
  valid = false;
  await assert.rejects(retrieve(project, 'Rádio', 'alice', options), error => error.code === 'PROJECT_CONTEXT_CHANGED');
});

test('an in-flight retrieval is discarded if document permissions change during Jev', async () => {
  let release, started;
  const waiting = new Promise(resolve => { started = resolve; });
  const f = fixture({ jev: { enabled: true, async classify() { started(); return new Promise(resolve => { release = resolve; }); } } });
  const pending = f.intelligence.meetingContext({ meeting: f.meeting, user: f.actor('alice'), query: 'Carga secreta' });
  await waiting;
  await f.store.update(data => { data.artifacts.find(item => item.id === 'private-doc').allowed = ['alice']; });
  release({ answers: { focus: choice('c0') } });
  await assert.rejects(pending, error => error.code === 'PROJECT_CONTEXT_CHANGED');
  const current = await f.intelligence.meetingContext({ meeting: f.meeting, user: f.actor('alice'), query: 'Carga secreta' });
  assert.equal(current.status, 'no_match');
});

test('changed documents disable stale project memory and stop both Jev and LLM interpretation paths', async () => {
  let calls = 0;
  const f = fixture({ jev: { enabled: true, async classify() { calls++; throw Error('stale source must not be sent'); } } });
  await f.store.update(data => { data.workspace.projects.project.document.memoryRevision++; data.artifacts[0].updatedAt = 'changed-source'; });
  const retrieval = await f.intelligence.meetingContext({ meeting: f.meeting, user: f.actor('alice'), query: 'Rádio público' });
  assert.equal(retrieval.status, 'stale_baseline'); assert.equal(retrieval.context, null);
  const clean = await f.intelligence.prepareMeetingRequest({ meeting: f.meeting, user: f.actor('alice'), path: '/api/classify', body: { state: { current_utterance: 'Rádio público', project_memory: { forged: true } } } });
  assert.equal(clean.state.project_memory, undefined);
  await assert.rejects(f.intelligence.fastInterpreter(f.currentProject().engineeringSystem, 'Alterar massa do rádio para 2 kg', 'pt', f.context()), error => error.code === 'SYSTEM_MEMORY_STALE');
  assert.equal(calls, 0);
});

test('interpretation caches isolate actors and language; reuse refreshes change IDs and revoked access fails closed', async () => {
  const f = fixture(), project = f.currentProject(), ctx = f.context();
  assert.equal(await f.intelligence.fastInterpreter(project.engineeringSystem, 'Rever rádio', 'pt', ctx), null);
  await f.intelligence.rememberInterpretation(project.engineeringSystem, 'Rever rádio', ctx, result);
  const cached = await f.intelligence.fastInterpreter(project.engineeringSystem, 'Rever rádio', 'pt', f.context());
  assert.equal(cached.cached, true); assert.notEqual(cached.change.id, 'old-change');
  assert.equal(await f.intelligence.fastInterpreter(project.engineeringSystem, 'Rever rádio', 'en', f.context()), null);
  assert.equal(await f.intelligence.fastInterpreter(project.engineeringSystem, 'Rever rádio', 'pt', f.context('bob')), null);
  await f.store.update(data => { data.teams[0].memberIds = ['m-bob']; });
  await assert.rejects(f.intelligence.fastInterpreter(project.engineeringSystem, 'Rever rádio', 'pt', ctx), error => error.statusCode === 404);
});

test('persisted interpretation cache is invalidated when inference models, generation policy or prompt versions change', async () => {
  const f = fixture(), project = f.currentProject(), text = 'Rever rádio';
  const make = (inferencePolicy, promptVersions) => createProjectIntelligence({ store: f.store, jev: { enabled: false }, inferencePolicy, promptVersions });
  const oldPolicy = { model: 'gemini-3.5-flash-lite', maxOutputTokens: 8192, thinkingConfig: { thinkingLevel: 'MINIMAL' } };
  const old = make(oldPolicy), ctx = f.context();
  await old.fastInterpreter(project.engineeringSystem, text, 'pt', ctx);
  await old.rememberInterpretation(project.engineeringSystem, text, ctx, result);
  assert.equal((await make(oldPolicy).fastInterpreter(project.engineeringSystem, text, 'pt', f.context())).cached, true, 'same configuration may reuse persisted cache after restart');
  const cases = [
    [{ ...oldPolicy, model: 'gemini-3.8-flash', thinkingConfig: { thinkingLevel: 'LOW' } }, undefined],
    [{ ...oldPolicy, maxOutputTokens: 12000 }, undefined],
    [{ ...oldPolicy, thinkingConfig: { thinkingLevel: 'HIGH' } }, undefined],
    [oldPolicy, { discovery: 'changed-discovery-prompt' }],
    [oldPolicy, { jev: 'changed-jev-prompt' }]
  ];
  for (const [policy, prompts] of cases) assert.equal(await make(policy, prompts).fastInterpreter(project.engineeringSystem, text, 'pt', f.context()), null);
});

test('human feedback invalidates cached results and a late LLM response cannot refill the new prompt revision', async () => {
  const f = fixture(), project = f.currentProject(), first = f.context(), pending = f.context();
  await f.intelligence.fastInterpreter(project.engineeringSystem, 'Rever rádio', 'pt', first);
  await f.intelligence.rememberInterpretation(project.engineeringSystem, 'Rever rádio', first, result);
  await f.intelligence.fastInterpreter(project.engineeringSystem, 'Outra análise', 'pt', pending);
  const before = structuredClone(project.engineeringSystem);
  const evaluated = await f.intelligence.feedback(project, f.actor('alice'), { kind: 'irrelevant_constraint', input: 'Essa restrição não se aplica a este estudo.', correction: { targetId: 'req-secret' }, sourceRevision: 2 });
  assert.equal(evaluated.revision, 1); assert.equal(evaluated.versions[0].evaluation.measuredQualityGain, null);
  assert.deepEqual(f.currentProject().engineeringSystem, before, 'feedback does not silently remove a physical requirement');
  await assert.rejects(f.intelligence.rememberInterpretation(project.engineeringSystem, 'Outra análise', pending, result), error => error.code === 'PROJECT_CONTEXT_CHANGED');
  assert.equal(Object.keys(f.store.read().projectLearning.project.cache).length, 0);
  assert.equal(await f.intelligence.fastInterpreter(project.engineeringSystem, 'Rever rádio', 'pt', f.context()), null);
  assert.equal(f.intelligence.feedbackContext(project).examples.length, 1);
});

test('feedback rechecks permission and current model inside the transaction, and rejects hidden or foreign targets', async () => {
  const f = fixture({ restrict: true }), project = f.currentProject(), input = { kind: 'missing_relation', input: 'Faltou relacionar o rádio.', correction: { targetId: 'radio' }, sourceRevision: 2 };
  await assert.rejects(f.intelligence.feedback(project, f.actor('bob'), { ...input, correction: { targetId: 'secret' } }), error => error.code === 'FEEDBACK_TARGET_INVALID');
  await assert.rejects(f.intelligence.feedback(project, f.actor('alice'), { ...input, correction: { targetId: 'foreign' } }), error => error.code === 'FEEDBACK_TARGET_INVALID');
  f.store.beforeUpdate = data => { data.teams[0].memberIds = ['m-bob']; };
  await assert.rejects(f.intelligence.feedback(project, f.actor('alice'), input), error => error.statusCode === 404);
  assert.equal(f.store.read().projectLearning.project, undefined);
  await f.store.update(data => { data.teams[0].memberIds.push('m-alice'); data.workspace.projects.project.document.engineeringSystem.revision++; });
  await assert.rejects(f.intelligence.feedback(project, f.actor('alice'), input), error => error.code === 'PROJECT_MEMORY_CHANGED');
});

test('feedback versions serialize concurrent corrections and private examples disappear when permissions narrow', async () => {
  const f = fixture(), project = f.currentProject(), input = { kind: 'corrected', input: 'A carga não é o rádio.', comment: 'Detalhe confidencial desta análise.', sourceRevision: 2 };
  await Promise.all([f.intelligence.feedback(project, f.actor('alice'), input), f.intelligence.feedback(project, f.actor('bob'), input)]);
  assert.deepEqual(f.store.read().projectLearning.project.versions.map(item => item.revision), [1, 2]);
  assert.equal(f.intelligence.learning(project.id, 'bob').events.length, 2);
  await f.store.update(data => { data.artifacts.find(item => item.id === 'private-doc').allowed = ['alice']; });
  assert.equal(f.intelligence.learning(project.id, 'bob').events.length, 0);
  assert.equal(f.intelligence.feedbackContext(project, 'bob').examples.length, 0);
});

test('Jev metrics count actual requests, not fast-path skips; failures and quality remain explicit', async () => {
  let calls = 0;
  const f = fixture({ jev: { enabled: true, async classify() { calls++; throw Error('provider down'); } } }), project = f.currentProject();
  await f.intelligence.fastInterpreter(project.engineeringSystem, 'Talvez rever o rádio', 'pt', f.context());
  assert.equal(calls, 0); assert.equal(f.intelligence.learning(project.id, 'alice').metrics.jevCalls || 0, 0);
  await f.intelligence.fastInterpreter(project.engineeringSystem, 'Alterar massa do rádio para 2 kg', 'pt', f.context());
  const metrics = f.intelligence.learning(project.id, 'alice');
  assert.equal(calls, 1); assert.equal(metrics.metrics.jevCalls, 1); assert.equal(metrics.metrics.jevFailures, 1); assert.equal(metrics.measuredQualityGain, null);
});

test('provider telemetry records actual attempts, partial usage and latency without retaining prompts or headers', async () => {
  const f = fixture();
  assert.equal(await f.intelligence.recordProviderAttempt({ projectId: 'unknown', status: 'success' }), false);
  assert.equal(f.store.read().projectLearning.unknown, undefined);
  await f.intelligence.recordProviderAttempt({ projectId: 'project', feature: 'extraction', model: 'test-flash', status: 'provider_completed', attempt: 1, elapsedMs: 120, headers: { authorization: 'secret-key' }, prompt: 'confidential text', usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, thoughtsTokenCount: 5, cachedContentTokenCount: 50 } });
  await f.intelligence.recordProviderAttempt({ projectId: 'project', feature: 'discovery', model: 'test-flash', status: 'provider_timeout', failureCategory: 'provider_timeout', attempt: 2, elapsedMs: 3000 });
  await f.intelligence.recordProviderAttempt({ projectId: 'project', feature: 'discovery', model: 'test-flash', status: 'provider_completed', failureCategory: 'schema_rejection', elapsedMs: 200, usageMetadata: { promptTokenCount: 30, candidatesTokenCount: 10, thoughtsTokenCount: -4 } });
  const learning = f.intelligence.learning('project', 'alice');
  assert.equal(learning.metrics.llmCalls, 3); assert.equal(learning.metrics.providerFailures, 2); assert.equal(learning.metrics.usageUnavailable, 1);
  assert.equal(learning.metrics.reportedInputTokens, 130); assert.equal(learning.metrics.reportedOutputTokens, 30); assert.equal(learning.metrics.reportedThoughtTokens, 5); assert.equal(learning.metrics.reportedCachedTokens, 50); assert.equal(learning.metrics.providerElapsedMs, 3320);
  assert.equal(learning.monetaryCost, null); assert.equal(learning.measuredQualityGain, null);
  assert.doesNotMatch(JSON.stringify(learning), /secret-key|confidential text|authorization|headers/);
  for (let index = 0; index < 52; index++) await f.intelligence.recordProviderAttempt({ projectId: 'project', status: 'provider_completed', model: 'test-flash' });
  assert.equal(f.store.read().projectLearning.project.providerAttempts.length, 50);
  assert.equal(f.intelligence.learning('project', 'alice').providerAttempts.length, 20);
});

test('direct map edits create source-bound examples from actual changes, never from client audit history', async () => {
  const f = fixture(), original = f.currentProject(), context = f.context();
  await f.intelligence.fastInterpreter(original.engineeringSystem, 'Rever rádio', 'pt', context);
  await f.intelligence.rememberInterpretation(original.engineeringSystem, 'Rever rádio', context, result);
  await f.store.update(data => {
    const before = structuredClone(data.workspace.projects.project.document), after = structuredClone(before);
    after.engineeringSystem.corrections = [{ input: 'Inventar número secreto de 987654321 kg' }];
    data.workspace.projects.project.document = after;
    assert.deepEqual(f.intelligence.captureMapCorrections(data, before, after, 'alice'), { captured: 0, revision: 0 });
  });
  await f.store.update(data => {
    const before = structuredClone(data.workspace.projects.project.document), after = structuredClone(before);
    after.engineeringSystem.entities[0].properties[0].value = 2;
    after.engineeringSystem.relations = [];
    data.workspace.projects.project.document = after;
    assert.deepEqual(f.intelligence.captureMapCorrections(data, before, after, 'alice'), { captured: 2, revision: 1 });
  });
  const learning = f.intelligence.learning('project', 'alice');
  assert.equal(learning.metrics.mapCorrections, 2); assert.equal(learning.metrics.corrected, 2);
  assert.equal(Object.keys(f.store.read().projectLearning.project.cache).length, 0);
  assert.deepEqual(learning.events.map(event => event.correction.operation).sort(), ['removed', 'updated']);
  assert.doesNotMatch(JSON.stringify(learning.events), /987654321/);
  const feedback = f.intelligence.feedbackContext(f.currentProject(), 'alice');
  assert.equal(feedback.examples.length, 2);
  assert.deepEqual(feedback.examples.find(item => item.correction.operation === 'updated').correction.fields, [{ field: 'properties[mass].value', before: '1', after: '2' }]);
  assert.equal(f.currentProject().engineeringSystem.entities[0].properties[0].value, 2);
  await assert.rejects(f.intelligence.rememberInterpretation(original.engineeringSystem, 'Rever rádio', context, result), error => error.code === 'PROJECT_CONTEXT_CHANGED');
  assert.equal(Object.keys(f.store.read().projectLearning.project.cache).length, 0, 'old in-flight interpretations stay invalid');
});

test('a completed LLM interpretation cannot be returned after document access changes during its request', async () => {
  const f = fixture(), context = f.context(), model = f.currentProject().engineeringSystem;
  await f.intelligence.fastInterpreter(model, 'Rever carga secreta', 'pt', context);
  await f.store.update(data => { data.artifacts.find(item => item.id === 'private-doc').allowed = ['bob']; });
  await assert.rejects(f.intelligence.rememberInterpretation(model, 'Rever carga secreta', context, result), error => error.code === 'PROJECT_CONTEXT_CHANGED');
  assert.equal(Object.keys(f.store.read().projectLearning.project?.cache || {}).length, 0);
});

test('capturing map corrections excludes inaccessible changes and rejects unauthorized or mismatched commits', async () => {
  const f = fixture({ restrict: true });
  await f.store.update(data => {
    const before = structuredClone(data.workspace.projects.project.document), after = structuredClone(before);
    after.engineeringSystem.entities[1].properties[0].value = 123;
    data.workspace.projects.project.document = after;
    assert.equal(f.intelligence.captureMapCorrections(data, before, after, 'bob').captured, 0);
    assert.throws(() => f.intelligence.captureMapCorrections(data, before, after, 'outsider'), error => error.statusCode === 404);
    const unrelated = structuredClone(after); unrelated.engineeringSystem.entities[0].name = 'Unsaved change';
    assert.throws(() => f.intelligence.captureMapCorrections(data, before, unrelated, 'alice'), error => error.code === 'PROJECT_MEMORY_CHANGED');
    assert.equal(f.intelligence.captureMapCorrections(data, { ...before, engineeringSystem: null }, after, 'alice').captured, 0, 'initial extraction is not human correction');
  });
  assert.equal(f.store.read().projectLearning.project, undefined);
});

test('map correction examples preserve the actual changed field even in long objects', async () => {
  const f = fixture();
  await f.store.update(data => {
    const before = structuredClone(data.workspace.projects.project.document);
    before.engineeringSystem.entities[0].description = 'Descrição extensa. '.repeat(300);
    const after = structuredClone(before); after.engineeringSystem.entities[0].properties[0].value = 7;
    data.workspace.projects.project.document = after;
    f.intelligence.captureMapCorrections(data, before, after, 'alice');
  });
  const example = f.intelligence.feedbackContext(f.currentProject(), 'alice').examples[0];
  assert.deepEqual(example.correction.fields, [{ field: 'properties[mass].value', before: '1', after: '7' }]);
  assert.doesNotMatch(example.input, /Descrição extensa/);
});

test('map-only corrections retain earlier lessons and original audit anchors without rebasing changed sources or narrower audiences', async () => {
  const f = fixture();
  const edit = (actorId, mutate) => f.store.update(data => {
    const before = structuredClone(data.workspace.projects.project.document), after = structuredClone(before);
    mutate(after); data.workspace.projects.project.document = after;
    return f.intelligence.captureMapCorrections(data, before, after, actorId);
  });
  await edit('alice', project => { project.engineeringSystem.entities[0].properties[0].value = 2; });
  const originalAnchor = f.store.read().projectLearning.project.events[0].sourceKey;
  await edit('alice', project => { project.engineeringSystem.entities[0].name = 'Rádio revisado'; });
  let examples = f.intelligence.feedbackContext(f.currentProject(), 'alice').examples;
  assert.equal(examples.length, 2); assert.ok(examples.some(example => example.correction.fields.some(field => field.field === 'properties[mass].value')));
  const stored = f.store.read().projectLearning.project;
  assert.equal(stored.events[0].sourceKey, originalAnchor, 'audit source remains immutable');
  assert.notEqual(stored.events[0].activeSourceKey, originalAnchor);
  assert.deepEqual(stored.versions.map(version => version.revision), [1, 2]);
  await f.store.update(data => { data.artifacts[1].allowed = ['alice']; });
  await edit('bob', project => { project.engineeringSystem.entities[0].properties[0].value = 3; });
  examples = f.intelligence.feedbackContext(f.currentProject(), 'bob').examples;
  assert.equal(examples.length, 1, 'less privileged editor cannot inherit wider source examples');
  await f.store.update(data => { data.workspace.projects.project.document.memoryRevision++; data.artifacts[0].updatedAt = 'new-document-bytes'; });
  await edit('bob', project => { project.engineeringSystem.entities[0].name = 'Rádio corrigido'; });
  examples = f.intelligence.feedbackContext(f.currentProject(), 'bob').examples;
  assert.equal(examples.length, 1, 'source edits do not reactivate corrections against old documents');
  assert.equal(f.store.read().projectLearning.project.events.length, 4, 'old evidence remains in audit history');
});

test('pruning expired demos removes meeting invitations, memories and learning while preserving real projects', () => {
  const f = fixture(), data = f.store.read(), marker = { demoSandboxId: 'demo-old' };
  data.users.push({ id: 'demo-user', memberId: 'demo-member', isDemoAccount: true, demoSandboxOwner: true, createdAt: '2000-01-01', ...marker });
  data.members = [{ id: 'demo-member', ...marker }]; data.teams.push({ id: 'demo-team', memberIds: ['demo-member'], ...marker });
  data.sessions = [{ userId: 'demo-user' }]; data.activity = []; data.teamStats = {};
  data.workspace.projects['demo-project'] = { ...marker, document: { id: 'demo-project', ...marker } };
  data.projectLearning = { project: { revision: 3 }, 'demo-project': { revision: 5, events: [{ input: 'private' }] } };
  data.meetings['demo-meeting'] = { id: 'demo-meeting', ownerId: 'demo-user', projectId: 'demo-project', participantIds: [], ...marker };
  data.invitations = [{ id: 'team-invite', teamId: 'team', recipientUserId: 'demo-user' }];
  data.meetingInvitations = [{ id: 'a', meetingId: 'demo-meeting' }, { id: 'b', meetingId: 'meeting', recipientUserId: 'demo-user' }, { id: 'real', meetingId: 'meeting', recipientUserId: 'bob' }];
  pruneDemoSandboxes(data);
  assert.equal(data.workspace.projects['demo-project'], undefined); assert.equal(data.projectLearning['demo-project'], undefined); assert.equal(data.meetings['demo-meeting'], undefined);
  assert.deepEqual(data.meetingInvitations.map(item => item.id), ['real']); assert.deepEqual(data.invitations, []);
  assert.equal(data.projectLearning.project.revision, 3); assert.ok(data.meetings.meeting);
});

test('delivery versions feed meeting memory and interpretation without retaining obsolete numerical requirements', async () => {
  const f = fixture();
  await f.store.update(data => { const requirement = data.workspace.projects.project.document.engineeringSystem.requirements[0]; requirement.properties = [{ key: 'maximum_mass', name: 'Massa máxima', value: 5, unit: 'kg', source: 'documented', evidenceRefs: ['e-private'] }]; requirement.relatedPropertyRefs = [{ entityId: 'secret', propertyKey: 'mass' }]; });
  const baseline = f.currentProject().engineeringSystem;
  const before = await f.intelligence.meetingContext({ meeting: f.meeting, user: f.actor('alice'), query: 'Limite secreto' }); assert.equal(before.cached, false);
  await f.store.update(data => { data.workspace.delivery = { project: { revision: 1, requirements: [{ id: 'req-secret', title: 'Limite secreto revisado', statement: 'A carga deve pesar no máximo 2 kg.', sectorId: '', source: 'architecture', sourceHash: 'old-source', entityIds: ['secret'], sourceRefs: ['e-private'], artifactIds: [], parentIds: [], method: 'analysis', version: 2, archived: false, reviewers: [], decisions: [], comments: [], reviewHash: null }], tests: [], tasks: [], standards: [], history: [] } }; });
  const revised = await f.intelligence.meetingContext({ meeting: f.meeting, user: f.actor('alice'), query: 'Limite secreto' });
  assert.equal(revised.cached, false, 'delivery revisions invalidate retrieval cache');
  const requirement = revised.context.requirements.find(r => r.id === 'req-secret'); assert.equal(requirement.statement, 'A carga deve pesar no máximo 2 kg.'); assert.equal(requirement.source, 'user'); assert.ok(requirement.reviewTags.includes('numeric_constraints_need_review'));
  const analysis = f.intelligence.analysisContext('project', 'alice'); assert.equal(analysis.deliveryRevision, 1); assert.deepEqual(analysis.model.requirements[0].properties, []); assert.deepEqual(analysis.model.requirements[0].relatedPropertyRefs, []);
  assert.deepEqual(f.currentProject().engineeringSystem, baseline, 'human workflow never overwrites the imported baseline');
  await f.store.update(data => { data.workspace.delivery.project.revision++; data.workspace.delivery.project.requirements[0].archived = true; });
  const archived = await f.intelligence.meetingContext({ meeting: f.meeting, user: f.actor('alice'), query: 'Limite secreto' }); assert.equal(archived.context.requirements.some(r => r.id === 'req-secret'), false);
});

test('human requirement attachments respect the document-permission intersection of a meeting', async () => {
  const f = fixture({ restrict: true });
  await f.store.update(data => { data.workspace.delivery = { project: { revision: 1, requirements: [{ id: 'manual-requirement', title: 'Critério de acesso restrito', statement: 'Detalhe humano restrito à documentação privada.', sectorId: '', source: 'manual', sourceHash: null, entityIds: [], sourceRefs: [], artifactIds: ['private-doc'], parentIds: [], method: 'inspection', version: 1, archived: false, reviewers: [], decisions: [], comments: [] }], tests: [], tasks: [], standards: [], history: [] } }; });
  const shared = await f.intelligence.meetingContext({ meeting: f.meeting, user: f.actor('alice'), query: 'Critério de acesso restrito' }); assert.doesNotMatch(JSON.stringify(shared), /Detalhe humano restrito/);
  const alone = await f.intelligence.meetingContext({ meeting: { id: 'alone' }, user: f.actor('alice'), query: 'Critério de acesso restrito' }); assert.equal(alone.context.requirements[0].source, 'user'); assert.match(alone.context.requirements[0].statement, /Detalhe humano restrito/);
});

test('in-flight requirement retrieval is discarded when its human version changes', async () => {
  let release, start;
  const begun = new Promise(resolve => { start = resolve; });
  const f = fixture({ jev: { enabled: true, async classify() { start(); return new Promise(resolve => { release = resolve; }); } } });
  const pending = f.intelligence.meetingContext({ meeting: f.meeting, user: f.actor('alice'), query: 'Limite secreto' }); await begun;
  await f.store.update(data => { data.workspace.delivery = { project: { revision: 1, requirements: [], tests: [], tasks: [], standards: [], history: [] } }; });
  release({ answers: { focus: choice('c0') } }); await assert.rejects(pending, error => error.code === 'PROJECT_CONTEXT_CHANGED');
});
