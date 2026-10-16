import { describe, expect, it } from "vitest";
import { createEmptyLabBoard, createLabNode, createLabLink, normalizeLabBoard, saveLabBoard, loadLabBoard } from "../src/lib/brainstormLab";
import { discoveryInput, discoveryInputKey, hypothesisFields, hypothesisText, interpretationErrorMessage } from "../src/lib/discoveryHypothesis";
import { createBrainstormAiRequest } from "../src/lib/brainstormAi";

describe("Discovery hypothesis persistence and context", () => {
  it("keeps all 6000 characters after save, reload and API construction while old cards keep their text", () => {
    const board = createEmptyLabBoard();
    const text = "Detalhes da hipótese. ".repeat(300).slice(0, 6000);
    board.nodes = [createLabNode(text, 10, 20, "long"), createLabNode("Rádio 1.2 A", 20, 30, "old")];
    const memory = new Map<string, string>();
    const storage = { setItem: (key: string, value: string) => { memory.set(key, value); }, getItem: (key: string) => memory.get(key) || null };
    saveLabBoard("test", board, storage);
    const restored = loadLabBoard("test", storage);
    expect(restored.nodes[0].text.length).toBeLessThanOrEqual(220);
    expect(hypothesisText(restored.nodes[0])).toBe(text);
    expect(discoveryInput(restored, restored.nodes[0]).text).toBe(text);
    expect(createBrainstormAiRequest(restored, "pt").nodes[0].description).toBe(text);
    expect(hypothesisText(restored.nodes[1])).toBe("Rádio 1.2 A");
    expect(() => hypothesisFields("x".repeat(6001))).toThrow();
  });

  it("sends direct linked cards and clarification answers, excludes unrelated cards and coordinates", () => {
    const board = createEmptyLabBoard();
    board.nodes = [createLabNode("Esta câmera deve ter 1 kg", 0, 0, "idea"), createLabNode("Câmera de inspeção", 500, 0, "context"), createLabNode("PRIVATE_UNRELATED", 0, 1, "unrelated")];
    board.nodes[0].clarifications = [{ question: "Qual câmera?", answer: "A de inspeção" }];
    board.nodes[0].pendingClarification = { question: "Em qual modo de operação?" };
    board.links = [createLabLink("context", "idea")];
    const restored = normalizeLabBoard(JSON.parse(JSON.stringify(board)));
    const input = discoveryInput(restored, restored.nodes[0]);
    expect(input.clarifications).toEqual(board.nodes[0].clarifications);
    expect(restored.nodes[0].pendingClarification).toEqual(board.nodes[0].pendingClarification);
    expect(input.relatedCards.map((item) => item.id)).toEqual(["context"]);
    expect(JSON.stringify(input)).not.toContain("PRIVATE_UNRELATED");
    expect(input.relatedCards[0]).not.toHaveProperty("x");
  });

  it("invalidates a prior result when only the full description or linked context changes", () => {
    const board = createEmptyLabBoard();
    const node = createLabNode("a".repeat(500), 0, 0, "long");
    board.nodes = [node, createLabNode("Câmera", 1, 1, "context")];
    board.links = [createLabLink("long", "context")];
    const key = discoveryInputKey(board, node);
    node.description += " another detail";
    expect(discoveryInputKey(board, node)).not.toBe(key);
    const next = discoveryInputKey(board, node);
    board.nodes[1].text = "Outro componente";
    expect(discoveryInputKey(board, node)).not.toBe(next);
  });

  it("technical failures instruct retry or configuration correction rather than repetition", () => {
    expect(interpretationErrorMessage("GEMINI_RESPONSE_INCOMPLETE", "pt")).toContain("interrompida");
    expect(interpretationErrorMessage("GEMINI_CONFIG_INVALID", "pt")).toContain("servidor");
    expect(interpretationErrorMessage("SYSTEM_RESPONSE_INVALID", "pt")).toContain("inválida");
    expect(interpretationErrorMessage("SYSTEM_MEMORY_STALE", "pt")).toContain("Atualizar mapa dos documentos");
    expect(interpretationErrorMessage("SYSTEM_MEMORY_STALE", "en")).toContain("Your hypothesis is saved");
  });
});
