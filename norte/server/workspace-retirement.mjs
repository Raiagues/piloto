import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { isFictionalProfile } from './reviewer-eligibility.mjs';

const array = value => Array.isArray(value) ? value : [];
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const demo = value => Boolean(value?.isDemoAccount || value?.demoSandboxId || value?.isFictionalProfile || isFictionalProfile(value));
const bytes = value => Buffer.byteLength(JSON.stringify(value ?? null));
const sorted = values => [...values].sort();
const retired = {
  workspace: ['labs', 'extractionJobs', 'ideaSessions', 'ideaBudgets', 'ideaAnalysisBudgets', 'ideaStarterCache', 'ideaAnalysisCache'],
  platform: ['catalog', 'planRequests', 'entitlements'],
  root: ['projectLearning', 'teamStats']
};
const identityKeys = new Set(['userId', 'memberId', 'ownerId', 'reviewerId', 'authorId', 'actorId', 'createdBy', 'updatedBy', 'creatorId', 'captainMemberId', 'reviewers', 'reviewerIds', 'memberIds', 'adminMemberIds']);

// Stream a canonical digest; large artifact bodies need not be copied into another object.
function fingerprint(value, transient = false) {
  const hash = createHash('sha256');
  function visit(item, path = []) {
    if (Array.isArray(item)) {
      hash.update('['); for (const child of item) { visit(child, [...path, '*']); hash.update(','); } hash.update(']');
    } else if (item && typeof item === 'object') {
      hash.update('{');
      for (const key of Object.keys(item).sort()) {
        if (transient && (
          (path.length === 0 && ['updatedAt', 'sessions', 'documentPresence'].includes(key)) ||
          (path.length === 1 && path[0] === 'telemetry' && key === 'sessions') ||
          (path.length === 2 && path[0] === 'meetings' && key === 'presence') ||
          (path.length === 2 && path[0] === 'users' && ['lastLoginAt', 'lastSeenAt', 'updatedAt'].includes(key))
        )) continue;
        hash.update(JSON.stringify(key)); hash.update(':'); visit(item[key], [...path, key]); hash.update(',');
      }
      hash.update('}');
    } else hash.update(JSON.stringify(item) ?? 'undefined');
  }
  visit(value); return hash.digest('hex');
}

function artifactReferences(value, found = new Set()) {
  if (Array.isArray(value)) for (const item of value) artifactReferences(item, found);
  else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) {
    if (/artifactId$/iu.test(key) && typeof item === 'string') found.add(item);
    else if (/artifactIds$/iu.test(key)) { for (const id of array(item)) if (typeof id === 'string') found.add(id); }
    else if (key === 'teamArtifactFolders') { for (const id of Object.keys(object(item))) found.add(id); }
    else artifactReferences(item, found);
  }
  return found;
}

function demoIdentityReferences(value, identities, found = new Set()) {
  if (Array.isArray(value)) for (const item of value) demoIdentityReferences(item, identities, found);
  else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) {
    if (identityKeys.has(key)) for (const id of Array.isArray(item) ? item : [item]) if (identities.has(id)) found.add(id);
    demoIdentityReferences(item, identities, found);
  }
  return found;
}

/** Operational inventory: identifiers, flags and sizes only, never names or content. */
export function inventoryWorkspaceRetirement(data) {
  const users = new Map(array(data.users).map(user => [user.id, user]));
  const members = new Map(array(data.members).map(member => [member.id, member]));
  const projects = object(data.workspace?.projects);
  const counts = Object.fromEntries(['users', 'members', 'teams', 'artifacts', 'meetings'].map(key => [key, Array.isArray(data[key]) ? data[key].length : Object.keys(object(data[key])).length]));
  counts.projects = Object.keys(projects).length;
  const memberIsReal = id => { const member = members.get(id), user = users.get(member?.accountId) || array(data.users).find(account => account.memberId === id); return !!user && !demo(user) && !demo(member); };
  return {
    counts, encodedBytes: bytes(data), sectionBytes: Object.fromEntries(Object.entries(data).map(([key, value]) => [key, bytes(value)])),
    users: array(data.users).map(user => ({ id: user.id, memberId: user.memberId ?? null, demo: demo(user), isDemoAccount: Boolean(user.isDemoAccount), hasDemoSandbox: Boolean(user.demoSandboxId), fictional: isFictionalProfile(user), administrator: user.accessRole === 'owner_admin' })),
    members: array(data.members).map(member => ({ id: member.id, accountId: member.accountId ?? null, demo: demo(member), realAccount: memberIsReal(member.id) })),
    teams: array(data.teams).map(team => ({ id: team.id, createdBy: team.createdBy ?? null, demo: demo(team), memberIds: array(team.memberIds), realMembers: array(team.memberIds).filter(memberIsReal).length, projects: Object.entries(projects).filter(([, record]) => record.document?.context?.teamId === team.id).map(([id]) => id), encodedBytes: bytes(team) })),
    projects: Object.entries(projects).map(([id, record]) => ({ id, teamId: record.document?.context?.teamId ?? null, createdBy: record.createdBy ?? null, demo: demo(record) || demo(record.document), revision: record.revision ?? null, encodedBytes: bytes(record), deliveryBytes: bytes(data.workspace?.delivery?.[id]) })),
    artifacts: array(data.artifacts).map(item => ({ id: item.id, scope: item.scope ?? null, ownerId: item.ownerId ?? null, demo: demo(item), encodedBytes: bytes(item) })),
    meetings: Object.entries(object(data.meetings)).map(([id, item]) => ({ id, ownerId: item.ownerId ?? null, projectId: item.projectId ?? null, teamId: item.teamId ?? null, demo: demo(item), example: Boolean(item.example), copiedFromExample: Boolean(item.copiedFromExample), encodedBytes: bytes(item) }))
  };
}

function prepare(original, { keepProject, removeProjectIds = [] } = {}) {
  if (typeof keepProject !== 'string' || !keepProject || !Object.hasOwn(object(original.workspace?.projects), keepProject)) throw new Error('KEEP_PROJECT_REQUIRED');
  if (!Array.isArray(removeProjectIds) || removeProjectIds.some(id => typeof id !== 'string' || !id) || removeProjectIds.includes(keepProject)) throw new Error('INVALID_PROJECT_REMOVALS');
  const requestedProjectIds = sorted(new Set(removeProjectIds));
  const data = structuredClone(original), projects = data.workspace.projects, keep = projects[keepProject];
  if (keep.document?.id !== keepProject) throw new Error('KEEP_PROJECT_ID_MISMATCH');
  const keepTeam = keep.document.context?.teamId, selectedTeam = array(original.teams).find(team => team.id === keepTeam);
  if (!selectedTeam) throw new Error('KEEP_TEAM_REQUIRED');
  const remove = { projects: new Set(requestedProjectIds.filter(id => Object.hasOwn(projects, id))), users: new Set(), members: new Set(), teams: new Set(), artifacts: new Set(), meetings: new Set(), conversations: new Set() };
  const blockedBy = [], teamMembershipChanges = [];
  const block = (code, scope, id, ids = []) => blockedBy.push({ code, scope, id, ids: sorted(new Set(ids)) });
  for (const user of array(data.users)) if (demo(user)) {
    remove.users.add(user.id);
    if (user.accessRole === 'owner_admin') block('DEMO_ADMINISTRATOR', 'user', user.id);
  }
  for (const member of array(data.members)) if (demo(member) || remove.users.has(member.accountId) || array(data.users).some(user => remove.users.has(user.id) && user.memberId === member.id)) remove.members.add(member.id);
  for (const user of array(data.users)) if (!remove.users.has(user.id) && remove.members.has(user.memberId)) block('REAL_ACCOUNT_DEMO_MEMBER', 'user', user.id, [user.memberId]);
  const retainedProjects = Object.entries(projects).filter(([id]) => !remove.projects.has(id));
  for (const team of array(data.teams)) {
    const memberIds = array(team.memberIds), realIds = memberIds.filter(id => !remove.members.has(id));
    const retainsProject = retainedProjects.some(([, record]) => record.document?.context?.teamId === team.id);
    const realCreator = team.createdBy && !remove.users.has(team.createdBy);
    const ownedProjects = Object.entries(projects).filter(([, record]) => record.document?.context?.teamId === team.id);
    const emptyRetiredScope = memberIds.length === 0 && ownedProjects.length > 0 && ownedProjects.every(([id]) => remove.projects.has(id));
    if (team.id !== keepTeam && !retainsProject && !realCreator && realIds.length === 0 && (demo(team) || (memberIds.length > 0 && memberIds.every(id => remove.members.has(id))) || emptyRetiredScope)) remove.teams.add(team.id);
    else {
      const removedIds = memberIds.filter(id => remove.members.has(id));
      if (team.id === keepTeam && (demo(team) || removedIds.length || remove.users.has(team.createdBy) || remove.members.has(team.captainMemberId) || array(team.adminMemberIds).some(id => remove.members.has(id)))) block('KEPT_PROJECT_DEMO_ACL', 'team', team.id, removedIds);
      else if (remove.users.has(team.createdBy) || remove.members.has(team.captainMemberId)) block('RETAINED_TEAM_DEMO_OWNER', 'team', team.id);
      else if (removedIds.length || array(team.adminMemberIds).some(id => remove.members.has(id))) {
        teamMembershipChanges.push({ id: team.id, removeMemberIds: sorted(new Set([...removedIds, ...array(team.adminMemberIds).filter(id => remove.members.has(id))])) });
        team.memberIds = memberIds.filter(id => !remove.members.has(id));
        if (Array.isArray(team.adminMemberIds)) team.adminMemberIds = team.adminMemberIds.filter(id => !remove.members.has(id));
        if (Array.isArray(team.legacyInvitedMemberIds)) team.legacyInvitedMemberIds = team.legacyInvitedMemberIds.filter(id => !remove.members.has(id));
      }
    }
  }
  for (const [id, record] of retainedProjects) {
    const context = record.document?.context || {};
    const invalid = array(context.assignments).map(item => item.memberId).filter(memberId => remove.members.has(memberId));
    if (demo(record) || demo(record.document) || remove.users.has(record.createdBy) || remove.users.has(record.document?.creatorId) || invalid.length) block(id === keepProject ? 'KEPT_PROJECT_DEMO_ACL' : 'RETAINED_PROJECT_DEMO_ACL', 'project', id, invalid);
  }
  const keptIdentities = demoIdentityReferences([keep, data.workspace.delivery?.[keepProject], selectedTeam], new Set([...remove.users, ...remove.members]));
  if (keptIdentities.size) block('KEPT_PROJECT_DEMO_ACL', 'project', keepProject, [...keptIdentities]);
  for (const artifact of array(data.artifacts)) if (demo(artifact) || remove.projects.has(artifact.projectId) || remove.teams.has(artifact.teamId) || remove.projects.has(artifact.ownerId) || remove.teams.has(artifact.ownerId) || (!artifact.ownerId && remove.users.has(artifact.createdBy))) remove.artifacts.add(artifact.id);
  for (const [id, meeting] of Object.entries(object(data.meetings))) if (demo(meeting) || remove.projects.has(meeting.projectId) || remove.teams.has(meeting.teamId) || remove.users.has(meeting.ownerId)) remove.meetings.add(id);
  const related = item => item && (
    remove.projects.has(item.projectId) || remove.teams.has(item.teamId) || remove.meetings.has(item.meetingId) || remove.artifacts.has(item.artifactId) ||
    ['userId', 'memberId', 'invitedUserId', 'recipientUserId', 'createdBy', 'actorId', 'accountId'].some(key => (key === 'memberId' ? remove.members : remove.users).has(item[key]))
  );
  data.users = array(data.users).filter(item => !remove.users.has(item.id));
  data.members = array(data.members).filter(item => !remove.members.has(item.id));
  data.teams = array(data.teams).filter(item => !remove.teams.has(item.id));
  data.artifacts = array(data.artifacts).filter(item => !remove.artifacts.has(item.id));
  data.meetings = Object.fromEntries(Object.entries(object(data.meetings)).filter(([id]) => !remove.meetings.has(id)));
  data.workspace.projects = Object.fromEntries(retainedProjects);
  const retiredFields = [];
  if (Object.hasOwn(data.workspace, 'project')) { delete data.workspace.project; retiredFields.push('workspace.project'); }
  if (data.workspace.delivery) data.workspace.delivery = Object.fromEntries(Object.entries(data.workspace.delivery).filter(([id]) => !remove.projects.has(id)));
  for (const key of ['sessions', 'emailVerifications', 'activity', 'documentPresence', 'invitations', 'meetingInvitations', 'platformAudit']) if (Array.isArray(data[key])) data[key] = data[key].filter(item => !related(item));
  if (data.platform?.conversations) for (const [id, conversation] of Object.entries(data.platform.conversations)) {
    const participants = new Set([conversation.createdBy, ...array(conversation.participantIds), ...array(conversation.messages).map(message => message.senderId)].filter(Boolean));
    if (remove.projects.has(conversation.projectId) || remove.teams.has(conversation.teamId) || (participants.size > 0 && [...participants].every(userId => remove.users.has(userId)))) { delete data.platform.conversations[id]; remove.conversations.add(id); }
  }
  if (data.telemetry) {
    if (data.telemetry.sessions) data.telemetry.sessions = Object.fromEntries(Object.entries(data.telemetry.sessions).filter(([, item]) => !related(item)));
    if (Array.isArray(data.telemetry.events)) data.telemetry.events = data.telemetry.events.filter(item => !related(item));
  }
  for (const [scope, keys] of Object.entries(retired)) for (const key of keys) {
    const host = scope === 'root' ? data : data[scope];
    if (host && Object.hasOwn(host, key)) { retiredFields.push(scope === 'root' ? key : `${scope}.${key}`); delete host[key]; }
  }
  const crossed = sorted(artifactReferences(data)).filter(id => remove.artifacts.has(id));
  if (crossed.length) block('RETAINED_SCOPE_USES_REMOVED_ARTIFACT', 'workspace', keepProject, crossed);
  if (!isDeepStrictEqual(data.workspace.projects[keepProject], original.workspace.projects[keepProject]) || !isDeepStrictEqual(data.workspace.delivery?.[keepProject], original.workspace.delivery?.[keepProject]) || !isDeepStrictEqual(data.teams.find(team => team.id === keepTeam), selectedTeam)) throw new Error('KEPT_PROJECT_CHANGED');
  const before = inventoryWorkspaceRetirement(original), after = inventoryWorkspaceRetirement(data);
  const plan = { version: 1, keepProject, requestedProjectIds, remove: Object.fromEntries(Object.entries(remove).map(([key, ids]) => [key, sorted(ids)])), teamMembershipChanges, retiredFields: retiredFields.sort(), blockedBy, countsBefore: before.counts, countsAfter: after.counts, encodedBytes: { before: before.encodedBytes, after: after.encodedBytes } };
  plan.sourceFingerprint = fingerprint(original, true);
  plan.preservedFingerprint = fingerprint(data, true);
  plan.fingerprint = fingerprint({ version: plan.version, keepProject, requestedProjectIds, remove: plan.remove, teamMembershipChanges, retiredFields: plan.retiredFields, blockedBy, sourceFingerprint: plan.sourceFingerprint, preservedFingerprint: plan.preservedFingerprint });
  return { data, plan };
}

/** A blocked plan is still reviewable; only apply may produce a publishable state. */
export function planWorkspaceRetirement(data, options) { return prepare(data, options).plan; }

export function applyWorkspaceRetirement(original, { expectedFingerprint, ...options } = {}) {
  const result = prepare(original, options);
  if (!expectedFingerprint || expectedFingerprint !== result.plan.fingerprint) throw new Error('RETIREMENT_FINGERPRINT_MISMATCH');
  if (result.plan.blockedBy.length) throw new Error('RETIREMENT_BLOCKED: ' + result.plan.blockedBy.map(item => item.code).join(', '));
  return result;
}
