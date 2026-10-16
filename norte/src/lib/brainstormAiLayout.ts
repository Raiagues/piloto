import type { BrainstormAiAnalysis } from "./brainstormAi";
import {
  DEFAULT_LAB_SETTINGS,
  buildLabGaps,
  layoutLabTopDown,
  organizeLabIntoDomains,
  suggestionPairId
} from "./brainstormLab";
import type { LabBoard, LabInsight, LabSettings } from "./brainstormLab";
import type { Language } from "./types";

export function applyBrainstormAiOrganization(board: LabBoard, analysis: BrainstormAiAnalysis, language: Language): LabBoard {
  const planById = new Map(analysis.nodePlans.map((plan) => [plan.nodeId, plan]));
  if (board.settings.missionStructure) {
    const rewrittenBoard: LabBoard = {
      ...board,
      nodes: board.nodes.map((node) => {
        const plan = planById.get(node.id);
        const rewrittenText = board.settings.rewriteIdeas ? plan?.rewrittenText.trim().replace(/\s+/g, " ").slice(0, 220) : "";
        return { ...node, text: rewrittenText || node.text };
      })
    };
    const structured = organizeLabIntoDomains(
      rewrittenBoard,
      language,
      analysis.nodePlans.map((plan) => ({
        nodeId: plan.nodeId,
        domainId: plan.domainId,
        parentId: plan.parentId,
        level: plan.level,
        order: plan.order
      })),
      (analysis.gaps ?? []).map((gap) => ({ ...gap, source: "gemini" as const }))
    );
    return {
      ...structured,
      insights: brainstormAiInsights(analysis, language, board.settings).filter((insight) => !board.dismissedInsightIds.includes(insight.id))
    };
  }
  const plannedNodes = board.nodes.map((node) => {
    const plan = planById.get(node.id);
    const rewrittenText = board.settings.rewriteIdeas ? plan?.rewrittenText.trim().replace(/\s+/g, " ").slice(0, 220) : "";
    return {
      ...node,
      text: rewrittenText || node.text,
      ...(plan?.domainId ? { domainId: plan.domainId } : {}),
      hierarchyParentId: plan?.parentId || undefined
    };
  });
  const nodes = layoutLabTopDown({ ...board, nodes: plannedNodes });
  const gaps = buildLabGaps(
    { ...board, nodes },
    (analysis.gaps ?? []).map((gap) => ({ ...gap, source: "gemini" as const }))
  ).filter((gap) => !board.dismissedInsightIds.includes(gap.id));

  return {
    ...board,
    nodes,
    gaps,
    insights: brainstormAiInsights(analysis, language, board.settings).filter((insight) => !board.dismissedInsightIds.includes(insight.id))
  };
}

export function brainstormAiInsights(
  analysis: BrainstormAiAnalysis | null,
  language: Language,
  settings: LabSettings = DEFAULT_LAB_SETTINGS,
  updatedAt = new Date().toISOString()
): LabInsight[] {
  if (!analysis) return [];
  const insights: LabInsight[] = [];

  analysis.nodePlans.forEach((plan) => {
    if (settings.flagIncomplete && plan.informationStatus !== "enough") {
      insights.push({
        id: `needs-context:${plan.nodeId}`,
        kind: "needs-context",
        nodeIds: [plan.nodeId],
        title: language === "pt" ? "Precisa de mais contexto" : "Needs more context",
        detail: plan.informationNeeded || (language === "pt" ? "A intenção desta ideia ainda não está clara." : "The intent behind this idea is not clear yet."),
        question: language === "pt" ? "Que resultado, limite ou condição ajudaria a tornar esta ideia verificável?" : "What outcome, limit, or condition would make this idea verifiable?",
        source: "gemini",
        updatedAt
      });
    }

    if (settings.flagDuplicates && plan.duplicateOf) {
      const pair = suggestionPairId(plan.nodeId, plan.duplicateOf);
      insights.push({
        id: `duplicate:${pair}`,
        kind: "duplicate",
        nodeIds: [plan.nodeId, plan.duplicateOf],
        title: language === "pt" ? "Possível repetição" : "Possible duplicate",
        detail: language === "pt" ? "Estas ideias parecem expressar uma intenção muito parecida." : "These ideas appear to express very similar intent.",
        question: language === "pt" ? "Elas representam a mesma decisão ou há uma diferença que vale explicitar?" : "Do they represent the same decision, or is there a difference worth making explicit?",
        source: "gemini",
        updatedAt
      });
    }
  });

  if (settings.highlightTensions) analysis.tensions.forEach((tension) => {
    insights.push({
      id: tension.id,
      kind: "tension",
      nodeIds: [tension.first, tension.second],
      title: tension.title,
      detail: tension.explanation,
      question: tension.question,
      source: "gemini",
      updatedAt
    });
  });

  if (settings.highlightTensions) analysis.connectionIssues.forEach((issue) => {
    insights.push({
      id: `connection-warning:${issue.from}:${issue.to}`,
      kind: "connection-warning",
      nodeIds: [issue.from, issue.to],
      title: issue.title,
      detail: issue.explanation,
      question: issue.question,
      source: "gemini",
      updatedAt
    });
  });

  return dedupeInsights(insights);
}

function dedupeInsights(insights: LabInsight[]): LabInsight[] {
  const seen = new Set<string>();
  return insights.filter((insight) => {
    if (seen.has(insight.id)) return false;
    seen.add(insight.id);
    return true;
  }).slice(0, 80);
}
