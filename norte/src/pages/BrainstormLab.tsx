import { hypothesisText, hypothesisFields, discoveryInput, discoveryInputKey, interpretationErrorMessage } from "../lib/discoveryHypothesis";
import { HYPOTHESIS_MAX_LENGTH, CLARIFICATION_MAX_TURNS } from "../../shared/discovery-limits.mjs";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Link2, Pencil, Plus, Redo2, Trash2, Undo2, Copy, LoaderCircle, Check, Maximize2, X } from "lucide-react";
import { useAuth } from "../lib/auth";
import { createLabLink, createLabNode, LAB_NODE_WIDTH, LAB_NODE_HEIGHT, LAB_WORLD_HEIGHT, LAB_WORLD_WIDTH, loadLabBoard, normalizeLabBoard, saveLabBoard } from "../lib/brainstormLab";
import type { LabBoard, LabNode } from "../lib/brainstormLab";
import type { MissionProject } from "../lib/projectStore";
import type { Language } from "../lib/types";
import type { EngineeringAnalysis, EngineeringChange } from "../lib/engineeringSystem";
import { analyzeImpact } from "../lib/impactEngine";
import { engineeringLabel } from "../lib/engineeringUi";
import { EngineeringScenario } from "./SystemWorkspace";
import { requestProjectFeedback } from "../lib/projectLearning";
import { acceptAuthorizedScenario, scenarioContextMatches } from "../lib/authorizedScenario";
import type { AuthorizedScenarioContext } from "../lib/authorizedScenario";
import { openDeliveryRecord } from "../lib/projectDelivery";

const SUGGESTION_WIDTH = 250, SUGGESTION_GAP = 14, SUGGESTION_OFFSET = 96;
const plain = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/** Writers type Portuguese at architectures named in English: "antena" must still find "Antenna". */
function sharesStem(written: string, part: string) {
  const shortest = Math.min(written.length, part.length);
  if (shortest < 3) return false;
  let shared = 0;
  while (shared < shortest && written[shared] === part[shared]) shared += 1;
  return shared >= 4 || shared === shortest;
}

/** Everyday words the writer used, matched against the names the architecture actually carries. */
export function nameCompletions(text: string, model: MissionProject["engineeringSystem"], limit = 4) {
  if (!model) return [];
  const written = plain(text);
  const words = [...new Set(written.match(/\p{L}{3,}/gu) ?? [])];
  if (!words.length) return [];
  const named = [...model.entities.filter((entity) => !["system", "subsystem"].includes(entity.kind)), ...model.requirements.map((item) => ({ ...item, name: item.title, properties: item.properties }))];
  return named.flatMap((item) => {
    const name = plain(item.name);
    if (written.includes(name)) return [];
    const word = words.find((candidate) => name.split(/[^\p{L}\d]+/u).some((part) => sharesStem(candidate, part)));
    if (!word) return [];
    const detail = item.properties.filter((property) => property.key !== "formula" && typeof property.value === "number").slice(0, 2).map((property) => `${property.value} ${property.unit ?? ""}`.trim()).join(" · ");
    return [{ id: item.id, word, name: item.name, detail }];
  }).sort((first, second) => second.word.length - first.word.length).slice(0, limit);
}

type Interpretation = { text: string; status: "loading" | "resolved" | "confirmation" | "clarification" | "unsupported" | "error"; message?: string; code?: string; understood?: { targetName?: string; updates?: Array<{ propertyKey: string; value: string | number; unit: string; quote: string }> }; summary?: string; question?: string; change?: EngineeringChange; baselineId?: string; baselineRevision?: number; baselineGeneratedAt?: string };
/** An impact reading anchored to the idea that produced it, still only a proposal. */
type Proposal = { nodeId: string; analysis: EngineeringAnalysis; deliveryRevision: number };
type Props = { language: Language; project: MissionProject; onProjectChange: (project: MissionProject) => void };
type Transform = { scale: number; x: number; y: number };
type Composer = { x: number; y: number; text: string; nodeId?: string; question?: string; answer?: string };
type Gesture = { kind: "pan" | "node"; pointerId: number; startX: number; startY: number; x: number; y: number; nodeId?: string; before: LabBoard; moved: boolean };
const PROMPTS = { pt: ["Clique para explorar uma hipótese.", "E se mudássemos alguma coisa?"], en: ["Click to explore a hypothesis.", "What if we changed something?"] };

export function BrainstormLab({ language, project, onProjectChange }: Props) {
  const auth = useAuth();
  const [board, setBoard] = useState(() => loadLabBoard(project.id));
  const boardRef = useRef(board);
  const viewportRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const historyRef = useRef<{ past: LabBoard[]; future: LabBoard[] }>({ past: [], future: [] });
  const [history, setHistory] = useState({ undo: false, redo: false });
  const [ready, setReady] = useState(false);
  const remoteReadyRef = useRef(false);
  const [feedback, setFeedback] = useState("");
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [transform, setTransform] = useState<Transform>({ scale: 1, x: 0, y: 0 });
  const [selected, setSelected] = useState<string | null>(null);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [composer, setComposer] = useState<Composer | null>(null);
  const [interpretations, setInterpretations] = useState<Record<string, Interpretation>>({});
  const interpretationRequests = useRef(new Map<string, AbortController>());
  const projectRef = useRef(project); projectRef.current = project;
  const [scenario, setScenario] = useState<EngineeringAnalysis | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const framedRef = useRef<string | null>(null);
  const [panning, setPanning] = useState(false);
  const prompt = useAnimatedPrompt(PROMPTS[language]);
  const copy = language === "pt" ? { add: "Nova ideia", edit: "Editar ideia", remove: "Excluir ideia", connect: "Conectar ideia", undo: "Desfazer", redo: "Refazer", fit: "Enquadrar ideias", in: "Aumentar zoom", out: "Diminuir zoom", placeholder: "Escreva uma hipótese…", impact: "Testar ideia", save: "Salvar", cancel: "Cancelar", idea: "HIPÓTESE", sync: "Não foi possível sincronizar. As ideias estão salvas neste navegador.", yes: "Sim, testar ideia", no: "Não, ajustar", accept: "Aplicar ao sistema", dismiss: "Descartar sugestões", full: "Abrir mapa completo", suggestions: "SUGESTÃO", noImpact: "Nada mais no sistema depende desta mudança.", naming: "Do projeto:" } : { add: "New idea", edit: "Edit idea", remove: "Delete idea", connect: "Connect idea", undo: "Undo", redo: "Redo", fit: "Fit ideas", in: "Zoom in", out: "Zoom out", placeholder: "Write a hypothesis…", impact: "Test idea", save: "Save", cancel: "Cancel", idea: "HYPOTHESIS", sync: "Could not sync. Ideas are saved in this browser.", yes: "Yes, test idea", no: "No, adjust", accept: "Apply to system", dismiss: "Dismiss suggestions", full: "Open full map", suggestions: "SUGGESTION", noImpact: "Nothing else in the system depends on this change.", naming: "From the project:" };
  const syncMessageRef = useRef(copy.sync);
  syncMessageRef.current = copy.sync;

  const update = useCallback((next: LabBoard) => { boardRef.current = next; setBoard(next); saveLabBoard(project.id, next); }, [project.id]);
  function updateHistory() { setHistory({ undo: historyRef.current.past.length > 0, redo: historyRef.current.future.length > 0 }); }
  function commit(next: LabBoard, before = boardRef.current) {
    historyRef.current = { past: [...historyRef.current.past, structuredClone(before)].slice(-60), future: [] };
    updateHistory(); update(next);
  }
  function undo() {
    const previous = historyRef.current.past.pop();
    if (!previous) return;
    historyRef.current.future.push(structuredClone(boardRef.current));
    update(previous); updateHistory(); setSelected(null);
  }
  function redo() {
    const next = historyRef.current.future.pop();
    if (!next) return;
    historyRef.current.past.push(structuredClone(boardRef.current));
    update(next); updateHistory(); setSelected(null);
  }
  function remove(id: string) { commit({ ...boardRef.current, nodes: boardRef.current.nodes.filter((node) => node.id !== id), links: boardRef.current.links.filter((link) => link.from !== id && link.to !== id) }); setSelected(null); setComposer(null); }
  async function openImpact(change: EngineeringChange, nodeId: string) {
    const projectSnapshot = projectRef.current, model = projectSnapshot.engineeringSystem;
    if (!model) return;
    try {
      const context = await auth.api<AuthorizedScenarioContext>(`/projects/${encodeURIComponent(projectSnapshot.id)}/analysis-context`);
      if (projectRef.current.id !== projectSnapshot.id || !scenarioContextMatches(projectRef.current.engineeringSystem!, context)) throw new Error('Baseline changed');
      const effective = context.analysisModel, analysis = analyzeImpact(effective, change, language);
      analysis.baseline = { entities: effective.entities, relations: effective.relations, requirements: effective.requirements, evidence: effective.evidence };
      setProposal({ nodeId, analysis, deliveryRevision: context.deliveryRevision }); setComposer(null); setFeedback('');
    } catch { setFeedback(language === 'pt' ? 'Não foi possível avaliar com a versão atual. Atualize o projeto e teste a ideia novamente.' : 'Could not evaluate the current version. Refresh the project and test the idea again.'); }
  }
  /** Accepting writes the proposal into the architecture; until then nothing moved. */
  async function recordFeedback(kind: "accepted" | "rejected", nodeId: string, comment: string) {
    const node = boardRef.current.nodes.find(item => item.id === nodeId);
    if (!node) return false;
    try { await auth.api(`/projects/${encodeURIComponent(project.id)}/feedback`, { method: "POST", body: JSON.stringify({ kind, input: hypothesisText(node), subjectId: nodeId, comment, sourceRevision: projectRef.current.memoryRevision || 0 }) }); return true; }
    catch { return false; }
  }
  async function acceptProposal() {
    const projectSnapshot = projectRef.current, model = projectSnapshot.engineeringSystem;
    if (!proposal || !model || feedbackBusy) return;
    if (proposal.analysis.change.kind === 'requirement') { openDeliveryRecord('requirements', proposal.analysis.changedEntityId); return; }
    setFeedbackBusy(true);
    try {
      const latest = await auth.api<AuthorizedScenarioContext>(`/projects/${encodeURIComponent(projectSnapshot.id)}/analysis-context`);
      if (projectRef.current.id !== projectSnapshot.id || !scenarioContextMatches(model, latest) || latest.deliveryRevision !== proposal.deliveryRevision || JSON.stringify(latest.analysisModel.entities) !== JSON.stringify(proposal.analysis.baseline?.entities)) throw new Error('Context changed');
      const recorded = await recordFeedback('accepted', proposal.nodeId, 'A pessoa aplicou a sugestão à arquitetura.');
      if (projectRef.current.engineeringSystem !== model) throw new Error('Baseline changed');
      onProjectChange({ ...projectRef.current, engineeringSystem: acceptAuthorizedScenario(model, proposal.analysis) });
      setProposal(null); setScenario(null);
      setFeedback(language === 'pt' ? 'Sugestão aplicada à arquitetura.' + (recorded ? ' Avaliação registrada.' : ' Não foi possível registrar a avaliação.') : 'Suggestion applied to the architecture.' + (recorded ? ' Feedback recorded.' : ' Feedback could not be recorded.'));
    } catch { setFeedback(language === 'pt' ? 'Os requisitos ou a arquitetura mudaram. Teste a ideia novamente antes de aplicar.' : 'Requirements or architecture changed. Test the idea again before applying.'); }
    finally { setFeedbackBusy(false); }
  }
  async function dismissProposal() { if (!proposal || feedbackBusy) return; setFeedbackBusy(true); const recorded = await recordFeedback("rejected", proposal.nodeId, "A pessoa descartou as sugestões desta interpretação."); setFeedbackBusy(false); setProposal(null); if (!recorded) setFeedback(language === "pt" ? "Sugestões descartadas. Não foi possível registrar a avaliação." : "Suggestions dismissed. Feedback could not be recorded."); }
  async function interpret(node: LabNode, showResult = false) {
    if (!projectRef.current.engineeringSystem) return;
    interpretationRequests.current.get(node.id)?.abort();
    const controller = new AbortController(); interpretationRequests.current.set(node.id, controller);
    const input = discoveryInput(boardRef.current, node), key = discoveryInputKey(boardRef.current, node);
    const isCurrent = () => { const latest = boardRef.current.nodes.find((item) => item.id === node.id); return latest && discoveryInputKey(boardRef.current, latest) === key; };
    setInterpretations((current) => ({ ...current, [node.id]: { ...current[node.id], text: key, status: "loading", summary: undefined, question: undefined, message: undefined } }));
    try {
      if (auth.isDemo) throw new Error(language === "pt" ? "A interpretação por IA está disponível no ambiente conectado." : "AI interpretation is available in the connected workspace.");
      const response = await auth.api<Omit<Interpretation, "text">>("/system-ai/interpret-hypothesis", { method: "POST", body: JSON.stringify({ projectId: project.id, ...input, language }), signal: controller.signal });
      if (controller.signal.aborted || !isCurrent()) return;
      const model = projectRef.current.engineeringSystem;
      if (response.baselineId !== model?.id || response.baselineRevision !== (model?.revision || 0) || response.baselineGeneratedAt !== model?.generatedAt) throw new Error(language === "pt" ? "O sistema mudou. Interprete esta ideia novamente." : "The system changed. Interpret this idea again.");
      setInterpretations((current) => ({ ...current, [node.id]: { ...response, text: key } }));
      update({ ...boardRef.current, nodes: boardRef.current.nodes.map((item) => item.id === node.id ? { ...item, pendingClarification: response.status === "clarification" && response.question ? { question: response.question, summary: response.summary } : undefined } : item) });
      if (showResult && response.status === "resolved" && response.change) void openImpact(response.change, node.id);
    } catch (error) {
      if (!controller.signal.aborted && isCurrent()) setInterpretations((current) => ({ ...current, [node.id]: { ...current[node.id], text: key, status: "error", message: interpretationErrorMessage(error instanceof Error && "code" in error ? String(error.code) : "", language) } }));
    } finally { if (interpretationRequests.current.get(node.id) === controller) interpretationRequests.current.delete(node.id); }
  }
  function showImpact(node: LabNode) {
    const result = interpretations[node.id], model = project.engineeringSystem;
    if (node.interpretedChange) return openImpact(node.interpretedChange, node.id);
    if (result?.text === discoveryInputKey(boardRef.current, node) && ["resolved", "confirmation"].includes(result.status) && result.change && result.baselineId === model?.id && result.baselineRevision === (model?.revision || 0) && result.baselineGeneratedAt === model?.generatedAt) openImpact(result.change, node.id);
    else void interpret(node, true);
  }
  useEffect(() => () => { interpretationRequests.current.forEach((controller) => controller.abort()); }, []);
  useEffect(() => {
    if (proposal && !board.nodes.some((node) => node.id === proposal.nodeId)) setProposal(null);
  }, [board.nodes, proposal]);
  function fit() {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect || !boardRef.current.nodes.length) return;
    const nodes = boardRef.current.nodes;
    const minX = Math.min(...nodes.map((node) => node.x)), minY = Math.min(...nodes.map((node) => node.y));
    const width = Math.max(...nodes.map((node) => node.x + LAB_NODE_WIDTH)) - minX;
    const height = Math.max(...nodes.map((node) => node.y + LAB_NODE_HEIGHT)) - minY;
    const scale = Math.max(.2, Math.min(1, (rect.width - 100) / width, (rect.height - 120) / height));
    setTransform({ scale, x: (rect.width - width * scale) / 2 - minX * scale, y: (rect.height - height * scale) / 2 - minY * scale });
  }
  function zoom(factor: number, anchor?: { x: number; y: number }) {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;
    const point = anchor ?? { x: rect.width / 2, y: rect.height / 2 };
    setTransform((current) => {
      const scale = Math.max(.2, Math.min(2, current.scale * factor));
      return { scale, x: point.x - (point.x - current.x) * scale / current.scale, y: point.y - (point.y - current.y) * scale / current.scale };
    });
  }
  function freePosition(origin: { x: number; y: number }) {
    const nodes = boardRef.current.nodes;
    for (let step = 0; step <= nodes.length; step++) {
      const position = { x: origin.x + (step % 3) * (LAB_NODE_WIDTH + 40), y: origin.y + Math.floor(step / 3) * (LAB_NODE_HEIGHT + 50) };
      if (!nodes.some((node) => Math.abs(node.x - position.x) < LAB_NODE_WIDTH + 20 && Math.abs(node.y - position.y) < LAB_NODE_HEIGHT + 30)) return position;
    }
    return { x: origin.x, y: Math.max(...nodes.map((node) => node.y)) + LAB_NODE_HEIGHT + 50 };
  }
  function openComposer(point?: { x: number; y: number }, node?: LabNode, clarify = false) {
    const rect = viewportRef.current?.getBoundingClientRect();
    const center = point ?? { x: (rect?.width ?? 800) / 2, y: (rect?.height ?? 500) / 2 };
    setComposer(node ? { x: node.x, y: node.y, text: hypothesisText(node), nodeId: node.id, ...(clarify && node.pendingClarification ? { question: node.pendingClarification.question, answer: "" } : {}) } : { x: (center.x - transform.x) / transform.scale, y: (center.y - transform.y) / transform.scale, text: "" });
    setConnecting(null);
  }
  function applyCompletion(completion: { word: string; name: string }) {
    if (!composer) return;
    const match = new RegExp(`(?<![\\p{L}\\d])${completion.word.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\p{L}*`, "iu");
    const source = plain(composer.text);
    const found = source.match(match);
    const text = found?.index === undefined ? `${composer.text.trim()} ${completion.name}`.trim() : composer.text.slice(0, found.index) + completion.name + composer.text.slice(found.index + found[0].length);
    if (text.length <= HYPOTHESIS_MAX_LENGTH) setComposer({ ...composer, text });
    textareaRef.current?.focus();
  }
  function saveIdea() {
    if (!composer?.text.trim()) return;
    if (composer.question && !composer.answer?.trim()) return;
    const text = composer.question ? `${composer.text.trim()}\n${composer.answer!.trim()}` : composer.text.trim();
    if (text.length > HYPOTHESIS_MAX_LENGTH) return;
    if (composer.nodeId) {
      commit({ ...boardRef.current, nodes: boardRef.current.nodes.map((node) => node.id === composer.nodeId ? { ...node, ...hypothesisFields(text), pendingClarification: undefined, interpretedChange: undefined, ...(composer.question ? { clarifications: [...(node.clarifications || []), { question: composer.question, answer: composer.answer!.trim() }].slice(-CLARIFICATION_MAX_TURNS) } : {}) } : node) }); setComposer(null);
      const edited = boardRef.current.nodes.find((node) => node.id === composer.nodeId); if (edited) void interpret(edited);
    } else {
      const position = freePosition(composer);
      const node = createLabNode(text, position.x, position.y);
      commit({ ...boardRef.current, nodes: [...boardRef.current.nodes, node] });
      setComposer({ x: composer.x, y: composer.y + LAB_NODE_HEIGHT + 30, text: "" });
      setSelected(node.id); fit(); void interpret(node);
    }
  }
  function selectNode(node: LabNode) {
    if (connecting && connecting !== node.id) {
      const current = boardRef.current;
      if (!current.links.some((link) => link.from === connecting && link.to === node.id)) commit({ ...current, links: [...current.links, createLabLink(connecting, node.id)] });
      setConnecting(null);
    }
    setSelected(node.id);
  }
  function pointerDown(event: React.PointerEvent, node?: LabNode) {
    if (event.button !== 0 || (event.target as HTMLElement).closest("textarea,[data-control]") || (event.target as HTMLElement).closest("button:not(.discovery-node-text)")) return;
    event.stopPropagation();
    if (node) selectNode(node); else { setSelected(null); setConnecting(null); }
    gestureRef.current = { kind: node ? "node" : "pan", pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, x: node?.x ?? transform.x, y: node?.y ?? transform.y, nodeId: node?.id, before: structuredClone(boardRef.current), moved: false };
    viewportRef.current?.setPointerCapture(event.pointerId);
  }
  function pointerMove(event: React.PointerEvent) {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const dx = event.clientX - gesture.startX, dy = event.clientY - gesture.startY;
    if (Math.hypot(dx, dy) < 4 && !gesture.moved) return;
    gesture.moved = true;
    if (gesture.kind === "pan") { setPanning(true); setTransform((current) => ({ ...current, x: gesture.x + dx, y: gesture.y + dy })); }
    else update({ ...boardRef.current, nodes: boardRef.current.nodes.map((node) => node.id === gesture.nodeId ? { ...node, x: gesture.x + dx / transform.scale, y: gesture.y + dy / transform.scale, pinned: true } : node) });
  }
  function pointerUp(event: React.PointerEvent) {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    gestureRef.current = null; setPanning(false);
    if (viewportRef.current?.hasPointerCapture(event.pointerId)) viewportRef.current.releasePointerCapture(event.pointerId);
    if (gesture.kind === "node" && gesture.moved) commit(boardRef.current, gesture.before);
    if (gesture.kind === "pan" && !gesture.moved && event.type !== "pointercancel") {
      if (composer) { setComposer(null); return; }
      const rect = viewportRef.current?.getBoundingClientRect();
      if (rect) openComposer({ x: event.clientX - rect.left, y: event.clientY - rect.top });
    }
  }

  useEffect(() => { if (composer) textareaRef.current?.focus(); }, [composer?.nodeId, Boolean(composer)]);
  useEffect(() => {
    let cancelled = false;
    setReady(false);
    remoteReadyRef.current = false;
    void auth.api<{ board: LabBoard | null }>(`/workspace/labs/${encodeURIComponent(project.id)}`).then(({ board: remote }) => {
      if (!cancelled && remote) update(normalizeLabBoard(remote));
    }).catch(() => { if (!cancelled) setFeedback(syncMessageRef.current); }).finally(() => { if (!cancelled) { remoteReadyRef.current = true; setReady(true); } });
    return () => { cancelled = true; };
  }, [auth.api, project.id, update]);
  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(() => {
      void auth.api(`/workspace/labs/${encodeURIComponent(project.id)}`, { method: "PUT", body: JSON.stringify(board) }).then(() => setFeedback("")).catch(() => setFeedback(syncMessageRef.current));
    }, 320);
    return () => window.clearTimeout(timer);
  }, [auth.api, board, project.id, ready]);
  useEffect(() => {
    const flush = () => {
      if (!remoteReadyRef.current) return;
      saveLabBoard(project.id, boardRef.current);
      void auth.api(`/workspace/labs/${encodeURIComponent(project.id)}`, { method: "PUT", body: JSON.stringify(boardRef.current), keepalive: true }).catch(() => undefined);
    };
    window.addEventListener("pagehide", flush);
    return () => { window.removeEventListener("pagehide", flush); flush(); };
  }, [auth.api, project.id]);
  useEffect(() => { if (ready) fit(); }, [ready]);
  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if (scenario || (event.target instanceof HTMLElement && event.target.closest("input,textarea,select,[contenteditable=true]"))) return;
      const command = event.ctrlKey || event.metaKey;
      if (command && event.key.toLowerCase() === "z") { event.preventDefault(); if (event.shiftKey) redo(); else undo(); }
      else if (command && event.key.toLowerCase() === "y") { event.preventDefault(); redo(); }
      else if (command && event.key.toLowerCase() === "n") { event.preventDefault(); openComposer(); }
      else if (selected && ["Delete", "Backspace"].includes(event.key)) { event.preventDefault(); remove(selected); }
      else if (event.key === "Escape") { setComposer(null); setConnecting(null); setSelected(null); }
    }
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  });

  const completions = composer ? nameCompletions(composer.text, project.engineeringSystem) : [];

  const suggestions = (() => {
    const model = project.engineeringSystem;
    const anchor = proposal && board.nodes.find((node) => node.id === proposal.nodeId);
    if (!proposal || !anchor || !model) return null;
    const pt = language === "pt";
    const blocks = proposal.analysis.impacts
      .filter((impact) => impact.status !== "unaffected")
      .map((impact) => {
        const entity = proposal.analysis.baseline?.entities.find((item) => item.id === impact.entityId) ?? proposal.analysis.baseline?.requirements.find((item) => item.id === impact.entityId) ?? model.entities.find((item) => item.id === impact.entityId) ?? model.requirements.find((item) => item.id === impact.entityId);
        const explanation = impact.shortExplanation || (pt ? "Sem explicação registrada." : "No recorded explanation.");
        const calculation = impact.calculation;
        return {
          entityId: impact.entityId, status: impact.status,
          name: (entity && ("name" in entity ? entity.name : entity.title)) || impact.entityId,
          explanation, value: calculation && typeof calculation.result === "number" ? `${Number(calculation.result.toPrecision(5))} ${calculation.unit}`.trim() : "",
          height: 96 + Math.min(3, Math.ceil(explanation.length / 38)) * 16
        };
      });
    if (!blocks.length) blocks.push({ entityId: "none", status: "valid" as const, name: proposal.analysis.change.description, explanation: copy.noImpact, value: "", height: 118 });
    const height = blocks.reduce((total, block) => total + block.height + SUGGESTION_GAP, -SUGGESTION_GAP);
    return { blocks, analysis: proposal.analysis, height, x: anchor.x + LAB_NODE_WIDTH + SUGGESTION_OFFSET, y: anchor.y + LAB_NODE_HEIGHT / 2 - height / 2 };
  })();

  // An impact the user cannot see is not an answer: frame the idea with its flow.
  useEffect(() => {
    if (!proposal || !suggestions) { framedRef.current = null; return; }
    if (framedRef.current === proposal.analysis.id) return;
    const anchor = boardRef.current.nodes.find((node) => node.id === proposal.nodeId);
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!anchor || !rect) return;
    framedRef.current = proposal.analysis.id;
    const left = anchor.x, top = Math.min(anchor.y, suggestions.y);
    const width = suggestions.x + SUGGESTION_WIDTH - left;
    const height = Math.max(anchor.y + LAB_NODE_HEIGHT, suggestions.y + suggestions.height + 130) - top;
    const scale = Math.max(.3, Math.min(1, (rect.width - 130) / width, (rect.height - 150) / height));
    setTransform({ scale, x: (rect.width - width * scale) / 2 - left * scale, y: (rect.height - height * scale) / 2 - top * scale });
  }, [proposal, suggestions]);

  return <div className="brainstorm-lab quiet-discovery">
    {!scenario && <div className="discovery-tools" role="toolbar" aria-label={language === "pt" ? "Ferramentas de ideias" : "Idea tools"}>
      <button className="primary" type="button" onClick={() => openComposer()} disabled={!ready}><Plus />{copy.add}</button>
      {selected && <><span />
      <button type="button" disabled={!selected} onClick={() => setConnecting(connecting ? null : selected)} aria-pressed={Boolean(connecting)}><Link2 />{language === "pt" ? "Conectar" : "Connect"}</button>
      <button type="button" disabled={!selected} onClick={() => { const original = boardRef.current.nodes.find((node) => node.id === selected); if (original) { const position = freePosition({ x: original.x + LAB_NODE_WIDTH + 40, y: original.y }); const node = { ...createLabNode(hypothesisText(original), position.x, position.y), clarifications: structuredClone(original.clarifications), pendingClarification: structuredClone(original.pendingClarification) }; commit({ ...boardRef.current, nodes: [...boardRef.current.nodes, node] }); setSelected(node.id); fit(); } }}><Copy />{language === "pt" ? "Duplicar" : "Duplicate"}</button>
      <button type="button" disabled={!selected} onClick={() => { if (selected) remove(selected); }}><Trash2 />{language === "pt" ? "Excluir" : "Delete"}</button></>}
    </div>}
    {scenario && project.engineeringSystem ? <EngineeringScenario language={language} model={project.engineeringSystem} analysis={scenario} onClear={() => setScenario(null)} saved={project.engineeringSystem.scenarios?.some((item) => item.id === scenario.id)} onSave={() => onProjectChange({ ...project, engineeringSystem: { ...project.engineeringSystem!, scenarios: [...(project.engineeringSystem?.scenarios ?? []).filter((item) => item.id !== scenario.id), scenario] } })} /> : <div ref={viewportRef} className={`lab-canvas${panning ? " panning" : ""}`} onPointerDown={(event) => { if (ready) pointerDown(event); }} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} onWheel={(event) => {
      if ((event.target as HTMLElement).closest("textarea")) return;
      const rect = event.currentTarget.getBoundingClientRect(); zoom(event.deltaY < 0 ? 1.08 : 1 / 1.08, { x: event.clientX - rect.left, y: event.clientY - rect.top });
    }}>
      {!board.nodes.length && !composer && <button className="lab-empty-prompt" data-control type="button" onClick={() => openComposer()} disabled={!ready} aria-label={copy.add}><span className="lab-empty-plus" aria-hidden="true">+</span><strong>{prompt}<i aria-hidden="true" /></strong></button>}
      <div className="lab-world" style={{ width: LAB_WORLD_WIDTH, height: LAB_WORLD_HEIGHT, transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})` }}>
        <svg className="lab-relations" width={LAB_WORLD_WIDTH} height={LAB_WORLD_HEIGHT} aria-hidden="true"><defs><marker id="discovery-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10" fill="#6c9dbc" /></marker></defs>{board.links.map((link) => {
          const from = board.nodes.find((node) => node.id === link.from), to = board.nodes.find((node) => node.id === link.to);
          if (!from || !to) return null;
          return <path key={link.id} className="lab-relation confirmed" d={`M${from.x + LAB_NODE_WIDTH / 2},${from.y + LAB_NODE_HEIGHT} C${from.x + LAB_NODE_WIDTH / 2},${from.y + LAB_NODE_HEIGHT + 35} ${to.x + LAB_NODE_WIDTH / 2},${to.y - 35} ${to.x + LAB_NODE_WIDTH / 2},${to.y}`} markerEnd="url(#discovery-arrow)" />;
        })}{suggestions && (() => {
          const anchor = board.nodes.find((node) => node.id === proposal?.nodeId)!;
          const from = { x: anchor.x + LAB_NODE_WIDTH, y: anchor.y + LAB_NODE_HEIGHT / 2 };
          return suggestions.blocks.map((block, index) => {
            const to = { x: suggestions.x, y: suggestions.y + index * (block.height + SUGGESTION_GAP) + block.height / 2 };
            return <path key={`suggestion:${block.entityId}`} className="lab-relation suggestion" d={`M${from.x},${from.y} C${from.x + 50},${from.y} ${to.x - 50},${to.y} ${to.x},${to.y}`} markerEnd="url(#discovery-arrow)" />;
          });
        })()}</svg>
        {board.nodes.map((node) => {
          const interpretation: Interpretation | undefined = interpretations[node.id]?.text === discoveryInputKey(board, node) ? interpretations[node.id]
            : node.interpretedChange ? { text: discoveryInputKey(board, node), status: "resolved", summary: node.interpretedChange.description, change: node.interpretedChange, understood: { targetName: project.engineeringSystem?.entities.find((item) => item.id === node.interpretedChange?.targetEntityId)?.name, updates: node.interpretedChange.newValues.map((item) => ({ propertyKey: item.key, value: item.value, unit: item.unit || "", quote: "" })) } }
            : node.pendingClarification ? { text: discoveryInputKey(board, node), status: "clarification", ...node.pendingClarification } : undefined;
          return <article className={`lab-node${selected === node.id ? " selected" : ""}`} style={{ left: node.x, top: node.y, width: LAB_NODE_WIDTH, minHeight: LAB_NODE_HEIGHT }} key={node.id} data-node-id={node.id} onPointerDown={(event) => pointerDown(event, node)} onDoubleClick={() => openComposer(undefined, node)}>
            <div className="lab-node-head"><span>{copy.idea}</span><button type="button" title={copy.edit} aria-label={`${copy.edit}: ${node.text}`} onClick={() => openComposer(undefined, node)}><Pencil aria-hidden="true" /></button></div>
            <button className="discovery-node-text" type="button" onClick={() => selectNode(node)} onDoubleClick={() => openComposer(undefined, node)}>{node.text}</button>
            {interpretation && <p className={`discovery-interpretation ${interpretation.status}`} aria-live="polite">{interpretation.status === "loading" ? <><LoaderCircle className="engineering-spin" />{language === "pt" ? "Interpretando a ideia…" : "Interpreting the idea…"}</> : interpretation.summary || interpretation.message || interpretation.question}</p>}
            {["confirmation", "clarification"].includes(interpretation?.status || "") && interpretation?.question && interpretation.summary && <p className="discovery-interpretation question">{interpretation.question}</p>}
            {interpretation?.status === "unsupported" && interpretation.summary && interpretation.message && <p className="discovery-interpretation unsupported">{interpretation.message}</p>}
            {interpretation?.understood?.updates?.length ? <p className="discovery-interpretation">{language === "pt" ? "Dados reconhecidos" : "Recognized details"}: {interpretation.understood.targetName} · {interpretation.understood.updates.map((item) => `${item.value} ${item.unit}`).join("; ")}</p> : null}
            {node.description && <button className="discovery-impact-action" type="button" onClick={() => openComposer(undefined, node)}>{language === "pt" ? "Ler hipótese completa" : "Read full hypothesis"}</button>}
            {["clarification", "unsupported"].includes(interpretation?.status || "") ? <button className="discovery-impact-action" type="button" onClick={() => openComposer(undefined, node, interpretation?.status === "clarification")}><Pencil />{interpretation?.status === "unsupported" ? copy.edit : language === "pt" ? "Completar ideia" : "Refine idea"}</button>
              : interpretation?.status === "confirmation" ? <div className="discovery-confirm">
                <button className="discovery-impact-action primary" type="button" onClick={() => showImpact(node)}><Check />{copy.yes}</button>
                <button className="discovery-impact-action" type="button" onClick={() => openComposer(undefined, node)}><Pencil />{copy.no}</button>
              </div>
              : <button className="discovery-impact-action" type="button" disabled={!project.engineeringSystem || interpretation?.status === "loading"} onClick={() => showImpact(node)}><ArrowRight />{interpretation?.status === "error" ? language === "pt" ? "Tentar novamente" : "Try again" : copy.impact}</button>}
            {interpretation && ["resolved", "confirmation", "unsupported", "error"].includes(interpretation.status) && <div className="discovery-feedback-actions" data-control><button type="button" disabled={feedbackBusy} onClick={async () => { setFeedbackBusy(true); const saved = await recordFeedback("accepted", node.id, "A pessoa confirmou que a interpretação corresponde à ideia."); setFeedbackBusy(false); setFeedback(saved ? (language === "pt" ? "Avaliação registrada." : "Feedback recorded.") : (language === "pt" ? "Não foi possível registrar a avaliação." : "Could not record feedback.")); }}>{language === "pt" ? "Entendeu" : "Understood"}</button><button type="button" onClick={() => requestProjectFeedback(project.id, { kind: "corrected", input: hypothesisText(node), subjectId: node.id })}>{language === "pt" ? "Corrigir interpretação" : "Correct interpretation"}</button></div>}
          </article>;
        })}
        {suggestions && <>
          {suggestions.blocks.map((block, index) => <article className={`discovery-suggestion status-${block.status}`} key={block.entityId} style={{ left: suggestions.x, top: suggestions.y + index * (block.height + SUGGESTION_GAP), width: SUGGESTION_WIDTH }} data-control>
            <span className="discovery-suggestion-head">{copy.suggestions}<em>{engineeringLabel(block.status, language)}</em></span>
            <strong>{block.name}</strong>
            <p>{block.explanation}</p>
            {block.value && <span className="discovery-suggestion-value">{block.value}</span>}
          </article>)}
          <div className="discovery-suggestion-actions" data-control style={{ left: suggestions.x, top: suggestions.y + suggestions.height + SUGGESTION_GAP, width: SUGGESTION_WIDTH }}>
            <button type="button" className="primary" disabled={feedbackBusy} onClick={() => void acceptProposal()}><Check />{proposal?.analysis.change.kind === "requirement" ? (language === "pt" ? "Editar versão do requisito" : "Edit requirement version") : copy.accept}</button>
            <button type="button" onClick={() => setScenario(suggestions.analysis)}><Maximize2 />{copy.full}</button>
            <button type="button" disabled={feedbackBusy} onClick={() => void dismissProposal()}><X />{copy.dismiss}</button>
          </div>
        </>}
        {composer && <form className="lab-composer" data-control style={{ left: composer.x, top: composer.y, width: LAB_NODE_WIDTH }} onSubmit={(event) => { event.preventDefault(); saveIdea(); }}>{composer.question && <div className="discovery-clarification-context"><p>{composer.text}</p><strong>{composer.question}</strong></div>}<textarea ref={textareaRef} value={composer.question ? composer.answer || "" : composer.text} maxLength={composer.question ? Math.max(0, Math.min(1500, HYPOTHESIS_MAX_LENGTH - composer.text.length - 1)) : HYPOTHESIS_MAX_LENGTH} placeholder={copy.placeholder} aria-label={copy.placeholder} onChange={(event) => setComposer({ ...composer, ...(composer.question ? { answer: event.target.value } : { text: event.target.value }) })} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); saveIdea(); } if (event.key === "Escape") setComposer(null); }} /><button type="submit" aria-label={copy.save}><Plus aria-hidden="true" /></button><button type="button" onClick={() => setComposer(null)} aria-label={copy.cancel}>×</button>
          <small className="discovery-description-count">{composer.text.length + (composer.answer?.length || 0)} / {HYPOTHESIS_MAX_LENGTH}</small>
          {!composer.question && completions.length > 0 && <div className="discovery-completions"><span>{copy.naming}</span>{completions.map((completion) => <button type="button" key={completion.id} onClick={() => applyCompletion(completion)} title={completion.detail}>{completion.name}{completion.detail && <em>{completion.detail}</em>}</button>)}</div>}
        </form>}
      </div>
      {feedback && <div className="discovery-notice" role="status">{feedback}</div>}
      {connecting && <div className="discovery-notice">{language === "pt" ? "Selecione a outra ideia para conectar." : "Select the other idea to connect."}<button type="button" onClick={() => setConnecting(null)}>{copy.cancel}</button></div>}
      <div className="discovery-navigation" data-control><button type="button" aria-label={copy.undo} title={`${copy.undo} · Ctrl+Z`} disabled={!history.undo} onClick={undo}><Undo2 aria-hidden="true" /></button><button type="button" aria-label={copy.redo} title={`${copy.redo} · Ctrl+Shift+Z`} disabled={!history.redo} onClick={redo}><Redo2 aria-hidden="true" /></button><span /><button type="button" aria-label={copy.out} onClick={() => zoom(1 / 1.15)}>−</button><output>{Math.round(transform.scale * 100)}%</output><button type="button" aria-label={copy.in} onClick={() => zoom(1.15)}>+</button><button type="button" aria-label={copy.fit} title={copy.fit} onClick={fit}>⌂</button></div>
    </div>}
  </div>;
}

function useAnimatedPrompt(phrases: readonly string[]): string {
  const [text, setText] = useState("");
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setText(phrases[0]); return; }
    let index = 0, character = 0, deleting = false, timeout = 0;
    const tick = () => {
      character += deleting ? -1 : 1;
      setText(phrases[index].slice(0, character));
      if (character === phrases[index].length) { deleting = true; timeout = window.setTimeout(tick, 2400); return; }
      if (!character) { deleting = false; index = (index + 1) % phrases.length; }
      timeout = window.setTimeout(tick, deleting ? 28 : 55);
    };
    timeout = window.setTimeout(tick, 200);
    return () => window.clearTimeout(timeout);
  }, [phrases]);
  return text;
}
