/** Explicit local-only proposal: preserves the caller's exact audited model and all documents. */
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { seedQuetzalWorkspace } from './seed-quetzal-workspace.mjs';
import { seedMeetingExamples } from './seed-meeting-examples.mjs';
import { seedDeliveryDemo } from '../server/delivery-demo.mjs';
const fixture = JSON.parse(readFileSync(new URL('../data/quetzal-public-model-v1.json', import.meta.url), 'utf8'));
const sha256 = value => createHash('sha256').update(value).digest('hex');
/** expectedModelSha256 must come from the separately reviewed snapshot/backup.
 * Returns a proposal copy and audit; never accesses a database or writes files. */
export function prepareExistingQuetzalDemo(value, { projectId, actorId, expectedModelSha256 } = {}) {
  if (!/^[a-f0-9]{64}$/.test(expectedModelSha256 || '')) throw new Error('An explicitly audited model SHA-256 is required.');
  const original = value.workspace?.projects?.[projectId], baseline = original?.document?.engineeringSystem;
  if (!baseline || baseline.entities.length !== 87 || !/quetzal/i.test(original.document.name)) throw new Error('Select the audited existing 87-element Quetzal baseline.');
  const actor = value.users.find(user => user.id === actorId && user.active), team = value.teams.find(item => item.id === original.document.context.teamId);
  if (!original.demoSandboxId || actor?.demoSandboxId !== original.demoSandboxId || !actor.demoSandboxOwner || team?.demoSandboxId !== original.demoSandboxId || team.captainMemberId !== actor.memberId || !team.memberIds.includes(actor.memberId)) throw new Error('The existing demo captain must own this sandbox.');
  if (original.quetzalWorkspaceContinuity?.version === 1) {
    if (original.quetzalWorkspaceContinuity.auditedModelSha256 !== expectedModelSha256) throw new Error('The audit snapshot differs from the applied proposal.');
    return { data: structuredClone(value), audit: { changed: false, alreadyApplied: true, projectId } };
  }
  if (sha256(JSON.stringify(baseline)) !== expectedModelSha256) throw new Error('Existing model changed since the audit; no changes proposed.');
  const mapping = new Map();
  for (const source of fixture.sources) {
    const matches = value.artifacts.filter(a => a.scope === 'project' && a.ownerId === projectId && (a.provenance?.sourceId === source.sourceId || a.fileName === `${source.sourceId}.txt`));
    if (matches.length !== 1 || typeof matches[0].documentText !== 'string' || sha256(matches[0].documentText) !== source.sha256) throw new Error(`Source ${source.sourceId} changed; do not advance model continuity.`);
    mapping.set(source.sourceId, matches[0].id);
  }
  // This validator also requires a real project captain in the same demo sandbox.
  const workspace = seedQuetzalWorkspace(value, { projectId, actorId });
  let data = workspace.data;
  const record = data.workspace.projects[projectId], project = record.document;
  assert.deepEqual(project.engineeringSystem, baseline, 'Organization must not modify the audited baseline');
  const timestamp = new Date().toISOString(), previousMemoryRevision = original.document.memoryRevision, previousGeneratedFromRevision = baseline.generatedFromRevision;
  record.engineeringHistory ||= [];
  record.engineeringHistory.push({ id: randomUUID(), archivedAt: timestamp, archivedBy: actorId, engineeringSystem: structuredClone(baseline), extractionReport: structuredClone(original.extractionReport || null) });
  project.engineeringSystem.generatedFromRevision = project.memoryRevision;
  project.systemGeneratedFromRevision = project.memoryRevision;
  if (!record.extractionReport) {
    record.extractionReport = structuredClone(fixture.extractionReport);
    for (const source of record.extractionReport.documents) source.artifactId = mapping.get(source.artifactId);
    for (const omission of record.extractionReport.omissions) omission.artifactId = mapping.get(omission.artifactId);
  }
  // Preserve the original report and add concrete architecture review tasks.
  record.extractionReport.reviewNotes ||= [];
  const notes = fixture.audit.pending.map((note, index) => ({ id: `public-architecture-${index + 1}`, title: note.title, reason: note.reason, artifactIds: note.sourceIds.map(id => mapping.get(id)), entityId: note.entityIds[0] || null }));
  if (baseline.entities.find(entity => entity.id === 'obj-c00e11c1a0acf708010a38fd')?.properties.some(property => property.key === 'slave_address' && property.value === '0x99')) notes.unshift({ id: 'public-i2c-address-owner', title: 'Reatribuir endereço I²C ao microcontrolador EPS', reason: 'A fonte atribui 0x99 ao microcontrolador EPS. O mapa atual atribui esse endereço ao barramento compartilhado; confira a fonte e corrija o objeto.', artifactIds: [mapping.get('quetzal-eps-flight-software-readme')], entityId: 'obj-c00e11c1a0acf708010a38fd' });
  for (const note of notes) if (!record.extractionReport.reviewNotes.some(item => item.id === note.id)) record.extractionReport.reviewNotes.push(note);
  record.extractionReport.needsReview = true;
  const continuity = { version: 1, auditedModelSha256: expectedModelSha256, previousMemoryRevision, previousGeneratedFromRevision, generatedFromRevision: project.memoryRevision, verifiedSourceHashes: fixture.sources.map(source => ({ sourceId: source.sourceId, sha256: source.sha256 })), timestamp, reason: 'Only document organization changed. The 17 source texts match the audited extraction byte for byte; the exact reviewed model is preserved. Technical uncertainties remain open for review.' };
  record.quetzalWorkspaceContinuity = continuity;
  record.revision = (record.revision || 0) + 1; record.updatedAt = timestamp; project.updatedAt = timestamp;
  for (const key of ['entities','relations','requirements','evidence','artifactSources','corrections','scenarios']) assert.deepEqual(project.engineeringSystem[key], baseline[key]);
  const delivery = seedDeliveryDemo(data, projectId, actorId), meetings = seedMeetingExamples(data, { projectId, actorId }); data = meetings.data;
  return { data, audit: { changed: true, projectId, workspace: workspace.audit, continuity, delivery, meetings: meetings.audit, preserved: { originalSources: 17, entities: 87, technicalFacts: true, previousModelArchived: true } } };
}
