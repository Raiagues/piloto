import { describe, expect, it } from 'vitest';
import { workspaceKind } from '../src/lib/workspaceHistory';

describe('recent work kinds', () => {
  it('distinguishes items with the same title by what the link opens', () => {
    expect(workspaceKind('/?meeting=m1#/meetings')).toBe('meeting');
    expect(workspaceKind('/?meeting=m1&view=minutes#/meetings')).toBe('minutes');
    expect(workspaceKind('/?project=p&delivery-record=LYLE-001#/requirements')).toBe('requirement');
    expect(workspaceKind('/?project=p&delivery-record=T-1#/schedule')).toBe('task');
    expect(workspaceKind('/?project=p&document=DOC-1#/project')).toBe('document');
    expect(workspaceKind('/?project=p&artifact=A-1#/project')).toBe('source');
    expect(workspaceKind('/?project=p&review=SRR#/project')).toBe('review');
    expect(workspaceKind('/#/teams')).toBe('page');
  });
});
