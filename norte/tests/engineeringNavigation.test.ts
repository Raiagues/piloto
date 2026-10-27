import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MissionSidebar } from '../src/components/MissionSidebar';
import { workspaceRedirect, workspaceRoute } from '../src/lib/workspaceRoutes';

const noop = () => undefined;
function sidebar(activeProjectId = 'project', route = 'requirements') {
  return renderToStaticMarkup(createElement(MissionSidebar, {
    language: 'en', expanded: true, route, projects: [{ id: 'project', name: 'Orbital vehicle', programId: null, teamId: 'team', updatedAt: '2026-10-24T00:00:00.000Z', memberCount: 1 }],
    teams: [{ id: 'team', name: 'Team one' }], activeProjectId, activeProjectName: activeProjectId ? 'Orbital vehicle' : '', activeTeam: activeProjectId ? { id: 'team', name: 'Team one' } : null,
    outline: { projectId: 'project', total: 3, groups: [{ id: 'propulsion', name: 'Propulsion', count: 2 }, { id: 'avionics', name: 'Avionics', count: 1 }] },
    onToggle: noop, onNavigate: noop, onProjectSelect: noop, onAreaSelect: noop, onSubsystemSelect: noop
  }));
}

describe('workspace navigation', () => {
  it('offers the overview, requirements and schedule without verification or experimental workspaces', () => {
    const html = sidebar();
    expect(html).not.toContain('<select');
    for (const label of ['Overview', 'Requirements', 'Schedule', 'Orbital vehicle', 'Team one']) expect(html).toContain(label);
    for (const label of ['Verification', 'Documents', 'Project memory', 'Conception', 'Test ideas', 'Team dashboard']) expect(html).not.toContain(label);
    expect(html).not.toContain('disabled=""');
    expect((sidebar('').match(/class="mission-nav-item mission-phase locked"[^>]*disabled=""/g) || []).length).toBe(3);
  });
  it('nests the subsystem tree under requirements only while requirements are open', () => {
    expect(sidebar()).toContain('Propulsion');
    expect(sidebar('project', 'project')).not.toContain('Propulsion');
  });
  it('shows the team with the active project as one control', () => {
    const html = sidebar();
    expect((html.match(/Team one/g) || []).length).toBe(1);
    expect(html).toContain('aria-haspopup="listbox"');
  });
  it('redirects retired bookmarks without rendering their former page', () => {
    for (const path of ['study-setup?tab=overview', 'project-setup', 'brainstorming', 'preliminary-design', 'ideas?project=x', 'ai-comparison', 'software']) {
      expect(workspaceRedirect(`#/${path}`)).toBe('#/requirements');
      expect(workspaceRoute(`#/${path}`)).toBe('home');
    }
    expect(workspaceRedirect('#/project-team')).toBe('#/teams');
    expect(workspaceRedirect('#/dashboard')).toBe('#/');
    expect(workspaceRedirect('#/documents?document=DOC-1')).toBe('#/project');
    expect(workspaceRedirect('#/verification')).toBe('#/project');
  });
  it('routes analysis deep links and meeting diagnostics distinctly from the admin overview', () => {
    expect(workspaceRoute('#/requirements?requirement=LYLE-001')).toBe('requirements');
    expect(workspaceRoute('#/project')).toBe('project');
    expect(workspaceRoute('#/admin/meetings?meeting=1')).toBe('meetingObservability');
    expect(workspaceRoute('#/admin/users')).toBe('admin');
  });
});
