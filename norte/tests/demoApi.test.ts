import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoApi, DEMO_USER, loadQuetzalValidationExample, resetDemoValidationData } from "../src/lib/demoApi";
import { createEmptyProject } from "../src/lib/projectStore";
import type { MissionProject } from "../src/lib/projectStore";
import type { ConnectedArtifact, TeamRecord, ProjectSummary } from "../src/lib/team";
import type { EngineeringSystemModel } from "../src/lib/engineeringSystem";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(), getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => values.delete(key), setItem: (key, value) => { values.set(key, value); }
  };
}

describe("browser validation data", () => {
  beforeEach(() => vi.stubGlobal("localStorage", memoryStorage()));
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it("starts with one neutral team and one project with curated design context owned by that team", async () => {
    const { teams } = await demoApi<{ teams: TeamRecord[] }>("/teams");
    const { projects } = await demoApi<{ projects: ProjectSummary[] }>("/projects");
    expect(teams).toHaveLength(1);
    expect(projects).toHaveLength(1);
    expect(teams[0].name).toBe("Norte Validation Team");
    expect(projects[0].name).toBe("Quetzal-1 EPS + COMMS");
    expect(projects[0].teamId).toBe(teams[0].id);
    expect((await demoApi<{ artifacts: ConnectedArtifact[] }>("/artifacts")).artifacts).toHaveLength(2);
    expect(JSON.stringify({ teams, projects })).not.toMatch(/Aurora|Payload Sentinel|OBSAT/u);
  });

  it("preserves existing browser projects on startup until an explicit backed-up reset", async () => {
    await demoApi("/projects");
    const state = JSON.parse(localStorage.getItem("norte-pages-demo-v2")!);
    const oldProject = { ...state.project, id: "old-project", name: "Payload Sentinel" };
    state.schemaVersion = 5;
    state.projects = { [oldProject.id]: oldProject };
    state.project = oldProject;
    state.teams[0].name = "Equipe Aurora";
    state.members[0].notes = "Preserve this account profile";
    state.labs = { "old-project": { nodes: [{ id: 1, text: "Legacy exploration" }] } };
    localStorage.setItem("norte-pages-demo-v2", JSON.stringify(state));
    expect((await demoApi<{ projects: ProjectSummary[] }>("/projects")).projects[0].id).toBe("old-project");
    expect(() => resetDemoValidationData("yes")).toThrow(/confirmation/);
    resetDemoValidationData("RESET_VALIDATION_DATA");
    const saved = JSON.parse(localStorage.getItem("norte-pages-demo-v2")!);
    expect(Object.keys(saved.projects)).toEqual(["quetzal1-eps-comms"]);
    expect(saved.teams).toHaveLength(1);
    expect(saved.labs).toEqual({});
    expect(saved.members[0].accountId).toBe(DEMO_USER.id);
    expect(saved.members[0].notes).toBe("Preserve this account profile");
    expect(saved.validationResetId).toEqual(expect.any(String));
    const backupKey = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)).find((key) => key?.includes("-backup-"));
    const backup = JSON.parse(localStorage.getItem(backupKey!)!);
    expect(backup.project.id).toBe("old-project");
    expect(backup.labs["old-project"].nodes).toHaveLength(1);
  });

  it("explains unavailable document extraction in either language and preserves design memory", async () => {
    const before = await demoApi<{ project: MissionProject }>("/workspace/project");
    for (const [language, message] of [["pt", /demonstração frontend não extrai documentos/u], ["en", /frontend demo cannot extract documents/u]]) {
      await expect(demoApi("/system-ai/generate", { method: "POST", body: JSON.stringify({ projectId: before.project.id, language }) })).rejects.toThrow(message as RegExp);
    }
    const after = await demoApi<{ project: MissionProject }>("/workspace/project");
    expect(after.project).toEqual(before.project);
    expect(after.project.engineeringSystem).toBeUndefined();
    expect((await demoApi<{ artifacts: ConnectedArtifact[] }>("/artifacts")).artifacts).toHaveLength(2);
  });

  it("loads the curated design preview only with explicit confirmation and preserves a backup", async () => {
    await expect(loadQuetzalValidationExample("yes")).rejects.toThrow(/confirmation/);
    const project = await loadQuetzalValidationExample("LOAD_QUETZAL_VALIDATION");
    expect(project.id).toBe("quetzal1-eps-comms");
    expect(project.engineeringSystem?.entities).toHaveLength(18);
    expect(project.engineeringSystem?.requirements).toHaveLength(5);
    expect(project.phaseProgress.highestUnlockedStep).toBe(1);
    expect(project.navigation.lastConceptionWorkspace).toBe("system");
    expect(project.context.projectArtifactIds).toEqual(["quetzal-design-memory", "quetzal-analysis-method"]);
    expect(project.systemGeneratedFromRevision).toBe(project.memoryRevision);
    expect(project.engineeringSystem?.generatedFromRevision).toBe(project.memoryRevision);
    const { artifacts } = await demoApi<{ artifacts: ConnectedArtifact[] }>("/artifacts");
    expect(artifacts).toHaveLength(2);
    expect(artifacts[0].ownerId).toBe(project.id);
    expect(artifacts[0].tags).toContain("design-context");
    expect(atob(artifacts[0].url.split(",")[1])).toContain("transmit input power 2640 mW");
    expect((await demoApi<{ project: MissionProject }>("/workspace/project")).project).toEqual(project);
    const backupKey = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)).find((key) => key?.includes("-example-backup-"));
    expect(JSON.parse(localStorage.getItem(backupKey!)!).project.engineeringSystem).toBeUndefined();
  });

  it("refuses example loading in the full production client or another active project", async () => {
    vi.stubEnv("MODE", "production");
    vi.stubEnv("VITE_DEMO_MODE", "false");
    await expect(loadQuetzalValidationExample("LOAD_QUETZAL_VALIDATION")).rejects.toThrow(/frontend demo/);
    vi.stubEnv("VITE_DEMO_MODE", "true");
    const project = { ...createEmptyProject(), id: "other-project", name: "Another project" };
    await demoApi("/projects", { method: "POST", body: JSON.stringify(project) });
    await expect(loadQuetzalValidationExample("LOAD_QUETZAL_VALIDATION")).rejects.toThrow(/Open Quetzal-1 EPS/u);
    expect((await demoApi<{ project: MissionProject }>("/workspace/project")).project).toEqual(project);
    expect((await demoApi<{ artifacts: ConnectedArtifact[] }>("/artifacts")).artifacts).toHaveLength(2);
  });

  it("reuses an existing baseline for repeated generation requests without modifying the project", async () => {
    const project = await loadQuetzalValidationExample("LOAD_QUETZAL_VALIDATION");
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await demoApi<{ engineeringSystem: EngineeringSystemModel; memoryRevision: number }>("/system-ai/generate", { method: "POST", body: JSON.stringify({ projectId: project.id, language: "en" }) });
      expect(response.engineeringSystem).toEqual(project.engineeringSystem);
      expect(response.memoryRevision).toBe(project.memoryRevision);
    }
    expect((await demoApi<{ project: MissionProject }>("/workspace/project")).project).toEqual(project);
  });

  it("updates memory revisions for linked artifact edits and deletion while preserving the baseline", async () => {
    const baselineProject = await loadQuetzalValidationExample("LOAD_QUETZAL_VALIDATION");
    const unrelated = { ...createEmptyProject(), id: "unrelated-project", name: "Unrelated" };
    await demoApi("/projects", { method: "POST", body: JSON.stringify(unrelated) });
    await demoApi("/artifacts/quetzal-design-memory", { method: "PATCH", body: JSON.stringify({ description: "Reviewed source metadata" }) });
    const updated = (await demoApi<{ project: MissionProject }>(`/projects/${baselineProject.id}`)).project;
    expect(updated.memoryRevision).toBe(baselineProject.memoryRevision + 1);
    expect(updated.engineeringSystem).toEqual(baselineProject.engineeringSystem);
    expect(updated.systemGeneratedFromRevision).toBe(baselineProject.memoryRevision);
    expect((await demoApi<{ project: MissionProject }>(`/projects/${unrelated.id}`)).project.memoryRevision).toBe(0);
    await demoApi("/artifacts/quetzal-design-memory", { method: "DELETE" });
    const deleted = (await demoApi<{ project: MissionProject }>(`/projects/${baselineProject.id}`)).project;
    expect(deleted.memoryRevision).toBe(baselineProject.memoryRevision + 2);
    expect(deleted.context.projectArtifactIds).toEqual(["quetzal-analysis-method"]);
    expect(deleted.engineeringSystem).toEqual(baselineProject.engineeringSystem);
    expect((await demoApi<{ artifacts: ConnectedArtifact[] }>("/artifacts")).artifacts).toHaveLength(1);
  });
});
