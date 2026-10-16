import type { ProjectFolder, ProjectType, SectorGrant } from "../../shared/project-organization.mjs";
import type { Language, MissionLink, MissionNode, NodeState } from "./types";
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

export type VirtualProjectFile = {
  path: string;
  description: string;
  content: unknown;
};

const STORAGE_KEY = "norte-project-v2";
const LEGACY_STORAGE_KEY = "mission-dev-project-v2";

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
    // Old projects that already reached conception keep their access even after
    // returning to memory. New projects have no engineering baseline yet.
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

export function loadProject(language: Language = "pt"): MissionProject {
  if (typeof window === "undefined") return createEmptyProject(language);
  const raw = window.localStorage.getItem(STORAGE_KEY) ?? window.localStorage.getItem(LEGACY_STORAGE_KEY);
  if (!raw) return createEmptyProject(language);

  try {
    const parsed = JSON.parse(raw) as MissionProject;
    if (parsed.schemaVersion !== 2) return createEmptyProject(language);
    const normalized = normalizeProject(parsed, language);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    return normalized;
  } catch {
    return createEmptyProject(language);
  }
}

export function saveProject(project: MissionProject): MissionProject {
  const next = { ...normalizeProject(project), updatedAt: now() };
  if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function clearStoredProject(): void {
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(STORAGE_KEY);
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
  }
}

function node(id: number, x: number, y: number, title: string, kickerKey: string, state: NodeState, type: MissionNode["type"] = "normal", bucket: MissionNode["bucket"] = "main", width = 250): MissionNode {
  return { id, x, y, width, title, kickerKey, state, type, bucket };
}

export function createBoardFromSetup(project: MissionProject, language: Language): { nodes: MissionNode[]; links: MissionLink[] } {
  const statement = project.setup.statement.trim();
  const rootTitle = statement || (language === "pt" ? "Explorar uma nova oportunidade de missão espacial." : "Explore a new space mission opportunity.");
  const intent = project.setup.intent;

  if (intent === "technology") {
    const nodes = [
      node(1, 840, 100, rootTitle, "nodes.startKicker", "defined", "center", "main", 300),
      node(2, 520, 360, language === "pt" ? "Qual capacidade precisa ser demonstrada?" : "What capability needs to be demonstrated?", "nodes.questionKicker", "open", "question", "questions"),
      node(3, 840, 360, language === "pt" ? "Em qual ambiente a demonstração precisa funcionar?" : "In which environment must the demonstration work?", "nodes.contextKicker", "open", "question", "main"),
      node(4, 1160, 360, language === "pt" ? "O que provaria que a demonstração teve sucesso?" : "What would prove the demonstration was successful?", "nodes.resultKicker", "open", "question", "main")
    ];
    return { nodes, links: [{ id: 101, from: 1, to: 2, type: "normal" }, { id: 102, from: 1, to: 3, type: "normal" }, { id: 103, from: 1, to: 4, type: "normal" }] };
  }

  if (intent === "science") {
    const nodes = [
      node(1, 840, 100, rootTitle, "nodes.startKicker", "defined", "center", "main", 300),
      node(2, 500, 360, language === "pt" ? "Qual fenômeno ou pergunta científica precisa ser investigado?" : "Which phenomenon or scientific question needs to be investigated?", "nodes.questionKicker", "open", "question", "questions"),
      node(3, 840, 360, language === "pt" ? "Que evidência permitiria responder essa pergunta?" : "What evidence would allow that question to be answered?", "nodes.resultKicker", "open", "question", "main"),
      node(4, 1180, 360, language === "pt" ? "Onde e quando essa observação precisa acontecer?" : "Where and when does that observation need to happen?", "nodes.contextKicker", "open", "question", "main")
    ];
    return { nodes, links: [{ id: 101, from: 1, to: 2, type: "normal" }, { id: 102, from: 1, to: 3, type: "normal" }, { id: 103, from: 1, to: 4, type: "normal" }] };
  }

  if (intent === "open") {
    const nodes = [
      node(1, 840, 100, rootTitle, "nodes.startKicker", "defined", "center", "main", 300),
      node(2, 500, 360, language === "pt" ? "Que oportunidade vale a pena explorar?" : "Which opportunity is worth exploring?", "nodes.questionKicker", "open", "question", "questions"),
      node(3, 840, 360, language === "pt" ? "O que tornaria essa oportunidade útil ou relevante?" : "What would make this opportunity useful or relevant?", "nodes.resultKicker", "open", "question", "main"),
      node(4, 1180, 360, language === "pt" ? "O que ainda não sabemos e pode mudar o caminho da missão?" : "What do we still not know that could change the mission direction?", "nodes.questionKicker", "open", "question", "questions")
    ];
    return { nodes, links: [{ id: 101, from: 1, to: 2, type: "normal" }, { id: 102, from: 1, to: 3, type: "normal" }, { id: 103, from: 1, to: 4, type: "normal" }] };
  }

  const nodes = [
    node(1, 840, 100, rootTitle, "nodes.startKicker", "defined", "center", "main", 300),
    node(2, 460, 360, language === "pt" ? "O que precisa mudar para o problema ser considerado resolvido?" : "What needs to change for the problem to be considered solved?", "nodes.resultKicker", "open", "question", "main"),
    node(3, 840, 360, language === "pt" ? "Quem é afetado e quem precisa do resultado?" : "Who is affected and who needs the result?", "nodes.beneficiaryKicker", "open", "question", "main"),
    node(4, 1220, 360, language === "pt" ? "Onde, quando e com que frequência o problema acontece?" : "Where, when and how often does the problem occur?", "nodes.contextKicker", "open", "question", "main"),
    node(5, 1540, 620, language === "pt" ? "Existe alguma urgência ou janela de tempo relevante?" : "Is there any relevant urgency or time window?", "nodes.timeKicker", "open", "question", "questions")
  ];
  return { nodes, links: [{ id: 101, from: 1, to: 2, type: "normal" }, { id: 102, from: 1, to: 3, type: "normal" }, { id: 103, from: 1, to: 4, type: "normal" }, { id: 104, from: 4, to: 5, type: "normal" }] };
}

export function prepareProjectForConception(project: MissionProject, language: Language): MissionProject {
  if (project.board.nodes.length > 0) return saveProject(project);
  const board = createBoardFromSetup(project, language);
  return saveProject({ ...project, board });
}

export function buildVirtualProjectFiles(project: MissionProject): VirtualProjectFile[] {
  return [
    { path: "/project.json", description: "Project identity and schema", content: { schemaVersion: project.schemaVersion, id: project.id, name: project.name, createdAt: project.createdAt, updatedAt: project.updatedAt } },
    { path: "/config/context.json", description: "Reference program, modality, category and project team", content: project.context },
    { path: "/config/study.json", description: "Study intent, starting statement and references", content: project.setup },
    { path: "/config/progress.json", description: "Definition framework and custom criteria", content: project.progress },
    { path: "/system/architecture.json", description: "Engineering baseline, requirements and evidence", content: project.engineeringSystem ?? null },
    { path: "/config/phase-progress.json", description: "Persisted phase access and memory revision", content: { ...project.phaseProgress, memoryRevision: project.memoryRevision, systemGeneratedFromRevision: project.systemGeneratedFromRevision } },
    { path: "/boards/problem.json", description: "Problem conception graph", content: project.board },
    { path: "/studies/inconsistencies.json", description: "Focused inconsistency studies and conclusions", content: project.studies },
    { path: "/templates/active.json", description: "Active project template and locked configuration paths", content: project.templates }
  ];
}

export function exportProject(project: MissionProject): void {
  if (typeof window === "undefined") return;
  const blob = new Blob([JSON.stringify(project, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const safeName = project.name.toLowerCase().replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "mission";
  anchor.href = url;
  anchor.download = `${safeName}.mission.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function strongestStateForNodeIds(nodes: MissionNode[], nodeIds: number[]): NodeState {
  const evidence = nodes.filter((item) => nodeIds.includes(item.id) && item.state !== "closed");
  if (evidence.some((item) => item.state === "defined")) return "defined";
  if (evidence.some((item) => item.state === "hypothesis")) return "hypothesis";
  return "open";
}

/** Only engineering context changes invalidate the memory revision, not navigation or canvas moves. */
export function memoryContextFingerprint(project: MissionProject): string {
  return JSON.stringify({ projectType: project.projectType, sectors: project.context.sectors, folders: project.context.folders, teamArtifactFolders: project.context.teamArtifactFolders, programArtifactIds: project.context.programArtifactIds, programFolderId: project.context.programFolderId, name: project.name, setup: project.setup, teamId: project.context.teamId, teamArtifactIds: [...project.context.teamArtifactIds].sort(), projectArtifactIds: [...project.context.projectArtifactIds].sort(), programId: project.context.programId, modalityId: project.context.modalityId, categoryId: project.context.categoryId });
}

export function recordMemoryRevision(previous: MissionProject, next: MissionProject): MissionProject {
  if (previous.id !== next.id || memoryContextFingerprint(previous) === memoryContextFingerprint(next)) return next;
  return { ...next, memoryRevision: Math.max(previous.memoryRevision + 1, next.memoryRevision) };
}

export function completeConception(project: MissionProject, engineeringSystem: EngineeringSystemModel): MissionProject {
  return { ...project, engineeringSystem, systemGeneratedFromRevision: engineeringSystem.generatedFromRevision, phaseProgress: { highestUnlockedStep: project.phaseProgress.highestUnlockedStep === 2 ? 2 : 1 }, navigation: { ...project.navigation, lastRoute: "brainstorm", lastConceptionWorkspace: project.navigation.lastConceptionWorkspace ?? "system" } };
}
