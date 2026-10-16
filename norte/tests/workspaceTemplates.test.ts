import { describe, expect, it } from 'vitest';
import { applyDocumentFolderTemplate, addSuggestedSectors, ensureProgramReferenceFolder } from '../shared/workspace-templates.mjs';
import { organizationError, suggestedSectors } from '../shared/project-organization.mjs';
import { createEmptyProject } from '../src/lib/projectStore';

describe('optional document organization', () => {
  it('preserves user organization, recognizes existing bilingual folders and never asserts hardware', () => {
    const project = createEmptyProject();
    project.context.sectors = [{ id: 'avionics', name: 'Aviônica' }];
    project.context.folders = [{ id: 'my-ref', name: 'References', parentId: 'avionics' }, { id: 'custom', name: 'Flight campaign', parentId: 'avionics' }];
    const before = structuredClone(project);
    const next = applyDocumentFolderTemplate(project, 'avionics', 'engineering');
    expect(project).toEqual(before);
    expect(next.context.folders).toContainEqual(before.context.folders![0]);
    expect(next.context.folders).toContainEqual(before.context.folders![1]);
    expect(next.context.folders?.filter(f => f.name === 'Referências')).toHaveLength(0);
    expect(next.context.folders).toHaveLength(9);
    expect(next.context.folders?.some(f => f.technicalKind)).toBe(false);
    expect(organizationError(next)).toBeNull();
    expect(applyDocumentFolderTemplate(next, 'avionics', 'engineering', 'en')).toEqual(next);
  });
  it('rejects missing parent without creating orphaned folders', () => {
    expect(() => applyDocumentFolderTemplate(createEmptyProject(), 'missing', 'simple')).toThrow(/existing sector/);
  });
  it('adds sectors explicitly without replacing custom names, assignments or document structure', () => {
    const project = createEmptyProject();
    const suggestions = suggestedSectors('competition', 'pt', 'obsat', 'satellite');
    project.context.sectors = [{ ...suggestions[0], name: 'Estruturas revisadas' }, { id: 'custom', name: 'Revisão externa' }];
    project.context.folders = [{ id: 'ref', name: 'Fontes originais', parentId: 'custom' }];
    const next = addSuggestedSectors(project, suggestions);
    expect(next.context.sectors[0].name).toBe('Estruturas revisadas');
    expect(next.context.folders).toEqual(project.context.folders);
    expect(next.context.assignments).toEqual(project.context.assignments);
    expect(addSuggestedSectors(next, suggestions)).toEqual(next);
  });
});

it('keeps program references in a stable editable folder without manufacturing artifacts', () => {
  const project = createEmptyProject();
  project.context.projectArtifactIds = ['local-document'];
  const next = ensureProgramReferenceFolder(project, 'pt');
  expect(next.context.folders?.find(folder => folder.id === next.context.programFolderId)?.name).toBe('Edital e referências');
  expect(next.context.projectArtifactIds).toEqual(['local-document']);
  expect(next.context.programArtifactIds).toBeUndefined();
  expect(ensureProgramReferenceFolder(next, 'en')).toBe(next);
  const renamed = { ...next, context: { ...next.context, folders: next.context.folders!.map(folder => ({ ...folder, name: 'Normas da missão' })) } };
  expect(ensureProgramReferenceFolder(renamed, 'pt')).toBe(renamed);
  expect(project.context.sectors).toHaveLength(0);
});
