import type { MissionProject } from '../src/lib/projectStore';
import type { TeamMember, TeamRecord, TeamProjectSummary } from '../src/lib/team';
export type OrganizationNode = { id: string; kind: string; name: string; role?: string; memberId?: string; memberIds?: string[]; children: OrganizationNode[] };
export function projectOrganization(project: Pick<MissionProject, 'id' | 'name' | 'context'>, members?: TeamMember[]): OrganizationNode;
export function teamOrganization(team: TeamRecord, members: TeamMember[], projects: TeamProjectSummary[]): OrganizationNode;
