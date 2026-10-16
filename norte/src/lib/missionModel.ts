import { graphlib, layout } from "@dagrejs/dagre";
import type { Checkpoint, MissionIssue, MissionLink, MissionNode, NodeState } from "./types";

export const MAX_CARD_WORDS = 24;

export function countWords(text: string): number {
  const clean = text.trim();
  if (!clean) return 0;
  return clean.split(/\s+/).length;
}

export function limitWords(text: string, maxWords = MAX_CARD_WORDS): string {
  return text.trim().split(/\s+/).filter(Boolean).slice(0, maxWords).join(" ");
}

export function hasDefinedResolution(nodes: MissionNode[], issueKey: string): boolean {
  return nodes.some((node) => node.issueKey === issueKey && node.state === "defined");
}

export function getIssues(nodes: MissionNode[]): MissionIssue[] {
  const issues: MissionIssue[] = [];
  const fast = nodes.find((node) => node.kickerKey === "nodes.timeKicker" && node.state !== "closed");
  const broad = nodes.find((node) => node.kickerKey === "nodes.contextKicker" && node.state !== "closed");
  const beneficiary = nodes.find((node) => node.kickerKey === "nodes.beneficiaryKicker" && node.state !== "closed");
  const beneficiaryQuestion = nodes.find((node) => node.titleKey === "nodes.beneficiaryQuestion" && node.state !== "closed");

  if (fast && broad && !hasDefinedResolution(nodes, "coverage-latency")) {
    issues.push({
      key: "coverage-latency",
      titleKey: "issues.coverageLatencyTitle",
      descriptionKey: "issues.coverageLatencyDescription",
      nodeIds: [fast.id, broad.id],
      severity: "critical",
      suggestions: [
        { titleKey: "issues.prioritizeRegionsTitle", descriptionKey: "issues.prioritizeRegionsDescription" },
        { titleKey: "issues.splitDetectionTitle", descriptionKey: "issues.splitDetectionDescription" },
        { titleKey: "issues.largerWindowTitle", descriptionKey: "issues.largerWindowDescription" }
      ]
    });
  }

  if (!beneficiary || beneficiary.state !== "defined") {
    issues.push({
      key: "beneficiary",
      titleKey: "issues.beneficiaryTitle",
      descriptionKey: "issues.beneficiaryDescription",
      nodeIds: beneficiary ? [beneficiary.id] : beneficiaryQuestion ? [beneficiaryQuestion.id] : [1],
      severity: "gap",
      suggestions: [
        { titleKey: "issues.civilDefenseTitle", descriptionKey: "issues.civilDefenseDescription" },
        { titleKey: "issues.environmentalCentersTitle", descriptionKey: "issues.environmentalCentersDescription" },
        { titleKey: "issues.fieldBrigadesTitle", descriptionKey: "issues.fieldBrigadesDescription" }
      ]
    });
  }

  return issues;
}

export function getScopedIssues(nodes: MissionNode[], visibleNodeIds: Set<number>, resolvedIssueKeys: string[] = []): MissionIssue[] {
  return getIssues(nodes).filter((issue) => !resolvedIssueKeys.includes(issue.key) && issue.nodeIds.every((id) => visibleNodeIds.has(id)));
}

function strongestState(nodes: MissionNode[]): NodeState {
  if (nodes.some((node) => node.state === "defined")) return "defined";
  if (nodes.some((node) => node.state === "hypothesis")) return "hypothesis";
  if (nodes.some((node) => node.state === "open")) return "open";
  return "open";
}

export function getCheckpoints(nodes: MissionNode[]): Checkpoint[] {
  const evidence = {
    problem: nodes.filter((node) => node.type === "center" && node.state !== "closed"),
    result: nodes.filter((node) => node.kickerKey === "nodes.resultKicker" && node.state !== "closed"),
    context: nodes.filter((node) => node.kickerKey === "nodes.contextKicker" && node.state !== "closed"),
    beneficiary: nodes.filter((node) => node.kickerKey === "nodes.beneficiaryKicker" && node.state !== "closed"),
    time: nodes.filter((node) => node.kickerKey === "nodes.timeKicker" && node.state !== "closed"),
    constraints: nodes.filter((node) => node.kickerKey === "nodes.constraintKicker" && node.state !== "closed")
  };

  return [
    { key: "problem", nameKey: "checkpoints.problem", descriptionKey: "checkpoints.problemDescription", state: strongestState(evidence.problem), evidence: evidence.problem, mandatory: true },
    { key: "result", nameKey: "checkpoints.result", descriptionKey: "checkpoints.resultDescription", state: strongestState(evidence.result), evidence: evidence.result, mandatory: true },
    { key: "context", nameKey: "checkpoints.context", descriptionKey: "checkpoints.contextDescription", state: strongestState(evidence.context), evidence: evidence.context, mandatory: true },
    { key: "beneficiary", nameKey: "checkpoints.beneficiary", descriptionKey: "checkpoints.beneficiaryDescription", state: strongestState(evidence.beneficiary), evidence: evidence.beneficiary, mandatory: true },
    { key: "time", nameKey: "checkpoints.time", descriptionKey: "checkpoints.timeDescription", state: strongestState(evidence.time), evidence: evidence.time, mandatory: true },
    { key: "constraints", nameKey: "checkpoints.constraints", descriptionKey: "checkpoints.constraintsDescription", state: strongestState(evidence.constraints), evidence: evidence.constraints, mandatory: false }
  ];
}

export function getProgress(nodes: MissionNode[]): number {
  const checkpoints = getCheckpoints(nodes);
  let score = 0;

  for (const checkpoint of checkpoints) {
    if (checkpoint.state === "defined") score += 1;
    if (checkpoint.state === "hypothesis") score += 0.5;
  }

  return Math.round((score / checkpoints.length) * 100);
}

export function getNodeStateProgress(nodes: MissionNode[]): number {
  const active = nodes.filter((node) => node.state !== "closed");
  if (active.length === 0) return 0;
  let score = 0;
  for (const node of active) {
    if (node.state === "defined") score += 1;
    if (node.state === "hypothesis") score += 0.5;
  }
  return Math.round((score / active.length) * 100);
}

export function canCloseProblemPhase(nodes: MissionNode[], resolvedIssueKeys: string[] = []): boolean {
  const checkpoints = getCheckpoints(nodes);
  const missingMandatory = checkpoints.some((checkpoint) => checkpoint.mandatory && checkpoint.state !== "defined");
  const criticalIssue = getIssues(nodes).some((issue) => issue.severity === "critical" && !resolvedIssueKeys.includes(issue.key));
  return !missingMandatory && !criticalIssue;
}

export function getVisibleNodeIds(rootId: number | null, nodes: MissionNode[], links: MissionLink[]): Set<number> {
  if (rootId === null) return new Set(nodes.map((node) => node.id));
  const visible = new Set<number>([rootId]);
  const queue = [rootId];

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    for (const link of links) {
      if (link.from === current && !visible.has(link.to)) {
        visible.add(link.to);
        queue.push(link.to);
      }
    }
  }

  return visible;
}

type LayoutPosition = {
  id: number;
  x: number;
  y: number;
  width: number;
};

function fitOrderedCenters(positions: LayoutPosition[], desiredCenters: number[], weights: number[], gap: number): number[] {
  const offsets = positions.map((position, index) => {
    if (index === 0) return 0;
    const previous = positions[index - 1];
    return position.width / 2 + previous.width / 2 + gap;
  });

  for (let index = 1; index < offsets.length; index += 1) {
    offsets[index] += offsets[index - 1];
  }

  const blocks: Array<{ start: number; end: number; weight: number; value: number }> = [];
  desiredCenters.forEach((center, index) => {
    blocks.push({ start: index, end: index, weight: weights[index], value: center - offsets[index] });
    while (blocks.length > 1 && blocks[blocks.length - 2].value > blocks[blocks.length - 1].value) {
      const right = blocks.pop();
      const left = blocks.pop();
      if (!left || !right) break;
      const weight = left.weight + right.weight;
      blocks.push({
        start: left.start,
        end: right.end,
        weight,
        value: (left.value * left.weight + right.value * right.weight) / weight
      });
    }
  });

  const fitted = Array.from({ length: positions.length }, () => 0);
  blocks.forEach((block) => {
    for (let index = block.start; index <= block.end; index += 1) {
      fitted[index] = block.value + offsets[index];
    }
  });
  return fitted;
}

function centerParentsOverChildren(positions: LayoutPosition[], links: MissionLink[], nodeGap: number): LayoutPosition[] {
  const adjusted = positions.map((position) => ({ ...position }));
  const positionById = new Map(adjusted.map((position) => [position.id, position]));
  const childrenByParent = new Map<number, number[]>();

  links.forEach((link) => {
    const parent = positionById.get(link.from);
    const child = positionById.get(link.to);
    if (!parent || !child || child.y <= parent.y) return;
    childrenByParent.set(parent.id, [...(childrenByParent.get(parent.id) ?? []), child.id]);
  });

  const ranks = new Map<number, LayoutPosition[]>();
  adjusted.forEach((position) => {
    const rankKey = Math.round(position.y * 1000);
    ranks.set(rankKey, [...(ranks.get(rankKey) ?? []), position]);
  });

  Array.from(ranks.entries())
    .sort(([rankA], [rankB]) => rankB - rankA)
    .forEach(([, rankPositions]) => {
      const ordered = [...rankPositions].sort((a, b) => a.x + a.width / 2 - (b.x + b.width / 2));
      const desiredCenters = ordered.map((position) => {
        const childCenters = (childrenByParent.get(position.id) ?? [])
          .map((childId) => positionById.get(childId))
          .filter((child): child is LayoutPosition => child !== undefined)
          .map((child) => child.x + child.width / 2);
        if (childCenters.length === 0) return position.x + position.width / 2;
        return (Math.min(...childCenters) + Math.max(...childCenters)) / 2;
      });
      const weights = ordered.map((position) => 1 + (childrenByParent.get(position.id)?.length ?? 0) * 4);
      const fittedCenters = fitOrderedCenters(ordered, desiredCenters, weights, nodeGap);

      ordered.forEach((position, index) => {
        position.x = fittedCenters[index] - position.width / 2;
      });
    });

  return adjusted;
}

export function layoutTopDown(nodes: MissionNode[], links: MissionLink[], rootId: number | null = null, visibleNodeIds?: Set<number>): MissionNode[] {
  const visible = visibleNodeIds ?? new Set(nodes.map((node) => node.id));
  const visibleNodes = nodes.filter((node) => visible.has(node.id));
  if (visibleNodes.length === 0) return nodes;
  const root = rootId !== null ? nodes.find((node) => node.id === rootId) : nodes.find((node) => node.type === "center" && visible.has(node.id));
  const visibleIds = new Set(visibleNodes.map((node) => node.id));
  const next = nodes.map((node) => ({ ...node }));
  const centerX = 1200;
  const topY = 120;
  const componentGap = 360;
  const componentGraph = new graphlib.Graph({ directed: true });
  visibleNodes.forEach((node) => componentGraph.setNode(String(node.id)));
  links.forEach((link) => {
    if (visibleIds.has(link.from) && visibleIds.has(link.to)) componentGraph.setEdge(String(link.from), String(link.to));
  });

  const nodeById = new Map(visibleNodes.map((node) => [node.id, node]));
  const components = graphlib.alg.components(componentGraph)
    .map((ids) => ids.map(Number))
    .sort((a, b) => {
      if (root && a.includes(root.id)) return -1;
      if (root && b.includes(root.id)) return 1;
      const minXA = Math.min(...a.map((id) => nodeById.get(id)?.x ?? 0));
      const minXB = Math.min(...b.map((id) => nodeById.get(id)?.x ?? 0));
      return minXA - minXB;
    });

  const arrangedComponents = components.map((component) => {
    const componentIds = new Set(component);
    const graph = new graphlib.Graph({ directed: true, multigraph: true })
      .setGraph({
        rankdir: "TB",
        ranker: "network-simplex",
        acyclicer: "greedy",
        rankalign: "center",
        nodesep: 84,
        edgesep: 36,
        ranksep: 118,
        marginx: 0,
        marginy: 0
      })
      .setDefaultEdgeLabel(() => ({}));

    component
      .map((id) => nodeById.get(id))
      .filter((node): node is MissionNode => node !== undefined)
      .sort((a, b) => a.x - b.x || a.y - b.y)
      .forEach((node) => graph.setNode(String(node.id), { width: node.width, height: 158 }));
    links
      .filter((link) => componentIds.has(link.from) && componentIds.has(link.to))
      .sort((a, b) => a.id - b.id)
      .forEach((link) => graph.setEdge(String(link.from), String(link.to), { minlen: 1, weight: 3 }, String(link.id)));

    layout(graph);

    const dagrePositions = component.map((id) => {
      const node = nodeById.get(id);
      const position = graph.node(String(id));
      return {
        id,
        x: position.x - (node?.width ?? 240) / 2,
        y: position.y - 158 / 2,
        width: node?.width ?? 240
      };
    });
    const positions = centerParentsOverChildren(
      dagrePositions,
      links.filter((link) => componentIds.has(link.from) && componentIds.has(link.to)),
      84
    );
    const minX = Math.min(...positions.map((position) => position.x));
    const maxX = Math.max(...positions.map((position) => position.x + position.width));
    const minY = Math.min(...positions.map((position) => position.y));

    return { positions, minX, minY, width: Math.max(240, maxX - minX) };
  });
  const totalWidth = arrangedComponents.reduce((sum, component) => sum + component.width, 0) + Math.max(0, arrangedComponents.length - 1) * componentGap;
  let componentLeft = centerX - totalWidth / 2;

  arrangedComponents.forEach((component) => {
    component.positions.forEach((position) => {
      const target = next.find((node) => node.id === position.id);
      if (!target) return;
      target.x = componentLeft + position.x - component.minX;
      target.y = topY + position.y - component.minY;
    });
    componentLeft += component.width + componentGap;
  });

  return next;
}

export function orderLinksTopDown(nodes: MissionNode[], links: MissionLink[]): MissionLink[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const sourceGroups = new Map<number, MissionLink[]>();
  const targetGroups = new Map<number, MissionLink[]>();

  links.forEach((link) => {
    sourceGroups.set(link.from, [...(sourceGroups.get(link.from) ?? []), link]);
    targetGroups.set(link.to, [...(targetGroups.get(link.to) ?? []), link]);
  });

  const sourceOrder = new Map<number, number>();
  sourceGroups.forEach((group) => {
    group
      .sort((a, b) => {
        const targetA = nodeById.get(a.to);
        const targetB = nodeById.get(b.to);
        const centerA = (targetA?.x ?? 0) + (targetA?.width ?? 240) / 2;
        const centerB = (targetB?.x ?? 0) + (targetB?.width ?? 240) / 2;
        return centerA - centerB || a.id - b.id;
      })
      .forEach((link, index) => sourceOrder.set(link.id, index));
  });

  const targetOrder = new Map<number, number>();
  targetGroups.forEach((group) => {
    group
      .sort((a, b) => {
        const sourceA = nodeById.get(a.from);
        const sourceB = nodeById.get(b.from);
        const centerA = (sourceA?.x ?? 0) + (sourceA?.width ?? 240) / 2;
        const centerB = (sourceB?.x ?? 0) + (sourceB?.width ?? 240) / 2;
        return centerA - centerB || a.id - b.id;
      })
      .forEach((link, index) => targetOrder.set(link.id, index));
  });

  return links.map((link) => ({
    ...link,
    sourceSide: "bottom",
    targetSide: "top",
    sourceOrder: sourceOrder.get(link.id) ?? 0,
    targetOrder: targetOrder.get(link.id) ?? 0
  }));
}

export function createInitialNodes(): MissionNode[] {
  return [
    { id: 1, x: 720, y: 310, width: 300, titleKey: "nodes.startTitle", kickerKey: "nodes.startKicker", state: "defined", type: "center", bucket: "main" },
    { id: 2, x: 300, y: 170, width: 240, titleKey: "nodes.detectTitle", kickerKey: "nodes.resultKicker", state: "defined", type: "normal", bucket: "main" },
    { id: 3, x: 300, y: 520, width: 240, titleKey: "nodes.coverageTitle", kickerKey: "nodes.contextKicker", state: "hypothesis", type: "normal", bucket: "main" },
    { id: 4, x: 1170, y: 165, width: 240, titleKey: "nodes.responseTitle", kickerKey: "nodes.timeKicker", state: "hypothesis", type: "normal", bucket: "main" },
    { id: 5, x: 1170, y: 500, width: 240, titleKey: "nodes.beneficiaryQuestion", kickerKey: "nodes.questionKicker", state: "open", type: "question", bucket: "questions" },
    { id: 6, x: 700, y: 660, width: 240, titleKey: "nodes.thermalTitle", kickerKey: "nodes.freeIdeaKicker", state: "open", type: "normal", bucket: "ideas" },
    { id: 7, x: 1500, y: 320, width: 240, titleKey: "nodes.lowCostTitle", kickerKey: "nodes.constraintKicker", state: "hypothesis", type: "normal", bucket: "main" }
  ];
}

export function createInitialLinks(): MissionLink[] {
  return [
    { id: 101, from: 1, to: 2, type: "normal" },
    { id: 102, from: 1, to: 3, type: "normal" },
    { id: 103, from: 1, to: 4, type: "normal" },
    { id: 104, from: 1, to: 5, type: "normal" },
    { id: 105, from: 2, to: 6, type: "normal" },
    { id: 106, from: 1, to: 7, type: "normal" }
  ];
}
