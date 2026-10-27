/* Interface language for the meeting room. The room is written in Portuguese;
 * in English this layer swaps exact interface strings in the DOM and restores
 * them when switching back. Meeting content (speech, blocks, titles, minutes
 * text and anything typed) is never translated. */
(function (root) {
  'use strict';
  const EN = {
    'Reunião · Norte': 'Meeting · Norte', 'Reuniões': 'Meetings', 'Nova reunião': 'New meeting', 'Criar instantânea': 'Create instant', 'Abrir uma sala agora': 'Open a room now', 'Agendar': 'Schedule', 'Em breve': 'Coming soon',
    'Lista de reuniões': 'Meeting list', 'Todas as reuniões': 'All meetings', 'Reunião': 'Meeting', 'Criada em': 'Created', 'Status': 'Status', 'Ações': 'Actions', 'Nenhuma reunião ainda': 'No meetings yet', 'Crie uma reunião instantânea para começar.': 'Create an instant meeting to start.', 'Abrir': 'Open',
    'Voltar para reuniões': 'Back to meetings', 'Título da reunião': 'Meeting title', 'Ainda não iniciada': 'Not started yet', 'Iniciar gravação': 'Start recording', 'Importar transcrição': 'Import transcript', 'Ata / PDF': 'Minutes / PDF',
    'Sala de reunião': 'Meeting room', 'Área de trabalho da reunião': 'Meeting workspace', 'Canvas': 'Canvas', 'Assuntos': 'Topics', 'Dependências': 'Dependencies', 'Transcrição': 'Transcript', 'Mostrar ou ocultar dependências': 'Show or hide dependencies', 'Mostrar ou ocultar transcrição': 'Show or hide transcript',
    'Canvas de assuntos da reunião': 'Meeting topics canvas', 'Os assuntos da reunião aparecerão aqui.': 'Meeting topics will appear here.', 'Inicie a gravação ou importe uma transcrição.': 'Start recording, write below or import a transcript.', 'Os assuntos aparecerão aqui conforme a conversa avançar.': 'Topics will appear here as the conversation moves on.',
    'Status dos registros': 'Record status', 'Aberto': 'Open', 'Concluído': 'Complete', 'Revisar': 'Review', 'Conflito / erro': 'Conflict / error', 'Substituído': 'Superseded', 'Registrado': 'Recorded', 'Conflito': 'Conflict', 'Erro': 'Error', 'Pendente': 'Pending',
    'Zoom do canvas': 'Canvas zoom', 'Diminuir canvas': 'Zoom out', 'Ampliar canvas': 'Zoom in', 'Ajustar blocos ao canvas': 'Fit blocks to canvas', 'Ajustar ao canvas': 'Fit to canvas', 'Altura do canvas e da transcrição': 'Canvas and transcript height', 'Arraste para redimensionar · duplo clique para restaurar': 'Drag to resize · double-click to restore',
    'Revisão da reunião': 'Meeting review', 'Revisão': 'Review', 'Atenções': 'Attention', 'Informações pendentes': 'Pending information', 'Transcrição da reunião': 'Meeting transcript', 'Idioma da fala': 'Speech language', 'A transcrição aparecerá aqui': 'The transcript will appear here',
    'Acrescentar fala': 'Add speech', 'Fala ou comando': 'Speech or command', 'Escreva algo para a reunião…': 'Write something for the meeting…', 'Adicionar': 'Add', 'Escreva uma mensagem…': 'Write a message…', 'Enviar': 'Send', 'Mensagem para a reunião': 'Message for the meeting', 'Recolher': 'Collapse', 'Recolher transcrição': 'Collapse transcript',
    'Importar uma transcrição para esta reunião': 'Import a transcript into this meeting', 'Fechar importação': 'Close import', 'Escolher arquivo ou arrastar aqui': 'Choose a file or drop it here', 'Selecionar arquivo': 'Choose file', 'TXT, MD, SRT, VTT ou JSON · até 500 mil caracteres': 'TXT, MD, SRT, VTT or JSON · up to 500 thousand characters',
    'Ou cole o texto da reunião': 'Or paste the meeting text', 'Cole as falas em ordem. Cada linha pode ser uma fala…': 'Paste the speech in order. Each line can be one turn…', 'O mapa será construído conforme a leitura avançar.': 'The map is built as reading progresses.', 'Construir mapa': 'Build map',
    'Nome do assunto': 'Topic name', 'Cancelar': 'Cancel', 'Salvar nome': 'Save name', 'Fechar': 'Close', 'Pausar microfone': 'Pause microphone', 'Encerrar reunião': 'Finish meeting', 'Interromper processamento': 'Stop processing', 'Neste navegador': 'In this browser', 'Na sua conta': 'In your account', 'Salvo na sua conta': 'Saved in your account', 'Salvando…': 'Saving…', 'Falha ao salvar': 'Save failed',
    'Gravar': 'Record', 'Pausar': 'Pause', 'Pausando…': 'Pausing…', 'Retomar': 'Resume', 'Continuar gravação': 'Continue recording', 'Concluída': 'Complete', 'Interrompida': 'Interrupted',
    'Acompanhando reunião ao vivo': 'Following the live meeting', 'Concluindo os últimos registros…': 'Finishing the last records…', 'Reunião concluída': 'Meeting complete', 'Reunião preservada · confira as pendências': 'Meeting preserved · check pending items', 'Gravando reunião': 'Recording meeting', 'Gravação pausada': 'Recording paused', 'Reunião em andamento': 'Meeting in progress', 'Iniciar por texto': 'Start by text', 'Retomar por texto': 'Resume by text',
    'Organizando': 'Organizing', 'Organizado': 'Organized', 'Editado': 'Edited', 'Organizando o título': 'Organizing title',
    'Texto organizado a partir da fala original': 'Text organized from the original speech', 'Síntese validada da ata; a fala original continua preservada': 'Validated synthesis from the minutes; the original speech is preserved', 'Texto editado por uma pessoa; a fala original continua preservada': 'Text edited by a person; the original speech is preserved',
    'Problema': 'Problem', 'Hipóteses': 'Hypotheses', 'Testes': 'Tests', 'Pontos a organizar': 'Points to organize', 'Este registro ainda precisa ser associado a um assunto.': 'This record still needs a topic.', 'Este ponto ainda precisa ser associado a um assunto.': 'This point still needs a topic.', 'Há evidência direta que contradiz este registro.': 'There is direct evidence contradicting this record.', 'Este problema ainda não tem resolução explicitamente vinculada.': 'This problem has no explicitly linked resolution yet.', 'Ainda sem fechamento registrado.': 'No closure recorded yet.', 'Ainda falta confirmar a qual assunto esta fala se refere.': 'The topic of this speech still needs confirmation.', 'Assunto sem título': 'Untitled topic', 'Nenhum registro.': 'No records.', 'Ver detalhes': 'View details', 'Recolher registros relacionados': 'Collapse related records',
    'Ver detalhes deste registro': 'View record details', 'Editar texto do bloco': 'Edit block text', 'Editar resumo do bloco': 'Edit block summary', 'Clique para ver detalhes · duplo clique para editar': 'Click for details · double-click to edit', 'Ver pontos para revisão': 'View points to review', 'Revisar classificação': 'Review classification', 'Abrir detalhes da classificação': 'Open classification details',
    'Em aberto': 'Open', 'Resultado': 'Result', 'Teste': 'Test', 'TESTE': 'TEST', 'PROBLEMA': 'PROBLEM', 'Observação': 'Observation', 'Hipótese': 'Hypothesis', 'Teste proposto': 'Proposed test', 'Resultado de teste': 'Test result', 'Decisão': 'Decision', 'Requisito': 'Requirement', 'Tarefa ou outro ponto': 'Task or other point',
    'Detalhes do registro': 'Record details', 'Detalhes da dependência': 'Dependency details', 'Ponto em acompanhamento': 'Point being tracked', 'Revisar registro': 'Review record', 'Registro': 'Record', 'Ação': 'Action', 'Significado do vínculo': 'Link meaning', 'Referência da própria reunião': 'Reference in this meeting', 'Justificativa': 'Rationale',
    'Associar a um assunto': 'Assign to a topic', 'Ligar referência': 'Link a reference', 'Resolver com uma decisão': 'Resolve with a decision', 'Confirmar substituição': 'Confirm replacement', 'Esclarece': 'Clarifies', 'Baseia-se em': 'Based on', 'Depende de': 'Depends on', 'Sustenta': 'Supports', 'Contradiz': 'Contradicts',
    'Salvar revisão': 'Save review', 'Reclassificar': 'Reclassify', 'Conferir teste na ata': 'Check test in minutes', 'Diagnóstico técnico · administrador': 'Technical diagnostics · administrator', 'Ver observação': 'View note', 'Horário da fala': 'Speech time',
    'Editar texto do bloco ': 'Edit block text', 'Escreva tópicos curtos. A fala original continua preservada.': 'Write short points. The original speech is preserved.', 'Fala original': 'Original speech', 'Resumo para exibição': 'Display summary', 'Classificação': 'Classification', 'O que foi corrigido? (opcional)': 'What was corrected? (optional)',
    'Usar esta correção nas próximas falas desta reunião': 'Use this correction for the next turns of this meeting', 'Salvar resumo': 'Save summary', 'Usar original': 'Use original', 'Avaliar sugestão da IA': 'Review AI suggestion', 'Desfazer última orientação': 'Undo last guidance', 'Um ponto por linha, com frases curtas.': 'One point per line, in short sentences.',
    'Revisar título': 'Review title', 'Revisar síntese': 'Review synthesis', 'Texto para exibição': 'Display text', 'Está bom': 'Looks good', 'Salvar correção': 'Save correction', 'Fala original preservada. Sua avaliação ajuda a revisar conteúdos iguais no mesmo contexto.': 'Original speech preserved. Your review helps with identical content in the same context.',
    'Organizando tópicos…': 'Organizing notes…', 'Organização automática desativada': 'Automatic organization disabled', 'Organização indisponível; falas preservadas': 'Organization unavailable; speech preserved', 'Classificador ajustado': 'Classifier adjusted', 'Estilo das notas': 'Note style',
    'A conexão de processamento não está pronta. Confira o serviço antes de começar.': 'The processing connection is not ready. Check the service before starting.', 'Não foi possível conectar. Verifique se o serviço está aberto.': 'Could not connect. Check that the service is running.',
    'A organização por IA não está ativada neste servidor. As falas originais continuam disponíveis.': 'AI organization is not enabled on this server. The original speech remains available.', 'A organização por IA está indisponível agora. As falas originais foram preservadas.': 'AI organization is unavailable right now. The original speech was preserved.',
    'Este navegador não oferece transcrição por voz. Continue por texto ou use um navegador compatível.': 'This browser offers no speech transcription. Continue by text or use a compatible browser.', 'A fala ao vivo não está disponível neste navegador. Use Chrome com microfone habilitado ou importe uma transcrição.': 'Live speech is not available in this browser. Use Chrome with the microphone enabled or import a transcript.',
    'Esta reunião foi interrompida. Os registros recebidos foram preservados; gere a ata com os avisos de revisão.': 'This meeting was interrupted. Received records were preserved; generate the minutes with the review notices.',
    'Fala não confirmada pelo microfone; não entrou no mapa.': 'Speech not confirmed by the microphone; not added to the map.', 'Fala preservada após a interrupção; não foi processada.': 'Speech preserved after the interruption; not processed.',
    // Minutes controls and review panel; the minutes paper itself stays in the meeting language, like its PDF.
    'Ata da reunião': 'Meeting minutes', 'Resumir ata com IA': 'Summarize minutes with AI', 'Organizar novamente': 'Organize again', 'Baixar PDF': 'Download PDF', 'Resume cada ponto e organiza tabelas com os valores registrados': 'Summarizes each point and organizes tables with the recorded values',
    'Voltar ao canvas': 'Back to canvas', 'Voltar aos avisos': 'Back to notices', 'Exportar correções': 'Export corrections', 'Informações não incluídas': 'Information not included', 'Esclarecer trecho': 'Clarify passage', 'Fechar revisão': 'Close review', 'Revisão do documento': 'Document review', 'Sumário da ata': 'Minutes contents',
    'Diagnóstico técnico': 'Technical diagnostics', 'Explorar registros': 'Explore records', 'Ver registro completo na reunião': 'View the full record in the meeting', 'Sem assunto confirmado': 'No confirmed topic', 'Documento': 'Document', 'Classificação ainda não confirmada.': 'Classification not confirmed yet.',
    'Pendente · revisar': 'Pending · review', 'Concluído · revisar': 'Complete · review', 'Conferir teste': 'Check test', 'Reabrir teste': 'Reopen test', 'Reabrir para corrigir': 'Reopen to correct', 'Confirmar em aberto': 'Confirm as open', 'Manter teste desconhecido': 'Keep test unknown', 'Teste desconhecido': 'Unknown test',
    'Registrar conclusão': 'Record conclusion', 'Salvar conclusão': 'Save conclusion', 'Confirmar a conclusão deste teste': 'Confirm this test’s conclusion', 'Associar ao teste': 'Link to test', 'Associar resultado': 'Link result', 'Associar este resultado a um teste': 'Link this result to a test', 'Selecione o teste': 'Select the test', 'Teste associado ao resultado': 'Test linked to the result', 'Teste deste assunto': 'Test in this topic',
    'O que foi feito?': 'What was done?', 'Data do teste': 'Test date', 'Qual foi o resultado?': 'What was the result?', 'O teste atendeu ao esperado?': 'Did the test meet expectations?', 'O que falta validar?': 'What is left to validate?', 'Qual teste produziu este resultado?': 'Which test produced this result?', 'Selecione': 'Select', 'Sim': 'Yes', 'Não': 'No', 'Ainda não avaliado': 'Not assessed yet',
    'Há um resultado associado a este teste.': 'A result is linked to this test.', 'Não encontramos uma conclusão associada. Este teste chegou a ser concluído?': 'No linked conclusion was found. Was this test completed?', 'Não há um teste identificado neste assunto.': 'No test was identified in this topic.', 'O resultado ficará identificado como teste desconhecido.': 'The result will be marked as an unknown test.',
    'Conclusão registrada.': 'Conclusion recorded.', 'Correção salva.': 'Correction saved.', 'Teste mantido em aberto.': 'Test kept open.', 'Resultado associado ao teste.': 'Result linked to the test.', 'Esclarecimento aplicado': 'Clarification applied', 'O documento foi atualizado com as informações confirmadas.': 'The document was updated with the confirmed information.',
    'Analisar esclarecimento': 'Analyze clarification', 'Analisar inclusão': 'Analyze inclusion', 'Aplicar esclarecimento': 'Apply clarification', 'Confirmar inclusão': 'Confirm inclusion', 'Informações adicionais para o trecho': 'Additional information for the passage', 'Não há informações excluídas por confiabilidade.': 'No information was excluded for reliability.',
    'Estes trechos não entraram no documento. Você pode acrescentar detalhes e solicitar uma nova análise.': 'These passages were left out of the document. You can add details and request a new analysis.', 'Acrescente os detalhes que esclarecem este ponto. A nova informação será analisada e associada ao assunto antes de atualizar a ata.': 'Add the details that clarify this point. The new information is analyzed and linked to the topic before the minutes are updated.',
    'Acrescente informações ou explique por que este trecho deve entrar na ata…': 'Add information or explain why this passage belongs in the minutes…', 'Explique a qual teste ou informação esta fala se refere e acrescente os detalhes necessários…': 'Explain which test or information this speech refers to and add the details needed…', 'Descreva o que ainda precisa ser feito ou confirmado.': 'Describe what still needs to be done or confirmed.',
    'Acrescente mais detalhes para esclarecer este trecho.': 'Add more details to clarify this passage.', 'Acrescente mais detalhes para esclarecer o trecho.': 'Add more details to clarify the passage.', 'A revisão deste trecho ainda não está disponível.': 'Review of this passage is not available yet.', 'Verificando o trecho com os registros da reunião…': 'Checking the passage against the meeting records…', 'Classificando e associando o trecho ao assunto…': 'Classifying the passage and linking it to the topic…',
    'Resumindo os tópicos e organizando os valores registrados…': 'Summarizing topics and organizing the recorded values…', 'Confira estes testes antes de baixar. Você pode corrigir os resultados ou confirmar o que continua em aberto.': 'Check these tests before downloading. You can correct the results or confirm what is still open.', 'Os testes foram conferidos. Você já pode baixar o PDF.': 'The tests were checked. You can download the PDF now.',
    'Revisão aplicada. O documento foi atualizado com os registros confirmados.': 'Review applied. The document was updated with the confirmed records.', 'Os registros mudaram durante a organização. O documento atual foi preservado; organize novamente para incluir as alterações.': 'The records changed while organizing. The current document was preserved; organize again to include the changes.',
    'A ata está aberta, mas ainda não foi salva. Exporte uma cópia e tente novamente.': 'The minutes are open but not saved yet. Export a copy and try again.', 'Não foi possível salvar a ata. Exporte uma cópia para preservar as alterações.': 'Could not save the minutes. Export a copy to keep the changes.', 'A ata estará disponível quando houver pontos registrados na reunião.': 'The minutes will be available once the meeting has recorded points.',
    'Algumas correções anteriores precisam ser conferidas porque os registros de origem mudaram. Elas continuam disponíveis na exportação.': 'Some earlier corrections need checking because their source records changed. They remain available in the export.', 'O filtro de confiabilidade da reunião não foi carregado. Atualize a página.': 'The meeting reliability filter did not load. Refresh the page.',
    'O serviço de organização precisa ser configurado pelo administrador. Seu documento atual continua disponível.': 'The organization service must be configured by the administrator. Your current document is still available.', 'O limite diário de organização de atas foi atingido. Seu documento continua disponível. Tente no próximo dia ou contate o administrador.': 'The daily limit for organizing minutes was reached. Your document is still available. Try again tomorrow or contact the administrator.'
  };
  const PATTERNS = [
    [/^(\d+) falas?$/u, m => `${m[1]} ${m[1] === '1' ? 'turn' : 'turns'}`],
    [/^(\d+) assuntos?$/u, m => `${m[1]} ${m[1] === '1' ? 'topic' : 'topics'}`],
    [/^(\d+) reuniões?$/u, m => `${m[1]} ${m[1] === '1' ? 'meeting' : 'meetings'}`],
    [/^(\d+) reunião$/u, m => `${m[1]} meeting`],
    [/^(\d+) registros?$/u, m => `${m[1]} ${m[1] === '1' ? 'record' : 'records'}`],
    [/^Informações pendentes · (\d+)$/u, m => `Pending information · ${m[1]}`],
    [/^(\d+) atenç(?:ão necessária|ões necessárias)$/u, m => `${m[1]} ${m[1] === '1' ? 'item needs' : 'items need'} attention`],
    [/^Construindo mapa · (\d+) de (\d+) falas$/u, m => `Building map · ${m[1]} of ${m[2]} turns`],
    [/^Decisões, critérios e outros registros · (\d+)$/u, m => `Decisions, criteria and other records · ${m[1]}`],
    [/^Assunto (\d+) · sem título$/u, m => `Topic ${m[1]} · untitled`],
    [/^Assunto (\d+)$/u, m => `Topic ${m[1]}`],
    [/^Iniciada às (.+)$/u, m => `Started at ${m[1]}`],
    [/^Realizada em (.+)$/u, m => `Held on ${m[1]}`],
    [/^Referência (.+)$/u, m => `Reference ${m[1]}`],
    [/^Orientações desta reunião · versão (\d+)$/u, m => `Guidance for this meeting · version ${m[1]}`],
    [/^Conferir testes · (\d+)$/u, m => `Check tests · ${m[1]}`],
    [/^Informações não incluídas · (\d+)$/u, m => `Information not included · ${m[1]}`],
    [/^(\d+) trechos? mantidos? como na transcrição para revisão\.$/u, m => `${m[1]} ${m[1] === '1' ? 'passage' : 'passages'} kept as transcribed for review.`],
    [/^Revisar (teste|resultado): (.+)$/su, m => `Review ${m[1] === 'teste' ? 'test' : 'result'}: ${m[2]}`],
    [/^Falha ao exportar: (.+)$/su, m => `Export failed: ${m[1]}`],
    [/^Não foi possível (analisar o trecho agora|aplicar o esclarecimento|incluir o trecho)\. (.*)$/su, m => `${{ 'analisar o trecho agora': 'Could not analyze the passage right now', 'aplicar o esclarecimento': 'Could not apply the clarification', 'incluir o trecho': 'Could not include the passage' }[m[1]]}. ${m[2]}`]
  ];
  // Meeting content stays as spoken or typed; the minutes paper keeps the meeting language.
  const CONTENT = '.room-speech-text,.room-speech-speaker,.mc-node-copy,.room-topic-name h2,blockquote,pre,.room-alert-copy,.room-pending-item>span,.room-topic-menu-point,.gm-paper,[contenteditable],textarea,input';
  // Controls placed inside the minutes paper are interface, not document text.
  const CONTROLS = '.gm-document-actions,.gm-test-status';
  const isContent = node => !!node?.closest(CONTENT) && !node.closest(CONTROLS);
  const ATTRIBUTES = ['placeholder', 'title', 'aria-label'];
  const texts = new WeakMap(), attributes = new WeakMap();
  let language = 'pt', observer = null, applying = false, documentTitle = '';
  function translated(value) {
    const trimmed = value.trim(); if (!trimmed) return null;
    const exact = Object.hasOwn(EN, trimmed) ? EN[trimmed] : null;
    if (exact !== null) return value.replace(trimmed, exact);
    for (const [pattern, format] of PATTERNS) { const match = trimmed.match(pattern); if (match) return value.replace(trimmed, format(match)); }
    return null;
  }
  function textNode(node) {
    const saved = texts.get(node);
    // Code changed the text after a translation: that becomes the new source.
    if (saved && node.nodeValue !== saved.shown) { saved.source = node.nodeValue; saved.shown = null; }
    const source = saved ? saved.source : node.nodeValue;
    if (language === 'en') { const next = translated(source); if (next === null) { if (saved) { texts.delete(node); } return; } texts.set(node, { source, shown: next }); if (node.nodeValue !== next) node.nodeValue = next; }
    else if (saved) { texts.delete(node); if (node.nodeValue !== saved.source) node.nodeValue = saved.source; }
  }
  function element(node) {
    if (isContent(node) && !node.matches('textarea,input')) return false;
    let saved = attributes.get(node);
    for (const name of ATTRIBUTES) {
      if (!node.hasAttribute(name)) continue;
      const current = node.getAttribute(name), entry = saved?.[name];
      if (entry && current !== entry.shown) { entry.source = current; entry.shown = null; }
      const source = entry ? entry.source : current;
      if (language === 'en') { const next = translated(source); if (next === null) continue; saved ||= {}; saved[name] = { source, shown: next }; attributes.set(node, saved); if (current !== next) node.setAttribute(name, next); }
      else if (entry) { if (current !== entry.source) node.setAttribute(name, entry.source); delete saved[name]; }
    }
    return !isContent(node);
  }
  // System placeholders shown where meeting content would be.
  const PLACEHOLDERS = /^(?:Pontos a organizar|Assunto sem título|Assunto \d+(?: · sem título)?)$/u;
  function walk(node) {
    if (node.nodeType === 3) { if (!isContent(node.parentElement) || PLACEHOLDERS.test((texts.get(node)?.source ?? node.nodeValue).trim())) textNode(node); return; }
    if (node.nodeType !== 1 || ['SCRIPT', 'STYLE'].includes(node.tagName)) return;
    if (!element(node)) {
      for (const child of node.childNodes) if (child.nodeType === 3 && PLACEHOLDERS.test((texts.get(child)?.source ?? child.nodeValue).trim())) textNode(child);
      for (const control of node.querySelectorAll(CONTROLS)) walk(control);
      return;
    }
    for (const child of node.childNodes) walk(child);
  }
  function apply() {
    if (applying || !root.document?.body) return; applying = true;
    try { walk(root.document.body); documentTitle ||= root.document.title; root.document.title = language === 'en' ? translated(documentTitle) ?? documentTitle : documentTitle; }
    finally { applying = false; }
  }
  function set(next) {
    const value = next === 'en' ? 'en' : 'pt'; if (value === language && observer) return;
    language = value; root.document.documentElement.lang = value === 'en' ? 'en' : 'pt-BR'; apply();
    if (!observer && typeof root.MutationObserver === 'function') {
      observer = new root.MutationObserver(records => { if (applying) return; applying = true; try { for (const record of records) { if (record.type === 'characterData') walk(record.target); else if (record.type === 'attributes') walk(record.target); else for (const node of record.addedNodes) walk(node); } } finally { applying = false; } });
      observer.observe(root.document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRIBUTES });
    }
  }
  function parentLanguage() { try { return root.parent !== root ? root.parent.document.documentElement.lang : ''; } catch { return ''; } }
  function stored() { try { return root.localStorage.getItem('norte-language') || ''; } catch { return ''; } }
  function start() {
    // Same-origin pages share the saved preference; the parent's lang is a fallback.
    set(/^en/u.test(stored() || parentLanguage()) ? 'en' : 'pt');
    try { if (root.parent !== root) { const listen = event => set(event.detail?.language); root.parent.addEventListener('norte:language-change', listen); root.addEventListener('pagehide', () => root.parent.removeEventListener('norte:language-change', listen), { once: true }); } } catch { /* A standalone room uses its saved preference. */ }
  }
  root.NorteMeetingI18n = { set, apply, translated, get language() { return language; } };
  if (root.document?.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', start, { once: true }); else if (root.document) start();
})(typeof globalThis !== 'undefined' ? globalThis : this);
