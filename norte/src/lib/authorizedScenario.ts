import type { EngineeringAnalysis, EngineeringSystemModel } from './engineeringSystem';
import { projectEngineeringScenario } from './engineeringUi';
export type AuthorizedScenarioContext = { analysisModel: EngineeringSystemModel; deliveryRevision: number; baselineId: string; baselineRevision: number; baselineGeneratedAt: string };
export function scenarioContextMatches(model: EngineeringSystemModel, context: AuthorizedScenarioContext) {
  return context.baselineId === model.id && context.baselineRevision === (model.revision || 0) && context.baselineGeneratedAt === model.generatedAt;
}
/** Preview may contain workflow overlays. Applying a component scenario never publishes those overlays into the imported baseline. */
export function acceptAuthorizedScenario(model: EngineeringSystemModel, analysis: EngineeringAnalysis) {
  if (analysis.change.kind === 'requirement') throw new Error('Requirement changes require a new reviewed requirement version.');
  const evidence = [...new Map([...model.evidence, ...(analysis.evidence || [])].map(item => [item.id, item])).values()];
  const projected = projectEngineeringScenario(model, { ...analysis, baseline: undefined, evidence });
  return { ...projected, requirements: model.requirements };
}
