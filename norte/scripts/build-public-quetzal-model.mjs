/** Read-only export of the public engineering corpus, never accounts or project state.
 * Run explicitly with --source STORE --project ID --output NEW_FILE. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { validateEngineeringSystem } from '../shared/engineering-schema.mjs';
import { QUETZAL_WORKSPACE_DOCUMENT_IDS, QUETZAL_WORKSPACE_SOURCES } from './seed-quetzal-workspace.mjs';
const args = process.argv.slice(2), option = key => args[args.indexOf(key) + 1];
for (const key of ['--source', '--project', '--output']) assert(args.includes(key), `Missing ${key}`);
const source = resolve(option('--source')), output = resolve(option('--output')); assert.notEqual(source, output);
const data = JSON.parse(await readFile(source, 'utf8')), record = data.workspace.projects[option('--project')], original = record?.document?.engineeringSystem;
assert(original && /quetzal/i.test(original.name), 'Expected a Quetzal engineering model');
const pick = (value, keys) => Object.fromEntries(keys.filter(key => value[key] !== undefined).map(key => [key, structuredClone(value[key])]));
const artifactMap = new Map(), sources = [];
for (const sourceId of QUETZAL_WORKSPACE_DOCUMENT_IDS) {
  const matches = data.artifacts.filter(a => a.ownerId === record.document.id && (a.provenance?.sourceId === sourceId || a.fileName === `${sourceId}.txt`));
  assert.equal(matches.length, 1, `Expected one public source ${sourceId}`);
  const artifact = matches[0], sha256 = createHash('sha256').update(artifact.documentText).digest('hex');
  assert.equal(sha256, artifact.provenance.sha256, 'Only unchanged public source texts may be exported');
  assert(/^https:\/\//.test(artifact.provenance.sourceUrl), 'Public source URL required');
  artifactMap.set(artifact.id, sourceId); sources.push({ sourceId, sha256, sourceUrl: artifact.provenance.sourceUrl, label: artifact.label });
}
const model = pick(original, ['schemaVersion','entities','relations','requirements','evidence','artifactSources','generatedAt']);
Object.assign(model, { id: 'quetzal-public-extraction-v1', name: 'Quetzal-1', generatedFromRevision: 0, revision: 0, model: 'public-corpus-extraction-for-review' });
for (const evidence of model.evidence) {
  if (evidence.artifactId === 'architecture-review') {
    assert.equal(evidence.kind, 'inference'); assert(evidence.excerpt.startsWith('Proposed allocation: the source places the Z− solar panel and ADM'));
    evidence.artifactId = 'quetzal-adm-hardware'; evidence.artifactLabel = 'Quetzal-1 — mecanismo de abertura das antenas';
  } else { assert(artifactMap.has(evidence.artifactId), 'No private or unlinked evidence allowed'); evidence.artifactId = artifactMap.get(evidence.artifactId); }
}
for (const source of model.artifactSources) { assert(artifactMap.has(source.artifactId)); source.artifactId = artifactMap.get(source.artifactId); }
// A documented address belongs to a peripheral, never to the shared bus.
const bus = model.entities.find(e => e.id === 'obj-c00e11c1a0acf708010a38fd'), eps = model.entities.find(e => e.id === 'obj-2c0c2cfa42e86ee3dbef9fc2');
const address = bus.properties.find(p => p.key === 'slave_address'); assert.equal(address.value, '0x99');
assert(model.evidence.some(e => address.evidenceRefs.includes(e.id) && e.excerpt.includes('The EPS µC itself was connected as a slave with the address 0x99')));
bus.properties = bus.properties.filter(p => p.key !== 'slave_address'); eps.properties.push(address);
for (const requirement of model.requirements) requirement.status = 'unreviewed';
assert(validateEngineeringSystem(model), 'Portable public model invalid');
const report = pick(record.extractionReport, ['version','complete','needsReview','warnings','progress','completedAt']);
report.needsReview = true;
report.documents = record.extractionReport.documents.map(doc => { assert(artifactMap.has(doc.artifactId)); return { ...pick(doc, ['label','status','totalCharacters','coveredCharacters','totalPages','missingPages','totalChunks','completedChunks','complete']), artifactId: artifactMap.get(doc.artifactId) }; });
report.omissions = record.extractionReport.omissions.map(item => { assert(artifactMap.has(item.artifactId)); return { ...pick(item, ['chunkId','kind','id','name','reason']), artifactId: artifactMap.get(item.artifactId) }; });
report.conflicts = record.extractionReport.conflicts.map(item => pick(item, ['kind','entityId','key','kept','candidate','reason']));
const audit = { label: 'Mapa extraído de documentos públicos · sujeito a revisão', sources: QUETZAL_WORKSPACE_SOURCES,
  corrections: [{ operation: 'reassign_property', property: 'slave_address', from: bus.id, to: eps.id, value: '0x99', evidenceRefs: address.evidenceRefs, reason: 'O software EPS atribui 0x99 ao microcontrolador EPS. Um barramento compartilhado não tem um único endereço de escravo.' }],
  pending: [
    { sourceIds: ['quetzal-adcs-hardware','quetzal-adcs-software'], entityIds: ['obj-fb136fa19b7272f71c60fde6','obj-3b5cd6ffbe2d7c843df57e0f'], title: 'Conferir aliases do microcontrolador ADCS', reason: 'Hardware identifica ATmega328P na placa ADCS; software identifica o mesmo papel ADCS µC. Consolidar depois de conferir revisão e placa.' },
    { sourceIds: ['quetzal-adcs-hardware','quetzal-adcs-software'], entityIds: ['obj-278fd84d546165c8be8d1e73','obj-bf7178834bf70a46028086b8'], title: 'Conferir aliases da placa IMU BNO055', reason: 'As fontes descrevem a placa Adafruit com BNO055. Confirmar que ambos os registros representam a mesma instância antes de unir.' },
    { sourceIds: ['quetzal-eps-hardware-readme','quetzal-eps-flight-software-readme','quetzal-eps-bom-reference','quetzal-eps-schematic'], entityIds: ['obj-341a497beddc77e83f2824a2','obj-2c0c2cfa42e86ee3dbef9fc2','obj-c9c67cc795a01fe7aace81af','obj-44d9a76dffd827ee17c38ac0'], title: 'Comparar instâncias e revisões do microcontrolador EPS', reason: 'Conferir U23 no esquema e BOM. Não unir chips de placas diferentes nem tratar rótulo PAYLOAD como prova de alocação funcional.' },
    { sourceIds: ['quetzal-adm-hardware','quetzal-hardware-overview'], entityIds: ['obj-fcef7a192c748c41ef090137'], title: 'Revisar alocação funcional do painel Z−', reason: 'ADM e painel compartilham PCB; posicionar o painel sob ADM é uma interpretação para revisão, não uma conexão funcional comprovada.' },
    { sourceIds: ['quetzal-eps-bom-reference','quetzal-eps-flight-software-readme'], entityIds: [], title: 'Comparar BQ27441 e BQ27741', reason: 'BOM e software nomeiam referências diferentes. Manter fontes separadas até identificar a revisão de voo.' }
  ], safeguards: ['OBC e CDHS permanecem separados: falta evidência explícita para uma fusão.', 'INA260 SCM/MBM/SBM e TPS2551 U17/U19/U21 permanecem instâncias distintas.', 'Componentes de teste não são automaticamente componentes de voo.', 'Datasheets descrevem limites do fabricante; não aprovam requisitos nem comprovam configuração de voo.', 'Histórico de usuários, cenários privados, contas, equipes, chaves e revisões do workspace não são exportados.'] };
const fixture = { version: 1, description: audit.label, sources, model, extractionReport: report, audit };
const encoded = JSON.stringify(fixture, null, 2) + '\n';
assert(!encoded.includes(record.document.id), 'Source workspace identity must not be exported');
assert(!/"(?:passwordHash|email|memberId|actorId|createdBy|correctedBy|csrfToken|sessions|users|corrections|scenarios)"/.test(JSON.stringify({ model, report })), 'Unexpected private fields');
await writeFile(output, encoded, { flag: 'wx' });
console.log(JSON.stringify({ output, entities: model.entities.length, evidence: model.evidence.length, documents: sources.length, bytes: Buffer.byteLength(encoded), liveStoreChanged: false }));
