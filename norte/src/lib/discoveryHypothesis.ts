import type { LabBoard, LabNode } from "./brainstormLab";
import { HYPOTHESIS_MAX_LENGTH, HYPOTHESIS_TITLE_LENGTH, RELATED_CARD_LIMIT } from "../../shared/discovery-limits.mjs";

export const hypothesisText = (node: Pick<LabNode, "text" | "description">) => node.description || node.text;

export function hypothesisFields(value: string): Pick<LabNode, "text" | "description"> {
  const description = value.trim();
  if (description.length > HYPOTHESIS_MAX_LENGTH) throw new Error("Hypothesis exceeds the supported length.");
  return description.length > HYPOTHESIS_TITLE_LENGTH
    ? { text: `${description.slice(0, HYPOTHESIS_TITLE_LENGTH - 1).trimEnd()}…`, description }
    : { text: description, description: undefined };
}

/** Only explicit neighbors travel to Discovery; layout proximity is not a relationship. */
export function discoveryInput(board: LabBoard, node: LabNode) {
  const links = board.links.filter((link) => link.from === node.id || link.to === node.id);
  const ids = new Set(links.flatMap((link) => [link.from, link.to]).filter((id) => id !== node.id));
  const relatedCards = board.nodes.filter((card) => ids.has(card.id)).slice(0, RELATED_CARD_LIMIT).map((card) => ({ id: card.id, text: card.text, ...(card.description ? { description: card.description } : {}) }));
  const selected = new Set([node.id, ...relatedCards.map((card) => card.id)]);
  return { nodeId: node.id, text: hypothesisText(node), clarifications: node.clarifications || [], relatedCards, links: links.filter((link) => selected.has(link.from) && selected.has(link.to)).slice(0, RELATED_CARD_LIMIT * 2).map(({ from, to }) => ({ from, to })) };
}

export const discoveryInputKey = (board: LabBoard, node: LabNode) => JSON.stringify(discoveryInput(board, node));

export function interpretationErrorMessage(code: string, language: "pt" | "en") {
  const messages: Record<string, [string, string]> = {
    SYSTEM_MEMORY_STALE: ["Os documentos mudaram. Na memória do projeto, use Atualizar mapa dos documentos e revise a proposta. Sua hipótese está salva.", "Documents changed. In Project Memory, choose Update map from documents and review the proposal. Your hypothesis is saved."],
    GEMINI_CONFIG_INVALID: ["A configuração da IA precisa ser corrigida no servidor. Sua hipótese está salva.", "The server AI configuration needs correction. Your hypothesis is saved."],
    GEMINI_RESPONSE_INCOMPLETE: ["A resposta da IA foi interrompida. Sua hipótese está salva; tente novamente.", "The AI response was interrupted. Your hypothesis is saved; retry."],
    GEMINI_RESPONSE_BLOCKED: ["O serviço de IA não concluiu esta solicitação. Sua hipótese está salva.", "The AI service did not complete this request. Your hypothesis is saved."],
    SYSTEM_RESPONSE_INVALID: ["A IA devolveu uma resposta inválida. Sua hipótese está salva; tente novamente.", "AI returned an invalid response. Your hypothesis is saved; retry."]
  };
  return (messages[code] || ["Não foi possível interpretar agora. Sua hipótese está salva; tente novamente.", "Could not interpret now. Your hypothesis is saved; retry."])[language === "pt" ? 0 : 1];
}
