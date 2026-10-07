/* Platform commands are classified separately from meeting memories. */
(function (root) {
  'use strict';
  const E = typeof module !== 'undefined' && module.exports ? require('./experiments.js') : root.NorteExperiments;
  const threshold = .8;
  const types = ['rename_topic', 'other_command', 'conversation'];
  const defaults = { questions: { command_type: {
    type: 'choice',
    instructions: 'Classify the intent of utterance. Norte is the meeting platform wake word. A command must directly address Norte at the start of the utterance and request an operation on this meeting platform. When speech_continuation is present, utterance joins an immediately preceding incomplete naming request to the literal next speech fragment; raw_utterance is the new fragment. Treat that joined utterance as the direct request, without inventing any title words. Distinguish an actual request from a quotation, example, hypothetical, instruction about how to use commands, or a discussion of geographical north. Do not execute commands or generate a title. Available topics and active_topic_id only establish the current interface context; an unavailable target does not change the intended command category. Pick exactly one category.',
    criteria: {
      rename_topic: 'A direct request addressed to Norte to name or rename a discussion topic/thread, including a current/active topic. Examples: Norte, mude o título da thread 1 para Deformação do suporte. Norte, o assunto um é Deformação do suporte. The naming formula "Norte, o assunto N é TITLE" is a rename command, not project information. This remains rename_topic if target/title is missing or unavailable; execution validation is separate.',
      other_command: 'A direct operational request addressed to Norte that is not specifically renaming a discussion topic. Includes correcting/deleting a recorded statement, merging topics, changing a result, generating a document or other platform operations. These commands are not implemented yet.',
      conversation: 'Ordinary meeting content, including test proposals, engineering instructions, decisions, questions to people, references to Norte without a direct operational request, geographical north, quotes/examples of commands, hypothetical commands, or explaining how to use commands. A request without the Norte wake word is also conversation.'
    }
  } } };
  const clone = value => JSON.parse(JSON.stringify(value));
  function validateConfig(config = defaults) {
    if (!config || Object.keys(config).join() !== 'questions' || Object.keys(config.questions || {}).join() !== 'command_type') throw Error('Comandos: mantenha somente questions.command_type.');
    E.validateConfig({ model: 'jev-latest', questions: config.questions });
    const q = config.questions.command_type;
    if (q.type !== 'choice' || Object.keys(q.criteria).sort().join() !== [...types].sort().join()) throw Error('Comandos: mantenha a classificação rename_topic, other_command e conversation.');
    return clone(config);
  }
  const addressed = text => typeof text === 'string' && /^\s*Norte(?=$|[\s,!:;.—-])/i.test(text);
  const directInvocation = text => typeof text === 'string' && /^\s*Norte(?:\s*[,!:;.—-]|\s+(?:o\s+(?:assunto|t[oó]pico|thread)\b|por\s+favor\b|mude\b|altere\b|troque\b|renomeie\b|corrija\b|apague\b|exclua\b|remova\b|crie\b|gere\b|mostre\b|junte\b))/i.test(text);
  const activeId = (run, options) => Object.hasOwn(options, 'activeThreadId') ? options.activeThreadId : Object.hasOwn(options, 'active_thread_id') ? options.active_thread_id : run.meeting_threads?.find(topic => topic.status === 'active')?.thread_id ?? null;
  // Capture windows may end immediately after “o assunto um é”. Only the next
  // short microphone fragment can complete that explicit naming request.
  function interpret(text, { run = {}, source, speaker, nowMs = Date.now() } = {}) {
    const raw = String(text || ''), prior = run.meeting_commands?.at(-1);
    const result = { raw_text: raw, interpreted_text: raw, continuation: null };
    if (source !== 'microphone' || prior?.status !== 'awaiting_title' || prior.source !== 'microphone' || addressed(raw)) return result;
    if (speaker && prior.speaker && speaker !== prior.speaker) return result;
    const elapsed = nowMs - Date.parse(prior.created_at || ''), title = validTitle(raw);
    if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed > 15000 || !title || title.split(/\s+/).length > 18) return result;
    // A new proposition/question is ordinary meeting speech, never a guessed title.
    if (/^(?:n[aã]o|sim|mas|ent[aã]o|vamos|talvez|eu|voc[eê]|a gente|acho|quero|pode|precisa|temos|tem que|ser[aá]|o que|como|quando|se)\b/iu.test(title) || /[?!]|\b(?:norte|disse|falou|devemos|deveria|precisamos|sugiro)\b/iu.test(title)) return result;
    return { raw_text: raw, interpreted_text: prior.interpreted_text + ' ' + title,
      continuation: { command_id: prior.id, chunk_id: prior.chunk_id || null, target_id: prior.parsed?.thread_id || null } };
  }
  function buildRequest(text, { run = {}, config = defaults, ...options } = {}) {
    if (typeof text !== 'string' || !text.trim()) throw Error('O trecho da reunião está vazio.');
    const request = {
      model: 'jev-latest',
      state: {
        utterance: text,
        ...(options.interpretation?.continuation ? { raw_utterance: options.interpretation.raw_text, speech_continuation: options.interpretation.continuation } : {}),
        active_topic_id: activeId(run, options),
        available_topics: (run.meeting_threads || []).map(topic => ({ topic_id: topic.thread_id, title: run.topic_titles?.[topic.thread_id] || topic.title || null }))
      },
      questions: validateConfig(config).questions
    };
    E.validateState(request.state);
    return request;
  }
  function validTitle(value) {
    if (typeof value !== 'string' || /[\r\n\u0000-\u001f\u007f<>]/u.test(value)) return null;
    let title = value.trim().replace(/[,;]?\s+por\s+favor[.!]?$/i, '').replace(/\.$/, '').trim();
    if (/^["“”'‘’]|["“”'‘’]$/u.test(title)) {
      const pairs = { '"': '"', "'": "'", '“': '”', '‘': '’' };
      if (pairs[title[0]] !== title.at(-1)) return null;
      title = title.slice(1, -1).trim();
    }
    if (title.length < 2 || title.length > 140 || !/[\p{L}\p{N}]/u.test(title)) return null;
    // One utterance can rename one topic. Compound operations must be separate.
    if (/\b(?:e|depois|em seguida|ent[aã]o)\s+(?:Norte\b|mude\b|renomeie\b|altere\b|apague\b|exclua\b|corrija\b|remova\b|crie\b)/iu.test(title)) return null;
    return title;
  }
  function parse(text, { run = {}, ...options } = {}) {
    if (!addressed(text)) return { addressed: false, valid: false, status: 'not_addressed' };
    const command = text.replace(/^\s*Norte[\s,!:;.—-]*/i, '').replace(/^por\s+favor[,\s]+/i, '');
    const prefix = /^(?:(?:mude|altere|troque)\s+o\s+t[ií]tulo\s+|renomeie\s+)/i;
    const declaration=command.match(/^(?:o\s+)?((?:assunto|t[oó]pico|thread)\s+(?:n[uú]mero\s+)?(?:\d{1,6}|[\p{L}]+))\s+[ée](?:\s+([\s\S]*))?$/iu);
    if (!prefix.test(command)&&!declaration) return { addressed: true, valid: false, status: 'invalid_syntax' };
    const rest = command.replace(prefix, '');
    const match = declaration||rest.match(/^(.*?)\s+para(?:\s+([\s\S]*))?$/i);
    if (!match) return { addressed: true, valid: false, status: 'invalid_syntax' };
    const target = match[1].trim(), title = validTitle(match[2]);
    if (!title && String(match[2] || '').trim()) return { addressed: true, valid: false, status: 'invalid_title' };
    const spoken = {um:1,uma:1,dois:2,duas:2,tres:3,quatro:4,cinco:5,seis:6,sete:7,oito:8,nove:9,dez:10,onze:11,doze:12,treze:13,catorze:14,quatorze:14,quinze:15,dezesseis:16,dezasseis:16,dezessete:17,dezassete:17,dezoito:18,dezenove:19,dezanove:19,vinte:20};
    const numeric = target.match(/^(?:(?:d[ao]|[oa])\s+)?(?:thread|assunto|t[oó]pico)\s+(?:n[uú]mero\s+)?(?:T\s*)?(\d{1,6}|um|uma|dois|duas|tr[eê]s|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|catorze|quatorze|quinze|dezesseis|dezasseis|dezessete|dezassete|dezoito|dezenove|dezanove|vinte)$/i);
    const current = /^(?:(?:deste|desse|desta|dessa|este|esse|esta|essa)\s+(?:assunto|t[oó]pico|thread)|(?:(?:d[ao]|[oa])\s+)?(?:assunto|t[oó]pico|thread)\s+atual)$/i.test(target);
    if (!numeric && !current) return { addressed: true, valid: false, status: 'invalid_target' };
    const id = numeric ? 'T' + String(spoken[numeric[1].normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()] || Number(numeric[1])).padStart(3, '0') : activeId(run, options);
    if (!id || !run.meeting_threads?.some(topic => topic.thread_id === id)) return { addressed: true, valid: false, status: 'missing_target', thread_id: id, title };
    if (!title) return { addressed: true, valid: false, status: 'awaiting_title', thread_id: id };
    return { addressed: true, valid: true, status: 'parsed', thread_id: id, title };
  }
  const help = 'Diga: “Norte, mude o título do assunto 1 para Deformação do suporte”.';
  const messages = {
    awaiting_title: 'Continue com o nome do assunto.',
    invalid_syntax: 'Não consegui identificar a renomeação. ' + help,
    invalid_target: 'Indique o número do assunto ou diga “deste assunto”. ' + help,
    invalid_title: 'Use um título de 2 a 140 caracteres, sem quebras de linha ou outra instrução no mesmo comando.',
    missing_target: 'Esse assunto ainda não está no mapa. Aguarde sua criação e repita o comando.',
    unsupported: 'Esse comando ainda não está disponível. Por enquanto, você pode mudar o título de um assunto.',
    low_confidence: 'O comando ficou ambíguo e nenhum título foi alterado. ' + help,
    not_confirmed: 'Não confirmei um comando de renomeação e nenhum título foi alterado. ' + help,
    classification_error: 'Não foi possível verificar o comando agora. Nenhum título foi alterado; tente novamente.'
  };
  async function process(text, options = {}) {
    const run = options.run || {}, send = options.transport || options.send;
    if (typeof send !== 'function') throw Error('Forneça o transporte de classificação em transport ou send.');
    const interpretation = interpret(text, options), commandText = interpretation.interpreted_text;
    const audit = {
      id: 'CMD' + String((run.meeting_commands?.length || 0) + 1).padStart(4, '0'),
      text, raw_text: text, interpreted_text: commandText, source: options.source || 'unspecified', ...(options.speaker ? { speaker: options.speaker } : {}),
      ...(interpretation.continuation ? { continuation: interpretation.continuation } : {}),
      ...(options.chunkId ? { chunk_id: options.chunkId } : {}),
      created_at: new Date(options.nowMs ?? Date.now()).toISOString(), status: 'classifying', addressed: addressed(commandText),
      consumed: addressed(commandText), renamed: false, command_type: null, probability: null,
      request: null, output: null
    };
    (run.meeting_commands ||= []).push(audit);
    const finish = (status, extra = {}) => {
      Object.assign(audit, { status, message: messages[status] || '' }, extra);
      options.onChange?.(run, audit);
      return clone(audit);
    };
    try {
      const request = buildRequest(commandText, { ...options, interpretation,
        ...(interpretation.continuation?.target_id ? { activeThreadId: interpretation.continuation.target_id } : {}) });
      audit.request = clone(request);
      const output = await send(clone(request), { endpoint: '/api/classify', provider: options.provider || run.provider });
      audit.output = clone(output);
      E.validateOutput(output, { state: request.state, config: { model: request.model, questions: request.questions } });
      const provider = options.provider || run.provider;
      if (provider && output.provider !== provider) throw Error('A classificação retornou outro provedor.');
      const answer = output.response.answers.command_type;
      audit.command_type = answer.choice;
      audit.probability = answer.probabilities[answer.choice];
      audit.api_confidence = answer.confidence;
    } catch (error) {
      return finish('classification_error', { error: error.message, consumed: directInvocation(commandText) });
    }
    if (!audit.addressed) return finish('conversation', { consumed: false });
    if (audit.command_type === 'conversation' && !directInvocation(commandText)) return finish('conversation', { consumed: false });
    if (audit.probability + 1e-12 < threshold) return finish('low_confidence');
    if (audit.command_type === 'other_command') return finish('unsupported');
    if (audit.command_type !== 'rename_topic') return finish('not_confirmed');
    // Resolve the current-topic reference against the command-time snapshot,
    // and verify that this target still exists when the response arrives.
    const parsed = parse(commandText, { ...options, activeThreadId: audit.request.state.active_topic_id });
    if (!parsed.valid) return finish(parsed.status, { parsed });
    if (!audit.request.state.available_topics.some(topic => topic.topic_id === parsed.thread_id)) return finish('missing_target', { parsed });
    const topic = run.meeting_threads.find(item => item.thread_id === parsed.thread_id);
    const previousTitle = run.topic_titles?.[parsed.thread_id] || topic.title || null;
    (run.topic_titles ||= {})[parsed.thread_id] = parsed.title;
    topic.title = parsed.title;
    return finish('renamed', {
      renamed: true, thread_id: parsed.thread_id, previous_title: previousTitle, title: parsed.title,
      message: 'Título atualizado para “' + parsed.title + '”.'
    });
  }
  const api = { defaults, types, threshold, validateConfig, buildRequest, request: buildRequest, addressed, validTitle, interpret, parse, process, route: process };
  root.NorteMeetingCommands = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
