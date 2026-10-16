import { describe, expect, it } from 'vitest';
import { createEngineeringValidationModel } from '../examples/engineering-validation.mjs';
import { acceptAuthorizedScenario, scenarioContextMatches } from '../src/lib/authorizedScenario';
import { analyzeImpact } from '../src/lib/impactEngine';
import type { EngineeringChange } from '../src/lib/engineeringSystem';

describe('authorized requirement projection in impact scenarios', () => {
  it('uses pending constraints for the preview and never writes workflow overlays into the baseline', () => {
    const baseline = createEngineeringValidationModel(), effective = structuredClone(baseline);
    const requirement = effective.requirements.find(r => r.id === 'REQ-07')!;
    requirement.statement = 'Autonomy ≥ 120 min'; requirement.properties = []; requirement.classificationSource = 'user'; requirement.reviewTags = ['numeric_constraints_need_review'];
    const change: EngineeringChange = { id: 'scenario-test', targetEntityId: 'radio', kind: 'parameter', oldValues: [], newValues: [{ key: 'peak_current', name: 'Peak current', value: 1.2, unit: 'A', source: 'user', evidenceRefs: [] }], description: 'Radio 1.2 A', createdAt: new Date().toISOString() };
    const analysis = analyzeImpact(effective, change, 'en'); analysis.baseline = effective;
    expect(analysis.impacts.find(r => r.entityId === 'REQ-07')?.status).toBe('review');
    const applied = acceptAuthorizedScenario(baseline, analysis);
    expect(applied.requirements).toEqual(baseline.requirements); expect(applied.entities.find(r => r.id === 'radio')?.properties.find(p => p.key === 'peak_current')?.value).toBe(1.2);
    expect(applied.evidence).toEqual(expect.arrayContaining(baseline.evidence));
    expect(baseline.entities.find(r => r.id === 'radio')?.properties.find(p => p.key === 'peak_current')?.value).not.toBe(1.2);
  });
  it('requires a versioned requirement edit instead of replacing the baseline from a scenario', () => {
    const baseline = createEngineeringValidationModel();
    const change: EngineeringChange = { id: 'req-scenario', targetEntityId: 'REQ-07', kind: 'requirement', oldValues: [], newValues: [{ key: 'minimum_autonomy', name: 'Minimum autonomy', value: 120, unit: 'min', source: 'user', evidenceRefs: [] }], description: '120 min', createdAt: new Date().toISOString() };
    expect(() => acceptAuthorizedScenario(baseline, analyzeImpact(baseline, change, 'en'))).toThrow(/reviewed requirement version/);
    expect(scenarioContextMatches(baseline, { analysisModel: baseline, deliveryRevision: 1, baselineId: baseline.id, baselineRevision: baseline.revision || 0, baselineGeneratedAt: baseline.generatedAt })).toBe(true);
    expect(scenarioContextMatches(baseline, { analysisModel: baseline, deliveryRevision: 1, baselineId: 'other', baselineRevision: 0, baselineGeneratedAt: baseline.generatedAt })).toBe(false);
  });
});
