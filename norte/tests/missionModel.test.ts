import { describe, expect, it } from "vitest";
import { canCloseProblemPhase, countWords, createInitialLinks, createInitialNodes, getIssues, getProgress, getScopedIssues, getVisibleNodeIds, layoutTopDown, limitWords, orderLinksTopDown } from "../src/lib/missionModel";

describe("mission conception model", () => {
  it("limits card text to 24 words", () => {
    const text = Array.from({ length: 30 }, (_, index) => `w${index + 1}`).join(" ");
    expect(countWords(limitWords(text))).toBe(24);
  });

  it("detects the initial coverage and latency tension", () => {
    const issues = getIssues(createInitialNodes());
    expect(issues.some((issue) => issue.key === "coverage-latency")).toBe(true);
  });

  it("does not allow the Problem phase to close before mandatory evidence is defined", () => {
    expect(canCloseProblemPhase(createInitialNodes())).toBe(false);
  });

  it("computes conception progress from evidence states", () => {
    expect(getProgress(createInitialNodes())).toBeGreaterThan(0);
    expect(getProgress(createInitialNodes())).toBeLessThan(100);
  });

  it("returns descendants for focused pages", () => {
    const visible = getVisibleNodeIds(2, createInitialNodes(), createInitialLinks());
    expect(visible.has(2)).toBe(true);
    expect(visible.has(6)).toBe(true);
    expect(visible.has(4)).toBe(false);
  });

  it("shows only inconsistencies that belong to the focused map", () => {
    const nodes = createInitialNodes();
    const links = createInitialLinks();
    const visible = getVisibleNodeIds(2, nodes, links);
    expect(getScopedIssues(nodes, visible)).toHaveLength(0);
    expect(getScopedIssues(nodes, new Set(nodes.map((node) => node.id))).length).toBeGreaterThan(0);
  });

  it("organizes the main hierarchy from top to bottom", () => {
    const nodes = createInitialNodes();
    const arranged = layoutTopDown(nodes, createInitialLinks());
    const root = arranged.find((node) => node.id === 1);
    const result = arranged.find((node) => node.id === 2);
    expect(root).toBeDefined();
    expect(result).toBeDefined();
    expect((result?.y ?? 0)).toBeGreaterThan(root?.y ?? 0);
  });

  it("keeps nodes connected to the same parent on the same layout level", () => {
    const nodes = [
      ...createInitialNodes(),
      { id: 8, x: 120, y: 900, width: 240, title: "A", kickerKey: "nodes.possibilityKicker", state: "open" as const, type: "normal" as const, bucket: "main" as const },
      { id: 9, x: 520, y: 900, width: 240, title: "B", kickerKey: "nodes.possibilityKicker", state: "open" as const, type: "normal" as const, bucket: "main" as const },
      { id: 10, x: 920, y: 900, width: 240, title: "C", kickerKey: "nodes.possibilityKicker", state: "open" as const, type: "normal" as const, bucket: "main" as const }
    ];
    const arranged = layoutTopDown(nodes, [
      ...createInitialLinks(),
      { id: 201, from: 8, to: 6, type: "normal" },
      { id: 202, from: 9, to: 6, type: "normal" },
      { id: 203, from: 10, to: 6, type: "normal" }
    ]);
    const children = [8, 9, 10].map((id) => arranged.find((node) => node.id === id)?.y);

    expect(new Set(children).size).toBe(1);
  });

  it("centers a parent over its own branches", () => {
    const nodes = [
      { id: 1, x: 700, y: 100, width: 300, title: "Root", kickerKey: "root", state: "defined" as const, type: "center" as const, bucket: "main" as const },
      { id: 2, x: 300, y: 350, width: 240, title: "Context", kickerKey: "context", state: "open" as const, type: "normal" as const, bucket: "main" as const },
      { id: 3, x: 1100, y: 350, width: 240, title: "Result", kickerKey: "result", state: "open" as const, type: "normal" as const, bucket: "main" as const },
      { id: 4, x: 100, y: 600, width: 240, title: "A", kickerKey: "a", state: "open" as const, type: "normal" as const, bucket: "main" as const },
      { id: 5, x: 400, y: 600, width: 240, title: "B", kickerKey: "b", state: "open" as const, type: "normal" as const, bucket: "main" as const },
      { id: 6, x: 700, y: 600, width: 240, title: "C", kickerKey: "c", state: "open" as const, type: "normal" as const, bucket: "main" as const },
      { id: 7, x: 100, y: 850, width: 240, title: "A1", kickerKey: "a1", state: "open" as const, type: "normal" as const, bucket: "main" as const }
    ];
    const arranged = layoutTopDown(nodes, [
      { id: 101, from: 1, to: 2, type: "normal" },
      { id: 102, from: 1, to: 3, type: "normal" },
      { id: 103, from: 2, to: 4, type: "normal" },
      { id: 104, from: 2, to: 5, type: "normal" },
      { id: 105, from: 2, to: 6, type: "normal" },
      { id: 106, from: 4, to: 7, type: "normal" }
    ]);
    const center = (id: number) => {
      const node = arranged.find((item) => item.id === id);
      return (node?.x ?? 0) + (node?.width ?? 0) / 2;
    };

    expect(center(1)).toBeCloseTo((center(2) + center(3)) / 2);
    expect(center(2)).toBeCloseTo((center(4) + center(6)) / 2);
    expect(center(4)).toBeCloseTo(center(7));
    expect(Math.abs(center(3) - center(2))).toBeGreaterThanOrEqual(320);
  });

  it("keeps every parent above a shared child when a component has multiple roots", () => {
    const nodes = [
      { id: 1, x: 100, y: 100, width: 300, title: "Root A", kickerKey: "a", state: "defined" as const, type: "center" as const, bucket: "main" as const },
      { id: 2, x: 700, y: 100, width: 240, title: "Root B", kickerKey: "b", state: "open" as const, type: "normal" as const, bucket: "main" as const },
      { id: 3, x: 700, y: 400, width: 240, title: "Shared", kickerKey: "shared", state: "open" as const, type: "normal" as const, bucket: "main" as const },
      { id: 4, x: 1000, y: 400, width: 240, title: "Child", kickerKey: "child", state: "open" as const, type: "normal" as const, bucket: "main" as const }
    ];
    const arranged = layoutTopDown(nodes, [
      { id: 101, from: 1, to: 3, type: "normal" },
      { id: 102, from: 2, to: 3, type: "normal" },
      { id: 103, from: 2, to: 4, type: "normal" }
    ]);
    const y = (id: number) => arranged.find((node) => node.id === id)?.y ?? 0;

    expect(y(1)).toBe(y(2));
    expect(y(3)).toBe(y(4));
    expect(y(3)).toBeGreaterThan(y(1));
  });

  it("orders connection ports from left to right after arranging", () => {
    const nodes = [
      { id: 1, x: 500, y: 100, width: 240, title: "Parent", kickerKey: "parent", state: "open" as const, type: "center" as const, bucket: "main" as const },
      { id: 2, x: 900, y: 350, width: 240, title: "Right", kickerKey: "right", state: "open" as const, type: "normal" as const, bucket: "main" as const },
      { id: 3, x: 100, y: 350, width: 240, title: "Left", kickerKey: "left", state: "open" as const, type: "normal" as const, bucket: "main" as const },
      { id: 4, x: 500, y: 350, width: 240, title: "Middle", kickerKey: "middle", state: "open" as const, type: "normal" as const, bucket: "main" as const }
    ];
    const ordered = orderLinksTopDown(nodes, [
      { id: 101, from: 1, to: 2, type: "normal", targetSide: "right", sourceOrder: 0 },
      { id: 102, from: 1, to: 3, type: "normal", targetSide: "left", sourceOrder: 2 },
      { id: 103, from: 1, to: 4, type: "normal", targetSide: "right", sourceOrder: 1 }
    ]);
    const byId = new Map(ordered.map((link) => [link.id, link]));

    expect(byId.get(102)?.sourceOrder).toBe(0);
    expect(byId.get(103)?.sourceOrder).toBe(1);
    expect(byId.get(101)?.sourceOrder).toBe(2);
    expect(ordered.every((link) => link.sourceSide === "bottom" && link.targetSide === "top")).toBe(true);
    expect(ordered.map(({ id, from, to, type }) => ({ id, from, to, type }))).toEqual([
      { id: 101, from: 1, to: 2, type: "normal" },
      { id: 102, from: 1, to: 3, type: "normal" },
      { id: 103, from: 1, to: 4, type: "normal" }
    ]);
  });

  it("places disconnected cards side by side with extra spacing", () => {
    const nodes = [
      ...createInitialNodes(),
      { id: 8, x: 120, y: 900, width: 240, title: "A", kickerKey: "nodes.possibilityKicker", state: "open" as const, type: "normal" as const, bucket: "main" as const },
      { id: 9, x: 520, y: 900, width: 240, title: "B", kickerKey: "nodes.possibilityKicker", state: "open" as const, type: "normal" as const, bucket: "main" as const }
    ];
    const arranged = layoutTopDown(nodes, createInitialLinks());
    const first = arranged.find((node) => node.id === 8);
    const second = arranged.find((node) => node.id === 9);

    expect(first?.y).toBe(second?.y);
    expect(Math.abs((second?.x ?? 0) - (first?.x ?? 0))).toBeGreaterThan(500);
  });
});
