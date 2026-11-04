import { llmApiKey } from './ai-keys.mjs';
import { llmConfig, prompt } from './llm-config.mjs';
import { generateJson } from './llm-transport.mjs';
import { activeRequirementRules, validateRequirementAnalysis } from '../shared/requirement-quality.mjs';
export function createRequirementAnalyzer(options = {}, intelligence) {
  const apiKey = options.apiKey ?? llmApiKey();
  return async ({ requirement, standards, projectId, corrections = [] }) => {
    const rules = activeRequirementRules(standards);
    if (!rules.length)
      throw Object.assign(
        new Error(
          'Selecione uma referência NASA ou ECSS para a análise assistida. O checklist editorial continua disponível sem norma.',
        ),
        { statusCode: 400, code: 'REFERENCE_REQUIRED' },
      );
    if (!apiKey)
      throw Object.assign(
        new Error('A análise assistida não está configurada. O checklist local continua disponível.'),
        { statusCode: 503, code: 'REQUIREMENT_AI_UNAVAILABLE' },
      );
    const config = llmConfig(options, 3000);
    const schema = {
      type: 'object',
      required: ['findings'],
      properties: {
        findings: {
          type: 'array',
          items: {
            type: 'object',
            required: ['ruleId', 'severity', 'title', 'explanation', 'suggestion', 'start', 'end', 'affectedText'],
            properties: {
              ruleId: { type: 'string', enum: rules.map(r => r.id) },
              severity: { type: 'string', enum: ['info', 'warning', 'critical'] },
              title: { type: 'string' },
              explanation: { type: 'string' },
              suggestion: { type: 'string' },
              start: { type: 'integer' },
              end: { type: 'integer' },
              affectedText: { type: 'string' },
            },
          },
        },
      },
    };
    const input = JSON.stringify({
      requirement: {
        statement: requirement.statement,
        title: requirement.title,
        method: requirement.method,
        acceptanceCriteria: requirement.acceptanceCriteria || '',
      },
      rules,
      corrections: corrections.slice(-5),
    });
    const output = await generateJson({
      ...config,
      apiKey,
      instructions: prompt('requirement-review.md'),
      input,
      schema,
      schemaName: 'requirement_review',
      fetchImpl: options.fetchImpl || options.fetch,
      policy: { timeoutMs: 25000, totalDeadlineMs: 26000, maxAttempts: 1 },
      onAttempt: record =>
        intelligence?.recordProviderAttempt({ ...record, projectId, feature: 'requirements_review' }),
    });
    try {
      return {
        engine: config.model,
        findings: validateRequirementAnalysis(output, requirement, rules),
        checkedRules: rules.map(r => r.id),
      };
    } catch {
      throw Object.assign(
        new Error('A análise não apresentou referências ou trechos verificáveis. Nenhuma sugestão foi aplicada.'),
        { statusCode: 502, code: 'REQUIREMENT_ANALYSIS_UNGROUNDED' },
      );
    }
  };
}
