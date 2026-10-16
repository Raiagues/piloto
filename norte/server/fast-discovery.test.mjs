import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fastDiscovery } from './fast-discovery.mjs';
import { rankProjectObjects } from './project-retrieval.mjs';

function model() { return { entities: [{ id: 'camera', name: 'Camera', kind: 'component', description: 'Optical camera', properties: [{ key: 'mass', name: 'Mass', value: 100, unit: 'g', source: 'documented', evidenceRefs: [] }] }, { id: 'radio', name: 'Radio', kind: 'component', properties: [{ key: 'tx_duty_cycle', name: 'TX duty cycle', value: 10, unit: '%', source: 'documented', evidenceRefs: [] }] }], requirements: [], relations: [], evidence: [] }; }
function provider(confidence = .99, propertyKey) {
  const calls = [];
  return { enabled: true, calls, classify: async (actor, state, questions) => {
    calls.push({ actor, state, questions });
    return { latencyMs: 12, answers: Object.fromEntries(Object.entries(questions).map(([key, question]) => { const choices = Object.keys(question.criteria), selected = key === 'property' && propertyKey ? choices.find(choice => question.criteria[choice] === propertyKey) : choices[0]; return [key, { type: 'choice', choice: selected, confidence, probabilities: Object.fromEntries(choices.map(choice => [choice, choice === selected ? confidence : (1 - confidence) / (choices.length - 1)])) }]; })) };
  } };
}
const context = { actorId: 'user-1' };

test('fast absolute quantity stays grounded in exact user digits and real target properties', async () => {
  const jev = provider(), original = model(); let physical = 0;
  const result = await fastDiscovery({ jev, model: original, text: 'Mudar a massa da camera para 1,2 kg.', context, onCall: async () => { physical++; assert.equal(jev.calls.length, 0); } });
  assert.equal(result.engine, 'jev'); assert.equal(result.change.targetEntityId, 'camera');
  assert.equal(result.change.newValues[0].value, 1.2); assert.equal(result.change.newValues[0].unit, 'kg');
  assert.equal(original.entities[0].properties[0].value, 100, 'the baseline remains immutable');
  assert.equal(physical, 1); assert.equal(jev.calls[0].state.explicitQuantity.value, 1.2);
});

test('percent at end of sentence is recognized without a word boundary after percent', async () => {
  const result = await fastDiscovery({ jev: provider(), model: model(), text: 'Mudar TX duty cycle do radio para 25%.', context });
  assert.equal(result.change.newValues[0].value, 25); assert.equal(result.change.newValues[0].unit, '%');
});

test('legacy entities with missing properties can accept an explicit new supported quantity without crashing', async () => {
  const source = model(); delete source.entities[0].properties;
  const result = await fastDiscovery({ jev: provider(), model: source, text: 'Mudar peso da camera para 2 kg', context });
  assert.equal(result.change.newValues[0].value, 2); assert.equal(result.change.newValues[0].key, 'mass');
  assert.equal(source.entities[0].properties, undefined);
});

test('ambiguous targets, relative changes, negation and multiple quantities fall through without a Jev call', async () => {
  const ambiguous = model(); ambiguous.entities.push({ ...ambiguous.entities[0], id: 'camera2', name: 'Camera reserva' });
  const examples = [
    [ambiguous, 'Mudar camera para 1 kg'],
    [model(), 'Mudar camera e radio para 1 kg'],
    [model(), 'Não mudar camera para 1 kg'],
    [model(), 'Talvez mudar camera para 1 kg'],
    [model(), 'Mudar camera reduzindo em 10%'],
    [model(), 'Mudar camera para metade de 1 kg'],
    [model(), 'Mudar camera para 1 kg e 10 W'],
    [model(), 'A anotação diz "mudar camera para 1 kg"'],
    [model(), 'Mudar camera para -1 kg'],
    [model(), 'Mudar radio para 110%'],
    [model(), 'Mudar camera para 10 watts']
  ];
  for (const [source, text] of examples) {
    const jev = provider(); let metric = 0;
    assert.equal(await fastDiscovery({ jev, model: source, text, context, onCall: async () => metric++ }), null, text);
    assert.equal(jev.calls.length, 0, text); assert.equal(metric, 0, text);
  }
});

test('weak choice or a missing model answer cannot create an arbitrary update', async () => {
  assert.equal(await fastDiscovery({ jev: provider(.65), model: model(), text: 'Mudar camera para 1 kg', context }), null);
  assert.equal(await fastDiscovery({ jev: { enabled: true, classify: async () => null }, model: model(), text: 'Mudar camera para 1 kg', context }), null);
  const jev = provider(); jev.classify = async () => ({ answers: { target: { type: 'choice', choice: 'invented', confidence: 1, probabilities: { invented: 1 } } } });
  assert.equal(await fastDiscovery({ jev, model: model(), text: 'Mudar camera para 1 kg', context }), null);
});

test('a failed physical attempt is counted once and propagated for the caller fallback', async () => {
  let count = 0;
  await assert.rejects(fastDiscovery({ jev: { enabled: true, classify: async () => { throw Error('unavailable'); } }, model: model(), text: 'Mudar camera para 1 kg', context, onCall: async () => count++ }), /unavailable/);
  assert.equal(count, 1);
});

test('a unique complete name wins over incidental property words in the public 87-entity map', async () => {
  const source = JSON.parse(readFileSync(new URL('../data/quetzal-public-model-v1.json', import.meta.url), 'utf8')).model;
  const text = 'Para um cenário hipotético, alterar a potência de operação (operating_power) dos MFR50SFTE52-5R6 Resistors para 3,0 W.';
  const words = new Set(text.toLowerCase().match(/[a-z0-9]{3,}/gu));
  const oldCandidates = rankProjectObjects(source, text).filter(item => (item.name.toLowerCase().match(/[a-z0-9]{3,}/gu) || []).some(word => words.has(word)));
  assert.equal(oldCandidates.length, 8, 'the regression contains the formerly ambiguous Power/Operating objects');
  const before = structuredClone(source), jev = provider(.99, 'operating_power');
  const result = await fastDiscovery({ jev, model: source, text, context });
  assert.equal(jev.calls.length, 1); assert.equal(jev.calls[0].state.candidates.length, 1);
  assert.equal(result.status, 'resolved'); assert.equal(result.engine, 'jev');
  assert.equal(result.change.targetEntityId, 'obj-56b596c6c236fb2a869d05cc');
  assert.deepEqual(result.change.newValues.map(({ key, value, unit }) => ({ key, value, unit })), [{ key: 'operating_power', value: 3, unit: 'W' }]);
  assert.deepEqual(source, before);
});

test('duplicate full names and two explicitly named components still fall through before calling Jev', async () => {
  const source = model(); source.entities[0].name = 'Primary optical camera'; source.entities[1].name = 'Main radio';
  const duplicate = structuredClone(source); duplicate.entities.push({ ...duplicate.entities[0], id: 'camera-copy' });
  for (const [data, text] of [[source, 'Mudar Primary optical camera e Main radio para 1 kg'], [duplicate, 'Mudar Primary optical camera para 1 kg']]) {
    const jev = provider(); assert.equal(await fastDiscovery({ jev, model: data, text, context }), null); assert.equal(jev.calls.length, 0);
  }
});

test('exact names normalize accents and spacing, exact IDs work, and identifier boundaries stay intact', async () => {
  const source = model(); source.entities[0].id = 'payload_camera_01'; source.entities[0].name = 'Câmera óptica';
  for (const text of ['Mudar CÂMERA   ÓPTICA para 1 kg', 'Mudar payload_camera_01 para 1 kg']) {
    const result = await fastDiscovery({ jev: provider(), model: source, text, context }); assert.equal(result.change.targetEntityId, 'payload_camera_01');
  }
  for (const text of ['Mudar camera_spare para 1 kg', 'Mudar minicamera para 1 kg', 'Mudar payload_camera_01_spare para 1 kg']) {
    const jev = provider(); assert.equal(await fastDiscovery({ jev, model: source, text, context }), null); assert.equal(jev.calls.length, 0);
  }
});

test('property keys do not add component-name tokens when only a partial technical name is given', async () => {
  const source = model(); source.entities[0].name = 'Camera optical assembly'; source.entities[0].properties = [{ key: 'operating_power', name: 'Operating power', value: 4, unit: 'W', source: 'documented', evidenceRefs: [] }];
  source.entities[1].name = 'Power control module';
  const jev = provider(.99, 'operating_power');
  const result = await fastDiscovery({ jev, model: source, text: 'Alterar operating_power da camera para 3 W', context });
  assert.equal(jev.calls.length, 1); assert.equal(result.change.targetEntityId, 'camera'); assert.equal(result.change.newValues[0].key, 'operating_power');
});
