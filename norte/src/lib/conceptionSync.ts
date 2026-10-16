import type { LabBoard } from "./brainstormLab";
import type { MissionProject } from "./projectStore";
import type { Language } from "./types";

export function syncDecisionsToMissionBoard(
  currentBoard: MissionProject["board"],
  exploration: LabBoard,
  language: Language
): MissionProject["board"] {
  const decidedNodes = exploration.nodes.filter((node) => node.maturity === "decided");
  const decidedIds = new Set(decidedNodes.map((node) => node.id));
  const currentImported = new Map(currentBoard.nodes.filter((node) => node.originLabNodeId).map((node) => [node.originLabNodeId!, node]));
  let nextNodeId = Math.max(0, ...currentBoard.nodes.map((node) => node.id)) + 1;
  const importedNodes = decidedNodes.map((decision, index) => {
    const existing = currentImported.get(decision.id);
    if (existing) return {
      ...existing,
      title: decision.text,
      titleKey: undefined,
      kickerKey: language === "pt" ? "DECISÃO DA EQUIPE" : "TEAM DECISION",
      state: "defined" as const,
      domainId: decision.domainId
    };
    const column = index % 5;
    const row = Math.floor(index / 5);
    return {
      id: nextNodeId++,
      x: 300 + column * 300,
      y: 880 + row * 230,
      width: 250,
      title: decision.text,
      kickerKey: language === "pt" ? "DECISÃO DA EQUIPE" : "TEAM DECISION",
      state: "defined" as const,
      type: "normal" as const,
      bucket: "main" as const,
      originLabNodeId: decision.id,
      domainId: decision.domainId
    };
  });

  const retainedManualNodes = currentBoard.nodes.filter((node) => !node.originLabNodeId);
  const nextNodes = [...retainedManualNodes, ...importedNodes];
  const validNodeIds = new Set(nextNodes.map((node) => node.id));
  const finalIdByLabId = new Map(importedNodes.map((node) => [node.originLabNodeId!, node.id]));
  let nextLinkId = Math.max(100, ...currentBoard.links.map((link) => link.id)) + 1;
  const currentImportedLinks = new Map(currentBoard.links.filter((link) => link.originLabLinkId).map((link) => [link.originLabLinkId!, link]));
  const importedLinks = exploration.links.flatMap((link) => {
    if (!decidedIds.has(link.from) || !decidedIds.has(link.to)) return [];
    const from = finalIdByLabId.get(link.from);
    const to = finalIdByLabId.get(link.to);
    if (from === undefined || to === undefined) return [];
    const existing = currentImportedLinks.get(link.id);
    return [{
      ...(existing ?? { id: nextLinkId++, type: "normal" as const }),
      from,
      to,
      type: "normal" as const,
      originLabLinkId: link.id
    }];
  });
  const retainedManualLinks = currentBoard.links.filter((link) => !link.originLabLinkId && validNodeIds.has(link.from) && validNodeIds.has(link.to));
  return { nodes: nextNodes, links: [...retainedManualLinks, ...importedLinks] };
}
