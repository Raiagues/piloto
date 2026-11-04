import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MissionSidebar, projectMonogram } from '../src/components/MissionSidebar';
import type { DeliveryState } from '../src/lib/projectDelivery';
import type { MeetingSummary } from '../src/lib/meetings';
import { workspaceRedirect, workspaceRoute } from '../src/lib/workspaceRoutes';

const noop = () => undefined;
function sidebar(
  activeProjectId = 'project',
  route = 'requirements',
  data: { delivery?: DeliveryState; meetings?: MeetingSummary[] } = {},
) {
  return renderToStaticMarkup(
    createElement(MissionSidebar, {
      language: 'en',
      expanded: true,
      route,
      projects: [
        {
          id: 'project',
          name: 'Orbital vehicle',
          programId: null,
          teamId: 'team',
          updatedAt: '2026-10-24T00:00:00.000Z',
          memberCount: 1,
        },
      ],
      teams: [{ id: 'team', name: 'Team one' }],
      activeProjectId,
      activeProjectName: activeProjectId ? 'Orbital vehicle' : '',
      activeTeam: activeProjectId ? { id: 'team', name: 'Team one' } : null,
      outline: {
        projectId: 'project',
        total: 3,
        groups: [
          { id: 'propulsion', name: 'Propulsion', count: 2 },
          { id: 'avionics', name: 'Avionics', count: 1 },
        ],
      },
      onToggle: noop,
      onNavigate: noop,
      onOpen: noop,
      onSearch: noop,
      onProjectSelect: noop,
      onAreaSelect: noop,
      onSubsystemSelect: noop,
      ...data,
    }),
  );
}

describe('workspace navigation', () => {
  it('offers the overview, requirements and schedule without verification or experimental workspaces', () => {
    const html = sidebar();
    expect(html).not.toContain('<select');
    for (const label of ['Overview', 'Requirements', 'Schedule', 'Orbital vehicle', 'Team one'])
      expect(html).toContain(label);
    for (const label of ['Verification', 'Documents', 'Project memory', 'Conception', 'Test ideas', 'Team dashboard'])
      expect(html).not.toContain(label);
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
  it('lists the reviews under the schedule with how many documents are ready', () => {
    const option = (id: string) => ({
      id,
      code: id,
      title: `${id} document`,
      flow: 'input',
      kind: '',
      maturity: '',
      reference: null,
    });
    const delivery = {
      tasks: [
        {
          id: 'srr',
          kind: 'review',
          reviewCode: 'SRR',
          title: 'SRR · System requirements',
          dueDate: '2027-01-25',
          status: 'planned',
          archived: false,
          overdue: false,
          documentOptions: [option('TS'), option('RTM'), option('ICD')],
        },
      ],
      documents: [
        {
          id: 'ts',
          taskId: 'srr',
          templateId: 'TS',
          code: 'TS',
          title: 'Technical specification',
          status: 'approved',
          version: 2,
        },
      ],
      requirements: [],
      sectors: [{ id: 'structures', name: 'Structures' }],
    } as unknown as DeliveryState;
    const meetings = [
      {
        id: 'sync',
        title: 'Weekly sync',
        projectId: 'project',
        scope: 'team',
        status: 'done',
        createdAt: '2026-10-27T10:00:00Z',
        participants: [],
      },
    ] as unknown as MeetingSummary[];
    const html = sidebar('project', 'project', { delivery, meetings });
    expect(html).toContain('<b>SRR</b>');
    expect(html).toContain('1/3');
    expect(html).toContain('1 of 3 documents prepared · 1 approved');
    // Sector folders appear before their first meeting; the meetings themselves stay folded.
    for (const label of ['Team general', 'Structures']) expect(html).toContain(label);
    expect(html).not.toContain('Weekly sync');
  });
  it('names the project tile after an acronym or the first two words', () => {
    expect(projectMonogram('Veículo Orbital LYLE')).toBe('LY');
    expect(projectMonogram('orbital vehicle')).toBe('OV');
    expect(projectMonogram('Satélite')).toBe('SA');
  });
  it('redirects retired bookmarks without rendering their former page', () => {
    for (const path of [
      'study-setup?tab=overview',
      'project-setup',
      'brainstorming',
      'preliminary-design',
      'ideas?project=x',
      'ai-comparison',
      'software',
    ]) {
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
