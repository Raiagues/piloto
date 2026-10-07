/* Pure, bounded experiment planning. No requests, storage or model-generated labels. */
(function (root) {
  'use strict';
  const E = typeof module !== 'undefined' && module.exports ? require('./experiments.js') : root.NorteExperiments;
  const sample = [
    'Speaker C: Maybe we could use aluminum.',
    'Speaker C: We should investigate whether aluminum works.',
    "Speaker C: Let's test aluminum on one prototype.",
    'Speaker C: The aluminum prototype performed better.',
    "Speaker C: Let's use aluminum in the next version.",
    'Speaker C: We are switching the final design to aluminum.'
  ].join('\n\n');
  // Workbook v2 labels. Minimum probabilities are separate gates, not fitted to
  // the observed results and never included in the request to the model.
  function exampleOptions(questions) {
    const keys = ['should_track','event_type','test_is_proposed','decision_is_final','pending_decision','creates_action_item','next_step_commitment','change_commitment','project_impact','primary_affected_area','requires_followup'];
    const rows = [
      [[true,.6],['change_proposal',.8],[false,.8],[false,.8],[false,.8],[false,.8],[1,.8],[1,.8],[2,.6],['material',.8],[true,.6]],
      [[true,.8],['test_proposal',.6],[true,.6],[false,.8],[false,.8],[true,.8],[2,.8],[1,.8],[2,.8],['material',.8],[true,.8]],
      [[true,.8],['test_proposal',.8],[true,.8],[false,.8],[false,.8],[true,.8],[2,.8],[1,.8],[2,.8],['material',.6],[true,.8]],
      [[true,.8],['test_result',.8],[false,.8],[false,.8],[false,.8],[false,.8],[0,.8],[1,.6],[2,.8],['performance',.8],[true,.6]],
      [[true,.8],['change_proposal',.6],[false,.8],[false,.6],[false,.8],[true,.6],[2,.8],[2,.8],[2,.8],['material',.8],[true,.8]],
      [[true,.8],['decision',.8],[false,.8],[true,.8],[false,.8],[true,.6],[3,.8],[3,.8],[3,.6],['material',.8],[true,.8]]
    ];
    return sample.split('\n\n').map((text, index) => ({ id:String(index+1), text, presetRevision:3, expected:Object.fromEntries(rows[index].map(([value,minProbability],i)=>[keys[i],{type:questions[keys[i]].type,value,minProbability}])) }));
  }
  const canonical = value => JSON.stringify((function sort(v) {
    return Array.isArray(v) ? v.map(sort) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort(v[k])])) : v;
  })(value));
  function completeDecisionDraft(options, input, preset) {
    const result=E.clone(options);
    // Upgrade only the known incomplete preset, under the same Questions and fixed State.
    if(!input.state || typeof input.state!=='object' || Array.isArray(input.state) || canonical(input.config)!==canonical(preset.config) || canonical({...input.state,current_utterance:preset.state.current_utterance})!==canonical(preset.state))return result;
    const complete=exampleOptions(preset.config.questions).at(-1),keys=Object.keys(complete.expected);
    for(const option of result) {
      if(option.presetRevision>=2 || option.text.trim()!==complete.text)continue;
      if(option.expected && keys.slice(0,6).every(id=>Object.hasOwn(option.expected,id))) {
        for(const id of keys.slice(6))if(!Object.hasOwn(option.expected,id))option.expected[id]=E.clone(complete.expected[id]);
      }
      // A later deliberate removal must remain removed across navigation/reload.
      option.presetRevision=complete.presetRevision;
    }
    return result;
  }
  function registry(value) {
    const result = value == null ? {schemaVersion:1,questions:[],utterances:[],contexts:[],states:[]} : E.clone(value);
    if(result.schemaVersion!==1)throw Error('Registro de nomes inválido.');
    for(const key of ['questions','utterances','contexts','states']) if(!Array.isArray(result[key]) || result[key].length>10000 || result[key].some(v=>typeof v!=='string' || v.length>128000) || new Set(result[key]).size!==result[key].length)throw Error('Registro de nomes inválido.');
    return result;
  }
  function identify(input, catalog) {
    E.validateInput(input);
    function index(key,value) {
      const encoded=canonical(value);let i=catalog[key].indexOf(encoded);
      if(i<0){if(catalog[key].length>=10000)throw Error('Limite do registro de nomes atingido.');i=catalog[key].push(encoded)-1;}
      return i+1;
    }
    const state=input.state, structured=state && !Array.isArray(state) && typeof state==='object' && Object.hasOwn(state,'current_utterance');
    const version=index('questions',input.config.questions),utterance=index('utterances',structured?state.current_utterance:state);
    const context=structured && Object.hasOwn(state,'recent_context')?index('contexts',state.recent_context):0;
    const extra=structured?Object.fromEntries(Object.entries(state).filter(([key])=>!['current_utterance','recent_context'].includes(key))):{};
    const stateId=Object.keys(extra).length?index('states',extra):0;
    const pad=value=>String(value).padStart(3,'0');
    return {version,utterance,context,state:stateId,name:'JEV-'+pad(version)+'-U'+pad(utterance)+'-C'+pad(context)+(stateId?'-S'+pad(stateId):'')};
  }
  function list(source, label) {
    let value;
    try { value = JSON.parse(source); } catch (_) { throw Error(label + ': JSON inválido.'); }
    if (!Array.isArray(value) || !value.length || value.length > 50) throw Error(label + ': use uma lista com 1 a 50 opções.');
    return value;
  }
  function named(entry, allowed) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || Object.keys(entry).some(key => !allowed.includes(key))) throw Error('Opção de variante inválida.');
    if (entry.name !== undefined && (typeof entry.name !== 'string' || !entry.name.trim() || entry.name.length > 80)) throw Error('Nome de variante inválido (1–80 caracteres).');
    return entry;
  }
  function plan(base, options, round = 1, savedRegistry = null) {
    E.validateInput(base);
    if (!Number.isInteger(round) || round < 1 || round > 999999) throw Error('Rodada inválida.');
    if (!['fixed', 'current_utterance', 'recent_context', 'state', 'mixed'].includes(options.field)) throw Error('Escolha o campo que vai variar.');
    const individual = Array.isArray(options.options);
    if(options.field==='mixed' && !individual)throw Error('Variações mistas precisam de opções com campo explícito.');
    if (!individual && (!['text', 'json'].includes(options.format) || !['none', 'fixed', 'variant'].includes(options.expectations))) throw Error('Formato ou política de esperados inválidos.');
    if (![1, 4, 10].includes(options.repeats)) throw Error('Escolha 1, 4 ou 10 execuções por cenário.');
    if (!individual && (typeof options.variants !== 'string' || options.variants.length > 256000)) throw Error('Variantes excedem o limite de tamanho.');
    // A restored/empty variation axis is still one executable base State.
    // Do not treat a deliberately added but incomplete option as an empty axis.
    const field = individual && options.options.length === 0 ? 'fixed' : options.field;
    let variants = [{ name: 'State fixo', value: base.state }];
    if (field !== 'fixed') {
      variants = individual ? options.options.map(entry=>{
        if(!entry || typeof entry.id!=='string' || typeof entry.text!=='string' || entry.text.length>16000)throw Error('Opção inválida.');
        const target=field==='mixed'?entry.field:field;
        if(!['current_utterance','recent_context','state'].includes(target))throw Error('Campo da variação inválido.');
        if(entry.editor!==undefined)throw Error('Conclua o JSON da variação antes de executar.');
        if(entry.name!==undefined && (typeof entry.name!=='string' || !entry.name.trim() || entry.name.length>100))throw Error('Nome da variação inválido.');
        const fullState=Object.hasOwn(entry,'state');let value=fullState?E.clone(entry.state):entry.text;
        if(fullState)E.validateState(value);
        else if(target==='state'){try{value=JSON.parse(value);}catch(_){throw Error('State da opção: JSON inválido.');}}
        return {value,fullState,expected:entry.expected || {},id:entry.id,field:target,name:entry.name};
      }) : options.format === 'json' ? list(options.variants, 'Variantes').map(entry => {
        if (typeof entry === 'string') return { value: entry };
        named(entry, ['name', 'value', 'expected']);
        if (!Object.hasOwn(entry, 'value')) throw Error('Cada variante JSON precisa de value.');
        return entry;
      }) : options.variants.trim().split(/\r?\n\s*\r?\n/).map(value => ({ value: value.trim() }));
      if (!variants.length || variants.length > 50 || variants.some(v => typeof v.value==='string' && !v.value.trim())) throw Error('Adicione de 1 a 50 opções com texto.');
      if(individual && new Set(variants.map(v=>v.id)).size!==variants.length)throw Error('IDs de opções repetidos.');
    }
    if(individual && field!=='fixed' && options.includeBase===true)variants.unshift({value:E.clone(base.state),fullState:true,expected:E.clone(base.expected),field:'state',id:undefined,name:options.baseName || undefined});
    // Only the applied Questions editor defines a campaign. Ignore obsolete draft axes.
    const count = variants.length, calls = count * options.repeats;
    if (count > 50 || calls > 200) throw Error('Limite por rodada: 50 cenários e 200 chamadas. Reduza variantes ou repetições.');
    const items = [], catalog=registry(savedRegistry);
    for (const [vi, variant] of variants.entries()) {
      const target=field==='mixed'?variant.field:field;
      let state = E.clone(base.state);
      if (variant.fullState || target === 'state') state = variant.value;
      else if (target !== 'fixed') {
        if (!state || typeof state !== 'object' || Array.isArray(state) || !Object.hasOwn(state, target)) throw Error('A base deve ser um State JSON com ' + target + '. Use o exemplo ou edite a base.');
        if (target === 'current_utterance' && typeof variant.value !== 'string') throw Error('current_utterance deve ser texto.');
        const value = target === 'recent_context' && typeof variant.value === 'string' ? variant.value.split(/\r?\n/).filter(line => line.trim()) : variant.value;
        if (target === 'recent_context' && (!Array.isArray(value) || value.some(line => typeof line !== 'string'))) throw Error('recent_context deve ser uma lista de textos.');
        state[target] = value;
      }
      // Variant labels are opt-in; never propagate the prototype's labels to new utterances.
      const expected = individual ? field==='fixed'?base.expected:variant.expected : options.expectations === 'fixed' ? base.expected : options.expectations === 'variant' ? variant.expected ?? {} : {};
      const parsed = E.parseRequest(JSON.stringify({model:base.config.model, state, questions:base.config.questions, expected}));
      const input = {name:'JEV', language:base.language, state:parsed.state, config:{model:parsed.model,questions:parsed.questions}, expected:parsed.expected};
      const identity=identify(input,catalog),code=identity.name,customName=field==='fixed'?options.baseName:variant.name;
      input.name=individual && customName ? customName : code;
      E.validateInput(input);
      if (new TextEncoder().encode(JSON.stringify(E.request(input))).length > 64000) throw Error('Um cenário excede 64 KB. Reduza o State ou as Questions.');
      // Retain archive metadata fields so older saved runs remain compatible.
      items.push({input, identity, optionId:variant.id, variant:vi + 1, questionVariant:1, label:code, questionLabel:'Questions do editor', code});
    }
    return E.clone({round, field, count, calls, repeats:options.repeats, variants:variants.length, items, registry:catalog});
  }
  root.NorteAutomation = { plan, sample, exampleOptions, completeDecisionDraft, registry, identify, canonical };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.NorteAutomation;
})(typeof globalThis !== 'undefined' ? globalThis : window);
