import { describe, expect, it } from "vitest";
import { applyBrainstormAiOrganization } from "../src/lib/brainstormAiLayout";
import type { BrainstormAiAnalysis } from "../src/lib/brainstormAi";
import { createEmptyLabBoard, createLabLink, createLabNode } from "../src/lib/brainstormLab";

describe("AI brainstorm organization", () => {
  it("rewrites conservatively, places children below parents and isolates unclear ideas", () => {
    const board = createEmptyLabBoard();
    board.nodes = [
      createLabNode("detectar fogo rapido", 900, 700, "goal"),
      createLabNode("camera termica", 200, 140, "camera"),
      createLabNode("talvez satelite", 500, 300, "unclear")
    ];
    board.links = [createLabLink("goal", "camera", "confirmed")];

    const analysis: BrainstormAiAnalysis = {
      provider: "gemini",
      model: "test",
      relations: [],
      groups: [],
      nodePlans: [
        { nodeId: "goal", rewrittenText: "Detectar incêndios rapidamente", role: "objective", informationStatus: "enough", informationNeeded: "", duplicateOf: "", parentId: "", level: 0, order: 0, lane: "main" },
        { nodeId: "camera", rewrittenText: "Usar câmera térmica", role: "approach", informationStatus: "enough", informationNeeded: "", duplicateOf: "", parentId: "goal", level: 1, order: 0, lane: "main" },
        { nodeId: "unclear", rewrittenText: "Avaliar uso de satélite", role: "unclassified", informationStatus: "partial", informationNeeded: "Definir objetivo e fonte de imagens.", duplicateOf: "", parentId: "", level: 0, order: 1, lane: "needs-context" }
      ],
      tensions: [{ id: "ignored", first: "goal", second: "camera", title: "Energia", explanation: "Pode haver impacto no consumo.", question: "Qual é o orçamento de energia?", confidence: 0.7 }],
      connectionIssues: [{ from: "goal", to: "camera", title: "Premissa ausente", explanation: "A ligação pode precisar de uma condição intermediária.", question: "Qual requisito conecta o objetivo a esta abordagem?", confidence: 0.78 }]
    };

    const organized = applyBrainstormAiOrganization(board, analysis, "pt");
    const goal = organized.nodes.find((node) => node.id === "goal")!;
    const camera = organized.nodes.find((node) => node.id === "camera")!;
    const unclear = organized.nodes.find((node) => node.id === "unclear")!;

    expect(goal.text).toBe("Detectar incêndios rapidamente");
    expect(camera.y).toBeGreaterThan(goal.y);
    expect(unclear.x).toBeGreaterThan(camera.x);
    expect(organized.links).toEqual(board.links);
    expect(organized.insights.map((insight) => insight.kind).sort()).toEqual(["connection-warning", "needs-context", "tension"]);
  });

  it("never creates a confirmed relation from an AI layout parent", () => {
    const board = createEmptyLabBoard();
    board.nodes = [createLabNode("Pai", 100, 100, "parent"), createLabNode("Filho", 500, 500, "child")];
    const analysis: BrainstormAiAnalysis = {
      provider: "gemini",
      model: "test",
      relations: [{ from: "parent", to: "child", kind: "related", confidence: 0.9, reason: "Relação provável." }],
      groups: [],
      nodePlans: [
        { nodeId: "parent", rewrittenText: "Pai", role: "objective", informationStatus: "enough", informationNeeded: "", duplicateOf: "", parentId: "", level: 0, order: 0, lane: "main" },
        { nodeId: "child", rewrittenText: "Filho", role: "approach", informationStatus: "enough", informationNeeded: "", duplicateOf: "", parentId: "parent", level: 1, order: 0, lane: "main" }
      ],
      tensions: [],
      connectionIssues: []
    };

    expect(applyBrainstormAiOrganization(board, analysis, "pt").links).toHaveLength(0);
  });

  it("respects disabled automatic text and marker adjustments", () => {
    const board = createEmptyLabBoard();
    board.settings.rewriteIdeas = false;
    board.settings.flagIncomplete = false;
    board.settings.flagDuplicates = false;
    board.settings.highlightTensions = false;
    board.nodes = [
      createLabNode("texto original", 100, 100, "first"),
      createLabNode("outra ideia", 500, 100, "second")
    ];
    const analysis: BrainstormAiAnalysis = {
      provider: "gemini",
      model: "test",
      relations: [],
      groups: [],
      nodePlans: [
        { nodeId: "first", rewrittenText: "Texto reescrito", role: "objective", informationStatus: "partial", informationNeeded: "Adicionar uma meta.", duplicateOf: "second", parentId: "", level: 0, order: 0, lane: "main" },
        { nodeId: "second", rewrittenText: "Outra ideia", role: "approach", informationStatus: "enough", informationNeeded: "", duplicateOf: "", parentId: "", level: 0, order: 1, lane: "main" }
      ],
      tensions: [{ id: "tension", first: "first", second: "second", title: "Verificar", explanation: "Pode haver conflito.", question: "Confirmar?", confidence: 0.8 }],
      connectionIssues: []
    };

    const organized = applyBrainstormAiOrganization(board, analysis, "pt");
    expect(organized.nodes.find((node) => node.id === "first")?.text).toBe("texto original");
    expect(organized.insights).toHaveLength(0);
  });
});
