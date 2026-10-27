import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowRight, CalendarClock, ChevronRight, Download, FileCheck2, FilePen, FileText, Layers, ListChecks, Paperclip, ScrollText, Search, Upload, UsersRound, Video } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { API_ORIGIN, useAuth } from '../lib/auth';
import { artifactHref } from '../lib/artifacts';
import { claimBack } from '../lib/navigation';
import { rememberWorkspace } from '../lib/workspaceHistory';
import type { ConnectedArtifact } from '../lib/team';
import type { MeetingSummary } from '../lib/meetings';
import type { MissionProject } from '../lib/projectStore';
import type { Language } from '../lib/types';
import { ProjectAreaShell } from '../components/ProjectAreaShell';
import type { RailNavigation } from '../components/ProjectAreaShell';
import { useProjectDelivery, deliveryStatus, openDeliveryRecord } from '../lib/projectDelivery';
import type { DeliveryState } from '../lib/projectDelivery';
import { DeliveryAlert } from '../components/delivery/DeliveryShared';
import { DocumentWorkspace, documentLocation } from '../components/delivery/DocumentWorkspace';
import { PdfPreview } from '../components/delivery/PdfPreview';
import { ReviewDocumentWorkspace } from '../components/delivery/ReviewDocumentWorkspace';
import '../styles/document-library.css';
import '../styles/features/overview.css';

type Filter = 'all' | 'review' | 'draft' | 'final' | 'sources' | 'minutes';
type Status = 'draft' | 'in_review' | 'changes_requested' | 'approved' | 'source' | 'meeting';
type Entry = { key: string; id: string; kind: 'document' | 'source' | 'meeting'; title: string; code: string; type: string; Icon: LucideIcon; version: number | null; status: Status; statusLabel: string; updatedAt: string; context: string };

const filters: { id: Filter; pt: string; en: string }[] = [
  { id: 'all', pt: 'Todos', en: 'All' }, { id: 'review', pt: 'Em revisão', en: 'In review' }, { id: 'draft', pt: 'Rascunhos', en: 'Drafts' },
  { id: 'final', pt: 'Versão final', en: 'Final' }, { id: 'sources', pt: 'Arquivos de origem', en: 'Source files' }, { id: 'minutes', pt: 'Atas', en: 'Minutes' }
];
const documentType = (kind: string, title: string, pt: boolean) => {
  const value = `${kind} ${title}`.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  if (/matri[cz]|traceab|rastreab/.test(value)) return pt ? 'Matriz' : 'Matrix';
  if (/plano|plan\b/.test(value)) return pt ? 'Plano' : 'Plan';
  if (/especifica|requirement|requisito/.test(value)) return pt ? 'Especificação' : 'Specification';
  if (/relatorio|report|analise|analysis/.test(value)) return pt ? 'Relatório' : 'Report';
  return pt ? 'Documento técnico' : 'Technical document';
};
const meetingStatus = (status: string, pt: boolean) => ({ draft: ['Não iniciada', 'Not started'], running: ['Em andamento', 'In progress'], done: ['Ata disponível', 'Minutes ready'], interrupted: ['Preservada', 'Preserved'] } as Record<string, string[]>)[status]?.[pt ? 0 : 1] || status;
// Calendar dates (YYYY-MM-DD) are local days, not UTC midnight.
const shortDate = (value: string, language: Language) => { const at = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(value || '') ? `${value}T12:00:00` : value); return Number.isFinite(at) ? new Intl.DateTimeFormat(language === 'pt' ? 'pt-BR' : 'en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(at) : '—'; };
const parts = (values: [number, string][]) => values.filter(([count]) => count > 0).map(([count, label]) => `${count} ${label}`).join(' · ');

function SourcePreview({ artifact, pt }: { artifact: ConnectedArtifact; pt: boolean }) {
  const [text, setText] = useState(''), [error, setError] = useState('');
  const source = artifact.documentText !== undefined ? `${API_ORIGIN}/api/artifacts/${encodeURIComponent(artifact.id)}/pdf` : artifactHref(artifact);
  const pdf = artifact.documentText !== undefined || artifact.mimeType === 'application/pdf';
  useEffect(() => {
    if (!artifact.contentPath || !artifact.mimeType?.startsWith('text/')) return;
    let alive = true;
    void fetch(source, { credentials: 'include' }).then(response => { if (!response.ok) throw new Error(pt ? 'Documento indisponível.' : 'Document unavailable.'); return response.text(); }).then(value => { if (alive) setText(value); }).catch(reason => { if (alive) setError(reason.message); });
    return () => { alive = false; };
  }, [artifact.contentPath, artifact.mimeType, source, pt]);
  return <section className="document-source-workspace"><header className="document-editor-heading"><Paperclip size={16} aria-hidden="true" /><h2>{artifact.label}</h2><a className="overview-link-button" href={`${source}${artifact.contentPath ? '?download=1' : ''}`} target="_blank" rel="noreferrer"><Download size={15} />{pt ? 'Abrir original' : 'Open original'}</a></header>
    <div className="document-draft-content"><div className="document-source-preview">{pdf && (artifact.contentPath || artifact.documentText !== undefined) ? <PdfPreview title={artifact.label} source={source} pt={pt} /> : artifact.contentPath && artifact.mimeType?.startsWith('image/') ? <img src={source} alt={artifact.label} /> : text ? <pre>{text}</pre> : <div className="document-empty"><FileText size={32} /><p>{pt ? 'Consulte o arquivo no formato original.' : 'Open the file in its original format.'}</p></div>}{error && <p role="alert">{error}</p>}</div></div>
  </section>;
}

function nextMilestones(data: DeliveryState) {
  const today = new Date().toISOString().slice(0, 10);
  return data.tasks.filter(task => !task.archived && task.status !== 'done' && task.dueDate).sort((a, b) => a.dueDate.localeCompare(b.dueDate)).map(task => ({ ...task, late: task.dueDate < today }));
}

export function ProjectOverviewPage({ language, project, teams, navigation }: { language: Language; project: MissionProject; teams: { id: string; name: string }[]; navigation: RailNavigation }) {
  const pt = language === 'pt', { api } = useAuth(), { data, busy, error, refresh, mutate } = useProjectDelivery(project.id);
  const [artifacts, setArtifacts] = useState<ConnectedArtifact[]>([]), [meetings, setMeetings] = useState<MeetingSummary[]>([]), [filter, setFilter] = useState<Filter>('all'), [query, setQuery] = useState('');
  const [selected, setSelected] = useState(() => new URL(window.location.href).searchParams.get('document') || ''), [sourceId, setSourceId] = useState(() => new URL(window.location.href).searchParams.get('artifact') || ''), [packageOpen, setPackageOpen] = useState(() => new URL(window.location.href).searchParams.has('review'));
  const [uploading, setUploading] = useState(false), [localError, setLocalError] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const loadSources = useCallback(async () => {
    const [sources, rooms] = await Promise.all([api<{ artifacts: ConnectedArtifact[] }>('/artifacts'), api<{ meetings: MeetingSummary[] }>('/meetings')]);
    const ids = new Set([...(project.context.projectArtifactIds || []), ...(project.context.teamArtifactIds || []), ...(project.context.programArtifactIds || [])]);
    setArtifacts(sources.artifacts.filter(artifact => (artifact.scope === 'project' && artifact.ownerId === project.id) || ids.has(artifact.id)));
    setMeetings(rooms.meetings.filter(meeting => meeting.projectId === project.id && !meeting.example));
  }, [api, project.id, project.context.projectArtifactIds, project.context.teamArtifactIds, project.context.programArtifactIds]);
  useEffect(() => { void loadSources().catch(reason => setLocalError(reason.message)); }, [loadSources]);
  const chosenSource = artifacts.find(artifact => artifact.id === sourceId), open = Boolean(selected || chosenSource || packageOpen);
  const selectDocument = (id: string) => { setSelected(id); setSourceId(''); setPackageOpen(false); documentLocation(project.id, id); };
  const selectSource = (id: string) => { setSelected(''); setSourceId(id); setPackageOpen(false); const url = new URL(window.location.href); url.searchParams.set('project', project.id); url.searchParams.delete('document'); url.searchParams.delete('review'); if (id) url.searchParams.set('artifact', id); else url.searchParams.delete('artifact'); window.history.replaceState(window.history.state, '', url); window.dispatchEvent(new PopStateEvent('popstate')); };
  const closeAll = useCallback(() => { setSelected(''); setSourceId(''); setPackageOpen(false); const url = new URL(window.location.href); for (const key of ['document', 'artifact', 'review']) url.searchParams.delete(key); window.history.replaceState(window.history.state, '', url); }, []);
  useEffect(() => { const restore = () => { const url = new URL(window.location.href); setSelected(url.searchParams.has('review') ? '' : url.searchParams.get('document') || ''); setSourceId(url.searchParams.get('artifact') || ''); setPackageOpen(url.searchParams.has('review')); }; window.addEventListener('popstate', restore); return () => window.removeEventListener('popstate', restore); }, []);
  // An open file is an inner level of this page: the header's back closes it first.
  useEffect(() => open ? claimBack(() => { closeAll(); return true; }) : undefined, [open, closeAll]);
  useEffect(() => { if (chosenSource) rememberWorkspace(chosenSource.label, { kind: 'source', context: project.name, detail: pt ? 'Original' : 'Original' }); }, [chosenSource, project.name, pt]);

  const editable = Boolean(data && !data.permissions.readOnly && (data.permissions.manage || data.permissions.editableSectorIds.length));
  const entries = useMemo<Entry[]>(() => {
    const documents = (data?.documents || []).map(document => {
      const status = (['in_review', 'changes_requested', 'approved'].includes(document.status) ? document.status : 'draft') as Status;
      return { key: `document:${document.id}`, id: document.id, kind: 'document' as const, title: document.title, code: document.code || document.id, type: documentType(document.kind, document.title, pt), Icon: status === 'approved' ? FileCheck2 : FilePen, version: document.version || 1, status,
        statusLabel: status === 'approved' ? (pt ? 'Versão final' : 'Final version') : status === 'in_review' ? (pt ? 'Aguardando revisão' : 'Awaiting review') : status === 'changes_requested' ? (pt ? 'Alterações pedidas' : 'Changes requested') : (pt ? 'Rascunho · não submetido' : 'Draft · not submitted'),
        updatedAt: document.updatedAt, context: data?.tasks.find(task => task.id === document.taskId)?.title || '' };
    });
    const sources = artifacts.map(artifact => ({ key: `source:${artifact.id}`, id: artifact.id, kind: 'source' as const, title: artifact.label, code: (artifact.fileName?.split('.').pop() || artifact.mimeType?.split('/').pop() || '').toUpperCase(), type: pt ? 'Arquivo de origem' : 'Source file', Icon: Paperclip, version: null, status: 'source' as Status, statusLabel: pt ? 'Original' : 'Original', updatedAt: artifact.updatedAt || artifact.connectedAt, context: artifact.fileName || '' }));
    const minutes = meetings.map(meeting => ({ key: `meeting:${meeting.id}`, id: meeting.id, kind: 'meeting' as const, title: meeting.title, code: pt ? 'ATA' : 'MINUTES', type: pt ? 'Ata de reunião' : 'Meeting minutes', Icon: meeting.status === 'done' ? ScrollText : Video, version: null, status: 'meeting' as Status, statusLabel: meetingStatus(meeting.status, pt), updatedAt: meeting.updatedAt || meeting.createdAt || '', context: meeting.sectorName || meeting.teamName || '' }));
    return [...documents, ...sources, ...minutes];
  }, [data, artifacts, meetings, pt]);
  const inFilter = (entry: Entry, value: Filter) => value === 'all' || (value === 'review' ? ['in_review', 'changes_requested'].includes(entry.status) : value === 'draft' ? entry.status === 'draft' : value === 'final' ? entry.status === 'approved' : value === 'sources' ? entry.kind === 'source' : entry.kind === 'meeting');
  const visible = entries.filter(entry => inFilter(entry, filter) && `${entry.title} ${entry.code} ${entry.type} ${entry.context}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));

  async function upload(chosen: File) {
    if (chosen.size > 48 * 1024 * 1024) { setLocalError(pt ? 'Escolha um arquivo de até 48 MB.' : 'Choose a file up to 48 MB.'); return; }
    setUploading(true); setLocalError('');
    try {
      const mimeType = chosen.type || ({ pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', json: 'application/json', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' } as Record<string, string>)[chosen.name.split('.').pop()?.toLowerCase() || ''];
      if (!mimeType) throw new Error(pt ? 'Formato de arquivo não reconhecido.' : 'Unrecognized file format.');
      const raw = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error(pt ? 'Não foi possível ler o arquivo.' : 'Could not read the file.')); reader.readAsDataURL(chosen); });
      await api('/artifacts', { method: 'POST', body: JSON.stringify({ kind: 'document', scope: 'project', ownerId: project.id, label: chosen.name.replace(/\.[^.]+$/, ''), url: raw.replace(/^data:[^;]*;base64,/, `data:${mimeType};base64,`), fileName: chosen.name, mimeType, folderId: !data?.permissions.manage ? data?.permissions.editableSectorIds[0] : null, size: chosen.size, description: '', tags: [], sourceRole: 'project_context' }) });
      await loadSources(); await refresh();
    } catch (reason) { setLocalError(reason instanceof Error ? reason.message : 'Falha ao adicionar arquivo.'); } finally { setUploading(false); }
  }
  function openEntry(entry: Entry) {
    if (entry.kind === 'document') selectDocument(entry.id);
    else if (entry.kind === 'source') selectSource(entry.id);
    else { const url = new URL(window.location.href); url.searchParams.set('project', project.id); url.searchParams.set('meeting', entry.id); for (const key of ['document', 'artifact', 'review']) url.searchParams.delete(key); url.hash = '/meetings'; window.location.assign(url.toString()); }
  }

  if (open) return <ProjectAreaShell language={language} project={project} area="project" navigation={navigation}>
    <div className="document-library overview-document-open"><DeliveryAlert error={error || localError} refresh={() => { void refresh(); void loadSources(); }} pt={pt} />
      {chosenSource && <SourcePreview key={chosenSource.id} artifact={chosenSource} pt={pt} />}
      {selected && data && <DocumentWorkspace projectId={project.id} context={project.name} data={data} activeId={selected} onSelect={selectDocument} onClose={closeAll} busy={busy} error={error} mutate={mutate} pt={pt} />}
      {packageOpen && data && <ReviewDocumentWorkspace projectId={project.id} data={data} busy={busy} error={error} mutate={mutate} pt={pt} />}
    </div>
  </ProjectAreaShell>;

  const requirements = data?.requirements.filter(requirement => !requirement.archived) || [];
  const flagged = requirements.filter(requirement => requirement.analysis?.findings?.length);
  const regulatory = flagged.filter(requirement => requirement.analysis.findings.some(finding => finding.origin === 'regulatory_review' || finding.severity === 'critical'));
  const documents = entries.filter(entry => entry.kind === 'document'), milestones = data ? nextMilestones(data) : [];
  const nextReview = milestones.find(task => task.kind === 'review') || milestones[0];
  const team = teams.find(item => item.id === project.context.teamId)?.name || project.context.teamName;
  const recentMeetings = [...meetings].sort((a, b) => (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || '')).slice(0, 4);
  const count = (value: Filter) => entries.filter(entry => inFilter(entry, value)).length;
  const daysUntil = (date: string) => Math.round((Date.parse(date) - Date.parse(new Date().toISOString().slice(0, 10))) / 86400000);

  return <ProjectAreaShell language={language} project={project} area="project" navigation={navigation}>
    <div className="project-overview">
      <DeliveryAlert error={error || localError} refresh={() => { void refresh(); void loadSources(); }} pt={pt} />
      <section className="overview-summary" aria-label={pt ? 'Resumo do projeto' : 'Project summary'}>
        <div className="overview-purpose"><span className="overview-eyebrow">{pt ? 'Objetivo e problema' : 'Objective and problem'}</span><p>{project.setup.statement || (pt ? 'Sem objetivo registrado. A liderança pode descrevê-lo nas configurações do projeto.' : 'No objective recorded yet. Project leads can describe it in the project settings.')}</p></div>
        <dl className="overview-facts">
          {team && <div><dt><UsersRound size={14} aria-hidden="true" />{pt ? 'Equipe' : 'Team'}</dt><dd><a href={`#/teams?team=${encodeURIComponent(project.context.teamId || '')}`}>{team}</a></dd></div>}
          <div><dt><Layers size={14} aria-hidden="true" />{pt ? 'Setores' : 'Sectors'}</dt><dd>{project.context.sectors.length || '—'}</dd></div>
          <div><dt><UsersRound size={14} aria-hidden="true" />{pt ? 'Pessoas' : 'People'}</dt><dd>{data?.members.length ?? project.context.assignments.length}</dd></div>
          <div><dt><CalendarClock size={14} aria-hidden="true" />{pt ? 'Atualizado' : 'Updated'}</dt><dd>{shortDate(project.updatedAt, language)}</dd></div>
        </dl>
      </section>

      <section className="overview-kpis" aria-label={pt ? 'Situação do projeto' : 'Project status'}>
        <button type="button" onClick={() => navigation.onOpen('requirements')}><span className="overview-kpi-icon"><ListChecks size={18} /></span><span><small>{pt ? 'Requisitos' : 'Requirements'}</small><strong>{data ? requirements.length : '…'}</strong><em>{data ? parts(([['approved', pt ? ['aprovado', 'aprovados'] : ['approved', 'approved']], ['in_review', pt ? ['em revisão', 'em revisão'] : ['in review', 'in review']], ['changes_requested', pt ? ['com alterações pedidas', 'com alterações pedidas'] : ['with changes requested', 'with changes requested']], ['draft', pt ? ['rascunho', 'rascunhos'] : ['draft', 'drafts']]] as [string, string[]][]).map(([status, [one, many]]) => { const total = requirements.filter(item => item.status === status).length; return [total, total === 1 ? one : many] as [number, string]; })) || (pt ? 'nenhum requisito registrado' : 'no requirements recorded') : ''}</em></span><ChevronRight size={16} aria-hidden="true" /></button>
        <button type="button" className={regulatory.length ? 'attention' : ''} onClick={() => navigation.onOpen('requirements')}><span className="overview-kpi-icon"><AlertTriangle size={18} /></span><span><small>{pt ? 'Pontos de atenção' : 'Attention points'}</small><strong>{data ? flagged.length : '…'}</strong><em>{data ? (regulatory.length ? `${regulatory.length} ${pt ? 'com revisão regulatória' : 'need regulatory review'}` : flagged.length ? (pt ? 'apontamentos de redação' : 'wording findings') : (pt ? 'nenhum apontamento' : 'no findings')) : ''}</em></span><ChevronRight size={16} aria-hidden="true" /></button>
        <button type="button" onClick={() => setFilter(documents.some(entry => ['in_review', 'changes_requested'].includes(entry.status)) ? 'review' : 'all')}><span className="overview-kpi-icon"><FileText size={18} /></span><span><small>{pt ? 'Documentos' : 'Documents'}</small><strong>{entries.length}</strong><em>{parts([[count('review'), pt ? 'em revisão' : 'in review'], [count('draft'), pt ? 'rascunhos' : 'drafts'], [count('final'), pt ? 'finais' : 'final'], [count('sources'), pt ? 'fontes' : 'sources'], [count('minutes'), pt ? 'atas' : 'minutes']]) || (pt ? 'nenhum documento ainda' : 'no documents yet')}</em></span><ChevronRight size={16} aria-hidden="true" /></button>
        <button type="button" className={nextReview?.late ? 'attention' : ''} onClick={() => nextReview ? openDeliveryRecord('schedule', nextReview.id) : navigation.onOpen('schedule')}><span className="overview-kpi-icon"><CalendarClock size={18} /></span><span><small>{pt ? 'Próximo marco' : 'Next milestone'}</small><strong className="overview-kpi-text">{nextReview ? nextReview.reviewCode || nextReview.title : '—'}</strong><em>{nextReview ? `${shortDate(nextReview.dueDate, language)} · ${nextReview.late ? (pt ? 'atrasado' : 'overdue') : `${daysUntil(nextReview.dueDate)} ${pt ? 'dias' : 'days'}`}` : (pt ? 'Cronograma ainda não planejado' : 'Schedule not planned yet')}</em></span><ChevronRight size={16} aria-hidden="true" /></button>
      </section>

      <div className="overview-grid">
        <section className="overview-panel overview-documents" aria-labelledby="overview-documents-title">
          <header className="overview-panel-head"><h2 id="overview-documents-title">{pt ? 'Documentos do projeto' : 'Project documents'}</h2>
            <div className="overview-panel-actions"><label className="overview-search"><Search size={15} aria-hidden="true" /><input type="search" value={query} onChange={event => setQuery(event.target.value)} aria-label={pt ? 'Buscar documento' : 'Search documents'} placeholder={pt ? 'Buscar título, código ou revisão' : 'Search title, code or review'} /></label>
              {data && data.tasks.some(task => task.kind === 'review' && !task.archived) && <button type="button" onClick={() => { setSelected(''); setSourceId(''); setPackageOpen(true); documentLocation(project.id, '', data.tasks.find(task => task.kind === 'review' && !task.archived)?.id); }}><ScrollText size={15} />{pt ? 'Pacotes por revisão' : 'Review packages'}</button>}
              {editable && <button type="button" disabled={uploading} onClick={() => file.current?.click()}><Upload size={15} />{uploading ? (pt ? 'Adicionando…' : 'Uploading…') : (pt ? 'Adicionar arquivo' : 'Add file')}</button>}
              <input type="file" ref={file} hidden accept=".pdf,.docx,.txt,.md,.csv,.json,.png,.jpg,.jpeg" onChange={event => { const chosen = event.currentTarget.files?.[0]; if (chosen) void upload(chosen); event.currentTarget.value = ''; }} />
            </div>
          </header>
          <nav className="overview-filters" aria-label={pt ? 'Filtrar documentos' : 'Filter documents'}>{filters.map(item => <button type="button" key={item.id} aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>{pt ? item.pt : item.en}<small>{count(item.id)}</small></button>)}</nav>
          {visible.length ? <div className="overview-table-wrap"><table className="overview-table">
            <thead><tr><th scope="col">{pt ? 'Documento' : 'Document'}</th><th scope="col">{pt ? 'Tipo' : 'Type'}</th><th scope="col">{pt ? 'Versão' : 'Version'}</th><th scope="col">{pt ? 'Situação' : 'Status'}</th><th scope="col">{pt ? 'Atualizado' : 'Updated'}</th><th scope="col"><span className="sr-only">{pt ? 'Abrir' : 'Open'}</span></th></tr></thead>
            <tbody>{visible.map(entry => <tr key={entry.key} tabIndex={0} onClick={() => openEntry(entry)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openEntry(entry); } }} data-usage-action="documents.preview">
              <td><div className="overview-doc-cell"><span className={`overview-doc-icon ${entry.kind} ${entry.status}`}><entry.Icon size={16} aria-hidden="true" /></span><span className="overview-doc-copy"><strong title={entry.title}>{entry.title}</strong><small>{[entry.code, entry.context].filter(Boolean).join(' · ')}</small></span></div></td>
              <td>{entry.type}</td><td className="overview-version">{entry.version ? `v${entry.version}` : '—'}</td>
              <td><span className={`overview-status ${entry.status}`}>{entry.statusLabel}</span></td>
              <td className="overview-date">{shortDate(entry.updatedAt, language)}</td><td><ChevronRight size={15} aria-hidden="true" /></td>
            </tr>)}</tbody>
          </table></div> : <div className="overview-empty"><FileText size={28} aria-hidden="true" /><strong>{query ? (pt ? 'Nenhum documento encontrado' : 'No matching documents') : (pt ? 'Nada nesta lista ainda' : 'Nothing in this list yet')}</strong><span>{pt ? 'Documentos preparados nas revisões do cronograma, arquivos de origem e atas aparecem aqui com a situação e a versão.' : 'Documents prepared for schedule reviews, source files and minutes appear here with status and version.'}</span></div>}
        </section>

        <aside className="overview-side">
          <section className="overview-panel"><header className="overview-panel-head"><h2>{pt ? 'Próximos marcos' : 'Upcoming milestones'}</h2><button type="button" className="overview-more" onClick={() => navigation.onOpen('schedule')}>{pt ? 'Cronograma' : 'Schedule'}<ArrowRight size={14} /></button></header>
            {milestones.length ? <ol className="overview-list">{milestones.slice(0, 4).map(task => <li key={task.id}><button type="button" onClick={() => openDeliveryRecord('schedule', task.id)}><span className={`overview-date-chip${task.late ? ' late' : ''}`}><b>{new Date(task.dueDate + 'T12:00:00').getDate()}</b>{new Intl.DateTimeFormat(pt ? 'pt-BR' : 'en-GB', { month: 'short' }).format(new Date(task.dueDate + 'T12:00:00'))}</span><span><strong>{task.reviewCode ? `${task.reviewCode} · ` : ''}{task.title}</strong><small>{task.late ? (pt ? 'Atrasado' : 'Overdue') : deliveryStatus(task.status, pt)}{task.kind === 'review' ? ` · ${pt ? 'revisão' : 'review'}` : ''}</small></span></button></li>)}</ol> : <p className="overview-note">{pt ? 'Nenhuma atividade com data. O cronograma começa vazio até a equipe planejar as fases.' : 'No dated activity. The schedule stays empty until the team plans its phases.'}</p>}
          </section>
          <section className="overview-panel"><header className="overview-panel-head"><h2>{pt ? 'Reuniões do projeto' : 'Project meetings'}</h2><a className="overview-more" href="#/meetings">{pt ? 'Todas' : 'All'}<ArrowRight size={14} /></a></header>
            {recentMeetings.length ? <ul className="overview-list">{recentMeetings.map(meeting => <li key={meeting.id}><button type="button" onClick={() => openEntry({ kind: 'meeting', id: meeting.id } as Entry)}><span className="overview-doc-icon meeting"><Video size={15} aria-hidden="true" /></span><span><strong>{meeting.title}</strong><small>{meetingStatus(meeting.status, pt)}{meeting.sectorName ? ` · ${meeting.sectorName}` : ''}</small></span></button></li>)}</ul> : <p className="overview-note">{pt ? 'Nenhuma reunião ligada a este projeto.' : 'No meetings linked to this project.'}</p>}
          </section>
          <section className="overview-panel"><header className="overview-panel-head"><h2>{pt ? 'Requisitos com apontamentos' : 'Requirements with findings'}</h2><button type="button" className="overview-more" onClick={() => navigation.onOpen('requirements')}>{pt ? 'Requisitos' : 'Requirements'}<ArrowRight size={14} /></button></header>
            {flagged.length ? <ul className="overview-list">{flagged.slice(0, 4).map(requirement => <li key={requirement.id}><button type="button" onClick={() => openDeliveryRecord('requirements', requirement.id)}><span className={`overview-doc-icon finding${regulatory.includes(requirement) ? ' regulatory' : ''}`}><AlertTriangle size={15} aria-hidden="true" /></span><span><strong>{requirement.id} · {requirement.title}</strong><small>{requirement.analysis.findings.length} {pt ? (requirement.analysis.findings.length === 1 ? 'apontamento' : 'apontamentos') : 'findings'}{regulatory.includes(requirement) ? (pt ? ' · revisão regulatória' : ' · regulatory review') : ''}</small></span></button></li>)}</ul> : <p className="overview-note">{data ? (pt ? 'Nenhum apontamento registrado nas análises.' : 'No findings recorded by analyses.') : '…'}</p>}
          </section>
        </aside>
      </div>
    </div>
  </ProjectAreaShell>;
}
