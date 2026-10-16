/** Explicit fictional fixtures: no inference, provider calls, filesystem writes or startup hook. */
import { readFileSync } from 'node:fs';
import { withPreparedExampleSummaries } from './meeting-example-summaries.mjs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { isProjectAdmin } from '../shared/project-organization.mjs';
const require = createRequire(import.meta.url), Session = require('../../meeting-session.js');
const definitions = {
  geral: {
    topics: ['Aplicativo e homologação', 'Sensores e orçamento', 'Demonstração e laboratório', 'Autonomia e carregador', 'Acessibilidade', 'Suporte da apresentação'],
    // Line index, topic index, manually authored category. These are illustrative
    // examples, never billed or described as predictions from a trained model.
    points: [[2,0,'requirement'],[3,1,'observation'],[5,1,'requirement'],[6,0,'hypothesis'],[7,2,'test_proposal'],[10,0,'test_result'],[11,0,'requirement'],[12,0,'decision'],[13,1,'observation'],[15,2,'test_proposal'],[17,3,'test_result'],[19,3,'hypothesis'],[20,3,'test_proposal'],[22,4,'test_result'],[24,4,'test_proposal'],[25,1,'decision'],[26,4,'test_result'],[27,2,'test_result'],[28,2,'decision'],[29,1,'observation'],[31,2,'test_result'],[32,2,'decision'],[33,1,'observation'],[35,1,'test_proposal'],[38,0,'test_proposal'],[40,2,'test_proposal'],[41,3,'test_result'],[42,3,'hypothesis'],[43,3,'decision'],[44,3,'test_proposal'],[48,5,'decision'],[50,5,'observation'],[51,5,'test_proposal'],[54,0,'decision'],[57,3,'hypothesis'],[59,1,'test_proposal']],
    relations: [[12,10,'based_on'],[26,22,'supersedes'],[28,7,'supersedes'],[32,15,'supersedes'],[54,12,'supersedes']],
  },
  setor: {
    topics: ['Rigidez da viga', 'Massa e manuseio da carenagem', 'Encaixe do sensor', 'Fabricação e custo', 'Montagem do conjunto'],
    points: [[2,0,'test_result'],[3,0,'requirement'],[5,1,'test_result'],[8,1,'test_proposal'],[9,0,'test_result'],[10,0,'test_result'],[11,0,'requirement'],[12,0,'test_proposal'],[13,2,'test_result'],[14,2,'hypothesis'],[15,2,'test_result'],[16,2,'test_proposal'],[17,1,'hypothesis'],[19,3,'observation'],[21,0,'test_result'],[22,0,'test_result'],[23,0,'observation'],[24,0,'decision'],[25,0,'test_proposal'],[27,2,'test_result'],[28,2,'decision'],[29,1,'test_result'],[30,1,'test_result'],[31,1,'requirement'],[32,1,'hypothesis'],[33,1,'hypothesis'],[34,0,'test_result'],[35,3,'observation'],[36,3,'decision'],[38,1,'test_result'],[40,1,'decision'],[41,4,'test_proposal'],[42,4,'test_result'],[43,4,'hypothesis'],[44,4,'decision'],[46,0,'decision'],[47,4,'test_result'],[48,4,'test_proposal'],[49,3,'test_result'],[50,0,'test_result'],[52,0,'decision'],[53,4,'test_result'],[54,1,'test_result'],[55,1,'test_proposal'],[56,1,'decision'],[57,1,'test_proposal']],
    relations: [[22,10,'supersedes'],[24,22,'based_on'],[27,13,'supersedes'],[28,27,'based_on'],[29,17,'supersedes'],[38,33,'supersedes'],[40,38,'based_on'],[50,22,'supersedes'],[52,50,'based_on'],[53,47,'supersedes'],[54,38,'supersedes']],
  }
};
export function exampleSnapshot(kind, { id, title, projectId, startedAt = '2026-10-16T12:00:00.000Z' }) {
  const text = readFileSync(new URL(`../public/meeting-mocks/${kind}-25min.txt`, import.meta.url), 'utf8'), entries = Session.parseTranscriptEntries(text), definition = definitions[kind];
  const eventId = index => `E${String(index + 1).padStart(3, '0')}`, chunkId = index => `C${String(index + 1).padStart(4, '0')}`, sourceId = index => `T${String(index + 1).padStart(4, '0')}`;
  const selected = new Set(definition.points.map(([index]) => index));
  const meeting_events = definition.points.map(([index, topic, type]) => ({ event_id: eventId(index), chunk_id: chunkId(index), thread_id: `TOPIC-${topic + 1}`, type, text: entries[index].text, store_confidence: 1, type_confidence: 1, source: 'fictional_curated_example' }));
  const meeting_threads = definition.topics.map((title, topic) => ({ thread_id: `TOPIC-${topic + 1}`, title, anchor_event_ids: meeting_events.filter(event => event.thread_id === `TOPIC-${topic + 1}`).map(event => event.event_id) }));
  const meeting_relations = definition.relations.map(([source, target, relation_type], index) => ({ relation_id: `FIXTURE-R${index + 1}`, source_event_id: eventId(source), target_event_id: eventId(target), relation_type, configuration_match: 'match', relation_probability: 1, match_probability: 1, review_state: 'confirmed', source: 'fictional_curated_example' }));
  return withPreparedExampleSummaries({ id, title, schemaVersion: 1, liveSchemaVersion: 1, memorySchemaVersion: 2, room_kind: 'meeting', input_mode: 'import', provider: 'official', status: 'done', calls: 0, threshold: .6,
    createdAt: startedAt, startedAt, finishedAt: new Date(Date.parse(startedAt) + 25 * 60_000).toISOString(), project_id: projectId, project_memory_mode: 'none', integrated_norte: true,
    meeting_metadata: { example: true, provenance: 'MOCK FICTÍCIO. Transcrição e categorias ilustrativas preparadas manualmente; não são resultados de JEV, Gemini ou fatos do projeto.' },
    batch: { batch_id: id, cases: definition.points.map(([index]) => ({ id: chunkId(index), current_utterance: entries[index].text, source_entry_id: sourceId(index) })) },
    records: definition.points.map(([index, , type]) => ({ id: chunkId(index), status: 'done', result: { store: true, type, storeProbability: 1, typeProbability: 1, destination: type } })),
    transcript: entries.map((entry, index) => ({ ...entry, id: sourceId(index), source: 'import', status: 'done', receivedAt: new Date(Date.parse(startedAt) + entry.offsetMs).toISOString(), ...(selected.has(index) ? { chunk_id: chunkId(index) } : {}) })),
    meeting_events, meeting_threads, meeting_relations, raw_window: [], topic_titles: Object.fromEntries(meeting_threads.map(topic => [topic.thread_id, topic.title])), meeting_commands: []
  });
}
export function seedMeetingExamples(value, { projectId, actorId, allowLocalTest = false } = {}) {
  const data = structuredClone(value), record = data.workspace?.projects?.[projectId], project = record?.document, actor = data.users.find(user => user.id === actorId && user.active), team = data.teams.find(item => item.id === project?.context?.teamId);
  if (!project || !actor || !team || !team.memberIds.includes(actor.memberId) || !isProjectAdmin(project, actor, record.createdBy)) throw Error('Escolha um projeto existente e uma conta responsável da própria equipe.');
  const sandbox = record.demoSandboxId || project.demoSandboxId || null;
  if (sandbox ? sandbox !== actor.demoSandboxId || sandbox !== team.demoSandboxId : !(allowLocalTest && ['quetzal-workspace-test', 'team-preview-test'].includes(data.environment))) throw Error('Exemplos exigem sandbox ou uma cópia local de teste explicitamente autorizada.');
  const sector = project.context.sectors.find(item => /estrutur|sistemas/i.test(item.name)) || project.context.sectors[0];
  if (!sector) throw Error('Prepare um setor no projeto antes de criar os exemplos.');
  data.meetings ||= {}; const ids = [], added = [], hash = createHash('sha256').update(projectId).digest('hex').slice(0, 12), marker = sandbox ? { demoSandboxId: sandbox } : {};
  for (const [kind, scope] of [['geral', 'team'], ['setor', 'sector']]) {
    const id = `meeting-example-${hash}-${kind}`; ids.push(id);
    if (data.meetings[id]) { if (data.meetings[id].example !== 'curated_mock_v1' || data.meetings[id].projectId !== projectId) throw Error('O identificador do exemplo já está ocupado.'); continue; }
    const title = kind === 'geral' ? '[MOCK] Alinhamento geral · 25 minutos' : `[MOCK] Revisão do setor · 25 minutos`;
    const snapshot = exampleSnapshot(kind, { id, title, projectId }), finishedAt = snapshot.finishedAt;
    data.meetings[id] = { id, title, ownerId: actorId, participantIds: [], projectId, scope, teamId: team.id, sectorId: scope === 'sector' ? sector.id : null, memoryMode: 'none', memoryRevision: null, roomKind: 'meeting', status: 'done', revision: 1, createdAt: snapshot.createdAt, updatedAt: finishedAt, presence: {}, contributions: [], nextSequence: 1, example: 'curated_mock_v1', exampleSnapshot: snapshot, ...marker };
    added.push(id);
  }
  return { data, audit: { changed: added.length > 0, meetingIds: ids, createdMeetingIds: added, projectId, fictional: true, paidCalls: 0 } };
}
