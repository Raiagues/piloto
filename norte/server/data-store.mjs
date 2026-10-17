import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { normalizeNickname, uniqueNickname, validNickname } from "./team-identity.mjs";
import { randomUUID } from "node:crypto";
import { QUETZAL_PROJECT_ID, QUETZAL_PROJECT_NAME, QUETZAL_TEAM_ID, QUETZAL_TEAM_NAME } from "../examples/quetzal1/source-manifest.mjs";

export const VALIDATION_TEAM_ID = QUETZAL_TEAM_ID;
export const VALIDATION_PROJECT_ID = QUETZAL_PROJECT_ID;
export const VALIDATION_TEAM_NAME = QUETZAL_TEAM_NAME;
export const VALIDATION_PROJECT_NAME = QUETZAL_PROJECT_NAME;

export function createValidationProject(timestamp = new Date().toISOString()) {
  return {
    schemaVersion: 2,
    id: VALIDATION_PROJECT_ID,
    name: QUETZAL_PROJECT_NAME,
    createdAt: timestamp,
    updatedAt: timestamp,
    navigation: { lastRoute: "setup" },
    phaseProgress: { highestUnlockedStep: 0 },
    memoryRevision: 1,
    context: {
      // Quetzal-1 is an independent engineering project: it has no competition
      // program, modality or category. Real documents are attached by the
      // explicit importer, never invented by application startup.
      configured: false, programId: null, modalityId: null, categoryId: null, referenceProgram: "independent",
      teamId: VALIDATION_TEAM_ID, teamName: VALIDATION_TEAM_NAME,
      teamArtifactIds: [], projectArtifactIds: [],
      roles: [{ id: "captain", name: "Lead" }, { id: "manager", name: "Manager" }, { id: "member", name: "Member" }, { id: "advisor", name: "Advisor" }],
      sectors: [], assignments: []
    },
    setup: { intent: "problem", statement: "", framework: "norte-core", references: [] },
    board: { nodes: [], links: [] },
    progress: { mode: "standard", customCriteria: [] },
    studies: [], resolvedIssueKeys: [],
    templates: { activeTemplateId: "norte-core-v1", lockedPaths: [] }
  };
}

export function createInitialData() {
  const timestamp = new Date().toISOString();
  const project = { document: createValidationProject(timestamp), revision: 1, updatedAt: timestamp };
  return {
    schemaVersion: 10,
    createdAt: timestamp,
    updatedAt: timestamp,
    users: [], members: [], artifacts: [], sessions: [], invitations: [], emailVerifications: [], teamStats: {}, activity: [], meetings: {}, meetingInvitations: [],
    teams: [{
      id: VALIDATION_TEAM_ID, name: VALIDATION_TEAM_NAME, description: "",
      memberIds: [], artifactIds: [], joinRequests: [], createdBy: null,
      createdAt: timestamp, updatedAt: timestamp
    }],
    workspace: { project, projects: { [VALIDATION_PROJECT_ID]: project }, labs: {} }
  };
}

export function normalizeStoredData(value, { copy = true } = {}) {
  if (!value || ![1, 2, 3, 4, 5, 6, 7, 8, 9, 10].includes(value.schemaVersion) || !Array.isArray(value.users) || !Array.isArray(value.members) || !Array.isArray(value.artifacts)) {
    throw new Error("Unsupported Norte data schema.");
  }
  // Normal startup only normalizes shape. Removing old demo data is an explicit,
  // guarded operation in scripts/reset-validation-data.mjs, never a migration.
  const previousSchema = value.schemaVersion;
  // A freshly decoded compressed database snapshot is already privately owned.
  // Other callers retain copy-on-normalize, including JSON stores and tools.
  const data = copy ? structuredClone(value) : value;
  data.schemaVersion = 10;
  data.invitations ??= [];
  data.emailVerifications ??= [];
  data.teamStats ??= {};
  data.activity ??= [];
  data.meetings ??= {};
  data.meetingInvitations ??= [];
  const named = [];
  for (const user of data.users) {
    const nickname = normalizeNickname(user.nickname);
    // Keep valid legacy public names; generated names must not shadow a login.
    if (validNickname(nickname) && !named.some(u => u.nickname === nickname)) user.nickname = nickname;
    else {
      const reserved = [...named, ...data.users.filter(other => other !== user && other.login).map(other => ({ login: other.login }))];
      user.nickname = uniqueNickname(reserved, user.name);
    }
    user.emailVerifiedAt ??= null;
    named.push(user);
  }
  data.sessions = Array.isArray(data.sessions) ? data.sessions : [];
  data.teams = Array.isArray(data.teams) ? data.teams : [];
  data.workspace = data.workspace && typeof data.workspace === "object" && !Array.isArray(data.workspace)
    ? data.workspace : { project: null, projects: {}, labs: {} };
  data.workspace.project ??= null;
  if (!data.workspace.projects || typeof data.workspace.projects !== "object" || Array.isArray(data.workspace.projects)) data.workspace.projects = {};
  if (data.workspace.project?.document?.id) data.workspace.projects[data.workspace.project.document.id] ??= data.workspace.project;
  if (!data.workspace.labs || typeof data.workspace.labs !== "object" || Array.isArray(data.workspace.labs)) data.workspace.labs = {};
  data.artifacts = data.artifacts.map((artifact) => ({
    ...artifact,
    url: typeof artifact.url === "string" ? artifact.url.replace(/^\/mission-dev\/artifacts\//u, "artifacts/") : artifact.url,
    scope: artifact.scope === "team" ? "team" : "project", ownerId: artifact.ownerId ?? null
  }));
  for (const team of data.teams) {
    team.captainMemberId ??= data.users.find(user => user.id === team.createdBy)?.memberId || null;
    team.adminMemberIds ??= [];
    team.memberIds = Array.isArray(team.memberIds) ? team.memberIds : [];
    if (previousSchema < 10) {
      const awaiting = team.memberIds.filter(id => data.members.some(m => m.id === id && !m.accountId && m.accountStatus === 'invited'));
      team.legacyInvitedMemberIds = [...new Set([...(team.legacyInvitedMemberIds || []), ...awaiting])];
      team.memberIds = team.memberIds.filter(id => !awaiting.includes(id));
    }
    team.artifactIds = Array.isArray(team.artifactIds) ? team.artifactIds : [];
    team.joinRequests = Array.isArray(team.joinRequests) ? team.joinRequests : [];
  }
  for (const record of Object.values(data.workspace.projects)) {
    const project = record?.document;
    if (!project?.context) continue;
    record.createdBy ??= data.teams.find(team => team.id === project.context.teamId)?.createdBy || undefined;
    project.creatorId ??= record.createdBy;
    project.context.folders ??= [];
    project.context.sectors ??= [];
    project.context.assignments ??= [];
    project.context.roles ??= createValidationProject().context.roles;
    project.context.teamId ??= data.teams.find((team) => team.name === project.context.teamName)?.id ?? null;
    project.context.teamArtifactIds = Array.isArray(project.context.teamArtifactIds) ? project.context.teamArtifactIds : [];
    project.context.projectArtifactIds = Array.isArray(project.context.projectArtifactIds) ? project.context.projectArtifactIds : [];
  }
  if (data.workspace.project?.document?.id) data.workspace.project = data.workspace.projects[data.workspace.project.document.id];
  return data;
}

function clone(value) {
  return structuredClone(value);
}

export class JsonDataStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = null;
    this.queue = Promise.resolve();
  }

  async init() {
    await mkdir(dirname(this.filePath), { recursive: true });
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8"));
      this.data = normalizeStoredData(parsed);
      if (parsed.schemaVersion !== this.data.schemaVersion) await this.persist(this.data);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      this.data = createInitialData();
      await this.persist(this.data);
    }
    return this;
  }

  read(select = value => value) {
    if (!this.data) throw new Error("Data store was not initialized.");
    return clone(select(this.data));
  }

  update(mutator) {
    const operation = this.queue.then(async () => {
      const draft = this.read();
      const result = await mutator(draft);
      draft.updatedAt = new Date().toISOString();
      await this.persist(draft);
      this.data = draft;
      return clone(result);
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }

  async persist(data) {
    const temporaryPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
    await rename(temporaryPath, this.filePath);
    await chmod(this.filePath, 0o600);
  }

  async close() {}
}
