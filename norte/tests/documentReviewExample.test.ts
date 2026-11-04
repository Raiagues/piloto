import { describe, expect, it } from 'vitest';
import { applySuggestion, exampleReview } from '../src/lib/documentReviewExample';

const body = [
  '# Especificação técnica',
  '## 1 Introdução',
  '> Orientação: Propósito, objetivo e conteúdo do documento.',
  'PENDENTE — completar o propósito, o escopo e o motivo desta emissão.',
  '## 7 Requisitos',
  '### R-1 · Massa · v1',
  'A massa deve ser adequada para o lançamento e/ou transporte.',
  'Método: A definir',
  'Critério: PENDENTE — definir critério de aceitação',
  '### R-2 · Potência · v1',
  'O subsistema deve fornecer 40 W (TBD).',
  'Método: A definir',
].join('\n');

describe('fictional review example', () => {
  it('anchors every suggestion to text that occurs exactly once and invents no numbers', () => {
    const review = exampleReview(body);
    expect(review.reviewers.every(reviewer => /fictício/.test(reviewer.name))).toBe(true);
    expect(review.suggestions.length).toBeGreaterThan(3);
    for (const suggestion of review.suggestions) {
      expect(body.split(suggestion.quote)).toHaveLength(2);
      expect(suggestion.replacement.match(/\d/g) || []).toEqual([]);
    }
    expect(review.suggestions.some(item => item.quote.includes('adequada'))).toBe(true);
    expect(review.suggestions.some(item => item.quote === 'Critério: PENDENTE — definir critério de aceitação')).toBe(
      true,
    );
    // "Método: A definir" occurs twice, so it cannot be applied literally.
    expect(review.suggestions.some(item => item.quote === 'Método: A definir')).toBe(false);
  });

  it('is deterministic and applies only to the current text', () => {
    expect(exampleReview(body)).toEqual(exampleReview(body));
    const suggestion = exampleReview(body).suggestions.find(item => item.quote.startsWith('Critério'))!;
    const next = applySuggestion(body, suggestion.quote, suggestion.replacement)!;
    expect(next).toContain('[condição observável');
    expect(applySuggestion(next, suggestion.quote, suggestion.replacement)).toBeNull();
    expect(applySuggestion(body, '> Orientação: Propósito, objetivo e conteúdo do documento.', '')).not.toMatch(
      /\n\n\n/,
    );
  });
});
