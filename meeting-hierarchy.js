/* A deterministic view of classified meeting memory; never invents semantic links. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NorteMeetingHierarchy = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const labels = {observation:'Observação',hypothesis:'Hipótese',test_proposal:'Teste',test_result:'Resultado',decision:'Decisão',requirement:'Requisito',other:'Registro'};
  const copy = value => JSON.parse(JSON.stringify(value));
  const text = value => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  const sourceId = edge => edge.source_event_id || edge.source_id || edge.event_id;
  const targetId = edge => edge.target_event_id || edge.target_id;

  function relationApi() {
    if (root.NorteTypedRelations) return root.NorteTypedRelations;
    if (typeof require === 'function') {
      try { return require('./typed-relations.js'); } catch (_) { /* An offline fallback keeps tests open. */ }
    }
    return null;
  }

  function topicTitle(run, thread, events) {
    const manual = text(run.topic_titles?.[thread?.thread_id]) || text(thread?.title);
    if (manual) return manual;
    return 'Assunto sem título';
  }

  // An edge points from the child/assertion toward the existing claim or plan.
  // related_to has a precise explanation meaning only for this typed pair.
  function parentRole(edge, child, parent) {
    if (edge.relation_type === 'result_of' && child.type === 'test_result' && parent.type === 'test_proposal') return {priority:3,kind:'result'};
    if (edge.relation_type === 'tests' && child.type === 'test_proposal' && ['hypothesis','requirement','observation'].includes(parent.type)) return {priority:2,kind:'test'};
    if (['related_to','explains','addresses'].includes(edge.relation_type) && child.type === 'hypothesis' && ['observation','test_result'].includes(parent.type)) return {priority:1,kind:'explanation'};
    return null;
  }

  function build(run) {
    if (!run || !Array.isArray(run.meeting_events)) throw Error('A memória da reunião precisa conter meeting_events.');
    const events = run.meeting_events.map(copy);
    const ids = new Set();
    for (const event of events) {
      if (typeof event.event_id !== 'string' || !event.event_id || ids.has(event.event_id)) throw Error('A memória contém um identificador de evento ausente ou repetido.');
      ids.add(event.event_id);
    }
    const nodes = new Map(events.map(event => [event.event_id, {
      id:event.event_id,event,type:event.type,text:String(event.text || ''),label:labels[event.type] || labels.other,
      children:[],parent_id:null,parent_relation_id:null,lifecycle:null,status:['hypothesis','test_proposal'].includes(event.type) ? 'open' : 'active',
      completed:false,review:[]
    }]));
    const review = [], reviewIds = new Set();
    function warn(id, message, eventIds = [], relationIds = [], kind = 'review') {
      if (reviewIds.has(id)) return;
      reviewIds.add(id);
      const item = {id,message,event_ids:[...new Set(eventIds.filter(Boolean))],relation_ids:[...new Set(relationIds.filter(Boolean))],kind};
      review.push(item);
      for (const eventId of item.event_ids) nodes.get(eventId)?.review.push(item);
    }

    const api = relationApi(), threshold = api?.threshold || .8;
    const confirmed = edge => edge.review_state === 'confirmed' && !edge.error &&
      Number.isFinite(edge.relation_probability) && edge.relation_probability + 1e-12 >= threshold &&
      Number.isFinite(edge.match_probability) && edge.match_probability + 1e-12 >= threshold;
    const relations = (run.meeting_relations || []).filter(edge => edge && edge.relation_type && edge.relation_type !== 'none').map((edge, index) => ({
      ...copy(edge),relation_id:edge.relation_id || edge.id || 'relation-' + index,source_event_id:sourceId(edge),target_event_id:targetId(edge)
    }));
    const eligible = [], candidates = new Map();
    for (const edge of relations) {
      const child = nodes.get(edge.source_event_id), parent = nodes.get(edge.target_event_id);
      const eventIds = [edge.source_event_id,edge.target_event_id], relationIds = [edge.relation_id];
      if (!child || !parent) {
        warn('missing:' + edge.relation_id, 'Uma relação faz referência a um ponto que não está disponível.', eventIds, relationIds);
        continue;
      }
      if (!child.event.thread_id || child.event.thread_id !== parent.event.thread_id) {
        warn('topic:' + edge.relation_id, 'A relação envolve assuntos diferentes ou ainda sem assunto definido; os pontos permanecem separados.', eventIds, relationIds);
        continue;
      }
      // The same boundaries apply to lifecycle: an invalid cross-topic edge must
      // never mark a plan complete merely because its ID was found.
      const isConfirmed = confirmed(edge);
      eligible.push(isConfirmed ? edge : {...edge,review_state:'needs_review'});
      if (!isConfirmed) {
        warn('uncertain:' + edge.relation_id, 'O vínculo entre estes pontos precisa de revisão antes de agrupá-los.', eventIds, relationIds);
        continue;
      }
      if (edge.configuration_match === 'ambiguous') {
        warn('configuration:' + edge.relation_id, 'Não está claro qual configuração foi usada; os pontos permanecem separados.', eventIds, relationIds);
        continue;
      }
      const role = parentRole(edge, child, parent);
      if (!role) continue;
      if (role.kind === 'result' && !['exact','partial','mismatch'].includes(edge.configuration_match)) {
        warn('configuration:' + edge.relation_id, 'Falta confirmar a configuração deste resultado antes de associá-lo ao teste.', eventIds, relationIds);
        continue;
      }
      if (['partial','mismatch'].includes(edge.configuration_match)) {
        warn('configuration:' + edge.relation_id,
          edge.configuration_match === 'mismatch' ? 'O resultado ou vínculo usa uma configuração diferente. Isso não comprova a execução do teste planejado.' : 'A configuração está descrita parcialmente. Confirme as condições antes de considerar o teste realizado.',
          eventIds, relationIds);
      }
      if (!candidates.has(child.id)) candidates.set(child.id, []);
      candidates.get(child.id).push({child,parent,edge,...role});
    }

    let lifecycle = null;
    try { lifecycle = api?.lifecycle({...run,meeting_events:events,meeting_relations:eligible}) || null; }
    catch (_) { warn('lifecycle', 'O andamento dos testes precisa de revisão; propostas permanecem em aberto.'); }
    for (const node of nodes.values()) {
      const state = lifecycle?.[node.id];
      if (state) {
        node.lifecycle = copy(state);
        node.status = state.status;
        node.completed = node.type === 'test_proposal' && state.status === 'completed';
        if (state.review_required) {
          for (const [index, reason] of (state.reasons || []).entries()) {
            // Completed/superseded explanations are ordinary state, not warnings.
            if (/^Resultado direto|^Substituição explícita/.test(reason)) continue;
            if (reason === 'Evento sem thread atribuída.') continue;
            if (/^Relação com classificação|^Esta aresta não comprova/.test(reason) && node.review.some(item => item.relation_ids.some(id => (state.relation_ids || []).includes(id)))) continue;
            warn('state:' + node.id + ':' + index, reason, [node.id], state.relation_ids || []);
          }
        }
      }
      if (!node.event.thread_id) warn('unassigned:' + node.id, 'Este ponto ainda precisa ser associado a um assunto.', [node.id]);
    }

    const selected = [];
    for (const [eventId, choices] of candidates) {
      const unique = [...new Map(choices.map(choice => [choice.parent.id,choice])).values()];
      if (unique.length > 1) {
        warn('parents:' + eventId, 'Este ponto tem vínculos confirmados com mais de um item. Revise onde ele deve aparecer na hierarquia.',
          [eventId,...unique.map(choice => choice.parent.id)], unique.map(choice => choice.edge.relation_id));
      } else selected.push(unique[0]);
    }
    // Resolve the strongest structural roles first, keeping result -> test
    // intact if malformed historical links would otherwise create a cycle.
    selected.sort((a,b) => b.priority - a.priority);
    for (const {child,parent,edge} of selected) {
      let cursor = parent, cyclic = false;
      while (cursor) {
        if (cursor.id === child.id) { cyclic = true; break; }
        cursor = cursor.parent_id ? nodes.get(cursor.parent_id) : null;
      }
      if (cyclic) {
        warn('cycle:' + edge.relation_id, 'Este vínculo criaria uma hierarquia circular e precisa de revisão.', [child.id,parent.id], [edge.relation_id]);
        continue;
      }
      child.parent_id = parent.id;
      child.parent_relation_id = edge.relation_id;
      parent.children.push(child);
    }
    // Keep the chronology within every box, independent of classifier edge order.
    const positions = new Map(events.map((event,index) => [event.event_id,index]));
    for (const node of nodes.values()) node.children.sort((a,b) => positions.get(a.id) - positions.get(b.id));

    for (const job of run.typed_relation_worker?.jobs || []) {
      if (['error','interrupted'].includes(job.status)) warn('processing:' + job.event_id, 'A organização deste ponto não foi concluída; seus vínculos precisam de revisão.', [job.event_id]);
      for (const result of job.results || []) {
        if (result.relation_type === 'none' && result.review_state === 'needs_review') {
          warn('negative:' + job.event_id + ':' + result.target_event_id, 'A ausência de vínculo entre estes pontos ainda precisa de revisão.', [job.event_id,result.target_event_id]);
        }
      }
    }
    const sourceThreads = run.meeting_threads || [];
    const threadIds = [...new Set([...sourceThreads.map(thread => thread.thread_id),...events.map(event => event.thread_id)].filter(Boolean))];
    if (events.some(event => !event.thread_id)) threadIds.push(null);
    const topics = threadIds.map(id => {
      const group = events.filter(event => (event.thread_id || null) === id);
      if (!group.length) return null;
      const thread = sourceThreads.find(item => item.thread_id === id) || {thread_id:id};
      const groupIds = new Set(group.map(event => event.event_id));
      return {
        id,title:id ? topicTitle(run,thread,group) : 'Pontos a organizar',
        nodes:group.map(event => nodes.get(event.event_id)).filter(node => !node.parent_id),event_count:group.length,
        review:review.filter(item => item.event_ids.some(eventId => groupIds.has(eventId)))
      };
    }).filter(Boolean);
    return {topics,review,metrics:{topics:topics.length,events:events.length,nested:events.length - topics.reduce((total,topic) => total + topic.nodes.length,0),reviews:review.length}};
  }

  return {build,topicTitle,labels};
});
