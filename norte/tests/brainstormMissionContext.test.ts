import { describe, expect, it } from "vitest";
import { buildBrainstormMissionContext } from "../src/lib/brainstormMissionContext";
import { createEmptyProject } from "../src/lib/projectStore";
import type { TeamMember } from "../src/lib/team";

describe("brainstorm mission context", () => {
  it("includes the selected program, deadline, participant experience, and consolidated map", () => {
    const project = createEmptyProject("pt");
    project.name = "Missão Aurora";
    project.context = {
      ...project.context,
      programId: "obsat",
      modalityId: "practical",
      categoryId: "n3",
      teamId: "aurora",
      teamName: "Equipe Aurora",
      sectors: [{ id: "payload", name: "Carga útil" }],
      assignments: [{ memberId: "member-1", roleId: "captain", sectorId: "payload" }]
    };
    project.board.nodes = [{ id: 1, x: 100, y: 100, width: 250, title: "Medir focos de calor", kickerKey: "DECISÃO", state: "defined", originLabNodeId: "idea-1" }];
    const member: TeamMember = {
      id: "member-1", accountId: null, displayName: "Ana", email: "ana@example.com", missionRole: "captain",
      primaryArea: "systems", secondaryAreas: ["payload"], institution: "Universidade", course: "Engenharia Aeroespacial",
      academicStage: "6º período", skills: ["eletrônica"], availabilityHours: 8, notes: "Experiência com sensores",
      accountStatus: "active", accessRole: "captain", createdAt: "2026-01-01", updatedAt: "2026-01-01"
    };

    const context = JSON.parse(buildBrainstormMissionContext(project, [member], "pt"));
    expect(context.competition).toMatchObject({ id: "obsat", category: "N3 · Ensino Superior" });
    expect(context.competition.requirements.length).toBeGreaterThan(3);
    expect(context.competition.phases.length).toBeGreaterThan(3);
    expect(context.competition.nextOfficialMilestone.date).toBe("02–05/09/2026");
    expect(context.team.members[0]).toMatchObject({ course: "Engenharia Aeroespacial", projectSector: "Carga útil" });
    expect(context.consolidatedCanvas.nodes[0]).toMatchObject({ sourceExplorationIdeaId: "idea-1" });
    expect(JSON.stringify(context)).not.toContain("ana@example.com");
    expect(buildBrainstormMissionContext(project, [member], "pt").length).toBeLessThanOrEqual(30_000);
  });

  it("keeps a large team context valid without dropping selected participants", () => {
    const project = createEmptyProject("pt");
    project.context = {
      ...project.context,
      assignments: Array.from({ length: 24 }, (_, index) => ({ memberId: `member-${index}`, roleId: "member", sectorId: "payload" })),
      roles: [{ id: "member", name: "Membro" }],
      sectors: [{ id: "payload", name: "Carga útil" }]
    };
    project.board.nodes = Array.from({ length: 60 }, (_, index) => ({
      id: index + 1,
      x: index * 10,
      y: index * 10,
      width: 250,
      title: `Decisão ${index} ${"contexto ".repeat(30)}`,
      kickerKey: "DECISÃO",
      state: "defined" as const
    }));
    const members: TeamMember[] = project.context.assignments.map((assignment, index) => ({
      id: assignment.memberId,
      accountId: null,
      displayName: `Pessoa ${index}`,
      email: `person-${index}@example.com`,
      missionRole: "member",
      primaryArea: "payload",
      secondaryAreas: ["software", "operations", "electronics"],
      institution: "Universidade ".repeat(20),
      course: "Engenharia Aeroespacial ".repeat(10),
      academicStage: "Oitavo período",
      skills: Array.from({ length: 12 }, (_, skillIndex) => `Experiência ${skillIndex} ${"detalhada ".repeat(20)}`),
      availabilityHours: 8,
      notes: "Experiência em projeto e integração ".repeat(20),
      accountStatus: "active",
      accessRole: "member",
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01"
    }));

    const serialized = buildBrainstormMissionContext(project, members, "pt");
    const parsed = JSON.parse(serialized);
    expect(serialized.length).toBeLessThanOrEqual(30_000);
    expect(parsed.team.members).toHaveLength(24);
    expect(serialized).not.toContain("@example.com");
  });
});
