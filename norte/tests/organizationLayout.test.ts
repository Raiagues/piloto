import { describe, expect, it } from 'vitest';
import { layoutOrganization, organizationEdgePath } from '../src/lib/organizationLayout';
import { projectOrganization } from '../shared/organization-tree.mjs';
import { suggestedSectors } from '../shared/project-organization.mjs';
import { createEmptyProject, normalizeProject } from '../src/lib/projectStore';
import { referenceProgram, programModality } from '../src/lib/programs';
import type { OrganizationNode } from '../shared/organization-tree.mjs';

const sector = (id: string): OrganizationNode => ({ id, name: `Sector ${id}`, kind: 'sector', children: [] });
describe('organization overview', () => {
  it('wraps seven sectors, keeps cards inside the canvas and does not overlap them', () => {
    const diagram = layoutOrganization({ id: 'project', name: 'A long engineering project title that wraps across several lines', kind: 'project', children: Array.from({ length: 7 }, (_, i) => sector(String(i))) });
    expect(diagram.cards).toHaveLength(8);
    expect(diagram.width).toBeLessThan(1100);
    for (const card of diagram.cards) {
      expect(card.x).toBeGreaterThanOrEqual(0);
      expect(card.y).toBeGreaterThanOrEqual(0);
      expect(card.x + card.width).toBeLessThanOrEqual(diagram.width);
      expect(card.y + card.height).toBeLessThanOrEqual(diagram.height);
      for (const other of diagram.cards.filter(c => c !== card)) expect(card.x + card.width <= other.x || other.x + other.width <= card.x || card.y + card.height <= other.y || other.y + other.height <= card.y).toBe(true);
    }
    expect(organizationEdgePath(diagram, diagram.edges.at(-1)!)).toContain('H4');
  });
  it('preserves people, role labels and separate cards when projects share default sector ids', () => {
    const branch = (id: string): OrganizationNode => ({ id, name: id, kind: 'project', children: [{ ...sector('default-sector'), children: [{ id: 'manager', name: 'Manager Name', kind: 'responsibility', role: 'Sector manager', memberIds: ['member'], children: [{ id: 'person', name: 'Another Person', kind: 'person', memberId: 'other', children: [] }] }] }] });
    const diagram = layoutOrganization({ id: 'team', name: 'Team', kind: 'team', children: [branch('a'), branch('b')] });
    expect(new Set(diagram.cards.map(c => c.key)).size).toBe(5);
    const sectors = diagram.cards.filter(c => c.node.id === 'default-sector');
    expect(sectors).toHaveLength(2);
    expect(sectors[0].x).not.toBe(sectors[1].x);
    expect(sectors[0].details.map(d => d.memberId)).toEqual(['member', 'other']);
    expect(sectors[0].details[0].role).toBe('Sector manager');
  });
});
describe('competition setup', () => {
  it('selects editable work areas for the actual competition and modality', () => {
    const names = (program: string, modality = '') => suggestedSectors('competition', 'en', program, modality).map(s => s.name);
    expect(names('obsat', 'practical')).toContain('Payload');
    expect(names('obsat', 'theoretical')).not.toContain('Payload');
    expect(names('lasc', 'rocket')).toContain('Recovery');
    expect(names('lasc', 'satellite')).not.toContain('Recovery');
    expect(names('sae-aerodesign')).toContain('Aerodynamics');
    expect(names('formula-sae')).toContain('Brakes and ergonomics');
    expect(names('baja-sae')).toContain('Chassis and safety');
    expect(names('baja-sae')).not.toContain('Aerodynamics');
    expect(suggestedSectors('custom')).toEqual([]);
  });
  it('persists class and edited sectors while retaining old objectives without creating technical architecture', () => {
    const project = createEmptyProject('en');
    project.setup.statement = 'Existing objective';
    project.context.programId = 'sae-aerodesign'; project.context.modalityId = 'aircraft'; project.context.categoryId = 'micro';
    project.context.sectors = [{ id: 'legacy-sector', name: 'My sector' }];
    const normalized = normalizeProject(project, 'en');
    expect(normalized.context.sectors).toEqual(project.context.sectors);
    expect(normalized.setup.statement).toBe('Existing objective');
    expect(normalized.context.categoryId).toBe('micro');
    expect(normalized.engineeringSystem).toEqual(project.engineeringSystem);
    expect(projectOrganization(normalized).children).toHaveLength(1);
    const modality = programModality(referenceProgram('sae-aerodesign'), 'aircraft');
    expect(modality?.categories.map(c => c.id)).toEqual(['regular', 'advanced', 'micro']);
    expect(modality?.requirements).toEqual([]);
    expect(modality?.phases).toEqual([]);
  });
});
