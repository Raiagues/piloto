import { describe, expect, it } from "vitest";
import {
  appendLabAction,
  classifyLabDomain,
  computeGentleLabLayout,
  createLabAction,
  createEmptyLabBoard,
  createLabLink,
  createLabNode,
  deriveLabGroups,
  deriveMissionDomains,
  deriveLabSuggestions,
  labStorageKey,
  layoutLabTopDown,
  loadLabBoard,
  organizeLabIntoDomains,
  saveLabBoard
} from "../src/lib/brainstormLab";

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

describe("experimental brainstorm board", () => {
  it("keeps its data isolated per project", () => {
    const storage = memoryStorage();
    const board = createEmptyLabBoard();
    board.nodes.push(createLabNode("Detectar queimadas mais rápido", 300, 200, "idea-a"));
    saveLabBoard("mission-a", board, storage);

    expect(loadLabBoard("mission-a", storage).nodes[0].text).toContain("queimadas");
    expect(loadLabBoard("mission-b", storage).nodes).toHaveLength(0);
    expect(storage.getItem(labStorageKey("mission-a"))).not.toBeNull();
  });

  it("persists team memory and AI insights with the canvas", () => {
    const storage = memoryStorage();
    let board = createEmptyLabBoard();
    board.nodes = [createLabNode("Baixo consumo", 120, 160, "energy")];
    board = appendLabAction(board, createLabAction("created", "Created without AI.", ["energy"], "team", "action-1", "2026-09-01T00:00:00.000Z"));
    board.insights = [{
      id: "needs-context:energy",
      kind: "needs-context",
      nodeIds: ["energy"],
      title: "Precisa de contexto",
      detail: "Definir uma meta mensurável.",
      question: "Qual é o limite?",
      source: "gemini",
      updatedAt: "2026-09-01T00:00:01.000Z"
    }];

    saveLabBoard("mission-memory", board, storage);
    const loaded = loadLabBoard("mission-memory", storage);
    expect(loaded.teamMemory[0]).toMatchObject({ kind: "created", source: "team" });
    expect(loaded.insights[0]).toMatchObject({ kind: "needs-context", nodeIds: ["energy"] });
  });

  it("suggests contextual relationships without confirming them", () => {
    const board = createEmptyLabBoard();
    board.nodes = [
      createLabNode("Precisa funcionar à noite", 300, 200, "night", "2026-01-01T00:00:00.000Z"),
      createLabNode("Usar câmera térmica", 720, 260, "thermal", "2026-01-01T00:00:01.000Z")
    ];

    const suggestions = deriveLabSuggestions(board);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({ from: "night", to: "thermal", kind: "related" });
    expect(board.links).toHaveLength(0);

    board.links.push(createLabLink("night", "thermal", "confirmed"));
    expect(deriveLabSuggestions(board)).toHaveLength(0);
  });

  it("recognizes provisional groups from raw ideas", () => {
    const board = createEmptyLabBoard();
    board.nodes = [
      createLabNode("Detectar queimadas", 100, 100, "one"),
      createLabNode("Monitorar incêndios", 400, 100, "two"),
      createLabNode("Avisar a equipe", 700, 100, "three")
    ];
    expect(deriveLabGroups(board, "pt").some((group) => group.label === "Queimadas" && group.nodeIds.length === 2)).toBe(true);
  });

  it("moves ideas gently while preserving manually positioned cards", () => {
    const board = createEmptyLabBoard();
    board.nodes = [
      { ...createLabNode("Operar à noite", 100, 100, "pinned"), pinned: true },
      createLabNode("Câmera térmica", 850, 100, "moving")
    ];
    const beforeDistance = board.nodes[1].x - board.nodes[0].x;
    const arranged = computeGentleLabLayout(board, deriveLabSuggestions(board), "moving");
    const afterDistance = arranged[1].x - arranged[0].x;

    expect(arranged[0]).toMatchObject({ x: 100, y: 100, pinned: true });
    expect(afterDistance).toBeLessThan(beforeDistance);
    expect(Math.abs(arranged[1].x - board.nodes[1].x)).toBeLessThanOrEqual(64);
  });

  it("arranges confirmed hierarchies even when automatic movement is disabled", () => {
    const board = createEmptyLabBoard();
    board.settings.autoOrganize = false;
    board.nodes = [
      createLabNode("Objetivo", 80, 900, "parent"),
      createLabNode("Alternativa A", 1200, 120, "child-a"),
      createLabNode("Alternativa B", 300, 500, "child-b")
    ];
    board.links = [
      createLabLink("parent", "child-a", "link-a"),
      createLabLink("parent", "child-b", "link-b")
    ];

    const arranged = layoutLabTopDown(board);
    const parent = arranged.find((node) => node.id === "parent")!;
    const children = arranged.filter((node) => node.id.startsWith("child"));
    const childrenCenter = children.reduce((sum, node) => sum + node.x + 120, 0) / children.length;

    expect(children.every((node) => node.y > parent.y)).toBe(true);
    expect(Math.abs(parent.x + 120 - childrenCenter)).toBeLessThan(2);
    expect(board.links.map((link) => [link.from, link.to])).toEqual([
      ["parent", "child-a"],
      ["parent", "child-b"]
    ]);
  });

  it("classifies ideas into mission areas and keeps local parents above children", () => {
    const board = createEmptyLabBoard();
    board.settings.missionStructure = true;
    board.nodes = [
      createLabNode("Definir o problema das queimadas", 800, 600, "problem"),
      createLabNode("Identificar quem precisa do alerta", 120, 900, "beneficiary"),
      createLabNode("Usar câmera térmica", 300, 300, "camera")
    ];
    board.links = [createLabLink("problem", "beneficiary", "confirmed")];

    const organized = organizeLabIntoDomains(board, "pt");
    const problem = organized.nodes.find((node) => node.id === "problem")!;
    const beneficiary = organized.nodes.find((node) => node.id === "beneficiary")!;

    expect(classifyLabDomain("Bateria e orçamento de potência")).toBe("electronics");
    expect(problem.domainId).toBe("mission");
    expect(organized.nodes.find((node) => node.id === "camera")?.domainId).toBe("payload");
    expect(beneficiary.y).toBeGreaterThan(problem.y);
    expect(deriveMissionDomains(organized, "pt").map((domain) => domain.id)).toEqual(["mission", "payload"]);
  });

  it("creates a question instead of inventing a missing hierarchy link", () => {
    const board = createEmptyLabBoard();
    board.settings.missionStructure = true;
    board.nodes = [
      createLabNode("Câmera térmica", 100, 100, "camera"),
      createLabNode("Armazenar imagens", 500, 100, "storage")
    ];

    const organized = organizeLabIntoDomains(board, "pt");
    expect(organized.links).toHaveLength(0);
    expect(organized.gaps).toHaveLength(1);
    expect(organized.gaps[0]).toMatchObject({ domainId: "payload", source: "local" });
    expect(organized.gaps[0].prompt).toContain("dado");
  });
});
