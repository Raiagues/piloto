import { projectOrganization } from "../../shared/organization-tree.mjs";
import { completeConception, createEmptyProject } from "./projectStore";
import type { MissionProject } from "./projectStore";
import type { ConnectedArtifact, DirectoryMember, ProjectSummary, SessionUser, TeamMember, TeamProjectSummary, TeamRecord } from "./team";
import { createQuetzalArtifacts, QUETZAL_PROJECT_ID, QUETZAL_PROJECT_NAME, contextDocuments } from "../../benchmark/quetzal1/context/design-context.mjs";

const STORAGE_KEY = "norte-pages-demo-v2";
const LEGACY_STORAGE_KEY = "norte-pages-demo-v1";
const DEMO_SCHEMA_VERSION = 6;
const TEAM_ID = "team-norte-validation";
const PROJECT_ID = QUETZAL_PROJECT_ID;
const avatarUrl = `${import.meta.env.BASE_URL}profiles/emily-raiane.png`;

type DemoState = {
  schemaVersion: number;
  validationResetId?: string;
  members: TeamMember[];
  artifacts: ConnectedArtifact[];
  teams: TeamRecord[];
  projects: Record<string, MissionProject>;
  project: MissionProject | null;
  labs: Record<string, unknown>;
};

export const DEMO_USER: SessionUser = {
  id: "pages-demo-owner",
  memberId: "pages-demo-captain",
  nickname: "emily_demo",
  name: "Emily Raiane Rodrigues",
  initials: "ER",
  email: "emilyrayannerodrigues@gmail.com",
  accessRole: "owner_admin",
  institution: "Universidade Federal de Santa Maria",
  primaryArea: "systems",
  avatarUrl,
  profileComplete: true
};

function timestamp() {
  return new Date().toISOString();
}

const DEMO_READABLE_MIMES = new Set(["application/pdf", "text/plain", "text/markdown", "text/csv", "application/json", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]);

/**
 * The browser preview has no server to decode files, so it classifies sources
 * structurally. It uses the same statuses as the API, so readiness in demo mode
 * follows the one shared rule rather than a second, looser definition.
 */
function demoArtifact(artifact: ConnectedArtifact): ConnectedArtifact {
  artifact = { ...artifact, canEdit: !artifact.official && artifact.scope !== "team" };
  const mime = /^data:([^;,]+);base64,/u.exec(artifact.url || "")?.[1] ?? "";
  if (!mime) return { ...artifact, readability: { status: "metadata_only", reason: "External links are metadata only; their contents have not been fetched." } };
  const readable = DEMO_READABLE_MIMES.has(mime);
  return { ...artifact, readability: readable
    ? { status: mime === "application/pdf" ? "pdf" : "parsed", reason: "" }
    : { status: "not_parsed", reason: "Not parsed yet. Export this document or spreadsheet as PDF, CSV, or UTF-8 text." } };
}

function id(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function initialState(): DemoState {
  const now = timestamp();
  const blank = createEmptyProject("pt");
  const project: MissionProject = {
    ...blank, id: PROJECT_ID, name: QUETZAL_PROJECT_NAME, createdAt: now, updatedAt: now, memoryRevision: 1,
    context: { ...blank.context, teamId: TEAM_ID, teamName: "Norte Validation Team", projectArtifactIds: contextDocuments.map((document) => document.id), assignments: [{ memberId: DEMO_USER.memberId, roleId: "captain", sectorId: "" }] }
  };
  const members: TeamMember[] = [{
    id: DEMO_USER.memberId, accountId: DEMO_USER.id, displayName: DEMO_USER.name,
    email: DEMO_USER.email, missionRole: "captain", primaryArea: "systems", secondaryAreas: [],
    institution: DEMO_USER.institution, course: "", academicStage: "", skills: [], availabilityHours: 0,
    notes: "", accountStatus: "active", accessRole: "owner_admin", avatarUrl, createdAt: now, updatedAt: now
  }];
  const teams: TeamRecord[] = [{
    id: TEAM_ID, name: "Norte Validation Team", description: "", memberIds: [DEMO_USER.memberId],
    artifactIds: [], joinRequests: [], createdBy: DEMO_USER.id, createdAt: now, updatedAt: now,
    membership: "member", canManage: true, captainMemberId: DEMO_USER.memberId
  }];
  return { schemaVersion: DEMO_SCHEMA_VERSION, members, artifacts: createQuetzalArtifacts(PROJECT_ID, now, DEMO_USER.id), teams, projects: { [project.id]: project }, project, labs: {} };
}

function normalizeState(value: Partial<DemoState>): DemoState {
  const fresh = initialState();
  const projects = value.projects && typeof value.projects === "object" ? { ...value.projects } : {};
  if (value.project?.id) projects[value.project.id] = value.project;
  const members = Array.isArray(value.members) ? value.members : fresh.members;
  if (!members.some((member) => member.id === DEMO_USER.memberId)) members.unshift(fresh.members[0]);
  return {
    schemaVersion: DEMO_SCHEMA_VERSION,
    validationResetId: value.validationResetId,
    members,
    artifacts: Array.isArray(value.artifacts) ? value.artifacts : [],
    teams: Array.isArray(value.teams) ? value.teams : [],
    projects,
    project: (value.project?.id ? projects[value.project.id] : Object.values(projects)[0]) || null,
    labs: value.labs && typeof value.labs === "object" ? value.labs : {}
  };
}

// Deliberate reset for the browser-only validation environment. Normal startup
// preserves existing browser data, including projects created before this refactor.
export function resetDemoValidationData(confirmation: string): void {
  if (confirmation !== "RESET_VALIDATION_DATA") throw new Error("Explicit validation reset confirmation is required.");
  const previous = readState();
  const next = initialState();
  const owner = previous.members.find((member) => member.accountId === DEMO_USER.id);
  if (owner) next.members = [owner];
  next.validationResetId = crypto.randomUUID();
  localStorage.setItem(`${STORAGE_KEY}-backup-${Date.now()}-${crypto.randomUUID()}`, JSON.stringify(previous));
  writeState(next);
  notifyValidationUpdate(next.project!);
}

/** Explicit example loading is available only in the browser demo/test environment. */
export async function loadQuetzalValidationExample(confirmation: string): Promise<MissionProject> {
  if (confirmation !== "LOAD_QUETZAL_VALIDATION") throw new Error("Explicit engineering example confirmation is required.");
  if (import.meta.env.VITE_DEMO_MODE !== "true" && import.meta.env.MODE !== "test") throw new Error("Load this example in the frontend demo: start Vite with VITE_DEMO_MODE=true.");
  const { createQuetzalDesignModel } = await import("../../benchmark/quetzal1/context/design-context.mjs");
  const previous = readState();
  if (previous.project?.id !== PROJECT_ID || !previous.projects[PROJECT_ID] || previous.project.context.teamId !== TEAM_ID) {
    throw new Error("Open Quetzal-1 EPS + COMMS before loading its design preview.");
  }
  const state = structuredClone(previous);
  const now = timestamp();
  const sources = createQuetzalArtifacts(PROJECT_ID, now, DEMO_USER.id);
  state.artifacts = [...state.artifacts.filter((artifact) => !sources.some((source) => source.id === artifact.id)), ...sources];
  const project = state.projects[PROJECT_ID];
  project.memoryRevision = (project.memoryRevision || 0) + 1;
  project.updatedAt = now;
  project.context.projectArtifactIds = [...new Set([...project.context.projectArtifactIds, ...sources.map((source) => source.id)])];
  const model = createQuetzalDesignModel();
  model.generatedFromRevision = project.memoryRevision;
  model.generatedAt = now;
  state.project = completeConception(project, model);
  state.project.navigation.lastConceptionWorkspace = "system";
  state.projects[PROJECT_ID] = state.project;
  localStorage.setItem(`${STORAGE_KEY}-example-backup-${Date.now()}-${crypto.randomUUID()}`, JSON.stringify(previous));
  writeState(state);
  notifyValidationUpdate(state.project);
  return structuredClone(state.project);
}

function notifyValidationUpdate(project: MissionProject) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("norte-demo-validation-updated", { detail: { project: structuredClone(project) } }));
  }
}

function readState(): DemoState {
  try {
    const current = localStorage.getItem(STORAGE_KEY);
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    const raw = current || legacy;
    if (raw) {
      const state = normalizeState(JSON.parse(raw) as Partial<DemoState>);
      writeState(state);
      return state;
    }
  } catch {
    // A fresh demo is safer than preserving malformed browser data.
  }
  const state = initialState();
  writeState(state);
  return state;
}

function writeState(state: DemoState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function markArtifactMemoryChanged(state: DemoState, artifactId: string) {
  for (const project of Object.values(state.projects)) {
    if (![...project.context.teamArtifactIds, ...project.context.projectArtifactIds].includes(artifactId)) continue;
    project.memoryRevision = (project.memoryRevision || 0) + 1;
    project.updatedAt = timestamp();
    if (state.project?.id === project.id) state.project = project;
  }
}

function bodyOf(init: RequestInit): Record<string, unknown> {
  return init.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
}

function summary(project: MissionProject): ProjectSummary {
  return {
    id: project.id,
    name: project.name || "Projeto sem título",
    programId: project.context.programId,
    teamId: project.context.teamId,
    updatedAt: project.updatedAt,
    memberCount: project.context.assignments.length
  };
}

export async function demoApi<T>(path: string, init: RequestInit = {}): Promise<T> {
  const state = readState();
  const method = (init.method || "GET").toUpperCase();
  const body = bodyOf(init);
  const memberMatch = path.match(/^\/team\/members\/([^/]+)$/u);

  const artifactMatch = path.match(/^\/artifacts\/([^/]+)$/u);
  const teamMatch = path.match(/^\/teams\/([^/]+)$/u);


  const teamMemberDeleteMatch = path.match(/^\/teams\/([^/]+)\/members\/([^/]+)$/u);
  const teamProjectsMatch = path.match(/^\/teams\/([^/]+)\/projects$/u);
  const projectMatch = path.match(/^\/projects\/([^/]+)$/u);
  const labMatch = path.match(/^\/workspace\/labs\/([^/]+)$/u);

  if (method === "POST" && (/^\/teams\/[^/]+\/(join-requests|members)$/.test(path) || path === "/team/members" || /^\/team\/members\/[^/]+\/invitation$/.test(path))) throw new Error("A entrada em equipes exige convite e aceite no servidor autenticado.");
  if (method === "GET" && (path === "/invitations" || /^\/teams\/[^/]+\/invitations$/.test(path))) return { invitations: [], emailConfigured: false } as T;
  if (/\/invitations|email-verification|\/directory\/nickname|\/insights$/.test(path)) throw new Error("Convites, verificação e estatísticas precisam do servidor autenticado. Esta demonstração não envia mensagens.");
  if (/\/visit$/.test(path) && method === "POST") return { ok: true } as T;
  if (path === "/system-ai/generate" && method === "POST") {
    const project = state.projects[String(body.projectId)];
    if (!project) throw new Error(body.language === "pt" ? "Projeto não encontrado." : "Project was not found.");
    if (project.engineeringSystem) return { engineeringSystem: project.engineeringSystem, memoryRevision: project.memoryRevision || 0 } as T;
    throw new Error(body.language === "pt"
      ? "A demonstração frontend não extrai documentos. A memória foi preservada; use o Norte com servidor para construir o sistema."
      : "The frontend demo cannot extract documents. Your project memory was preserved; use Norte with its server to build the system.");
  }

  if (path === "/profile" && method === "GET") return { profile: state.members.find((member) => member.id === DEMO_USER.memberId) } as T;
  if (path === "/profile" && method === "PATCH") {
    const profile = state.members.find((member) => member.id === DEMO_USER.memberId)!;
    Object.assign(profile, body, { updatedAt: timestamp() });
    Object.assign(DEMO_USER, {
      name: profile.displayName,
      initials: profile.displayName.split(/\s+/u).slice(0, 2).map((part) => part[0]).join("").toUpperCase(),
      institution: profile.institution,
      avatarUrl: profile.avatarUrl,
      profileComplete: Boolean(profile.institution && profile.course && profile.academicStage)
    });
    writeState(state);
    return { profile, user: DEMO_USER } as T;
  }

  if (path === "/teams" && method === "GET") return { teams: state.teams.map((team) => {
    const membership = team.memberIds.includes(DEMO_USER.memberId) ? "member" : "available";
    const canManage = team.createdBy === DEMO_USER.id || (membership === "member" && DEMO_USER.accessRole === "owner_admin");
    const privateData = membership === "member" || canManage;
    return {
      ...team,
      captainMemberId: team.captainMemberId || (team.createdBy === DEMO_USER.id ? DEMO_USER.memberId : null),
      memberIds: privateData ? team.memberIds : [],
      artifactIds: privateData ? team.artifactIds : [],
      joinRequests: [],
      createdBy: privateData ? team.createdBy : null,
      memberCount: team.memberCount ?? team.memberIds.length,
      artifactCount: team.artifactIds.length,
      projectCount: team.projectCount ?? Object.values(state.projects).filter((project) => project.context.teamId === team.id).length,
      membership,
      canManage
    };
  }) } as T;
  if (teamProjectsMatch && method === "GET") {
    const team = state.teams.find((item) => item.id === teamProjectsMatch[1]);
    if (!team || !team.memberIds.includes(DEMO_USER.memberId)) throw new Error("Join this team to see its projects.");
    const projects: TeamProjectSummary[] = Object.values(state.projects).filter((project) => project.context.teamId === team.id).map((project) => {
      const roles = new Map(project.context.roles.map((item) => [item.id, item.name]));
      const sectors = new Map(project.context.sectors.map((item) => [item.id, item.name]));
      return {
        ...summary(project),
        organization: projectOrganization(project, state.members),
        participants: project.context.assignments.map((assignment) => {
          const member = state.members.find((item) => item.id === assignment.memberId);
          return {
            memberId: assignment.memberId,
            displayName: member?.displayName || "Membro",
            avatarUrl: member?.avatarUrl,
            roleId: assignment.roleId,
            roleName: roles.get(assignment.roleId) || assignment.roleId,
            sectorId: assignment.sectorId,
            sectorName: sectors.get(assignment.sectorId) || ""
          };
        })
      };
    });
    return { projects } as T;
  }
  if (path === "/directory/members" && method === "GET") {
    const directory: DirectoryMember[] = state.members.filter((member) => member.accountStatus === "active").map((member, index) => ({
      id: member.accountId || member.id,
      displayName: member.displayName,
      institution: member.institution,
      course: member.course,
      avatarUrl: member.avatarUrl,
      presence: member.id === DEMO_USER.memberId || index === 1 ? "online" : index < 4 ? "recent" : "offline"
    }));
    return { members: directory } as T;
  }
  if (path === "/teams" && method === "POST") {
    const now = timestamp();
    const team: TeamRecord = { id: id("team"), name: String(body.name || "Nova equipe"), description: String(body.description || ""), memberIds: [DEMO_USER.memberId], artifactIds: [], joinRequests: [], createdBy: DEMO_USER.id, captainMemberId: DEMO_USER.memberId, createdAt: now, updatedAt: now, membership: "member", canManage: true };
    state.teams.push(team);
    writeState(state);
    return { team } as T;
  }
  if (teamMatch && method === "PATCH") {
    const team = state.teams.find((item) => item.id === teamMatch[1]);
    if (team) Object.assign(team, body, { updatedAt: timestamp() });
    writeState(state);
    return { team } as T;
  }
  if (teamMatch && method === "DELETE") {
    const teamId = teamMatch[1];
    if (Object.values(state.projects).some((project) => project.context.teamId === teamId)) throw new Error("Move or delete the projects connected to this team first.");
    if (state.artifacts.some(a => a.scope === "team" && a.ownerId === teamId)) throw new Error("Esta equipe possui documentos preservados.");
    state.teams = state.teams.filter((team) => team.id !== teamId);
    writeState(state);
    return undefined as T;
  }
  if (teamMemberDeleteMatch && method === "DELETE") {
    const team = state.teams.find((item) => item.id === teamMemberDeleteMatch[1]);
    if (team) {
      team.memberIds = team.memberIds.filter((memberId) => memberId !== teamMemberDeleteMatch[2]);
      team.joinRequests = team.joinRequests.filter((memberId) => memberId !== teamMemberDeleteMatch[2]);
      Object.values(state.projects).forEach((project) => {
        if (project.context.teamId === team.id) project.context.assignments = project.context.assignments.filter((assignment) => assignment.memberId !== teamMemberDeleteMatch[2]);
      });
    }
    writeState(state);
    return undefined as T;
  }

  if (path === "/projects" && method === "GET") return { validationResetId: state.validationResetId, projects: Object.values(state.projects).map(summary).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) } as T;
  if (path === "/projects" && method === "POST") {
    const project = body as unknown as MissionProject;
    state.projects[project.id] = project;
    state.project = project;
    writeState(state);
    return { project, revision: 1 } as T;
  }
  if (projectMatch && method === "GET") return { project: state.projects[projectMatch[1]] || null, revision: 1 } as T;
  if (projectMatch && method === "PUT") {
    const project = body as unknown as MissionProject;
    state.projects[project.id] = project;
    state.project = project;
    writeState(state);
    return { project, revision: 1 } as T;
  }
  if (projectMatch && method === "DELETE") {
    const projectId = projectMatch[1];
    const artifactIds = new Set(state.projects[projectId]?.context.projectArtifactIds || []);
    state.artifacts = state.artifacts.filter((artifact) => !artifactIds.has(artifact.id) && !(artifact.scope === "project" && artifact.ownerId === projectId));
    delete state.projects[projectId];
    delete state.labs[projectId];
    state.project = Object.values(state.projects).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] || null;
    writeState(state);
    return undefined as T;
  }

  if (path === "/team/members" && method === "GET") return { members: state.members } as T;
  if (path === "/artifacts" && method === "GET") return { artifacts: state.artifacts.map(demoArtifact) } as T;
  if (path === "/workspace/project" && method === "GET") return { validationResetId: state.validationResetId, project: state.project, revision: state.project ? 1 : 0 } as T;
  if (path === "/workspace/project" && method === "PUT") {
    const project = body as unknown as MissionProject;
    state.project = project;
    state.projects[project.id] = project;
    writeState(state);
    return { project, revision: 1 } as T;
  }
  if (labMatch && method === "GET") return { board: state.labs[labMatch[1]] ?? null, revision: state.labs[labMatch[1]] ? 1 : 0 } as T;
  if (labMatch && method === "PUT") {
    state.labs[labMatch[1]] = body;
    writeState(state);
    return { board: body, revision: 1 } as T;
  }

  if (memberMatch && method === "PATCH") {
    const member = state.members.find((item) => item.id === memberMatch[1]);
    if (member) Object.assign(member, body, { updatedAt: timestamp() });
    writeState(state);
    return { member } as T;
  }
  if (memberMatch && method === "DELETE") {
    state.members = state.members.filter((item) => item.id !== memberMatch[1]);
    state.teams.forEach((team) => { team.memberIds = team.memberIds.filter((memberId) => memberId !== memberMatch[1]); });
    writeState(state);
    return undefined as T;
  }

  if (path === "/artifacts" && method === "POST") {
    const now = timestamp();
    const artifact = { ...body, id: id("artifact"), official: false, createdBy: DEMO_USER.id, connectedAt: now, updatedAt: now } as ConnectedArtifact;
    state.artifacts.push(artifact);
    if (artifact.scope === "project" && artifact.ownerId && state.projects[artifact.ownerId]) {
      const project = state.projects[artifact.ownerId];
      project.context.projectArtifactIds = [...new Set([...project.context.projectArtifactIds, artifact.id])];
    }
    if (artifact.scope === "team") {
      const team = state.teams.find((item) => item.id === artifact.ownerId);
      if (team) team.artifactIds = [...new Set([...team.artifactIds, artifact.id])];
    }
    writeState(state);
    return { artifact } as T;
  }
  if (artifactMatch && method === "PATCH") {
    const artifact = state.artifacts.find((item) => item.id === artifactMatch[1]);
    if (artifact) {
      Object.assign(artifact, body, { updatedAt: timestamp() });
      markArtifactMemoryChanged(state, artifact.id);
    }
    writeState(state);
    return { artifact } as T;
  }
  if (artifactMatch && method === "DELETE") {
    const artifact = state.artifacts.find((item) => item.id === artifactMatch[1]);
    if (artifact?.official) throw new Error("Official references cannot be disconnected.");
    if (artifact) markArtifactMemoryChanged(state, artifact.id);
    state.artifacts = state.artifacts.filter((item) => item.id !== artifactMatch[1]);
    state.teams.forEach((team) => { team.artifactIds = team.artifactIds.filter((artifactId) => artifactId !== artifactMatch[1]); });
    for (const project of Object.values(state.projects)) {
      project.context.teamArtifactIds = project.context.teamArtifactIds.filter((artifactId) => artifactId !== artifactMatch[1]);
      project.context.projectArtifactIds = project.context.projectArtifactIds.filter((artifactId) => artifactId !== artifactMatch[1]);
    }
    writeState(state);
    return undefined as T;
  }

  throw new Error(`Unsupported Pages demo request: ${method} ${path}`);
}
