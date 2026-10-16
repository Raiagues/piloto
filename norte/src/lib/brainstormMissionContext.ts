import { programCategory, programModality, referenceProgram } from "./programs";
import type { MissionProject } from "./projectStore";
import type { TeamMember } from "./team";
import type { Language } from "./types";

const MAX_CONTEXT_LENGTH = 30_000;

export function buildBrainstormMissionContext(project: MissionProject, members: TeamMember[], language: Language): string {
  const program = referenceProgram(project.context.programId);
  const modality = programModality(program, project.context.modalityId);
  const category = programCategory(modality, project.context.categoryId);
  const memberById = new Map(members.map((member) => [member.id, member]));
  const roles = new Map(project.context.roles.map((role) => [role.id, role.name]));
  const sectors = new Map(project.context.sectors.map((sector) => [sector.id, sector.name]));

  const context = {
    project: {
      id: project.id,
      name: clip(project.name, 120),
      intent: clip(project.setup.intent, 320),
      startingStatement: clip(project.setup.statement, 420),
      createdAt: project.createdAt,
      updatedAt: project.updatedAt
    },
    competition: program ? {
      id: program.id,
      name: program.name[language],
      modality: modality?.label[language] ?? "",
      modalityDescription: modality?.description[language] ?? "",
      category: category?.label[language] ?? "",
      requirements: modality?.requirements.map((requirement) => clip(requirement[language], 220)).slice(0, 16) ?? [],
      phases: modality?.phases.map((phase) => ({ label: clip(phase.label[language], 100), date: phase.date })).slice(0, 12) ?? [],
      officialDocuments: modality?.officialDocuments.map((document) => ({ label: clip(document.label[language], 100), url: document.url })).slice(0, 8) ?? [],
      nextOfficialMilestone: modality ? { label: modality.milestone.label[language], date: modality.milestone.date, url: modality.milestone.url } : null
    } : null,
    team: {
      id: project.context.teamId,
      name: project.context.teamName,
      members: project.context.assignments.slice(0, 24).map((assignment) => {
        const member = memberById.get(assignment.memberId);
        return {
          id: assignment.memberId,
          name: clip(member?.displayName ?? assignment.memberId, 80),
          projectRole: clip(roles.get(assignment.roleId) ?? assignment.roleId, 60),
          projectSector: clip(sectors.get(assignment.sectorId) ?? assignment.sectorId, 60),
          institution: clip(member?.institution ?? "", 100),
          course: clip(member?.course ?? "", 100),
          academicStage: clip(member?.academicStage ?? "", 50),
          priorAreas: [member?.primaryArea, ...(member?.secondaryAreas ?? [])].filter((area): area is string => Boolean(area)).slice(0, 4).map((area) => clip(area, 50)),
          recordedExperience: [...(member?.skills ?? []), member?.notes ?? ""].filter(Boolean).slice(0, 5).map((item) => clip(item, 100)),
          availabilityHoursPerWeek: member?.availabilityHours ?? null
        };
      })
    },
    consolidatedCanvas: {
      nodes: project.board.nodes.slice(-40).map((node) => ({
        id: node.id,
        text: clip(node.title ?? node.titleKey ?? "", 180),
        state: node.state,
        x: Math.round(node.x),
        y: Math.round(node.y),
        sourceExplorationIdeaId: node.originLabNodeId ?? ""
      })),
      relations: project.board.links.slice(-80).map((link) => ({ from: link.from, to: link.to, type: link.type }))
    },
    safeguards: {
      suggestionsAreNotDecisions: true,
      onlyTeamDecisionsEnterConsolidatedCanvas: true,
      preserveConfirmedRelationDirection: true
    }
  };
  const serialized = JSON.stringify(context);
  if (serialized.length <= MAX_CONTEXT_LENGTH) return serialized;

  const compact = {
    ...context,
    team: {
      ...context.team,
      members: context.team.members.map((member) => ({ ...member, priorAreas: member.priorAreas.slice(0, 2), recordedExperience: member.recordedExperience.slice(0, 2) }))
    },
    consolidatedCanvas: {
      nodes: context.consolidatedCanvas.nodes.slice(-24),
      relations: context.consolidatedCanvas.relations.slice(-48)
    }
  };
  const compactSerialized = JSON.stringify(compact);
  if (compactSerialized.length <= MAX_CONTEXT_LENGTH) return compactSerialized;

  return JSON.stringify({
    ...compact,
    team: {
      ...compact.team,
      members: compact.team.members.map(({ recordedExperience: _recordedExperience, priorAreas: _priorAreas, ...member }) => member)
    },
    consolidatedCanvas: {
      nodes: compact.consolidatedCanvas.nodes.slice(-12),
      relations: compact.consolidatedCanvas.relations.slice(-24)
    }
  });
}

function clip(value: string, limit: number): string {
  return value.trim().replace(/\s+/g, " ").slice(0, limit);
}
