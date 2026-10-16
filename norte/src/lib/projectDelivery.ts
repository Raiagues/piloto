import type { LifecyclePhase, LifecycleRange } from '../../shared/delivery-lifecycle.mjs';
import type { RequirementFinding } from '../components/delivery/RequirementHighlights';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from './auth';
export type DeliveryPerson = { id: string; memberId: string; name: string; nickname: string; canReview: boolean; isFictionalProfile: boolean };
export type DeliveryAnalysis = { engine: string; findings: RequirementFinding[]; checkedRules: string[]; disclaimer: string; createdAt?: string };
export type DeliveryProposal = {id:string;requirementId:string;baseHash:string;baseVersion:number;before:string;statement:string;reason:string;authorId:string;authorName:string;reviewers:string[];version:number;status:string;stale:boolean;canReview:boolean;canMerge:boolean;createdAt:string;comments:{id:string;authorName:string;text:string;createdAt:string}[];decisions:{userId:string;authorName:string;decision:string;comment:string}[]};
export type DeliveryDocumentOption = {id:string;code:string;title:string;flow:string;kind:string;maturity:string;reference:{title:string;url:string;section:string}|null};
export type DeliveryDocument = DeliveryDocumentOption & {taskId:string;templateId:string;body:string;version:number;status:string;updatedAt:string};
export type StandardsProposal = {id:string;before:string[];standards:string[];reason:string;authorId:string;authorName:string;reviewers:string[];status:string;stale:boolean;canReview:boolean;decisions:{userId:string;authorName:string;decision:string;comment:string}[]};
export type DeliveryLifecycle = {version?:number;phases?:LifecyclePhase[];profile:string;startDate:string;durations:number[];selectedReviews:string[]};
export type DeliveryRequirement = { rationale?:string;acceptanceCriteria?:string;condition?:string;ownerId?:string;level?:string;criticality?:string;analysis:DeliveryAnalysis; id: string; title: string; statement: string; source: 'manual' | 'architecture'; sourceStatement?: string; sourceChanged: boolean; sectorId: string; method: string; entityIds: string[]; sourceRefs: string[]; artifactIds: string[]; parentIds: string[]; version: number; status: string; archived: boolean; reviewers: string[]; authorId?: string; authorName?: string; contentHash: string; canEdit: boolean; canReview: boolean; verificationStatus: string; comments: { id: string; userId: string; authorName: string; text: string; createdAt: string; version: number }[]; decisions: { userId: string; authorName: string; decision: string; comment: string; createdAt: string }[] };
export type DeliveryRun = { id: string; outcome: string; result: string; artifactIds: string[]; evidenceUrl: string; userId: string; authorName: string; createdAt: string };
export type DeliveryTest = {conditions?:string;configuration?:string;level?:string;reviewTaskIds?:string[]; id: string; title: string; method: string; procedure: string; acceptanceCriteria: string; requirementIds: string[]; entityIds: string[]; sectorId: string; ownerId: string; runs: DeliveryRun[]; archived: boolean; status: string; canEdit: boolean; version: number };
export type DeliveryTask = {manual?:boolean;excluded?:boolean;phaseId?:string;reviewNeedsRevalidation?:boolean;reviewCode?:string;lifecycleProfile?:string;lane?:number;phaseIndex?:number;documentOptions:DeliveryDocumentOption[]; id: string; title: string; description: string; phase: string; kind: string; startDate: string; dueDate: string; prepDays: number; closeDays: number; status: string; sectorId: string; ownerId: string; dependencyIds: string[]; requirementIds: string[]; testIds: string[]; inputArtifactIds: string[]; outputArtifactIds: string[]; archived: boolean; overdue: boolean; blockedBy: string[]; dateConflicts: string[]; canEdit: boolean };
export type DeliveryState = {standardsConfigured:boolean;standardsProposals:StandardsProposal[];proposals:DeliveryProposal[];documents:DeliveryDocument[];lifecycle:DeliveryLifecycle|null;lifecycleRanges:LifecycleRange[]; lifecycleTasks?:DeliveryTask[]; revision: number; baselineHash: string; standards: string[]; standardOptions: { id: string; name: string; title: string; url: string; group: string; edition?: string; subtitle?: string; kind?: string; scope?: string; note?: string; docs?: { title: string; basis: string; status: string }[] }[]; standardGroups: { id: string; name: string }[]; requirements: DeliveryRequirement[]; tests: DeliveryTest[]; tasks: DeliveryTask[]; members: DeliveryPerson[]; sectors: { id: string; name: string }[]; entities: { id: string; name: string }[]; evidence: { id: string; artifactId: string; artifactLabel: string; locator?: string; excerpt: string }[]; artifacts: { id: string; label: string }[]; permissions: { manage: boolean; editableSectorIds: string[] }; history: { id: string; revision: number; action: string; subjectId: string; requirementId?:string; actorId: string; actorName: string; createdAt: string; before: unknown; after: unknown }[] };
export function useProjectDelivery(projectId: string) {
  const { api, user } = useAuth();
  const [data, setData] = useState<DeliveryState | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const generation = useRef(0), current = useRef<DeliveryState | null>(null);
  const refresh = useCallback(async () => {
    const token = generation.current;
    try { const result = await api<DeliveryState>(`/projects/${encodeURIComponent(projectId)}/delivery`); if (token === generation.current) { current.current = result; setData(result); setError(''); } }
    catch (e) { if (token === generation.current) setError(e instanceof Error ? e.message : 'Não foi possível carregar.'); }
  }, [api, projectId]);
  useEffect(() => { generation.current++; current.current = null; setData(null); setError(''); setBusy(false); void refresh(); return () => { generation.current++; }; }, [refresh]);
  const mutate = useCallback(async (action: string, payload: Record<string, unknown> = {}) => {
    const snapshot = current.current, token = generation.current; if (!snapshot) return false;
    setBusy(true); setError('');
    try { const result = await api<DeliveryState>(`/projects/${encodeURIComponent(projectId)}/delivery/actions`, { method: 'POST', body: JSON.stringify({ ...payload, action, expectedRevision: snapshot.revision, expectedBaselineHash: snapshot.baselineHash }) }); if (token === generation.current) { current.current = result; setData(result); window.dispatchEvent(new CustomEvent('norte:delivery-changed', { detail: { projectId } })); } return token === generation.current; }
    catch (e) { if (token === generation.current) setError(e instanceof Error ? e.message : 'Não foi possível salvar.'); return false; }
    finally { if (token === generation.current) setBusy(false); }
  }, [api, projectId]);
  return { data, error, busy, refresh, mutate, user };
}
export const deliveryMethods = [{ id: 'unspecified', pt: 'A definir', en: 'Not defined' }, { id: 'test', pt: 'Ensaio', en: 'Test' }, { id: 'analysis', pt: 'Análise', en: 'Analysis' }, { id: 'inspection', pt: 'Inspeção', en: 'Inspection' }, { id: 'demonstration', pt: 'Demonstração', en: 'Demonstration' }, { id: 'simulation', pt: 'Simulação', en: 'Simulation' }];
export const deliveryStatus = (status: string, pt: boolean) => ({ draft: ['Rascunho', 'Draft'], in_review: ['Em revisão', 'In review'], approved: ['Aprovado', 'Approved'], changes_requested: ['Alterações solicitadas', 'Changes requested'], archived: ['Arquivado', 'Archived'], planned: ['Planejado', 'Planned'], passed: ['Atendeu ao critério', 'Criterion met'], failed: ['Não atendeu', 'Criterion not met'], inconclusive: ['Inconclusivo', 'Inconclusive'], stale: ['Revalidar', 'Revalidate'], in_progress: ['Em andamento', 'In progress'], blocked: ['Bloqueado', 'Blocked'], done: ['Concluído', 'Done'], unplanned: ['Sem plano', 'Not planned'], pending: ['Pendente', 'Pending'] }[status]?.[pt ? 0 : 1] || status);

export function openDeliveryRecord(area: 'requirements' | 'verification' | 'schedule', id: string) {
  const url = new URL(window.location.href); url.searchParams.set('delivery-record', id); url.hash = `/${area}`; window.location.assign(url.toString());
}
export function selectedDeliveryRecord() { return new URL(window.location.href).searchParams.get('delivery-record') || ''; }
