/** Bounded, opt-in extraction of the hash-verified public Quetzal corpus. */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, sep } from 'node:path';
import assert from 'node:assert/strict';
if (!process.argv.includes('--live')) throw new Error('Use --live for paid extraction of public documents.');
const root = resolve('..'), corpus = resolve(root, 'project-documents/quetzal-1');
const manifest = JSON.parse(await readFile(resolve(corpus, 'manifest.json')));
const publicSources = manifest.sources.filter(source => ['project_context', 'supporting_datasheet'].includes(source.role));
assert.equal(publicSources.length, 17);
for (const source of publicSources) {
  assert.ok(['raw.githubusercontent.com', 'gomspace.com', 'www.ti.com', 'ww1.microchip.com'].includes(new URL(source.source_url).hostname));
  const path = resolve(corpus, source.text_path); assert.ok(path.startsWith(corpus + sep));
  assert.equal(createHash('sha256').update(await readFile(path)).digest('hex'), source.text_sha256);
}
const session = JSON.parse(await readFile(resolve(root, '.runtime/validation/local-session.json')));
assert.match(session.origin, /^http:\/\/(127\.0\.0\.1|localhost):\d+$/u);
async function api(path, body) {
  const response = await fetch(session.origin + '/api' + path, { method: body ? 'POST' : 'GET', headers: { cookie: session.cookie, 'x-csrf-token': session.csrfToken, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const value = await response.json(); if (!response.ok) throw new Error(response.status + ': ' + JSON.stringify(value)); return value;
}
const { project } = await api('/projects/' + session.projectId);
assert.equal(project.context.projectArtifactIds.length, 17);
assert.equal(project.engineeringSystem, undefined, 'Do not overwrite an existing baseline.');
const artifacts = (await api('/artifacts')).artifacts.filter(item => project.context.projectArtifactIds.includes(item.id));
assert.equal(artifacts.length, 17);
for (const artifact of artifacts) {
  const source = publicSources.find(item => artifact.id.endsWith('-' + item.id)); assert.ok(source);
  assert.equal(createHash('sha256').update(artifact.documentText).digest('hex'), source.text_sha256, 'Only the verified public source may reach the provider.');
}
const job = await api('/system-ai/jobs', { projectId: session.projectId, language: 'pt' });
const id = job.jobId; assert.ok(id, JSON.stringify(job));
await writeFile(resolve(root, '.runtime/validation/corpus-job.json'), JSON.stringify({ projectId: session.projectId, jobId: id }, null, 2));
let result = job, last = '', resumed = 0;
const deadline = Date.now() + (process.argv.includes('--all') ? 100 : 40) * 60_000;
while (Date.now() < deadline) {
  result = await api('/system-ai/jobs/' + id + '?projectId=' + encodeURIComponent(session.projectId));
  const line = JSON.stringify({ status: result.status, progress: result.progress, ...(result.error ? { error: result.error } : {}) });
  if (line !== last) { console.log(line); last = line; }
  if (result.status === 'paused' && process.argv.includes('--all') && resumed < 6) {
    resumed += 1;
    await api('/system-ai/jobs/' + id + '/resume', { projectId: session.projectId, language: 'pt' });
  } else if (['completed', 'paused', 'failed'].includes(result.status)) break;
  await new Promise(resolve => setTimeout(resolve, 3000));
}
await writeFile(resolve(root, '.runtime/validation/corpus-report.json'), JSON.stringify(result, null, 2), { mode: 0o600 });
if (result.status === 'completed' && !result.report?.needsReview) {
  await api('/system-ai/jobs/' + id + '/apply', { projectId: session.projectId, language: 'pt' });
  console.log('Complete validated map applied to the isolated test project.');
} else if (result.status === 'completed') console.log('Complete candidate saved. Review the reported omissions before applying it.');
else console.log('No partial map published. Validated chunks are preserved for continuation.');
