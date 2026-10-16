/** A small, inspectable checklist, not a compliance verdict. Rule locators are curated. */
const nasa = 'https://www.nasa.gov/reference/appendix-c-how-to-write-a-good-requirement/';
const ecss = 'https://ecss.nl/wp-content/uploads/standards/ecss-e/ECSS-E-ST-10-06C6March2009.pdf';
const rule = (id, profile, title, section, page, guidance) => ({ id, profile, title, source: profile === 'nasa' ? 'NASA/SP-2016-6105 Rev. 2' : 'ECSS-E-ST-10-06C (2009)', section, page, url: profile === 'nasa' ? nasa : `${ecss}#page=${page}`, guidance, checkedAt: '2026-10-16' });
export const REQUIREMENT_RULES = [
  rule('nasa-verifiable','nasa','Critério verificável','Apêndice C.4 · Verifiability/Testability',null,'Use critérios observáveis. Termos subjetivos precisam de uma condição e um critério de aceitação definidos pela equipe.'),
  rule('nasa-clear','nasa','Clareza e singularidade','Apêndice C.4 · Clarity',null,'Evite termos ambíguos e registre uma obrigação por enunciado.'),
  rule('nasa-trace','nasa','Rastreabilidade','Apêndice C.4 · Traceability',null,'Vincule o requisito à necessidade ou origem e ao elemento que o implementa.'),
  rule('nasa-complete','nasa','Pendências explícitas','Apêndice C.4 · Completeness',null,'Identifique informações ainda não definidas e acompanhe sua resolução.'),
  rule('ecss-verifiable','ecss','Método de verificação','8.2.9 · Verification',26,'Defina como será avaliado o atendimento ao requisito. A escolha do método precisa ser aprovada no projeto.'),
  rule('ecss-clear','ecss','Ambiguidade','8.2.4 · Ambiguity; 8.3.3 · Format restrictions',25,'Evite expressões abertas ou subjetivas. A lista de restrições de redação está na página 27.'),
  rule('ecss-trace','ecss','Configuração e rastreabilidade','8.2.3 · Configuration management and traceability',25,'Mantenha identificação, versão e rastreabilidade de origem e implementação.'),
  rule('ecss-complete','ecss','Completude','8.2.8 · Completeness',26,'O enunciado deve conter as informações necessárias para expressar a necessidade.')
];
export function activeRequirementRules(standards = []) {
  const profiles = new Set(standards.flatMap(id => id.startsWith('nasa') ? ['nasa'] : id.startsWith('ecss') ? ['ecss'] : []));
  return REQUIREMENT_RULES.filter(r => profiles.has(r.profile));
}
/** UTF-16 offsets match browser text slicing. Absence findings never fabricate a span. */
export function inspectRequirement(requirement, standards = []) {
  const rules = activeRequirementRules(standards), statement = requirement.statement || '', findings = [];
  const add = (suffix, severity, title, explanation, suggestion, match = null) => {
    const reference = rules.find(r => r.id.endsWith(suffix));
    findings.push({ id: `local-${suffix}-${match?.index ?? 'field'}`, ruleId: reference?.id || null, severity, title, explanation, suggestion, start: match?.index ?? null, end: match ? match.index + match[0].length : null, affectedText: match?.[0] || '', origin: 'checklist', reference: reference || null });
  };
  for (const match of statement.matchAll(/\b(?:rapidamente|rápido|rapida|adequado|adequada|facilmente|suficiente|robusto|robusta|quickly|rapidly|fast|adequate|sufficient|robust|user-friendly)\b/giu)) add('verifiable','warning','Falta um critério observável','Este termo pode ter interpretações diferentes durante a verificação.','Defina a condição e o critério mensurável com a equipe; não estime um limite sem fonte.',match);
  for (const match of statement.matchAll(/(?:\be\/ou\b|\band\/or\b|\betc\.|conforme necessário|as appropriate)/giu)) add('clear','warning','Redação ambígua','O escopo da obrigação fica aberto a interpretações.','Liste as condições ou separe obrigações independentes.',match);
  for (const match of statement.matchAll(/\b(?:TBD|TBR|a definir|to be determined)\b/giu)) add('complete','critical','Informação ainda não definida','Esta pendência impede fechar o critério nesta versão.','Atribua um responsável e uma data para resolver a pendência antes de aprovar.',match);
  if (!requirement.sourceRefs?.length && !requirement.parentIds?.length && !requirement.artifactIds?.length) add('trace','info','Origem ainda não vinculada','Não há fonte ou requisito de origem associado nesta ficha.','Associe uma necessidade, documento ou requisito superior na rastreabilidade.');
  if (!requirement.method || requirement.method === 'unspecified') add('verifiable','warning','Método a definir','A ficha não informa como o requisito será verificado.','Selecione teste, análise, inspeção, demonstração ou simulação e detalhe o critério.');
  return { engine: 'checklist', findings, checkedRules: rules.map(r => r.id), disclaimer: rules.length ? 'Triagem de critérios selecionados; a aplicabilidade e a decisão pertencem aos revisores.' : 'Checklist editorial local. Nenhuma norma foi selecionada; os apontamentos não recebem atribuição normativa.' };
}
export function validateRequirementAnalysis(output, requirement, rules) {
  if (!output || !Array.isArray(output.findings) || output.findings.length > 16) throw new Error('INVALID_REQUIREMENT_ANALYSIS');
  return output.findings.map((item, index) => {
    const reference = rules.find(r => r.id === item.ruleId);
    if (!reference || !['info','warning','critical'].includes(item.severity) || !Number.isSafeInteger(item.start) || !Number.isSafeInteger(item.end) || item.start < 0 || item.end <= item.start || item.end > requirement.statement.length || requirement.statement.slice(item.start,item.end) !== item.affectedText) throw new Error('UNGROUNDED_REQUIREMENT_ANALYSIS');
    for (const field of ['title','explanation','suggestion']) if (typeof item[field] !== 'string' || !item[field].trim() || item[field].length > 600 || /https?:|<\/?[a-z]/iu.test(item[field])) throw new Error('INVALID_REQUIREMENT_ANALYSIS');
    // A model may explain a criterion, but cannot invent a numeric replacement.
    const existing = new Set(requirement.statement.match(/\d+(?:[.,]\d+)?/gu) || []);
    if ((item.suggestion.match(/\d+(?:[.,]\d+)?/gu) || []).some(n => !existing.has(n))) throw new Error('INVENTED_REQUIREMENT_LIMIT');
    return { id:`ai-${index}`, ruleId:reference.id, severity:item.severity, title:item.title, explanation:item.explanation, suggestion:item.suggestion, start:item.start, end:item.end, affectedText:item.affectedText, origin:'model_suggestion', reference };
  });
}
