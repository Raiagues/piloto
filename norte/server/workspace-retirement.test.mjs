import test from 'node:test';
import assert from 'node:assert/strict';
import { applyWorkspaceRetirement, inventoryWorkspaceRetirement, planWorkspaceRetirement } from './workspace-retirement.mjs';

const options = { keepProject: 'lyle', removeProjectIds: ['satellite', 'demo-project'] };
function fixture() {
  const project = (id, teamId, createdBy) => ({ revision: 3, createdBy, document: { id, creatorId: createdBy, context: { teamId, assignments: [], projectArtifactIds: [id + '-doc'] } } });
  return {
    schemaVersion: 10, updatedAt: 'old',
    users: [{ id: 'admin', memberId: 'ma', accessRole: 'owner_admin', passwordHash: 'KEEP-SECRET', name: 'PRIVATE-NAME', email: 'private@invalid.local' }, { id: 'real', memberId: 'mr', passwordHash: 'KEEP-REAL' }, { id: 'demo', memberId: 'md', isDemoAccount: true }, { id: 'demo-q-ana-user', memberId: 'mf', passwordHash: 'demo-account-without-password', email: 'ana@demo.norte.invalid' }],
    members: [{ id: 'ma', accountId: 'admin' }, { id: 'mr', accountId: 'real' }, { id: 'md', accountId: 'demo' }, { id: 'mf', accountId: 'demo-q-ana-user' }],
    teams: [{ id: 'lyle-team', createdBy: 'real', captainMemberId: 'mr', adminMemberIds: [], memberIds: ['mr'], artifactIds: [] }, { id: 'real-team', createdBy: 'admin', captainMemberId: 'ma', memberIds: ['ma'], artifactIds: [] }, { id: 'demo-team', createdBy: 'demo', captainMemberId: 'md', memberIds: ['md', 'mf'], demoSandboxId: 'sandbox' }, { id: 'empty-real-team', createdBy: 'admin', memberIds: [] }],
    artifacts: [{ id: 'lyle-doc', scope: 'project', ownerId: 'lyle', documentText: 'PRIVATE-LYLE-TEXT' }, { id: 'satellite-doc', scope: 'project', ownerId: 'satellite', documentText: 'PRIVATE-OLD-TEXT' }, { id: 'demo-project-doc', scope: 'project', ownerId: 'demo-project' }],
    workspace: { projects: { lyle: project('lyle', 'lyle-team', 'real'), satellite: project('satellite', 'real-team', 'admin'), 'demo-project': project('demo-project', 'demo-team', 'demo') }, project: project('satellite', 'real-team', 'admin'), delivery: { lyle: { revision: 9, requirements: [{ id: 'L1', sourceArtifactId: 'lyle-doc' }], approval: { userId: 'real' } }, satellite: { revision: 10 }, 'demo-project': {} }, labs: { huge: 'OLD-BODY' }, ideaStarterCache: {} },
    sessions: [{ id: 'keep-session', userId: 'real', token: 'SESSION-SECRET' }, { id: 'demo-session', userId: 'demo' }],
    meetings: { independent: { id: 'independent', ownerId: 'admin', participantIds: ['real'], presence: { admin: 'old' }, transcript: 'PRIVATE-SPEECH' }, 'old-project': { id: 'old-project', ownerId: 'admin', projectId: 'satellite' }, 'old-demo': { id: 'old-demo', ownerId: 'demo' } },
    meetingInvitations: [{ id: 'i-keep', meetingId: 'independent', recipientUserId: 'real' }, { id: 'i-old', meetingId: 'old-project', recipientUserId: 'real' }],
    platform: { conversations: { mixed: { id: 'mixed', createdBy: 'admin', participantIds: ['admin', 'demo'], messages: [{ senderId: 'admin', body: 'PRIVATE-REAL-CHAT' }] }, old: { id: 'old', createdBy: 'demo', participantIds: ['demo'], messages: [] }, scoped: { id: 'scoped', createdBy: 'admin', projectId: 'satellite', messages: [] } }, catalog: { retired: true } },
    projectLearning: { old: {} }, teamStats: { old: {} },
    telemetry: { sessions: { kept: { userId: 'real' }, old: { userId: 'demo' } }, events: [{ userId: 'real', name: 'page_view' }, { userId: 'demo', name: 'page_view' }] }, authBootstrap: { completed: true }
  };
}
const apply = (data, choices = options) => applyWorkspaceRetirement(data, { ...choices, expectedFingerprint: planWorkspaceRetirement(data, choices).fingerprint });

test('inventory and plan disclose identifiers and counts without user content', () => {
  const data = fixture(), before = JSON.stringify(data), inventory = inventoryWorkspaceRetirement(data), plan = planWorkspaceRetirement(data, options);
  assert.equal(JSON.stringify(data), before);
  for (const output of [inventory, plan]) for (const secret of ['KEEP-SECRET', 'KEEP-REAL', 'PRIVATE-NAME', 'private@invalid.local', 'PRIVATE-LYLE-TEXT', 'PRIVATE-OLD-TEXT', 'PRIVATE-SPEECH', 'PRIVATE-REAL-CHAT', 'SESSION-SECRET']) assert(!JSON.stringify(output).includes(secret));
  assert.deepEqual(plan.remove.projects, ['demo-project', 'satellite']);
  assert.deepEqual(plan.remove.users, ['demo', 'demo-q-ana-user']);
  assert.deepEqual(plan.remove.teams, ['demo-team']);
  assert.deepEqual(plan.remove.meetings, ['old-demo', 'old-project']);
  assert.equal(inventory.teams.find(team => team.id === 'real-team').realMembers, 1);
  assert.equal(plan.blockedBy.length, 0);
});

test('retirement preserves real accounts, LYLE revisions and ACL, and independent meetings byte-for-byte', () => {
  const before = fixture(), { data, plan } = apply(before);
  assert.equal(JSON.stringify(data.users), JSON.stringify(before.users.slice(0, 2)));
  assert.equal(JSON.stringify(data.workspace.projects.lyle), JSON.stringify(before.workspace.projects.lyle));
  assert.equal(JSON.stringify(data.workspace.delivery.lyle), JSON.stringify(before.workspace.delivery.lyle));
  assert.equal(JSON.stringify(data.teams.find(team => team.id === 'lyle-team')), JSON.stringify(before.teams[0]));
  assert.equal(JSON.stringify(data.meetings.independent), JSON.stringify(before.meetings.independent));
  assert.equal(JSON.stringify(data.platform.conversations.mixed), JSON.stringify(before.platform.conversations.mixed));
  assert.deepEqual(data.teams.map(team => team.id), ['lyle-team', 'real-team', 'empty-real-team']);
  assert.deepEqual(data.artifacts.map(item => item.id), ['lyle-doc']);
  assert.deepEqual(data.sessions, before.sessions.slice(0, 1));
  assert.deepEqual(data.meetingInvitations, before.meetingInvitations.slice(0, 1));
  assert.deepEqual(data.authBootstrap, before.authBootstrap);
  assert(!('project' in data.workspace)); assert(!('labs' in data.workspace)); assert(!('catalog' in data.platform)); assert(!('teamStats' in data));
  assert(plan.encodedBytes.after < plan.encodedBytes.before);
});

test('no implicit project deletion and a readonly incomplete plan remains inspectable', () => {
  const data = fixture(), plan = planWorkspaceRetirement(data, { keepProject: 'lyle', removeProjectIds: [] });
  assert.deepEqual(plan.remove.projects, []);
  assert(plan.blockedBy.some(item => item.code === 'RETAINED_PROJECT_DEMO_ACL'));
  assert.throws(() => applyWorkspaceRetirement(data, { keepProject: 'lyle', removeProjectIds: [], expectedFingerprint: plan.fingerprint }), /RETIREMENT_BLOCKED/);
  const onlyDemo = apply(data, { keepProject: 'lyle', removeProjectIds: ['demo-project'] }).data;
  assert.deepEqual(onlyDemo.workspace.projects.satellite, data.workspace.projects.satellite);
});

test('stale review refuses content changes but permits ephemeral session and presence changes', () => {
  const data = fixture(), plan = planWorkspaceRetirement(data, options), changed = structuredClone(data);
  changed.sessions.push({ id: 'new', userId: 'real' }); changed.updatedAt = 'new'; changed.meetings.independent.presence.real = 'new'; changed.users[1].lastLoginAt = 'new'; changed.users[1].updatedAt = 'new';
  const result = applyWorkspaceRetirement(changed, { ...options, expectedFingerprint: plan.fingerprint });
  assert.deepEqual(result.data.sessions, changed.sessions.filter(session => session.userId === 'real'));
  assert.equal(result.data.users[1].lastLoginAt, 'new');
  for (const mutation of [source => { source.artifacts[1].documentText += ' edit'; }, source => { source.users[0].passwordHash += ' changed'; }, source => { source.workspace.delivery.lyle.revision++; }, source => { source.meetings.independent.transcript += ' edit'; }]) {
    const copy = structuredClone(data); mutation(copy);
    assert.throws(() => applyWorkspaceRetirement(copy, { ...options, expectedFingerprint: plan.fingerprint }), /FINGERPRINT_MISMATCH/);
  }
  assert.throws(() => applyWorkspaceRetirement(data, options), /FINGERPRINT_MISMATCH/);
});

test('cross-scope artifacts and retained LYLE demo ACL block application', () => {
  for (const mutation of [source => { source.workspace.delivery.lyle.requirements[0].sourceArtifactId = 'satellite-doc'; }, source => { source.teams[0].memberIds.push('md'); }, source => { source.workspace.projects.lyle.document.context.assignments.push({ memberId: 'md' }); }, source => { source.workspace.delivery.lyle.requirements[0].reviewers = ['demo']; }, source => { source.users[0].isDemoAccount = true; }]) {
    const data = fixture(); mutation(data); const plan = planWorkspaceRetirement(data, options);
    assert(plan.blockedBy.length > 0);
    assert.throws(() => applyWorkspaceRetirement(data, { ...options, expectedFingerprint: plan.fingerprint }), /RETIREMENT_BLOCKED/);
  }
});

test('legacy artifact scope labels still follow explicit owners; independent examples stay untouched', () => {
  const data = fixture(); data.artifacts[1].scope = 'legacy-project'; data.meetings.independent.example = 'old-example';
  const result = apply(data);
  assert.deepEqual(result.plan.remove.artifacts, ['demo-project-doc', 'satellite-doc']);
  assert.deepEqual(result.data.meetings.independent, data.meetings.independent);
  assert.equal(inventoryWorkspaceRetirement(data).meetings.find(meeting => meeting.id === 'independent').example, true);
});

test('mixed real teams retain their real ACL and never become demo-only deletion candidates', () => {
  const data = fixture(); data.teams[1].memberIds.push('mf'); data.teams[1].adminMemberIds = ['ma', 'mf'];
  const { data: next, plan } = apply(data);
  assert.deepEqual(next.teams.find(team => team.id === 'real-team').memberIds, ['ma']);
  assert.deepEqual(next.teams.find(team => team.id === 'real-team').adminMemberIds, ['ma']);
  assert.deepEqual(plan.teamMembershipChanges, [{ id: 'real-team', removeMemberIds: ['mf'] }]);
});

test('repeat retirement with the same explicit target list is a no-op after a fresh review', () => {
  const first = apply(fixture()).data, second = apply(first);
  assert.deepEqual(second.data, first);
  assert(Object.values(second.plan.remove).every(ids => ids.length === 0));
  assert.deepEqual(second.plan.retiredFields, []);
  assert.throws(() => planWorkspaceRetirement(first, { removeProjectIds: [] }), /KEEP_PROJECT_REQUIRED/);
  assert.throws(() => planWorkspaceRetirement(first, { keepProject: 'lyle', removeProjectIds: ['lyle'] }), /INVALID_PROJECT_REMOVALS/);
});
