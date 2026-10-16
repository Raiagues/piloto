import { graphlib, layout } from "@dagrejs/dagre";
import type { Language } from "./types";
import { hypothesisFields } from "./discoveryHypothesis";
import type { EngineeringChange } from "./engineeringSystem";
import { changeSchema, matchesSchema } from "../../shared/engineering-schema.mjs";
import { CLARIFICATION_MAX_TURNS } from "../../shared/discovery-limits.mjs";

export type LabMaturity = "draft" | "forming" | "decided";
export type LabSuggestionKind = "related" | "question" | "alternative" | "tension";
export type LabActionKind =
  | "created"
  | "edited"
  | "moved"
  | "deleted"
  | "maturity-changed"
  | "connection-created"
  | "connection-deleted"
  | "suggestion-accepted"
  | "suggestion-rejected"
  | "ai-organized"
  | "undo"
  | "redo";
export type LabInsightKind = "needs-context" | "duplicate" | "tension" | "connection-warning";
export type LabDomainId =
  | "mission"
  | "payload"
  | "environment"
  | "electronics"
  | "communications"
  | "software"
  | "structure"
  | "operations"
  | "unassigned";

export type LabNode = {
  id: string;
  text: string;
  description?: string;
  clarifications?: Array<{ question: string; answer: string }>;
  pendingClarification?: { question: string; summary?: string };
  /** A structured change already confirmed for this card. Discovery evaluates
   * it directly instead of interpreting the text again; editing the text drops it. */
  interpretedChange?: EngineeringChange;
  x: number;
  y: number;
  pinned: boolean;
  maturity: LabMaturity;
  createdAt: string;
  domainId?: LabDomainId;
  hierarchyParentId?: string;
};

export type LabLink = {
  id: string;
  from: string;
  to: string;
  createdAt: string;
};

export type LabSettings = {
  autoOrganize: boolean;
  semanticProximity: boolean;
  separateAlternatives: boolean;
  placeQuestions: boolean;
  highlightTensions: boolean;
  provisionalGroups: boolean;
  suggestRelations: boolean;
  stabilizeMature: boolean;
  rewriteIdeas: boolean;
  flagIncomplete: boolean;
  flagDuplicates: boolean;
  missionStructure: boolean;
  semanticZoom: boolean;
};

export type LabTeamAction = {
  id: string;
  kind: LabActionKind;
  at: string;
  nodeIds: string[];
  source: "team" | "ai";
  summary: string;
};

export type LabInsight = {
  id: string;
  kind: LabInsightKind;
  nodeIds: string[];
  title: string;
  detail: string;
  question: string;
  source: "gemini";
  updatedAt: string;
};

export type LabGap = {
  id: string;
  domainId: LabDomainId;
  afterNodeId: string;
  beforeNodeId: string;
  prompt: string;
  source: "local" | "gemini";
};

export type LabBoard = {
  schemaVersion: 1;
  nodes: LabNode[];
  links: LabLink[];
  dismissedSuggestionIds: string[];
  dismissedInsightIds: string[];
  teamMemory: LabTeamAction[];
  insights: LabInsight[];
  gaps: LabGap[];
  settings: LabSettings;
};

export type LabSuggestion = {
  id: string;
  from: string;
  to: string;
  kind: LabSuggestionKind;
  confidence: number;
  reason: "shared-context" | "question-context" | "competing-paths" | "possible-tension" | "manual-proximity";
  explanation?: string;
  source?: "local" | "gemini";
};

export type LabGroup = {
  id: string;
  label: string;
  nodeIds: string[];
  source?: "local" | "gemini";
};

export type LabDomain = {
  id: LabDomainId;
  label: string;
  nodeIds: string[];
  x: number;
  y: number;
  width: number;
  height: number;
};

export type LabNodeOrganization = {
  nodeId: string;
  domainId?: LabDomainId;
  parentId?: string;
  level?: number;
  order?: number;
};

export type LabGapPlan = {
  domainId: LabDomainId;
  afterNodeId?: string;
  beforeNodeId?: string;
  prompt: string;
  source?: "local" | "gemini";
};

export const LAB_NODE_WIDTH = 240;
export const LAB_NODE_HEIGHT = 158;
export const LAB_WORLD_WIDTH = 3200;
export const LAB_WORLD_HEIGHT = 2300;

const LAB_DOMAIN_WIDTH = 900;
const LAB_DOMAIN_MIN_HEIGHT = 450;
const LAB_DOMAIN_X_GAP = 74;
const LAB_DOMAIN_Y_GAP = 82;
const LAB_DOMAIN_LEFT = 82;
const LAB_DOMAIN_TOP = 82;
const LAB_DOMAIN_COLUMNS = 3;

const DOMAIN_ORDER: LabDomainId[] = [
  "mission",
  "payload",
  "environment",
  "electronics",
  "communications",
  "software",
  "structure",
  "operations",
  "unassigned"
];

const DOMAIN_LABELS: Record<LabDomainId, Record<Language, string>> = {
  mission: { pt: "Missão e problema", en: "Mission and problem" },
  payload: { pt: "Carga útil e dados", en: "Payload and data" },
  environment: { pt: "Ambiente e órbita", en: "Environment and orbit" },
  electronics: { pt: "Eletrônica e energia", en: "Electronics and power" },
  communications: { pt: "Comunicação", en: "Communications" },
  software: { pt: "Software", en: "Software" },
  structure: { pt: "Estrutura e térmica", en: "Structure and thermal" },
  operations: { pt: "Operação e validação", en: "Operations and validation" },
  unassigned: { pt: "A explorar", en: "To explore" }
};

const STORAGE_PREFIX = "norte-brainstorm-lab-v1";
const LEGACY_STORAGE_PREFIX = "mission-dev-brainstorm-lab-v1";
const STOP_WORDS = new Set([
  "a", "ao", "aos", "as", "com", "como", "da", "das", "de", "do", "dos", "e", "em", "essa", "esse", "esta", "este", "isso", "mais", "menos", "na", "nas", "no", "nos", "o", "os", "ou", "para", "por", "que", "se", "sem", "ser", "ter", "um", "uma", "usar",
  "a", "an", "and", "at", "be", "by", "for", "from", "how", "in", "is", "it", "of", "on", "or", "that", "the", "this", "to", "use", "what", "when", "where", "with"
]);

const CONCEPTS: Array<{ id: string; pt: string; en: string; terms: string[] }> = [
  { id: "wildfire", pt: "Queimadas", en: "Wildfires", terms: ["queimad", "incendi", "fogo", "wildfire", "fire"] },
  { id: "observation", pt: "Detecção", en: "Detection", terms: ["detect", "identific", "monitor", "observ", "imagem", "camera", "sensor", "image"] },
  { id: "night", pt: "Operação noturna", en: "Night operation", terms: ["noite", "noturn", "escuro", "termic", "infraverm", "night", "thermal", "infrared"] },
  { id: "alerts", pt: "Alertas", en: "Alerts", terms: ["alert", "avis", "notific", "warning"] },
  { id: "latency", pt: "Tempo de resposta", en: "Response time", terms: ["minut", "hora", "rapid", "tempo", "prazo", "latencia", "delay", "latency", "minute", "hour"] },
  { id: "satellite", pt: "Arquitetura orbital", en: "Orbital architecture", terms: ["satelit", "sentinel", "orbit", "orbital", "lancar", "launch"] },
  { id: "thermal", pt: "Sensoriamento térmico", en: "Thermal sensing", terms: ["termic", "infraverm", "camera", "thermal", "infrared"] },
  { id: "operations", pt: "Operação", en: "Operations", terms: ["funcion", "oper", "cobertura", "frequencia", "operation", "coverage", "frequency"] }
];

const ALTERNATIVE_TERMS = ["alternativ", "em vez", "opcao", "substituir", "versus", "proprio", "sentinel", "instead", "option", "own satellite"];
const NEGATION_TERMS = ["nao", "sem", "impossivel", "evitar", "descartar", "not ", "without", "impossible", "avoid", "discard"];
const QUESTION_STARTS = ["como ", "qual ", "quais ", "quem ", "onde ", "quando ", "por que ", "porque ", "o que ", "how ", "what ", "who ", "where ", "when ", "why "];

export const DEFAULT_LAB_SETTINGS: LabSettings = {
  autoOrganize: true,
  semanticProximity: true,
  separateAlternatives: true,
  placeQuestions: true,
  highlightTensions: true,
  provisionalGroups: true,
  suggestRelations: true,
  stabilizeMature: true,
  rewriteIdeas: true,
  flagIncomplete: true,
  flagDuplicates: true,
  missionStructure: false,
  semanticZoom: true
};

export function createEmptyLabBoard(): LabBoard {
  return {
    schemaVersion: 1,
    nodes: [],
    links: [],
    dismissedSuggestionIds: [],
    dismissedInsightIds: [],
    teamMemory: [],
    insights: [],
    gaps: [],
    settings: { ...DEFAULT_LAB_SETTINGS }
  };
}

export function labStorageKey(projectId: string): string {
  return `${STORAGE_PREFIX}:${projectId}`;
}

export function loadLabBoard(projectId: string, storage?: Pick<Storage, "getItem">): LabBoard {
  const source = storage ?? (typeof window === "undefined" ? undefined : window.localStorage);
  if (!source) return createEmptyLabBoard();
  const raw = source.getItem(labStorageKey(projectId)) ?? source.getItem(`${LEGACY_STORAGE_PREFIX}:${projectId}`);
  if (!raw) return createEmptyLabBoard();

  try {
    const parsed = JSON.parse(raw) as Partial<LabBoard>;
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.links)) return createEmptyLabBoard();
    return normalizeLabBoard(parsed);
  } catch {
    return createEmptyLabBoard();
  }
}

export function normalizeLabBoard(parsed: Partial<LabBoard>): LabBoard {
  if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.links)) return createEmptyLabBoard();
  return {
      schemaVersion: 1,
      nodes: parsed.nodes.filter(isLabNode).map(normalizeLabNode),
      links: parsed.links.filter(isLabLink),
      dismissedSuggestionIds: Array.isArray(parsed.dismissedSuggestionIds) ? parsed.dismissedSuggestionIds.filter((id): id is string => typeof id === "string") : [],
      dismissedInsightIds: Array.isArray(parsed.dismissedInsightIds) ? parsed.dismissedInsightIds.filter((id): id is string => typeof id === "string") : [],
      teamMemory: Array.isArray(parsed.teamMemory) ? parsed.teamMemory.filter(isLabTeamAction).slice(-80) : [],
      insights: Array.isArray(parsed.insights) ? parsed.insights.filter(isLabInsight).slice(-80) : [],
      gaps: Array.isArray(parsed.gaps) ? parsed.gaps.filter(isLabGap).slice(-40) : [],
      settings: { ...DEFAULT_LAB_SETTINGS, ...parsed.settings }
  };
}

export function saveLabBoard(projectId: string, board: LabBoard, storage?: Pick<Storage, "setItem">): void {
  const destination = storage ?? (typeof window === "undefined" ? undefined : window.localStorage);
  destination?.setItem(labStorageKey(projectId), JSON.stringify(board));
}

export function createLabNode(text: string, x: number, y: number, id = makeId("idea"), createdAt = new Date().toISOString()): LabNode {
  return { id, ...hypothesisFields(text), x, y, pinned: false, maturity: "draft", createdAt };
}

export function createLabLink(from: string, to: string, id = makeId("relation"), createdAt = new Date().toISOString()): LabLink {
  return { id, from, to, createdAt };
}

export function createLabAction(
  kind: LabActionKind,
  summary: string,
  nodeIds: string[] = [],
  source: LabTeamAction["source"] = "team",
  id = makeId("action"),
  at = new Date().toISOString()
): LabTeamAction {
  return { id, kind, at, nodeIds: [...new Set(nodeIds)].slice(0, 12), source, summary: summary.trim().slice(0, 360) };
}

export function appendLabAction(board: LabBoard, action: LabTeamAction): LabBoard {
  return { ...board, teamMemory: [...board.teamMemory, action].slice(-80) };
}

export function suggestionPairId(firstId: string, secondId: string): string {
  return [firstId, secondId].sort().join("::");
}

export function deriveLabSuggestions(board: LabBoard): LabSuggestion[] {
  if (!board.settings.autoOrganize || !board.settings.suggestRelations) return [];
  const confirmed = new Set(board.links.map((link) => suggestionPairId(link.from, link.to)));
  const dismissed = new Set(board.dismissedSuggestionIds);
  const suggestions: LabSuggestion[] = [];

  for (let index = 0; index < board.nodes.length; index += 1) {
    for (let comparison = index + 1; comparison < board.nodes.length; comparison += 1) {
      const first = board.nodes[index];
      const second = board.nodes[comparison];
      const id = suggestionPairId(first.id, second.id);
      if (confirmed.has(id) || dismissed.has(id)) continue;
      const relation = scoreRelation(first, second, board.settings);
      if (!relation || relation.confidence < 0.34) continue;
      const [from, to] = first.createdAt <= second.createdAt ? [first.id, second.id] : [second.id, first.id];
      suggestions.push({ id, from, to, ...relation });
    }
  }

  return suggestions
    .sort((a, b) => b.confidence - a.confidence || a.id.localeCompare(b.id))
    .slice(0, 12);
}

export function deriveLabGroups(board: LabBoard, language: Language): LabGroup[] {
  if (!board.settings.autoOrganize || !board.settings.provisionalGroups) return [];
  const groups = CONCEPTS
    .map((concept) => ({
      id: concept.id,
      label: language === "pt" ? concept.pt : concept.en,
      nodeIds: board.nodes.filter((node) => conceptsFor(node.text).has(concept.id)).map((node) => node.id)
    }))
    .filter((group) => group.nodeIds.length >= 2)
    .sort((a, b) => b.nodeIds.length - a.nodeIds.length);

  const unique: LabGroup[] = [];
  for (const group of groups) {
    const signature = [...group.nodeIds].sort().join("|");
    if (!unique.some((item) => [...item.nodeIds].sort().join("|") === signature)) unique.push(group);
    if (unique.length === 4) break;
  }
  return unique;
}

export function isLabDomainId(value: unknown): value is LabDomainId {
  return typeof value === "string" && DOMAIN_ORDER.includes(value as LabDomainId);
}

export function classifyLabDomain(text: string): LabDomainId {
  const value = normalize(text);
  const match = (terms: string[]) => includesAny(value, terms);

  if (match(["problema", "missao", "objetiv", "impact", "benefici", "quem precisa", "usuario", "stakeholder", "queimad", "agricultur", "florest", "demonstr", "purpose", "mission", "goal", "who needs", "user", "wildfire", "farm"])) return "mission";
  if (match(["payload", "carga util", "camera", "sensor", "imagem", "dado", "medir", "colet", "detect", "image", "measurement", "data collection"])) return "payload";
  if (match(["orbita", "orbital", "altitude", "trajet", "balão", "balao", "estratosfer", "ambiente", "noite", "cobertura", "orbit", "altitude", "trajectory", "balloon", "environment", "night", "coverage"])) return "environment";
  if (match(["energia", "bateria", "potencia", "eletr", "placa", "pcb", "tensao", "corrente", "power", "battery", "electronic", "voltage", "current"])) return "electronics";
  if (match(["telemet", "comunica", "wifi", "radio", "antena", "http", "alert", "transmit", "communication", "antenna", "downlink", "uplink"])) return "communications";
  if (match(["software", "codigo", "firmware", "algorit", "modelo", "inteligencia artificial", "process", "program", "code", "machine learning"])) return "software";
  if (match(["estrutura", "mecan", "massa", "peso", "material", "termic", "isolamento", "vibr", "structure", "mechanical", "mass", "weight", "thermal", "insulation"])) return "structure";
  if (match(["operacao", "teste", "valid", "lanc", "recuper", "cronograma", "risco", "integr", "operation", "test", "launch", "recovery", "schedule", "risk", "integration"])) return "operations";
  return "unassigned";
}

export function deriveMissionDomains(board: LabBoard, language: Language): LabDomain[] {
  const nodesByDomain = new Map<LabDomainId, LabNode[]>();
  board.nodes.forEach((node) => {
    const domainId = isLabDomainId(node.domainId) ? node.domainId : classifyLabDomain(node.text);
    nodesByDomain.set(domainId, [...(nodesByDomain.get(domainId) ?? []), node]);
  });

  const drafts = DOMAIN_ORDER
    .filter((domainId) => (nodesByDomain.get(domainId)?.length ?? 0) > 0)
    .map((domainId) => {
      const domainNodes = nodesByDomain.get(domainId) ?? [];
      const levels = domainHierarchyLevels(board, domainNodes);
      const rows = [...new Set(domainNodes.map((node) => levels.get(node.id) ?? 0))]
        .reduce((total, level) => total + Math.max(1, Math.ceil(domainNodes.filter((node) => (levels.get(node.id) ?? 0) === level).length / 3)), 0);
      return {
        id: domainId,
        label: DOMAIN_LABELS[domainId][language],
        nodeIds: domainNodes.map((node) => node.id),
        height: Math.max(LAB_DOMAIN_MIN_HEIGHT, 112 + rows * (LAB_NODE_HEIGHT + 54) + 124)
      };
    });

  const rowHeights = new Map<number, number>();
  drafts.forEach((domain, index) => {
    const row = Math.floor(index / LAB_DOMAIN_COLUMNS);
    rowHeights.set(row, Math.max(rowHeights.get(row) ?? 0, domain.height));
  });
  const rowTop = new Map<number, number>();
  let cursorY = LAB_DOMAIN_TOP;
  [...rowHeights.entries()].sort(([first], [second]) => first - second).forEach(([row, height]) => {
    rowTop.set(row, cursorY);
    cursorY += height + LAB_DOMAIN_Y_GAP;
  });

  return drafts.map((domain, index) => ({
    ...domain,
    x: LAB_DOMAIN_LEFT + (index % LAB_DOMAIN_COLUMNS) * (LAB_DOMAIN_WIDTH + LAB_DOMAIN_X_GAP),
    y: rowTop.get(Math.floor(index / LAB_DOMAIN_COLUMNS)) ?? LAB_DOMAIN_TOP,
    width: LAB_DOMAIN_WIDTH
  }));
}

export function organizeLabIntoDomains(
  board: LabBoard,
  language: Language,
  organizations: LabNodeOrganization[] = [],
  gapPlans: LabGapPlan[] = []
): LabBoard {
  const organizationById = new Map(organizations.map((plan) => [plan.nodeId, plan]));
  const withAssignments: LabBoard = {
    ...board,
    nodes: board.nodes.map((node) => {
      const plan = organizationById.get(node.id);
      const domainId = isLabDomainId(plan?.domainId)
        ? plan.domainId
        : isLabDomainId(node.domainId) ? node.domainId : classifyLabDomain(node.text);
      const hierarchyParentId = plan?.parentId && board.nodes.some((candidate) => candidate.id === plan.parentId)
        ? plan.parentId
        : node.hierarchyParentId;
      return { ...node, domainId, hierarchyParentId };
    })
  };
  const domains = deriveMissionDomains(withAssignments, language);
  const nodesById = new Map(withAssignments.nodes.map((node) => [node.id, node]));
  const nextNodes = withAssignments.nodes.map((node) => ({ ...node }));
  const nextNodeById = new Map(nextNodes.map((node) => [node.id, node]));

  domains.forEach((domain) => {
    const domainNodes = domain.nodeIds.map((id) => nodesById.get(id)).filter((node): node is LabNode => Boolean(node));
    const levels = domainHierarchyLevels(withAssignments, domainNodes, organizationById);
    const levelRows = new Map<number, LabNode[]>();
    domainNodes.forEach((node) => {
      const level = levels.get(node.id) ?? 0;
      levelRows.set(level, [...(levelRows.get(level) ?? []), node]);
    });

    let localRow = 0;
    [...levelRows.entries()].sort(([first], [second]) => first - second).forEach(([, rowNodes]) => {
      rowNodes.sort((first, second) => {
        const firstPlan = organizationById.get(first.id);
        const secondPlan = organizationById.get(second.id);
        return (firstPlan?.order ?? Number.MAX_SAFE_INTEGER) - (secondPlan?.order ?? Number.MAX_SAFE_INTEGER)
          || first.x - second.x
          || first.createdAt.localeCompare(second.createdAt);
      });
      for (let start = 0; start < rowNodes.length; start += 3) {
        const chunk = rowNodes.slice(start, start + 3);
        const gap = 44;
        const rowWidth = chunk.length * LAB_NODE_WIDTH + Math.max(0, chunk.length - 1) * gap;
        const startX = domain.x + (domain.width - rowWidth) / 2;
        chunk.forEach((node, column) => {
          const target = nextNodeById.get(node.id);
          if (!target) return;
          const targetCenter = { x: target.x + LAB_NODE_WIDTH / 2, y: target.y + LAB_NODE_HEIGHT / 2 };
          if (target.pinned && pointInsideBounds(targetCenter, domain)) return;
          target.x = startX + column * (LAB_NODE_WIDTH + gap);
          target.y = domain.y + 90 + localRow * (LAB_NODE_HEIGHT + 54);
        });
        localRow += 1;
      }
    });

    const childrenByParent = new Map<string, string[]>();
    domainNodes.forEach((node) => {
      const parentId = organizationById.get(node.id)?.parentId || node.hierarchyParentId || confirmedParentFor(withAssignments, node.id, domain.nodeIds);
      if (parentId && domain.nodeIds.includes(parentId)) childrenByParent.set(parentId, [...(childrenByParent.get(parentId) ?? []), node.id]);
    });
    childrenByParent.forEach((childIds, parentId) => {
      const parent = nextNodeById.get(parentId);
      const children = childIds.map((id) => nextNodeById.get(id)).filter((node): node is LabNode => Boolean(node));
      if (!parent || parent.pinned || children.length === 0) return;
      const centerX = children.reduce((sum, child) => sum + child.x + LAB_NODE_WIDTH / 2, 0) / children.length;
      parent.x = clamp(centerX - LAB_NODE_WIDTH / 2, domain.x + 34, domain.x + domain.width - LAB_NODE_WIDTH - 34);
    });
  });

  const gaps = buildLabGaps({ ...withAssignments, nodes: nextNodes }, gapPlans)
    .filter((gap) => !board.dismissedInsightIds.includes(gap.id));
  return { ...withAssignments, nodes: nextNodes, gaps };
}

export function labGapPoint(gap: LabGap, board: LabBoard, domains: LabDomain[]): { x: number; y: number } {
  const first = board.nodes.find((node) => node.id === gap.afterNodeId);
  const second = board.nodes.find((node) => node.id === gap.beforeNodeId);
  if (first && second) return {
    x: (first.x + second.x) / 2 + LAB_NODE_WIDTH / 2,
    y: (first.y + second.y) / 2 + LAB_NODE_HEIGHT + 26
  };
  if (first || second) {
    const node = first ?? second!;
    return { x: node.x + LAB_NODE_WIDTH / 2, y: node.y + LAB_NODE_HEIGHT + 38 };
  }
  const domain = domains.find((item) => item.id === gap.domainId);
  if (domain) return { x: domain.x + domain.width / 2, y: domain.y + domain.height - 58 };
  return { x: LAB_WORLD_WIDTH / 2, y: LAB_WORLD_HEIGHT / 2 };
}

export function layoutLabTopDown(board: LabBoard): LabNode[] {
  if (board.nodes.length < 2) return board.nodes.map((node) => ({ ...node }));

  const nodeById = new Map(board.nodes.map((node) => [node.id, node]));
  const edgeKeys = new Set<string>();
  const edges: Array<{ id: string; from: string; to: string; confirmed: boolean }> = [];
  board.links.forEach((link) => {
    if (!nodeById.has(link.from) || !nodeById.has(link.to) || link.from === link.to) return;
    edgeKeys.add(`${link.from}>${link.to}`);
    edges.push({ id: `confirmed:${link.id}`, from: link.from, to: link.to, confirmed: true });
  });
  board.nodes.forEach((node) => {
    const parentId = node.hierarchyParentId;
    if (!parentId || !nodeById.has(parentId) || parentId === node.id || edgeKeys.has(`${parentId}>${node.id}`)) return;
    edgeKeys.add(`${parentId}>${node.id}`);
    edges.push({ id: `hierarchy:${parentId}:${node.id}`, from: parentId, to: node.id, confirmed: false });
  });

  const componentGraph = new graphlib.Graph({ directed: true });
  board.nodes.forEach((node) => componentGraph.setNode(node.id));
  edges.forEach((edge) => componentGraph.setEdge(edge.from, edge.to));

  const components = graphlib.alg.components(componentGraph)
    .map((ids) => ids.filter((id) => nodeById.has(id)))
    .filter((ids) => ids.length > 0)
    .sort((first, second) => {
      const firstEdges = edges.filter((edge) => first.includes(edge.from) && first.includes(edge.to)).length;
      const secondEdges = edges.filter((edge) => second.includes(edge.from) && second.includes(edge.to)).length;
      if (firstEdges !== secondEdges) return secondEdges - firstEdges;
      const firstX = Math.min(...first.map((id) => nodeById.get(id)?.x ?? 0));
      const secondX = Math.min(...second.map((id) => nodeById.get(id)?.x ?? 0));
      return firstX - secondX;
    });

  const arranged = components.map((component) => {
    const componentIds = new Set(component);
    const graph = new graphlib.Graph({ directed: true, multigraph: true })
      .setGraph({
        rankdir: "TB",
        ranker: "network-simplex",
        acyclicer: "greedy",
        rankalign: "center",
        nodesep: 82,
        edgesep: 34,
        ranksep: 116,
        marginx: 0,
        marginy: 0
      })
      .setDefaultEdgeLabel(() => ({}));

    component
      .map((id) => nodeById.get(id))
      .filter((node): node is LabNode => Boolean(node))
      .sort((first, second) => first.x - second.x || first.createdAt.localeCompare(second.createdAt))
      .forEach((node) => graph.setNode(node.id, { width: LAB_NODE_WIDTH, height: LAB_NODE_HEIGHT }));
    edges
      .filter((edge) => componentIds.has(edge.from) && componentIds.has(edge.to))
      .forEach((edge) => graph.setEdge(edge.from, edge.to, { minlen: 1, weight: edge.confirmed ? 6 : 3 }, edge.id));

    layout(graph);
    const positions = component.map((id) => {
      const position = graph.node(id) as { x: number; y: number };
      return { id, x: position.x - LAB_NODE_WIDTH / 2, y: position.y - LAB_NODE_HEIGHT / 2 };
    });
    const minX = Math.min(...positions.map((position) => position.x));
    const maxX = Math.max(...positions.map((position) => position.x + LAB_NODE_WIDTH));
    const minY = Math.min(...positions.map((position) => position.y));
    const maxY = Math.max(...positions.map((position) => position.y + LAB_NODE_HEIGHT));
    return {
      positions,
      minX,
      minY,
      width: Math.max(LAB_NODE_WIDTH, maxX - minX),
      height: Math.max(LAB_NODE_HEIGHT, maxY - minY)
    };
  });

  const maxRowWidth = LAB_WORLD_WIDTH - 160;
  const componentGap = 116;
  const rowGap = 138;
  const rows: typeof arranged[] = [];
  arranged.forEach((component) => {
    const row = rows.at(-1);
    const rowWidth = row?.reduce((sum, item) => sum + item.width, 0) ?? 0;
    const gapsWidth = row ? row.length * componentGap : 0;
    if (!row || rowWidth + gapsWidth + component.width > maxRowWidth) rows.push([component]);
    else row.push(component);
  });

  const nextById = new Map(board.nodes.map((node) => [node.id, { ...node }]));
  let rowTop = 96;
  rows.forEach((row) => {
    const rowWidth = row.reduce((sum, component) => sum + component.width, 0) + Math.max(0, row.length - 1) * componentGap;
    let left = Math.max(80, (LAB_WORLD_WIDTH - rowWidth) / 2);
    const rowHeight = Math.max(...row.map((component) => component.height));
    row.forEach((component) => {
      component.positions.forEach((position) => {
        const target = nextById.get(position.id);
        if (!target) return;
        target.x = clamp(left + position.x - component.minX, 40, LAB_WORLD_WIDTH - LAB_NODE_WIDTH - 40);
        target.y = clamp(rowTop + position.y - component.minY, 40, LAB_WORLD_HEIGHT - LAB_NODE_HEIGHT - 40);
      });
      left += component.width + componentGap;
    });
    rowTop += rowHeight + rowGap;
  });

  return board.nodes.map((node) => nextById.get(node.id) ?? { ...node });
}

export function computeGentleLabLayout(board: LabBoard, suggestions = deriveLabSuggestions(board), focusNodeId?: string): LabNode[] {
  if (!board.settings.autoOrganize || board.nodes.length < 2) return board.nodes.map((node) => ({ ...node }));
  const force = new Map(board.nodes.map((node) => [node.id, { x: 0, y: 0 }]));
  const nodeById = new Map(board.nodes.map((node) => [node.id, node]));

  const addForce = (nodeId: string, x: number, y: number) => {
    const current = force.get(nodeId);
    if (!current) return;
    current.x += x;
    current.y += y;
  };

  for (let index = 0; index < board.nodes.length; index += 1) {
    for (let comparison = index + 1; comparison < board.nodes.length; comparison += 1) {
      const first = board.nodes[index];
      const second = board.nodes[comparison];
      const firstCenter = center(first);
      const secondCenter = center(second);
      const dx = secondCenter.x - firstCenter.x;
      const dy = secondCenter.y - firstCenter.y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const minimumDistance = 275;
      if (distance < minimumDistance) {
        const pressure = (minimumDistance - distance) * 0.16;
        const unitX = dx / distance || (index % 2 === 0 ? 1 : -1);
        const unitY = dy / distance || 0.25;
        addForce(first.id, -unitX * pressure, -unitY * pressure);
        addForce(second.id, unitX * pressure, unitY * pressure);
      }
    }
  }

  suggestions.forEach((suggestion) => {
    const first = nodeById.get(suggestion.from);
    const second = nodeById.get(suggestion.to);
    if (!first || !second) return;
    const firstCenter = center(first);
    const secondCenter = center(second);
    const dx = secondCenter.x - firstCenter.x;
    const dy = secondCenter.y - firstCenter.y;
    const distance = Math.max(1, Math.hypot(dx, dy));
    const unitX = dx / distance;
    const unitY = dy / distance;

    if (suggestion.kind === "alternative" && board.settings.separateAlternatives && distance < 390) {
      const pressure = (390 - distance) * 0.09;
      addForce(first.id, -unitX * pressure, -unitY * pressure * 0.35);
      addForce(second.id, unitX * pressure, unitY * pressure * 0.35);
      return;
    }

    const shouldPull = board.settings.semanticProximity || (suggestion.kind === "question" && board.settings.placeQuestions);
    if (shouldPull && distance > 285) {
      const pull = Math.min(38, (distance - 285) * 0.08) * suggestion.confidence;
      addForce(first.id, unitX * pull, unitY * pull);
      addForce(second.id, -unitX * pull, -unitY * pull);
    }
  });

  board.links.forEach((link) => {
    const first = nodeById.get(link.from);
    const second = nodeById.get(link.to);
    if (!first || !second) return;
    const dx = second.x - first.x;
    const dy = second.y - first.y;
    const distance = Math.max(1, Math.hypot(dx, dy));
    if (distance <= 330) return;
    const pull = Math.min(24, (distance - 330) * 0.05);
    addForce(first.id, (dx / distance) * pull, (dy / distance) * pull);
    addForce(second.id, -(dx / distance) * pull, -(dy / distance) * pull);
  });

  return board.nodes.map((node) => {
    if (node.pinned) return { ...node };
    const nodeForce = force.get(node.id) ?? { x: 0, y: 0 };
    let mobility = focusNodeId === node.id ? 1 : 0.62;
    if (board.settings.stabilizeMature && node.maturity === "forming") mobility *= 0.45;
    if (board.settings.stabilizeMature && node.maturity === "decided") mobility *= 0.12;
    const dx = clamp(nodeForce.x * mobility, -64, 64);
    const dy = clamp(nodeForce.y * mobility, -52, 52);
    return {
      ...node,
      x: clamp(node.x + dx, 40, LAB_WORLD_WIDTH - LAB_NODE_WIDTH - 40),
      y: clamp(node.y + dy, 40, LAB_WORLD_HEIGHT - LAB_NODE_HEIGHT - 40)
    };
  });
}

function scoreRelation(first: LabNode, second: LabNode, settings: LabSettings): Omit<LabSuggestion, "id" | "from" | "to"> | null {
  const firstNormalized = normalize(first.text);
  const secondNormalized = normalize(second.text);
  const firstTokens = meaningfulTokens(firstNormalized);
  const secondTokens = meaningfulTokens(secondNormalized);
  const sharedTokens = [...firstTokens].filter((token) => secondTokens.has(token));
  const firstConcepts = conceptsFor(first.text);
  const secondConcepts = conceptsFor(second.text);
  const sharedConcepts = [...firstConcepts].filter((concept) => secondConcepts.has(concept));
  const firstQuestion = isQuestion(firstNormalized);
  const secondQuestion = isQuestion(secondNormalized);
  const oneQuestion = firstQuestion !== secondQuestion;
  const firstNegated = includesAny(firstNormalized, NEGATION_TERMS);
  const secondNegated = includesAny(secondNormalized, NEGATION_TERMS);
  const possibleTension = firstNegated !== secondNegated && (sharedTokens.length > 0 || sharedConcepts.length > 0);
  const alternativeSignal = includesAny(firstNormalized, ALTERNATIVE_TERMS) || includesAny(secondNormalized, ALTERNATIVE_TERMS);
  const centersDistance = Math.hypot(center(first).x - center(second).x, center(first).y - center(second).y);
  const spatialSignal = centersDistance < 210 ? 0.26 : centersDistance < 390 ? 0.1 * (1 - (centersDistance - 210) / 180) : 0;
  const semanticScore = Math.min(0.5, sharedTokens.length * 0.19) + Math.min(0.56, sharedConcepts.length * 0.36);
  let confidence = semanticScore + spatialSignal;
  let kind: LabSuggestionKind = "related";
  let reason: LabSuggestion["reason"] = semanticScore > 0 ? "shared-context" : "manual-proximity";

  if (possibleTension && settings.highlightTensions) {
    kind = "tension";
    reason = "possible-tension";
    confidence += 0.22;
  } else if (alternativeSignal && sharedConcepts.length > 0 && settings.separateAlternatives) {
    kind = "alternative";
    reason = "competing-paths";
    confidence += 0.2;
  } else if (oneQuestion && settings.placeQuestions && (semanticScore > 0 || centersDistance < 280)) {
    kind = "question";
    reason = "question-context";
    confidence += 0.16;
  }

  if (semanticScore === 0 && spatialSignal === 0) return null;
  return { kind, reason, confidence: clamp(confidence, 0, 0.98) };
}

function normalize(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9<>? ]+/g, " ").replace(/\s+/g, " ").trim();
}

function meaningfulTokens(value: string): Set<string> {
  return new Set(value.split(" ").filter((token) => token.length >= 3 && !STOP_WORDS.has(token)));
}

function conceptsFor(text: string): Set<string> {
  const normalized = normalize(text);
  return new Set(CONCEPTS.filter((concept) => includesAny(normalized, concept.terms)).map((concept) => concept.id));
}

function isQuestion(normalized: string): boolean {
  return normalized.endsWith("?") || QUESTION_STARTS.some((start) => normalized.startsWith(start));
}

function includesAny(value: string, terms: string[]): boolean {
  return terms.some((term) => value.includes(term));
}

function center(node: LabNode): { x: number; y: number } {
  return { x: node.x + LAB_NODE_WIDTH / 2, y: node.y + LAB_NODE_HEIGHT / 2 };
}

function pointInsideBounds(point: { x: number; y: number }, bounds: { x: number; y: number; width: number; height: number }): boolean {
  return point.x >= bounds.x && point.x <= bounds.x + bounds.width && point.y >= bounds.y && point.y <= bounds.y + bounds.height;
}

function domainHierarchyLevels(
  board: LabBoard,
  nodes: LabNode[],
  plans = new Map<string, LabNodeOrganization>()
): Map<string, number> {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const levels = new Map<string, number>();

  const visit = (nodeId: string, trail: Set<string>): number => {
    const cached = levels.get(nodeId);
    if (cached !== undefined) return cached;
    if (trail.has(nodeId)) return 0;
    const node = nodeById.get(nodeId);
    if (!node) return 0;
    const plan = plans.get(nodeId);
    const parentId = plan?.parentId || node.hierarchyParentId || confirmedParentFor(board, nodeId, [...nodeIds]);
    const inferred = parentId && nodeIds.has(parentId) ? visit(parentId, new Set(trail).add(nodeId)) + 1 : 0;
    const level = clamp(Math.max(inferred, plan?.level ?? 0), 0, 8);
    levels.set(nodeId, level);
    return level;
  };

  nodes.forEach((node) => visit(node.id, new Set()));
  return levels;
}

function confirmedParentFor(board: LabBoard, nodeId: string, allowedIds: string[]): string {
  const allowed = new Set(allowedIds);
  return board.links.find((link) => link.to === nodeId && allowed.has(link.from))?.from ?? "";
}

export function buildLabGaps(board: LabBoard, plans: LabGapPlan[]): LabGap[] {
  const domains = new Map<LabDomainId, LabNode[]>();
  board.nodes.forEach((node) => {
    const domainId = isLabDomainId(node.domainId) ? node.domainId : classifyLabDomain(node.text);
    domains.set(domainId, [...(domains.get(domainId) ?? []), node]);
  });
  const planned: LabGap[] = [];
  plans.forEach((plan) => {
    const domainNodes = domains.get(plan.domainId) ?? [];
    const domainNodeIds = new Set(domainNodes.map((node) => node.id));
    const prompt = plan.prompt.trim().replace(/\s+/g, " ").slice(0, 220);
    if (!prompt) return;
    const afterNodeId = plan.afterNodeId && domainNodeIds.has(plan.afterNodeId) ? plan.afterNodeId : domainNodes[0]?.id ?? "";
    const beforeNodeId = plan.beforeNodeId && domainNodeIds.has(plan.beforeNodeId) ? plan.beforeNodeId : domainNodes[1]?.id ?? "";
    if (!afterNodeId && !beforeNodeId) return;
    const id = gapId(plan.domainId, afterNodeId, beforeNodeId, prompt);
    planned.push({ id, domainId: plan.domainId, afterNodeId, beforeNodeId, prompt, source: plan.source ?? "gemini" });
  });
  if (planned.length > 0) return dedupeGaps(planned);

  const gaps: LabGap[] = [];
  domains.forEach((domainNodes, domainId) => {
    if (domainNodes.length < 2) return;
    const domainNodeIds = new Set(domainNodes.map((node) => node.id));
    const connectedIds = new Set<string>();
    board.links.forEach((link) => {
      if (!domainNodeIds.has(link.from) || !domainNodeIds.has(link.to)) return;
      connectedIds.add(link.from);
      connectedIds.add(link.to);
    });
    const disconnected = domainNodes.filter((node) => !connectedIds.has(node.id));
    if (disconnected.length === 0 && connectedIds.size === domainNodes.length) return;
    const first = disconnected[0] ?? domainNodes[0];
    const second = disconnected[1] ?? domainNodes.find((node) => node.id !== first.id) ?? first;
    const prompt = missingQuestionForDomain(domainId);
    gaps.push({
      id: gapId(domainId, first.id, second.id, prompt),
      domainId,
      afterNodeId: first.id,
      beforeNodeId: second.id,
      prompt,
      source: "local"
    });
  });
  return gaps.slice(0, 12);
}

function missingQuestionForDomain(domainId: LabDomainId): string {
  const questions: Record<LabDomainId, string> = {
    mission: "Que necessidade liga o problema ao resultado que a missão precisa entregar?",
    payload: "Que dado precisa ser coletado para demonstrar o objetivo da missão?",
    environment: "Que condição do ambiente ou da trajetória justifica estas escolhas?",
    electronics: "Que orçamento de energia e interfaces ainda precisam ser definidos?",
    communications: "Que informação precisa chegar, a quem e dentro de qual intervalo?",
    software: "Que entrada, processamento e saída conectam estas partes do software?",
    structure: "Que requisito físico ou ambiental orienta esta decisão de estrutura?",
    operations: "Que critério de teste demonstra que esta etapa foi concluída?",
    unassigned: "Que pergunta ajudaria a dar contexto e destino a estas ideias?"
  };
  return questions[domainId];
}

function gapId(domainId: LabDomainId, first: string, second: string, prompt: string): string {
  const signature = `${domainId}:${[first, second].sort().join(":")}:${normalize(prompt).slice(0, 42)}`;
  return `gap:${signature}`;
}

function dedupeGaps(gaps: LabGap[]): LabGap[] {
  const seen = new Set<string>();
  return gaps.filter((gap) => {
    if (seen.has(gap.id)) return false;
    seen.add(gap.id);
    return true;
  }).slice(0, 12);
}

function makeId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function isLabNode(value: unknown): value is LabNode {
  if (!value || typeof value !== "object") return false;
  const node = value as Partial<LabNode>;
  return typeof node.id === "string" && typeof node.text === "string" && typeof node.x === "number" && typeof node.y === "number";
}

function isLabLink(value: unknown): value is LabLink {
  if (!value || typeof value !== "object") return false;
  const link = value as Partial<LabLink>;
  return typeof link.id === "string" && typeof link.from === "string" && typeof link.to === "string";
}

function normalizeLabNode(node: LabNode): LabNode {
  return {
    ...node,
    description: typeof node.description === "string" ? node.description : undefined,
    clarifications: Array.isArray(node.clarifications) ? node.clarifications.filter((turn) => typeof turn?.question === "string" && turn.question.length <= 300 && typeof turn.answer === "string" && turn.answer.length <= 1500).slice(-CLARIFICATION_MAX_TURNS) : undefined,
    pendingClarification: typeof node.pendingClarification?.question === "string" && node.pendingClarification.question.length <= 300 ? { question: node.pendingClarification.question, ...(typeof node.pendingClarification.summary === "string" ? { summary: node.pendingClarification.summary } : {}) } : undefined,
    interpretedChange: matchesSchema(node.interpretedChange, changeSchema) ? node.interpretedChange : undefined,
    pinned: node.pinned === true,
    maturity: node.maturity === "forming" || node.maturity === "decided" ? node.maturity : "draft",
    createdAt: typeof node.createdAt === "string" ? node.createdAt : new Date(0).toISOString(),
    domainId: isLabDomainId(node.domainId) ? node.domainId : undefined,
    hierarchyParentId: typeof node.hierarchyParentId === "string" ? node.hierarchyParentId : undefined
  };
}

function isLabTeamAction(value: unknown): value is LabTeamAction {
  if (!value || typeof value !== "object") return false;
  const action = value as Partial<LabTeamAction>;
  return typeof action.id === "string"
    && typeof action.kind === "string"
    && typeof action.at === "string"
    && Array.isArray(action.nodeIds)
    && (action.source === "team" || action.source === "ai")
    && typeof action.summary === "string";
}

function isLabInsight(value: unknown): value is LabInsight {
  if (!value || typeof value !== "object") return false;
  const insight = value as Partial<LabInsight>;
  return typeof insight.id === "string"
    && (insight.kind === "needs-context" || insight.kind === "duplicate" || insight.kind === "tension" || insight.kind === "connection-warning")
    && Array.isArray(insight.nodeIds)
    && typeof insight.title === "string"
    && typeof insight.detail === "string"
    && typeof insight.question === "string"
    && insight.source === "gemini"
    && typeof insight.updatedAt === "string";
}

function isLabGap(value: unknown): value is LabGap {
  if (!value || typeof value !== "object") return false;
  const gap = value as Partial<LabGap>;
  return typeof gap.id === "string"
    && isLabDomainId(gap.domainId)
    && typeof gap.afterNodeId === "string"
    && typeof gap.beforeNodeId === "string"
    && typeof gap.prompt === "string"
    && (gap.source === "local" || gap.source === "gemini");
}
