import { describe, expect, it } from 'vitest';
import { createEmptyProject, normalizeProject } from '../src/lib/projectStore';

describe('core project context', () => {
  it('creates an empty project without people, sectors or fabricated requirements', () => {
    const project = createEmptyProject('en');
    expect(project.name).toBe('');
    expect(project.context.assignments).toEqual([]);
    expect(project.context.sectors).toEqual([]);
    expect(project.context.projectArtifactIds).toEqual([]);
    expect(project.engineeringSystem).toBeUndefined();
    expect(project.board.nodes).toEqual([]);
    expect(project.context.roles[0].name).toBe('Project lead');
  });
  it('preserves historical source and architecture data while normalizing missing core fields', () => {
    const project = createEmptyProject('pt');
    const historical = { ...project, context: { ...project.context, sectors: [{ id: 's1', name: 'Telemetria' }], projectArtifactIds: ['document-original'] }, navigation: { lastRoute: 'brainstorm' as const }, memoryRevision: 7, engineeringSystem: { schemaVersion: 1 as const, id: 'original', name: 'Imported', generatedFromRevision: 7, generatedAt: project.createdAt, relations: [], entities: [], requirements: [], evidence: [], artifactSources: [] } };
    const result = normalizeProject(historical);
    expect(result.engineeringSystem).toEqual(historical.engineeringSystem);
    expect(result.context.projectArtifactIds).toEqual(['document-original']);
    expect(result.context.sectors).toEqual(historical.context.sectors);
    expect(result.memoryRevision).toBe(7);
    expect(result.createdAt).toBe(project.createdAt);
    expect(result.updatedAt).toBe(project.updatedAt);
    expect(historical.navigation).toEqual({ lastRoute: 'brainstorm' });
  });
  it('recovers absent context lists without overwriting valid assignments', () => {
    const original = createEmptyProject();
    const old = { ...original, context: { ...original.context, assignments: [{ memberId: 'real', roleId: 'captain', sectorId: '' }] } };
    Reflect.deleteProperty(old.context, 'roles');
    Reflect.deleteProperty(old.context, 'sectors');
    const result = normalizeProject(old);
    expect(result.context.roles[0].id).toBe('captain');
    expect(result.context.sectors).toEqual([]);
    expect(result.context.assignments).toEqual(old.context.assignments);
  });
});
