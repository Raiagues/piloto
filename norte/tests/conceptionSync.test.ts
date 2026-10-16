import { describe, expect, it } from "vitest";
import { createEmptyLabBoard, createLabLink, createLabNode } from "../src/lib/brainstormLab";
import { syncDecisionsToMissionBoard } from "../src/lib/conceptionSync";
import type { MissionProject } from "../src/lib/projectStore";

describe("exploration decision synchronization", () => {
  it("promotes only team decisions and preserves confirmed direction", () => {
    const exploration = createEmptyLabBoard();
    exploration.nodes = [
      { ...createLabNode("Detectar queimadas", 100, 100, "mission"), maturity: "decided" },
      { ...createLabNode("Usar câmera térmica", 400, 300, "camera"), maturity: "decided" },
      createLabNode("Talvez usar radar", 700, 300, "radar")
    ];
    exploration.links = [
      createLabLink("mission", "camera", "confirmed"),
      createLabLink("mission", "radar", "hypothesis-link")
    ];
    const existing: MissionProject["board"] = {
      nodes: [{ id: 1, x: 50, y: 50, width: 250, title: "Contexto", kickerKey: "nodes.contextKicker", state: "open" }],
      links: []
    };

    const result = syncDecisionsToMissionBoard(existing, exploration, "pt");
    const promoted = result.nodes.filter((node) => node.originLabNodeId);
    expect(promoted.map((node) => node.title)).toEqual(["Detectar queimadas", "Usar câmera térmica"]);
    expect(result.nodes.some((node) => node.title === "Talvez usar radar")).toBe(false);
    expect(result.links).toHaveLength(1);
    expect(result.links[0]).toMatchObject({
      from: promoted[0].id,
      to: promoted[1].id,
      originLabLinkId: "confirmed"
    });
  });

  it("removes a promoted card again when the team undoes the decision", () => {
    const exploration = createEmptyLabBoard();
    exploration.nodes = [{ ...createLabNode("Decisão", 100, 100, "decision"), maturity: "decided" }];
    const promoted = syncDecisionsToMissionBoard({ nodes: [], links: [] }, exploration, "pt");
    exploration.nodes[0].maturity = "forming";

    const reverted = syncDecisionsToMissionBoard(promoted, exploration, "pt");
    expect(reverted.nodes).toHaveLength(0);
    expect(reverted.links).toHaveLength(0);
  });
});
