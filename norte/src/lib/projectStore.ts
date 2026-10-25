import type { ProjectFolder, ProjectType, SectorGrant } from "../../shared/project-organization.mjs";
import type { Language, MissionLink, MissionNode } from "./types";
import type { EngineeringSystemModel } from "./engineeringSystem";

export type StudyIntent = "problem" | "technology" | "science" | "open";
export type ProgressMode = "standard" | "custom";

export type ProjectReference = {
  id: string;
  label: string;
  kind: "standard" | "template" | "internal" | "other";
  binding: boolean;
};

export type CustomProgressCriterion = {
  id: string;
  label: string;
  mandatory: boolean;
  evidenceNodeIds: number[];
  scopeRootId: number | null;
};

export type IssueStudyHypothesis = {
  id: string;
  title: string;
  notes: string;
  status: "candidate" | "favored" | "rejected";
};

export type IssueStudy = {
  id: string;
  issueKey: string;
  scopeRootId: number | null;
  relatedNodeIds: number[];
  hypotheses: IssueStudyHypothesis[];
  notes: string;
  conclusionHypothesisId: string | null;
  status: "draft" | "resolved";
  updatedAt: string;
};

export type ProjectStructureItem = {
  id: string;
  name: string;
};

export type ProjectMemberAssignment = {
  memberId: string;
  roleId: string;
  sectorId: string;
  sectorRoles?: SectorGrant[];
};

export type ProjectContext = {
  summary?: { scope: string; nextSteps: string };
  /** Existing artifacts linked as project/program references; bytes remain in their original location. */
  programArtifactIds?: string[];
  programFolderId?: string | null;
  publicSummary?: boolean;
  folders?: ProjectFolder[];
  teamArtifactFolders?: Record<string, string>;
  configured: boolean;
  /** "independent" records a deliberate choice to have no reference program. */
  referenceProgram?: "independent" | null;
  programId: string | null;
  modalityId: string | null;
  categoryId: string | null;
  teamId: string | null;
  teamName: string;
  teamArtifactIds: string[];
  projectArtifactIds: string[];
  roles: ProjectStructureItem[];
  sectors: ProjectStructureItem[];
  assignments: ProjectMemberAssignment[];
};

export type MissionProject = {
  projectType?: ProjectType;
  creatorId?: string;
  organizationRevision?: number;
  schemaVersion: 2;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  navigation: {
    lastRoute: "setup" | "brainstorm" | "preliminary";
    lastConceptionWorkspace?: "system" | "discovery";
    systemLayouts?: Record<string, Record<string, { x: number; y: number }>>;
  };
  phaseProgress: { highestUnlockedStep: 0 | 1 | 2 };
  memoryRevision: number;
  systemGeneratedFromRevision?: number;
  engineeringSystem?: EngineeringSystemModel;
  context: ProjectContext;
  setup: {
    intent: StudyIntent;
    statement: string;
    framework: "norte-core" | "mission-dev-core" | "custom";
    references: ProjectReference[];
  };
  board: {
    nodes: MissionNode[];
    links: MissionLink[];
  };
  progress: {
    mode: ProgressMode;
    customCriteria: CustomProgressCriterion[];
  };
  studies: IssueStudy[];
  resolvedIssueKeys: string[];
  templates: {
    activeTemplateId: string;
    lockedPaths: string[];
  };
};


const DEFAULT_ROLES: ProjectStructureItem[] = [
  { id: "captain", name: "Responsável pelo projeto" },
  { id: "manager", name: "Gerente" },
  { id: "member", name: "Membro" },
  { id: "advisor", name: "Orientador" }
];

function uid(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function now(): string {
  return new Date().toISOString();
}

export function createEmptyProject(language: Language = "pt"): MissionProject {
  const timestamp = now();
  return {
    schemaVersion: 2,
    id: uid("mission"),
    name: "",
    createdAt: timestamp,
    updatedAt: timestamp,
    navigation: {
      lastRoute: "setup"
    },
    phaseProgress: { highestUnlockedStep: 0 },
    memoryRevision: 0,
    context: {
      configured: false,
      programId: null,
      modalityId: null,
      categoryId: null,
      teamId: null,
      teamName: "",
      teamArtifactIds: [],
      projectArtifactIds: [],
      roles: DEFAULT_ROLES.map((role) => ({ ...role, name: language === "en" ? ({ captain: "Project lead", manager: "Sector manager", member: "Member", advisor: "Advisor" }[role.id] ?? role.name) : role.name })),
      sectors: [],
      assignments: []
    },
    setup: {
      intent: "problem",
      statement: "",
      framework: "norte-core",
      references: []
    },
    board: {
      nodes: [],
      links: []
    },
    progress: {
      mode: "standard",
      customCriteria: []
    },
    studies: [],
    resolvedIssueKeys: [],
    templates: {
      activeTemplateId: "norte-core-v1",
      lockedPaths: []
    }
  };
}

export function normalizeProject(project: MissionProject, language: Language = "pt"): MissionProject {
  const defaults = createEmptyProject(language);
  const context = project.context && typeof project.context === "object" ? project.context : defaults.context;
  return {
    ...defaults,
    ...project,
    // Preserve historical fields for imported projects; they do not enable retired workspaces.
    phaseProgress: { highestUnlockedStep: project.phaseProgress?.highestUnlockedStep === 2 ? 2 : project.phaseProgress?.highestUnlockedStep === 1 || Boolean(project.engineeringSystem) || (!project.phaseProgress && (project.navigation?.lastRoute === "brainstorm" || project.board?.nodes?.length > 0)) ? 1 : 0 },
    memoryRevision: Number.isSafeInteger(project.memoryRevision) && project.memoryRevision >= 0 ? project.memoryRevision : 0,
    navigation: {
      ...defaults.navigation,
      ...(project.navigation && typeof project.navigation === "object" ? project.navigation : {}),
      lastConceptionWorkspace: project.navigation?.lastConceptionWorkspace === "discovery" ? "discovery" : "system"
    },
    context: {
      ...defaults.context,
      ...context,
      roles: Array.isArray(context.roles) && context.roles.length > 0 ? context.roles : defaults.context.roles,
      sectors: Array.isArray(context.sectors) ? context.sectors : [],
      teamArtifactIds: Array.isArray(context.teamArtifactIds) ? context.teamArtifactIds : [],
      projectArtifactIds: Array.isArray(context.projectArtifactIds) ? context.projectArtifactIds : [],
      assignments: Array.isArray(context.assignments) ? context.assignments : []
    }
  };
}
