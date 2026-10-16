import { describe, expect, it } from "vitest";
import { buildVirtualProjectFiles, createBoardFromSetup, createEmptyProject, loadProject, normalizeProject, saveProject, strongestStateForNodeIds } from "../src/lib/projectStore";
import { programModality, referenceProgram } from "../src/lib/programs";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value)
  };
}

describe("mission project model", () => {
  it("creates a versioned exportable project", () => {
    const project = createEmptyProject("en");
    expect(project.schemaVersion).toBe(2);
    expect(project.context.configured).toBe(false);
    expect(project.name).toBe("");
    expect(buildVirtualProjectFiles(project).map((file) => file.path)).toContain("/config/context.json");
    expect(buildVirtualProjectFiles(project).map((file) => file.path)).toContain("/config/progress.json");
    expect(buildVirtualProjectFiles(project).map((file) => file.path)).toContain("/studies/inconsistencies.json");
  });

  it("upgrades an existing project with the new context without changing its board", () => {
    const legacy = createEmptyProject("pt");
    const board = createBoardFromSetup(legacy, "pt");
    Reflect.deleteProperty(legacy, "context");
    legacy.board = board;
    const normalized = normalizeProject(legacy, "pt");
    expect(normalized.context.configured).toBe(false);
    expect(normalized.context.roles.map((role) => role.id)).toContain("captain");
    expect(normalized.board).toEqual(board);
  });

  it("exposes OBSAT modalities and the university N3 category", () => {
    const obsat = referenceProgram("obsat");
    const practical = programModality(obsat, "practical");
    expect(obsat?.available).toBe(true);
    expect(obsat?.modalities.map((modality) => modality.id)).toEqual(["practical", "theoretical"]);
    expect(practical?.categories.some((category) => category.id === "n3")).toBe(true);
    expect(practical?.officialDocuments.length).toBeGreaterThanOrEqual(2);
  });

  it("seeds a problem study without selecting spacecraft hardware", () => {
    const project = createEmptyProject("en");
    project.setup.intent = "problem";
    project.setup.statement = "Reduce the delay in detecting new wildfire outbreaks.";
    const board = createBoardFromSetup(project, "en");
    expect(board.nodes[0].title).toContain("wildfire");
    expect(board.nodes.some((node) => (node.title ?? "").toLowerCase().includes("antenna"))).toBe(false);
    expect(board.nodes.some((node) => (node.title ?? "").toLowerCase().includes("orbit"))).toBe(false);
  });

  it("derives custom criterion state from project evidence", () => {
    const project = createEmptyProject("en");
    const board = createBoardFromSetup(project, "en");
    const ids = [board.nodes[0].id];
    expect(strongestStateForNodeIds(board.nodes, ids)).toBe("defined");
  });

  it("restores card positions, content and connection ports from storage", () => {
    const hadWindow = "window" in globalThis;
    const previousWindow = globalThis.window;
    Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: memoryStorage() } });

    try {
      const project = createEmptyProject("en");
      const board = createBoardFromSetup(project, "en");
      board.nodes[0] = { ...board.nodes[0], x: 437, y: 219, title: "Saved card content", titleKey: undefined };
      board.links[0] = { ...board.links[0], sourceSide: "bottom", targetSide: "left", sourceOrder: 2, targetOrder: 1 };
      saveProject({ ...project, board });

      expect(loadProject("en").board).toEqual(board);
    } finally {
      if (hadWindow) Object.defineProperty(globalThis, "window", { configurable: true, value: previousWindow });
      else Reflect.deleteProperty(globalThis, "window");
    }
  });
});
