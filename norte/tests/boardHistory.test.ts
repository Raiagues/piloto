import { describe, expect, it } from "vitest";
import { createBoardHistory, recordBoardSnapshot, redoBoardChange, undoBoardChange } from "../src/lib/boardHistory";
import type { BoardSnapshot } from "../src/lib/boardHistory";

function board(): BoardSnapshot {
  return {
    nodes: [
      { id: 1, x: 100, y: 100, width: 240, title: "Parent", kickerKey: "nodes.startKicker", state: "defined" },
      { id: 2, x: 100, y: 360, width: 240, title: "Child", kickerKey: "nodes.possibilityKicker", state: "open" }
    ],
    links: [{ id: 101, from: 1, to: 2, type: "normal", sourceOrder: 0, targetOrder: 0 }]
  };
}

describe("board history", () => {
  it("undoes and redoes a complete board change", () => {
    const initial = board();
    const moved = { ...initial, nodes: initial.nodes.map((node) => node.id === 2 ? { ...node, x: 420 } : node) };
    const history = recordBoardSnapshot(createBoardHistory(), initial);

    const undone = undoBoardChange(history, moved);
    expect(undone?.board.nodes.find((node) => node.id === 2)?.x).toBe(100);

    const redone = undone ? redoBoardChange(undone.history, undone.board) : null;
    expect(redone?.board.nodes.find((node) => node.id === 2)?.x).toBe(420);
  });

  it("restores a deleted card together with its connections", () => {
    const initial = board();
    const deleted = { nodes: initial.nodes.slice(0, 1), links: [] };
    const history = recordBoardSnapshot(createBoardHistory(), initial);
    const undone = undoBoardChange(history, deleted);

    expect(undone?.board.nodes).toHaveLength(2);
    expect(undone?.board.links).toEqual(initial.links);
  });
});
