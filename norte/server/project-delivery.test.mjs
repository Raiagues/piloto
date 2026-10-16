import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from './app.mjs';
import { createValidationProject } from './data-store.mjs';

async function fixture(t, systemAi = { apiKey: '' }) {
  const dir = await mkdtemp(join(tmpdir(), 'norte-delivery-'));
  let app = await buildApp({ logger: false, storeFile: join(dir, 'data.json'), demoAccount: false, ai: { apiKey: '' }, systemAi });
  t.after(async () => { await app.close(); await rm(dir, { recursive: true, force: true }); });
  let n = 0;
  const register = async name => { n++; const response = await app.inject({ method: 'POST', url: '/api/auth/register', remoteAddress: `127.0.0.${n}`, payload: { name, nickname: name.toLowerCase(), email: `${name.toLowerCase()}@example.test`, password: `local-test-password-${name}-long` } }); assert.equal(response.statusCode, 201, response.body); return { ...response.json().user, headers: { cookie: [response.headers['set-cookie']].flat().map(v => v.split(';')[0]).join('; '), 'x-csrf-token': response.json().csrfToken } }; };
  const globalAdmin = await register('GlobalAdmin'), captain = await register('Captain'), reviewer = await register('Reviewer'), member = await register('Member'), outsider = await register('Outsider');
  const req = (actor, method, path, payload) => app.inject({ method, url: '/api' + path, headers: actor.headers, ...(payload !== undefined ? { payload } : {}) });
  const teamResponse = await req(captain, 'POST', '/teams', { name: 'Engineering delivery team' }); assert.equal(teamResponse.statusCode, 201, teamResponse.body); const team = teamResponse.json().team;
  await app.missionStore.update(data => { const t = data.teams.find(v => v.id === team.id); t.memberIds.push(reviewer.memberId, member.memberId); });
  const p = createValidationProject(); p.id = 'delivery-fixture'; p.name = 'Delivery fixture'; p.context.teamId = team.id; p.context.teamName = team.name; p.context.sectors = [{ id: 'avionics', name: 'Avionics' }, { id: 'structure', name: 'Structures' }]; p.context.assignments = [{ memberId: captain.memberId, roleId: 'captain', sectorId: '' }, { memberId: reviewer.memberId, roleId: 'member', sectorId: 'avionics' }, { memberId: member.memberId, roleId: 'member', sectorId: 'structure' }];
  const created = await req(captain, 'POST', '/projects', p); assert.equal(created.statusCode, 201, created.body);
  const route = `/projects/${p.id}/delivery`;
  const read = async (actor = captain) => { const r = await req(actor, 'GET', route); assert.equal(r.statusCode, 200, r.body); return r.json(); };
  const action = async (actor, action, payload = {}, expected = null) => { const state = expected || await read(actor); return req(actor, 'POST', `${route}/actions`, { action, ...payload, expectedRevision: state.revision, expectedBaselineHash: state.baselineHash }); };
  const saveReq = async (actor = captain, item = {}, id) => { const response = await action(actor, 'requirement.save', { ...(id ? { id } : {}), item: { title: 'Power requirement', statement: 'The payload shall consume at most 2 W.', sectorId: 'avionics', method: 'analysis', entityIds: [], sourceRefs: [], artifactIds: [], parentIds: [], ...item } }); assert.equal(response.statusCode, 200, response.body); return response.json().requirements.find(r => id ? r.id === id : r.title === (item.title || 'Power requirement')); };
  return { get app() { return app; }, req, read, action, saveReq, route, projectId: p.id, captain, reviewer, member, outsider, globalAdmin, restart: async () => { await app.close(); app = await buildApp({ logger: false, storeFile: join(dir, 'data.json'), ai: { apiKey: '' }, systemAi }); } };
}

test('delivery is project scoped, CSRF protected, sector limited and persists across restart', async t => {
  const f = await fixture(t);
  for (const actor of [f.globalAdmin, f.outsider]) assert.equal((await f.req(actor, 'GET', f.route)).statusCode, 404);
  const state = await f.read();
  const noCsrf = await f.app.inject({ method: 'POST', url: `/api${f.route}/actions`, headers: { cookie: f.captain.headers.cookie }, payload: { action: 'standards.set', standards: [], expectedRevision: state.revision, expectedBaselineHash: state.baselineHash } }); assert.equal(noCsrf.statusCode, 403);
  const r = await f.saveReq();
  assert.equal((await f.action(f.member, 'requirement.archive', { id: r.id })).statusCode, 403);
  assert.equal((await f.action(f.reviewer, 'requirement.save', { id: r.id, item: { ...r, statement: 'The payload shall consume at most 3 W.' } })).statusCode, 200);
  assert.equal((await f.action(f.reviewer, 'requirement.save', { id: r.id, item: { ...r, sectorId: 'structure' } })).statusCode, 403);
  assert.equal((await f.action(f.captain, 'standards.set', { standards: [] })).statusCode, 200);
  const before = await f.read(); await f.restart(); const after = await f.read(); assert.deepEqual(after.requirements, before.requirements); assert.deepEqual(after.history, before.history);
});

test('versions require independent reviewers, reject outsiders and invalidate approval after edits', async t => {
  const f = await fixture(t), r = await f.saveReq();
  assert.equal((await f.action(f.captain, 'requirement.request_review', { id: r.id, reviewers: [f.captain.id] })).statusCode, 400);
  assert.equal((await f.action(f.captain, 'requirement.request_review', { id: r.id, reviewers: [f.outsider.id] })).statusCode, 400);
  let response = await f.action(f.captain, 'requirement.request_review', { id: r.id, reviewers: [f.reviewer.id] }); assert.equal(response.statusCode, 200, response.body); assert.equal(response.json().requirements[0].status, 'in_review');
  assert.equal((await f.action(f.member, 'requirement.review', { id: r.id, decision: 'approve' })).statusCode, 403);
  response = await f.action(f.reviewer, 'requirement.review', { id: r.id, decision: 'approve', comment: 'Measured criterion is clear.' }); assert.equal(response.statusCode, 200, response.body); assert.equal(response.json().requirements[0].status, 'approved');
  const updated = await f.saveReq(f.captain, { statement: 'The payload shall consume at most 1 W.' }, r.id); assert.equal(updated.version, 2); assert.equal(updated.status, 'draft');
  response = await f.action(f.reviewer, 'requirement.comment', { id: r.id, comment: 'Please verify the new bound.' }); assert.equal(response.statusCode, 200, response.body); assert.equal(response.json().requirements[0].comments.length, 1);
  assert.equal(response.json().history.filter(h => h.action === 'requirement.save').length, 2);
});

test('CAS rejects stale tabs and source changes; extracted IDs remain unique and source change resets review', async t => {
  const f = await fixture(t);
  await f.app.missionStore.update(data => { data.workspace.projects[f.projectId].document.engineeringSystem = { schemaVersion: 1, id: 'system', name: 'Fixture', generatedAt: '2026-01-01', generatedFromRevision: 1, entities: [], relations: [], evidence: [], artifactSources: [], requirements: [{ id: 'EXT-1', title: 'Extracted', statement: 'Measured bound 2 W', subsystemTags: [], reviewTags: [], status: 'unreviewed', sourceRefs: [], relatedEntityIds: [], relatedRelationIds: [], properties: [] }] }; });
  const first = await f.read(); assert.equal(first.requirements[0].method, 'unspecified');
  await f.saveReq(f.captain, { title: 'Corrected extraction', statement: 'Measured bound 3 W' }, 'EXT-1'); assert.equal((await f.read()).requirements.length, 1);
  assert.equal((await f.action(f.captain, 'standards.set', { standards: [] }, first)).statusCode, 409);
  await f.action(f.captain, 'requirement.request_review', { id: 'EXT-1', reviewers: [f.reviewer.id] }); await f.action(f.reviewer, 'requirement.review', { id: 'EXT-1', decision: 'approve' });
  const approved = await f.read(); assert.equal(approved.requirements[0].status, 'approved');
  await f.app.missionStore.update(data => { data.workspace.projects[f.projectId].document.engineeringSystem.requirements[0].statement = 'Changed source 4 W'; });
  assert.equal((await f.action(f.captain, 'standards.set', { standards: [] }, approved)).statusCode, 409);
  const changed = await f.read(); assert.equal(changed.requirements.length, 1); assert.equal(changed.requirements[0].status, 'draft'); assert.equal(changed.requirements[0].sourceChanged, true); assert.equal(changed.requirements[0].statement, 'Measured bound 3 W');
});

test('verification requires evidence, records immutable runs and invalidates stale results', async t => {
  const f = await fixture(t), r = await f.saveReq();
  const plan = { title: 'Power analysis', method: 'analysis', procedure: 'Measure current and voltage.', acceptanceCriteria: 'P <= 2 W', requirementIds: [r.id], sectorId: 'avionics', ownerId: f.reviewer.id };
  let response = await f.action(f.captain, 'test.save', { item: plan }); assert.equal(response.statusCode, 200, response.body); const id = response.json().tests[0].id;
  assert.equal((await f.action(f.captain, 'test.result', { id, item: { outcome: 'passed', result: '1.8 W', artifactIds: [] } })).statusCode, 400);
  assert.equal((await f.action(f.captain, 'test.result', { id, item: { outcome: 'passed', result: '1.8 W', evidenceUrl: 'javascript:alert(1)' } })).statusCode, 400);
  response = await f.action(f.reviewer, 'test.result', { id, item: { outcome: 'passed', result: '1.8 W ± 0.02 W', evidenceUrl: 'https://example.test/report.pdf' } }); assert.equal(response.statusCode, 200, response.body); assert.equal(response.json().tests[0].status, 'passed'); assert.equal(response.json().requirements[0].verificationStatus, 'passed');
  await f.action(f.reviewer, 'requirement.comment', { id: r.id, comment: 'Results discussed.' }); assert.equal((await f.read()).tests[0].status, 'passed', 'comments do not invalidate measured results');
  await f.saveReq(f.captain, { statement: 'The payload shall consume at most 1 W.' }, r.id); const changed = await f.read(); assert.equal(changed.tests[0].status, 'stale'); assert.equal(changed.tests[0].runs.length, 1); assert.equal(changed.requirements[0].verificationStatus, 'pending');
});

test('all linked verifications must pass; another sector cannot manufacture passing coverage', async t => {
  const f = await fixture(t), r = await f.saveReq();
  const item = { title: 'Power analysis', method: 'analysis', procedure: 'Measure', acceptanceCriteria: '2 W', requirementIds: [r.id], sectorId: 'avionics' };
  assert.equal((await f.action(f.member, 'test.save', { item: { ...item, sectorId: 'structure' } })).statusCode, 403);
  let response = await f.action(f.captain, 'test.save', { item }); const id = response.json().tests[0].id;
  await f.action(f.captain, 'test.result', { id, item: { outcome: 'passed', result: '1 W', evidenceUrl: 'https://example.test/report' } });
  response = await f.action(f.captain, 'test.save', { item: { ...item, title: 'Independent verification' } }); assert.equal(response.json().requirements[0].verificationStatus, 'pending');
});

test('schedule rejects cycles, invalid dates and premature completion, preserves manual dates and archived history', async t => {
  const f = await fixture(t);
  let response = await f.action(f.captain, 'task.save', { item: { title: 'Define interfaces', startDate: '2026-02-30' } }); assert.equal(response.statusCode, 400);
  response = await f.action(f.captain, 'task.save', { item: { title: 'Define interfaces', startDate: '2026-01-01', dueDate: '2026-01-10' } }); assert.equal(response.statusCode, 200, response.body); const a = response.json().tasks[0];
  response = await f.action(f.captain, 'task.save', { item: { title: 'Build harness', dependencyIds: [a.id], startDate: '2026-01-05', dueDate: '2026-01-15' } }); assert.equal(response.statusCode, 200, response.body); const b = response.json().tasks.find(row => row.id !== a.id); assert.deepEqual(b.dateConflicts, [a.id]);
  assert.equal((await f.action(f.captain, 'task.save', { id: a.id, item: { ...a, dependencyIds: [b.id] } })).statusCode, 400);
  assert.equal((await f.action(f.captain, 'task.save', { id: b.id, item: { ...b, status: 'done' } })).statusCode, 409);
  assert.equal((await f.action(f.captain, 'task.archive', { id: a.id })).statusCode, 409);
  assert.equal((await f.action(f.captain, 'schedule.template', { profile: 'nasa', startDate: '2026-01-01' })).statusCode, 409);
  await f.action(f.captain, 'task.save', { id: a.id, item: { ...a, status: 'done' } }); response = await f.action(f.captain, 'task.save', { id: b.id, item: { ...b, status: 'done' } }); assert.equal(response.statusCode, 200, response.body);
  await f.action(f.captain, 'task.archive', { id: b.id }); await f.action(f.captain, 'task.archive', { id: a.id }); response = await f.action(f.captain, 'schedule.template', { profile: 'custom', startDate: '2026-05-01' }); assert.equal(response.statusCode, 200, response.body); assert.equal(response.json().tasks.length, 4); assert.equal(response.json().standards.length, 0);
});

test('requirement derivations reject cycles and archive keeps audit rather than deleting evidence', async t => {
  const f = await fixture(t), a = await f.saveReq(), b = await f.saveReq(f.captain, { title: 'Derived requirement', parentIds: [a.id] });
  assert.equal((await f.action(f.captain, 'requirement.save', { id: a.id, item: { ...a, parentIds: [b.id] } })).statusCode, 400);
  assert.equal((await f.action(f.captain, 'requirement.archive', { id: a.id })).statusCode, 409);
  await f.action(f.captain, 'requirement.archive', { id: b.id }); const response = await f.action(f.captain, 'requirement.archive', { id: a.id }); assert.equal(response.statusCode, 200, response.body); assert.equal(response.json().requirements.length, 2); assert.ok(response.json().requirements.every(r => r.archived));
});

test('the 29 source references are optional, individually selectable and never synthesize requirements', async t => {
  const f = await fixture(t), before = await f.read();
  assert.equal(before.standardOptions.length, 29); assert.equal(new Set(before.standardOptions.map(s => s.id)).size, 29);
  for (const option of before.standardOptions) { assert.equal(new URL(option.url).protocol, 'https:'); assert.ok(option.edition); }
  assert.equal((await f.action(f.reviewer, 'standards.set', { standards: ['ecss-req'] })).statusCode, 403);
  let response = await f.action(f.captain, 'standards.set', { standards: ['ecss-req', 'nasa-hb', 'iso-29148'] }); assert.equal(response.statusCode, 200, response.body); assert.deepEqual(response.json().standards, ['ecss-req', 'nasa-hb', 'iso-29148']); assert.equal(response.json().requirements.length, 0);
  response = await f.action(f.captain, 'standards.set', { standards: [] }); assert.equal(response.statusCode, 409); assert.equal(response.json().error,'STANDARDS_REVIEW_REQUIRED');
  response=await f.action(f.captain,'standards.propose',{standards:[],reason:'The project uses its own criteria.',reviewers:[f.reviewer.id]});assert.equal(response.statusCode,200,response.body);const proposal=response.json().standardsProposals[0];
  assert.equal((await f.action(f.reviewer,'standards.review',{id:proposal.id,decision:'approve'})).statusCode,200);response=await f.action(f.captain,'standards.merge',{id:proposal.id});assert.equal(response.statusCode,200,response.body);assert.deepEqual(response.json().standards,[]);assert.equal(response.json().tasks.length,0);
  assert.equal((await f.action(f.captain, 'standards.set', { standards: ['invented-standard'] })).statusCode, 400);
});

test('changing a numerical source condition or its cited excerpt invalidates review even when the wording is unchanged', async t => {
  const f = await fixture(t);
  await f.app.missionStore.update(data => { data.workspace.projects[f.projectId].document.engineeringSystem = { schemaVersion: 1, id: 'system', name: 'Fixture', generatedAt: '2026-01-01', generatedFromRevision: 1, entities: [], relations: [], evidence: [{ id: 'e1', artifactId: 'doc', artifactLabel: 'Test source', excerpt: 'Limit 2 W', kind: 'fact' }], artifactSources: [], requirements: [{ id: 'EXT-NUM', title: 'Extracted', statement: 'Power limit', subsystemTags: [], reviewTags: [], status: 'unreviewed', sourceRefs: ['e1'], relatedEntityIds: [], relatedRelationIds: [], properties: [{ key: 'maximum_power', name: 'Power limit', value: 2, unit: 'W', source: 'documented', evidenceRefs: ['e1'] }] }] }; });
  await f.action(f.captain, 'requirement.request_review', { id: 'EXT-NUM', reviewers: [f.reviewer.id] }); await f.action(f.reviewer, 'requirement.review', { id: 'EXT-NUM', decision: 'approve' });
  assert.equal((await f.read()).requirements[0].status, 'approved');
  await f.app.missionStore.update(data => { data.workspace.projects[f.projectId].document.engineeringSystem.requirements[0].properties[0].value = 3; });
  const changed = await f.read(); assert.equal(changed.requirements[0].status, 'draft'); assert.equal(changed.requirements[0].sourceChanged, true);
  const hashBefore = changed.requirements[0].contentHash;
  await f.app.missionStore.update(data => { data.workspace.projects[f.projectId].document.engineeringSystem.evidence[0].excerpt = 'Limit corrected to 3 W'; });
  assert.notEqual((await f.read()).requirements[0].contentHash, hashBefore);
});

test('change proposals preserve baseline, require independent approval, rebase and merge one current version', async t=>{
 const f=await fixture(t),r=await f.saveReq();
 const item={requirementId:r.id,statement:'The payload shall consume at most 3 W.',reason:'Update the allocated power budget; verify the new bound.',reviewers:[f.reviewer.id]};
 assert.equal((await f.action(f.captain,'proposal.save',{item:{...item,reviewers:[f.captain.id]}})).statusCode,400);
 assert.equal((await f.action(f.member,'proposal.save',{item})).statusCode,403);
 let response=await f.action(f.captain,'proposal.save',{item});assert.equal(response.statusCode,200,response.body);const id=response.json().proposals[0].id;
 assert.equal(response.json().requirements[0].statement,r.statement);
 assert.equal((await f.action(f.captain,'proposal.review',{id,decision:'approve'})).statusCode,403);
 assert.equal((await f.action(f.captain,'proposal.merge',{id})).statusCode,409);
 response=await f.action(f.reviewer,'proposal.review',{id,decision:'request_changes',comment:'Clarify condition.'});assert.equal(response.json().proposals[0].status,'changes_requested');
 response=await f.action(f.captain,'proposal.save',{id,item:{...item,statement:item.statement+' During acquisition.'}});assert.equal(response.json().proposals[0].decisions.length,0);
 await f.action(f.reviewer,'proposal.review',{id,decision:'approve'});
 await f.saveReq(f.captain,{statement:'The payload shall consume at most 1 W.'},r.id);
 assert.equal((await f.action(f.captain,'proposal.merge',{id})).statusCode,409);
 response=await f.action(f.captain,'proposal.save',{id,item});assert.equal(response.statusCode,200,response.body);assert.equal(response.json().proposals[0].decisions.length,0);
 await f.action(f.reviewer,'proposal.review',{id,decision:'approve'});
 const snapshot=await f.read();response=await f.action(f.captain,'proposal.merge',{id},snapshot);assert.equal(response.statusCode,200,response.body);assert.equal(response.json().requirements[0].statement,item.statement);assert.equal(response.json().requirements[0].version,3);assert.equal(response.json().requirements[0].status,'approved');assert.equal(response.json().proposals[0].status,'merged');
 assert.equal((await f.action(f.captain,'proposal.merge',{id},snapshot)).statusCode,409);
 await f.restart();assert.equal((await f.read()).proposals[0].status,'merged');
});

test('lifecycle switches document packages, preserves manual dates and exports scoped versioned drafts', async t=>{
 const f=await fixture(t);await f.saveReq();
 const configure=profile=>f.action(f.captain,'lifecycle.configure',{profile,startDate:'2026-11-02'});
 assert.equal((await f.action(f.member,'lifecycle.configure',{profile:'nasa',startDate:'2026-11-02'})).statusCode,403);
 let response=await configure('nasa');assert.equal(response.statusCode,200,response.body);const initial=response.json(),srr=initial.tasks.find(t=>t.reviewCode==='SRR');assert.equal(initial.lifecycleRanges.length,7);assert.deepEqual(initial.standards,[],'planning template must not silently change the reviewed standards baseline');assert(srr.documentOptions.some(d=>d.id==='REQ'));
 response=await f.action(f.captain,'document.prepare',{taskId:srr.id,templateId:'REQ'});assert.equal(response.statusCode,200,response.body);const doc=response.json().documents[0];assert.match(doc.body,/RASCUNHO/);assert.match(doc.body,/2 W/);assert.match(doc.reference.url,/nasa/);
 assert.equal((await f.action(f.member,'document.prepare',{taskId:srr.id,templateId:'REQ'})).statusCode,403);
 assert.equal((await f.req(f.outsider,'GET',`${f.route}/documents/${doc.id}/export?format=pdf`)).statusCode,404);
 const pdf=await f.req(f.captain,'GET',`${f.route}/documents/${doc.id}/export?format=pdf`);assert.equal(pdf.statusCode,200,pdf.body);assert.equal(pdf.rawPayload.subarray(0,4).toString(),'%PDF');
 response=await f.action(f.captain,'document.save',{id:doc.id,item:{version:1,body:doc.body+'\nTeam correction.'}});assert.equal(response.statusCode,200,response.body);assert.equal(response.json().documents[0].version,2);
 assert.equal((await f.action(f.captain,'document.save',{id:doc.id,item:{version:1,body:'stale text'}})).statusCode,409);
 await f.action(f.captain,'task.save',{id:srr.id,item:{...srr,startDate:'2027-04-01',dueDate:'2027-04-02'}});
 response=await configure('ecss');assert.equal(response.json().lifecycle.profile,'ecss');assert.deepEqual(response.json().standards,[]);assert(response.json().tasks.every(t=>t.lifecycleProfile==='ecss'));assert(response.json().tasks.some(t=>t.documentOptions.some(d=>d.reference?.url.includes('ecss.nl'))));
 response=await configure('nasa');assert.equal(response.json().tasks.find(t=>t.id===srr.id).dueDate,'2027-04-02');assert.equal(response.json().documents[0].version,2);
 response=await configure('none');assert.equal(response.statusCode,200,response.body);assert.equal(response.json().tasks.length,0);assert.equal(response.json().standards.length,0);assert.equal(response.json().requirements.length,1);assert.equal(response.json().documents.length,1);
});

test('lifecycle preview metadata preserves hidden manual reviews, current evidence status and project permissions', async t => {
  const f = await fixture(t), requirement = await f.saveReq();
  assert.equal((await f.action(f.captain, 'requirement.request_review', { id: requirement.id, reviewers: [f.reviewer.id] })).statusCode, 200);
  assert.equal((await f.action(f.reviewer, 'requirement.review', { id: requirement.id, decision: 'approve' })).statusCode, 200);
  const configure = (profile, selectedReviews) => f.action(f.captain, 'lifecycle.configure', {
    profile, startDate: '2026-11-02', ...(selectedReviews ? { selectedReviews } : {}),
  });
  let response = await configure('nasa', ['MCR', 'SRR']);
  assert.equal(response.statusCode, 200, response.body);
  const initial = response.json(), srr = initial.tasks.find(task => task.reviewCode === 'SRR'), mcr = initial.tasks.find(task => task.reviewCode === 'MCR');
  response = await f.action(f.captain, 'task.save', { id: srr.id, item: {
    ...srr, title: 'Private reviewed avionics milestone', sectorId: 'avionics', ownerId: f.reviewer.id,
    startDate: '2027-04-01', dueDate: '2027-04-03', status: 'done', requirementIds: [requirement.id],
  } });
  assert.equal(response.statusCode, 200, response.body);
  response = await f.action(f.captain, 'document.prepare', { taskId: srr.id, templateId: 'REQ' });
  assert.equal(response.statusCode, 200, response.body);
  const document = response.json().documents[0];
  assert.equal((await f.action(f.captain, 'task.archive', { id: mcr.id })).statusCode, 200);

  response = await configure('nasa', []);
  assert.equal(response.statusCode, 200, response.body);
  const excluded = response.json();
  assert(!excluded.tasks.some(task => task.id === srr.id));
  const metadata = excluded.lifecycleTasks.find(task => task.id === srr.id);
  assert.equal(metadata.manual, true);
  assert.equal(metadata.excluded, true);
  assert.equal(metadata.startDate, '2027-04-01');
  assert.equal(metadata.dueDate, '2027-04-03');
  assert.equal(metadata.status, 'done');
  assert.equal(metadata.canEdit, true);
  assert.deepEqual(metadata.requirementIds, [requirement.id]);
  assert.equal(metadata.ownerId, f.reviewer.id);
  assert.deepEqual(excluded.documents[0], document);
  assert.equal(excluded.lifecycleTasks.find(task => task.id === mcr.id).archived, true);

  response = await configure('ecss');
  assert.equal(response.statusCode, 200, response.body);
  const switched = response.json();
  assert(switched.tasks.every(task => task.lifecycleProfile === 'ecss'));
  assert.deepEqual(switched.lifecycleTasks.find(task => task.id === srr.id), metadata);
  assert.equal((await f.read(f.member)).lifecycleTasks.find(task => task.id === srr.id).canEdit, false);
  assert.equal((await f.read(f.reviewer)).lifecycleTasks.find(task => task.id === srr.id).canEdit, true);
  for (const actor of [f.outsider, f.globalAdmin]) {
    const denied = await f.req(actor, 'GET', f.route);
    assert.equal(denied.statusCode, 404);
    assert(!denied.body.includes(srr.id));
    assert(!denied.body.includes(metadata.title));
  }

  await f.saveReq(f.captain, { statement: 'The payload shall consume at most 1 W.' }, requirement.id);
  const stale = (await f.read()).lifecycleTasks.find(task => task.id === srr.id);
  assert.equal(stale.status, 'blocked', 'a hidden completed review must expose the same current evidence status as a visible review');
  assert.equal(stale.reviewNeedsRevalidation, true);
  response = await configure('nasa', ['SRR']);
  assert.equal(response.statusCode, 200, response.body);
  const restored = response.json(), visible = restored.tasks.find(task => task.id === srr.id);
  assert.equal(visible.excluded, false);
  assert.equal(visible.dueDate, '2027-04-03');
  assert.equal(visible.title, metadata.title);
  assert.equal(visible.status, 'blocked');
  assert.equal(visible.reviewNeedsRevalidation, true);
  assert.deepEqual(visible, restored.lifecycleTasks.find(task => task.id === srr.id));
  assert.equal(restored.lifecycleTasks.filter(task => task.id === srr.id).length, 1);
  assert.deepEqual(restored.documents[0], document);
  await f.restart();
  const restarted = await f.read();
  assert.deepEqual(restarted.lifecycleTasks, restored.lifecycleTasks);
  assert.deepEqual(restarted.documents, restored.documents);
});

test('demo lifecycle seeding is idempotent, preserves documentary requirements and never fabricates execution', async t=>{
 const {seedDeliveryDemo}=await import('./delivery-demo.mjs');const f=await fixture(t);await f.saveReq();
 const data=f.app.missionStore.read(),source=structuredClone(data.workspace.projects[f.projectId].document),before=structuredClone(data.workspace.delivery[f.projectId].requirements);
 const audit=seedDeliveryDemo(data,f.projectId,f.captain.id);assert(audit.createdTasks>10);assert(audit.createdDocuments>0);assert.equal(audit.createdTests,1);
 const snapshot=structuredClone(data);assert.equal(seedDeliveryDemo(data,f.projectId,f.captain.id).alreadySeeded,true);assert.deepEqual(data,snapshot);assert.deepEqual(data.workspace.projects[f.projectId].document,source);assert.deepEqual(data.workspace.delivery[f.projectId].requirements,before);assert(data.workspace.delivery[f.projectId].tests.every(t=>t.runs.length===0));assert(data.workspace.delivery[f.projectId].tasks.every(t=>t.status==='planned'));assert(data.workspace.delivery[f.projectId].documents.every(d=>d.status==='draft'&&/datas fictícias/.test(d.body)));
});

test('assisted review validates literal findings, caches cost and rejects stale analysis after concurrent edits', async t=>{
 let count=0, release, started;const begin=new Promise(r=>{started=r;});let delayed=false;
 const finding={ruleId:'nasa-verifiable',severity:'warning',title:'Definir critério',explanation:'O termo não define uma observação mensurável.',suggestion:'Defina uma condição e um limite com fonte.',start:31,end:42,affectedText:'rapidamente'};
 const statement='O sistema deve enviar os dados rapidamente.';finding.start=statement.indexOf('rapidamente');finding.end=finding.start+11;
 const f=await fixture(t,{apiKey:'local-test-key',fetch:async()=>{count++;if(delayed){started();await new Promise(r=>{release=r;});}return new Response(JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({findings:[finding]})}]}}]}),{status:200});}});
 const r=await f.saveReq(f.captain,{statement});await f.action(f.captain,'standards.set',{standards:['nasa-hb']});
 const url=`${f.route}/requirements/${r.id}/analyze`;
 assert.equal((await f.req(f.member,'POST',url,{})).statusCode,403);assert.equal(count,0);
 let response=await f.req(f.captain,'POST',url,{});assert.equal(response.statusCode,200,response.body);assert.equal(response.json().analysis.findings[0].reference.section,'Apêndice C.4 · Verifiability/Testability');assert.equal(response.json().cached,false);assert.equal(count,1);
 response=await f.req(f.captain,'POST',url,{});assert.equal(response.json().cached,true);assert.equal(count,1);
 await f.saveReq(f.captain,{statement:statement+' Durante a missão.'},r.id);delayed=true;
 const pending=f.req(f.captain,'POST',url,{});await begin;
 await f.saveReq(f.captain,{statement:'O sistema deve enviar dados em até 2 s.'},r.id);release();response=await pending;assert.equal(response.statusCode,409,response.body);assert.match(response.body,/mudaram durante a análise/);assert.equal((await f.read()).requirements[0].analysis.engine,'checklist');assert.equal(count,2);
});

test('review milestones cannot close with unapproved linked versions or unexecuted evidence',async t=>{
 const f=await fixture(t),r=await f.saveReq();
 let response=await f.action(f.captain,'test.save',{item:{title:'Power budget check',method:'analysis',procedure:'Review measured power.',acceptanceCriteria:'Power <= 2 W',requirementIds:[r.id],sectorId:'avionics'}});const verification=response.json().tests[0];
 const task={title:'Readiness review',kind:'review',requirementIds:[r.id],testIds:[verification.id],status:'done'};
 assert.equal((await f.action(f.captain,'task.save',{item:task})).statusCode,409);
 await f.action(f.captain,'requirement.request_review',{id:r.id,reviewers:[f.reviewer.id]});await f.action(f.reviewer,'requirement.review',{id:r.id,decision:'approve'});
 assert.equal((await f.action(f.captain,'task.save',{item:task})).statusCode,409);
 await f.action(f.captain,'test.result',{id:verification.id,item:{outcome:'passed',result:'1.8 W measured in fixture.',evidenceUrl:'https://example.test/power-report'}});
 response=await f.action(f.captain,'task.save',{item:task});assert.equal(response.statusCode,200,response.body);assert.equal(response.json().tasks[0].status,'done'); const completed=response.json().tasks[0];
 await f.saveReq(f.captain,{statement:'The payload shall consume at most 1 W.'},r.id);const changed=await f.read();assert.equal(changed.tasks[0].status,'blocked');assert.equal(changed.tasks[0].reviewNeedsRevalidation,true);assert.equal((await f.action(f.captain,'task.save',{item:{title:'Dependent handover',status:'done',dependencyIds:[completed.id]}})).statusCode,409);
});

test('configuration change invalidates test evidence even if requirement wording and test plan are unchanged',async t=>{
 const f=await fixture(t),r=await f.saveReq();let response=await f.action(f.captain,'test.save',{item:{title:'Current design power',method:'analysis',procedure:'Measure current design.',acceptanceCriteria:'At most 2 W',requirementIds:[r.id],sectorId:'avionics'}});const id=response.json().tests[0].id;
 await f.action(f.captain,'test.result',{id,item:{outcome:'passed',result:'1.8 W',evidenceUrl:'https://example.test/report'}});assert.equal((await f.read()).tests[0].status,'passed');
 await f.app.missionStore.update(data=>{data.workspace.projects[f.projectId].document.engineeringSystem={entities:[{id:'changed-component',name:'New radio',properties:[{key:'power',value:4,unit:'W'}]}],relations:[],evidence:[],requirements:[]};});
 const state=await f.read();assert.equal(state.tests[0].status,'stale');assert.equal(state.requirements[0].verificationStatus,'pending');assert.equal(state.tests[0].runs.length,1);
});


test('editable lifecycle phases preserve removed phase work and dates, reject stale drag, and enforce leadership and sector ACL',async t=>{
 const f=await fixture(t);let response=await f.action(f.captain,'lifecycle.configure',{profile:'nasa',startDate:'2026-11-02'});assert.equal(response.statusCode,200,response.body);
 const initial=response.json(),review=initial.tasks.find(t=>t.reviewCode==='SRR'),removedPhase=initial.lifecycleRanges.find(p=>p.id===review.phaseId);
 response=await f.action(f.captain,'document.prepare',{taskId:review.id,templateId:'REQ'});assert.equal(response.statusCode,200,response.body);const document=response.json().documents[0];
 assert.equal((await f.action(f.member,'task.reschedule',{id:review.id,dueDate:'2027-03-15'})).statusCode,403);
 const stale=await f.read();response=await f.action(f.captain,'task.reschedule',{id:review.id,dueDate:'2027-03-15'});assert.equal(response.statusCode,200,response.body);assert.equal(response.json().tasks.find(t=>t.id===review.id).dueDate,'2027-03-15');
 assert.equal((await f.action(f.captain,'task.reschedule',{id:review.id,dueDate:'2027-03-20'},stale)).statusCode,409);
 response=await f.action(f.captain,'task.save',{item:{title:'Manual phase activity',phaseId:removedPhase.id,phase:removedPhase.name,startDate:'2027-02-01',dueDate:'2027-02-02',sectorId:'avionics'}});assert.equal(response.statusCode,200,response.body);const manualId=response.json().tasks.find(t=>t.title==='Manual phase activity').id;
 const phases=initial.lifecycleRanges.filter(p=>p.id!==removedPhase.id).concat({id:'custom-integration',code:'X',name:'Additional integration',start:'2027-02-01',end:'2027-02-20'});
 const config={profile:'nasa',startDate:'2026-11-02',phases,expectedLifecycleVersion:initial.lifecycle.version};response=await f.action(f.captain,'lifecycle.configure',config);assert.equal(response.statusCode,200,response.body);let state=response.json();assert.equal(state.lifecycleRanges.length,7);assert(state.lifecycleRanges.some(p=>p.id==='custom-integration'));assert.equal(state.tasks.find(t=>t.id===review.id).phaseId,'');assert.equal(state.tasks.find(t=>t.id===review.id).dueDate,'2027-03-15');assert.deepEqual(state.documents[0],document);assert.equal(state.tasks.find(t=>t.id===manualId).phaseId,'');assert.equal(state.tasks.find(t=>t.id===manualId).dueDate,'2027-02-02');
 assert.equal((await f.action(f.captain,'lifecycle.configure',config)).json().error,'LIFECYCLE_CHANGED','old editor draft must not overwrite newer phases even with refreshed delivery CAS');
 config.expectedLifecycleVersion=state.lifecycle.version;
 response=await f.action(f.captain,'lifecycle.configure',config);assert.equal(response.statusCode,200,response.body);state=response.json();assert.equal(state.tasks.find(t=>t.id===review.id).phaseId,'','unassigned tasks must not migrate into a different phase on the next edit');config.expectedLifecycleVersion=state.lifecycle.version;
 assert.equal((await f.action(f.member,'lifecycle.configure',config)).statusCode,403);
 assert.equal((await f.action(f.captain,'lifecycle.configure',{...config,phases:[...phases,phases[0]]})).statusCode,400);
 assert.equal((await f.action(f.captain,'lifecycle.configure',{...config,phases:[{...phases[0],end:'2020-01-01'}]})).statusCode,400);
 assert.equal((await f.action(f.captain,'lifecycle.configure',{...config,phases:[null]})).statusCode,400);
 await f.restart();state=await f.read();assert.equal(state.tasks.find(t=>t.id===review.id).dueDate,'2027-03-15');assert.equal(state.documents[0].id,document.id);
});

test('standards changes require independent current reviewers, invalidate wording reviews and reject stale proposals',async t=>{
 const f=await fixture(t),r=await f.saveReq();await f.action(f.captain,'standards.set',{standards:[]});
 await f.action(f.captain,'requirement.request_review',{id:r.id,reviewers:[f.reviewer.id]});await f.action(f.reviewer,'requirement.review',{id:r.id,decision:'approve'});assert.equal((await f.read()).requirements[0].status,'approved');
 const payload={standards:['ecss-req'],reason:'Adopt a tailored ECSS requirements baseline.',reviewers:[f.reviewer.id]};
 assert.equal((await f.action(f.member,'standards.propose',payload)).statusCode,403);assert.equal((await f.action(f.captain,'standards.propose',{...payload,reviewers:[f.captain.id]})).statusCode,400);assert.equal((await f.action(f.captain,'standards.propose',{...payload,reviewers:[f.outsider.id]})).statusCode,400);
 let response=await f.action(f.captain,'standards.propose',payload);assert.equal(response.statusCode,200,response.body);const id=response.json().standardsProposals[0].id;
 response=await f.action(f.captain,'standards.propose',{...payload,standards:['nasa-hb']});const competing=response.json().standardsProposals[1].id;
 assert.equal((await f.action(f.captain,'standards.review',{id,decision:'approve'})).statusCode,403);assert.equal((await f.action(f.member,'standards.review',{id,decision:'approve'})).statusCode,403);assert.equal((await f.action(f.captain,'standards.merge',{id})).statusCode,409);
 response=await f.action(f.reviewer,'standards.review',{id,decision:'approve'});assert.equal(response.statusCode,200,response.body);
 await f.app.missionStore.update(data=>{data.teams.find(team=>team.memberIds.includes(f.reviewer.memberId)).memberIds=data.teams.find(team=>team.memberIds.includes(f.reviewer.memberId)).memberIds.filter(id=>id!==f.reviewer.memberId);data.workspace.projects[f.projectId].document.context.assignments=data.workspace.projects[f.projectId].document.context.assignments.filter(a=>a.memberId!==f.reviewer.memberId);});
 assert.equal((await f.action(f.captain,'standards.merge',{id})).statusCode,409,'a revoked reviewer cannot approve a merge');
 await f.app.missionStore.update(data=>{data.teams.find(team=>team.memberIds.includes(f.captain.memberId)).memberIds.push(f.reviewer.memberId);});
 response=await f.action(f.captain,'standards.merge',{id});assert.equal(response.statusCode,200,response.body);assert.deepEqual(response.json().standards,['ecss-req']);assert.equal(response.json().requirements[0].status,'draft');
 assert.equal((await f.action(f.reviewer,'standards.review',{id:competing,decision:'approve'})).json().error,'PROPOSAL_STALE');
 assert.equal((await f.action(f.captain,'standards.set',{standards:[]})).json().error,'STANDARDS_REVIEW_REQUIRED');
 await f.action(f.captain,'lifecycle.configure',{profile:'nasa',startDate:'2027-01-01'});assert.deepEqual((await f.read()).standards,['ecss-req']);await f.restart();assert.deepEqual((await f.read()).standards,['ecss-req']);
});
