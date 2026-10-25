import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MissionSidebar } from '../src/components/MissionSidebar';
import { workspaceRedirect, workspaceRoute } from '../src/lib/workspaceRoutes';

const noop = () => undefined;
function sidebar(activeProjectId = 'project') {
  return renderToStaticMarkup(createElement(MissionSidebar, {
    language: 'en', expanded: true, homeLabel: 'Home', teamLabel: 'Teams', homeActive: false, teamActive: false,
    projects: [], activeProjectId, projectTeamName: 'Team one', onToggle: noop, onHome: noop,
    onTeam: noop, onProjectSelect: noop, activeArea: 'requirements', onAreaSelect: noop
  }));
}

describe('workspace navigation', () => {
  it('offers the four project work areas without phase unlocks or experimental workspaces', () => {
    const html = sidebar();
    expect((html.match(/<select/g) || []).length).toBe(1);
    for (const label of ['Requirements', 'Verification', 'Schedule', 'Documents', 'Team one']) expect(html).toContain(label);
    for (const label of ['Project memory', 'Conception', 'Test ideas', 'Team dashboard']) expect(html).not.toContain(label);
    expect(html).not.toContain('disabled=""');
    expect((sidebar('').match(/class="mission-phase locked"[^>]*disabled=""/g) || []).length).toBe(4);
  });
  it('redirects retired bookmarks without rendering their former page', () => {
    for (const path of ['study-setup?tab=overview', 'project-setup', 'brainstorming', 'preliminary-design', 'ideas?project=x', 'ai-comparison', 'software']) {
      expect(workspaceRedirect(`#/${path}`)).toBe('#/requirements');
      expect(workspaceRoute(`#/${path}`)).toBe('home');
    }
    expect(workspaceRedirect('#/project-team')).toBe('#/teams');
    expect(workspaceRedirect('#/dashboard')).toBe('#/');
  });
  it('routes analysis deep links and meeting diagnostics distinctly from the admin overview', () => {
    expect(workspaceRoute('#/requirements?requirement=LYLE-001')).toBe('requirements');
    expect(workspaceRoute('#/admin/meetings?meeting=1')).toBe('meetingObservability');
    expect(workspaceRoute('#/admin/users')).toBe('admin');
    expect(workspaceRedirect('#/documents')).toBeUndefined();
  });
});
